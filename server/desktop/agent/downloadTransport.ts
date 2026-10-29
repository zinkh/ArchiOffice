import { pinnedRequest, type PinnedResponse } from '../../externalStorage/pinnedHttp';
export interface DownloadMetadata { nodeId: string; version: number; size: number; sha256: string | null; name: string }
export interface DownloadBlock { start: number; body: AsyncIterable<Buffer> }
export interface DownloadTransport {
  metadata(nodeId: string, signal?: AbortSignal): Promise<DownloadMetadata>;
  read(meta: DownloadMetadata, offset: number, length: number, signal?: AbortSignal): Promise<DownloadBlock>;
}
const fail = (code: string, status = 400) => Object.assign(new Error(code), { code, status });
function httpsUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) throw fail('INVALID_DOWNLOAD_URL');
  return url;
}
function body(response: PinnedResponse, signal?: AbortSignal): AsyncIterable<Buffer> {
  return { async *[Symbol.asyncIterator]() {
    const abort = () => response.stream.destroy(new Error('Download cancelled'));
    const timeout = setTimeout(abort,30000);
    signal?.addEventListener('abort',abort,{once:true});
    try { signal?.throwIfAborted(); for await (const chunk of response.stream) yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); }
    finally { clearTimeout(timeout);signal?.removeEventListener('abort',abort);response.stream.destroy(); }
  } };
}
/** Every HTTPS connection is public-DNS validated and pinned. Device credentials
 * are sent only on the first API request, never on a storage redirect. */
export function createDownloadTransport(origin: string, tenantId: string, authorize: () => Promise<string>): DownloadTransport {
  if (httpsUrl(origin).origin !== origin) throw fail('INVALID_DOWNLOAD_URL');
  const nodePath = (id: string) => `/api/desktop/v1/nodes/${encodeURIComponent(id)}`;
  async function first(route: string, range?: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const token = await authorize();
    signal?.throwIfAborted();
    return pinnedRequest(origin + route,{method:'GET',timeoutMs:30000,redirect:'manual',headers:{
      Authorization:`Bearer ${token}`,'X-Tenant-Id':tenantId,...(range ? {Range:range} : {}),
    }});
  }
  async function content(nodeId: string, version: number, range: string, signal?: AbortSignal) {
    let response=await first(`${nodePath(nodeId)}/content?version=${version}`,range,signal);
    let current=new URL(`${origin}${nodePath(nodeId)}/content?version=${version}`);
    for(let hop=0;[301,302,303,307,308].includes(response.status);hop++) {
      const location=response.headers.location;response.stream.destroy();
      if(hop>=4||!location)throw fail('INVALID_DOWNLOAD_REDIRECT');
      current=httpsUrl(new URL(location,current).toString());signal?.throwIfAborted();
      await authorize();
      response=await pinnedRequest(current.toString(),{method:'GET',timeoutMs:30000,redirect:'manual',headers:{Range:range}});
    }
    return response;
  }
  return {
    async metadata(nodeId,signal) {
      if (!nodeId.startsWith('doc:') || nodeId.length > 512) throw fail('INVALID_NODE_ID');
      const response = await first(nodePath(nodeId),undefined,signal);
      if(response.status!==200){response.stream.destroy();throw fail('DOWNLOAD_METADATA_REFUSED',response.status);}
      let text='';let bytes=0;const decoder=new TextDecoder();
      for await(const chunk of body(response,signal)){bytes+=chunk.length;if(bytes>65536)throw fail('INVALID_DOWNLOAD_METADATA');text+=decoder.decode(chunk,{stream:true});}text+=decoder.decode();
      const node=JSON.parse(text);
      if(!node||node.id!==nodeId||node.kind!=='file'||!Number.isSafeInteger(node.version)||node.version<1
        ||typeof node.name!=='string'||(node.sha256!==null&&node.sha256!==undefined&&!/^[a-f0-9]{64}$/i.test(node.sha256)))throw fail('INVALID_DOWNLOAD_METADATA');
      let size=node.size;
      if(!Number.isSafeInteger(size)||size<0) {
        const probe=await content(nodeId,node.version,'bytes=0-0',signal);
        const total=String(probe.headers['content-range']||'').match(/^bytes 0-0\/(\d+)$/);
        size=probe.status===206&&total?Number(total[1]):probe.status===200&&probe.headers['content-length']!==undefined?Number(probe.headers['content-length']):NaN;
        probe.stream.destroy();if(!Number.isSafeInteger(size)||size<0)throw fail('DOWNLOAD_SIZE_UNKNOWN');
      }
      return {nodeId,version:node.version,size,name:node.name,sha256:node.sha256?.toLowerCase()||null};
    },
    async read(meta,offset,length,signal) {
      const range=`bytes=${offset}-${offset+length-1}`;
      if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<1||offset+length>meta.size)throw fail('DOWNLOAD_RANGE_REFUSED');
      const response=await content(meta.nodeId,meta.version,range,signal);
      if(response.status===200)return {start:0,body:body(response,signal)};
      const contentRange=String(response.headers['content-range']||'').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if(response.status!==206||!contentRange||Number(contentRange[1])!==offset||Number(contentRange[2])>=meta.size||Number(contentRange[3])!==meta.size
        ||Number(contentRange[2])<offset||Number(contentRange[2])-offset+1>length){response.stream.destroy();throw fail('DOWNLOAD_RANGE_REFUSED',response.status===206?400:response.status);}
      return {start:offset,body:body(response,signal)};
    },
  };
}
