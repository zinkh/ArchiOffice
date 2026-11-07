import {it,expect,vi} from 'vitest';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {Readable} from 'node:stream';
import {createAgentWorker} from '../server/desktop/agent/worker';
const {request}=vi.hoisted(()=>({request:vi.fn()}));vi.mock('../server/externalStorage/pinnedHttp',()=>({pinnedRequest:request}));
it('aborts suspended history HTTP reads across twelve selection changes, then serves the final selection',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'history-cancel-'));const identity={userId:'u',tenantId:'t',deviceId:'d'};let active=0;
 const worker=createAgentWorker({root,origin:'https://www.archioffice.fr',session:async()=>({...identity,token:'ds_at_private'}),status:()=>{}});
 request.mockImplementation(async(_url:string,options:any)=>new Promise((_resolve,reject)=>{active++;const cancel=()=>{active--;reject(Object.assign(new Error('aborted'),{code:'ABORT_ERR'}));};options.signal.addEventListener('abort',cancel,{once:true});if(options.signal.aborted)cancel();}));
 try{
  for(let i=0;i<12;i++){const cancel=new AbortController();const waiting=worker.windowsPreview('shellVersions',{identity,projectId:'p',nodeId:'doc:old'},cancel.signal);const rejected=expect(waiting).rejects.toThrow();await vi.waitFor(()=>expect(active).toBe(1));cancel.abort();await rejected;expect(active).toBe(0);}
  request.mockImplementation(async(url:string)=>({status:200,stream:Readable.from([Buffer.from(JSON.stringify(url.endsWith('/versions')?[]:url.endsWith('prj%3Ap')?{id:'prj:p',kind:'folder',name:'P',permissions:{read:true}}:{id:'doc:latest',kind:'file',projectId:'p',parentId:'phase:p:PRO',name:'Plan.pdf',version:12,phase:'PRO',documentType:'PLAN',indice:'C',status:'en_cours',permissions:{read:true,write:true,delete:false},readOnlyReason:null}))])}));
  expect(await worker.windowsPreview('shellVersions',{identity,projectId:'p',nodeId:'doc:latest'})).toMatchObject({versions:[],total:0,identity});
 }finally{await worker.stop();await fs.rm(root,{recursive:true,force:true});}
});
