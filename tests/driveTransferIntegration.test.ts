import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin } from './testServer';
import { API, makeActor, makeDriveTenant, seedDocument, seedProject } from './desktopSyncSupport';
import { createUploadTransport } from '../server/desktop/agent/uploadTransport';
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
it('uses the real transport contract to preserve a conflict as a linked new document without overwriting the original',async()=>{
  const tenantId=makeDriveTenant();const actor=await makeActor(app,tenantId);seedProject(tenantId,'p-conflict');
  seedDocument(tenantId,{id:'original',project_id:'p-conflict',name:'Plan.txt',version:2});
  const bodies:any[]=[];
  vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{
    const route=new URL(url).pathname;const method=(init.method||'GET').toLowerCase();
    let req=(request(app) as any)[method](route).set(init.headers);
    if(init.body) {
      if(typeof init.body==='string'){const body=JSON.parse(init.body);if(route.endsWith('/uploads'))bodies.push(body);req=req.send(body);}
      else req=req.send(Buffer.from(init.body as Uint8Array));
    }
    const res=await req;
    return new Response(res.status===204?null:JSON.stringify(res.body),{status:res.status});
  });
  try {
    const file=path.join(root,'Conflict.txt');await fs.writeFile(file,'conflicting snapshot');
    const q=new TransferQueue(path.join(root,'conflict-queue'),{userId:actor.userId,tenantId});
    const job=await q.enqueue(file,{documentId:'doc:original'},1,'text/plain');
    const transport=createUploadTransport('https://www.archioffice.fr',tenantId,async()=>actor.headers.Authorization.replace('Bearer ',''));
    expect(await q.runNext(transport)).toMatchObject({state:'conflict',errorCode:'VERSION_CONFLICT'});
    await fs.writeFile(file,'later changes');await q.preserveConflict(job.id);
    const saved=await q.runNext(transport);expect(saved).toMatchObject({state:'done',result:{version:1}});
    expect(bodies[0].target).toEqual({documentId:'original'});
    expect(bodies[1].target).toEqual({create:{parentId:`inbox:${tenantId}`,conflictOf:'original'}});
    const documents=fakeSupabaseAdmin.getTable('documents').filter(d=>d.tenant_id===tenantId);
    expect(documents.find(d=>d.id==='original')?.version).toBe(2);
    expect(documents.find(d=>d.conflict_of==='original')).toMatchObject({project_id:null,size_bytes:Buffer.byteLength('conflicting snapshot')});
    expect(await fs.readFile(file,'utf8')).toBe('later changes');
    expect((await q.preserveConflict(job.id)).id).toBe(saved!.id);
    expect(documents).toHaveLength(2);
  } finally {vi.unstubAllGlobals();}
});
