import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
const require=createRequire(import.meta.url);
const {agentEnvironment,requestVault,createDriveAgent}=require('../electron/driveAgent.cjs');
afterEach(()=>vi.useRealTimers());
function child(){const c:any=new EventEmitter();c.connected=true;c.send=vi.fn((value:any,cb:any)=>cb?.(null));c.kill=vi.fn();return c;}
it('does not forward application secrets to the worker environment',()=>{
  const env=agentEnvironment({PATH:'/bin',HTTPS_PROXY:'https://proxy.test',DRIVE_LICENSE_PRIVATE_KEY:'private',SUPABASE_SERVICE_ROLE_KEY:'service',MAIL_ENCRYPTION_KEY:'mail'});
  expect(env).toEqual({PATH:'/bin',HTTPS_PROXY:'https://proxy.test',ELECTRON_RUN_AS_NODE:'1'});
});
it('uses correlated private IPC for vault access and removes listeners',async()=>{
  const server=child();const promise=requestVault(server);const request=server.send.mock.calls[0][0];
  server.emit('message',{type:'drive:vault-result',requestId:request.requestId,result:{token:'ds_at_secret'}});
  expect(await promise).toEqual({token:'ds_at_secret'});expect(server.listenerCount('message')).toBe(0);
});
it('routes credentials only to the worker, filters status, and stops restarts on quit',async()=>{
  vi.useFakeTimers();const server=child();const worker=child();const spawn=vi.fn((_exe:string,_args:string[],_options:any)=>worker);const status=vi.fn();
  const agent=createDriveAgent({spawn,executable:'electron',entry:'drive-agent.cjs',root:'/cache',origin:'https://www.archioffice.fr',getServer:()=>server,onStatus:status,environment:{DRIVE_LICENSE_PRIVATE_KEY:'private'}});
  agent.start();expect(spawn.mock.calls[0][2].env).not.toHaveProperty('DRIVE_LICENSE_PRIVATE_KEY');
  worker.emit('message',{type:'drive:authorize',requestId:'worker-1'});
  const req=server.send.mock.calls[0][0];server.emit('message',{type:'drive:vault-result',requestId:req.requestId,result:{token:'ds_at_secret'}});
  await Promise.resolve();await Promise.resolve();
  expect(worker.send.mock.calls.some(([m]:any)=>m.type==='drive:authorization'&&m.result.token==='ds_at_secret')).toBe(true);
  worker.emit('message',{type:'drive:status',state:'running',pending:3,token:'secret'});
  expect(status).toHaveBeenLastCalledWith({state:'running',pending:3,blocked:0,conflicts:0});
  agent.stop();worker.emit('exit',0);await vi.advanceTimersByTimeAsync(60000);expect(spawn).toHaveBeenCalledTimes(1);
});
it('restarts only after exit and bounds repeated crashes',async()=>{
  vi.useFakeTimers();const spawned:any[]=[];const spawn=vi.fn(()=>{const c=child();spawned.push(c);return c;});
  const agent=createDriveAgent({spawn,executable:'electron',entry:'agent',root:'/cache',origin:'https://www.archioffice.fr',getServer:()=>null});
  agent.start();
  for(let i=0;i<4;i++){spawned[i].emit('exit',1);await vi.advanceTimersByTimeAsync(60000);}
  expect(spawn).toHaveBeenCalledTimes(4);agent.stop();
});
it('correlates private working-copy replies and rejects invalid document commands',async()=>{
  const worker=child();const agent=createDriveAgent({spawn:()=>worker,executable:'electron',entry:'agent',root:'/cache',origin:'https://www.archioffice.fr',getServer:()=>null});
  agent.start();await expect(agent.working('open','../../file')).rejects.toThrow('Invalid document');
  const result=agent.working('open','doc:one');const req=worker.send.mock.calls.at(-1)[0];
  expect(req).toMatchObject({type:'drive:open-working',nodeId:'doc:one'});
  worker.emit('message',{type:'drive:working-result',requestId:req.requestId,result:{file:'/private/Plan.pdf'}});
  expect(await result).toEqual({file:'/private/Plan.pdf'});
  const saved=agent.working('preserve','doc:one');const preserveReq=worker.send.mock.calls.at(-1)[0];
  expect(preserveReq).toMatchObject({type:'drive:preserve-working',nodeId:'doc:one'});
  worker.emit('message',{type:'drive:working-result',requestId:preserveReq.requestId,result:{queued:true}});
  expect(await saved).toEqual({queued:true});
  const restart=agent.working('restart','doc:one');const restartReq=worker.send.mock.calls.at(-1)[0];
  expect(restartReq.type).toBe('drive:restart-working');
  worker.emit('message',{type:'drive:working-result',requestId:restartReq.requestId,result:{version:2}});expect(await restart).toEqual({version:2});
  for(const action of ['check','refresh']) {
    const read=agent.working(action,'doc:one');const req=worker.send.mock.calls.at(-1)[0];
    expect(req.type).toBe(`drive:${action}-working`);
    worker.emit('message',{type:'drive:working-result',requestId:req.requestId,result:{status:'current',localVersion:2,remoteVersion:2}});
    expect(await read).toMatchObject({status:'current'});
  }
  const waiting=agent.working('upload','doc:one');worker.emit('exit',1);
  await expect(waiting).rejects.toThrow('Agent unavailable');agent.stop();
});
it('correlates batched state replies and rejects excessive or duplicate requests',async()=>{
  const worker=child();const agent=createDriveAgent({spawn:()=>worker,executable:'electron',entry:'agent',root:'/cache',origin:'https://www.archioffice.fr',getServer:()=>null});
  agent.start();
  for(const ids of [Array(101).fill('doc:one'),['doc:one','doc:one'],['../bad']])await expect(agent.documentStatuses(ids)).rejects.toThrow('Invalid documents');
  const waiting=agent.documentStatuses(['doc:one']);const req=worker.send.mock.calls.at(-1)[0];
  expect(req).toMatchObject({type:'drive:document-statuses',nodeIds:['doc:one']});
  worker.emit('message',{type:'drive:document-statuses-result',requestId:req.requestId,result:{documents:[{nodeId:'doc:one',state:'retry'}]}});
  expect(await waiting).toEqual({documents:[{nodeId:'doc:one',state:'retry'}]});agent.stop();worker.emit('exit',0);
});
