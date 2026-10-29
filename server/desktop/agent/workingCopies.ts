import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DownloadMetadata } from './downloadTransport';
import type { TransferIdentity, TransferJob } from './transferQueue';

interface WorkingRecord extends TransferIdentity {
  formatVersion: 1;
  nodeId: string;
  name: string;
  baseVersion: number;
  baseSha256: string;
  baseSize: number;
  state: 'prepared' | 'ready';
}
const fail = (code: string) => Object.assign(new Error(code), { status: 400, code });
function filename(name: string) {
  let safe = name.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').slice(0, 120).replace(/[ .]+$/g, '');
  if (!safe || safe === '.' || safe === '..') safe = 'Document';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(safe)) safe = '_' + safe;
  return safe;
}
async function digest(file: string) {
  if (!(await fs.lstat(file)).isFile()) throw fail('WORKING_FILE_UNSUPPORTED');
  const fd = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await fd.stat();
    if (!before.isFile() || before.size > 200 * 1024 * 1024) throw fail('WORKING_FILE_UNSUPPORTED');
    const hash = crypto.createHash('sha256'); let size = 0;
    for await (const bytes of fd.createReadStream({ autoClose: false })) {
      size += bytes.length; if (size > 200 * 1024 * 1024) throw fail('WORKING_FILE_UNSUPPORTED'); hash.update(bytes);
    }
    const after = await fd.stat();
    if (before.size !== after.size || size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw fail('WORKING_FILE_CHANGED');
    return { size, sha256: hash.digest('hex') };
  } finally { await fd.close(); }
}
/** One writer per account directory. A working file is never replaced, even when
 * unchanged. Remote updates require a future explicit reconciliation flow. */
