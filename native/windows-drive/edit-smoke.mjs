// Real CFAPI + shipping broker: opt-in edits, replace-save and restart.
import {createRequire} from 'node:module';import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {createWindowsMultiDrive}=createRequire(import.meta.url)('../../electron/windowsDriveMulti.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'archioffice-edit-'));const executable=path.resolve('native/windows-drive/build/Release/archioffice-drive-cfapi.exe');
const root=path.join(temp,'projects'),cacheRoot=path.join(temp,'cache'),identity={userId:'u',tenantId:'t',deviceId:'d'};let grant=identity;
const children=[],controllers=[],captures=[];let conflict=false;const baseline=Buffer.from('baseline');
const options={root,cacheRoot,namespaceRoot:path.join(temp,'namespace'),stateFile:path.join(temp,'selection.json'),executable,enabled:()=>true,login:async()=>{},shell:{openPath:async()=>''},vault:async()=>grant,
 spawn:(...args)=>{const child=spawn(...args);children.push({child,exited:new Promise(resolve=>child.once('exit',resolve))});return child;},
 agent:{documentStatuses:async ids=>({identity,documents:ids.map(nodeId=>({nodeId,state:conflict?'conflict':'none'}))}),windowsPreview:async(action,input)=>{
  if(action==='catalog'){const id=input.projectId;return {identity,entries:[{path:'_Project-'+id,key:hash('project:'+id),folder:true,size:0},{path:'_Project-'+id+'\\_Plan.txt',key:hash('doc:'+id),folder:false,size:baseline.length,meta:{nodeId:'doc:'+id,version:1,name:'Plan.txt',size:baseline.length,sha256:crypto.createHash('sha256').update(baseline).digest('hex')}}]};}
  if(action==='hydrate'){const meta=input.meta;const file=path.join(cacheRoot,hash(['u','t']),'downloads',hash(['u','t',meta.nodeId,meta.version])+'.cache');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,baseline);return {file};}
  assert.equal(action,'upload');assert.deepEqual(input.identity,identity);assert.equal(input.projectId,'p');assert.equal(input.file,undefined);assert.equal(input.meta,undefined);
  if(conflict)throw new Error('version conflict');
  const saved=JSON.parse(await fs.readFile(path.join(root,hash(['u','t','d','p'])+'.json'),'utf8'));assert.equal(saved.editable,true);assert.equal(saved.rootKey,input.rootKey);
  const entry=saved.catalog.find(e=>e.key===input.key);assert.ok(entry&&!entry.folder);const content=await fs.readFile(path.join(saved.directory,...entry.path.split('\\')));captures.push(Buffer.from(content));return {queued:true,jobId:'captured'};
 }}};
const make=()=>{const drive=createWindowsMultiDrive(options);controllers.push(drive);return drive;};
const file='A:\\_Project-p\\_Plan.txt';const wait=async predicate=>{for(let n=0;n<80&&!predicate();n++)await new Promise(resolve=>setTimeout(resolve,250));assert.ok(predicate(),'timed out waiting for stable save capture');};
const settle=()=>Promise.all(children.map(c=>c.exited));
try {
 const first=make();assert.equal((await first.start('p')).status,'opened');assert.equal((await first.start('q')).status,'opened');
 assert.deepEqual(await fs.readFile(file),baseline);await assert.rejects(fs.writeFile(file,'not opted in'));
 const target=await fs.realpath('A:\\_Project-p');const enabled=await first.enableEditing('p');assert.equal(enabled.status,'editing',JSON.stringify(enabled));assert.equal(await fs.realpath('A:\\_Project-p'),target);
 assert.deepEqual(await fs.readFile('A:\\_Project-q\\_Plan.txt'),baseline);await assert.rejects(fs.writeFile('A:\\_Project-q\\_Plan.txt','still readonly'));
 await fs.writeFile(file,'in-place save');await wait(()=>captures.some(b=>b.toString()==='in-place save'));
 const writer=await fs.open(file,'r+');try{await writer.truncate(0);await writer.writeFile('writer still open');await new Promise(resolve=>setTimeout(resolve,6000));assert.equal(captures.some(b=>b.toString()==='writer still open'),false);}finally{await writer.close();}
 await wait(()=>captures.some(b=>b.toString()==='writer still open'));
 const temporary='A:\\_Project-p\\save.tmp';await fs.writeFile(temporary,'atomic replacement save');await fs.rename(file,file+'.bak');await fs.rename(temporary,file);
 await wait(()=>captures.some(b=>b.toString()==='atomic replacement save'));assert.equal(await fs.readFile(file+'.bak','utf8'),'writer still open');
 assert.equal((await first.checkCatalog('p')).code,'DRIVE_LOCAL_CHANGES');first.shutdown();await settle();
 const second=make();const restored=await second.start('p');assert.equal(restored.status,'opened',JSON.stringify(restored));assert.equal(await fs.readFile(file,'utf8'),'atomic replacement save');assert.equal(await fs.realpath('A:\\_Project-p'),target);assert.equal(second.status().editReports[0].editing,true);
 conflict=true;await fs.writeFile(file,'local conflict preserved');await wait(()=>second.status().editReports[0]?.conflicts===1);assert.equal(await fs.readFile(file,'utf8'),'local conflict preserved');
 // Deletion is local-only and must not be silently repopulated on restart.
 await fs.unlink(file);second.shutdown();await settle();const third=make();assert.equal((await third.start('p')).status,'opened');await assert.rejects(fs.stat(file));
 assert.equal(await fs.readFile(file+'.bak','utf8'),'writer still open');
 grant={...identity,tenantId:'other'};assert.equal((await third.open()).status,'error');await settle();await assert.rejects(fs.stat('A:\\'));
 console.log('Editing passed: explicit opt-in, in-place and atomic saves, separate read-only project, dirty restart, conflict retention, no recreation after local delete, cabinet refusal.');
}finally {
 for(const drive of controllers)drive.shutdown();await settle();
 for(const owner of await fs.readdir(options.namespaceRoot).catch(()=>[])){const base=path.join(options.namespaceRoot,owner);for(const name of await fs.readdir(base))await fs.unlink(path.join(base,name));}
 for(const name of await fs.readdir(root).catch(()=>[]))if(name.endsWith('.json')){const saved=JSON.parse(await fs.readFile(path.join(root,name),'utf8'));if(!saved.catalog||!saved.directory)continue;try{execFileSync(executable,['--unregister',saved.directory],{stdio:'ignore'});}catch{}for(const e of saved.catalog)if(!e.folder)await fs.chmod(path.join(saved.directory,e.path),0o666).catch(()=>{});}
 await fs.rm(temp,{recursive:true,force:true});
}
