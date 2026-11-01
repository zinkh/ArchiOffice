import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createRequire} from 'node:module';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const {createPersistentWindowsDrive}=createRequire(import.meta.url)('../electron/windowsDrivePersistence.cjs');
let directory:string,config:any,children:any[],frames:any[],drives:any[];
const identity={userId:'u',tenantId:'t',deviceId:'d'};
beforeEach(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'drive-a-'));children=[];frames=[];drives=[];
 config={root:path.join(directory,'snapshots'),stateFile:path.join(directory,'drive.json'),cacheRoot:path.join(directory,'cache'),executable:'native.exe',enabled:()=>true,
 vault:vi.fn().mockResolvedValue({...identity,token:'never-persist-this'}),login:vi.fn(),shell:{openPath:vi.fn().mockResolvedValue('')},
 agent:{windowsPreview:vi.fn().mockResolvedValue({identity,entries:[]})},
 spawn:vi.fn(()=>{
  const child:any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.kill=()=>child.emit('exit',0);
  child.stdin.on('data',(bytes:Buffer)=>{
   for(const line of bytes.toString().trim().split('\n')){
    const msg=JSON.parse(line);frames.push(msg);
    if(msg.type==='init')queueMicrotask(()=>child.stdout.write(JSON.stringify({type:'ready'})+'\n'));
    if(msg.type==='stop')queueMicrotask(()=>child.emit('exit',0));
   }
  });children.push(child);return child;
 })};
});
afterEach(async()=>{for(const drive of drives)drive.shutdown();await new Promise(resolve=>setImmediate(resolve));await fs.rm(directory,{recursive:true,force:true});});
const make=()=>{const drive=createPersistentWindowsDrive(config);drives.push(drive);return drive;};
it('mounts A: on explicit activation and persists identifiers without credentials',async()=>{
 const drive=make();expect(await drive.start('project')).toEqual({status:'opened'});
 expect(config.shell.openPath).toHaveBeenCalledWith('A:\\');expect(config.login).toHaveBeenCalledWith(true);
 expect(frames[0]).toMatchObject({type:'init',mountA:true,previousRoot:''});
 const stored=await fs.readFile(config.stateFile,'utf8');expect(stored).not.toContain('never-persist');expect(JSON.parse(stored)).toMatchObject({identity,projectId:'project'});
 expect(drive.status()).toMatchObject({active:true,configured:true,letter:'A:'});
});
it('reconnects after a restart without opening Explorer and retains the previous snapshot',async()=>{
 const first=make();await first.start('project');const saved=JSON.parse(await fs.readFile(config.stateFile,'utf8'));first.shutdown();
 await new Promise(resolve=>setImmediate(resolve));config.shell.openPath.mockClear();
 const second=make();second.resume();await vi.waitFor(()=>expect(second.status().active).toBe(true));
 expect(config.shell.openPath).not.toHaveBeenCalled();expect(frames.filter(f=>f.type==='init')[1].previousRoot).toBe(saved.directory);
 await expect(fs.stat(saved.directory)).resolves.toBeDefined();
});
it.each(['expired','tenant','device'])('does not restore a saved mount for %s authorization',async(mode)=>{
 const first=make();await first.start('project');first.shutdown();config.spawn.mockClear();
 if(mode==='expired')config.vault.mockRejectedValue(new Error('expired'));
 else config.vault.mockResolvedValue({...identity,...(mode==='tenant'?{tenantId:'other'}:{deviceId:'new'})});
 const next=make();next.resume();await new Promise(resolve=>setTimeout(resolve,30));expect(config.spawn).not.toHaveBeenCalled();expect(next.status().active).toBe(false);
});
it('disconnect disables logon and forgets reconnection without deleting downloaded snapshots',async()=>{
 const drive=make();await drive.start('p');const saved=JSON.parse(await fs.readFile(config.stateFile,'utf8'));
 await fs.writeFile(path.join(saved.directory,'local.txt'),'keep');await drive.disconnect();
 expect(config.login).toHaveBeenLastCalledWith(false);await expect(fs.stat(config.stateFile)).rejects.toMatchObject({code:'ENOENT'});
 expect(await fs.readFile(path.join(saved.directory,'local.txt'),'utf8')).toBe('keep');
 const next=make();config.spawn.mockClear();next.resume();await new Promise(resolve=>setTimeout(resolve,30));expect(config.spawn).not.toHaveBeenCalled();
});
it('reports an occupied A: without claiming success or enabling logon',async()=>{
 config.spawn.mockImplementationOnce(()=>{
  const child:any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.kill=()=>child.emit('exit',1);
  child.stdin.once('data',()=>queueMicrotask(()=>{child.stdout.write(JSON.stringify({type:'error',code:'DRIVE_LETTER_IN_USE'})+'\n');child.emit('exit',1);}));return child;
 });
 const drive=make();expect(await drive.start('p')).toEqual({status:'error',code:'DRIVE_LETTER_IN_USE'});
 expect(drive.status()).toMatchObject({active:false,error:'DRIVE_LETTER_IN_USE'});expect(config.login).not.toHaveBeenCalled();expect(config.shell.openPath).not.toHaveBeenCalled();
});
it('refuses a persisted path outside the private snapshot directory',async()=>{
 await fs.writeFile(config.stateFile,JSON.stringify({projectId:'p',identity,directory}));const drive=make();drive.resume();
 await new Promise(resolve=>setTimeout(resolve,30));expect(config.spawn).not.toHaveBeenCalled();
});
it('refuses to reopen A: when the vault changes identity',async()=>{
 const drive=make();await drive.start('p');config.vault.mockResolvedValue({...identity,tenantId:'other'});config.shell.openPath.mockClear();
 expect(await drive.open()).toEqual({status:'error'});expect(config.shell.openPath).not.toHaveBeenCalled();
});
it('does not reconnect when the user disconnects while startup is waiting for the vault',async()=>{
 const first=make();await first.start('p');first.shutdown();await new Promise(resolve=>setImmediate(resolve));
 let release:any;config.vault.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));config.spawn.mockClear();
 const next=make();next.resume();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 await next.disconnect();release(identity);await new Promise(resolve=>setTimeout(resolve,30));
 expect(config.spawn).not.toHaveBeenCalled();expect(next.status().active).toBe(false);
 await expect(fs.stat(config.stateFile)).rejects.toMatchObject({code:'ENOENT'});
});
