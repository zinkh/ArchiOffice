// Real catalog refresh, archive preservation and interrupted-switch recovery.
import {createRequire} from 'node:module';import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {createWindowsMultiDrive}=createRequire(import.meta.url)('../../electron/windowsDriveMulti.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'archioffice-refresh-'));
const executable=path.resolve('native/windows-drive/build/Release/archioffice-drive-cfapi.exe');
let current={userId:'u',tenantId:'t',deviceId:'d'},catalogs=0,hydrates=0;const versions=new Map([['p',1],['q',1]]);const children=[],controllers=[],metas=new Map(),bytes=new Map();
const projectRoot=path.join(temp,'projects'),cacheRoot=path.join(temp,'cache'),stateFile=path.join(temp,'selection.json');
for(const id of ['p','q','p2','p3','p-added']) {
 const content=Buffer.from('ArchiOffice project '+id);bytes.set(id,content);
 const meta={nodeId:'doc:'+(id==='p2'||id==='p3'?'p':id),version:id==='p2'?2:id==='p3'?3:1,size:content.length,name:'Plan.txt',sha256:crypto.createHash('sha256').update(content).digest('hex')};metas.set(id,meta);
 const file=path.join(cacheRoot,hash(['u','t']),'downloads',hash(['u','t',meta.nodeId,meta.version])+'.cache');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);
}
const options={root:projectRoot,namespaceRoot:path.join(temp,'namespace'),stateFile,cacheRoot,executable,enabled:()=>true,login:async()=>{},vault:async()=>current,
 shell:{openPath:async value=>{assert.ok(value==='A:\\'||value.startsWith(projectRoot));return '';}},environment:{...process.env,DRIVE_LICENSE_PRIVATE_KEY:'not-for-children'},
 spawn:(...args)=>{assert.equal(args[2].env.DRIVE_LICENSE_PRIVATE_KEY,undefined);const child=spawn(...args);const exited=new Promise(resolve=>child.once('exit',resolve));children.push({child,exited});return child;},
 agent:{windowsPreview:async(action,input)=>{
  if(action==='catalog'){catalogs++;const id=input.projectId,meta=metas.get(id==='p'&&versions.get(id)>1?'p'+versions.get(id):id);return {identity:{userId:'u',tenantId:'t',deviceId:'d'},entries:[{path:'_Project-'+id,key:hash('prj:'+id),folder:true,size:0},{path:'_Project-'+id+'\\_Plan.txt',key:hash(meta.nodeId),folder:false,size:meta.size,meta},...(id==='p'&&versions.get(id)>1?[{path:'_Project-p\\_Added.txt',key:hash('doc:p-added'),folder:false,size:metas.get('p-added').size,meta:metas.get('p-added')}]:[])]};}
  hydrates++;return {file:path.join(cacheRoot,hash(['u','t']),'downloads',hash(['u','t',input.meta.nodeId,input.meta.version])+'.cache')};
 }},
};
const make=()=>{const drive=createWindowsMultiDrive(options);controllers.push(drive);return drive;};
async function settle(){await Promise.all(children.map(item=>item.exited));}
const file=id=>'A:\\_Project-'+id+'\\_Plan.txt';
try {
 const first=make();assert.equal((await first.start('p')).status,'opened');const source=await fs.realpath('A:\\_Project-p');
 assert.deepEqual(await fs.readFile(file('p')),bytes.get('p'));
 const added=await first.start('q');assert.equal(added.status,'opened',JSON.stringify(added));assert.equal(first.status().projectCount,2);assert.equal(children.length,3);
 assert.deepEqual(await fs.readFile(file('q')),bytes.get('q'));assert.deepEqual(await fs.readFile(file('p')),bytes.get('p'));assert.equal(hydrates,2);
 assert.equal((await first.remove('p')).status,'removed');assert.equal(first.status().projectCount,1);await assert.rejects(fs.stat('A:\\_Project-p'));
 assert.deepEqual(await fs.readFile(path.join(source,'_Plan.txt')),bytes.get('p'));
 assert.equal((await first.start('p')).status,'opened');assert.equal(await fs.realpath('A:\\_Project-p'),source);assert.equal(catalogs,2);
 const base=JSON.parse(await fs.readFile(stateFile,'utf8')).directory;first.shutdown();await settle();
 const second=make();second.resume();for(let n=0;n<120&&second.status().projectCount!==2;n++)await new Promise(resolve=>setTimeout(resolve,250));
 assert.equal(second.status().projectCount,2,JSON.stringify(second.status()));assert.equal(JSON.parse(await fs.readFile(stateFile,'utf8')).directory,base);
 assert.equal(await fs.realpath('A:\\_Project-p'),source);assert.deepEqual(await fs.readFile(file('p')),bytes.get('p'));assert.deepEqual(await fs.readFile(file('q')),bytes.get('q'));assert.equal(catalogs,2);assert.equal(hydrates,2);
 versions.set('p',2);const plan=await second.checkCatalog('p');assert.equal(plan.status,'update_available',JSON.stringify(plan));assert.equal(plan.added,1);assert.equal(plan.updated,1);
 const refreshed=await second.refreshCatalog('p',plan.token);assert.equal(refreshed.status,'refreshed',JSON.stringify(refreshed));
 assert.deepEqual(await fs.readFile(file('p')),bytes.get('p2'));assert.deepEqual(await fs.readFile('A:\\_Project-p\\_Added.txt'),bytes.get('p-added'));assert.deepEqual(await fs.readFile(file('q')),bytes.get('q'));
 assert.deepEqual(await fs.readFile(path.join(source,'_Plan.txt')),bytes.get('p'));assert.equal((await second.openPrevious('p')).status,'copies_shown');
 versions.set('p',3);const next=await second.checkCatalog('p');assert.equal(next.status,'update_available');const rename=fs.rename;let interrupted=false;
 fs.rename=async(from,to)=>{if(!interrupted&&String(from).endsWith('.new')){interrupted=true;throw Object.assign(new Error('simulated sharing violation'),{code:'EACCES'});}return rename(from,to);};
 const failed=await second.refreshCatalog('p',next.token);fs.rename=rename;assert.equal(failed.code,'DRIVE_REFRESH_INTERRUPTED',JSON.stringify(failed));second.shutdown();await settle();
 const third=make();third.resume();for(let n=0;n<120&&third.status().projectCount!==2;n++)await new Promise(resolve=>setTimeout(resolve,250));
 assert.equal(third.status().projectCount,2,JSON.stringify(third.status()));assert.deepEqual(await fs.readFile(file('p')),bytes.get('p3'));assert.deepEqual(await fs.readFile(file('q')),bytes.get('q'));
 const changed=await fs.realpath('A:\\_Project-p');await fs.chmod(file('p'),0o666);await fs.writeFile(file('p'),'local edits');
 const blocked=await third.checkCatalog('p');assert.equal(blocked.code,'DRIVE_LOCAL_CHANGES',JSON.stringify(blocked));assert.equal(third.status().projectCount,2);assert.equal(await fs.readFile(path.join(changed,'_Plan.txt'),'utf8'),'local edits');
 current={...current,tenantId:'other'};assert.equal((await third.open()).status,'error');await settle();await assert.rejects(fs.stat('A:\\'));
 assert.deepEqual(await fs.readFile(path.join(source,'_Plan.txt')),bytes.get('p'));
 console.log('Catalog refresh passed: reviewed changes, new hydration, old copies retained, interrupted switch recovered, local edits blocked and cabinet change refused.');
} finally {
 for(const drive of controllers)drive.shutdown();await settle();
 // Synthetic test files only: detach verified junctions, unregister CFAPI roots.
 for(const root of [options.namespaceRoot,options.namespaceRoot+'-updates'])for(const owner of await fs.readdir(root).catch(()=>[])){const base=path.join(root,owner);for(const name of await fs.readdir(base))await fs.unlink(path.join(base,name));}
 for(const name of await fs.readdir(projectRoot).catch(()=>[]))if(name.endsWith('.json')) {
  const saved=JSON.parse(await fs.readFile(path.join(projectRoot,name),'utf8'));if(!Array.isArray(saved.catalog)||typeof saved.directory!=='string')continue;try{execFileSync(executable,['--unregister',saved.directory],{stdio:'ignore'});}catch{}
  for(const entry of saved.catalog)if(!entry.folder)await fs.chmod(path.join(saved.directory,entry.path),0o666).catch(()=>{});
 }
 await fs.rm(temp,{recursive:true,force:true});
}
