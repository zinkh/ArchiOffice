import crypto from 'node:crypto';
import type { DownloadMetadata } from './downloadTransport';
import { pinnedRequest } from '../../externalStorage/pinnedHttp';
export interface WindowsCatalogEntry { path:string;key:string;folder:boolean;size:number;meta?:DownloadMetadata }
const fail=()=>Object.assign(new Error('Windows preview catalog refused'),{code:'WINDOWS_CATALOG_REFUSED'});
export function windowsName(name:string,id:string,file=false) {
  const clean=name.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/[ .]+$/g,'');
  const dot=file?clean.lastIndexOf('.'):-1;const ext=dot>0?clean.slice(dot, dot+13):'';
  const stem=(dot>0?clean.slice(0,dot):clean).slice(0,24)||'Document';
  return `_${stem}-${crypto.createHash('sha256').update(id).digest('hex').slice(0,12)}${ext}`;
}
export function catalogReader(origin:string,tenantId:string,authorize:()=>Promise<string>) {
  const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw fail();
  return async(route:string,signal?:AbortSignal)=> {
    signal?.throwIfAborted();const token=await authorize();
    const response=await pinnedRequest(origin+'/api/desktop/v1'+route,{method:'GET',redirect:'manual',timeoutMs:30000,headers:{Authorization:`Bearer ${token}`,'X-Tenant-Id':tenantId}});
    const abort=()=>response.stream.destroy(new Error('Catalog cancelled'));signal?.addEventListener('abort',abort,{once:true});
    try {
      signal?.throwIfAborted();if(response.status!==200)throw fail();let bytes=0;let text='';const decoder=new TextDecoder();
      for await(const chunk of response.stream){bytes+=chunk.length;if(bytes>1024*1024)throw fail();text+=decoder.decode(chunk,{stream:true});}
      text+=decoder.decode();return JSON.parse(text);
    }finally{signal?.removeEventListener('abort',abort);response.stream.destroy();}
  };
}
/** Snapshot one project, never trusting server paths or names as local paths. */
export async function buildWindowsCatalog(projectId:string,read:(route:string)=>Promise<any>,metadata:(id:string)=>Promise<DownloadMetadata>) {
  if(!/^[a-zA-Z0-9_-]{1,200}$/.test(projectId))throw fail();
  const project=await read(`/nodes/${encodeURIComponent('prj:'+projectId)}`);
  if(project?.id!=='prj:'+projectId||project.kind!=='folder'||typeof project.name!=='string')throw fail();
  const entries:WindowsCatalogEntry[]=[];const visited=new Set<string>();let files=0;
  async function visit(node:any,parent:string,depth:number) {
    if(depth>2||visited.has(node.id)||entries.length>=256||typeof node.id!=='string'||typeof node.name!=='string')throw fail();visited.add(node.id);
    const folder=node.kind==='folder';if(!folder&&node.kind!=='file')throw fail();
    if(folder&&node.id!==project.id&&!node.id.startsWith(`phase:${projectId}:`))throw fail();
    if(!folder&&!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(node.id))throw fail();
    const key=crypto.createHash('sha256').update(node.id).digest('hex');
    const path=(parent?parent+'\\':'')+windowsName(node.name,node.id,!folder);
    if(folder) {
      entries.push({path,key,folder:true,size:0});let cursor:string|null=null;const cursors=new Set<string>();
      do {
        const page=await read(`/nodes/${encodeURIComponent(node.id)}/children?limit=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`);
        if(!Array.isArray(page?.nodes)||page.nodes.length>100||(page.nextCursor!==null&&typeof page.nextCursor!=='string'))throw fail();
        for(const child of page.nodes){if(child?.parentId!==node.id)throw fail();await visit(child,path,depth+1);}
        cursor=page.nextCursor;if(cursor){if(cursors.has(cursor)||cursors.size>=3)throw fail();cursors.add(cursor);}
      }while(cursor);
    }else {
      if(++files>100)throw fail();const meta=await metadata(node.id);
      if(meta.nodeId!==node.id||!Number.isSafeInteger(meta.version)||meta.version<1||!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>50*1024*1024
        ||(meta.sha256!==null&&!/^[a-f0-9]{64}$/.test(meta.sha256)))throw fail();
      entries.push({path,key,folder:false,size:meta.size,meta});
    }
  }
  await visit(project,'',0);return entries;
}
