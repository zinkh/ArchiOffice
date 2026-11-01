'use strict';
const fs=require('fs/promises');const path=require('path');const crypto=require('crypto');
const {catalogDetails,noLinks}=require('./windowsDrive.cjs');
const {createPersistentWindowsDrive}=require('./windowsDrivePersistence.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a,b)=>a&&b&&['userId','tenantId','deviceId'].every(k=>typeof a[k]==='string'&&a[k]===b[k]);
const fail=code=>Object.assign(new Error(code),{code});
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(id);
const fingerprint=entries=>hash([...entries].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0));
const owner=(identity,id)=>hash([identity.userId,identity.tenantId,identity.deviceId,id]);
function normalizeCatalog(old,catalog,identity) {
 const incoming=catalogDetails(catalog,identity).savedEntries;
 const before=new Map(old.catalog.map(entry=>[entry.key,entry]));const paths=new Map();const keys=new Set();
 const entries=incoming.map(entry=>{
  if(keys.has(entry.key))throw fail('DRIVE_SNAPSHOT_INVALID');keys.add(entry.key);
  const previous=before.get(entry.key),parent=path.win32.dirname(entry.path),mappedParent=parent==='.'?'':paths.get(parent);
  if(mappedParent===undefined)throw fail('DRIVE_SNAPSHOT_INVALID');
  if(previous&&previous.folder!==entry.folder)throw fail('DRIVE_SNAPSHOT_INVALID');
  if(previous&&!entry.folder&&entry.meta.version<previous.meta.version)throw fail('DRIVE_REFRESH_STALE');
  const sameExtension=entry.folder||!previous||path.win32.extname(previous.path).toLowerCase()===path.win32.extname(entry.path).toLowerCase();
  const name=previous&&sameExtension?path.win32.basename(previous.path):path.win32.basename(entry.path);
  const local=(mappedParent?mappedParent+'\\':'')+name;paths.set(entry.path,local);
  return {...entry,path:local};
 });
 if(!entries[0]?.folder||entries[0].key!==old.catalog[0]?.key||entries[0].path!==old.catalog[0].path)throw fail('DRIVE_SNAPSHOT_INVALID');
 const saved=catalogDetails({identity,entries},identity).savedEntries;
 const summary={added:0,updated:0,removed:0,moved:0,folders:0};const after=new Map(saved.map(entry=>[entry.key,entry]));
 for(const entry of saved){const previous=before.get(entry.key);if(entry.folder){if(!previous||previous.path!==entry.path)summary.folders++;continue;}
  if(!previous)summary.added++;else {if(JSON.stringify(previous.meta)!==JSON.stringify(entry.meta))summary.updated++;if(previous.path!==entry.path)summary.moved++;}}
 for(const entry of old.catalog)if(!after.has(entry.key)){if(entry.folder)summary.folders++;else summary.removed++;}
 return {entries:saved,summary,digest:fingerprint(saved),changed:fingerprint(old.catalog)!==fingerprint(saved)};
}
function createWindowsRefresh({options,namespace,getProject,setProject,getIdentity,onArchive}) {
 const {root,vault,agent,shell}=options;const plans=new Map();let revision=0;
 const names=(identity,id,operation)=>{
  const key=owner(identity,id);return {
   current:path.join(root,key+'.json'),previous:path.join(root,key+'.previous.json'),journal:path.join(root,key+'.refresh.json'),
   candidate:path.join(root,key+'.'+operation+'.staged.json'),old:path.join(root,key+'.'+operation+'.old.json'),
   connection:path.join(root,'connections',key+'.'+operation+'.json')};
 };
 async function read(file) {
  let stat;try{stat=await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw fail('DRIVE_SNAPSHOT_INVALID');
  try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{throw fail('DRIVE_SNAPSHOT_INVALID');}
 }
 async function write(file,value) {
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600});await fs.rename(file+'.tmp',file);
 }
 async function authorize(expected,generation=revision) {
  const active=await vault();if(generation!==revision||!same(active,expected))throw fail('DRIVE_UNAVAILABLE');return {userId:active.userId,tenantId:active.tenantId,deviceId:active.deviceId};
 }
 async function clean(saved,identity,id) {
  if(!saved||saved.projectId!==id||!same(saved.identity,identity)||saved.nativeReady!==true||typeof saved.directory!=='string'||path.dirname(saved.directory)!==path.resolve(root))throw fail('DRIVE_SNAPSHOT_INVALID');
  if(!path.basename(saved.directory).startsWith(hash([identity.userId,identity.tenantId]).slice(0,12)+'-'))throw fail('DRIVE_SNAPSHOT_INVALID');
  const catalog=catalogDetails({identity,entries:saved.catalog},identity).savedEntries;
  if(saved.rootKey!==hash([identity.userId,identity.tenantId,identity.deviceId,id,catalog]))throw fail('DRIVE_SNAPSHOT_INVALID');
  await noLinks(root,saved.directory);
  return {identity:{userId:identity.userId,tenantId:identity.tenantId,deviceId:identity.deviceId},projectId:id,directory:saved.directory,catalog,rootKey:saved.rootKey,nativeReady:true};
 }
 function candidate(id,identity,operation,catalogOverride=null,old=false) {
  const files=names(identity,id,operation);
  return createPersistentWindowsDrive({...options,mountA:false,login:async()=>{},manifestFile:old?files.old:files.candidate,
   stateFile:files.connection+(old?'.old':''),catalogOverride});
 }
 async function context(id) {
  if(!validId(id)||!getIdentity()||!getProject(id)?.status().active)throw fail('DRIVE_UNAVAILABLE');
  const identity=await authorize(getIdentity());const project=getProject(id);const saved=await clean(await project.snapshot(id),identity,id);
  return {identity,project,saved};
 }
 async function check(id) {
  const generation=revision;
  const {identity,project,saved}=await context(id);const files=names(identity,id,'');
  if(await read(files.journal))throw fail('DRIVE_REFRESH_INTERRUPTED');
  if(!await project.verify())throw fail('DRIVE_LOCAL_CHANGES');
  const catalog=await agent.windowsPreview('catalog',{projectId:id});await authorize(identity,generation);
  const normalized=normalizeCatalog(saved,catalog,identity);
  if(!normalized.changed){plans.delete(id);return {status:'up_to_date'};}
  const token=crypto.randomUUID();plans.set(id,{token,identity,saved,...normalized,expires:Date.now()+5*60*1000});
  return {status:'update_available',token,...normalized.summary};
 }
 async function finish(record,ready,previousProject,generation=revision) {
  const {identity,projectId:id,operation,previous,next}=record;const files=names(identity,id,operation);
  await authorize(identity,generation);await write(files.previous,previous);
  await namespace.retarget(identity,previous,next,operation);await authorize(identity,generation);
  await write(files.current,next);
  setProject(id,ready);if(previousProject&&previousProject!==ready)previousProject.shutdown();onArchive(id);plans.delete(id);
  // The pointer and namespace are committed. A cleanup failure leaves an
  // idempotent journal to finalize at next startup, never an ambiguous result.
  await fs.rm(files.journal,{force:true}).catch(()=>{});
 }
 async function apply(id,token) {
  const generation=revision;
  const plan=plans.get(id);if(!plan||plan.token!==token||Date.now()>plan.expires)throw fail('DRIVE_REFRESH_STALE');
  const {identity,project,saved}=await context(id);
  if(!same(plan.identity,identity)||saved.rootKey!==plan.saved.rootKey||saved.directory!==plan.saved.directory)throw fail('DRIVE_REFRESH_STALE');
  const files=names(identity,id,token);if(await read(files.journal))throw fail('DRIVE_REFRESH_INTERRUPTED');
  const remote=await agent.windowsPreview('catalog',{projectId:id});await authorize(identity,generation);
  if(normalizeCatalog(saved,remote,identity).digest!==plan.digest)throw fail('DRIVE_REFRESH_STALE');
  if(!await project.verify())throw fail('DRIVE_LOCAL_CHANGES');
  const prepared=candidate(id,identity,token,{identity,entries:plan.entries});let journal=false,committed=false;
  try {
   const result=await prepared.start(id,{open:false});if(result.status!=='opened')throw fail(result.code||'DRIVE_UNAVAILABLE');
   const next=await clean(await prepared.snapshot(id),identity,id);await authorize(identity,generation);
   if(!await project.verify())throw fail('DRIVE_LOCAL_CHANGES');
   await write(files.old,saved);
   const record={version:1,identity,projectId:id,operation:token,previous:saved,next};await write(files.journal,record);journal=true;
   await finish(record,prepared,project,generation);committed=true;return {status:'refreshed'};
  }catch(error){if(!committed)prepared.shutdown();if(journal)throw fail('DRIVE_REFRESH_INTERRUPTED');throw error;}
 }
 async function recover(id,identity) {
  const generation=revision;
  const initial=names(identity,id,'');const record=await read(initial.journal);if(!record)return null;
  if(record.version!==1||record.projectId!==id||!same(record.identity,identity)||typeof record.operation!=='string'||!/^[a-f0-9-]{36}$/.test(record.operation))throw fail('DRIVE_SNAPSHOT_INVALID');
  const previous=await clean(record.previous,identity,id),next=await clean(record.next,identity,id);const files=names(identity,id,record.operation);
  const current=await clean(await read(files.current),identity,id);
  if(current.rootKey!==previous.rootKey&&current.rootKey!==next.rootKey)throw fail('DRIVE_SNAPSHOT_INVALID');
  await authorize(identity,generation);
  let ready=getProject(id),oldVerifier=null;
  if(!ready||!ready.status().active||(await ready.snapshot(id))?.rootKey!==next.rootKey) {
   const stored=await read(files.candidate);if(stored){const checked=await clean(stored,identity,id);if(checked.rootKey!==next.rootKey||checked.directory!==next.directory)throw fail('DRIVE_SNAPSHOT_INVALID');}else await write(files.candidate,next);
   ready=candidate(id,identity,record.operation);
   const result=await ready.start(id,{open:false});if(result.status!=='opened'){ready.shutdown();throw fail('DRIVE_REFRESH_INTERRUPTED');}
  }
  try {
   if(current.rootKey===previous.rootKey) {
    const oldFile=await read(files.old);if(!oldFile)await write(files.old,previous);else if((await clean(oldFile,identity,id)).rootKey!==previous.rootKey)throw fail('DRIVE_SNAPSHOT_INVALID');
    oldVerifier=getProject(id);
    if(!oldVerifier||!oldVerifier.status().active||(await oldVerifier.snapshot(id))?.rootKey!==previous.rootKey){oldVerifier=candidate(id,identity,record.operation,null,true);const result=await oldVerifier.start(id,{open:false});if(result.status!=='opened')throw fail('DRIVE_LOCAL_CHANGES');}
    if(!await oldVerifier.verify())throw fail('DRIVE_LOCAL_CHANGES');
   }
   await finish({...record,previous,next},ready,oldVerifier||getProject(id),generation);return ready;
  }catch(error){if(getProject(id)!==ready)ready.shutdown();throw error;}
  finally{if(oldVerifier&&oldVerifier!==getProject(id))oldVerifier.shutdown();}
 }
 async function previous(id) {
  if(!validId(id))throw fail('DRIVE_UNAVAILABLE');const grant=getIdentity()||await vault();const identity=await authorize(grant);
  const files=names(identity,id,'');const pending=await read(files.journal);
  const saved=await clean(pending?.previous||await read(files.previous),identity,id);
  const target=saved.directory;await noLinks(root,target);await authorize(identity);
  if(await shell.openPath(target))throw fail('DRIVE_UNAVAILABLE');return {status:'copies_shown'};
 }
 async function hasPrevious(id,identity) {for(const file of [names(identity,id,'').previous,names(identity,id,'').journal]){try{const stat=await fs.lstat(file);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=1024*1024)return true;}catch{}}return false;}
 return {check,apply,recover,previous,hasPrevious,clear:()=>{revision++;plans.clear();}};
}
module.exports={createWindowsRefresh,normalizeCatalog};
