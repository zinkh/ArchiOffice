import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, expect, it, vi, type Mock } from 'vitest';
import { createAgentWorker, type WorkerConfig } from '../server/desktop/agent/worker';
const { transfer } = vi.hoisted(()=>({transfer:{open:vi.fn(),status:vi.fn(),chunk:vi.fn(),complete:vi.fn()}}));
vi.mock('../server/desktop/agent/uploadTransport',()=>({createUploadTransport:()=>transfer}));
let root:string;let session:Mock<WorkerConfig['session']>;let status:Mock<WorkerConfig['status']>;
beforeEach(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),'drive-worker-'));status=vi.fn<WorkerConfig['status']>();
  session=vi.fn<WorkerConfig['session']>().mockResolvedValue({userId:'user',tenantId:'tenant',deviceId:'device',token:'ds_at_secret'});
  transfer.open.mockReset().mockResolvedValue({uploadId:'up_'+'a'.repeat(24),chunkSize:8});
  transfer.status.mockReset().mockResolvedValue({size:5,received:[],completed:false});
  transfer.chunk.mockReset().mockResolvedValue(undefined);transfer.complete.mockReset().mockResolvedValue({node:{id:'doc:new'},version:1});
});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
it('queues an explicit file to the linked cabinet inbox and reports sanitized state',async()=>{
  const file=path.join(root,'Plan.txt');await fs.writeFile(file,'hello');
  const worker=createAgentWorker({root:path.join(root,'queue'),origin:'https://www.archioffice.fr',session:async()=>session(),status});
  const response=await worker.enqueue(file);expect(response.queued).toBe(true);expect(JSON.stringify(response)).not.toContain('secret');
  await worker.tick();
  expect(transfer.open.mock.calls[0][0].target).toEqual({create:{parentId:'inbox:tenant'}});
  expect(status).toHaveBeenLastCalledWith({state:'running',pending:0,blocked:0,conflicts:0});
  expect(JSON.stringify(status.mock.calls)).not.toContain('secret');await worker.stop();
});
it('does not touch a queue or send files when the vault refuses authorization',async()=>{
  session.mockRejectedValue(Object.assign(new Error('denied'),{status:402,code:'DRIVE_LICENSE_EXPIRED'}));
  const worker=createAgentWorker({root,origin:'https://www.archioffice.fr',session:async()=>session(),status});
  await worker.tick();expect(transfer.open).not.toHaveBeenCalled();expect(status).toHaveBeenLastCalledWith({state:'paused',code:'DRIVE_LICENSE_EXPIRED'});
  expect(await fs.readdir(root)).toEqual([]);await worker.stop();
});
it('coalesces overlapping ticks and stops without deleting queued work',async()=>{
  const file=path.join(root,'Plan.txt');await fs.writeFile(file,'hello');
  const worker=createAgentWorker({root:path.join(root,'queue'),origin:'https://www.archioffice.fr',session:async()=>session(),status});
  await worker.enqueue(file);await Promise.all([worker.tick(),worker.tick()]);
  expect(transfer.complete).toHaveBeenCalledTimes(1);await worker.stop();await worker.tick();expect(transfer.complete).toHaveBeenCalledTimes(1);
  expect((await fs.readdir(path.join(root,'queue'))).length).toBe(1);
});
