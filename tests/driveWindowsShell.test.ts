import crypto from 'node:crypto';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import net from 'node:net';import {createRequire} from 'node:module';import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {windowsShellMetadata} from '../server/desktop/agent/windowsShellMetadata';
const {createShellProjection,createShellPipe,createShellDocumentOpener}=createRequire(import.meta.url)('../electron/windowsShell.cjs');
const identity={userId:'u',tenantId:'t',deviceId:'d'};let temp:string,file:string,saved:any,options:any,projection:any,pipe:any;
beforeEach(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'drive-shell-'));const folder=path.join(temp,'project');await fs.mkdir(folder);file=path.join(folder,'_Plan.pdf');await fs.writeFile(file,'hello');saved={identity,projectId:'p',rootKey:'c'.repeat(64),directory:folder,catalog:[{path:'_VIP-TC-123456789abc',key:'d'.repeat(64),folder:true},{path:'_Plan.pdf',key:'a'.repeat(64),folder:false,meta:{nodeId:'doc:p',name:'Plan.pdf',version:2}}]};options={root:temp,vault:vi.fn().mockResolvedValue(identity),drive:{shellSnapshot:vi.fn(async()=>({identity,projects:[saved]}))},agent:{windowsPreview:vi.fn().mockResolvedValue({identity,projectId:'p',name:'VIP-TC',documents:[{nodeId:'doc:p',projectId:'p',name:'Plan.pdf',remoteVersion:2,phase:'PRO',documentType:'PLAN',indice:'C',status:'approuve',permissions:{read:true,write:false,delete:false},readOnlyReason:'approved'}]})},shell:{openPath:vi.fn().mockResolvedValue('')},openDocument:vi.fn()};projection=createShellProjection(options);});
afterEach(async()=>{pipe?.stop();pipe=null;await fs.rm(temp,{recursive:true,force:true});});
const catalog=()=>projection.command('catalog',{});
async function reference(){const result=await catalog();return {projectId:'p',key:'a'.repeat(64),revision:result.projects[0].revision};}
it('projects mounted metadata without paths, tokens or downloads and enriches only matching versions',async()=>{await catalog();await new Promise(resolve=>setImmediate(resolve));const result=await catalog();expect(result.projects[0]).toMatchObject({name:'VIP-TC',rows:[{name:'Plan.pdf',phase:'PRO',indice:'C',version:2,status:'approuve'}]});expect(JSON.stringify(result)).not.toContain(temp);expect(JSON.stringify(result)).not.toContain('doc:p');expect(options.agent.windowsPreview).toHaveBeenCalledTimes(1);});
it('opens the canonical file and passes only document identifiers to the app',async()=>{const ref=await reference();expect(await projection.command('open',ref)).toEqual({status:'opened'});expect(options.shell.openPath).toHaveBeenCalledWith(file);await projection.command('document',ref);expect(options.openDocument).toHaveBeenCalledWith({projectId:'p',documentId:'p'});});
it('refuses stale generations, foreign identities, unsafe files and links',async()=>{const ref=await reference();await expect(projection.command('open',{...ref,revision:'f'.repeat(64)})).rejects.toThrow();options.vault.mockResolvedValueOnce({...identity,tenantId:'other'});await expect(catalog()).rejects.toThrow();await fs.unlink(file);await fs.symlink(path.join(temp,'outside'),file);await expect(projection.command('open',ref)).rejects.toThrow();expect(options.shell.openPath).not.toHaveBeenCalled();});
it('rechecks identity and generation after inspecting a file, and honors cancelled requests',async()=>{const ref=await reference();options.drive.shellSnapshot.mockResolvedValueOnce({identity,projects:[saved]}).mockResolvedValueOnce({identity,projects:[{...saved,rootKey:'e'.repeat(64)}]});await expect(projection.command('open',ref)).rejects.toThrow();const cancel=new AbortController();cancel.abort();await expect(projection.command('open',ref,cancel.signal)).rejects.toThrow();expect(options.shell.openPath).not.toHaveBeenCalled();});
it('keeps the mounted catalogue usable when metadata enrichment is unavailable',async()=>{options.agent.windowsPreview.mockRejectedValue(new Error('offline'));await catalog();await new Promise(resolve=>setImmediate(resolve));expect((await catalog()).projects[0].rows[0]).toMatchObject({name:'Plan.pdf',version:2,indice:''});});
it('protects the local pipe with a bounded authenticated protocol',async(context)=>{
 const address=process.platform==='win32'?'\\\\.\\pipe\\ArchiOffice.DriveShell.'+crypto.randomUUID():path.join(temp,'pipe');const command=vi.fn().mockResolvedValue({status:'ok',projects:[]});pipe=createShellPipe({address,token:'a'.repeat(64),projection:{command}});try{await pipe.start();}catch(error:any){if(process.platform!=='win32'&&error.code==='EPERM')context.skip('Local sockets blocked by sandbox; exercised on Windows CI');throw error;}
 const send=(token:string)=>new Promise<string>((resolve,reject)=>{const socket=net.createConnection(address);let result='';socket.on('connect',()=>socket.write(JSON.stringify({format:1,token,action:'catalog'})+'\n'));socket.on('data',v=>result+=v);socket.on('end',()=>resolve(result));socket.on('error',reject);});
 expect(JSON.parse(await send('b'.repeat(64)))).toEqual({status:'unavailable'});expect(command).not.toHaveBeenCalled();expect(JSON.parse(await send('a'.repeat(64)))).toMatchObject({status:'ok'});expect(command).toHaveBeenCalledTimes(1);
});
it('reads business metadata through a bounded project tree without file downloads',async()=>{
 const read=vi.fn(async(route:string):Promise<any>=>route==='/nodes/prj%3Ap'?{id:'prj:p',kind:'folder',name:'VIP-TC'}:route.includes('phase%3Ap%3APRO')?{nodes:[{id:'doc:p',parentId:'phase:p:PRO',kind:'file',version:2,indice:'C',status:'approuve'}],nextCursor:null}:{nodes:[{id:'phase:p:PRO',parentId:'prj:p',kind:'folder',name:'PRO'}],nextCursor:null});
 expect(await windowsShellMetadata('p',read)).toMatchObject({projectName:'VIP-TC',files:[{nodeId:'doc:p',phase:'PRO',version:2,indice:'C',status:'approuve'}]});expect(read).toHaveBeenCalledTimes(3);await expect(windowsShellMetadata('../escape',read)).rejects.toThrow();
});

