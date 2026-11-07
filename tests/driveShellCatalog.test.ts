import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {createRequire} from 'node:module';import {it,expect,beforeEach,afterEach,vi} from 'vitest';
const {createWindowsShellCatalog}=createRequire(import.meta.url)('../electron/windowsShellCatalog.cjs');
const hash=(v:any)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const identity={userId:'u',tenantId:'t',deviceId:'dev'};
let temp:string,now:number,config:any,snapshot:any,source:any,bridge:any;
beforeEach(async()=>{
 temp=await fs.mkdtemp(path.join(os.tmpdir(),'shell-catalog-'));now=1800000000000;
 const namespaceRoot=path.join(temp,'namespace');const identityKey=hash(['u','t','dev']);
 const catalog=[{path:'_VIP',key:'a'.repeat(64),folder:true,size:0},{path:'_VIP\\_APD\\_Plan.pdf',key:'b'.repeat(64),folder:false,size:4,meta:{nodeId:'doc:d',version:3,size:4,sha256:null,name:'Plan.pdf'}}];
 snapshot={identity,projectId:'p',rootKey:hash(['u','t','dev','p',catalog]),catalog};source={identity,directory:path.join(namespaceRoot,identityKey),snapshots:[snapshot]};
 const document={nodeId:'doc:d',projectId:'p',name:'Plan.pdf',phase:'APD',documentType:'PLAN',indice:'B',remoteVersion:5,status:'en_cours',permissions:{read:true,write:false,delete:false},readOnlyReason:'approved'};
 config={namespaceRoot,cacheRoot:path.join(temp,'cache'),now:()=>now,vault:vi.fn().mockResolvedValue({...identity,token:'secret'}),drive:{shellSnapshots:vi.fn(async()=>source)},agent:{windowsPreview:vi.fn().mockResolvedValue({identity,projectId:'p',name:'VIP-TC',documents:[document]}),documentStatuses:vi.fn().mockResolvedValue({identity,documents:[{nodeId:'doc:d',state:'queued'}]})}};
 bridge=createWindowsShellCatalog(config);
});
afterEach(async()=>{await bridge.stop();await bridge.settle();await fs.rm(temp,{recursive:true,force:true});});
const read=async()=>JSON.parse(await fs.readFile(source.directory+'.shell.json','utf8'));
it('exports real classifications with separate catalog/remote versions and transfer state, never secrets',async()=>{
 await bridge.tick();await bridge.settle();await bridge.tick();const data=await read();
 expect(data).toMatchObject({schema:1,identityKey:hash(['u','t','dev']),expiresAt:now+25000,projects:[{projectId:'p',name:'VIP-TC'}],documents:[{relativePath:'_VIP\\_APD\\_Plan.pdf',catalogVersion:3,business:{indice:'B',remoteVersion:5,phase:'APD',documentType:'PLAN'},transferState:'queued',stale:false}]});
 expect(JSON.stringify(data)).not.toContain('secret');expect(data.documents[0]).not.toHaveProperty('file');
});
it('restores dated business information offline from its own cache and does not invent an upload state',async()=>{
 await bridge.tick();await bridge.settle();await bridge.stop();now+=120000;
 config.agent.windowsPreview.mockRejectedValue(new Error('network offline'));config.agent.documentStatuses.mockRejectedValue(new Error('unavailable'));
 bridge=createWindowsShellCatalog(config);await bridge.tick();await bridge.settle();const data=await read();
 expect(data.documents[0]).toMatchObject({stale:true,observedAt:now-120000,transferState:null,business:{indice:'B'}});
});
it.each([401,402,403,404])('invalidates prior business data after a known denial %s',async(status)=>{
 await bridge.tick();await bridge.settle();now+=61000;config.agent.windowsPreview.mockRejectedValue({status});
 await bridge.tick();await bridge.settle();await bridge.tick();expect((await read()).documents[0].business).toBeNull();
});
it('removes the exported lease when the current account changes',async()=>{
 await bridge.tick();await bridge.settle();config.vault.mockResolvedValue({...identity,tenantId:'foreign'});await bridge.tick();
 await expect(fs.stat(source.directory+'.shell.json')).rejects.toMatchObject({code:'ENOENT'});
});
it('refuses foreign cached metadata and a mismatched manifest fingerprint',async()=>{
 config.agent.windowsPreview.mockResolvedValue({identity:{...identity,tenantId:'foreign'},projectId:'p',name:'Foreign',documents:[]});
 await bridge.tick();await bridge.settle();await bridge.tick();expect((await read()).documents[0].business).toBeNull();
 snapshot.rootKey='f'.repeat(64);await bridge.tick();await expect(fs.stat(source.directory+'.shell.json')).rejects.toMatchObject({code:'ENOENT'});
});
it('does not export a project removed while its statuses were loading',async()=>{
 config.agent.documentStatuses.mockImplementation(async()=>{source={...source,snapshots:[]};return {identity,documents:[{nodeId:'doc:d',state:'queued'}]};});
 await bridge.tick();await expect(fs.stat(source.directory+'.shell.json')).rejects.toMatchObject({code:'ENOENT'});
});
it('refuses a symlinked cache without reading or changing its target',async()=>{
 const outside=path.join(temp,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep'),'preserve');await fs.symlink(outside,config.cacheRoot,'junction');
 await bridge.tick();await bridge.settle();await bridge.tick();expect((await read()).documents[0].business).toBeNull();expect(await fs.readFile(path.join(outside,'keep'),'utf8')).toBe('preserve');
});
it('unpublishes its file on stop, retaining only the dated private metadata cache',async()=>{
 await bridge.tick();await bridge.settle();await bridge.stop();await expect(fs.stat(source.directory+'.shell.json')).rejects.toMatchObject({code:'ENOENT'});expect(await fs.readdir(config.cacheRoot)).toHaveLength(1);
});
