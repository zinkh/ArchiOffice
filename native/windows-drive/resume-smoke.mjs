// Shipping persistence + broker + real CFAPI, across two independent processes.
import {createRequire} from 'node:module';import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {createPersistentWindowsDrive}=createRequire(import.meta.url)('../../electron/windowsDrivePersistence.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'archioffice-resume-'));
const executable=path.resolve('native/windows-drive/build/Release/archioffice-drive-cfapi.exe');
const identity={userId:'u',tenantId:'t',deviceId:'d'};const contents=new Map([['doc:one',Buffer.from('First version')],['doc:two',Buffer.from('Second version')]]);
const metadata=[...contents].map(([nodeId,bytes])=>({nodeId,version:1,size:bytes.length,name:nodeId.slice(4)+'.txt',sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));
const cacheRoot=path.join(temp,'cache');const roots=[];const children=[];const controllers=[];let catalogs=0,hydrates=0,offline=false;
for(const meta of metadata){const file=path.join(cacheRoot,hash(['u','t']),'downloads',hash(['u','t',meta.nodeId,1])+'.cache');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,contents.get(meta.nodeId));}
const config={
 root:path.join(temp,'projects'),stateFile:path.join(temp,'active.json'),cacheRoot,executable,enabled:()=>true,login:async()=>{},vault:async()=>identity,shell:{openPath:async p=>{assert.equal(p,'A:\\');return '';}},
 spawn:(...args)=>{const child=spawn(...args);const exited=new Promise(resolve=>child.once('exit',resolve));children.push({child,exited});return child;},
 agent:{windowsPreview:async(action,input)=>{
  if(action==='catalog'){catalogs++;if(offline)throw new Error('Network unavailable');return {identity,entries:[{path:'_Project',folder:true,size:0,key:'f'.repeat(64)},...metadata.map(meta=>({path:'_Project\\_'+meta.name,key:hash(meta.nodeId),folder:false,size:meta.size,meta}))]};}
  hydrates++;assert.deepEqual(input.identity,identity);return {file:path.join(cacheRoot,hash(['u','t']),'downloads',hash(['u','t',input.meta.nodeId,1])+'.cache')};
 }},
};
const make=()=>{const drive=createPersistentWindowsDrive(config);controllers.push(drive);return drive;};
async function stop(drive){drive.shutdown();await children.at(-1).exited;}
try {
 const first=make();assert.equal((await first.start('p')).status,'opened');
 const saved=JSON.parse(await fs.readFile(config.stateFile,'utf8'));const directory=saved.directory;roots.push(directory);
 assert.deepEqual(await fs.readFile('A:\\_Project\\_one.txt'),contents.get('doc:one'));assert.equal(hydrates,1);await stop(first);
 await fs.writeFile(path.join(directory,'local-keep.txt'),'local addition');offline=true;
 const second=make();const reopened=await second.start('p');assert.equal(reopened.status,'opened',JSON.stringify(reopened));
 assert.equal(JSON.parse(await fs.readFile(config.stateFile,'utf8')).directory,directory);assert.equal(catalogs,1);
 assert.deepEqual(await fs.readFile('A:\\_Project\\_one.txt'),contents.get('doc:one'));assert.equal(hydrates,1,'A hydrated file must not download again');
 assert.deepEqual(await fs.readFile('A:\\_Project\\_two.txt'),contents.get('doc:two'));assert.equal(hydrates,2,'A previous placeholder must hydrate through the new process');
 assert.equal(await fs.readFile('A:\\local-keep.txt','utf8'),'local addition');await stop(second);
 // Replace a managed file while disconnected: no overwrite and no new tree.
 const replaced=path.join(directory,'_Project','_one.txt');await fs.chmod(replaced,0o666);await fs.unlink(replaced);await fs.writeFile(replaced,'User changes');
 const third=make();const refused=await third.start('p');assert.equal(refused.status,'error');await stop(third);
 assert.equal(await fs.readFile(replaced,'utf8'),'User changes');assert.equal(await fs.readFile(path.join(directory,'local-keep.txt'),'utf8'),'local addition');assert.equal(catalogs,1);
 console.log('Stable reconnect passed: same directory, offline catalog, hydrated bytes retained, old placeholder hydrated, local replacement preserved and blocked.');
}finally{
 for(const drive of controllers)drive.shutdown();
 for(const {child,exited} of children){if(child.exitCode===null){child.stdin.end();await exited;}}
 for(const root of roots){try{execFileSync(executable,['--unregister',root],{stdio:'ignore'});}catch{}}
 for(const root of roots)for(const meta of metadata)await fs.chmod(path.join(root,'_Project','_'+meta.name),0o666).catch(()=>{});
 await fs.rm(temp,{recursive:true,force:true});
}
