// Real A: mapping, collision protection, cleanup and crash recovery on Windows.
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
const executable=path.resolve('native/windows-drive/build/Release/archioffice-drive-cfapi.exe');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'archioffice-a-'));
const roots=[];const children=[];let foreign=false;
async function launch(previousRoot='') {
 const root=path.join(temp,'root-'+roots.length);await fs.mkdir(root);roots.push(root);
 const child=spawn(executable,[],{stdio:['pipe','pipe','inherit'],windowsHide:true});
 const exited=new Promise(resolve=>child.once('exit',resolve));children.push({child,exited});
 const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('A: provider timeout')),30000);let text='';
  child.stdout.on('data',chunk=>{text+=chunk.toString();let end;
   while((end=text.indexOf('\n'))>=0){const message=JSON.parse(text.slice(0,end));text=text.slice(end+1);
    if(message.type==='ready'||message.type==='error'){clearTimeout(timer);resolve(message);}
   }
  });child.once('exit',()=>{clearTimeout(timer);reject(new Error('Provider exited before ready'));});
 });
 child.stdin.write(JSON.stringify({type:'init',root,entries:[],mountA:true,previousRoot})+'\n');
 return {root,child,exited,message:await ready};
}
async function stop(session) {session.child.stdin.end(JSON.stringify({type:'stop'})+'\n');assert.equal(await session.exited,0);}
try {
 const first=await launch();assert.equal(first.message.type,'ready');
 await fs.writeFile(path.join(first.root,'sentinel.txt'),'ArchiOffice A:');assert.equal(await fs.readFile('A:\\sentinel.txt','utf8'),'ArchiOffice A:');
 // TerminateProcess skips destructors: recover only this exact saved mapping.
 first.child.kill();await first.exited;
 const recovered=await launch(first.root);assert.equal(recovered.message.type,'ready');
 await fs.writeFile(path.join(recovered.root,'reconnected.txt'),'restored');assert.equal(await fs.readFile('A:\\reconnected.txt','utf8'),'restored');
 await stop(recovered);await assert.rejects(fs.stat('A:\\'));
 // Another drive owns A:. Never replace or delete it, including on error exit.
 const other=path.join(temp,'other');await fs.mkdir(other);await fs.writeFile(path.join(other,'keep.txt'),'foreign');
 execFileSync('subst.exe',['A:',other]);foreign=true;
 const blocked=await launch();assert.equal(blocked.message.code,'DRIVE_LETTER_IN_USE');await blocked.exited;
 assert.equal(await fs.readFile('A:\\keep.txt','utf8'),'foreign');
 console.log('A: smoke passed: mapping, crash recovery, exact cleanup, occupied-letter protection.');
} finally {
 for(const {child,exited} of children){if(child.exitCode===null){child.stdin.end();await exited;}}
 if(foreign)execFileSync('subst.exe',['A:','/D']);
 for(const root of roots){try{execFileSync(executable,['--unregister',root],{stdio:'ignore'});}catch{}}
 await fs.rm(temp,{recursive:true,force:true});
}
