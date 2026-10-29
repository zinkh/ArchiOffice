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

it('reports the persisted upload state while the transfer is still running, without exposing native details',async()=>{
  const file=path.join(root,'PrivatePlan.dwg');await fs.writeFile(file,'hello');
  const worker=createAgentWorker({root:path.join(root,'statuses'),origin:'https://www.archioffice.fr',session:async()=>session(),status});
  expect((await worker.documentStatuses(['doc:one'])).documents).toEqual([{nodeId:'doc:one',state:'none'}]);
  await worker.enqueue(file,{documentId:'doc:one'},1);
  expect((await worker.documentStatuses(['doc:one'])).documents).toEqual([{nodeId:'doc:one',state:'queued'}]);
  let release!:()=>void;let started!:()=>void;
  const active=new Promise<void>(resolve=>{started=resolve;});
  transfer.chunk.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;started();}));
  transfer.complete.mockResolvedValue({node:{id:'doc:one'},version:2});
  const tick=worker.tick();await active;
  try {
    const snapshot=await Promise.race([worker.documentStatuses(['doc:one']),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('status waited behind network')),1000))]);
    expect(snapshot.documents).toEqual([{nodeId:'doc:one',state:'uploading'}]);
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|PrivatePlan|snapshot|sha256|\/tmp\//);
  } finally {release();await tick;}
  expect((await worker.documentStatuses(['doc:one'])).documents).toEqual([{nodeId:'doc:one',state:'uploaded',version:2}]);
  await worker.stop();
});
it('keeps restart states, prioritizes conflicts, and refuses invalid batches or an identity change',async()=>{
  const config={root:path.join(root,'persisted'),origin:'https://www.archioffice.fr',session:async()=>session(),status};
  const worker=createAgentWorker(config);const file=path.join(root,'Plan.dwg');await fs.writeFile(file,'hello');
  const job=await worker.enqueue(file,{documentId:'doc:one'},1);await worker.stop();
  const [scope]=await fs.readdir(config.root);const journal=path.join(config.root,scope,`${job.jobId}.json`);
  const record=JSON.parse(await fs.readFile(journal,'utf8'));const next=createAgentWorker(config);
  for(const state of ['retry','blocked','conflict']) {
    record.state=state;await fs.writeFile(journal,JSON.stringify(record));
    expect((await next.documentStatuses(['doc:one','doc:two'])).documents).toEqual([{nodeId:'doc:one',state},{nodeId:'doc:two',state:'none'}]);
  }
  // A later successful upload must not hide an unresolved conflict.
  const later={...record,id:'11111111-1111-1111-1111-111111111111',createdAt:record.createdAt+1,state:'done',result:{node:{id:'doc:one'},version:3}};
  await fs.writeFile(path.join(config.root,scope,`${later.id}.json`),JSON.stringify(later));
  expect((await next.documentStatuses(['doc:one'])).documents[0].state).toBe('conflict');
  for(const ids of [['../../private'],Array(101).fill('doc:one'),['doc:one','doc:one']])await expect(next.documentStatuses(ids)).rejects.toMatchObject({code:'INVALID_DOCUMENTS'});
  session.mockResolvedValueOnce({userId:'user',tenantId:'tenant',deviceId:'device',token:'ds_at_secret'})
    .mockResolvedValueOnce({userId:'other',tenantId:'tenant',deviceId:'device',token:'ds_at_other'});
  await expect(next.documentStatuses(['doc:one'])).rejects.toMatchObject({code:'DRIVE_IDENTITY_MISMATCH'});
  session.mockRejectedValue(new Error('expired'));await expect(next.documentStatuses(['doc:one'])).rejects.toThrow('expired');await next.stop();
});
it('preserves only the conflicting snapshot and keeps the original upload blocked after the copy succeeds',async()=>{
  const meta={nodeId:'doc:file1',version:1,size:5,name:'Plan.dwg',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockResolvedValue(meta);download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const worker=createAgentWorker({root:path.join(root,'preserve'),origin:'https://www.archioffice.fr',session:async()=>session(),status});
  await worker.keepOffline(meta.nodeId);const copy=await worker.prepareWorkingCopy(meta);await fs.writeFile(copy.file,'edits');
  transfer.open.mockRejectedValueOnce(Object.assign(new Error('conflict'),{status:409,code:'VERSION_CONFLICT'}));
  await worker.uploadWorkingCopy(meta.nodeId);await worker.tick();await fs.writeFile(copy.file,'later edits');
  await Promise.all([worker.preserveConflict(meta.nodeId),worker.preserveConflict(meta.nodeId)]);
  expect((await worker.documentStatuses([meta.nodeId])).documents[0]).toMatchObject({state:'conflict',preservation:'pending'});
  transfer.complete.mockResolvedValue({node:{id:'doc:copy'},version:1});await worker.tick();
  expect(transfer.open.mock.calls.at(-1)![0]).toMatchObject({target:{create:{parentId:'inbox:tenant',conflictOf:meta.nodeId}},baseVersion:null,size:5});
  expect((await worker.documentStatuses([meta.nodeId])).documents[0]).toMatchObject({state:'conflict',preservation:'done'});
  expect(await worker.preserveConflict(meta.nodeId)).toMatchObject({alreadyDone:true});
  await expect(worker.uploadWorkingCopy(meta.nodeId)).rejects.toMatchObject({code:'WORKING_UPLOAD_CONFLICT'});
  expect(await fs.readFile(copy.file,'utf8')).toBe('later edits');
  session.mockRejectedValue(new Error('expired'));await expect(worker.preserveConflict(meta.nodeId)).rejects.toThrow('expired');await worker.stop();
});
it('requires preservation then restarts from the remote version, replays a cross-journal crash and permits a new upload',async()=>{
  const meta={nodeId:'doc:file1',version:1,size:5,name:'Plan.dwg',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockResolvedValue(meta);download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const config={root:path.join(root,'reconcile'),origin:'https://www.archioffice.fr',session:async()=>session(),status};
  const worker=createAgentWorker(config);await worker.keepOffline(meta.nodeId);const old=await worker.prepareWorkingCopy(meta);await fs.writeFile(old.file,'edits');
  transfer.open.mockRejectedValueOnce(Object.assign(new Error('conflict'),{status:409,code:'VERSION_CONFLICT'}));
  await worker.uploadWorkingCopy(meta.nodeId);await worker.tick();
  await expect(worker.restartWorkingCopy(meta.nodeId)).rejects.toMatchObject({code:'CONFLICT_PRESERVATION_REQUIRED'});
  await worker.preserveConflict(meta.nodeId);transfer.complete.mockResolvedValue({node:{id:'doc:copy'},version:1});await worker.tick();
  await fs.writeFile(old.file,'later local edits');
  const remote={...meta,version:2};download.metadata.mockResolvedValue(remote);
  expect(await worker.restartWorkingCopy(meta.nodeId)).toEqual({version:2});
  expect((await worker.documentStatuses([meta.nodeId])).documents[0]).toEqual({nodeId:meta.nodeId,state:'reconciled',version:2});
  const opened=await worker.openWorkingCopy(meta.nodeId);expect(opened.file).not.toBe(old.file);
  expect(await fs.readFile(old.file,'utf8')).toBe('later local edits');await worker.stop();
  // Simulate the durable working pointer but an uncommitted queue marker.
  const [scope]=await fs.readdir(config.root);const folder=path.join(config.root,scope);
  const journals=(await fs.readdir(folder)).filter(n=>n.endsWith('.json'));
  for(const name of journals){const file=path.join(folder,name);const j=JSON.parse(await fs.readFile(file,'utf8'));if(j.state==='conflict'){delete j.reconciledVersion;await fs.writeFile(file,JSON.stringify(j));}}
  const restarted=createAgentWorker(config);expect(await restarted.restartWorkingCopy(meta.nodeId)).toEqual({version:2});
  expect((await restarted.openWorkingCopy(meta.nodeId)).file).toBe(opened.file);
  await fs.writeFile(opened.file,'newer');await restarted.uploadWorkingCopy(meta.nodeId);transfer.complete.mockResolvedValue({node:{id:meta.nodeId},version:3});await restarted.tick();
  expect(transfer.open.mock.calls.at(-1)![0]).toMatchObject({target:{documentId:meta.nodeId},baseVersion:2});
  expect((await restarted.documentStatuses([meta.nodeId])).documents[0]).toMatchObject({state:'uploaded',version:3});
  expect(await fs.readFile(old.file,'utf8')).toBe('later local edits');await restarted.stop();
});
it('checks versions without downloading, refreshes an unmodified copy explicitly and preserves its old path',async()=>{
  const meta={nodeId:'doc:file1',version:1,size:5,name:'Plan.dwg',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockResolvedValue(meta);download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const worker=createAgentWorker({root:path.join(root,'fresh'),origin:'https://www.archioffice.fr',session:async()=>session(),status});
  expect(await worker.checkRemoteVersion(meta.nodeId)).toEqual({status:'missing'});
  await worker.keepOffline(meta.nodeId);const original=await worker.openWorkingCopy(meta.nodeId);download.read.mockClear();
  expect(await worker.checkRemoteVersion(meta.nodeId)).toEqual({status:'current',localVersion:1,remoteVersion:1});
  download.metadata.mockResolvedValue({...meta,version:2});
  expect(await worker.checkRemoteVersion(meta.nodeId)).toEqual({status:'remote_newer',localVersion:1,remoteVersion:2});
  expect(download.read).not.toHaveBeenCalled();
  expect(await worker.checkRemoteVersion(meta.nodeId,true)).toEqual({status:'refreshed',localVersion:2,remoteVersion:2});
  const current=await worker.openWorkingCopy(meta.nodeId);expect(current.file).not.toBe(original.file);
  expect(await fs.readFile(original.file,'utf8')).toBe('hello');
  expect(await worker.checkRemoteVersion(meta.nodeId,true)).toMatchObject({status:'current',localVersion:2});
  download.metadata.mockResolvedValue(meta);expect(await worker.checkRemoteVersion(meta.nodeId,true)).toMatchObject({status:'local_newer',localVersion:2,remoteVersion:1});
  download.metadata.mockResolvedValue({...meta,version:2});
  await fs.writeFile(current.file,'edits');transfer.complete.mockResolvedValue({node:{id:meta.nodeId},version:3});
  await worker.uploadWorkingCopy(meta.nodeId);await worker.tick();
  expect(transfer.open.mock.calls.at(-1)![0]).toMatchObject({baseVersion:2});await worker.stop();
});
it('refuses refresh for local edits, pending uploads, changed identities and mutated remote versions',async()=>{
  const meta={nodeId:'doc:file1',version:1,size:5,name:'Plan.dwg',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockResolvedValue(meta);download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const worker=createAgentWorker({root:path.join(root,'guards'),origin:'https://www.archioffice.fr',session:async()=>session(),status});
  await worker.keepOffline(meta.nodeId);const old=await worker.openWorkingCopy(meta.nodeId);
  download.metadata.mockResolvedValue({...meta,sha256:'f'.repeat(64)});
  await expect(worker.checkRemoteVersion(meta.nodeId)).rejects.toMatchObject({code:'REMOTE_VERSION_MUTATED'});
  download.metadata.mockResolvedValue({...meta,version:2});await fs.writeFile(old.file,'edits');
  expect(await worker.checkRemoteVersion(meta.nodeId,true)).toMatchObject({status:'modified'});
  expect((await worker.openWorkingCopy(meta.nodeId)).file).toBe(old.file);
  await worker.uploadWorkingCopy(meta.nodeId);
  expect(await worker.checkRemoteVersion(meta.nodeId,true)).toEqual({status:'busy'});
  session.mockRejectedValue(new Error('expired'));await expect(worker.checkRemoteVersion(meta.nodeId,true)).rejects.toThrow('expired');await worker.stop();
});
it('keeps the active copy when the document queue changes during remote download',async()=>{
  const meta={nodeId:'doc:file1',version:1,size:5,name:'Plan.dwg',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.metadata.mockResolvedValue(meta);download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const worker=createAgentWorker({root:path.join(root,'queue-change'),origin:'https://www.archioffice.fr',session:async()=>session(),status});
  await worker.keepOffline(meta.nodeId);const old=await worker.openWorkingCopy(meta.nodeId);download.metadata.mockResolvedValue({...meta,version:2});
  download.read.mockImplementationOnce(async()=>{
    await worker.enqueue(old.file,{documentId:meta.nodeId},1);
    return {start:0,body:(async function*(){yield Buffer.from('hello');})()};
  });
  await expect(worker.checkRemoteVersion(meta.nodeId,true)).rejects.toMatchObject({code:'WORKING_REFRESH_BUSY'});
  expect((await worker.openWorkingCopy(meta.nodeId)).file).toBe(old.file);expect(await fs.readFile(old.file,'utf8')).toBe('hello');await worker.stop();
});
it('hydrates an explicitly bound Windows catalog version and refuses another device or an expired grant',async()=>{
  const meta={nodeId:'doc:file1',version:1,size:5,name:'Plan.pdf',sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
  download.read.mockImplementation(async()=>({start:0,body:(async function*(){yield Buffer.from('hello');})()}));
  const worker=createAgentWorker({root:path.join(root,'windows'),origin:'https://www.archioffice.fr',session:async()=>session(),status});
  const identity={userId:'user',tenantId:'tenant',deviceId:'device'};
  await expect(worker.windowsPreview('hydrate',{meta,identity:{...identity,deviceId:'other'}})).rejects.toThrow('Identity changed');
  const result=await worker.windowsPreview('hydrate',{meta,identity});expect('file' in result).toBe(true);
  if(typeof result.file==='string')expect(await fs.readFile(result.file,'utf8')).toBe('hello');
  download.read.mockClear();await worker.windowsPreview('hydrate',{meta,identity});expect(download.read).not.toHaveBeenCalled();
  session.mockRejectedValue(new Error('expired'));await expect(worker.windowsPreview('hydrate',{meta,identity})).rejects.toThrow('expired');await worker.stop();
});
