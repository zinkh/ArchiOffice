'use strict';
const net=require('net');const crypto=require('crypto');const fs=require('fs/promises');const path=require('path');
const {validateBusiness}=require('./windowsShellCatalog.cjs');
const {noLinks}=require('./windowsDrive.cjs');const {isSafeToOpen}=require('./fileAccess.cjs');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same=(a,b)=>a&&b&&['userId','tenantId','deviceId'].every(k=>a[k]===b[k]);
const text=(v,max=240)=>typeof v==='string'?v.slice(0,max):'';
const cleanName=v=>path.win32.basename(v).replace(/^_/,'').replace(/-[a-f0-9]{12}(?=\.|$)/,'');
/** Local projection only. Every command resolves its opaque key again against
 * the currently mounted manifest, never a path or document URL from Explorer. */
function createShellProjection({drive,agent,vault,root,shell,openDocument,businessCatalog,renderPreview,now=Date.now}) {
 let owner=null;let loading=0;const metadata=new Map();const histories=new Map();
 async function snapshot(){const value=await drive.shellSnapshot();const active=await vault();if(!same(value.identity,active)||!Array.isArray(value.projects)||value.projects.length>10)throw new Error('Access refused');const id=hash(value.identity);if(owner!==id){owner=id;metadata.clear();histories.clear();}return value;}
 function enrich(saved,identity){
  const key=hash([identity,saved.projectId,saved.rootKey]);let cached=metadata.get(key);
  if(!cached){cached={at:-Infinity,data:null,pending:false};metadata.set(key,cached);}
  if(!cached.pending&&loading<2&&now()-cached.at>60000){const entry=cached;entry.pending=true;loading++;
   const nodeIds=saved.catalog.filter(e=>!e.folder).map(e=>e.meta.nodeId);
   void Promise.resolve().then(()=>agent.windowsPreview('shellMetadata',{identity,projectId:saved.projectId,nodeIds})).then(value=>{
    if(owner===hash(identity))entry.data={...validateBusiness(value,identity,saved.projectId,nodeIds),observedAt:now()};
   }).catch(error=>{if([401,402,403,404].includes(error.status)||error.code==='WINDOWS_SHELL_METADATA_REFUSED')entry.data=null;}).finally(()=>{entry.pending=false;entry.at=now();loading--;});
  }return cached.data;
 }
 async function catalog(){
  const snap=await snapshot();const activeKeys=new Set(snap.projects.map(p=>hash([snap.identity,p.projectId,p.rootKey])));for(const key of metadata.keys())if(!activeKeys.has(key))metadata.delete(key);const projects=[];
  for(const saved of snap.projects){
   const files=saved.catalog.filter(e=>!e.folder);if(files.length>100)throw new Error('Invalid catalog');
   let extra=null;
   if(businessCatalog){const value=await businessCatalog(snap.identity,saved);if(value)extra={...validateBusiness(value,snap.identity,saved.projectId,files.map(e=>e.meta.nodeId)),observedAt:Number.isSafeInteger(value.observedAt)&&value.observedAt>0&&value.observedAt<=now()?value.observedAt:null};}
   else extra=enrich(saved,snap.identity);
   const revision=hash([saved.rootKey,saved.directory]);const available=new Map(),transfers=new Map();
   try {
    const response=await drive.shellAvailability(saved.projectId);
    if(!same(response.identity,snap.identity)||response.rootKey!==saved.rootKey||!Array.isArray(response.files)||response.files.length!==files.length)throw new Error('Availability refused');
    const keys=new Set(files.map(e=>e.key));
    for(const item of response.files){if(!keys.delete(item.key)||!(item.available===null||typeof item.available==='boolean'))throw new Error('Availability refused');available.set(item.key,item.available);}
   }catch{available.clear();}
   try {
    const response=await agent.documentStatuses(files.map(e=>e.meta.nodeId));
    if(!same(response.identity,snap.identity)||!Array.isArray(response.documents)||response.documents.length!==files.length)throw new Error('Transfers refused');
    const ids=new Set(files.map(e=>e.meta.nodeId));
    for(const item of response.documents){if(!ids.delete(item.nodeId)||!['none','queued','uploading','retry','blocked','conflict','uploaded','reconciled'].includes(item.state))throw new Error('Transfers refused');transfers.set(item.nodeId,item.state);}
   }catch{transfers.clear();}
   const rows=files.map(e=>{const m=e.meta;if(!m||!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(m.nodeId)||!/^[a-f0-9]{64}$/.test(e.key)||!Number.isSafeInteger(m.version))throw new Error('Invalid catalog');
    const detail=extra?.documents.find(d=>d.nodeId===m.nodeId&&d.remoteVersion===m.version);const parent=e.path.split('\\').slice(0,-1).at(-1);
    return {key:e.key,name:text(m.name,512),phase:text(detail?.phase|| (e.path.split('\\').length>2?cleanName(parent):''),120),
     type:text(detail?.documentType,200),fileType:path.win32.extname(m.name).slice(1,15).toUpperCase(),indice:text(detail?.indice,200),version:m.version,status:text(detail?.status,200),
     observedAt:detail?extra.observedAt??null:null,metadataStale:!detail||!extra.observedAt||now()-extra.observedAt>60000,businessKnown:!!detail,unclassified:!!detail&&(!detail.phase||!detail.documentType),available:available.get(e.key)??null,transferState:transfers.get(m.nodeId)??''};});
   projects.push({id:saved.projectId,name:text(extra?.name||cleanName(saved.catalog[0]?.path||'Projet')),revision,rows});
  }
  const fresh=await snapshot();
  if(!same(fresh.identity,snap.identity)||JSON.stringify(fresh.projects.map(p=>[p.projectId,p.rootKey]))!==JSON.stringify(snap.projects.map(p=>[p.projectId,p.rootKey])))throw new Error('Catalogue changed');
  return {status:'ok',scope:hash(snap.identity),projects};
 }
 async function command(action,input,signal){
  const alive=()=>signal?.throwIfAborted();alive();
  if(!['catalog','open','document','preview','versions'].includes(action))throw new Error('Invalid action');if(action==='catalog'){const value=await catalog();alive();return value;}
  if(typeof input.projectId!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(input.projectId)||!/^[a-f0-9]{64}$/.test(input.key)||!/^[a-f0-9]{64}$/.test(input.revision))throw new Error('Invalid reference');
  const snap=await snapshot();const saved=snap.projects.find(p=>p.projectId===input.projectId);
  if(!saved||hash([saved.rootKey,saved.directory])!==input.revision)throw new Error('Stale generation');
  const entry=saved.catalog.find(e=>!e.folder&&e.key===input.key);if(!entry||!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(entry.meta?.nodeId))throw new Error('Unknown file');
  const latest=async()=>{const next=await snapshot();const current=next.projects.find(p=>p.projectId===saved.projectId);if(!same(snap.identity,next.identity)||!current||hash([current.rootKey,current.directory])!==input.revision)throw new Error('Stale generation');};
  if(action==='versions') {
   const cacheKey=hash([snap.identity,saved.projectId,entry.key,input.revision]);let result,stale=false;
   try {
    result=await agent.windowsPreview('shellVersions',{identity:snap.identity,projectId:saved.projectId,nodeId:entry.meta.nodeId},signal);
    if(!same(result?.identity,snap.identity)||!Array.isArray(result.versions)||result.versions.length>50||!Number.isSafeInteger(result.total)||result.total<result.versions.length)throw Object.assign(new Error('Versions refused'),{code:'WINDOWS_SHELL_METADATA_REFUSED'});
    const seen=new Set();for(const v of result.versions){if(!Number.isSafeInteger(v.version)||v.version<1||seen.has(v.version)||!(v.size===null||Number.isSafeInteger(v.size)&&v.size>=0)||!(v.uploadedAt===null||typeof v.uploadedAt==='string'&&v.uploadedAt.length<=80)||!(v.description===null||typeof v.description==='string'&&v.description.length<=512))throw Object.assign(new Error('Versions refused'),{code:'WINDOWS_SHELL_METADATA_REFUSED'});seen.add(v.version);}
    result={versions:result.versions.map(v=>({version:v.version,size:v.size,uploadedAt:v.uploadedAt,description:v.description})),total:result.total,observedAt:now()};
    await latest();alive();histories.delete(cacheKey);histories.set(cacheKey,result);while(histories.size>100)histories.delete(histories.keys().next().value);
   }catch(error){if([401,402,403,404].includes(error.status)||error.code==='WINDOWS_SHELL_METADATA_REFUSED'){histories.delete(cacheKey);throw error;}result=histories.get(cacheKey);if(!result)throw error;stale=true;}
   await latest();alive();return {status:'versions',...result,stale};
  }
  if(action==='document'){await latest();alive();await openDocument({projectId:saved.projectId,documentId:entry.meta.nodeId.slice(4)});return {status:'opened'};}
  const file=path.join(saved.directory,...entry.path.split('\\'));await noLinks(root,file);const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.size>50*1024*1024||!isSafeToOpen(file))throw new Error('File refused');await latest();alive();
  if(action==='preview') {
   if(!renderPreview)return {status:'unavailable'};
   const result=await renderPreview(file,input.page??0,signal);await latest();alive();return result;
  }
  if(await shell.openPath(file))throw new Error('Open failed');return {status:'opened'};
 }
 return {command};
}
/** Reuse the desktop window; opening a document must not create a second client. */
function createShellDocumentOpener({getWindow,showWindow,origin}) {
 let creating=null;
 return async({projectId,documentId})=>{
  if(creating)await creating;
  let target=getWindow();
  if(!target||target.isDestroyed()){
   creating=Promise.resolve().then(showWindow);
   try{await creating;}finally{creating=null;}
   target=getWindow();
  }
  if(!target||target.isDestroyed())throw new Error('Window unavailable');
  if(target.isMinimized())target.restore();target.show();target.focus();
  await target.loadURL(origin+'/documents?'+new URLSearchParams({project:projectId,document:documentId}));
 };
}
function createShellPipe({projection,address='\\\\.\\pipe\\ArchiOffice.DriveShell.'+crypto.randomUUID(),token=crypto.randomBytes(32).toString('hex')}) {
 let server=null;const clients=new Set();let stopped=false;
 async function start(){if(server)return {address,token};server=net.createServer(socket=>{
  if(stopped||clients.size>=8){socket.destroy();return;}clients.add(socket);const cancel=new AbortController();socket.setTimeout(25000,()=>socket.destroy());let data='',done=false;
  socket.on('error',()=>{});socket.on('close',()=>{clients.delete(socket);cancel.abort();});socket.on('data',bytes=>{
   if(done){socket.destroy();return;}data+=bytes.toString('utf8');if(Buffer.byteLength(data)>8192){socket.destroy();return;}const end=data.indexOf('\n');if(end<0)return;done=true;
   void(async()=>{try{if(data.slice(end+1).trim())throw Error();const msg=JSON.parse(data.slice(0,end));if(msg.format!==1||typeof msg.token!=='string'||msg.token.length!==token.length||!crypto.timingSafeEqual(Buffer.from(msg.token),Buffer.from(token)))throw Error();
    const value=await projection.command(msg.action,msg,cancel.signal);const frame=JSON.stringify(value)+'\n';if(Buffer.byteLength(frame)>2*1024*1024)throw Error();if(!stopped&&!socket.destroyed)socket.end(frame);
   }catch{if(!socket.destroyed)socket.end('{"status":"unavailable"}\n');}})();
  });
 });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address,resolve);});return {address,token};}
 function stop(){stopped=true;for(const socket of clients)socket.destroy();server?.close();server=null;}
 return {start,stop};
}
module.exports={createShellProjection,createShellPipe,createShellDocumentOpener};
