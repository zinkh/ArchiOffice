import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {createRequire} from 'node:module';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const {createWindowsPreview}=createRequire(import.meta.url)('../electron/windowsDrive.cjs');
const hash=(x:any)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const identity={userId:'u',tenantId:'t',deviceId:'d'};const meta={nodeId:'doc:plan',version:1,name:'Plan.pdf',size:5,sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
let root:string;let child:any;let config:any;let frames:any[];let file:string;
beforeEach(async()=> {
 root=await fs.mkdtemp(path.join(os.tmpdir(),'drive-windows-'));frames=[];child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.kill=vi.fn(()=>child.emit('exit',0));
 child.stdin.on('data',(data:Buffer)=>{for(const line of data.toString().trim().split('\n')){const msg=JSON.parse(line);frames.push(msg);if(msg.type==='init')queueMicrotask(()=>child.stdout.write(JSON.stringify({type:'ready'})+'\n'));if(msg.type==='stop')queueMicrotask(()=>child.emit('exit',0));}});
 const cacheRoot=path.join(root,'cache');file=path.join(cacheRoot,hash(['u','t']),'downloads',hash(['u','t','doc:plan',1])+'.cache');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'hello');
 config={spawn:vi.fn(()=>child),agent:{windowsPreview:vi.fn(async(action:string)=>action==='catalog'?{identity,entries:[{path:'_Projet',key:'b'.repeat(64),folder:true,size:0},{path:'_Projet\\_Plan.pdf',key:'a'.repeat(64),folder:false,size:5,meta}]}:{file})},
 vault:vi.fn().mockResolvedValue({...identity,token:'ds_at_secret'}),root:path.join(root,'preview'),cacheRoot,executable:'trusted.exe',shell:{openPath:vi.fn().mockResolvedValue('')},enabled:()=>true,environment:{DRIVE_LICENSE_PRIVATE_KEY:'private',PATH:'/bin'}};
});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
async function waitForReply(){await vi.waitFor(()=>expect(frames.some(f=>f.type==='hydrated')).toBe(true));return frames.find(f=>f.type==='hydrated');}
it('starts one private native preview, hydrates only a catalog identity and sends no credentials to the helper',async()=>{
 const preview=createWindowsPreview(config);try {
 expect(await preview.start('p')).toEqual({status:'opened'});expect(config.spawn.mock.calls[0][2].env).not.toHaveProperty('DRIVE_LICENSE_PRIVATE_KEY');
 expect(JSON.stringify(frames)).not.toMatch(/ds_at_secret|private|sha256|nodeId/);
 child.stdout.write(JSON.stringify({type:'hydrate',requestId:'1',key:'a'.repeat(64)})+'\n');expect((await waitForReply()).file).toBe(file);
 expect(config.agent.windowsPreview).toHaveBeenLastCalledWith('hydrate',expect.objectContaining({meta}));
 expect(await preview.start('p')).toEqual({status:'opened'});expect(config.spawn).toHaveBeenCalledTimes(1);
 }finally{preview.stop();}
 expect(await fs.readFile(file,'utf8')).toBe('hello');
});
it.each(['refusal','identity','path'])('fails hydration after %s',async(mode)=>{
 frames=[];const preview=createWindowsPreview(config);await preview.start('p');
 if(mode==='refusal')config.vault.mockRejectedValueOnce(new Error('expired'));
 if(mode==='identity')config.vault.mockResolvedValueOnce({...identity,userId:'other'});
 if(mode==='path')config.agent.windowsPreview.mockResolvedValueOnce({file:path.join(root,'outside')});
 child.stdout.write(JSON.stringify({type:'hydrate',requestId:String(frames.length),key:'a'.repeat(64)})+'\n');expect((await waitForReply()).file).toBeUndefined();preview.stop();
});
it('does not spawn or create a mount when disabled or the initial authorization is denied',async()=>{
 const disabled=createWindowsPreview({...config,enabled:()=>false});await expect(disabled.start('p')).rejects.toThrow();expect(config.spawn).not.toHaveBeenCalled();
 config.vault.mockRejectedValue(new Error('expired'));const denied=createWindowsPreview(config);await expect(denied.start('p')).rejects.toThrow();expect(config.spawn).not.toHaveBeenCalled();
 await expect(fs.stat(config.root)).rejects.toMatchObject({code:'ENOENT'});
});
