import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {createRequire} from 'node:module';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const {createWindowsMultiDrive}=createRequire(import.meta.url)('../electron/windowsDriveMulti.cjs');
const hash=(value:any)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity={userId:'u',tenantId:'t',deviceId:'d'};
let temp:string,config:any,frames:any[],children:any[],controllers:any[];
beforeEach(async()=>{
 temp=await fs.mkdtemp(path.join(os.tmpdir(),'drive-multi-'));frames=[];children=[];controllers=[];
 config={root:path.join(temp,'projects'),namespaceRoot:path.join(temp,'namespace'),stateFile:path.join(temp,'active.json'),cacheRoot:path.join(temp,'cache'),executable:'native.exe',enabled:()=>true,
  vault:vi.fn().mockResolvedValue({...identity,token:'private-token'}),login:vi.fn(),shell:{openPath:vi.fn().mockResolvedValue('')},
  agent:{windowsPreview:vi.fn(async(_action:string,input:any)=>({identity,entries:[{path:'_'+input.projectId,key:hash(input.projectId),folder:true,size:0}]}))},
  spawn:vi.fn(()=>{
   const child:any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.kill=()=>child.emit('exit',0);
   child.stdin.on('data',(bytes:Buffer)=>{for(const line of bytes.toString().trim().split('\n')){const msg=JSON.parse(line);frames.push(msg);
    if(msg.type==='init'||msg.type==='map')void(async()=>{if(msg.type==='init')for(const e of msg.entries)if(e.folder)await fs.mkdir(path.join(msg.root,e.path),{recursive:true});child.stdout.write(JSON.stringify({type:'ready'})+'\n');})();
    if(msg.type==='stop')queueMicrotask(()=>child.emit('exit',0));
   }});children.push(child);return child;
  })};
});
afterEach(async()=>{for(const controller of controllers)controller.shutdown();await new Promise(resolve=>setImmediate(resolve));await fs.rm(temp,{recursive:true,force:true});});
const make=()=>{const controller=createWindowsMultiDrive(config);controllers.push(controller);return controller;};
const namespace=()=>frames.find(f=>f.type==='map').root;
it('adds two projects through one A: mapping without moving their underlying directories',async()=>{
 const drive=make();expect(await drive.start('p')).toEqual({status:'opened'});const first=frames.find(f=>f.type==='init').root;
 expect(await drive.start('q')).toEqual({status:'opened'});expect(drive.status()).toMatchObject({active:true,projectCount:2,projectIds:['p','q']});
 expect(frames.filter(f=>f.type==='map')).toHaveLength(1);expect(frames.filter(f=>f.type==='stop')).toHaveLength(0);
 expect(await fs.realpath(path.join(namespace(),'_p'))).toBe(path.join(first,'_p'));expect(await fs.readdir(namespace())).toEqual(['_p','_q']);
 const selected=JSON.parse(await fs.readFile(config.stateFile,'utf8'));expect(selected.projectIds).toEqual(['p','q']);expect(JSON.stringify(selected)).not.toContain('private-token');
 expect(await drive.start('p')).toEqual({status:'opened'});expect(config.spawn).toHaveBeenCalledTimes(3);
});
it('restores the selected projects in the same namespace without fetching their catalogs again',async()=>{
 const first=make();await first.start('p');await first.start('q');const base=namespace();const original=frames.filter(f=>f.type==='init').map(f=>f.root);first.shutdown();
 await new Promise(resolve=>setImmediate(resolve));config.shell.openPath.mockClear();const next=make();next.resume();
 await vi.waitFor(()=>expect(next.status().projectCount).toBe(2));expect(namespace()).toBe(base);expect(config.agent.windowsPreview).toHaveBeenCalledTimes(2);
 expect(frames.filter(f=>f.type==='init').slice(-2).map(f=>f.root)).toEqual(original);expect(config.shell.openPath).not.toHaveBeenCalled();
});
it('preserves a healthy open project when adding another project fails',async()=>{
 const drive=make();await drive.start('p');config.agent.windowsPreview.mockRejectedValueOnce(new Error('Network unavailable'));
 expect((await drive.start('q')).status).toBe('error');expect(drive.status()).toMatchObject({active:true,projectCount:1,projectIds:['p']});
 expect(frames.filter(f=>f.type==='stop')).toHaveLength(0);expect(JSON.parse(await fs.readFile(config.stateFile,'utf8')).projectIds).toEqual(['p']);
});
it('removes only a selected junction and preserves all of that project’s files',async()=>{
 const drive=make();await drive.start('p');await drive.start('q');const source=frames.find(f=>f.type==='init').root;await fs.writeFile(path.join(source,'_p','local.txt'),'keep');
 expect(await drive.remove('p')).toEqual({status:'removed'});expect(drive.status()).toMatchObject({active:true,projectCount:1,projectIds:['q']});
 expect(await fs.readdir(namespace())).toEqual(['_q']);expect(await fs.readFile(path.join(source,'_p','local.txt'),'utf8')).toBe('keep');
 expect(await drive.start('p')).toEqual({status:'opened'});expect(await fs.readFile(path.join(namespace(),'_p','local.txt'),'utf8')).toBe('keep');
});
it('disconnects the last project and can add a different project afterwards',async()=>{
 const drive=make();await drive.start('p');expect(await drive.remove('p')).toEqual({status:'removed'});expect(drive.status()).toMatchObject({active:false,configured:false});
 expect(config.login).toHaveBeenLastCalledWith(false);expect(await drive.start('q')).toEqual({status:'opened'});expect(drive.status().projectIds).toEqual(['q']);
});
it('remembers the selected set when disconnected, but never reconnects it automatically',async()=>{
 const drive=make();await drive.start('p');await drive.start('q');await drive.disconnect();
 expect(JSON.parse(await fs.readFile(config.stateFile,'utf8')).autoConnect).toBe(false);expect(config.login).toHaveBeenLastCalledWith(false);
 const next=make();config.spawn.mockClear();next.resume();await new Promise(resolve=>setTimeout(resolve,30));expect(config.spawn).not.toHaveBeenCalled();
 expect(await next.start('p')).toEqual({status:'opened'});expect(next.status().projectIds).toEqual(['p','q']);
});
it('enforces the ten-project bound without disconnecting those already added',async()=>{
 const drive=make();for(let n=0;n<10;n++)expect((await drive.start('p'+n)).status).toBe('opened');const spawned=config.spawn.mock.calls.length;
 expect(await drive.start('extra')).toEqual({status:'error',code:'DRIVE_PROJECT_LIMIT'});expect(drive.status()).toMatchObject({active:true,projectCount:10});expect(config.spawn).toHaveBeenCalledTimes(spawned);
});
it.each(['foreign-entry','replaced-link'])('refuses a namespace with %s without deleting the unexpected path',async(mode)=>{
 const drive=make();await drive.start('p');const outside=path.join(temp,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep.txt'),'outside');
 const link=path.join(namespace(),mode==='foreign-entry'?'_Foreign':'_p');if(mode==='replaced-link')await fs.unlink(link);await fs.symlink(outside,link,'junction');
 expect(await drive.start('q')).toMatchObject({status:'error',code:'DRIVE_SNAPSHOT_INVALID'});expect(drive.status().active).toBe(false);
 expect(await fs.readFile(path.join(link,'keep.txt'),'utf8')).toBe('outside');
});
it('closes the namespace and its providers when the account changes',async()=>{
 const drive=make();await drive.start('p');await drive.start('q');config.vault.mockResolvedValue({...identity,tenantId:'other'});
 expect((await drive.start('third')).status).toBe('error');expect(drive.status().active).toBe(false);expect(frames.filter(f=>f.type==='stop')).toHaveLength(3);
});
it('does not auto-restore another cabinet’s saved selection',async()=>{
 const drive=make();await drive.start('p');drive.shutdown();await new Promise(resolve=>setImmediate(resolve));config.vault.mockResolvedValue({...identity,tenantId:'other'});config.spawn.mockClear();
 const next=make();next.resume();await new Promise(resolve=>setTimeout(resolve,30));expect(config.spawn).not.toHaveBeenCalled();
});
it('migrates the previous single-project selection without changing its project directory',async()=>{
 const {createPersistentWindowsDrive}=createRequire(import.meta.url)('../electron/windowsDrivePersistence.cjs');
 const previous=createPersistentWindowsDrive(config);await previous.start('p');const saved=JSON.parse(await fs.readFile(config.stateFile,'utf8'));previous.shutdown();await new Promise(resolve=>setImmediate(resolve));
 const drive=make();expect(await drive.start('q')).toEqual({status:'opened'});expect(drive.status().projectIds).toEqual(['p','q']);
 expect(await fs.realpath(path.join(frames.filter(f=>f.type==='map').at(-1).root,'_p'))).toBe(path.join(saved.directory,'_p'));expect(config.agent.windowsPreview).toHaveBeenCalledTimes(2);
});
it('refuses to remove a substituted junction, preserving the foreign target and original project',async()=>{
 const drive=make();await drive.start('p');const original=frames.find(f=>f.type==='init').root;
 const outside=path.join(temp,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep.txt'),'keep');const link=path.join(namespace(),'_p');await fs.unlink(link);await fs.symlink(outside,link,'junction');
 expect(await drive.remove('p')).toMatchObject({status:'error',code:'DRIVE_SNAPSHOT_INVALID'});expect(await fs.readFile(path.join(link,'keep.txt'),'utf8')).toBe('keep');expect((await fs.stat(original)).isDirectory()).toBe(true);
});
it('allows disconnecting even if the selection file was corrupted',async()=>{
 const drive=make();await drive.start('p');await fs.writeFile(config.stateFile,'corrupt');await drive.disconnect();
 expect(drive.status()).toMatchObject({active:false,configured:false});expect(config.login).toHaveBeenLastCalledWith(false);expect(frames.filter(f=>f.type==='stop')).toHaveLength(2);
});
it('validates the current identity before returning project IDs to a new renderer context',async()=>{
 const drive=make();await drive.start('p');config.vault.mockResolvedValue({...identity,userId:'new-user'});
 expect(await drive.getStatus()).toMatchObject({active:false,projectCount:0,projectIds:[]});expect(frames.filter(f=>f.type==='stop')).toHaveLength(2);
});
