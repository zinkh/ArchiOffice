const crypto = require('crypto');

// The worker gets platform/network variables only, never application secrets.
function agentEnvironment(env) {
  const keys = ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','LANG','LC_ALL','TZ',
    'SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'];
  return { ...Object.fromEntries(keys.filter(k=>env[k]!==undefined).map(k=>[k,env[k]])), ELECTRON_RUN_AS_NODE:'1' };
}
function requestVault(server) {
  return new Promise((resolve,reject)=> {
    if(!server?.connected)return reject(new Error('Vault unavailable'));
    const requestId=crypto.randomUUID();
    const cleanup=()=> {clearTimeout(timer);server.off('message',onMessage);server.off('exit',onExit);};
    const onExit=()=> {cleanup();reject(new Error('Vault unavailable'));};
    const onMessage=msg=> {if(msg?.type!=='drive:vault-result'||msg.requestId!==requestId)return;cleanup();
      if(msg.error)reject(Object.assign(new Error('Vault denied'),msg.error));else resolve(msg.result);};
    const timer=setTimeout(onExit,12000);
    server.on('message',onMessage);server.once('exit',onExit);
    server.send({type:'drive:vault',requestId},err=> {if(err)onExit();});
  });
}
function sendToChild(child, value) { if(child?.connected) { try { child.send(value,()=>{}); } catch {} } }
function createDriveAgent({spawn,executable,entry,root,origin,getServer,onStatus=()=>{},environment=process.env}) {
  let child=null;let stopped=false;let restart=null;let failures=0;let outstanding=0;
  const jobs=new Map();
  function rejectJobs() {for(const p of jobs.values()){clearTimeout(p.timer);p.reject(new Error('Agent unavailable'));}jobs.clear();}
  function start() {
    if(stopped||child)return;
    const processChild=spawn(executable,[entry],{env:agentEnvironment(environment),stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
    child=processChild;
    processChild.on('message',async msg=> {
      if(child!==processChild)return;
      if(msg?.type==='drive:authorize' && typeof msg.requestId==='string' && /^[a-z0-9-]{1,100}$/.test(msg.requestId)) {
        if(outstanding>=8)return;outstanding++;
        try {const result=await requestVault(getServer());sendToChild(processChild,{type:'drive:authorization',requestId:msg.requestId,result});}
        catch(e){sendToChild(processChild,{type:'drive:authorization',requestId:msg.requestId,error:{status:e.status||503,code:e.code||'DRIVE_VAULT_UNAVAILABLE'}});}
        finally{outstanding--;}
      }
      if(msg?.type==='drive:status' && ['running','paused','stopped'].includes(msg.state))onStatus({state:msg.state,...Object.fromEntries(['pending','blocked','conflicts'].map(k=>[k,Number.isSafeInteger(msg[k])&&msg[k]>=0?msg[k]:0]))});
      if(msg?.type==='drive:enqueued'||msg?.type==='drive:retried') {const p=jobs.get(msg.requestId);if(!p)return;clearTimeout(p.timer);jobs.delete(msg.requestId);
        if(msg.error)p.reject(new Error('Drive enqueue failed'));else p.resolve(msg.type==='drive:retried'?{retried:Number.isSafeInteger(msg.result?.retried)?msg.result.retried:0}:{queued:true,jobId:msg.result?.jobId});}
    });
    const exited=()=> {
      if(child!==processChild)return;child=null;rejectJobs();onStatus({state:'paused'});
      if(!stopped && failures++<3)restart=setTimeout(start,Math.min(30000,1000*2**failures));
    };
    processChild.once('exit',exited);processChild.once('error',()=> {
      if(processChild.pid)processChild.kill(); else exited();
    });
    sendToChild(processChild,{type:'drive:init',root,origin});
  }
  return {
    start,
    enqueue(file) {return new Promise((resolve,reject)=> {
      if(!child?.connected||stopped||jobs.size>=8)return reject(new Error('Agent unavailable'));
      const requestId=crypto.randomUUID();const timer=setTimeout(()=> {jobs.delete(requestId);reject(new Error('Drive enqueue timeout'));},30000);
      jobs.set(requestId,{resolve,reject,timer});sendToChild(child,{type:'drive:enqueue',requestId,file});
    });},
    retryBlocked() {return new Promise((resolve,reject)=> {
      if(!child?.connected||stopped||jobs.size>=8)return reject(new Error('Agent unavailable'));
      const requestId=crypto.randomUUID();const timer=setTimeout(()=>{jobs.delete(requestId);reject(new Error('Drive retry timeout'));},30000);
      jobs.set(requestId,{resolve,reject,timer});sendToChild(child,{type:'drive:retry',requestId});
    });},
    stop() {stopped=true;clearTimeout(restart);rejectJobs();const current=child;if(!current)return;
      sendToChild(current,{type:'drive:stop'});
      const timer=setTimeout(()=>current.kill(),3000);timer.unref();current.once('exit',()=>clearTimeout(timer));
    },
  };
}
module.exports={agentEnvironment,requestVault,createDriveAgent};
