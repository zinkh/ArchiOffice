import {it,expect,vi} from 'vitest';import {readShellVersions} from '../server/desktop/agent/shellVersions';
const project={id:'prj:p',kind:'folder',name:'P',permissions:{read:true}};
const node={id:'doc:d',kind:'file',name:'Plan.pdf',parentId:'phase:p:PRO',projectId:'p',phase:'PRO',documentType:'PLAN',indice:'C',version:12,status:'en_cours',permissions:{read:true,write:true,delete:false},readOnlyReason:null};
const rows=Array.from({length:55},(_,i)=>({version:i+1,uploadedAt:'2026-11-07T10:00:00Z',size:50,description:'Version réelle',uploadedBy:'private-id'}));
function read(values:any=rows){return vi.fn(async(route:string)=>route==='/nodes/prj%3Ap'?project:route.endsWith('/versions')?values:node);}
it('authorizes the project/document, sorts and limits actual history without synthesizing the current version',async()=>{
 const response=await readShellVersions('p','doc:d',read());expect(response.total).toBe(55);expect(response.versions).toHaveLength(50);expect(response.versions[0].version).toBe(55);expect(JSON.stringify(response)).not.toContain('private-id');
 expect((await readShellVersions('p','doc:d',read([]))).versions).toEqual([]);
});
it.each([[{...rows[0],version:0}],[rows[0],rows[0]],[{...rows[0],size:-1}],[{...rows[0],uploadedAt:'wrong'}]])('rejects malformed version history %j',async(values)=>{
 await expect(readShellVersions('p','doc:d',read(values))).rejects.toThrow();
});
it('does not read history from another project',async()=>{const route=read();route.mockImplementation(async(url)=>url==='/nodes/prj%3Ap'?project:{...node,projectId:'foreign'});await expect(readShellVersions('p','doc:d',route)).rejects.toThrow();expect(route.mock.calls.some(([url])=>url.endsWith('/versions'))).toBe(false);});
