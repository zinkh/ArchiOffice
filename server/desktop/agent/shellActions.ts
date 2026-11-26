import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {MAX_CATALOG_BYTES} from './catalogBudget';
import type {TransferQueue,TransferJob} from './transferQueue';
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(code:string)=>Object.assign(new Error(code),{code});
export async function windowsConflictTarget(root:string,identity:any,input:any){
 if(!input?.identity||['userId','tenantId','deviceId'].some(k=>input.identity[k]!==identity[k])||!/^[-a-zA-Z0-9_]{1,200}$/.test(input.projectId)||!/^[a-f0-9]{64}$/.test(input.rootKey)||!/^[a-f0-9]{64}$/.test(input.key))throw fail('WINDOWS_EDIT_REFUSED');
 const noLinks=async(file:string)=>{let current=root;for(const part of ['',...path.relative(root,file).split(path.sep).filter(Boolean)]){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())throw fail('WINDOWS_EDIT_REFUSED');}};
 const manifest=path.join(root,hash([identity.userId,identity.tenantId,identity.deviceId,input.projectId])+'.json');
 await noLinks(manifest);if((await fs.stat(manifest)).size>MAX_CATALOG_BYTES)throw fail('WINDOWS_EDIT_REFUSED');
 const saved=JSON.parse(await fs.readFile(manifest,'utf8'));
 if(['userId','tenantId','deviceId'].some(k=>saved.identity?.[k]!==identity[k])||saved.projectId!==input.projectId||saved.rootKey!==input.rootKey||!saved.nativeReady||!saved.editable||!Array.isArray(saved.catalog)||typeof saved.directory!=='string'||path.dirname(saved.directory)!==path.resolve(root)||hash([identity.userId,identity.tenantId,identity.deviceId,input.projectId,saved.catalog])!==input.rootKey)throw fail('WINDOWS_EDIT_REFUSED');
 const matches=saved.catalog.filter((e:any)=>!e.folder&&e.key===input.key);if(matches.length!==1)throw fail('WINDOWS_EDIT_REFUSED');const entry=matches[0];
 if(typeof entry.path!=='string'||entry.path.length>300||entry.path.split('\\').some((p:string)=>!p||p==='.'||p==='..'||/[<>:"/|?*\x00-\x1f]/.test(p))||!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(entry.meta?.nodeId))throw fail('WINDOWS_EDIT_REFUSED');
 const file=path.join(saved.directory,...entry.path.split('\\'));await noLinks(file);return {file,nodeId:entry.meta.nodeId,sourceId:hash(['windows',input.rootKey,input.key])};
}
export async function conflictFor(queue:TransferQueue,nodeId:string,sourceId:string){
 const jobs=await queue.list();const source=jobs.find(j=>j.sourceId===sourceId&&'documentId' in j.target&&j.target.documentId===nodeId&&j.state==='conflict'&&j.reconciledVersion===undefined)||jobs.find(j=>j.sourceId===sourceId&&'documentId' in j.target&&j.target.documentId===nodeId&&j.state==='conflict');
 if(!source)throw fail('CONFLICT_REQUIRED');return {source,jobs};
}
export async function proveWindowsConflict(root:string,identity:any,input:any,queue:TransferQueue){
 const target=await windowsConflictTarget(root,identity,input);const {source,jobs}=await conflictFor(queue,target.nodeId,target.sourceId);
 if(!jobs.some(j=>j.conflictSourceId===source.id&&j.sha256===source.sha256&&j.state==='done'))throw fail('CONFLICT_PRESERVATION_REQUIRED');
 const actual=await windowsFileDigest(target.file);
 if(actual.sha256!==source.sha256&&!jobs.some(j=>j.sourceId===hash(['preservation',source.id,actual.sha256])&&j.state==='done'))throw fail('SOURCE_CHANGED');
 return {key:input.key,conflictId:source.id,nodeId:target.nodeId,sha256:actual.sha256};
}
export function publicTransferError(job:TransferJob){return typeof job.errorCode==='string'&&/^[A-Z_]{1,64}$/.test(job.errorCode)?job.errorCode:null;}

export async function windowsFileDigest(file:string){
 const fd=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{
  const before=await fd.stat();if(!before.isFile()||before.size>50*1024*1024)throw fail('SOURCE_CHANGED');const digest=crypto.createHash('sha256');let size=0;
  for await(const chunk of fd.createReadStream({autoClose:false})){size+=chunk.length;if(size>50*1024*1024)throw fail('SOURCE_CHANGED');digest.update(chunk);}
  const after=await fd.stat();if(size!==before.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw fail('SOURCE_CHANGED');return {sha256:digest.digest('hex'),size};
 }finally{await fd.close();}
}
export async function preserveWindowsConflict(root:string,identity:any,input:any,queue:TransferQueue,authorize:()=>Promise<unknown>){
 const target=await windowsConflictTarget(root,identity,input);const {source}=await conflictFor(queue,target.nodeId,target.sourceId);await authorize();
 const original=await queue.preserveConflict(source.id);if(original.state==='blocked'||original.state==='retry')await queue.retry(original.id);
 const actual=await windowsFileDigest(target.file);
 if(actual.sha256!==source.sha256){const recheck=async()=>{await authorize();await windowsConflictTarget(root,identity,input);};
  const ext=path.extname(source.name),name=path.basename(source.name,ext).slice(0,Math.max(1,255-ext.length-24))+' (copie locale récente)'+ext;
  const latest=await queue.enqueue(target.file,{create:{parentId:'inbox:'+identity.tenantId,conflictOf:target.nodeId}},null,source.mimeType,{sourceId:hash(['preservation',source.id,actual.sha256]),sha256:actual.sha256,name,conflictSourceId:source.id,authorize:recheck});
  if(latest.state==='blocked'||latest.state==='retry')await queue.retry(latest.id);
 }await authorize();
}
