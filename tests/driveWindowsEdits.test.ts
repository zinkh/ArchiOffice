import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { queueWindowsEdit } from '../server/desktop/agent/windowsEdits';
import { TransferQueue,type UploadTransport } from '../server/desktop/agent/transferQueue';
import { WorkingCopies } from '../server/desktop/agent/workingCopies';
import { createAgentWorker } from '../server/desktop/agent/worker';
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sha=(v:string)=>crypto.createHash('sha256').update(v).digest('hex');
const identity={userId:'u',tenantId:'t',deviceId:'d'};
let temp:string,root:string,file:string,manifest:string,saved:any,input:any,queue:TransferQueue;
let authorize:ReturnType<typeof vi.fn<()=>Promise<void>>>,cached:ReturnType<typeof vi.fn<()=>Promise<{sha256:string}|null>>>;
async function persist(){saved.rootKey=hash(['u','t','d','p',saved.catalog]);input.rootKey=saved.rootKey;await fs.writeFile(manifest,JSON.stringify(saved));}
const run=()=>queueWindowsEdit({root,identity,input,queue,authorize,cached});
const transport=(version:number):UploadTransport=>({
  open:async()=>({uploadId:'up_'+'a'.repeat(24),chunkSize:1024}),
  status:async()=>({size:6,received:[],completed:false}),chunk:async()=>{},
  complete:async()=>({node:{id:'doc:plan'},version}),
});
beforeEach(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'windows-edits-'));root=path.join(temp,'drive-windows-preview');
  const directory=path.join(root,hash(['u','t']).slice(0,12)+'-generation');await fs.mkdir(path.join(directory,'_Projet'),{recursive:true});
  file=path.join(directory,'_Projet','_Plan.dwg');await fs.writeFile(file,'edited');
  manifest=path.join(root,hash(['u','t','d','p'])+'.json');
  saved={identity,projectId:'p',directory,nativeReady:true,catalog:[{path:'_Projet\\_Plan.dwg',key:'a'.repeat(64),folder:false,size:5,
    meta:{nodeId:'doc:plan',version:1,name:'Plan original.dwg',size:5,sha256:sha('hello')}}]};
  input={identity,projectId:'p',rootKey:'',key:'a'.repeat(64)};await persist();
  queue=new TransferQueue(path.join(temp,'queue'),identity);authorize=vi.fn(async()=>{});cached=vi.fn<()=>Promise<{sha256:string}|null>>(async()=>null);
});
afterEach(async()=>{await fs.rm(temp,{recursive:true,force:true});});
it('captures catalogue-bound bytes, original name and version; retains newer saves',async()=>{
  const result=await run();expect(result.queued).toBe(true);const job=(await queue.list())[0];
  expect(job).toMatchObject({baseVersion:1,name:'Plan original.dwg',sha256:sha('edited'),target:{documentId:'doc:plan'}});
  expect(job.sourceId).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(job)).not.toContain(saved.directory);
  await fs.writeFile(file,'later!');expect(await fs.readFile(path.join(temp,'queue',job.id+'.snapshot'),'utf8')).toBe('edited');
  expect(await run()).toMatchObject({queued:true,pending:true,jobId:job.id});expect(await queue.list()).toHaveLength(1);
});
it('replays only this generation acknowledgements after restart and advances the next base',async()=>{
  await run();expect(await queue.runNext(transport(2))).toMatchObject({state:'done'});
  queue=new TransferQueue(path.join(temp,'queue'),identity);expect(await run()).toEqual({queued:false});
  await fs.writeFile(file,'later!');await run();expect((await queue.list())[1]).toMatchObject({baseVersion:2,sha256:sha('later!')});
});
it('never advances the separate Documents baseline for a native upload',async()=>{
  const source=path.join(temp,'hello.cache');await fs.writeFile(source,'hello');
  const copies=new WorkingCopies(path.join(temp,'working'),identity);await copies.prepare(saved.catalog[0].meta,{file:source,sha256:sha('hello')});
  await run();const job=await queue.runNext(transport(2));await copies.acknowledge(job!);
  expect(await copies.inspect('doc:plan')).toMatchObject({baseVersion:1,modified:false});
});
it('retains a version conflict and refuses another capture without replacing local bytes',async()=>{
  await run();const t=transport(2);t.open=async()=>{throw Object.assign(new Error(),{status:409,code:'VERSION_CONFLICT'});};
  expect(await queue.runNext(t)).toMatchObject({state:'conflict'});await fs.writeFile(file,'later!');
  await expect(run()).rejects.toMatchObject({code:'WORKING_UPLOAD_CONFLICT'});expect(await fs.readFile(file,'utf8')).toBe('later!');
  const job=(await queue.list())[0];expect(await fs.readFile(path.join(temp,'queue',job.id+'.snapshot'),'utf8')).toBe('edited');
});
it('does not pretend a pending Documents upload contains the native save',async()=>{
  await queue.enqueue(file,{documentId:'doc:plan'},1);await expect(run()).rejects.toMatchObject({code:'WINDOWS_EDIT_BUSY'});
});
it.each(['identity','key','rootKey','projectId'])('refuses a foreign or stale %s',async field=>{
  input[field]=field==='identity'?{...identity,tenantId:'other'}:'wrong';await expect(run()).rejects.toThrow();expect(await queue.list()).toHaveLength(0);
});
it('refuses changed metadata without its generation hash and foreign project roots',async()=>{
  saved.catalog[0].meta.version=99;await fs.writeFile(manifest,JSON.stringify(saved));await expect(run()).rejects.toThrow();
  saved.directory=temp;await persist();await expect(run()).rejects.toThrow();expect(await queue.list()).toHaveLength(0);
});
it('refuses symlinked files and manifests',async()=>{
  const outside=path.join(temp,'outside');await fs.writeFile(outside,'edited');await fs.unlink(file);await fs.symlink(outside,file);
  await expect(run()).rejects.toThrow();await fs.unlink(file);await fs.writeFile(file,'edited');
  const copy=manifest+'.copy';await fs.rename(manifest,copy);await fs.symlink(copy,manifest);await expect(run()).rejects.toThrow();
  expect(await queue.list()).toHaveLength(0);
});
it('requires a verified cached baseline when the server omitted the digest',async()=>{
  saved.catalog[0].meta.sha256=null;await persist();await expect(run()).rejects.toMatchObject({code:'WINDOWS_EDIT_BASELINE_REQUIRED'});
  cached.mockResolvedValue({sha256:sha('hello')});await fs.writeFile(file,'hello');expect(await run()).toEqual({queued:false});
  await fs.writeFile(file,'edited');expect(await run()).toMatchObject({queued:true});
});
it('rechecks the grant before publication, cleans the snapshot on refusal and keeps the source',async()=>{
  authorize.mockImplementation(async()=>{if(authorize.mock.calls.length===3)throw new Error('revoked');});
  await expect(run()).rejects.toThrow('revoked');expect(await queue.list()).toHaveLength(0);
  expect((await fs.readdir(path.join(temp,'queue'))).filter(n=>n.endsWith('.snapshot'))).toEqual([]);
  expect(await fs.readFile(file,'utf8')).toBe('edited');
});
it('rejects capture if the catalogue is refreshed during preparation',async()=>{
  authorize.mockImplementation(async()=>{if(authorize.mock.calls.length===3){saved.catalog[0].meta.version++;await persist();}});
  await expect(run()).rejects.toThrow();expect(await queue.list()).toHaveLength(0);
});
it('rejects bytes changed between inspection and snapshot',async()=>{
  const original=queue.enqueue.bind(queue);vi.spyOn(queue,'enqueue').mockImplementation(async(...args)=>{await fs.writeFile(file,'racing');return original(...args);});
  await expect(run()).rejects.toMatchObject({code:'SOURCE_CHANGED'});expect(await queue.list()).toHaveLength(0);
});
it('routes the private worker command with no arbitrary source path and refuses after stop',async()=>{
  const worker=createAgentWorker({root:path.join(temp,'drive-transfers'),origin:'https://www.archioffice.fr',session:async()=>({...identity,token:'ds_at_test'}),status:()=>{}});
  expect(await worker.uploadWindowsEdit(input)).toMatchObject({queued:true});await worker.stop();
  await expect(worker.uploadWindowsEdit(input)).rejects.toThrow('Agent stopped');
});

it('refuses a grant change while the worker prepares a native save',async()=>{
  let calls=0;const worker=createAgentWorker({root:path.join(temp,'drive-transfers'),origin:'https://www.archioffice.fr',session:async()=>({...identity,tenantId:++calls>2?'other':'t',token:'ds_at_test'}),status:()=>{}});
  await expect(worker.uploadWindowsEdit(input)).rejects.toMatchObject({code:'DRIVE_IDENTITY_MISMATCH'});
  await worker.stop();expect(await fs.readFile(file,'utf8')).toBe('edited');
});
