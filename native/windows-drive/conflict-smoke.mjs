// Actual CFAPI lock, generation switch, retained old directory and next save.
// The remote preservation receipt is synthetic; queue/digest authorization is
// separately exercised by driveShellActions and driveShellClassification tests.
import {createRequire} from 'node:module';import {spawn,execFileSync} from 'node:child_process';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {createWindowsMultiDrive}=createRequire(import.meta.url)('../../electron/windowsDriveMulti.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'archioffice-recovery-')),root=path.join(temp,'projects'),cacheRoot=path.join(temp,'cache'),identity={userId:'u',tenantId:'t',deviceId:'d'},key=hash('doc:p');
const executable=path.resolve('native/windows-drive/build/Release/archioffice-drive-cfapi.exe'),children=[];let version=1,preserved=null,conflict=true,captured=false;
const content=()=>Buffer.from(version===1?'baseline':'remote-v2');
const options={root,cacheRoot,namespaceRoot:path.join(temp,'namespace'),stateFile:path.join(temp,'selection.json'),executable,enabled:()=>true,login:async()=>{},shell:{openPath:async()=>''},vault:async()=>identity,
 spawn:(...args)=>{const child=spawn(...args);children.push({child,exit:new Promise(resolve=>child.once('exit',resolve))});return child;},agent:{documentStatuses:async ids=>({identity,documents:ids.map(nodeId=>({nodeId,state:conflict?'conflict':'none',...(preserved?{preservation:'done'}:{})}))}),windowsPreview:async(action,input)=>{
  if(action==='catalog'){const bytes=content();return {identity,entries:[{path:'_Project',key:hash('project:p'),folder:true,size:0},{path:'_Project\\_Plan.txt',key,folder:false,size:bytes.length,meta:{nodeId:'doc:p',version,name:'Plan.txt',size:bytes.length,sha256:sha(bytes)}}]};}
  if(action==='hydrate'){const bytes=Buffer.from(input.meta.version===1?'baseline':'remote-v2'),file=path.join(cacheRoot,hash(['u','t']),'downloads',hash(['u','t','doc:p',input.meta.version])+'.cache');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);return {file};}
  if(action==='conflictProof'){if(!preserved)throw Object.assign(new Error('not preserved'),{code:'CONFLICT_PRESERVATION_REQUIRED'});assert.equal(sha(await fs.readFile('A:\\_Project\\_Plan.txt')),preserved);return {identity,key,conflictId:'synthetic-receipt',nodeId:'doc:p',sha256:preserved};}
  if(action==='conflictReconcile'){assert.equal(input.version,2);conflict=false;return {identity,ok:true};}
  if(action==='upload'){if(conflict)throw new Error('conflict');captured=(await fs.readFile('A:\\_Project\\_Plan.txt','utf8'))==='post-recovery';return {queued:true};}
  throw new Error('unexpected action');
 }}};
const drive=createWindowsMultiDrive(options),settle=()=>Promise.all(children.map(c=>c.exit));
try{
 assert.equal((await drive.start('p')).status,'opened');await fs.readFile('A:\\_Project\\_Plan.txt');assert.equal((await drive.enableEditing('p')).status,'editing');
 const before=(await drive.shellSnapshot()).projects[0],old=await fs.realpath('A:\\_Project');await fs.writeFile('A:\\_Project\\_Plan.txt','preserved-local');version=2;
 assert.equal((await drive.resolveConflict('p',key,before.rootKey)).status,'error');assert.equal(await fs.realpath('A:\\_Project'),old);
 preserved=sha('preserved-local');const result=await drive.resolveConflict('p',key,before.rootKey);assert.equal(result.status,'refreshed',JSON.stringify(result));
 assert.equal(await fs.readFile(path.join(old,'_Plan.txt'),'utf8'),'preserved-local');assert.equal(await fs.readFile('A:\\_Project\\_Plan.txt','utf8'),'remote-v2');assert.equal(drive.status().editReports[0].editing,true);
 await fs.writeFile('A:\\_Project\\_Plan.txt','post-recovery');for(let i=0;i<80&&!captured;i++)await new Promise(resolve=>setTimeout(resolve,250));assert.ok(captured,'subsequent save was not captured');
 console.log('Native conflict recovery passed: refusal before preservation, locked generation switch, retained local bytes, remote hydration and next save.');
}finally{drive.shutdown();await settle();for(const owner of await fs.readdir(options.namespaceRoot).catch(()=>[])){const base=path.join(options.namespaceRoot,owner);for(const name of await fs.readdir(base))await fs.unlink(path.join(base,name));}
 for(const name of await fs.readdir(root).catch(()=>[]))if(name.endsWith('.json')){const saved=JSON.parse(await fs.readFile(path.join(root,name),'utf8'));if(!saved.catalog||!saved.directory)continue;try{execFileSync(executable,['--unregister',saved.directory],{stdio:'ignore'});}catch{}for(const entry of saved.catalog)if(!entry.folder)await fs.chmod(path.join(saved.directory,...entry.path.split('\\')),0o666).catch(()=>{});}
 await fs.rm(temp,{recursive:true,force:true});}
