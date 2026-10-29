import path from 'node:path';
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
  let owner: { id: string; queue: TransferQueue; cache: DownloadCache; session: AgentSession } | null = null;
  async function current() {
    const session = await config.session();
    if (!session?.userId || !session.tenantId || !session.deviceId || !session.token?.startsWith('ds_at_')) throw Object.assign(new Error('Invalid vault response'),{status:401,code:'DRIVE_VAULT_UNAVAILABLE'});
    const id = crypto.createHash('sha256').update(JSON.stringify([session.userId,session.tenantId])).digest('hex');
    if (!owner || owner.id !== id) owner = { id, session, queue: new TransferQueue(path.join(config.root,id),{userId:session.userId,tenantId:session.tenantId}), cache:new DownloadCache(path.join(config.root,id,'downloads'),{userId:session.userId,tenantId:session.tenantId}) };
    else owner.session = session;
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
      const blocked = jobs.filter(j=>j.state==='blocked').length;
      const conflicts = jobs.filter(j=>j.state==='conflict').length;
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
