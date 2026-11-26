import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {Readable} from 'node:stream';
import {createRequire} from 'node:module';import {it,expect,vi} from 'vitest';
import {createAgentWorker} from '../server/desktop/agent/worker';
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../server/externalStorage/pinnedHttp',()=>({pinnedRequest:request}));
const {createWindowsShellCatalog}=createRequire(import.meta.url)('../electron/windowsShellCatalog.cjs');
const hash=(v:any)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
it.each(['malformed-json','oversized'])('invalidates cached metadata on a 200 %s response through the real reader and worker',async(mode)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'shell-protocol-'));const identity={userId:'u',tenantId:'t',deviceId:'d'};let now=1800000000000;
 const worker=createAgentWorker({root:path.join(root,'queue'),origin:'https://www.archioffice.fr',session:async()=>({...identity,token:'ds_at_private'}),status:()=>{}});
 const namespaceRoot=path.join(root,'namespace'),directory=path.join(namespaceRoot,hash(['u','t','d']));
 const catalog=[{path:'_P',key:'a'.repeat(64),folder:true,size:0},{path:'_P\\_APD\\_Plan.pdf',key:'b'.repeat(64),folder:false,size:4,meta:{nodeId:'doc:d',version:2,size:4,sha256:null,name:'Plan.pdf'}}];
 request.mockImplementation(async(url:string)=>({status:200,stream:Readable.from([Buffer.from(JSON.stringify(url.endsWith('prj%3Ap')?
  {id:'prj:p',kind:'folder',name:'Projet réel',permissions:{read:true}}:
  {id:'doc:d',kind:'file',name:'Plan.pdf',parentId:'phase:p:APD',projectId:'p',phase:'APD',documentType:'PLAN',indice:'B',version:3,status:'en_cours',permissions:{read:true,write:true,delete:false},readOnlyReason:null}))])}));
 const bridge=createWindowsShellCatalog({namespaceRoot,cacheRoot:path.join(root,'cache'),vault:async()=>identity,now:()=>now,
  drive:{shellSnapshots:async()=>({identity,directory,snapshots:[{identity,projectId:'p',catalog,rootKey:hash(['u','t','d','p',catalog])}]})},agent:worker});
 try {
  await bridge.tick();await bridge.settle();await bridge.tick();
  expect(JSON.parse(await fs.readFile(directory+'.shell.json','utf8')).documents[0].business.indice).toBe('B');
  now+=61000;request.mockImplementation(async()=>({status:200,stream:Readable.from([Buffer.from(mode==='malformed-json'?'{bad-json':' '.repeat(1024*1024+1))])}));
  await bridge.tick();await bridge.settle();await bridge.tick();
  expect(JSON.parse(await fs.readFile(directory+'.shell.json','utf8')).documents[0].business).toBeNull();
 }finally{await bridge.stop();await bridge.settle();await worker.stop();await fs.rm(root,{recursive:true,force:true});}
});
