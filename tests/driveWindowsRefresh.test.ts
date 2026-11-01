import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {createRequire} from 'node:module';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const {createWindowsMultiDrive}=createRequire(import.meta.url)('../electron/windowsDriveMulti.cjs');
const {normalizeCatalog}=createRequire(import.meta.url)('../electron/windowsDriveRefresh.cjs');
const hash=(value:any)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity={userId:'u',tenantId:'t',deviceId:'d'};
let temp:string,config:any,frames:any[],controllers:any[],versions:Map<string,number>,dirty:Set<string>,created:string[],lateDirty:boolean;
const makeCatalog=(id:string,version:number)=>({identity,entries:[{path:'_'+id,key:hash(id),folder:true,size:0},
 {path:'_'+id+'\\_Plan.txt',key:hash('doc:'+id),folder:false,size:2,meta:{nodeId:'doc:'+id,name:'Plan.txt',version,size:2,sha256:null}},
 ...(version>1?[{path:'_'+id+'\\_Added.txt',key:hash('doc:'+id+'-added'),folder:false,size:2,meta:{nodeId:'doc:'+id+'-added',name:'Added.txt',version:1,size:2,sha256:null}}]:[])]});
beforeEach(async()=>{
 temp=await fs.mkdtemp(path.join(os.tmpdir(),'drive-refresh-'));frames=[];controllers=[];versions=new Map([['p',1],['q',1]]);dirty=new Set();created=[];lateDirty=false;
 config={root:path.join(temp,'projects'),namespaceRoot:path.join(temp,'namespace'),stateFile:path.join(temp,'active.json'),cacheRoot:path.join(temp,'cache'),executable:'native.exe',enabled:()=>true,
  vault:vi.fn().mockResolvedValue({...identity,token:'private'}),login:vi.fn(),shell:{openPath:vi.fn().mockResolvedValue('')},agent:{windowsPreview:vi.fn(async(_action:string,input:any)=>makeCatalog(input.projectId,versions.get(input.projectId)!))},
  spawn:vi.fn(()=>{
   const child:any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.kill=()=>child.emit('exit',0);let root='';
   child.stdin.on('data',(bytes:Buffer)=>{for(const line of bytes.toString().trim().split('\n')){const msg=JSON.parse(line);frames.push(msg);
    if(msg.type==='init'||msg.type==='map')void(async()=>{root=msg.root;
     if(msg.type==='init'&&!msg.resume){created.push(root);for(const e of msg.entries){const file=path.join(root,...e.path.split('\\'));if(e.folder)await fs.mkdir(file,{recursive:true});else await fs.writeFile(file,'v'+(e.path.includes('Added')?1:versions.get(e.path.split('\\')[0].slice(1))));}if(lateDirty&&created.length>1)dirty.add(created[0]);}
     child.stdout.write(JSON.stringify({type:'ready'})+'\n');})();
    if(msg.type==='verify')queueMicrotask(()=>child.stdout.write(JSON.stringify({type:'verified',requestId:msg.requestId,valid:!dirty.has(root)})+'\n'));
    if(msg.type==='stop')queueMicrotask(()=>child.emit('exit',0));
   }});return child;
  })};
});
afterEach(async()=>{for(const controller of controllers)controller.shutdown();vi.restoreAllMocks();await new Promise(resolve=>setImmediate(resolve));await fs.rm(temp,{recursive:true,force:true});});
const make=()=>{const drive=createWindowsMultiDrive(config);controllers.push(drive);return drive;};
const base=()=>frames.find(f=>f.type==='map').root;
it('compares before applying, switches only one project and preserves the old bytes and paths',async()=>{
 const drive=make();await drive.start('p');await drive.start('q');const old=await fs.realpath(path.join(base(),'_p'));await fs.writeFile(path.join(old,'note-local.txt'),'local addition');versions.set('p',2);
 const plan=await drive.checkCatalog('p');expect(plan).toMatchObject({status:'update_available',added:1,updated:1,removed:0});expect(await fs.readFile(path.join(base(),'_p','_Plan.txt'),'utf8')).toBe('v1');
 expect(await drive.refreshCatalog('p',plan.token)).toEqual({status:'refreshed'});expect(await fs.readFile(path.join(base(),'_p','_Plan.txt'),'utf8')).toBe('v2');expect(await fs.readFile(path.join(base(),'_p','_Added.txt'),'utf8')).toBe('v1');
 expect(await fs.readFile(path.join(base(),'_q','_Plan.txt'),'utf8')).toBe('v1');expect(await fs.readFile(path.join(old,'_Plan.txt'),'utf8')).toBe('v1');expect(drive.status().previousProjectIds).toEqual(['p']);expect(await fs.readFile(path.join(old,'note-local.txt'),'utf8')).toBe('local addition');
 expect(await drive.openPrevious('p')).toEqual({status:'copies_shown'});expect(config.shell.openPath).toHaveBeenLastCalledWith(path.dirname(old));
 expect((await drive.refreshCatalog('p',plan.token)).status).toBe('error');expect(drive.status().active).toBe(true);
});
it('does not create a new tree when the remote catalog is unchanged',async()=>{
 const drive=make();await drive.start('p');const count=config.spawn.mock.calls.length;expect(await drive.checkCatalog('p')).toEqual({status:'up_to_date'});expect(config.spawn).toHaveBeenCalledTimes(count);
});
it.each(['before-check','after-check','during-stage'])('preserves the current tree when local modifications appear %s',async(mode)=>{
 const drive=make();await drive.start('p');const original=await fs.realpath(path.join(base(),'_p'));versions.set('p',2);
 if(mode==='before-check'){dirty.add(created[0]);expect(await drive.checkCatalog('p')).toMatchObject({status:'error',code:'DRIVE_LOCAL_CHANGES'});}
 else {const plan=await drive.checkCatalog('p');if(mode==='after-check')dirty.add(created[0]);else lateDirty=true;expect(await drive.refreshCatalog('p',plan.token)).toMatchObject({status:'error',code:'DRIVE_LOCAL_CHANGES'});}
 expect(await fs.realpath(path.join(base(),'_p'))).toBe(original);expect(await fs.readFile(path.join(original,'_Plan.txt'),'utf8')).toBe('v1');expect(drive.status().active).toBe(true);
});
it('requires another comparison if the remote version changed after the user reviewed it',async()=>{
 const drive=make();await drive.start('p');versions.set('p',2);const plan=await drive.checkCatalog('p');versions.set('p',3);
 expect(await drive.refreshCatalog('p',plan.token)).toMatchObject({status:'error',code:'DRIVE_REFRESH_STALE'});expect(created).toHaveLength(1);expect(drive.status().active).toBe(true);
});
it('expires a reviewed plan and binds it to its selected project',async()=>{
 const drive=make();await drive.start('p');await drive.start('q');versions.set('p',2);const plan=await drive.checkCatalog('p');
 expect(await drive.refreshCatalog('q',plan.token)).toMatchObject({status:'error',code:'DRIVE_REFRESH_STALE'});const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+6*60*1000);
 expect(await drive.refreshCatalog('p',plan.token)).toMatchObject({status:'error',code:'DRIVE_REFRESH_STALE'});expect(created).toHaveLength(2);
});
it('recovers a confirmed refresh after an interrupted junction switch, keeping the other project intact',async()=>{
 const first=make();await first.start('p');await first.start('q');versions.set('p',2);const plan=await first.checkCatalog('p');const rename=fs.rename;let injected=false;
 vi.spyOn(fs,'rename').mockImplementation(async(from:any,to:any)=>{if(!injected&&String(from).endsWith('.new')){injected=true;throw Object.assign(new Error('busy'),{code:'EACCES'});}return rename(from,to);});
 expect(await first.refreshCatalog('p',plan.token)).toMatchObject({status:'error',code:'DRIVE_REFRESH_INTERRUPTED'});expect(first.status().active).toBe(false);first.shutdown();await new Promise(resolve=>setImmediate(resolve));
 const reads=config.agent.windowsPreview.mock.calls.length;const second=make();second.resume();await vi.waitFor(()=>expect(second.status().projectCount).toBe(2));
 expect(await fs.readFile(path.join(base(),'_p','_Plan.txt'),'utf8')).toBe('v2');expect(await fs.readFile(path.join(base(),'_q','_Plan.txt'),'utf8')).toBe('v1');expect(config.agent.windowsPreview).toHaveBeenCalledTimes(reads);
});
it('does not apply a reviewed catalog after an account change',async()=>{
 const drive=make();await drive.start('p');versions.set('p',2);const plan=await drive.checkCatalog('p');config.vault.mockResolvedValue({...identity,userId:'other'});
 expect((await drive.refreshCatalog('p',plan.token)).status).toBe('error');expect(drive.status().active).toBe(false);expect(created).toHaveLength(1);
});
it('keeps existing aliases on rename and reports removals and directory moves',()=>{
 const old={catalog:makeCatalog('p',1).entries};const remote=makeCatalog('p',2);remote.entries[0].path='_Renamed';for(const entry of remote.entries.slice(1))entry.path=entry.path.replace('_p\\','_Renamed\\');
 const result=normalizeCatalog(old,remote,identity);expect(result.entries[0].path).toBe('_p');expect(result.entries[1].path).toBe('_p\\_Plan.txt');
 const removed=normalizeCatalog(old,{identity,entries:[remote.entries[0]]},identity);expect(removed.summary.removed).toBe(1);
});
