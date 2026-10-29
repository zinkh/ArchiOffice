import {expect,it,vi} from 'vitest';
import {buildWindowsCatalog,windowsName} from '../server/desktop/agent/windowsCatalog';
const meta={nodeId:'doc:d',version:1,size:5,name:'Plan.dwg',sha256:'a'.repeat(64)};
function reader(){return vi.fn(async(route:string)=> {
  if(route==='/nodes/prj%3Ap')return {id:'prj:p',kind:'folder',name:'../../CON'};
  if(route.includes('prj%3Ap/children'))return {nodes:[{id:'phase:p:APD',kind:'folder',name:'APD',parentId:'prj:p'}],nextCursor:null};
  return {nodes:[{id:'doc:d',kind:'file',name:'../Plan.dwg',parentId:'phase:p:APD'}],nextCursor:null};
});}
it('builds a bounded ordered namespace from ids and never uses remote paths',async()=> {
  const metadata=vi.fn().mockResolvedValue(meta);const entries=await buildWindowsCatalog('p',reader(),metadata);
  expect(entries).toHaveLength(3);expect(entries.map(e=>e.folder)).toEqual([true,true,false]);
  expect(entries[2].meta).toEqual(meta);expect(entries[2].path.split('\\').every(p=>p.startsWith('_')&&!/[<>:"/|?*]/.test(p))).toBe(true);
  expect(windowsName('con','a')).not.toBe(windowsName('CON','b'));
});
it('refuses cross-project parents, duplicate/cyclic entries and files outside pilot limits',async()=> {
  const read=reader();read.mockImplementation(async(route)=>route==='/nodes/prj%3Ap'?{id:'prj:p',kind:'folder',name:'p'}:({nodes:[{id:'doc:d',name:'d',kind:'file',parentId:'prj:other'}],nextCursor:null}));
  await expect(buildWindowsCatalog('p',read,async()=>meta)).rejects.toMatchObject({code:'WINDOWS_CATALOG_REFUSED'});
  await expect(buildWindowsCatalog('p',reader(),async()=>({...meta,size:51*1024*1024}))).rejects.toMatchObject({code:'WINDOWS_CATALOG_REFUSED'});
  await expect(buildWindowsCatalog('../p',reader(),async()=>meta)).rejects.toMatchObject({code:'WINDOWS_CATALOG_REFUSED'});
});
