// Multiple real CFAPI project roots, one A: namespace, shipping Electron broker.
import {createRequire} from 'node:module';import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {createWindowsMultiDrive}=createRequire(import.meta.url)('../../electron/windowsDriveMulti.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'archioffice-multi-'));
const executable=path.resolve('native/windows-drive/build/Release/archioffice-drive-cfapi.exe');
let current={userId:'u',tenantId:'t',deviceId:'d'},catalogs=0,hydrates=0;const children=[],controllers=[],metas=new Map(),bytes=new Map();
const projectRoot=path.join(temp,'projects'),cacheRoot=path.join(temp,'cache'),stateFile=path.join(temp,'selection.json');
for(const id of ['p','q']) {
 const content=Buffer.from('ArchiOffice project '+id);bytes.set(id,content);
 const meta={nodeId:'doc:'+id,version:1,size:content.length,name:'Plan.txt',sha256:crypto.createHash('sha256').update(content).digest('hex')};metas.set(id,meta);
 const file=path.join(cacheRoot,hash(['u','t']),'downloads',hash(['u','t',meta.nodeId,1])+'.cache');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);
}
const options={root:projectRoot,namespaceRoot:path.join(temp,'namespace'),stateFile,cacheRoot,executable,enabled:()=>true,login:async()=>{},vault:async()=>current,
 shell:{openPath:async value=>{assert.equal(value,'A:\\');return '';}},environment:{...process.env,DRIVE_LICENSE_PRIVATE_KEY:'not-for-children'},
 spawn:(...args)=>{assert.equal(args[2].env.DRIVE_LICENSE_PRIVATE_KEY,undefined);const child=spawn(...args);const exited=new Promise(resolve=>child.once('exit',resolve));children.push({child,exited});return child;},
 agent:{windowsPreview:async(action,input)=>{
  if(action==='catalog'){catalogs++;const id=input.projectId,meta=metas.get(id);return {identity:{userId:'u',tenantId:'t',deviceId:'d'},entries:[{path:'_Project-'+id,key:hash('prj:'+id),folder:true,size:0},{path:'_Project-'+id+'\\_Plan.txt',key:hash(meta.nodeId),folder:false,size:meta.size,meta}]};}
  hydrates++;return {file:path.join(cacheRoot,hash(['u','t']),'downloads',hash(['u','t',input.meta.nodeId,1])+'.cache')};
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
 current={...current,tenantId:'other'};assert.equal((await second.open()).status,'error');await settle();await assert.rejects(fs.stat('A:\\'));
 assert.deepEqual(await fs.readFile(path.join(source,'_Plan.txt')),bytes.get('p'));
 console.log('Multi-project A: passed: simultaneous hydration, removal without deletion, stable re-add and restart, cabinet change refusal.');
} finally {
 for(const drive of controllers)drive.shutdown();await settle();
 // Synthetic test files only: detach verified junctions, unregister CFAPI roots.
 for(const owner of await fs.readdir(options.namespaceRoot).catch(()=>[])){const base=path.join(options.namespaceRoot,owner);for(const name of await fs.readdir(base))await fs.unlink(path.join(base,name));}
 for(const name of await fs.readdir(projectRoot).catch(()=>[]))if(name.endsWith('.json')) {
  const saved=JSON.parse(await fs.readFile(path.join(projectRoot,name),'utf8'));try{execFileSync(executable,['--unregister',saved.directory],{stdio:'ignore'});}catch{}
  for(const entry of saved.catalog)if(!entry.folder)await fs.chmod(path.join(saved.directory,entry.path),0o666).catch(()=>{});
 }
 await fs.rm(temp,{recursive:true,force:true});
}
