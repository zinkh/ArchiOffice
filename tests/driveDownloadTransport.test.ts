import { Readable } from 'node:stream';
import { beforeEach,it,expect,vi } from 'vitest';
import { createDownloadTransport } from '../server/desktop/agent/downloadTransport';
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../server/externalStorage/pinnedHttp',()=>({pinnedRequest:request}));
const response=(status:number,headers:any={},text='')=>({status,headers,stream:Readable.from([Buffer.from(text)])});
const meta={nodeId:'doc:1',version:2,size:3,sha256:null,name:'Plan.pdf'};
beforeEach(()=>request.mockReset());
it('strips the device token from storage redirects while preserving Range',async()=>{
 request.mockResolvedValueOnce(response(302,{location:'https://storage.example/file?signature=private'}))
 .mockResolvedValueOnce(response(206,{'content-range':'bytes 1-2/3'},'bc'));
 const authorize=vi.fn(async()=> 'ds_at_secret');const transport=createDownloadTransport('https://www.archioffice.fr','tenant',authorize);
 const block=await transport.read(meta,1,2);let content='';for await(const b of block.body)content+=b.toString();expect(content).toBe('bc');
 expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer ds_at_secret');
 expect(request.mock.calls[1][1].headers).toEqual({Range:'bytes=1-2'});expect(authorize).toHaveBeenCalledTimes(2);
 expect(request.mock.calls[0][0]).toContain('version=2');
});
it('refuses downgrade redirects and invalid range responses',async()=>{
 request.mockResolvedValueOnce(response(302,{location:'http://storage.example/file'}));
 const transport=createDownloadTransport('https://www.archioffice.fr','t',async()=> 'token');
 await expect(transport.read(meta,0,3)).rejects.toThrow('INVALID_DOWNLOAD_URL');expect(request).toHaveBeenCalledTimes(1);
 request.mockResolvedValueOnce(response(206,{'content-range':'bytes 0-2/99'},'abc'));
 await expect(transport.read(meta,0,3)).rejects.toThrow('DOWNLOAD_RANGE_REFUSED');
});
it('preserves UTF-8 metadata and probes old documents with unknown size',async()=>{
 const data=JSON.stringify({id:'doc:1',kind:'file',version:1,size:null,name:'Élévation.pdf',sha256:null});
 const bytes=Buffer.from(data);const split=bytes.indexOf(Buffer.from('É'))+1;
 request.mockResolvedValueOnce({status:200,headers:{},stream:Readable.from([bytes.subarray(0,split),bytes.subarray(split)])})
 .mockResolvedValueOnce(response(206,{'content-range':'bytes 0-0/3'},'a'));
 expect(await createDownloadTransport('https://www.archioffice.fr','t',async()=> 'token').metadata('doc:1')).toMatchObject({size:3,name:'Élévation.pdf'});
});
