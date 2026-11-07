'use strict';
const net=require('net');const crypto=require('crypto');const fs=require('fs/promises');const path=require('path');
const {noLinks}=require('./windowsDrive.cjs');const {isSafeToOpen}=require('./fileAccess.cjs');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same=(a,b)=>a&&b&&['userId','tenantId','deviceId'].every(k=>a[k]===b[k]);
const text=(v,max=240)=>typeof v==='string'?v.slice(0,max):'';
const cleanName=v=>path.win32.basename(v).replace(/^_/,'').replace(/-[a-f0-9]{12}(?=\.|$)/,'');
/** Local projection only. Every command resolves its opaque key again against
 * the currently mounted manifest, never a path or document URL from Explorer. */
function createShellProjection({drive,agent,vault,root,shell,openDocument,now=Date.now}) {
 let owner=null;let loading=0;const metadata=new Map();
 async function snapshot(){const value=await drive.shellSnapshot();const active=await vault();if(!same(value.identity,active)||!Array.isArray(value.projects)||value.projects.length>10)throw new Error('Access refused');const id=hash(value.identity);if(owner!==id){owner=id;metadata.clear();}return value;}
 function enrich(saved,identity){
  const key=hash([identity,saved.projectId,saved.rootKey]);let cached=metadata.get(key);
  if(!cached){cached={at:-Infinity,data:null,pending:false};metadata.set(key,cached);}
  if(!cached.pending&&loading<2&&now()-cached.at>60000){const entry=cached;entry.pending=true;loading++;
   void Promise.resolve().then(()=>agent.windowsPreview('shell-metadata',{projectId:saved.projectId})).then(value=>{if(owner===hash(identity)&&same(value?.identity,identity)&&Array.isArray(value.files)&&value.files.length<=100)entry.data=value;}).catch(()=>{}).finally(()=>{entry.pending=false;entry.at=now();loading--;});
  }return cached.data;
 }
 async function catalog(){
  const snap=await snapshot();const activeKeys=new Set(snap.projects.map(p=>hash([snap.identity,p.projectId,p.rootKey])));for(const key of metadata.keys())if(!activeKeys.has(key))metadata.delete(key);const projects=[];
  for(const saved of snap.projects){const extra=enrich(saved,snap.identity);const revision=hash([saved.rootKey,saved.directory]);const files=saved.catalog.filter(e=>!e.folder);if(files.length>100)throw new Error('Invalid catalog');
   const rows=files.map(e=>{const m=e.meta;if(!m||!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(m.nodeId)||!/^[a-f0-9]{64}$/.test(e.key)||!Number.isSafeInteger(m.version))throw new Error('Invalid catalog');
    const detail=extra?.files.find(d=>d.nodeId===m.nodeId&&d.version===m.version);const parent=e.path.split('\\').slice(0,-1).at(-1);
    return {key:e.key,name:text(m.name,512),phase:text(detail?.phase|| (e.path.split('\\').length>2?cleanName(parent):''),120),type:path.win32.extname(m.name).slice(1,15).toUpperCase(),indice:text(detail?.indice,24),version:m.version,status:text(detail?.status,40)};});
   projects.push({id:saved.projectId,name:text(extra?.projectName||cleanName(saved.catalog[0]?.path||'Projet')),revision,rows});
  }
  if(!same(await vault(),snap.identity))throw new Error('Access refused');return {status:'ok',projects};
 }
 async function command(action,input,signal){
  const alive=()=>signal?.throwIfAborted();alive();
  if(!['catalog','open','document'].includes(action))throw new Error('Invalid action');if(action==='catalog'){const value=await catalog();alive();return value;}
  if(typeof input.projectId!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(input.projectId)||!/^[a-f0-9]{64}$/.test(input.key)||!/^[a-f0-9]{64}$/.test(input.revision))throw new Error('Invalid reference');
  const snap=await snapshot();const saved=snap.projects.find(p=>p.projectId===input.projectId);
  if(!saved||hash([saved.rootKey,saved.directory])!==input.revision)throw new Error('Stale generation');
  const entry=saved.catalog.find(e=>!e.folder&&e.key===input.key);if(!entry||!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(entry.meta?.nodeId))throw new Error('Unknown file');
  const latest=async()=>{const next=await snapshot();const current=next.projects.find(p=>p.projectId===saved.projectId);if(!same(snap.identity,next.identity)||!current||hash([current.rootKey,current.directory])!==input.revision)throw new Error('Stale generation');};
  if(action==='document'){await latest();alive();await openDocument({projectId:saved.projectId,documentId:entry.meta.nodeId.slice(4)});return {status:'opened'};}
  const file=path.join(saved.directory,...entry.path.split('\\'));await noLinks(root,file);const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.size>50*1024*1024||!isSafeToOpen(file))throw new Error('File refused');await latest();alive();
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
  if(stopped||clients.size>=8){socket.destroy();return;}clients.add(socket);const cancel=new AbortController();socket.setTimeout(10000,()=>socket.destroy());let data='',done=false;
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