it('never attaches business properties from a different file version',async()=>{
 options.agent.windowsPreview.mockResolvedValue({identity,projectId:'p',name:'VIP-TC',documents:[{nodeId:'doc:p',projectId:'p',name:'Plan.pdf',remoteVersion:3,phase:'APD',documentType:'PLAN',indice:'Z',status:'perime',permissions:{read:true,write:true,delete:false},readOnlyReason:null}]});
 await catalog();await new Promise(resolve=>setImmediate(resolve));expect((await catalog()).projects[0].rows[0]).toMatchObject({version:2,indice:'',status:''});
});
it('refuses executable files even when their opaque reference belongs to the mounted catalogue',async()=>{
 saved.catalog[1].path='_Script.exe';await fs.writeFile(path.join(saved.directory,'_Script.exe'),'bytes');
 const ref=await reference();await expect(projection.command('open',ref)).rejects.toThrow();expect(options.shell.openPath).not.toHaveBeenCalled();
});
it('rejects a foreign parent in a metadata response',async()=>{
 const read=vi.fn(async(route:string)=>route.includes('/children')?{nodes:[{id:'doc:x',parentId:'prj:other',kind:'file',version:1}],nextCursor:null}:{id:'prj:p',kind:'folder',name:'VIP-TC'});
 await expect(windowsShellMetadata('p',read)).rejects.toThrow('Shell metadata refused');
});

