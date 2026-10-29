import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, expect, it, vi, type Mock } from 'vitest';
import { createAgentWorker, type WorkerConfig } from '../server/desktop/agent/worker';
const { transfer } = vi.hoisted(()=>({transfer:{open:vi.fn(),status:vi.fn(),chunk:vi.fn(),complete:vi.fn()}}));
vi.mock('../server/desktop/agent/uploadTransport',()=>({createUploadTransport:()=>transfer}));
const { download } = vi.hoisted(()=>({download:{metadata:vi.fn(),read:vi.fn()}}));
vi.mock('../server/desktop/agent/downloadTransport',()=>({createDownloadTransport:()=>download}));
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

it('retains a downloaded version and rechecks authorization before offline lookup',async()=>{
  const meta={nodeId:'doc:file1',version:1,size:5,name:'Plan.pdf',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockResolvedValue(meta);
  download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const worker=createAgentWorker({root:path.join(root,'cache'),origin:'https://www.archioffice.fr',session:async()=>session(),status});
  expect(await worker.keepOffline('doc:file1')).toMatchObject({version:1,verifiedAgainstRemote:true});
  expect(await fs.readFile((await worker.cachedVersion(meta))!.file,'utf8')).toBe('hello');
  session.mockRejectedValue(Object.assign(new Error('expired'),{status:402}));
  await expect(worker.cachedVersion(meta)).rejects.toThrow('expired');
  await worker.stop();
});

it('uploads edits against their original version and acknowledges only the uploaded snapshot',async()=>{
  const meta={nodeId:'doc:file1',version:1,size:5,name:'Plan.dwg',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockResolvedValue(meta);
  download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const worker=createAgentWorker({root:path.join(root,'workspace'),origin:'https://www.archioffice.fr',session:async()=>session(),status});
  await worker.keepOffline(meta.nodeId);const copy=await worker.prepareWorkingCopy(meta);
  expect(await worker.uploadWorkingCopy(meta.nodeId)).toEqual({queued:false});
  await fs.writeFile(copy.file,'edited');
  transfer.status.mockResolvedValue({size:6,received:[],completed:false});
  transfer.complete.mockResolvedValue({node:{id:meta.nodeId},version:2});
  expect(await worker.uploadWorkingCopy(meta.nodeId)).toMatchObject({queued:true});
  // The next edit happens after the durable snapshot, before completion.
  await fs.writeFile(copy.file,'later!');await worker.tick();
  expect(transfer.open.mock.calls[0][0]).toMatchObject({target:{documentId:meta.nodeId},baseVersion:1});
  expect(await worker.prepareWorkingCopy(meta)).toMatchObject({baseVersion:2,modified:true});
  expect(await fs.readFile(copy.file,'utf8')).toBe('later!');
  transfer.complete.mockResolvedValue({node:{id:meta.nodeId},version:3});
  await worker.uploadWorkingCopy(meta.nodeId);await worker.tick();
  expect(transfer.open.mock.calls[1][0]).toMatchObject({baseVersion:2});
  expect(await worker.uploadWorkingCopy(meta.nodeId)).toEqual({queued:false});await worker.stop();
});
it('does not expose a working path or snapshot new edits after license refusal',async()=>{
  const worker=createAgentWorker({root,origin:'https://www.archioffice.fr',session:async()=>session(),status});
  session.mockRejectedValue(new Error('expired'));
  await expect(worker.prepareWorkingCopy({nodeId:'doc:file1',version:1,size:0,name:'x',sha256:null})).rejects.toThrow('expired');
  await expect(worker.uploadWorkingCopy('doc:file1')).rejects.toThrow('expired');
  expect(await fs.readdir(root)).toEqual([]);await worker.stop();
});
it('replays a completed upload after restart without uploading the same edit again',async()=>{
  const meta={nodeId:'doc:file1',version:1,size:5,name:'Plan.dwg',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockResolvedValue(meta);
  download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const config={root:path.join(root,'restart'),origin:'https://www.archioffice.fr',session:async()=>session(),status};
  const first=createAgentWorker(config);await first.keepOffline(meta.nodeId);
  const copy=await first.prepareWorkingCopy(meta);await fs.writeFile(copy.file,'edited');
  const queued=await first.uploadWorkingCopy(meta.nodeId);await first.stop();
  // Crash point: the queue's completion is durable but working.json is not acked.
  const [scope]=await fs.readdir(config.root);const journal=path.join(config.root,scope,`${queued.jobId}.json`);
  const job=JSON.parse(await fs.readFile(journal,'utf8'));job.state='done';job.result={node:{id:meta.nodeId},version:2};
  await fs.writeFile(journal,JSON.stringify(job));
  const restarted=createAgentWorker(config);
  expect(await restarted.uploadWorkingCopy(meta.nodeId)).toEqual({queued:false});
  expect(await restarted.prepareWorkingCopy(meta)).toMatchObject({baseVersion:2,modified:false});
  expect(transfer.open).not.toHaveBeenCalled();await restarted.stop();
});
it('preserves a conflicting working file and rejects a path after account changes',async()=>{
  const meta={nodeId:'doc:file1',version:1,size:5,name:'Plan.dwg',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockResolvedValue(meta);
  download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const worker=createAgentWorker({root:path.join(root,'conflict'),origin:'https://www.archioffice.fr',session:async()=>session(),status});
  await worker.keepOffline(meta.nodeId);const copy=await worker.prepareWorkingCopy(meta);await fs.writeFile(copy.file,'edited');
  transfer.open.mockRejectedValue(Object.assign(new Error('conflict'),{status:409,code:'VERSION_CONFLICT'}));
  await worker.uploadWorkingCopy(meta.nodeId);await worker.tick();
  expect(await worker.prepareWorkingCopy(meta)).toMatchObject({baseVersion:1,modified:true});
  expect(await fs.readFile(copy.file,'utf8')).toBe('edited');
  await expect(worker.uploadWorkingCopy(meta.nodeId)).rejects.toMatchObject({code:'WORKING_UPLOAD_CONFLICT'});
  session.mockResolvedValueOnce({userId:'user',tenantId:'tenant',deviceId:'device',token:'ds_at_secret'})
    .mockResolvedValueOnce({userId:'other',tenantId:'tenant',deviceId:'device',token:'ds_at_other'});
  await expect(worker.prepareWorkingCopy(meta)).rejects.toMatchObject({code:'DRIVE_IDENTITY_MISMATCH'});await worker.stop();
});

it('opens once online, reuses the editable copy offline after restart, and refuses an expired license',async()=>{
  const meta={nodeId:'doc:open',version:1,size:5,name:'Plan.pdf',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockReset().mockResolvedValue(meta);
  download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const config={root:path.join(root,'open'),origin:'https://www.archioffice.fr',session:async()=>session(),status};
  const first=createAgentWorker(config);const opened=await first.openWorkingCopy(meta.nodeId);
  expect(opened.identity).toEqual({userId:'user',tenantId:'tenant',deviceId:'device'});
  await fs.writeFile(opened.file,'my edits');await first.stop();
  download.metadata.mockRejectedValue(new Error('offline'));
  const second=createAgentWorker(config);expect((await second.openWorkingCopy(meta.nodeId)).file).toBe(opened.file);
  expect(download.metadata).toHaveBeenCalledTimes(1);expect(await fs.readFile(opened.file,'utf8')).toBe('my edits');
  session.mockRejectedValue(new Error('expired'));await expect(second.openWorkingCopy(meta.nodeId)).rejects.toThrow('expired');
  await second.stop();
});
it('does not return a working file when identity changes during the initial download',async()=>{
  const meta={nodeId:'doc:open',version:1,size:5,name:'Plan.pdf',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockResolvedValue(meta);
  download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  session.mockResolvedValueOnce({userId:'user',tenantId:'tenant',deviceId:'device',token:'ds_at_secret'})
    .mockResolvedValue({userId:'other',tenantId:'tenant',deviceId:'device',token:'ds_at_other'});
  const worker=createAgentWorker({root,origin:'https://www.archioffice.fr',session:async()=>session(),status});
  await expect(worker.openWorkingCopy(meta.nodeId)).rejects.toMatchObject({code:'DRIVE_IDENTITY_MISMATCH'});await worker.stop();
});
it('coalesces simultaneous upload requests for one working copy into one snapshot',async()=>{
  const meta={nodeId:'doc:dedup',version:1,size:5,name:'Plan.pdf',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockResolvedValue(meta);
  download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const worker=createAgentWorker({root,origin:'https://www.archioffice.fr',session:async()=>session(),status});
  const copy=await worker.openWorkingCopy(meta.nodeId);await fs.writeFile(copy.file,'edited');
  const [a,b]=await Promise.all([worker.uploadWorkingCopy(meta.nodeId),worker.uploadWorkingCopy(meta.nodeId)]);
  expect(a.jobId).toBe(b.jobId);await worker.stop();
});
