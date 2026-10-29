import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DownloadMetadata, DownloadTransport } from './downloadTransport';
interface CacheRecord { formatVersion:1; userId:string;tenantId:string;meta:DownloadMetadata;state:'pending'|'downloading'|'complete'|'blocked'|'retry';sha256?:string;errorCode?:string }
const fail=(code:string)=>Object.assign(new Error(code),{status:400,code});
async function digest(file:string){const hash=crypto.createHash('sha256');let size=0;for await(const b of createReadStream(file)){hash.update(b);size+=b.length;}return {sha256:hash.digest('hex'),size};}
/** Immutable version cache. No name or path received from the server is used as
 * a disk path. One writer per directory; neither working files nor old versions
 * are overwritten or evicted by this component. */
export class DownloadCache {
  private chain:Promise<unknown>=Promise.resolve();
  constructor(private root:string,private identity:{userId:string;tenantId:string}){}
  private serial<T>(fn:()=>Promise<T>):Promise<T>{const p=this.chain.then(fn);this.chain=p.catch(()=>{});return p;}
  private key(meta:DownloadMetadata){return crypto.createHash('sha256').update(JSON.stringify([this.identity.userId,this.identity.tenantId,meta.nodeId,meta.version])).digest('hex');}
  private async save(key:string,record:CacheRecord){
    const tmp=path.join(this.root,`${key}.${crypto.randomUUID()}.tmp`);
    try{const fd=await fs.open(tmp,'wx',0o600);try{await fd.writeFile(JSON.stringify(record));await fd.sync();}finally{await fd.close();}
      await fs.rename(tmp,path.join(this.root,`${key}.json`));}
    finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  }
  private validate(meta:DownloadMetadata){
    if(!meta.nodeId?.startsWith('doc:')||meta.nodeId.length>512||!Number.isSafeInteger(meta.version)||meta.version<1||!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>200*1024*1024
      ||typeof meta.name!=='string'||(meta.sha256!==null&&!/^[a-f0-9]{64}$/.test(meta.sha256)))throw fail('INVALID_DOWNLOAD_METADATA');
  }
  private async record(meta:DownloadMetadata):Promise<CacheRecord>{
    this.validate(meta);await fs.mkdir(this.root,{recursive:true,mode:0o700});const key=this.key(meta);
    try {
      const filename=path.join(this.root,`${key}.json`);if((await fs.stat(filename)).size>65536)throw fail('CACHE_CORRUPT');
      const r:CacheRecord=JSON.parse(await fs.readFile(filename,'utf8'));
      if(!r||!r.meta||r.formatVersion!==1||r.userId!==this.identity.userId||r.tenantId!==this.identity.tenantId||r.meta.nodeId!==meta.nodeId||r.meta.version!==meta.version
        ||!['pending','downloading','complete','blocked','retry'].includes(r.state)||(r.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(r.sha256)))throw fail('CACHE_CORRUPT');
      if(r.meta.size!==meta.size||(r.meta.sha256&&meta.sha256&&r.meta.sha256!==meta.sha256))throw fail('REMOTE_VERSION_MUTATED');
      return r;
    }catch(e:any){if(e.code!=='ENOENT')throw e;return {formatVersion:1,...this.identity,meta:structuredClone(meta),state:'pending'};}
  }
  /** A caller must validate the local signed authorization before offline lookup. */
  lookup(meta:DownloadMetadata){return this.serial(async()=>{
    const r=await this.record(meta);if(r.state!=='complete'||!r.sha256)return null;
    const file=path.join(this.root,`${this.key(meta)}.cache`);const actual=await digest(file);
    if(actual.size!==meta.size||actual.sha256!==r.sha256||(meta.sha256&&meta.sha256!==actual.sha256))throw fail('CACHE_CORRUPT');
    return {file,version:meta.version,sha256:actual.sha256,verifiedAgainstRemote:!!meta.sha256};
  });}
  hydrate(meta:DownloadMetadata,transport:DownloadTransport,signal?:AbortSignal){return this.serial(async()=>{
    const record=await this.record(meta);const key=this.key(meta);const file=path.join(this.root,`${key}.cache`);const partial=path.join(this.root,`${key}.part`);
    const verify=async()=>{const actual=await digest(file);if(actual.size!==meta.size||!record.sha256||actual.sha256!==record.sha256||(meta.sha256&&meta.sha256!==actual.sha256))throw fail('CACHE_CORRUPT');
      record.state='complete';delete record.errorCode;await this.save(key,record);return {version:meta.version,sha256:actual.sha256,verifiedAgainstRemote:!!meta.sha256};};
    // Recover a completed link even if the last manifest update was interrupted.
    try{await fs.stat(file);return await verify();}catch(e:any){if(e.code!=='ENOENT')throw e;}
    record.state='downloading';await this.save(key,record);
    let fd:Awaited<ReturnType<typeof fs.open>>|undefined;
    try{
      try{fd=await fs.open(partial,'r+');}catch(e:any){if(e.code!=='ENOENT')throw e;fd=await fs.open(partial,'wx+',0o600);}
      let offset=(await fd.stat()).size;if(offset>meta.size)throw fail('CACHE_PARTIAL_CORRUPT');
      // Legacy files have no server checksum: never combine multiple responses
      // or resume a prefix that cannot be bound to the same bytes.
      if(!meta.sha256&&offset>0){await fd.truncate(0);offset=0;}
      while(offset<meta.size){
        signal?.throwIfAborted();const block=await transport.read(meta,offset,meta.sha256?Math.min(8*1024*1024,meta.size-offset):meta.size,signal);
        if(block.start!==offset&&block.start!==0)throw fail('DOWNLOAD_RANGE_REFUSED');
        if(block.start===0&&offset>0){await fd.truncate(0);offset=0;}
        const before=offset;
        for await(const chunk of block.body){signal?.throwIfAborted();if(offset+chunk.length>meta.size)throw fail('DOWNLOAD_TOO_LARGE');
          let written=0;while(written<chunk.length){const r=await fd.write(chunk,written,chunk.length-written,offset+written);if(!r.bytesWritten)throw fail('CACHE_WRITE_FAILED');written+=r.bytesWritten;}
          offset+=chunk.length;
        }
        await fd.sync();if(offset===before||(!meta.sha256&&offset<meta.size))throw fail('DOWNLOAD_INCOMPLETE');
      }
      await fd.close();fd=undefined;
      const actual=await digest(partial);if(actual.size!==meta.size||(meta.sha256&&actual.sha256!==meta.sha256))throw fail('DOWNLOAD_CHECKSUM_MISMATCH');
      if(record.sha256&&record.sha256!==actual.sha256)throw fail('REMOTE_VERSION_MUTATED');
      record.sha256=actual.sha256;await this.save(key,record);
      // Exclusive publication: never overwrite an existing cached version.
      await fs.link(partial,file);const result=await verify();await fs.rm(partial,{force:true});return result;
    }catch(e:any){
      if(fd){await fd.sync().catch(()=>{});await fd.close();fd=undefined;}
      record.state=(e.status>=400&&e.status<500)||['ENOENT','EACCES','EPERM'].includes(e.code)?'blocked':'retry';
      record.errorCode=/^[A-Z_]{1,64}$/.test(e.code)?e.code:'DOWNLOAD_FAILED';await this.save(key,record);throw e;
    }finally{await fd?.close();}
  });}
}
