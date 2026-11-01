import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { TransferQueue } from './transferQueue';
import type { DownloadMetadata } from './downloadTransport';

interface Identity { userId:string; tenantId:string; deviceId:string }
export interface WindowsEditInput { identity:Identity; projectId:string; rootKey:string; key:string }
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(code:string)=>Object.assign(new Error(code),{code,status:400});
const same=(a:Identity,b:Identity)=>a&&b&&['userId','tenantId','deviceId'].every(k=>typeof a[k as keyof Identity]==='string'&&a[k as keyof Identity]===b[k as keyof Identity]);
async function noLinks(root:string,file:string) {
  const relative=path.relative(root,file);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw fail('WINDOWS_EDIT_REFUSED');
  let current=root;
  for(const segment of ['',...relative.split(path.sep).filter(Boolean)]) {
    current=path.join(current,segment);
    if((await fs.lstat(current)).isSymbolicLink())throw fail('WINDOWS_EDIT_REFUSED');
  }
}
async function digest(file:string) {
  const fd=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try {
    const before=await fd.stat();
    if(!before.isFile()||before.size>50*1024*1024)throw fail('WINDOWS_EDIT_REFUSED');
    const hash=crypto.createHash('sha256');let size=0;
    for await(const bytes of fd.createReadStream({autoClose:false})) {
      size+=bytes.length;if(size>50*1024*1024)throw fail('WINDOWS_EDIT_REFUSED');hash.update(bytes);
    }
    const after=await fd.stat();
    if(before.size!==after.size||size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw fail('SOURCE_CHANGED');
    return hash.digest('hex');
  }finally {await fd.close();}
}
/** Private worker adapter, serialized with Documents uploads by its caller.
 * Input contains identifiers only. The current persisted catalogue supplies the
 * path and original version; neither renderer nor native helper supplies them.
 * This does not enable writes or watch the CFAPI tree. */
export async function queueWindowsEdit(options:{
  root:string; identity:Identity; input:WindowsEditInput; queue:TransferQueue;
  authorize():Promise<unknown>;
  cached(meta:DownloadMetadata):Promise<{sha256:string}|null>;
}) {
  const {identity,queue,authorize,cached}=options;const input=structuredClone(options.input);const root=path.resolve(options.root);
  if(!input||!same(input.identity,identity)||typeof input.projectId!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(input.projectId)
    ||!/^[a-f0-9]{64}$/.test(input.rootKey)||!/^[a-f0-9]{64}$/.test(input.key))throw fail('WINDOWS_EDIT_REFUSED');
  const manifest=path.join(root,hash([identity.userId,identity.tenantId,identity.deviceId,input.projectId])+'.json');
  const read=async()=>{
    await noLinks(root,manifest);const stat=await fs.lstat(manifest);
    if(!stat.isFile()||stat.size>512*1024)throw fail('WINDOWS_EDIT_REFUSED');
    const saved=JSON.parse(await fs.readFile(manifest,'utf8'));
    if(!same(saved?.identity,identity)||saved.projectId!==input.projectId||saved.rootKey!==input.rootKey||saved.nativeReady!==true
      ||!Array.isArray(saved.catalog)||saved.catalog.length>256||typeof saved.directory!=='string'||path.dirname(saved.directory)!==root
      ||!path.basename(saved.directory).startsWith(hash([identity.userId,identity.tenantId]).slice(0,12)+'-')
      ||hash([identity.userId,identity.tenantId,identity.deviceId,input.projectId,saved.catalog])!==input.rootKey)throw fail('WINDOWS_EDIT_REFUSED');
    return saved;
  };
  await authorize();const saved=await read();
  const matches=saved.catalog.filter((e:any)=>e.key===input.key&&!e.folder);
  if(matches.length!==1)throw fail('WINDOWS_EDIT_REFUSED');const entry=matches[0];const meta:DownloadMetadata=entry.meta;
  if(typeof entry.path!=='string'||entry.path.length>300||!/^_[^<>:"/|?*\x00-\x1f]+$/.test(entry.path)
    ||entry.path.split('\\').some((p:string)=>!p||p==='.'||p==='..'||/[. ]$/.test(p))
    ||!meta||typeof meta.name!=='string'||!meta.name||meta.name.length>512||!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(meta.nodeId)||!Number.isSafeInteger(meta.version)||meta.version<1
    ||!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>50*1024*1024||meta.size!==entry.size
    ||(meta.sha256!==null&&!/^[a-f0-9]{64}$/.test(meta.sha256)))throw fail('WINDOWS_EDIT_REFUSED');
  const file=path.join(saved.directory,...entry.path.split('\\'));await noLinks(root,file);
  const sourceId=hash(['windows',input.rootKey,input.key]);
  const jobs=await queue.list();const relevant=jobs.filter(j=>'documentId' in j.target&&j.target.documentId===meta.nodeId);
  if(relevant.some(j=>j.state==='conflict'&&j.reconciledVersion===undefined))throw fail('WORKING_UPLOAD_CONFLICT');
  const pending=relevant.find(j=>j.state!=='done'&&j.reconciledVersion===undefined);
  if(pending) {if(pending.sourceId!==sourceId)throw fail('WINDOWS_EDIT_BUSY');await authorize();await read();return {queued:true,pending:true,jobId:pending.id};}
  let version=meta.version;let baseline=meta.sha256;
  for(const job of relevant.filter(j=>j.sourceId===sourceId&&j.state==='done')) {
    if(job.baseVersion!==version||job.result?.node.id!==meta.nodeId||!Number.isSafeInteger(job.result.version)||job.result.version<=version)throw fail('WINDOWS_EDIT_HISTORY_INVALID');
    version=job.result.version;baseline=job.sha256;
  }
  if(!baseline)baseline=(await cached(meta))?.sha256||null;
  if(!baseline||!/^[a-f0-9]{64}$/.test(baseline))throw fail('WINDOWS_EDIT_BASELINE_REQUIRED');
  const sha256=await digest(file);
  const recheck=async()=>{
    await authorize();const latest=await read();
    if(latest.directory!==saved.directory)throw fail('WINDOWS_EDIT_REFUSED');
    await noLinks(root,file);
  };
  await recheck();if(sha256===baseline)return {queued:false};
  const job=await queue.enqueue(file,{documentId:meta.nodeId},version,'application/octet-stream',{sourceId,sha256,name:meta.name,authorize:recheck});
  return {queued:true,jobId:job.id};
}