it('reuses the existing desktop window and restores it for a document link',async()=>{
 const target={isDestroyed:()=>false,isMinimized:()=>true,restore:vi.fn(),show:vi.fn(),focus:vi.fn(),loadURL:vi.fn()};const showWindow=vi.fn();
 const open=createShellDocumentOpener({getWindow:()=>target,showWindow,origin:'http://127.0.0.1:3130'});await open({projectId:'p',documentId:'d'});
 expect(showWindow).not.toHaveBeenCalled();expect(target.restore).toHaveBeenCalledOnce();expect(target.loadURL).toHaveBeenCalledWith('http://127.0.0.1:3130/documents?project=p&document=d');
});
it('coalesces creation of a missing desktop window',async()=>{
 let target:any=null;const window={isDestroyed:()=>false,isMinimized:()=>false,show:vi.fn(),focus:vi.fn(),loadURL:vi.fn()};
 const showWindow=vi.fn(async()=>{await new Promise(resolve=>setImmediate(resolve));target=window;});
 const open=createShellDocumentOpener({getWindow:()=>target,showWindow,origin:'http://127.0.0.1:3130'});await Promise.all([open({projectId:'p',documentId:'d'}),open({projectId:'p',documentId:'e'})]);expect(showWindow).toHaveBeenCalledOnce();expect(window.loadURL).toHaveBeenCalledTimes(2);
});

it('distinguishes business type, unclassified metadata, local content and conflicts',async()=>{
 options.drive.shellAvailability=vi.fn(async()=>({identity,rootKey:saved.rootKey,files:[{key:'a'.repeat(64),available:true}]}));
 options.agent.documentStatuses=vi.fn(async()=>({identity,documents:[{nodeId:'doc:p',state:'conflict'}]}));
 await catalog();await new Promise(resolve=>setImmediate(resolve));let result=await catalog();
 expect(result.projects[0].rows[0]).toMatchObject({type:'PLAN',fileType:'PDF',businessKnown:true,unclassified:false,available:true,transferState:'conflict'});
 const response=await options.agent.windowsPreview();response.documents[0].documentType=null;options.agent.windowsPreview.mockResolvedValue(response);
 projection=createShellProjection(options);await catalog();await new Promise(resolve=>setImmediate(resolve));result=await catalog();
 expect(result.projects[0].rows[0]).toMatchObject({type:'',businessKnown:true,unclassified:true});
});
it('never treats an unavailable status or metadata as a conflict or an unclassified document',async()=>{
 options.agent.windowsPreview.mockRejectedValue(new Error('offline'));await catalog();await new Promise(resolve=>setImmediate(resolve));const row=(await catalog()).projects[0].rows[0];
 expect(row).toMatchObject({available:null,transferState:'',businessKnown:false,unclassified:false,type:'',fileType:'PDF'});
});
it('rejects a generation changed while availability was being read',async()=>{
 options.drive.shellAvailability=vi.fn(async()=>{saved={...saved,rootKey:'e'.repeat(64)};return {identity,rootKey:saved.rootKey,files:[]};});
 await expect(catalog()).rejects.toThrow('Catalogue changed');
});
it('reuses the shared business cache rather than starting a parallel cloud enrichment',async()=>{
 const value=await options.agent.windowsPreview();options.agent.windowsPreview.mockClear();options.businessCatalog=vi.fn(async()=>value);
 projection=createShellProjection(options);expect((await catalog()).projects[0].rows[0]).toMatchObject({type:'PLAN',businessKnown:true});
 expect(options.businessCatalog).toHaveBeenCalledWith(identity,saved);expect(options.agent.windowsPreview).not.toHaveBeenCalled();
});
it('dates shared metadata and marks an older offline observation without inventing a new classification',async()=>{
 const value=await options.agent.windowsPreview();options.now=()=>1800000000000;value.observedAt=1800000000000-120000;options.businessCatalog=async()=>value;
 projection=createShellProjection(options);expect((await catalog()).projects[0].rows[0]).toMatchObject({observedAt:value.observedAt,metadataStale:true,type:'PLAN',unclassified:false});
});
