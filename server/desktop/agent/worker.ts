import { queueWindowsEdit, type WindowsEditInput } from './windowsEdits';
import { buildWindowsCatalog, catalogReader } from './windowsCatalog';
import path from 'node:path';
import type { DriveDocumentStatus, DriveRemoteCheck } from '../../../shared/driveDocumentStatus';
import { WorkingCopies } from './workingCopies';
import { DownloadCache } from './downloadCache';
import { createDownloadTransport, type DownloadMetadata } from './downloadTransport';
import crypto from 'node:crypto';
import { TransferQueue, type TransferTarget } from './transferQueue';
import { createUploadTransport } from './uploadTransport';
export interface AgentSession { userId: string; tenantId: string; deviceId: string; token: string }
export interface WorkerConfig {
  root: string; origin: string;
  session(): Promise<AgentSession>;
  status(value: { state: 'running' | 'paused' | 'stopped'; code?: string; pending?: number; blocked?: number; conflicts?: number }): void;
}
/** One process owns the queue. Each HTTP request asks the vault owner again. */
export function createAgentWorker(config: WorkerConfig) {
  let stopped = false; let running: Promise<void> | null = null;
  const abort = new AbortController();
  const downloads = new Set<Promise<unknown>>();
  let workingUploads: Promise<unknown> = Promise.resolve();
  type Owner = { id: string; queue: TransferQueue; cache: DownloadCache; working: WorkingCopies; session: AgentSession };
  // Retain a single writer when the linked account changes and later returns.
  const owners = new Map<string, Owner>();
  async function current() {
    const session = await config.session();
    if (!session?.userId || !session.tenantId || !session.deviceId || !session.token?.startsWith('ds_at_')) throw Object.assign(new Error('Invalid vault response'),{status:401,code:'DRIVE_VAULT_UNAVAILABLE'});
    const id = crypto.createHash('sha256').update(JSON.stringify([session.userId,session.tenantId])).digest('hex');
    let owner = owners.get(id);
    if (!owner) owner = { id, session, queue: new TransferQueue(path.join(config.root,id),{userId:session.userId,tenantId:session.tenantId}), cache:new DownloadCache(path.join(config.root,id,'downloads'),{userId:session.userId,tenantId:session.tenantId}), working:new WorkingCopies(path.join(config.root,id,'working'),{userId:session.userId,tenantId:session.tenantId}) };
    else owner.session = session;
    owners.set(id, owner);
    return owner;
  }
  async function tick() {
    try {
      const ctx = await current();
      const expected = { ...ctx.session };
      config.status({state:'running'});
      const transport = createUploadTransport(config.origin,ctx.session.tenantId,async () => {
        abort.signal.throwIfAborted();
        const session = await config.session();
        if (session.userId !== expected.userId || session.tenantId !== expected.tenantId || session.deviceId !== expected.deviceId) throw Object.assign(new Error('Account changed'),{status:403,code:'DRIVE_IDENTITY_MISMATCH'});
        return session.token;
      });
      // Bounded work per tick; the next pass discovers newly queued work/backoff.
      for (let i=0;i<10 && !stopped;i++) {
        const job = await ctx.queue.runNext(transport,abort.signal);
        if (!job) break;
        if (job.state === 'blocked' && ['DEVICE_REVOKED','DRIVE_SUBSCRIPTION_REQUIRED','DRIVE_REMOTE_REFUSAL'].includes(job.errorCode || '')) {
          config.status({state:'paused',code:job.errorCode!}); break;
        }
      }
      const jobs = await ctx.queue.list();
      // Replay completed snapshots before accepting another edit's baseline.
      for (const job of jobs) await ctx.working.acknowledge(job);
      const blocked = jobs.filter(j=>j.state==='blocked').length;
      const conflicts = jobs.filter(j=>j.state==='conflict'&&j.reconciledVersion===undefined).length;
      config.status({state:blocked || conflicts ? 'paused':'running',blocked,conflicts,
        pending:jobs.filter(j=>['queued','uploading','retry'].includes(j.state)).length});
    } catch (e: any) { if (!stopped) config.status({state:'paused',code:/^[A-Z_]{1,64}$/.test(e.code) ? e.code : 'DRIVE_AGENT_UNAVAILABLE'}); }
  }
  return {
    tick() { if (stopped) return Promise.resolve(); if (!running) running = tick().finally(()=> { running=null; }); return running; },
    async enqueue(file: string, target?: TransferTarget, baseVersion: number | null = null) {
      if (stopped) throw new Error('Agent stopped');
      const ctx = await current();
      const job = await ctx.queue.enqueue(file,target || {create:{parentId:`inbox:${ctx.session.tenantId}`}},baseVersion);
      return { queued:true,jobId:job.id }; // no local path, token or license
    },
    preserveConflict(nodeId: string) {
      const task=workingUploads.then(async()=> {
        if(stopped)throw new Error('Agent stopped');
        const ctx=await current();
        const conflict=(await ctx.queue.list()).find(j=>'documentId' in j.target&&j.target.documentId===nodeId&&j.state==='conflict'&&j.reconciledVersion===undefined);
        if(!conflict)throw Object.assign(new Error('No conflict'),{code:'CONFLICT_REQUIRED'});
        const copy=await ctx.queue.preserveConflict(conflict.id);
        return {queued:true,alreadyDone:copy.state==='done'};
      });
      workingUploads=task.catch(()=>{});downloads.add(task);void task.finally(()=>downloads.delete(task)).catch(()=>{});return task;
    },
    restartWorkingCopy(nodeId: string) {
      const task=workingUploads.then(async()=> {
        if(stopped)throw new Error('Agent stopped');
        const ctx=await current();const expected={...ctx.session};
        const authorize=async()=> {
          abort.signal.throwIfAborted();const active=await config.session();
          if(active.userId!==expected.userId||active.tenantId!==expected.tenantId||active.deviceId!==expected.deviceId)throw Object.assign(new Error('Account changed'),{code:'DRIVE_IDENTITY_MISMATCH'});
          return active.token;
        };
        const jobs=await ctx.queue.list();
        const conflict=jobs.find(j=>!j.sourceId&&'documentId' in j.target&&j.target.documentId===nodeId&&j.state==='conflict'&&j.reconciledVersion===undefined);
        if(!conflict||!jobs.some(j=>j.conflictSourceId===conflict.id&&j.state==='done'))throw Object.assign(new Error('Preserve conflict first'),{code:'CONFLICT_PRESERVATION_REQUIRED'});
        const transport=createDownloadTransport(config.origin,expected.tenantId,authorize);
        const meta=await transport.metadata(nodeId,abort.signal);await ctx.cache.hydrate(meta,transport,abort.signal);
        const cached=await ctx.cache.lookup(meta);if(!cached)throw new Error('Version not cached');
        const copy=await ctx.working.restart(meta,cached,conflict.id,authorize);
        await authorize();await ctx.queue.reconcileConflict(conflict.id,copy.baseVersion);
        return {version:copy.baseVersion};
      });
      workingUploads=task.catch(()=>{});downloads.add(task);void task.finally(()=>downloads.delete(task)).catch(()=>{});return task;
    },
    checkRemoteVersion(nodeId: string, refresh = false) {
      const task:Promise<DriveRemoteCheck>=workingUploads.then(async()=> {
        if(stopped)throw new Error('Agent stopped');
        const ctx=await current();const expected={...ctx.session};
        const authorize=async()=> {
          abort.signal.throwIfAborted();const active=await config.session();
          if(active.userId!==expected.userId||active.tenantId!==expected.tenantId||active.deviceId!==expected.deviceId)throw Object.assign(new Error('Account changed'),{code:'DRIVE_IDENTITY_MISMATCH'});
          return active.token;
        };
        const jobs=await ctx.queue.listPersisted();for(const job of jobs)await ctx.working.acknowledge(job);
        const relevant=(items:typeof jobs)=>items.filter(j=>'documentId' in j.target&&j.target.documentId===nodeId);
        const baseline=JSON.stringify(relevant(jobs));
        if(relevant(jobs).some(j=>j.state!=='done'&&j.reconciledVersion===undefined)){await authorize();return {status:'busy'};}
        let copy;
        try {copy=await ctx.working.inspect(nodeId);}catch(e:any){if(e.code!=='WORKING_COPY_UNAVAILABLE')throw e;await authorize();return {status:'missing'};}
        const transport=createDownloadTransport(config.origin,expected.tenantId,authorize);const meta=await transport.metadata(nodeId,abort.signal);
        await authorize();
        const versions={localVersion:copy.baseVersion,remoteVersion:meta.version};
        if(meta.version===copy.baseVersion&&meta.sha256&&meta.sha256!==copy.baselineSha256)throw Object.assign(new Error('Remote version mutated'),{code:'REMOTE_VERSION_MUTATED'});
        if(copy.modified)return {status:'modified',...versions};
        if(meta.version<copy.baseVersion)return {status:'local_newer',...versions};
        if(meta.version===copy.baseVersion)return {status:'current',...versions};
        if(!refresh)return {status:'remote_newer',...versions};
        await ctx.cache.hydrate(meta,transport,abort.signal);const cached=await ctx.cache.lookup(meta);if(!cached)throw new Error('Version not cached');
        const hex=crypto.createHash('sha256').update(JSON.stringify(['refresh',ctx.id,nodeId,copy.baseVersion,meta.version,meta.sha256])).digest('hex').slice(0,32);
        const operation=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
        const next=await ctx.working.restart(meta,cached,operation,async()=> {
          await authorize();
          if(JSON.stringify(relevant(await ctx.queue.listPersisted()))!==baseline)throw Object.assign(new Error('Queue changed'),{code:'WORKING_REFRESH_BUSY'});
        },true);
        await authorize();return {status:'refreshed',localVersion:next.baseVersion,remoteVersion:meta.version};
      });
      workingUploads=task.catch(()=>{});downloads.add(task);void task.finally(()=>downloads.delete(task)).catch(()=>{});return task;
    },
    uploadWindowsEdit(input: WindowsEditInput) {
      const task=workingUploads.then(async()=>{
        if(stopped)throw new Error('Agent stopped');
        const ctx=await current();const expected={...ctx.session};
        return queueWindowsEdit({root:path.join(path.dirname(config.root),'drive-windows-preview'),identity:expected,input,queue:ctx.queue,
          cached:meta=>ctx.cache.lookup(meta),authorize:async()=>{
            abort.signal.throwIfAborted();const active=await config.session();
            if(['userId','tenantId','deviceId'].some(k=>active[k as keyof AgentSession]!==expected[k as keyof AgentSession]))throw Object.assign(new Error('Account changed'),{code:'DRIVE_IDENTITY_MISMATCH'});
          }});
      });
      workingUploads=task.catch(()=>{});downloads.add(task);void task.finally(()=>downloads.delete(task)).catch(()=>{});return task;
    },
    windowsPreview(action: 'catalog' | 'hydrate', input: any) {
      const task=(async()=> {
        if(stopped)throw new Error('Agent stopped');const ctx=await current();const expected={...ctx.session};
        const authorize=async()=> {
          abort.signal.throwIfAborted();const active=await config.session();
          if(active.userId!==expected.userId||active.tenantId!==expected.tenantId||active.deviceId!==expected.deviceId)throw new Error('Identity changed');return active.token;
        };
        const transport=createDownloadTransport(config.origin,expected.tenantId,authorize);
        if(action==='catalog') {
          const read=catalogReader(config.origin,expected.tenantId,authorize);
          const entries=await buildWindowsCatalog(input.projectId,route=>read(route,abort.signal),id=>transport.metadata(id,abort.signal));
          await authorize();return {identity:{userId:expected.userId,tenantId:expected.tenantId,deviceId:expected.deviceId},entries};
        }
        if(!input.identity||['userId','tenantId','deviceId'].some(k=>input.identity[k]!==expected[k]))throw new Error('Identity changed');
        const meta:DownloadMetadata=input.meta;
        if(!meta||meta.size>50*1024*1024)throw new Error('Invalid preview file');
        let cached=await ctx.cache.lookup(meta);if(!cached){await ctx.cache.hydrate(meta,transport,abort.signal);cached=await ctx.cache.lookup(meta);}
        if(!cached)throw new Error('Cache unavailable');await authorize();return {file:cached.file};
      })();
      downloads.add(task);void task.finally(()=>downloads.delete(task)).catch(()=>{});return task;
    },
    async documentStatuses(nodeIds: string[]) {
      if(stopped)throw new Error('Agent stopped');
      if(!Array.isArray(nodeIds)||nodeIds.length>100||nodeIds.some(id=>typeof id!=='string'||!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(id))||new Set(nodeIds).size!==nodeIds.length)
        throw Object.assign(new Error('Invalid documents'),{code:'INVALID_DOCUMENTS'});
      const ctx=await current();const expected={...ctx.session};
      const jobs=await ctx.queue.listPersisted();
      const documents:DriveDocumentStatus[]=nodeIds.map(nodeId=> {
        const matching=jobs.filter(j=>'documentId' in j.target&&j.target.documentId===nodeId);
        const conflict=matching.find(j=>j.state==='conflict'&&j.reconciledVersion===undefined);
        if(conflict) {
          const copy=jobs.find(j=>j.conflictSourceId===conflict.id);
          return {nodeId,state:'conflict',...(copy ? {preservation:copy.state==='done'?'done':copy.state==='blocked'||copy.state==='conflict'?'blocked':'pending'} : {})};
        }
        const pending=matching.find(j=>j.state!=='done'&&j.reconciledVersion===undefined);
        const job=conflict||pending||matching.at(-1);
        if(!job)return {nodeId,state:'none'};
        if(job.reconciledVersion!==undefined)return {nodeId,state:'reconciled',version:job.reconciledVersion};
        if(job.state==='done') {
          if(job.result?.node.id!==nodeId||!Number.isSafeInteger(job.result.version)||job.result.version<1)throw new Error('Invalid completed upload');
          return {nodeId,state:'uploaded',version:job.result.version};
        }
        return {nodeId,state:job.state};
      });
      const active=await config.session();abort.signal.throwIfAborted();
      if(active.userId!==expected.userId||active.tenantId!==expected.tenantId||active.deviceId!==expected.deviceId)
        throw Object.assign(new Error('Account changed'),{code:'DRIVE_IDENTITY_MISMATCH'});
      return {documents,identity:{userId:expected.userId,tenantId:expected.tenantId,deviceId:expected.deviceId}};
    },
    /** Native-only command: reuse the tracked file offline; fetch only on first open. */
    openWorkingCopy(nodeId: string) {
      const task=(async()=> {
        if(stopped)throw new Error('Agent stopped');
        const ctx=await current();const expected={...ctx.session};
        const authorize=async()=> {
          abort.signal.throwIfAborted();const active=await config.session();
          if(active.userId!==expected.userId||active.tenantId!==expected.tenantId||active.deviceId!==expected.deviceId)
            throw Object.assign(new Error('Account changed'),{code:'DRIVE_IDENTITY_MISMATCH'});
          return active.token;
        };
        let copy;
        try { copy=await ctx.working.inspect(nodeId); }
        catch(e:any) {
          if(e.code!=='WORKING_COPY_UNAVAILABLE')throw e;
          const transport=createDownloadTransport(config.origin,expected.tenantId,authorize);
          const meta=await transport.metadata(nodeId,abort.signal);
          await ctx.cache.hydrate(meta,transport,abort.signal);
          const cached=await ctx.cache.lookup(meta);
          if(!cached)throw Object.assign(new Error('Version not cached'),{code:'DRIVE_VERSION_NOT_CACHED'});
          copy=await ctx.working.prepare(meta,cached);
        }
        await authorize();abort.signal.throwIfAborted();
        return {file:copy.file,identity:{userId:expected.userId,tenantId:expected.tenantId,deviceId:expected.deviceId}};
      })();
      downloads.add(task);void task.finally(()=>downloads.delete(task)).catch(()=>{});return task;
    },
    /** Private entry point for future native adapters; no arbitrary URL/path. */
    keepOffline(nodeId: string) {
      const task=(async()=> {
      if(stopped)throw new Error('Agent stopped');
      const ctx=await current();const expected={...ctx.session};
      const transport=createDownloadTransport(config.origin,expected.tenantId,async()=> {
        const session=await config.session();
        if(session.userId!==expected.userId||session.tenantId!==expected.tenantId||session.deviceId!==expected.deviceId)throw Object.assign(new Error('Account changed'),{status:403,code:'DRIVE_IDENTITY_MISMATCH'});
        return session.token;
      });
      const meta=await transport.metadata(nodeId,abort.signal);
      return ctx.cache.hydrate(meta,transport,abort.signal);
      })();
      downloads.add(task);void task.finally(()=>downloads.delete(task)).catch(()=>{});return task;
    },
    async cachedVersion(meta: DownloadMetadata) {
      if(stopped)throw new Error('Agent stopped');
      const ctx=await current(); // offline signed authorization is still mandatory
      abort.signal.throwIfAborted();return ctx.cache.lookup(meta);
    },
    /** Private adapter API: known cached metadata permits offline materialization.
     * The returned path must stay in the native process, never a browser API. */
    prepareWorkingCopy(meta: DownloadMetadata) {
      const task=(async()=> {
        if(stopped)throw new Error('Agent stopped');
        const ctx=await current();const expected={...ctx.session};
        const cached=await ctx.cache.lookup(meta);
        if(!cached)throw Object.assign(new Error('Version not cached'),{code:'DRIVE_VERSION_NOT_CACHED'});
        abort.signal.throwIfAborted();
        const result=await ctx.working.prepare(meta,cached);
        const session=await config.session();abort.signal.throwIfAborted();
        if(session.userId!==expected.userId||session.tenantId!==expected.tenantId||session.deviceId!==expected.deviceId)throw Object.assign(new Error('Account changed'),{code:'DRIVE_IDENTITY_MISMATCH'});
        return result;
      })();
      downloads.add(task);void task.finally(()=>downloads.delete(task)).catch(()=>{});return task;
    },
    uploadWorkingCopy(nodeId: string) {
      const task=workingUploads.then(async()=> {
        if(stopped)throw new Error('Agent stopped');
        const ctx=await current();
        // Recover a completed upload if the previous process exited before ack.
        for(const job of await ctx.queue.list())await ctx.working.acknowledge(job);
        const jobs=await ctx.queue.list();
        if(jobs.some(j=>'documentId' in j.target && j.target.documentId===nodeId && j.state==='conflict'&&j.reconciledVersion===undefined))
          throw Object.assign(new Error('Resolve conflict first'),{code:'WORKING_UPLOAD_CONFLICT'});
        const pending=jobs.find(j=>'documentId' in j.target && j.target.documentId===nodeId && j.state!=='done'&&j.reconciledVersion===undefined);
        if(pending)return {queued:true,jobId:pending.id,pending:true};
        const copy=await ctx.working.inspect(nodeId);abort.signal.throwIfAborted();
        if(!copy.modified)return {queued:false};
        const job=await ctx.queue.enqueue(copy.file,{documentId:nodeId},copy.baseVersion);
        return {queued:true,jobId:job.id};
      });
      workingUploads=task.catch(()=>{});
      downloads.add(task);void task.finally(()=>downloads.delete(task)).catch(()=>{});return task;
    },
    async retryBlocked() {
      if (stopped) throw new Error('Agent stopped');
      const ctx = await current();
      const jobs = (await ctx.queue.list()).filter(j=>j.state==='blocked');
      for (const job of jobs) await ctx.queue.retry(job.id);
      return { retried: jobs.length };
    },
    async stop() { stopped=true; abort.abort(); await Promise.allSettled([running, ...downloads]); config.status({state:'stopped'}); },
  };
}
