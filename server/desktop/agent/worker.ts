import path from 'node:path';
import type { DriveDocumentStatus } from '../../../shared/driveDocumentStatus';
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
        const conflict=jobs.find(j=>'documentId' in j.target&&j.target.documentId===nodeId&&j.state==='conflict'&&j.reconciledVersion===undefined);
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
