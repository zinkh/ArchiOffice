import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { DownloadCache } from '../server/desktop/agent/downloadCache';
import type { DownloadMetadata,DownloadTransport } from '../server/desktop/agent/downloadTransport';
let root:string;const bytes=Buffer.from('complete document');
const identity={userId:'u1',tenantId:'t1'};
const hash=(b:Buffer)=>crypto.createHash('sha256').update(b).digest('hex');
let meta:DownloadMetadata;let transport:DownloadTransport;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'drive-download-'));meta={nodeId:'doc:1',version:1,size:bytes.length,sha256:hash(bytes),name:'../../Plan.pdf'};
  transport={metadata:async()=>meta,read:vi.fn(async(_,offset)=>({start:offset,body:(async function*(){yield bytes.subarray(offset);})()}))};});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
it('publishes a verified immutable cache without using the supplied filename as a path',async()=>{
 const cache=new DownloadCache(root,identity);expect(await cache.hydrate(meta,transport)).toMatchObject({version:1,verifiedAgainstRemote:true});
 const result=await cache.lookup(meta);expect(await fs.readFile(result!.file)).toEqual(bytes);
 expect((await fs.readdir(root)).every(n=>/^[a-f0-9]{64}\.(cache|json)$/.test(n))).toBe(true);
 await cache.hydrate(meta,transport);expect(transport.read).toHaveBeenCalledTimes(1);
});
it('resumes an interrupted prefix after restart and checks the final digest',async()=>{
 transport.read=vi.fn().mockImplementationOnce(async()=>({start:0,body:(async function*(){yield bytes.subarray(0,5);throw new Error('offline');})()}))
 .mockImplementation(async(_,offset)=>({start:offset,body:(async function*(){yield bytes.subarray(offset);})()}));
 await expect(new DownloadCache(root,identity).hydrate(meta,transport)).rejects.toThrow('offline');
 await new DownloadCache(root,identity).hydrate(meta,transport);
 expect((transport.read as any).mock.calls[1][1]).toBe(5);
});
it('restarts safely when storage ignores Range instead of appending a second full file',async()=>{
 transport.read=vi.fn().mockImplementationOnce(async()=>({start:0,body:(async function*(){yield bytes.subarray(0,5);throw new Error('offline');})()}))
 .mockImplementation(async()=>({start:0,body:(async function*(){yield bytes;})()}));
 await expect(new DownloadCache(root,identity).hydrate(meta,transport)).rejects.toThrow();
 const cache=new DownloadCache(root,identity);await cache.hydrate(meta,transport);expect(await fs.readFile((await cache.lookup(meta))!.file)).toEqual(bytes);
});
it('preserves earlier versions and refuses a changed hash for the same version',async()=>{
 const cache=new DownloadCache(root,identity);await cache.hydrate(meta,transport);const before=await cache.lookup(meta);
 await expect(cache.hydrate({...meta,sha256:'a'.repeat(64)},transport)).rejects.toThrow('REMOTE_VERSION_MUTATED');
 await cache.hydrate({...meta,version:2},transport);
 expect(await fs.readFile(before!.file)).toEqual(bytes);expect((await fs.readdir(root)).filter(n=>n.endsWith('.cache'))).toHaveLength(2);
});
it('rejects corruption and oversized content without publishing it or altering work files',async()=>{
 const working=path.join(root,'working.dwg');await fs.writeFile(working,'local edits');
 transport.read=vi.fn(async()=>({start:0,body:(async function*(){yield Buffer.alloc(bytes.length+1);})()}));
 const cache=new DownloadCache(root,identity);await expect(cache.hydrate(meta,transport)).rejects.toThrow('DOWNLOAD_TOO_LARGE');
 expect((await fs.readdir(root)).some(n=>n.endsWith('.cache'))).toBe(false);expect(await fs.readFile(working,'utf8')).toBe('local edits');
});
it('checks local cache integrity again on lookup and isolates accounts',async()=>{
 const cache=new DownloadCache(root,identity);await cache.hydrate(meta,transport);const local=await cache.lookup(meta);
 await fs.writeFile(local!.file,'edited');await expect(cache.lookup(meta)).rejects.toThrow('CACHE_CORRUPT');
 expect(await new DownloadCache(root,{...identity,tenantId:'other'}).lookup(meta)).toBeNull();
});
it('does not resume unverified legacy prefixes and labels their provenance',async()=>{
 meta.sha256=null;
 transport.read=vi.fn().mockImplementationOnce(async()=>({start:0,body:(async function*(){yield bytes.subarray(0,4);throw new Error('offline');})()}))
 .mockImplementation(async(_,offset)=>({start:offset,body:(async function*(){yield bytes;})()}));
 await expect(new DownloadCache(root,identity).hydrate(meta,transport)).rejects.toThrow();
 expect(await new DownloadCache(root,identity).hydrate(meta,transport)).toMatchObject({verifiedAgainstRemote:false});
 expect((transport.read as any).mock.calls[1][1]).toBe(0);
});
it('supports empty files without making a body request',async()=>{
 meta.size=0;meta.sha256=hash(Buffer.alloc(0));await new DownloadCache(root,identity).hydrate(meta,transport);expect(transport.read).not.toHaveBeenCalled();
});
it('refuses a checksum mismatch without publishing an incomplete version',async()=>{
 meta.sha256='a'.repeat(64);await expect(new DownloadCache(root,identity).hydrate(meta,transport)).rejects.toThrow('DOWNLOAD_CHECKSUM_MISMATCH');
 expect((await fs.readdir(root)).some(n=>n.endsWith('.cache'))).toBe(false);
});
it('does not replace known legacy bytes after cache deletion with changed provider content',async()=>{
 meta.sha256=null;const cache=new DownloadCache(root,identity);await cache.hydrate(meta,transport);
 const local=await cache.lookup(meta);await fs.rm(local!.file);
 transport.read=vi.fn(async()=>({start:0,body:(async function*(){yield Buffer.alloc(bytes.length,120);})()}));
 await expect(cache.hydrate(meta,transport)).rejects.toThrow('REMOTE_VERSION_MUTATED');
 expect((await fs.readdir(root)).some(n=>n.endsWith('.cache'))).toBe(false);
});
it('recovers publication interrupted before the last journal update without fetching again',async()=>{
 const cache=new DownloadCache(root,identity);await cache.hydrate(meta,transport);
 const name=(await fs.readdir(root)).find(n=>n.endsWith('.json'))!;const journal=JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
 journal.state='downloading';await fs.writeFile(path.join(root,name),JSON.stringify(journal));
 transport.read=vi.fn().mockRejectedValue(new Error('must not fetch'));
 expect(await new DownloadCache(root,identity).hydrate(meta,transport)).toMatchObject({version:1});expect(transport.read).not.toHaveBeenCalled();
});
it('refuses files above the initial limit before transferring bytes',async()=>{
 await expect(new DownloadCache(root,identity).hydrate({...meta,size:201*1024*1024},transport)).rejects.toThrow('INVALID_DOWNLOAD_METADATA');
 expect(transport.read).not.toHaveBeenCalled();
});
