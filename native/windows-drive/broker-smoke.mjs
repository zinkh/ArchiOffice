// Real CFAPI + the shipping Electron broker, with synthetic vault/agent data.
// No Electron runtime, npm install or live account is needed on the CI runner.
import {createRequire} from 'node:module';import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {createWindowsPreview}=createRequire(import.meta.url)('../../electron/windowsDrive.cjs');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'archioffice-broker-'));
const executable=path.resolve('native/windows-drive/build/Release/archioffice-drive-cfapi.exe');
const identity={userId:'test-user',tenantId:'test-tenant',deviceId:'test-device'};
const bytes=Buffer.from('ArchiOffice CFAPI broker integration: accès vérifié.');
const meta={nodeId:'doc:example',version:1,size:bytes.length,name:'Example.txt',sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
const cacheRoot=path.join(temporary,'cache');const file=path.join(cacheRoot,hash([identity.userId,identity.tenantId]),'downloads',hash([identity.userId,identity.tenantId,meta.nodeId,meta.version])+'.cache');
await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
let directory;let child;let exited;let requests=0;
const preview=createWindowsPreview({
 spawn:(...args)=> {assert.equal(args[2].env.DRIVE_LICENSE_PRIVATE_KEY,undefined);child=spawn(...args);exited=new Promise(resolve=>child.once('exit',resolve));return child;},
 agent:{windowsPreview:async(action,input)=> {
   if(action==='catalog')return {identity,entries:[{path:'_Project',key:'b'.repeat(64),folder:true,size:0},
    {path:'_Project\\_Example.txt',key:'a'.repeat(64),folder:false,size:bytes.length,meta},
    {path:'_Project\\_Denied.txt',key:'c'.repeat(64),folder:false,size:1,meta:{...meta,nodeId:'doc:denied',size:1}}]};
   requests++;assert.deepEqual(input.identity,identity);if(input.meta.nodeId==='doc:denied')throw new Error('Permission denied');return {file};
 }},
 vault:async()=>identity,root:path.join(temporary,'preview'),cacheRoot,executable,
 shell:{openPath:async value=>{directory=value;return '';}},enabled:()=>true,environment:{...process.env,DRIVE_LICENSE_PRIVATE_KEY:'must-not-reach-native'},
});
try {
 assert.deepEqual(await preview.start('project'),{status:'opened'});assert.ok(directory);
 assert.deepEqual(await fs.readFile(path.join(directory,'_Project','_Example.txt')),bytes);assert.ok(requests>0);
 await assert.rejects(fs.readFile(path.join(directory,'_Project','_Denied.txt')));
 preview.stop();assert.equal(await exited,0);
 assert.deepEqual(await fs.readFile(path.join(directory,'_Project','_Example.txt')),bytes);
 console.log('Windows broker smoke passed: shipping broker, scoped cache, native hydration and refusal.');
}finally{
 preview.stop();if(child&&child.exitCode===null){child.kill();await exited;}
 if(directory){try{execFileSync(executable,['--unregister',directory],{stdio:'inherit'});}catch{}await fs.chmod(path.join(directory,'_Project','_Example.txt'),0o666).catch(()=>{});}
 await fs.rm(temporary,{recursive:true,force:true});
}
