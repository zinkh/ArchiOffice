import {it,expect,vi} from 'vitest';
import {readShellMetadata} from '../server/desktop/agent/shellMetadata';
const project={id:'prj:p',kind:'folder',name:'VIP-TC',permissions:{read:true}};
const node={id:'doc:d',kind:'file',name:'Plan.pdf',parentId:'phase:p:APD',projectId:'p',phase:'APD',documentType:'PLAN',indice:'C',version:8,status:'en_cours',permissions:{read:true,write:false,delete:false},readOnlyReason:'approved',file_url:'must-not-leak',token:'must-not-leak'};
const reader=(value:any=node)=>vi.fn(async(route:string)=>route==='/nodes/prj%3Ap'?project:value);
it('projects authoritative business fields without paths, URLs or credentials',async()=>{
 const result=await readShellMetadata('p',['doc:d'],reader());
 expect(result).toEqual({projectId:'p',name:'VIP-TC',documents:[{nodeId:'doc:d',name:'Plan.pdf',projectId:'p',phase:'APD',documentType:'PLAN',indice:'C',remoteVersion:8,status:'en_cours',permissions:node.permissions,readOnlyReason:'approved'}]});
 expect(JSON.stringify(result)).not.toContain('must-not-leak');
});
it.each([{projectId:'foreign'},{parentId:'phase:foreign:APD'},{id:'doc:other'},{permissions:{read:false,write:true,delete:true}},{version:0},{indice:'A\r\nVersion : 999'}])('rejects foreign, unreadable or malformed nodes: %j',async(change)=>{
 await expect(readShellMetadata('p',['doc:d'],reader({...node,...change}))).rejects.toMatchObject({code:'WINDOWS_SHELL_METADATA_REFUSED'});
});
it('preserves missing classifications rather than deriving them from filenames',async()=>{
 const result=await readShellMetadata('p',['doc:d'],reader({...node,phase:null,documentType:null,indice:null,status:null}));
 expect(result.documents[0]).toMatchObject({phase:null,documentType:null,indice:null,status:null,remoteVersion:8});
});
it('bounds requests before any authenticated reads',async()=>{
 const read=reader();for(const ids of [['doc:d','doc:d'],['../file']])await expect(readShellMetadata('p',ids,read)).rejects.toThrow();
 expect(read).not.toHaveBeenCalled();
});

it('reads more than 1000 business records with bounded concurrency and stable ordering',async()=>{
 const ids=Array.from({length:1001},(_,i)=>'doc:d'+i);let active=0,peak=0;
 const result=await readShellMetadata('p',ids,async route=>{
  if(route==='/nodes/prj%3Ap')return project;
  active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;
  return {...node,id:decodeURIComponent(route.slice('/nodes/'.length))};
 });expect(result.documents.map(d=>d.nodeId)).toEqual(ids);expect(peak).toBeLessThanOrEqual(8);expect(peak).toBeGreaterThan(1);
});
