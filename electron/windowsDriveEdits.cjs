'use strict';
const fs=require('fs/promises');const path=require('path');
const same=(a,b)=>a&&b&&['userId','tenantId','deviceId'].every(k=>a[k]===b[k]);
/** Poll CFAPI metadata, never hydrate untouched documents to discover changes.
 * A stable path signature is only a debounce hint; the worker independently
 * hashes and freezes bytes and revalidates the persisted generation. */
function createWindowsEdits({manifest,agent,vault,changes,lock,noLinks,now=Date.now}) {
 const entries=new Map(manifest.catalog.filter(e=>!e.folder).map(e=>[e.key,e]));const observed=new Map();
 let stopped=false,busy=false,cursor=0;let report={editing:true,pending:0,blocked:0,conflicts:0,unavailable:0};
 async function authorized(){if(stopped||!same(await vault(),manifest.identity))throw new Error('Access refused');}
 async function scan() {
  if(stopped||busy)return;busy=true;
  try {
   await authorized();const keys=await changes();await authorized();
   if(!Array.isArray(keys)||keys.length>100||new Set(keys).size!==keys.length||keys.some(k=>!entries.has(k)))throw new Error('Invalid changes');
   const dirty=new Set(keys);for(const key of observed.keys())if(!dirty.has(key))observed.delete(key);
   const candidates=keys.length?[...keys.slice(cursor%keys.length),...keys.slice(0,cursor%keys.length)].slice(0,8):[];cursor+=candidates.length;
   for(const key of candidates) {
    const entry=entries.get(key);const file=path.join(manifest.directory,...entry.path.split('\\'));
    try {
     await noLinks(manifest.directory,file);const stat=await fs.lstat(file);
     if(!stat.isFile()||stat.size>50*1024*1024)throw new Error('Unsupported file');
     const signature=JSON.stringify([stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs]);let item=observed.get(key);
     if(!item||item.signature!==signature){item={signature,since:now(),captured:false,error:false};observed.set(key,item);continue;}
     if(item.captured||now()-item.since<2000)continue;
     await authorized();const release=await lock(key);if(!release){item.error=false;continue;}
     try {
       await authorized();const result=await agent.windowsPreview('upload',{identity:manifest.identity,projectId:manifest.projectId,rootKey:manifest.rootKey,key});await authorized();
       if(!result||typeof result.queued!=='boolean')throw new Error('Capture refused');
       item.error=false;if(!result.pending)item.captured=true;
     }finally{release();}
    }catch(error){if(stopped)break;const item=observed.get(key)||{captured:false};item.error=true;observed.set(key,item);}
   }
   await authorized();
   const response=await agent.documentStatuses([...entries.values()].map(e=>e.meta.nodeId));await authorized();
   if(!same(response?.identity,manifest.identity)||!Array.isArray(response.documents)||response.documents.length!==entries.size)throw new Error('Invalid status');
   const ids=new Set([...entries.values()].map(e=>e.meta.nodeId));const states=new Map();const seen=new Set();const pending=new Set([...observed].filter(([,i])=>!i.captured&&!i.error).map(([key])=>entries.get(key).meta.nodeId));let blocked=0,conflicts=0;
   for(const doc of response.documents) {
    if(!doc||!ids.has(doc.nodeId)||seen.has(doc.nodeId)||!['none','queued','uploading','retry','blocked','conflict','uploaded','reconciled'].includes(doc.state))throw new Error('Invalid status');seen.add(doc.nodeId);states.set(doc.nodeId,doc.state);
    if(['queued','uploading','retry'].includes(doc.state))pending.add(doc.nodeId);if(doc.state==='blocked')blocked++;if(doc.state==='conflict')conflicts++;
   }
   report={editing:true,pending:pending.size,blocked,conflicts,unavailable:[...observed].filter(([key,i])=>i.error&&!['conflict','blocked'].includes(states.get(entries.get(key).meta.nodeId))).length};
  }catch{if(!stopped)report={...report,unavailable:Math.max(1,report.unavailable)};}
  finally{busy=false;}
 }
 const timer=setInterval(()=>void scan(),2500);timer.unref();void scan();
 return {scan,status:()=>({...report}),stop:()=>{stopped=true;clearInterval(timer);}};
}
module.exports={createWindowsEdits};
