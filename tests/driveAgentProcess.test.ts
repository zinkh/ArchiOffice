import { build } from 'esbuild';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect,it } from 'vitest';
it('runs as a separate process, stays paused on vault refusal, then exits on stop',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'drive-process-'));let child:ReturnType<typeof fork>|undefined;
  try{
    const entry=path.join(root,'agent.cjs');await build({entryPoints:['server/desktop/agent/entry.ts'],outfile:entry,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
    child=fork(entry,[],{stdio:['ignore','ignore','ignore','ipc']});
    const ready=new Promise<any>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Agent timeout')),10000);
      child!.on('message',(msg:any)=>{
        if(msg.type==='drive:authorize')child!.send({type:'drive:authorization',requestId:msg.requestId,error:{status:402,code:'DRIVE_LICENSE_EXPIRED'}});
        if(msg.type==='drive:status'){clearTimeout(timeout);resolve(msg);}
      });
    });
    child.send({type:'drive:init',root:path.join(root,'queue'),origin:'https://www.archioffice.fr'});
    expect(await ready).toMatchObject({state:'paused',code:'DRIVE_LICENSE_EXPIRED'});
    const refused=new Promise<any>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Working command timeout')),10000);
      child!.on('message',(msg:any)=>{if(msg.type==='drive:working-result'){clearTimeout(timer);resolve(msg);}});
    });
    child.send({type:'drive:open-working',nodeId:'doc:one',requestId:'open-one'});
    expect(await refused).toMatchObject({type:'drive:working-result',error:{code:'DRIVE_LICENSE_EXPIRED'}});
    const preserveRefused=new Promise<any>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Preserve timeout')),10000);
      child!.on('message',(msg:any)=>{if(msg.type==='drive:working-result'&&msg.requestId==='preserve-one'){clearTimeout(timer);resolve(msg);}});
    });
    child.send({type:'drive:preserve-working',nodeId:'doc:one',requestId:'preserve-one'});
    expect(await preserveRefused).toMatchObject({error:{code:'DRIVE_LICENSE_EXPIRED'}});
    const restartRefused=new Promise<any>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Restart timeout')),10000);
      child!.on('message',(msg:any)=>{if(msg.type==='drive:working-result'&&msg.requestId==='restart-one'){clearTimeout(timer);resolve(msg);}});
    });
    child.send({type:'drive:restart-working',nodeId:'doc:one',requestId:'restart-one'});
    expect(await restartRefused).toMatchObject({error:{code:'DRIVE_LICENSE_EXPIRED'}});
    const stateRefused=new Promise<any>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Status command timeout')),10000);
      child!.on('message',(msg:any)=>{if(msg.type==='drive:document-statuses-result'){clearTimeout(timer);resolve(msg);}});
    });
    child.send({type:'drive:document-statuses',nodeIds:['doc:one'],requestId:'status-one'});
    expect(await stateRefused).toMatchObject({error:{code:'DRIVE_STATUS_UNAVAILABLE'}});
    const exited=new Promise(resolve=>child!.once('exit',resolve));child.send({type:'drive:stop'});expect(await exited).toBe(0);
  }finally{child?.kill();await fs.rm(root,{recursive:true,force:true});}
},15000);
