import {promisify} from 'node:util';
const exec=promisify(execFile);
import {spawn,execFile,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const executable=path.resolve(process.argv[2]||'native/windows-drive/build/Release/archioffice-drive-cfapi.exe');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'archioffice-cfapi-'));const root=path.join(temporary,'root');await fs.mkdir(root);
const source=path.join(temporary,'verified-cache');const bytes=Buffer.from(Array.from({length:9001},(_,i)=>i%251));await fs.writeFile(source,bytes);
const key=crypto.createHash('sha256').update('doc:smoke').digest('hex');const denied='f'.repeat(64);const directory='_Projet-é';const name='_Plan-é.txt';
let child;let registered=false;let hydrated=0;
try {
  child=spawn(executable,[],{stdio:['pipe','pipe','inherit'],windowsHide:true});let text='';
  const exited=new Promise((resolve,reject)=>{child.once('exit',(code)=>resolve(code));child.once('error',reject);});
  const ready=new Promise((resolve,reject)=> {
    const timer=setTimeout(()=>reject(new Error('Native ready timeout')),60000);
    child.stdout.on('data',chunk=> {
      text+=chunk.toString();let newline;
      while((newline=text.indexOf('\n'))>=0){const msg=JSON.parse(text.slice(0,newline));text=text.slice(newline+1);
        if(msg.type==='ready'){registered=true;clearTimeout(timer);resolve();}
        if(msg.type==='error'){clearTimeout(timer);reject(new Error('Native failure HRESULT '+msg.hresult));}
        if(msg.type==='hydrate'){
          hydrated++;child.stdin.write(JSON.stringify({type:'hydrated',requestId:msg.requestId,...(msg.key===key?{file:source}:{})})+'\n');
        }
      }
    });
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('Native exited before ready'));});
  });
  child.stdin.write(JSON.stringify({type:'init',root,entries:[
    {path:directory,key:'a'.repeat(64),folder:true,size:0},
    {path:directory+'\\'+name,key,folder:false,size:bytes.length},
    {path:directory+'\\_Denied.txt',key:denied,folder:false,size:5},
  ]})+'\n');await ready;
  const file=path.join(root,directory,name);
  const attributes=(await exec('powershell.exe',['-NoProfile','-Command',`(Get-Item -LiteralPath '${file.replaceAll("'","''")}').Attributes.ToString()`],{encoding:'utf8'})).stdout;
  assert.match(attributes,/ReparsePoint/);assert.equal((await fs.stat(file)).size,bytes.length);
  assert.deepEqual(await fs.readFile(file),bytes);assert.ok(hydrated>0,'CFAPI hydration callback was not exercised');
  await assert.rejects(fs.readFile(path.join(root,directory,'_Denied.txt')));
  child.stdin.end(JSON.stringify({type:'stop'})+'\n');assert.equal(await exited,0);
  // Disconnection retains hydrated bytes; there is no unregister on app quit.
  assert.deepEqual(await fs.readFile(file),bytes);
  console.log('CFAPI smoke passed: placeholder, Unicode path, hydration bytes, refusal and disconnection.');
} finally {
  if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  // Only this synthetic test tree is explicitly unregistered. Windows removes
  // its unhydrated placeholders; this is never run on the user's preview root.
  if(registered){try{execFileSync(executable,['--unregister',root],{stdio:'inherit'});}catch{}}
  await fs.chmod(path.join(root,directory,name),0o666).catch(()=>{});await fs.rm(temporary,{recursive:true,force:true});
}
