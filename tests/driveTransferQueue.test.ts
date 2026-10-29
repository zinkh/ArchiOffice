import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TransferQueue, missingRanges, type UploadTransport } from '../server/desktop/agent/transferQueue';
let dir: string; let file: string; let now: number;
const identity = { userId: 'u1', tenantId: 't1' }; const id = 'up_' + 'a'.repeat(24);
let received: number[][]; let chunks: Array<{ offset: number; bytes: string }>;
let transport: UploadTransport;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drive-queue-')); file = path.join(dir, 'Plan.txt');
  await fs.writeFile(file, 'abcdefgh'); now = Date.now(); received = []; chunks = [];
  transport = {
    open: vi.fn(async () => ({ uploadId: id, chunkSize: 3 })),
    status: vi.fn(async () => ({ size: 8, received, completed: false })),
    chunk: vi.fn(async (_, offset, total, bytes) => { chunks.push({ offset, bytes: bytes.toString() }); received.push([offset,offset+bytes.length-1]); }),
    complete: vi.fn(async () => ({ node: { id: 'doc:d1' }, version: 2 })),
  };
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
const queue = () => new TransferQueue(path.join(dir, 'queue'), identity, () => now);
it('preserves a snapshot independently of later saves and keeps both files after success', async () => {
  const q = queue(); const job = await q.enqueue(file, { documentId: 'd1' }, 1);
  await fs.writeFile(file, 'newer edits');
  expect((await q.runNext(transport))?.state).toBe('done');
  expect(chunks.map(c => c.bytes).join('')).toBe('abcdefgh');
  expect(await fs.readFile(file, 'utf8')).toBe('newer edits');
  expect(await fs.readFile(path.join(dir, 'queue', `${job.id}.snapshot`), 'utf8')).toBe('abcdefgh');
  expect((await queue().list())[0].result?.version).toBe(2);
});
it('resumes the same upload after restart using authoritative server ranges', async () => {
  const q = queue(); await q.enqueue(file, { documentId: 'd1' }, 1);
  const original = transport.chunk;
  transport.chunk = vi.fn<UploadTransport['chunk']>(async (...args) => {
    if (args[1] === 3) throw new Error('connection lost');
    await original(...args);
  });
  expect((await q.runNext(transport))?.state).toBe('retry');
  expect(chunks.map(c => c.offset)).toEqual([0]);
  now += 10000; transport.chunk = original;
  expect((await queue().runNext(transport))?.state).toBe('done');
  expect(transport.open).toHaveBeenCalledTimes(1);
  expect(chunks.map(c => c.offset)).toEqual([0,3,6]);
});
it('retries a lost completion response with the same session instead of creating a new document', async () => {
  const q = queue(); await q.enqueue(file, { create: { parentId: 'phase:p1:APD' } }, null);
  const complete = transport.complete;
  transport.complete = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockImplementation(complete);
  expect((await q.runNext(transport))?.state).toBe('retry');
  now += 10000;
  expect((await queue().runNext(transport))?.state).toBe('done');
  expect(transport.open).toHaveBeenCalledTimes(1); expect(transport.chunk).toHaveBeenCalledTimes(3);
});
it('preserves concurrent modifications as a visible conflict, with no automatic overwrite', async () => {
  const q = queue(); const job = await q.enqueue(file, { documentId: 'd1' }, 1);
  transport.open = vi.fn().mockRejectedValue(Object.assign(new Error('conflict'), { status: 409, code: 'VERSION_CONFLICT' }));
  expect((await q.runNext(transport))?.state).toBe('conflict');
  expect(await q.runNext(transport)).toBeNull();
  await expect(q.retry(job.id)).rejects.toThrow('RETRY_NOT_ALLOWED');
  expect(await fs.readFile(path.join(dir,'queue',`${job.id}.snapshot`),'utf8')).toBe('abcdefgh');
});
it.each([401,402,403,410])('blocks HTTP %s without deleting work or retrying silently', async status => {
  const q = queue(); const job = await q.enqueue(file, { documentId: 'd1' }, 1);
  transport.open = vi.fn().mockRejectedValue(Object.assign(new Error('secret must not be recorded'), { status, code: 'ACCESS_REFUSED' }));
  expect((await q.runNext(transport))?.state).toBe('blocked');
  now += 999999; expect(await q.runNext(transport)).toBeNull();
  const stored = await fs.readFile(path.join(dir,'queue',`${job.id}.json`),'utf8');
  expect(stored).not.toContain('secret must not');
  expect(await fs.readFile(file,'utf8')).toBe('abcdefgh');
});
it('detects snapshot corruption before sending bytes', async () => {
  const q = queue(); const job = await q.enqueue(file, { documentId: 'd1' }, 1);
  await fs.writeFile(path.join(dir,'queue',`${job.id}.snapshot`),'corrupted');
  expect(await q.runNext(transport)).toMatchObject({ state: 'blocked', errorCode: 'SNAPSHOT_CORRUPT' });
  expect(transport.open).not.toHaveBeenCalled();
});
it('deduplicates the same save and prevents cross-cabinet queue reuse', async () => {
  const q = queue(); const a = await q.enqueue(file, { documentId: 'd1' }, 1);
  expect((await q.enqueue(file, { documentId: 'd1' }, 1)).id).toBe(a.id);
  await expect(new TransferQueue(path.join(dir,'queue'), { ...identity,tenantId:'other' }).list()).rejects.toThrow('QUEUE_CORRUPT');
});
it('validates ranges and respects backoff', async () => {
  expect(missingRanges([[3,4],[0,1],[1,3]],8)).toEqual([[5,7]]);
  expect(() => missingRanges([[0,99]],8)).toThrow();
  const q = queue(); await q.enqueue(file, { documentId: 'd1' }, 1);
  transport.open = vi.fn().mockRejectedValue(Object.assign(new Error(), { status: 503 }));
  expect((await q.runNext(transport))?.state).toBe('retry');
  expect(await q.runNext(transport)).toBeNull();
});

it('processes saved versions in enqueue order even when timestamps are equal', async () => {
  const q = queue(); const first = await q.enqueue(file,{documentId:'d1'},1);
  await fs.writeFile(file,'different save'); const second = await q.enqueue(file,{documentId:'d1'},2);
  const jobs = await q.list(); expect(jobs.map(j=>j.id)).toEqual([first.id,second.id]);
});
it('blocks a missing snapshot without deleting the original file', async () => {
  const q = queue(); const job = await q.enqueue(file,{documentId:'d1'},1);
  await fs.rm(path.join(dir,'queue',`${job.id}.snapshot`));
  expect((await q.runNext(transport))?.state).toBe('blocked');
  expect(transport.open).not.toHaveBeenCalled(); expect(await fs.readFile(file,'utf8')).toBe('abcdefgh');
});
