import {readShellMetadata} from './shellMetadata';
export async function readShellVersions(projectId:string,nodeId:string,read:(route:string)=>Promise<any>) {
 await readShellMetadata(projectId,[nodeId],read);
 const rows=await read('/nodes/'+encodeURIComponent(nodeId)+'/versions');
 const fail=()=>{throw Object.assign(new Error('Invalid version history'),{code:'WINDOWS_SHELL_METADATA_REFUSED'});};
 if(!Array.isArray(rows)||rows.length>10000)return fail();
 const seen=new Set<number>();
 const versions=rows.map((row:any)=>{
  if(!Number.isSafeInteger(row?.version)||row.version<1||seen.has(row.version)
   ||!(row.size===null||Number.isSafeInteger(row.size)&&row.size>=0)
   ||!(row.uploadedAt===null||typeof row.uploadedAt==='string'&&row.uploadedAt.length<=80&&Number.isFinite(Date.parse(row.uploadedAt)))
   ||!(row.description===null||typeof row.description==='string'))return fail();
  seen.add(row.version);return {version:row.version,size:row.size,uploadedAt:row.uploadedAt,description:row.description?.slice(0,512)??null};
 }).sort((a,b)=>b.version-a.version);
 return {versions:versions.slice(0,50),total:versions.length};
}
