import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {beforeEach,afterEach,it,expect} from 'vitest';
import {TransferQueue} from '../server/desktop/agent/transferQueue';import {proveWindowsConflict,windowsConflictTarget,preserveWindowsConflict} from '../server/desktop/agent/shellActions';
const hash=(x:unknown)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');const identity={userId:'u',tenantId:'t',deviceId:'d'};
let root:string,queue:TransferQueue,input:any,file:string,conflictId:string;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'drive-conflict-'));const directory=path.join(root,hash(['u','t']).slice(0,12)+'-project');await fs.mkdir(directory);file=path.join(directory,'_Plan.pdf');await fs.writeFile(file,'local-edit');
 const catalog=[{path:'_Plan.pdf',key:'a'.repeat(64),folder:false,size:3,meta:{nodeId:'doc:d',name:'Plan.pdf',version:1,size:3,sha256:null}}];const rootKey=hash(['u','t','d','p',catalog]);input={identity,projectId:'p',rootKey,key:'a'.repeat(64)};
 await fs.writeFile(path.join(root,hash(['u','t','d','p'])+'.json'),JSON.stringify({identity,projectId:'p',rootKey,directory,catalog,nativeReady:true,editable:true}));
 queue=new TransferQueue(path.join(root,'queue'),identity);const source=await queue.enqueue(file,{documentId:'doc:d'},1,'application/pdf',{sourceId:hash(['windows',rootKey,input.key]),sha256:crypto.createHash('sha256').update('local-edit').digest('hex'),name:'Plan.pdf',authorize:async()=>{}});conflictId=source.id;
 await queue.runNext({open:async()=>{throw Object.assign(new Error('conflict'),{status:409,code:'VERSION_CONFLICT'});}} as any);
});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
async function preserve(){await queue.preserveConflict(conflictId);await queue.runNext({open:async()=>({uploadId:'up_'+'a'.repeat(24),chunkSize:1024}),status:async()=>({size:10,received:[],completed:false}),chunk:async()=>{},complete:async()=>({node:{id:'doc:copy'},version:1})});}
it('requires a completed preserved upload before it grants a native generation switch',async()=>{await expect(proveWindowsConflict(root,identity,input,queue)).rejects.toMatchObject({code:'CONFLICT_PRESERVATION_REQUIRED'});await preserve();expect(await proveWindowsConflict(root,identity,input,queue)).toMatchObject({conflictId,nodeId:'doc:d',key:input.key});expect(await fs.readFile(file,'utf8')).toBe('local-edit');});
it('refuses newer local edits after preservation, without touching either copy',async()=>{await preserve();await fs.writeFile(file,'later-edit');await expect(proveWindowsConflict(root,identity,input,queue)).rejects.toMatchObject({code:'SOURCE_CHANGED'});expect(await fs.readFile(file,'utf8')).toBe('later-edit');expect((await queue.list()).find(j=>j.conflictSourceId===conflictId)?.state).toBe('done');});
it('refuses foreign identity, generation, key, and redirected local paths',async()=>{for(const change of [{identity:{...identity,tenantId:'foreign'}},{rootKey:'f'.repeat(64)},{key:'b'.repeat(64)}])await expect(windowsConflictTarget(root,identity,{...input,...change})).rejects.toThrow();await fs.unlink(file);await fs.symlink(path.join(root,'outside'),file);await expect(windowsConflictTarget(root,identity,input)).rejects.toThrow();});

it('captures and uploads a later local edit before allowing the remote generation switch',async()=>{
 await preserve();await fs.writeFile(file,'later-edit');await preserveWindowsConflict(root,identity,input,queue,async()=>{});
 await expect(proveWindowsConflict(root,identity,input,queue)).rejects.toMatchObject({code:'SOURCE_CHANGED'});
 await queue.runNext({open:async()=>({uploadId:'up_'+'b'.repeat(24),chunkSize:1024}),status:async()=>({size:10,received:[],completed:false}),chunk:async()=>{},complete:async()=>({node:{id:'doc:latest-copy'},version:1})});
 const proof=await proveWindowsConflict(root,identity,input,queue);expect(proof.sha256).toBe(crypto.createHash('sha256').update('later-edit').digest('hex'));expect(await fs.readFile(file,'utf8')).toBe('later-edit');
});
