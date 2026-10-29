import { beforeAll, afterAll, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin } from './testServer';
import { API, makeActor, makeDriveTenant, seedDocument, seedProject } from './desktopSyncSupport';
import { TransferQueue, type UploadTransport } from '../server/desktop/agent/transferQueue';
let app: Express; let root: string;
beforeAll(async () => { app = await getTestApp(); root = await fs.mkdtemp(path.join(os.tmpdir(),'drive-api-transfer-')); });
afterAll(async () => { await fs.rm(root,{recursive:true,force:true}); });
it('uploads the preserved snapshot through the actual desktop routes and creates a technical version without advancing the index', async () => {
  const tenantId = makeDriveTenant(); const actor = await makeActor(app,tenantId);
  seedProject(tenantId,'p1'); seedDocument(tenantId,{id:'d1',project_id:'p1',name:'Plan.txt'});
  const file = path.join(root,'Plan.txt'); await fs.writeFile(file,'version saved at enqueue');
  const q = new TransferQueue(path.join(root,'queue'),{userId:actor.userId,tenantId});
  await q.enqueue(file,{documentId:'d1'},1,'text/plain');
  await fs.writeFile(file,'later edits still on disk');
  const checked = (res: any) => { if (res.status >= 400) throw Object.assign(new Error('API failure'),{status:res.status,code:res.body.code}); return res.body; };
  const transport: UploadTransport = {
    open: async body => checked(await request(app).post(`${API}/uploads`).set(actor.headers).send(body)),
    status: async id => checked(await request(app).get(`${API}/uploads/${id}`).set(actor.headers)),
    chunk: async (id,start,total,bytes) => { checked(await request(app).put(`${API}/uploads/${id}`).set(actor.headers)
      .set('Content-Type','application/octet-stream').set('Content-Range',`bytes ${start}-${start+bytes.length-1}/${total}`).send(bytes)); },
    complete: async (id,sha256) => checked(await request(app).post(`${API}/uploads/${id}/complete`).set(actor.headers).send({sha256})),
  };
  expect(await q.runNext(transport)).toMatchObject({state:'done',result:{version:2}});
  const doc = fakeSupabaseAdmin.getTable('documents').find(d=>d.tenant_id===tenantId && d.id==='d1')!;
  expect(doc.version).toBe(2); expect(doc.indice).toBe('A');
  expect(doc.size_bytes).toBe(Buffer.byteLength('version saved at enqueue'));
  expect(await fs.readFile(file,'utf8')).toBe('later edits still on disk');
});
