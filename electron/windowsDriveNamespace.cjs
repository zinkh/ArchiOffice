'use strict';
const fs=require('fs/promises');const path=require('path');const crypto=require('crypto');
const {noLinks}=require('./windowsDrive.cjs');const {agentEnvironment}=require('./driveAgent.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a,b)=>a&&b&&['userId','tenantId','deviceId'].every(k=>typeof a[k]==='string'&&a[k]===b[k]);
const error=code=>Object.assign(new Error(code),{code});
const normalized=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);

// A: points at a per-identity namespace. Only broker-owned junctions, whose
// targets have just passed CFAPI validation, may be exposed in this directory.
function createWindowsNamespace({spawn,executable,root,projectRoot,vault,environment=process.env}) {
 let mount=null;let closing=Promise.resolve();
 const directory=identity=>path.join(root,hash([identity.userId,identity.tenantId,identity.deviceId]));
 function stop() {
  const old=mount;mount=null;if(!old)return;
  if(old.exited)return;
  closing=new Promise(resolve=>{
   const timer=setTimeout(()=>{old.child.kill();resolve();},6000);timer.unref();
   old.child.once('exit',()=>{clearTimeout(timer);resolve();});
  });
  try{old.child.stdin.end(JSON.stringify({type:'stop'})+'\n');}catch{}
 }
 async function prepare(identity,snapshots) {
  if(!same(await vault(),identity))throw error('DRIVE_UNAVAILABLE');
  await fs.mkdir(root,{recursive:true,mode:0o700});await noLinks(root,root);
  const base=directory(identity);await fs.mkdir(base,{recursive:true,mode:0o700});await noLinks(root,base);
  const links=[];const names=new Set();
  for(const saved of snapshots) {
   if(!same(saved.identity,identity)||path.dirname(saved.directory)!==path.resolve(projectRoot))throw error('DRIVE_SNAPSHOT_INVALID');
   const first=saved.catalog[0];
   const name=first?.folder&&typeof first.path==='string'&&!first.path.includes('\\')?first.path:'_Projet-'+hash(saved.projectId).slice(0,12);
   if(!/^_[^<>:"/\\|?*\x00-\x1f]{1,119}$/.test(name)||/[. ]$/.test(name)||names.has(name.toLowerCase()))throw error('DRIVE_SNAPSHOT_INVALID');
   names.add(name.toLowerCase());
   const target=first?.folder?path.join(saved.directory,name):saved.directory;
   await noLinks(projectRoot,target);if(!(await fs.stat(target)).isDirectory())throw error('DRIVE_SNAPSHOT_INVALID');
   links.push({name,target});
  }
  // Extra files/junctions are preserved, but prevent mapping an unverified tree.
  const expected=new Map(links.map(link=>[link.name,link.target]));
  for(const name of await fs.readdir(base)) {
   const target=expected.get(name);const link=path.join(base,name);
   if(!target||!(await fs.lstat(link)).isSymbolicLink()||normalized(await fs.realpath(link))!==normalized(await fs.realpath(target)))throw error('DRIVE_SNAPSHOT_INVALID');
  }
  for(const {name,target} of links) {
   const link=path.join(base,name);
   try{await fs.lstat(link);}catch(e){if(e.code!=='ENOENT')throw e;await fs.symlink(target,link,'junction');}
  }
  if(!same(await vault(),identity))throw error('DRIVE_UNAVAILABLE');return base;
 }
 async function start(identity,base,previousRoot='') {
  if(!same(await vault(),identity)||base!==directory(identity))throw error('DRIVE_UNAVAILABLE');
  if(mount){if(!same(mount.identity,identity)||mount.root!==base)throw error('DRIVE_UNAVAILABLE');return;}
  await closing;
  if(!same(await vault(),identity))throw error('DRIVE_UNAVAILABLE');
  const child=spawn(executable,[],{stdio:['pipe','pipe','ignore'],windowsHide:true,env:agentEnvironment(environment)});
  const state={child,root:base,identity,exited:false};mount=state;
  try {
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{reject(error('DRIVE_UNAVAILABLE'));stop();},30000);let text='';
    const fail=()=>{clearTimeout(timer);reject(error('DRIVE_UNAVAILABLE'));if(mount===state)stop();};
    child.once('error',fail);child.once('exit',()=>{state.exited=true;if(mount===state)mount=null;fail();});
    child.stdout.on('data',chunk=>{
     text+=chunk.toString('utf8');if(text.length>65536){fail();return;}let end;
     while((end=text.indexOf('\n'))>=0){let msg;try{msg=JSON.parse(text.slice(0,end));}catch{fail();return;}text=text.slice(end+1);
      if(msg.type==='ready'){clearTimeout(timer);resolve();}
      else if(msg.type==='error'){clearTimeout(timer);reject(error(msg.code==='DRIVE_LETTER_IN_USE'?msg.code:'DRIVE_UNAVAILABLE'));if(mount===state)stop();}
     }
    });
    child.stdin.write(JSON.stringify({type:'map',root:base,previousRoot})+'\n');
   });
   if(mount!==state||!same(await vault(),identity))throw error('DRIVE_UNAVAILABLE');
  }catch(e){if(mount===state)stop();throw e;}
 }
 async function remove(identity,saved) {
  if(!same(await vault(),identity)||!same(saved.identity,identity)||path.dirname(saved.directory)!==path.resolve(projectRoot))throw error('DRIVE_SNAPSHOT_INVALID');
  const first=saved.catalog[0];const name=first?.folder&&typeof first.path==='string'&&!first.path.includes('\\')?first.path:'_Projet-'+hash(saved.projectId).slice(0,12);
  if(!/^_[^<>:"/\\|?*\x00-\x1f]{1,119}$/.test(name)||/[. ]$/.test(name))throw error('DRIVE_SNAPSHOT_INVALID');
  const base=directory(identity);await noLinks(root,base);
  const target=first?.folder?path.join(saved.directory,name):saved.directory;await noLinks(projectRoot,target);
  const link=path.join(base,name);
  if(!(await fs.lstat(link)).isSymbolicLink()||normalized(await fs.realpath(link))!==normalized(await fs.realpath(target)))throw error('DRIVE_SNAPSHOT_INVALID');
  // unlink removes only this verified junction, never the project directory.
  await fs.unlink(link);
 }
 return {prepare,start,stop,remove,directory,status:()=>({active:!!mount})};
}
module.exports={createWindowsNamespace};
