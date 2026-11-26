import {MAX_CATALOG_BYTES} from './catalogBudget';
/** Metadata only: no file download, path materialization or remote mutation. */
export async function windowsShellMetadata(projectId:string,read:(route:string)=>Promise<any>) {
 const fail=()=>{throw new Error('Shell metadata refused');};
 if(!/^[a-zA-Z0-9_-]{1,200}$/.test(projectId))return fail();
 const project=await read('/nodes/'+encodeURIComponent('prj:'+projectId));
 if(project?.id!=='prj:'+projectId||project.kind!=='folder'||typeof project.name!=='string')return fail();
 const files:any[]=[];const seen=new Set<string>();let bytes=0;
 async function visit(node:any,phase:string,depth:number){
  if(depth>2||!node||typeof node.id!=='string'||seen.has(node.id))return fail();seen.add(node.id);bytes+=Buffer.byteLength(JSON.stringify(node));if(bytes>MAX_CATALOG_BYTES)return fail();
  if(node.kind==='file'){
   if(!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(node.id)||!Number.isSafeInteger(node.version)||node.version<1)return fail();
   files.push({nodeId:node.id,phase:phase.slice(0,120),version:node.version,indice:typeof node.indice==='string'?node.indice.slice(0,24):'',status:typeof node.status==='string'?node.status.slice(0,40):''});return;
  }
  if(node.kind!=='folder'||(depth&& !node.id.startsWith('phase:'+projectId+':')))return fail();
  let cursor:string|null=null;const cursors=new Set();
  do{const page=await read('/nodes/'+encodeURIComponent(node.id)+'/children?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
   if(!Array.isArray(page?.nodes)||page.nodes.length>100||(page.nextCursor!==null&&typeof page.nextCursor!=='string'))return fail();
   for(const child of page.nodes){if(child?.parentId!==node.id)return fail();await visit(child,depth?String(node.name):phase,depth+1);}
   cursor=page.nextCursor;if(cursor){if(cursors.has(cursor))return fail();cursors.add(cursor);}
  }while(cursor);
 }
 await visit(project,'',0);return {projectName:project.name.slice(0,240),files};
}
