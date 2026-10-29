import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface TransferIdentity { userId: string; tenantId: string }
export type TransferTarget = { documentId: string } | { create: { parentId: string; conflictOf?: string } };
export interface UploadInput { target: TransferTarget; baseVersion: number | null; name: string; mimeType: string; size: number; sha256: string; bumpIndice: false }
export interface UploadTransport {
  open(input: UploadInput, signal?: AbortSignal): Promise<{ uploadId: string; chunkSize: number }>;
  status(id: string, signal?: AbortSignal): Promise<{ size: number; received: number[][]; completed: boolean }>;
  chunk(id: string, start: number, total: number, bytes: Buffer, signal?: AbortSignal): Promise<void>;
  complete(id: string, sha256: string, signal?: AbortSignal): Promise<{ node: { id: string }; version: number }>;
}
export interface TransferJob extends UploadInput, TransferIdentity {
  formatVersion: 1; id: string; state: 'queued' | 'uploading' | 'retry' | 'conflict' | 'blocked' | 'done';
  createdAt: number; attempts: number; nextAttemptAt: number; errorCode: string | null;
  uploadId?: string; chunkSize?: number; result?: { node: { id: string }; version: number };
}
const ID = /^[0-9a-f-]{36}$/;
const error = (code: string) => Object.assign(new Error(code), { status: 400, code });

/** Union complement, validated before it can drive reads or allocations. */
export function missingRanges(received: number[][], size: number): Array<[number, number]> {
  if (!Array.isArray(received) || !Number.isSafeInteger(size) || size < 0) throw error('INVALID_UPLOAD_STATUS');
  const sorted = received.map(r => {
    if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isSafeInteger) || r[0] < 0 || r[1] < r[0] || r[1] >= size) throw error('INVALID_UPLOAD_STATUS');
    return r;
  }).sort((a,b) => a[0] - b[0]);
  const missing: Array<[number, number]> = []; let cursor = 0;
  for (const [start,end] of sorted) { if (start > cursor) missing.push([cursor,start-1]); cursor = Math.max(cursor,end+1); }
  if (cursor < size) missing.push([cursor,size-1]);
  return missing;
}
async function digest(file: string) {
  const hash = crypto.createHash('sha256'); let size = 0;
  for await (const bytes of createReadStream(file)) { hash.update(bytes); size += bytes.length; }
  return { sha256: hash.digest('hex'), size };
}

/** Single writer per queue directory. Native adapters must not share writable ownership.
 * Snapshots and completed jobs are retained until an explicit future retention policy. */