export class WorkingCopies {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private root: string, private identity: TransferIdentity) {}
  private serial<T>(fn: () => Promise<T>) { const p = this.chain.then(fn); this.chain = p.catch(() => {}); return p; }
  private directory(nodeId: string) {
    if (typeof nodeId !== 'string' || !nodeId.startsWith('doc:') || nodeId.length > 512) throw fail('INVALID_DOCUMENT');
    const key = crypto.createHash('sha256').update(JSON.stringify([this.identity.userId, this.identity.tenantId, nodeId])).digest('hex');
    return path.join(this.root, key);
  }
  private async read(nodeId: string): Promise<WorkingRecord | null> {
    const file = path.join(this.directory(nodeId), 'working.json');
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 65536) throw fail('WORKING_RECORD_CORRUPT');
      const r: WorkingRecord = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!r || r.formatVersion !== 1 || r.nodeId !== nodeId || r.userId !== this.identity.userId || r.tenantId !== this.identity.tenantId
        || typeof r.name !== 'string' || filename(r.name) !== r.name || !Number.isSafeInteger(r.baseVersion) || r.baseVersion < 1
        || !/^[a-f0-9]{64}$/.test(r.baseSha256) || !Number.isSafeInteger(r.baseSize) || r.baseSize < 0 || r.baseSize > 200 * 1024 * 1024
        || !['prepared', 'ready'].includes(r.state)) throw fail('WORKING_RECORD_CORRUPT');
      return r;
    } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
  }
  private async save(r: WorkingRecord) {
    const dir = this.directory(r.nodeId); const tmp = path.join(dir, crypto.randomUUID() + '.tmp');
    try {
      const fd = await fs.open(tmp, 'wx', 0o600);
      try { await fd.writeFile(JSON.stringify(r)); await fd.sync(); } finally { await fd.close(); }
      await fs.rename(tmp, path.join(dir, 'working.json'));
    } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
  }
  private file(r: WorkingRecord) { return path.join(this.directory(r.nodeId), 'files', r.name); }
  private async describe(r: WorkingRecord) {
    const file = this.file(r); const actual = await digest(file);
    return { file, nodeId: r.nodeId, baseVersion: r.baseVersion, modified: actual.sha256 !== r.baseSha256 || actual.size !== r.baseSize };
  }
  /** Source must be the independently verified immutable cache, never renderer input. */
  prepare(meta: DownloadMetadata, source: { file: string; sha256: string }) { return this.serial(async () => {
    if (!Number.isSafeInteger(meta.version) || meta.version < 1 || typeof meta.name !== 'string' || !Number.isSafeInteger(meta.size)
      || meta.size < 0 || meta.size > 200 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(source.sha256)
      || (meta.sha256 !== null && meta.sha256 !== source.sha256)) throw fail('INVALID_WORKING_SOURCE');
    let record = await this.read(meta.nodeId);
    if (record?.state === 'ready') return { ...await this.describe(record), remoteVersion: meta.version };
    if (record && (record.baseVersion !== meta.version || record.baseSha256 !== source.sha256 || record.baseSize !== meta.size)) throw fail('WORKING_RECOVERY_REQUIRED');
    const dir = this.directory(meta.nodeId); await fs.mkdir(path.join(dir, 'files'), { recursive: true, mode: 0o700 });
    if (!record) {
      record = { formatVersion: 1, ...this.identity, nodeId: meta.nodeId, name: filename(meta.name), baseVersion: meta.version,
        baseSha256: source.sha256, baseSize: meta.size, state: 'prepared' };
      // Never adopt an untracked file or overwrite one left by another process.
      try { await fs.lstat(this.file(record)); throw fail('WORKING_FILE_EXISTS'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
      await this.save(record);
    }
    const file = this.file(record);
    let exists = false;
    try { await fs.lstat(file); exists = true; } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    if (!exists) {
      const tmp = path.join(dir, crypto.randomUUID() + '.part');
      try {
        await fs.copyFile(source.file, tmp, constants.COPYFILE_EXCL);
        await fs.chmod(tmp, 0o600);
        const actual = await digest(tmp);
        if (actual.size !== meta.size || actual.sha256 !== source.sha256) throw fail('WORKING_SOURCE_CORRUPT');
        const fd = await fs.open(tmp, 'r+'); try { await fd.sync(); } finally { await fd.close(); }
        await fs.link(tmp, file); // exclusive publication, a different inode from the cache
      } finally { await fs.rm(tmp, { force: true }); }
    }
    const actual = await digest(file);
    if (actual.size !== record.baseSize || actual.sha256 !== record.baseSha256) throw fail('WORKING_RECOVERY_REQUIRED');
    record.state = 'ready'; await this.save(record);
    return { ...await this.describe(record), remoteVersion: meta.version };
  }); }
  inspect(nodeId: string) { return this.serial(async () => {
    const r = await this.read(nodeId); if (!r || r.state !== 'ready') throw fail('WORKING_COPY_UNAVAILABLE');
    return this.describe(r);
  }); }
  /** A successful snapshot becomes the baseline, even if the app kept editing.
   * No file bytes are touched. Replay is safe after a process restart. */
  acknowledge(job: TransferJob) { return this.serial(async () => {
    if (job.state !== 'done' || !('documentId' in job.target)) return;
    if (job.userId !== this.identity.userId || job.tenantId !== this.identity.tenantId) throw fail('WORKING_IDENTITY_MISMATCH');
    const r = await this.read(job.target.documentId);
    if (!r || r.state !== 'ready' || r.baseVersion !== job.baseVersion) return;
    if (job.result?.node.id !== r.nodeId || !Number.isSafeInteger(job.result.version) || job.result.version <= r.baseVersion
      || !/^[a-f0-9]{64}$/.test(job.sha256) || !Number.isSafeInteger(job.size) || job.size < 0 || job.size > 200 * 1024 * 1024) throw fail('INVALID_WORKING_ACKNOWLEDGEMENT');
    r.baseVersion = job.result.version; r.baseSha256 = job.sha256; r.baseSize = job.size; await this.save(r);
  }); }
}
