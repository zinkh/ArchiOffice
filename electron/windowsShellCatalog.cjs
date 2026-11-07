'use strict';
const fs=require('fs/promises');const path=require('path');const crypto=require('crypto');
const {noLinks,catalogDetails}=require('./windowsDrive.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a,b)=>a&&b&&['userId','tenantId','deviceId'].every(k=>typeof a[k]==='string'&&a[k]===b[k]);
const clean=(s,max=512)=>s===null||(typeof s==='string'&&s.length<=max&&!/[\x00-\x1f\x7f]/.test(s));
const fail=()=>Object.assign(new Error('Shell catalog refused'),{code:'WINDOWS_SHELL_METADATA_REFUSED'});
const states=new Set(['none','queued','uploading','retry','blocked','conflict','uploaded','reconciled']);
function validateBusiness(result,identity,projectId,nodeIds) {
 if(!same(result?.identity,identity)||result.projectId!==projectId||!clean(result.name)||typeof result.name!=='string'
   ||!Array.isArray(result.documents)||result.documents.length!==nodeIds.length)throw fail();
 const wanted=new Set(nodeIds);const documents=[];
 for(const d of result.documents) {
  if(!wanted.delete(d?.nodeId)||d.projectId!==projectId||!clean(d.name)||typeof d.name!=='string'||!Number.isSafeInteger(d.remoteVersion)||d.remoteVersion<1
   ||!['phase','documentType','indice','status','readOnlyReason'].every(k=>clean(d[k],200))||d.permissions?.read!==true
   ||typeof d.permissions.write!=='boolean'||typeof d.permissions.delete!=='boolean')throw fail();
  documents.push({nodeId:d.nodeId,name:d.name,projectId,phase:d.phase,documentType:d.documentType,indice:d.indice,status:d.status,
   remoteVersion:d.remoteVersion,permissions:{read:true,write:d.permissions.write,delete:d.permissions.delete},readOnlyReason:d.readOnlyReason});
 }
 return {projectId,name:result.name,documents};
}
/** Optional read-only projection. Never alters a CFAPI manifest or a work file.
 * The short display lease is renewed only while the mounted account is valid. */
function createWindowsShellCatalog({drive,agent,vault,namespaceRoot,cacheRoot,now=Date.now}) {
 let stopped=false,busy=false,timer=null,lastFile=null;const memory=new Map(),pending=new Map();
 async function atomic(file,value,root) {
  await fs.mkdir(root,{recursive:true,mode:0o700});await noLinks(root,root);
  try{await noLinks(root,file);}catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try{const json=JSON.stringify(value);if(Buffer.byteLength(json)>8*1024*1024)throw fail();await fs.writeFile(temporary,json,{flag:'wx',mode:0o600});await fs.rename(temporary,file);}
  finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
 }
 async function clear() {
  const file=lastFile;lastFile=null;
  if(file){try{await noLinks(namespaceRoot,file);await fs.unlink(file);}catch{}}
 }
 async function cached(identity,projectId,nodeIds) {
  const key=hash([identity.userId,identity.tenantId,identity.deviceId,projectId,nodeIds]);
  if(memory.has(key))return {key,...memory.get(key)};
  let item={data:null,observedAt:0,attemptedAt:0};
  const file=path.join(cacheRoot,key+'.json');
  try {
   await noLinks(cacheRoot,file);const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>1024*1024)throw fail();
   const saved=JSON.parse(await fs.readFile(file,'utf8'));
   if(!Number.isSafeInteger(saved.observedAt)||saved.observedAt>now()||saved.observedAt<1)throw fail();
   const data=validateBusiness(saved,identity,projectId,nodeIds);item={data,observedAt:saved.observedAt,attemptedAt:0};
  }catch{}
  memory.set(key,item);return {key,...item};
 }
 function refresh(identity,projectId,nodeIds,key) {
  if(pending.has(key)||stopped)return;
  const item=memory.get(key);if(item&&now()-item.attemptedAt<60000)return;
  if(item)item.attemptedAt=now();
  const task=(async()=>{
   try {
    const response=await agent.windowsPreview('shellMetadata',{identity,projectId,nodeIds});
    if(stopped||!same(await vault(),identity))return;
    const data=validateBusiness(response,identity,projectId,nodeIds);const observedAt=now();
    await atomic(path.join(cacheRoot,key+'.json'),{...data,identity:{userId:identity.userId,tenantId:identity.tenantId,deviceId:identity.deviceId},observedAt},cacheRoot);
    memory.set(key,{data,observedAt,attemptedAt:observedAt});
   }catch(error){
    // Known denial or malformed metadata invalidates the prior business cache.
    // Transient network failure keeps an explicitly dated stale observation.
    if([401,402,403,404].includes(error.status)||error.code==='WINDOWS_SHELL_METADATA_REFUSED') {
     memory.set(key,{data:null,observedAt:0,attemptedAt:now()});
     await fs.rm(path.join(cacheRoot,key+'.json'),{force:true}).catch(()=>{});
    }
   }
  })().finally(()=>pending.delete(key));pending.set(key,task);
 }
 async function tick() {
  if(stopped||busy)return;busy=true;
  try {
   const source=await drive.shellSnapshots();const active=await vault();
   const identity=source.identity,identityKey=hash([identity.userId,identity.tenantId,identity.deviceId]);
   if(stopped||!same(active,identity)||source.directory!==path.join(namespaceRoot,identityKey)||source.snapshots.length>10)throw fail();
   const documents=[],projects=[];const paths=new Set(),projectIds=new Set();
   for(const snapshot of source.snapshots) {
    if(projectIds.has(snapshot.projectId)||!same(snapshot.identity,identity))throw fail();projectIds.add(snapshot.projectId);
    const {savedEntries}=catalogDetails({identity,entries:snapshot.catalog},identity);
    if(hash([identity.userId,identity.tenantId,identity.deviceId,snapshot.projectId,savedEntries])!==snapshot.rootKey)throw fail();
    const files=savedEntries.filter(e=>!e.folder),nodeIds=files.map(e=>e.meta.nodeId);
    const entry=await cached(identity,snapshot.projectId,nodeIds);refresh(identity,snapshot.projectId,nodeIds,entry.key);
    const business=new Map((entry.data?.documents||[]).map(d=>[d.nodeId,d]));
    let transfers=new Map();
    try {
     const response=await agent.documentStatuses(nodeIds);
     if(!same(response?.identity,identity)||!Array.isArray(response.documents)||response.documents.length!==nodeIds.length)throw fail();
     const wanted=new Set(nodeIds);
     for(const d of response.documents){if(!wanted.delete(d.nodeId)||!states.has(d.state))throw fail();transfers.set(d.nodeId,d.state);}
    }catch{transfers=new Map();}
    projects.push({projectId:snapshot.projectId,name:entry.data?.name??null,observedAt:entry.observedAt||null});
    for(const file of files) {
     if(paths.has(file.path.toLowerCase()))throw fail();paths.add(file.path.toLowerCase());
     const info=business.get(file.meta.nodeId);
     documents.push({relativePath:file.path,nodeId:file.meta.nodeId,projectId:snapshot.projectId,catalogVersion:file.meta.version,
      business:info||null,observedAt:info?entry.observedAt:null,stale:!info||now()-entry.observedAt>60000,transferState:transfers.get(file.meta.nodeId)??null});
    }
   }
   const fresh=await drive.shellSnapshots();
   if(stopped||!same(await vault(),identity)||fresh.directory!==source.directory||JSON.stringify(fresh.snapshots.map(s=>s.rootKey))!==JSON.stringify(source.snapshots.map(s=>s.rootKey)))throw fail();
   const file=source.directory+'.shell.json';if(lastFile&&lastFile!==file)await clear();
   // Record before the write so stop/failure can remove a completed late write.
   lastFile=file;
   await atomic(file,{schema:1,identityKey,namespace:source.directory,expiresAt:now()+25000,projects,documents},namespaceRoot);
   if(stopped||!same(await vault(),identity)){await fs.unlink(file).catch(()=>{});await clear();return;}
  }catch{await clear();}
  finally{busy=false;}
 }
 function start(){if(timer||stopped)return;void tick();timer=setInterval(()=>void tick(),10000);timer.unref();}
 async function stop(){stopped=true;clearInterval(timer);timer=null;await clear();}
 return {start,stop,tick,settle:()=>Promise.allSettled([...pending.values()])};
}
module.exports={createWindowsShellCatalog,validateBusiness};