export class TransferQueue {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private root: string, private identity: TransferIdentity, private now = Date.now) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> { const run = this.chain.then(fn); this.chain = run.catch(() => {}); return run; }
  private snapshot(id: string) { if (!ID.test(id)) throw error('INVALID_JOB_ID'); return path.join(this.root, `${id}.snapshot`); }
  private async save(job: TransferJob) {
    this.snapshot(job.id);
    const temporary = path.join(this.root, `${job.id}.${crypto.randomUUID()}.tmp`);
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(job)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, path.join(this.root, `${job.id}.json`));
    }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  private async jobs(): Promise<TransferJob[]> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const jobs: TransferJob[] = [];
    for (const name of (await fs.readdir(this.root)).filter(n => n.endsWith('.json')).sort()) {
      const file = path.join(this.root, name);
      if ((await fs.stat(file)).size > 65536) throw error('QUEUE_CORRUPT');
      let j: TransferJob; try { j = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw error('QUEUE_CORRUPT'); }
      if (!j || !ID.test(j.id) || name !== `${j.id}.json` || j.formatVersion !== 1
        || j.userId !== this.identity.userId || j.tenantId !== this.identity.tenantId
        || !['queued','uploading','retry','conflict','blocked','done'].includes(j.state)
        || !Number.isSafeInteger(j.size) || j.size < 0 || !/^[a-f0-9]{64}$/.test(j.sha256)
        || !Number.isFinite(j.createdAt) || !Number.isSafeInteger(j.attempts) || j.attempts < 0 || !Number.isFinite(j.nextAttemptAt)) throw error('QUEUE_CORRUPT');
      jobs.push(j);
    }
    return jobs.sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  list() { return this.serial(() => this.jobs()); }
  enqueue(file: string, target: TransferTarget, baseVersion: number | null, mimeType = 'application/octet-stream') {
    return this.serial(async () => {
      if ('documentId' in target && (!target.documentId || !Number.isSafeInteger(baseVersion) || baseVersion! < 1)) throw error('BASE_VERSION_REQUIRED');
      if ('create' in target && !target.create?.parentId) throw error('INVALID_TARGET');
      const jobs = await this.jobs(); const id = crypto.randomUUID(); const snapshot = this.snapshot(id);
      const source = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      let output: Awaited<ReturnType<typeof fs.open>> | undefined;
      try {
        const before = await source.stat();
        if (!before.isFile() || before.size > 200 * 1024 * 1024) throw error('SOURCE_NOT_SUPPORTED');
        output = await fs.open(snapshot, 'wx', 0o600);
        const hash = crypto.createHash('sha256'); let size = 0;
        for await (const bytes of source.createReadStream({ autoClose: false })) {
          hash.update(bytes); await output.writeFile(bytes); size += bytes.length;
          if (size > 200 * 1024 * 1024) throw error('SOURCE_NOT_SUPPORTED');
        }
        await output.sync();
        const after = await source.stat();
        if (before.size !== after.size || size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw error('SOURCE_CHANGED');
        const sha256 = hash.digest('hex');
        const duplicate = jobs.find(j => j.sha256 === sha256 && j.name === path.basename(file) && j.baseVersion === baseVersion
          && JSON.stringify(j.target) === JSON.stringify(target) && j.mimeType === mimeType);
        if (duplicate) { await output.close(); output = undefined; await fs.rm(snapshot); return duplicate; }
        const job: TransferJob = { ...this.identity, formatVersion: 1, id, target: structuredClone(target), baseVersion,
          name: path.basename(file), mimeType, size, sha256, bumpIndice: false, state: 'queued', createdAt: jobs.reduce((latest,j) => Math.max(latest,j.createdAt + 1), this.now()), attempts: 0, nextAttemptAt: 0, errorCode: null };
        await this.save(job); return job;
      } catch (e) { await output?.close(); output = undefined; await fs.rm(snapshot, { force: true }); throw e; }
      finally { await output?.close(); await source.close(); }
    });
  }
  /** Explicit retry of a blocked job; conflicts require a new target/base version. */
  retry(id: string) { return this.serial(async () => {
    const job = (await this.jobs()).find(j => j.id === id); if (!job || job.state === 'conflict' || job.state === 'done') throw error('RETRY_NOT_ALLOWED');
    job.state = 'queued'; job.nextAttemptAt = 0; job.errorCode = null; await this.save(job);
  }); }
  runNext(transport: UploadTransport, signal?: AbortSignal) { return this.serial(async () => {
    const job = (await this.jobs()).find(j => ['queued','uploading','retry'].includes(j.state) && j.nextAttemptAt <= this.now());
    if (!job || signal?.aborted) return null;
    job.state = 'uploading'; job.attempts++; await this.save(job);
    try {
      const snapshot = this.snapshot(job.id); const actual = await digest(snapshot);
      if (actual.size !== job.size || actual.sha256 !== job.sha256) throw error('SNAPSHOT_CORRUPT');
      if (!job.uploadId) {
        const session = await transport.open({ target: job.target, baseVersion: job.baseVersion, name: job.name, mimeType: job.mimeType,
          size: job.size, sha256: job.sha256, bumpIndice: false }, signal);
        if (!/^up_[a-f0-9]{24}$/.test(session.uploadId) || !Number.isSafeInteger(session.chunkSize) || session.chunkSize < 1 || session.chunkSize > 16 * 1024 * 1024) throw error('INVALID_UPLOAD_STATUS');
        job.uploadId = session.uploadId; job.chunkSize = session.chunkSize; await this.save(job);
      }
      const status = await transport.status(job.uploadId, signal);
      if (status.size !== job.size) throw error('INVALID_UPLOAD_STATUS');
      const missing = missingRanges(status.received, job.size);
      if (!status.completed) {
        if (!Number.isSafeInteger(job.chunkSize) || job.chunkSize! < 1 || job.chunkSize! > 16 * 1024 * 1024) throw error('QUEUE_CORRUPT');
        const handle = await fs.open(snapshot, 'r');
        try { for (const [start,end] of missing) { for (let offset = start; offset <= end; offset += job.chunkSize!) {
          signal?.throwIfAborted(); const bytes = Buffer.alloc(Math.min(job.chunkSize!, end-offset+1));
          const read = await handle.read(bytes, 0, bytes.length, offset);
          if (read.bytesRead !== bytes.length) throw error('SNAPSHOT_CORRUPT');
          await transport.chunk(job.uploadId, offset, job.size, bytes, signal);
        } } } finally { await handle.close(); }
      }
      const result = await transport.complete(job.uploadId, job.sha256, signal);
      if (!result?.node?.id || !Number.isSafeInteger(result.version) || result.version < 1) throw error('INVALID_UPLOAD_RESULT');
      job.result = { node: { id: result.node.id }, version: result.version }; job.state = 'done'; job.errorCode = null;
    } catch (e: any) {
      job.errorCode = /^[A-Z_]{1,64}$/.test(e.code) ? e.code : 'TRANSFER_FAILED';
      if (e.status === 409 && e.code === 'VERSION_CONFLICT') job.state = 'conflict';
      else if (['ENOENT','EACCES','EPERM'].includes(e.code)) job.state = 'blocked';
      else if (e.status >= 400 && e.status < 500 && ![408,429].includes(e.status)) job.state = 'blocked';
      else { job.state = 'retry'; job.nextAttemptAt = this.now() + Math.min(300000, 1000 * 2 ** Math.min(job.attempts, 8)); }
    }
    await this.save(job); return job;
  }); }
}
