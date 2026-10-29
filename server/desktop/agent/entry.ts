import path from 'node:path';
import crypto from 'node:crypto';
import { createAgentWorker, type AgentSession } from './worker';
const pending = new Map<string,{resolve(value:AgentSession):void;reject(error:Error):void;timer:NodeJS.Timeout}>();
let worker: ReturnType<typeof createAgentWorker> | null = null;
let interval: NodeJS.Timeout | undefined;
const send = (value: object) => { if (process.connected) process.send?.(value,()=>{}); };
function session(): Promise<AgentSession> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve,reject)=> {
    const timer = setTimeout(()=> {pending.delete(requestId);reject(new Error('Vault timeout'));},15000);
    pending.set(requestId,{resolve,reject,timer}); send({type:'drive:authorize',requestId});
  });
}
async function stop() {
  if (interval) clearInterval(interval);
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Parent disconnected')); }
  pending.clear(); await worker?.stop(); process.exit(0);
}
process.on('disconnect',()=> void stop());
process.on('message',async (msg:any)=> {
  if (msg?.type==='drive:authorization') {
    const p=pending.get(msg.requestId); if(!p)return; pending.delete(msg.requestId);clearTimeout(p.timer);
    if(msg.error)p.reject(Object.assign(new Error('Vault denied'),msg.error)); else p.resolve(msg.result); return;
  }
  if(msg?.type==='drive:init' && !worker) {
    if(typeof msg.root!=='string'||!path.isAbsolute(msg.root)||typeof msg.origin!=='string')return;
    try {const url=new URL(msg.origin);if(url.protocol!=='https:'||url.origin!==msg.origin)return;}catch{return;}
    worker=createAgentWorker({root:msg.root,origin:msg.origin,session,status:value=>send({type:'drive:status',...value})});
    interval=setInterval(()=>void worker?.tick(),10000); void worker.tick(); return;
  }
  if(msg?.type==='drive:enqueue' && worker && typeof msg.file==='string' && path.isAbsolute(msg.file) && /^[a-z0-9-]{1,100}$/.test(msg.requestId)) {
    try {const result=await worker.enqueue(msg.file);send({type:'drive:enqueued',requestId:msg.requestId,result});void worker.tick();}
    catch {send({type:'drive:enqueued',requestId:msg.requestId,error:{code:'DRIVE_ENQUEUE_FAILED'}});}
  }
  if(msg?.type==='drive:retry' && worker && /^[a-z0-9-]{1,100}$/.test(msg.requestId)) {
    try {const result=await worker.retryBlocked();send({type:'drive:retried',requestId:msg.requestId,result});void worker.tick();}
    catch {send({type:'drive:retried',requestId:msg.requestId,error:{code:'DRIVE_RETRY_FAILED'}});}
  }
  if(['drive:open-working','drive:upload-working','drive:preserve-working','drive:restart-working','drive:check-working','drive:refresh-working'].includes(msg?.type) && worker && typeof msg.nodeId==='string'
    && /^doc:[a-zA-Z0-9_-]{1,200}$/.test(msg.nodeId) && /^[a-z0-9-]{1,100}$/.test(msg.requestId)) {
    try {
      const result=msg.type==='drive:check-working'||msg.type==='drive:refresh-working'?await worker.checkRemoteVersion(msg.nodeId,msg.type==='drive:refresh-working'):msg.type==='drive:open-working'?await worker.openWorkingCopy(msg.nodeId):msg.type==='drive:restart-working'?await worker.restartWorkingCopy(msg.nodeId):msg.type==='drive:preserve-working'?await worker.preserveConflict(msg.nodeId):await worker.uploadWorkingCopy(msg.nodeId);
      send({type:'drive:working-result',requestId:msg.requestId,result});
      if(['drive:upload-working','drive:preserve-working'].includes(msg.type))void worker.tick();
    } catch(e:any) {
      const allowed=['WORKING_LOCAL_MODIFICATIONS','WORKING_REFRESH_BUSY','WORKING_UPLOAD_CONFLICT','DRIVE_LICENSE_EXPIRED','DRIVE_SUBSCRIPTION_REQUIRED','DEVICE_REVOKED','DRIVE_IDENTITY_MISMATCH'];
      send({type:'drive:working-result',requestId:msg.requestId,error:{code:allowed.includes(e.code)?e.code:'DRIVE_WORKING_FAILED'}});
    }
  }
  if(msg?.type==='drive:document-statuses' && worker && /^[a-z0-9-]{1,100}$/.test(msg.requestId)) {
    try { const result=await worker.documentStatuses(msg.nodeIds);send({type:'drive:document-statuses-result',requestId:msg.requestId,result}); }
    catch {send({type:'drive:document-statuses-result',requestId:msg.requestId,error:{code:'DRIVE_STATUS_UNAVAILABLE'}});}
  }
  if(msg?.type==='drive:windows-preview' && worker && ['catalog','hydrate'].includes(msg.action) && /^[a-z0-9-]{1,100}$/.test(msg.requestId)) {
    try {const result=await worker.windowsPreview(msg.action,msg.input);send({type:'drive:working-result',requestId:msg.requestId,result});}
    catch {send({type:'drive:working-result',requestId:msg.requestId,error:{code:'WINDOWS_PREVIEW_REFUSED'}});}
  }
  if(msg?.type==='drive:stop')void stop();
});
