// Phase 7 batch 23: end-to-end Supertest coverage for the domains extracted
// into server/routes/{plans,documents}.ts — file-storage-backed CRUD, with
// document versioning, statut transitions, and diffusions to external
// contacts. Uploads use supertest's .attach()/.field() the same way
// phase7Batch20.test.ts (Visas) already exercised multer + uploadToStorage.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Plans', () => {
  it('creates, lists, and deletes a plan', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/plans').set(authHeader(token))
      .field('project_id', 'p1').field('name', 'Plan RDC')
      .attach('file', Buffer.from('%PDF-fake'), 'plan.pdf');
    expect(created.status).toBe(200);
    expect(created.body.file_url).toBeTruthy();

    const listed = await request(app).get('/api/plans').query({ project_id: 'p1' }).set(authHeader(token));
    expect(listed.body.some((p: any) => p.id === created.body.id)).toBe(true);

    const deleted = await request(app).delete(`/api/plans/${created.body.id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('plans').find(p => p.id === created.body.id)).toBeUndefined();
  });

  it('rejects a plan with no file attached', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/plans').set(authHeader(token)).field('project_id', 'p1').field('name', 'Sans fichier');
    expect(res.status).toBe(400);
  });
});

describe('Documents', () => {
  it('uploads a document, seeding its first version', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/documents').set(authHeader(token))
      .field('project_id', 'p1').field('name', 'CCTP Lot 01').field('category', 'CCTP')
      .attach('file', Buffer.from('%PDF-fake'), 'cctp.pdf');
    expect(res.status).toBe(201);
    const doc = fakeSupabaseAdmin.getTable('documents').find(d => d.id === res.body.id);
    expect(doc?.doc_statut).toBe('en_cours');
    expect(doc?.indice).toBe('A');
    const versions = fakeSupabaseAdmin.getTable('document_versions').filter(v => v.document_id === res.body.id);
    expect(versions.length).toBe(1);
    expect(versions[0].version).toBe(1);
  });

  it('rejects a document with no file attached', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/documents').set(authHeader(token)).field('project_id', 'p1').field('name', 'Sans fichier');
    expect(res.status).toBe(400);
  });

  it('enforces the plan\'s document quota', async () => {
    const tenantId = makeTenant({ plan: 'trial' }); // trial allows only 10 documents
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('documents', Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, tenant_id: tenantId, name: `Doc ${i}` })));

    const res = await request(app).post('/api/documents').set(authHeader(token))
      .field('project_id', 'p1').field('name', 'Trop')
      .attach('file', Buffer.from('x'), 'x.pdf');
    expect(res.status).toBe(402);
  });

  it('lists only the caller tenant\'s documents', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('documents', [{ id: 'doc-b', tenant_id: tenantB, name: 'Secret' }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).get('/api/documents').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((d: any) => d.id === 'doc-b')).toBe(false);
  });

  it('re-uploading a new file bumps the version and indice, and adds a version row', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('documents', [{ id: 'doc1', tenant_id: tenantId, name: 'CCTP', version: 1, indice: 'A', project_id: 'p1' }]);

    const res = await request(app).put('/api/documents/doc1').set(authHeader(token))
      .field('name', 'CCTP v2').field('category', 'CCTP')
      .attach('file', Buffer.from('%PDF-fake-v2'), 'cctp-v2.pdf');
    expect(res.status).toBe(200);
    const doc = fakeSupabaseAdmin.getTable('documents').find(d => d.id === 'doc1');
    expect(doc?.version).toBe(2);
    expect(doc?.indice).toBe('B');
    const versions = fakeSupabaseAdmin.getTable('document_versions').filter(v => v.document_id === 'doc1');
    expect(versions.length).toBe(1);
    expect(versions[0].version).toBe(2);
  });

  it('updates document metadata without a new file, leaving version untouched', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('documents', [{ id: 'doc2', tenant_id: tenantId, name: 'Old name', version: 1 }]);

    const res = await request(app).put('/api/documents/doc2').set(authHeader(token)).send({ name: 'New name', category: 'Plan' });
    expect(res.status).toBe(200);
    const doc = fakeSupabaseAdmin.getTable('documents').find(d => d.id === 'doc2');
    expect(doc?.name).toBe('New name');
    expect(doc?.version).toBe(1);
  });

  it('lists a document\'s versions', async () => {
    // Not asserting ordering: fakeSupabaseAdmin's `.order()` is a documented
    // no-op, so this only locks in that the route returns all of this
    // document's versions, tenant-scoped.
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('document_versions', [
      { id: 'v1', tenant_id: tenantId, document_id: 'doc3', version: 1 },
      { id: 'v2', tenant_id: tenantId, document_id: 'doc3', version: 2 },
    ]);

    const res = await request(app).get('/api/documents/doc3/versions').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.map((v: any) => v.version).sort()).toEqual([1, 2]);
  });

  it('rejects an invalid statut transition', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('documents', [{ id: 'doc4', tenant_id: tenantId, name: 'X' }]);

    const res = await request(app).patch('/api/documents/doc4/statut').set(authHeader(token)).send({ doc_statut: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('approves a document, stamping the approbateur and date', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('documents', [{ id: 'doc5', tenant_id: tenantId, name: 'X' }]);

    const res = await request(app).patch('/api/documents/doc5/statut').set(authHeader(token)).send({ doc_statut: 'approuve', approbateur: 'Jean' });
    expect(res.status).toBe(200);
    const doc = fakeSupabaseAdmin.getTable('documents').find(d => d.id === 'doc5');
    expect(doc?.approbateur).toBe('Jean');
    expect(doc?.date_approbation).toBeTruthy();
  });

  it('creates and acknowledges a diffusion', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('documents', [{ id: 'doc6', tenant_id: tenantId, name: 'X' }]);

    const created = await request(app).post('/api/documents/doc6/diffusions').set(authHeader(token)).send({ contact_name: 'Entreprise X', contact_email: 'x@example.test' });
    expect(created.status).toBe(201);

    const listed = await request(app).get('/api/documents/doc6/diffusions').set(authHeader(token));
    expect(listed.body.some((d: any) => d.id === created.body.id)).toBe(true);

    const acked = await request(app).patch(`/api/documents/doc6/diffusions/${created.body.id}/acknowledge`).set(authHeader(token));
    expect(acked.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('document_diffusions').find(d => d.id === created.body.id)?.acknowledged_at).toBeTruthy();
  });

  it('rejects a diffusion with no contact_name', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/documents/doc7/diffusions').set(authHeader(token)).send({});
    expect(res.status).toBe(400);
  });

  it('never lets a caller delete another tenant\'s document', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('documents', [{ id: 'doc-b2', tenant_id: tenantB, name: 'Secret' }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).delete('/api/documents/doc-b2').set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('documents').find(d => d.id === 'doc-b2')).toBeDefined();
  });
});
