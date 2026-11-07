import {it,expect,vi} from 'vitest';import https from 'node:https';import {EventEmitter} from 'node:events';import {pinnedRequest} from '../server/externalStorage/pinnedHttp';
vi.mock('../server/ssrfGuard',()=>({resolvePublicUrl:async(url:string)=>({url:new URL(url),addresses:['8.8.8.8']})}));
it('destroys a pinned HTTPS request when cancelled before response headers arrive',async()=>{
 const spy=vi.spyOn(https,'request').mockImplementation(((options:any)=>{const request:any=new EventEmitter();request.end=()=>{};options.signal.addEventListener('abort',()=>request.emit('error',Object.assign(new Error('aborted'),{code:'ABORT_ERR'})),{once:true});return request;}) as any);
 try{const cancel=new AbortController();const waiting=pinnedRequest('https://example.com/history',{method:'GET',timeoutMs:30000,signal:cancel.signal});const rejected=expect(waiting).rejects.toMatchObject({code:'ABORT_ERR'});await vi.waitFor(()=>expect(spy).toHaveBeenCalled());cancel.abort();await rejected;}finally{spy.mockRestore();}
});
