'use strict';
const fs=require('fs/promises');const path=require('path');const crypto=require('crypto');
const {agentEnvironment}=require('./driveAgent.cjs');const {isSafeToOpen}=require('./fileAccess.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a,b)=>a&&b&&['userId','tenantId','deviceId'].every(k=>typeof a[k]==='string'&&a[k]===b[k]);
async function noLinks(root,file) {
  const relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Path refused');
  let current=path.resolve(root);if((await fs.lstat(current)).isSymbolicLink())throw new Error('Link refused');
  for(const name of relative.split(path.sep).filter(Boolean)){current=path.join(current,name);if((await fs.lstat(current)).isSymbolicLink())throw new Error('Link refused');}
}
function createWindowsPreview({spawn,agent,vault,root,cacheRoot,executable,shell,enabled,environment=process.env,mountA=false}) {
  let mount=null;let busy=false;let epoch=0;let closing=Promise.resolve();
  const available=()=>enabled()===true;
  function stop() {
    epoch++;
    const old=mount;mount=null;if(!old)return;clearInterval(old.lease);old.stopped=true;
    closing=old.exited?Promise.resolve():new Promise(resolve=>{
      const timeout=setTimeout(resolve,6500);timeout.unref();old.child.once('exit',()=>{clearTimeout(timeout);resolve();});
    });
    try{old.child.stdin.end(JSON.stringify({type:'stop'})+'\n');}catch{}
    const timer=setTimeout(()=>old.child.kill(),6000);timer.unref();old.child.once('exit',()=>clearTimeout(timer));
    old.reject?.(new Error('Preview stopped'));
  }
  async function start(projectId,{open=true,previousRoot='',onPrepared=async()=>{}}={}) {
    if(!available()||busy||typeof projectId!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(projectId))throw new Error('Preview unavailable');
    busy=true;let created=false;
    const generation=epoch;
    try {
      await closing;
      const grant=await vault();const active={userId:grant.userId,tenantId:grant.tenantId,deviceId:grant.deviceId};
      if(generation!==epoch)throw new Error('Preview stopped');
      if(mount) {
        if(!same(mount.identity,active)){stop();throw new Error('Identity changed');}
        if(mount.projectId!==projectId)throw new Error('Stop previous preview first');
        if(open&&await shell.openPath(mountA?'A:\\':mount.root))throw new Error('Explorer unavailable');return {status:'opened'};
      }
      const catalog=await agent.windowsPreview('catalog',{projectId});
      if(!same(catalog?.identity,active)||!same(await vault(),active)||!Array.isArray(catalog.entries)||catalog.entries.length>256)throw new Error('Catalog refused');
      const files=new Map();const paths=new Set();
      const entries=catalog.entries.map(e=> {
        if(typeof e.path!=='string'||e.path.length>300||!/^_[^<>:"/|?*\x00-\x1f]+$/.test(e.path)||e.path.split('\\').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p))
          ||typeof e.key!=='string'||!/^[a-f0-9]{64}$/.test(e.key)||typeof e.folder!=='boolean'||!Number.isSafeInteger(e.size)||e.size<0||e.size>50*1024*1024)throw new Error('Invalid catalog');
        const folded=e.path.toLowerCase();if(paths.has(folded))throw new Error('Path collision');paths.add(folded);
        if(!e.folder) {
          const m=e.meta;
          if(!m||m.size!==e.size||typeof m.nodeId!=='string'||!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(m.nodeId)||!Number.isSafeInteger(m.version)||m.version<1
            ||(m.sha256!==null&&!/^[a-f0-9]{64}$/.test(m.sha256))||!isSafeToOpen(e.path))throw new Error('Invalid file');
          if(files.has(e.key))throw new Error('Duplicate identity');files.set(e.key,m);
        }
        return {path:e.path,key:e.key,folder:e.folder,size:e.size};
      });
      await fs.mkdir(root,{recursive:true,mode:0o700});await noLinks(root,root);
      if(generation!==epoch||!same(await vault(),active))throw new Error('Access refused');
      const directory=await fs.mkdtemp(path.join(root,hash([active.userId,active.tenantId]).slice(0,12)+'-'));
      await onPrepared({identity:active,projectId,directory});
      if(generation!==epoch)throw new Error('Preview stopped');
      const child=spawn(executable,[],{stdio:['pipe','pipe','ignore'],windowsHide:true,env:agentEnvironment(environment)});
      const state={child,identity:active,projectId,root:directory,stopped:false,lease:null,reject:null};mount=state;created=true;
      child.once('exit',()=>{state.exited=true;});
      const send=value=>{if(!state.stopped&&!child.stdin.destroyed)child.stdin.write(JSON.stringify(value)+'\n');};
      const ready=new Promise((resolve,reject)=> {
        state.reject=reject;const timeout=setTimeout(()=>{reject(new Error('Native startup timeout'));stop();},90000);let text='';let ready=false;const requests=new Set();
        const fail=()=>{clearTimeout(timeout);reject(new Error('Native preview unavailable'));if(mount===state)stop();};
        child.once('error',fail);child.once('exit',fail);
        child.stdout.on('data',chunk=> {
          text+=chunk.toString('utf8');if(text.length>1024*1024){fail();return;}
          let newline;
          while((newline=text.indexOf('\n'))>=0) {
            const frame=text.slice(0,newline);text=text.slice(newline+1);let msg;try{msg=JSON.parse(frame);}catch{fail();return;}
            if(msg.type==='ready'&&!ready){ready=true;clearTimeout(timeout);resolve();}
            else if(msg.type==='error'){
              if(msg.code==='DRIVE_LETTER_IN_USE'){clearTimeout(timeout);reject(Object.assign(new Error('A: already in use'),{code:msg.code}));if(mount===state)stop();}
              else fail();return;
            }
            else if(msg.type==='hydrate') {
              if(typeof msg.requestId!=='string'||!/^\d{1,10}$/.test(msg.requestId)||requests.has(msg.requestId)||requests.size>=8||!files.has(msg.key)){fail();return;}
              requests.add(msg.requestId);const meta=files.get(msg.key);
              void (async()=> {
                try {
                  if(!same(await vault(),active)||state.stopped)throw new Error('Access refused');
                  const result=await agent.windowsPreview('hydrate',{meta,identity:active});
                  const owner=hash([active.userId,active.tenantId]);const key=hash([active.userId,active.tenantId,meta.nodeId,meta.version]);
                  const expected=path.join(cacheRoot,owner,'downloads',key+'.cache');
                  if(result?.file!==expected||!same(await vault(),active)||state.stopped)throw new Error('Cache refused');
                  await noLinks(cacheRoot,expected);const stat=await fs.lstat(expected);if(!stat.isFile()||stat.size!==meta.size)throw new Error('Cache refused');
                  send({type:'hydrated',requestId:msg.requestId,file:expected});
                }catch{send({type:'hydrated',requestId:msg.requestId});}
                finally{requests.delete(msg.requestId);}
              })();
            }
          }
        });
      });
      // Catalog excludes tokens; the native helper never receives credentials.
      send({type:'init',root:directory,entries,...(mountA?{mountA:true,previousRoot}:{})});await ready;
      if(state.stopped||!same(await vault(),active))throw new Error('Access refused');
      let checking=false;
      state.lease=setInterval(async()=> {
        if(checking)return;checking=true;
        try{if(!same(await vault(),active)&&mount===state)stop();}catch{if(mount===state)stop();}finally{checking=false;}
      },10000);state.lease.unref();
      if(open&&await shell.openPath(mountA?'A:\\':directory))throw new Error('Explorer unavailable');return {status:'opened'};
    }catch(e){if(created)stop();throw e;}finally{busy=false;}
  }
  return {start,stop,status:()=>({enabled:available(),active:!!mount})};
}
module.exports={createWindowsPreview,noLinks};
