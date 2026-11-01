'use strict';
const fs=require('fs/promises');const path=require('path');const crypto=require('crypto');
const {createPersistentWindowsDrive}=require('./windowsDrivePersistence.cjs');
const {createWindowsNamespace}=require('./windowsDriveNamespace.cjs');
const {noLinks}=require('./windowsDrive.cjs');
const {createWindowsRefresh}=require('./windowsDriveRefresh.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a,b)=>a&&b&&['userId','tenantId','deviceId'].every(k=>typeof a[k]==='string'&&a[k]===b[k]);
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(id);
const failure=code=>Object.assign(new Error(code),{code});
const identityOf=grant=>({userId:grant.userId,tenantId:grant.tenantId,deviceId:grant.deviceId});
const codes=['DRIVE_LETTER_IN_USE','DRIVE_SNAPSHOT_INVALID','DRIVE_PROJECT_LIMIT','DRIVE_LOCAL_CHANGES','DRIVE_REFRESH_STALE','DRIVE_REFRESH_INTERRUPTED','DRIVE_BUSY'];

function createWindowsMultiDrive(options) {
 const {root,stateFile,vault,login,shell,enabled}=options;
 const namespace=createWindowsNamespace({...options,root:options.namespaceRoot||root+'-namespace',projectRoot:root});
 const projects=new Map();const previousProjects=new Set();let identity=null;let configured=false;let lastError=null;
 let busy=false;let stopped=false;let epoch=0;let timer=null;
 function stopAll() {epoch++;refresh.clear();namespace.stop();for(const project of projects.values())project.shutdown();projects.clear();previousProjects.clear();identity=null;}
 const refresh=createWindowsRefresh({options,namespace,getProject:id=>projects.get(id),setProject:(id,project)=>projects.set(id,project),getIdentity:()=>identity,onArchive:id=>previousProjects.add(id)});
 async function readSelection() {
  let present=false;
  try {
   const stat=await fs.lstat(stateFile);present=true;if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw failure('DRIVE_SNAPSHOT_INVALID');
   const saved=JSON.parse(await fs.readFile(stateFile,'utf8'));
   if(!same(saved.identity,saved.identity))throw failure('DRIVE_SNAPSHOT_INVALID');
   if(saved.version===2) {
    if(!Array.isArray(saved.projectIds)||(!saved.projectIds.length&&saved.autoConnect!==false)||saved.projectIds.length>10||!saved.projectIds.every(validId)||new Set(saved.projectIds).size!==saved.projectIds.length
      ||saved.directory!==namespace.directory(saved.identity))throw failure('DRIVE_SNAPSHOT_INVALID');
   } else {
    if(!validId(saved.projectId)||typeof saved.directory!=='string'||path.dirname(saved.directory)!==path.resolve(root))throw failure('DRIVE_SNAPSHOT_INVALID');
    await noLinks(root,saved.directory);saved.projectIds=[saved.projectId];
   }
   return saved;
  }catch(error){if(error.code==='ENOENT'&&!present)return null;throw failure('DRIVE_SNAPSHOT_INVALID');}
 }
 async function saveSelection(active,ids,base,autoConnect=true) {
  await fs.mkdir(path.dirname(stateFile),{recursive:true,mode:0o700});
  const temporary=stateFile+'.tmp';
  await fs.writeFile(temporary,JSON.stringify({version:2,identity:active,projectIds:ids,directory:base,autoConnect}),{mode:0o600});
  await fs.rename(temporary,stateFile);configured=autoConnect;
 }
 function projectFor(id,active) {
  if(!projects.has(id)) {
   projects.set(id,createPersistentWindowsDrive({...options,mountA:false,login:async()=>{},
    stateFile:path.join(root,'connections',hash([active.userId,active.tenantId,active.deviceId,id])+'.json')}));
  }
  return projects.get(id);
 }
 async function connect(requested,{restore=false}={}) {
  if(busy||stopped||!enabled())return {status:'error',code:'DRIVE_BUSY'};
  busy=true;const generation=epoch;const previousIds=new Set(identity?projects.keys():[]);let published=false;
  try {
   const saved=await readSelection();const active=identityOf(await vault());
   if(restore&&(!saved||!same(saved.identity,active)))return {status:'error'};
   if(identity&&!same(identity,active)){stopAll();throw failure('DRIVE_UNAVAILABLE');}
   const ids=identity?[...projects.keys()]:(saved&&same(saved.identity,active)?[...saved.projectIds]:[]);
   if(requested&&!validId(requested))throw failure('DRIVE_UNAVAILABLE');
   if(requested&&!ids.includes(requested)){if(ids.length>=10)throw failure('DRIVE_PROJECT_LIMIT');ids.push(requested);}
   if(!ids.length)throw failure('DRIVE_UNAVAILABLE');
   for(const id of ids) {
    if(epoch!==generation)throw failure('DRIVE_UNAVAILABLE');
    const recovered=await refresh.recover(id,active);if(recovered)projects.set(id,recovered);
    const project=projectFor(id,active);
    // A lost manifest from the previous single-project client is an error,
    // whereas an old pre-manifest client is migrated without moving its files.
    if(saved?.manifestVersion===1&&saved.projectId===id&&same(saved.identity,active)&&!await project.snapshot(id))throw failure('DRIVE_SNAPSHOT_INVALID');
    const result=await project.start(id,{open:false});
    if(result.status!=='opened')throw failure(codes.includes(result.code)?result.code:'DRIVE_UNAVAILABLE');
    if(await refresh.hasPrevious(id,active))previousProjects.add(id);
   }
   if(epoch!==generation||!same(await vault(),active))throw failure('DRIVE_UNAVAILABLE');
   const snapshots=[];for(const id of ids){const snapshot=await projects.get(id).snapshot(id);if(!snapshot)throw failure('DRIVE_SNAPSHOT_INVALID');snapshots.push(snapshot);}
   const base=namespace.directory(active);
   // Save the selected set before creating any new links: after a crash every
   // existing namespace link still belongs to a recorded selected project.
   await saveSelection(active,ids,base);
   try{await namespace.prepare(active,snapshots);}catch{throw failure('DRIVE_SNAPSHOT_INVALID');}
   if(epoch!==generation)throw failure('DRIVE_UNAVAILABLE');
   await namespace.start(active,base,saved?.directory||'');
   if(epoch!==generation||!same(await vault(),active))throw failure('DRIVE_UNAVAILABLE');
   if([...projects.values()].some(project=>!project.status().active))throw failure('DRIVE_SNAPSHOT_INVALID');
   identity=active;published=true;await login(true);
   if(!restore&&await shell.openPath('A:\\'))throw failure('DRIVE_UNAVAILABLE');
   lastError=null;return {status:'opened'};
  }catch(error) {
   lastError=codes.includes(error.code)?error.code:'DRIVE_UNAVAILABLE';
   let authorized=false;try{authorized=!!identity&&same(await vault(),identity);}catch{}
   // A failed new selection must not remove healthy projects already visible.
   // Structural or authorization failures close the namespace and all workers.
   if(lastError==='DRIVE_SNAPSHOT_INVALID'||!authorized||!namespace.status().active)stopAll();
   else {
    for(const [id,project] of projects)if(!project.status().active||(!published&&!previousIds.has(id))){project.shutdown();projects.delete(id);}
   }
   return {status:'error',code:lastError};
  }finally{busy=false;}
 }
 async function restore() {
  if(stopped||busy||!enabled())return;
  try {
   if(identity&&namespace.status().active) {
    if(!same(identityOf(await vault()),identity)){stopAll();return;}
    if([...projects.values()].some(project=>!project.status().active)){stopAll();lastError='DRIVE_SNAPSHOT_INVALID';}
    return;
   }
   const saved=await readSelection();if(!saved){if(identity)stopAll();return;}if(saved.autoConnect===false){configured=false;return;}configured=true;
   const active=identityOf(await vault());
   if(identity&&!same(identity,active)){stopAll();return;}
   if(!same(saved.identity,active))return;
   if(namespace.status().active) {
    if([...projects.values()].some(project=>!project.status().active)){stopAll();lastError='DRIVE_SNAPSHOT_INVALID';}
    return;
   }
   if(!lastError)await connect(null,{restore:true});
  }catch(error) {
   if(error.code==='DRIVE_SNAPSHOT_INVALID'){lastError=error.code;configured=true;}
   if(identity)stopAll();
  }
 }
 async function open() {
  try {
   if(!identity||!namespace.status().active||!same(await vault(),identity))throw failure('DRIVE_UNAVAILABLE');
   if(await shell.openPath('A:\\'))throw failure('DRIVE_UNAVAILABLE');return {status:'opened'};
  }catch{if(identity){try{if(!same(await vault(),identity))stopAll();}catch{stopAll();}}return {status:'error'};}
 }
 async function disconnect() {
  if(busy)throw failure('DRIVE_BUSY');busy=true;
  try {
   let saved=null;try{saved=await readSelection();}catch{}stopAll();
   if(saved)await saveSelection(saved.identity,saved.projectIds,namespace.directory(saved.identity),false);
   else await fs.rm(stateFile,{force:true});
   configured=false;lastError=null;await login(false);
  }finally{busy=false;}
 }
 async function remove(projectId) {
  if(busy||stopped)return {status:'error'};busy=true;
  try {
   if(!validId(projectId)||!identity||!same(await vault(),identity)||!projects.has(projectId))throw failure('DRIVE_UNAVAILABLE');
   const project=projects.get(projectId);const saved=await project.snapshot(projectId);if(!saved)throw failure('DRIVE_SNAPSHOT_INVALID');
   await namespace.remove(identity,saved);project.shutdown();projects.delete(projectId);previousProjects.delete(projectId);refresh.clear();
   const ids=[...projects.keys()];await saveSelection(identity,ids,namespace.directory(identity),ids.length>0);
   if(!ids.length){stopAll();await login(false);}
   lastError=null;return {status:'removed'};
  }catch(error){lastError=codes.includes(error.code)?error.code:'DRIVE_UNAVAILABLE';if(error.code==='DRIVE_SNAPSHOT_INVALID')stopAll();return {status:'error',code:lastError};}
  finally{busy=false;}
 }
 function resume(){if(timer)return;void restore();timer=setInterval(()=>void restore(),10000);timer.unref();}
 function shutdown(){stopped=true;clearInterval(timer);timer=null;stopAll();}
 async function refreshAction(action) {
  if(busy||stopped)return {status:'error',code:'DRIVE_BUSY'};busy=true;
  try{const result=await action();lastError=null;return result;}
  catch(error){lastError=codes.includes(error.code)?error.code:'DRIVE_UNAVAILABLE';let authorized=false;try{authorized=identity&&same(await vault(),identity);}catch{}
   if(!authorized||['DRIVE_REFRESH_INTERRUPTED','DRIVE_SNAPSHOT_INVALID'].includes(lastError))stopAll();return {status:'error',code:lastError};}
  finally{busy=false;}
 }
 const status=()=>({enabled:enabled(),active:namespace.status().active,configured,error:lastError,letter:'A:',projectCount:namespace.status().active?projects.size:0,projectIds:namespace.status().active?[...projects.keys()]:[],previousProjectIds:namespace.status().active?[...previousProjects]:[]});
 async function getStatus() {
  // The renderer may have switched cabinet since the previous lease check.
  // Validate before exposing the selected IDs, not only on the next timer tick.
  if(identity){try{if(!same(await vault(),identity))stopAll();}catch{stopAll();}}
  const result=status();
  if(!identity){try{const saved=await readSelection();const active=await vault();if(saved&&same(saved.identity,active))for(const id of saved.projectIds)if(await refresh.hasPrevious(id,active))result.previousProjectIds.push(id);}catch{}}
  return result;
 }
 return {start:connect,open,remove,disconnect,resume,shutdown,status,getStatus,
  checkCatalog:id=>refreshAction(()=>refresh.check(id)),refreshCatalog:(id,token)=>refreshAction(()=>refresh.apply(id,token)),
  openPrevious:id=>refreshAction(()=>refresh.previous(id))};
}
module.exports={createWindowsMultiDrive};
