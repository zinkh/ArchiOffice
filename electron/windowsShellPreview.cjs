'use strict';
const fs=require('fs/promises');const nativeFs=require('fs');const path=require('path');const {pipeline}=require('stream/promises');const {Transform}=require('stream');
const {noLinks}=require('./windowsDrive.cjs');const {agentEnvironment}=require('./driveAgent.cjs');
const formats=new Set(['.pdf','.png','.jpg','.jpeg','.gif','.bmp','.tif','.tiff']);
const sameFile=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
function createShellPreviewRenderer({spawn,executable,root,environment=process.env}) {
 return async(file,page,signal)=>{
  signal?.throwIfAborted();const extension=path.extname(file).toLowerCase();if(!formats.has(extension))return {status:'unsupported'};
  if(!Number.isSafeInteger(page)||page<0||page>=10000)throw new Error('Invalid page');
  const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.size>50*1024*1024)throw new Error('Invalid preview file');
  await fs.mkdir(root,{recursive:true,mode:0o700});await noLinks(root,root);const temporary=await fs.mkdtemp(path.join(root,'render-'));await noLinks(root,temporary);
  const input=path.join(temporary,'input'+extension);
  try {
   let bytes=0;const limit=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes>50*1024*1024?new Error('Preview size limit'):null,chunk);}});
   await pipeline(nativeFs.createReadStream(file),limit,nativeFs.createWriteStream(input,{flags:'wx',mode:0o600}),{signal});
   if(!sameFile(before,await fs.lstat(file))||bytes!==before.size)throw new Error('Preview source changed');
   const frame=await new Promise((resolve,reject)=>{
    const child=spawn(executable,[input,String(page)],{windowsHide:true,stdio:['ignore','pipe','ignore'],env:agentEnvironment(environment)});let buffers=[],size=0,done=false,failure=null;
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const abort=()=>{failure=new Error('Preview cancelled');child.kill();};const timer=setTimeout(()=>{failure=new Error('Preview timeout');child.kill();},12000);
    child.on('error',error=>{if(done)return;done=true;cleanup();reject(error);});
    child.stdout.on('data',chunk=>{if(done||failure)return;size+=chunk.length;if(size>512*640*4+20){failure=new Error('Preview frame limit');child.kill();}else buffers.push(chunk);});
    child.on('close',code=>{if(done)return;done=true;cleanup();if(failure||code!==0)reject(failure||new Error('Preview unavailable'));else resolve(Buffer.concat(buffers));});
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   });
   signal?.throwIfAborted();if(!sameFile(before,await fs.lstat(file)))throw new Error('Preview source changed');
   if(frame.length<20||frame.subarray(0,4).toString()!=='AOP1')throw new Error('Invalid preview frame');
   const width=frame.readUInt32LE(4),height=frame.readUInt32LE(8),pages=frame.readUInt32LE(12),current=frame.readUInt32LE(16);
   if(!width||width>512||!height||height>640||!pages||pages>10000||current!==page||current>=pages||frame.length!==20+width*height*4)throw new Error('Invalid preview dimensions');
   return {status:'preview',width,height,pages,page:current,pixels:frame.subarray(20).toString('base64')};
  }finally{await fs.rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});}
 };
}
module.exports={createShellPreviewRenderer};
