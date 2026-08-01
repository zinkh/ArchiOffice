// Phase 7 batch 20: end-to-end Supertest coverage for the "suivi de
// chantier" (site tracking) cluster — Ordres de service, Visas, Receptions,
// Reserves, GPA reserves, Permits, RFIs. Newly discovered as a large
// still-inline domain that every prior bilan had simply never listed as a
// remaining candidate (see the correction in the plan file after lot 19) —
// not part of the deliberately-deferred core, just previously overlooked.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Ordres de service', () => {
  it('creates, updates, transitions status, and deletes an OS', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/ordres_de_service').set(authHeader(token)).send({
      project_id: 'p1', os_number: '001', title: 'Terrassement', type: 'travaux',
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const listed = await request(app).get('/api/ordres_de_service').query({ project_id: 'p1' }).set(authHeader(token));
    expect(listed.body.some((o: any) => o.id === id)).toBe(true);

    const updated = await request(app).put(`/api/ordres_de_service/${id}`).set(authHeader(token)).send({ title: 'Terrassement modifié' });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('ordres_de_service').find(o => o.id === id)?.title).toBe('Terrassement modifié');

    const transitioned = await request(app).patch(`/api/ordres_de_service/${id}/status`).set(authHeader(token)).send({ status: 'submitted' });
    expect(transitioned.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('ordres_de_service').find(o => o.id === id)?.status).toBe('submitted');

    const deleted = await request(app).delete(`/api/ordres_de_service/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('ordres_de_service').find(o => o.id === id)).toBeUndefined();
  });

  it('rejects an invalid status transition', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('ordres_de_service', [{ id: 'os1', tenant_id: tenantId, title: 'X', status: 'draft' }]);

    const res = await request(app).patch('/api/ordres_de_service/os1/status').set(authHeader(token)).send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('computes the next OS number for a project', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('ordres_de_service', [
      { id: 'os2', tenant_id: tenantId, project_id: 'p2', os_number: '001' },
      { id: 'os3', tenant_id: tenantId, project_id: 'p2', os_number: '003' },
    ]);

    const res = await request(app).get('/api/ordres_de_service/next-number').query({ project_id: 'p2' }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.next).toBe('004');
  });
});

describe('Visas', () => {
  it('creates, updates, and deletes a visa', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/visas').set(authHeader(token)).field('project_id', 'p1').field('title', 'Visa fondations');
    expect(created.status).toBe(200);
    const id = created.body.id;

    const listed = await request(app).get('/api/visas').query({ project_id: 'p1' }).set(authHeader(token));
    expect(listed.body.some((v: any) => v.id === id)).toBe(true);

    const updated = await request(app).put(`/api/visas/${id}`).set(authHeader(token)).field('title', 'Visa fondations validé').field('status', 'approved');
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('visas').find(v => v.id === id)?.status).toBe('approved');

    const deleted = await request(app).delete(`/api/visas/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('visas').find(v => v.id === id)).toBeUndefined();
  });
});

describe('Receptions', () => {
  it('creates, updates, and deletes a reception', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/receptions').set(authHeader(token)).send({ project_id: 'p1', date: '2026-01-01', type: 'OPR', has_reserves: true, reserves_count: 2 });
    expect(created.status).toBe(200);
    const id = created.body.id;
    expect(fakeSupabaseAdmin.getTable('receptions').find(r => r.id === id)?.has_reserves).toBe(true);

    const listed = await request(app).get('/api/receptions').query({ project_id: 'p1' }).set(authHeader(token));
    expect(listed.body.some((r: any) => r.id === id)).toBe(true);

    const updated = await request(app).put(`/api/receptions/${id}`).set(authHeader(token)).send({ date: '2026-01-02', type: 'OPR', pv_valide: true });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('receptions').find(r => r.id === id)?.pv_valide).toBe(true);

    const deleted = await request(app).delete(`/api/receptions/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('receptions').find(r => r.id === id)).toBeUndefined();
  });
});

describe('Reserves', () => {
  it('auto-numbers reserves per project and never leaks across tenants', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('reserves', [{ id: 'r-existing', tenant_id: tenantId, project_id: 'p1', title: 'Fissure', number: 1 }]);

    const created = await request(app).post('/api/reserves').set(authHeader(token)).send({ project_id: 'p1', title: 'Fuite', status: 'A faire' });
    expect(created.status).toBe(200);
    expect(created.body.number).toBe(2);

    const updated = await request(app).put(`/api/reserves/${created.body.id}`).set(authHeader(token)).send({ title: 'Fuite réparée', status: 'Levée' });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('reserves').find(r => r.id === created.body.id)?.status).toBe('Levée');

    const deleted = await request(app).delete(`/api/reserves/${created.body.id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('reserves').find(r => r.id === created.body.id)).toBeUndefined();
  });

  it('never lists another tenant\'s reserves', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('reserves', [{ id: 'r-b', tenant_id: tenantB, project_id: 'p1', title: 'Secret', number: 1 }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).get('/api/reserves').query({ project_id: 'p1' }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((r: any) => r.id === 'r-b')).toBe(false);
  });
});

describe('GPA reserves', () => {
  it('auto-numbers GPA reserves per project, independently of OPR reserves', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    // A same-numbered OPR reserve must not influence the GPA sequence.
    fakeSupabaseAdmin.seed('reserves', [{ id: 'opr1', tenant_id: tenantId, project_id: 'p1', title: 'OPR', number: 5 }]);

    const created = await request(app).post('/api/gpa-reserves').set(authHeader(token)).send({ project_id: 'p1', title: 'Fissure GPA' });
    expect(created.status).toBe(200);
    expect(created.body.number).toBe(1);

    const updated = await request(app).put(`/api/gpa-reserves/${created.body.id}`).set(authHeader(token)).send({ title: 'Fissure GPA levée', status: 'Levée' });
    expect(updated.status).toBe(200);

    const deleted = await request(app).delete(`/api/gpa-reserves/${created.body.id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('gpa_reserves').find(r => r.id === created.body.id)).toBeUndefined();
  });
});

describe('Permits', () => {
  it('creates, updates, and deletes a permit', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/permits').set(authHeader(token)).send({ project_id: 'p1', type: 'PC', reference: 'PC-001' });
    expect(created.status).toBe(200);
    const id = created.body.id;
    expect(created.body.status).toBe('en_instruction');

    const listed = await request(app).get('/api/permits').query({ project_id: 'p1' }).set(authHeader(token));
    expect(listed.body.some((p: any) => p.id === id)).toBe(true);

    const updated = await request(app).put(`/api/permits/${id}`).set(authHeader(token)).send({ type: 'PC', status: 'accorde' });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('permits').find(p => p.id === id)?.status).toBe('accorde');

    const deleted = await request(app).delete(`/api/permits/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('permits').find(p => p.id === id)).toBeUndefined();
  });
});

describe('RFIs', () => {
  it('creates, answers, and deletes an RFI', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/rfis').set(authHeader(token)).send({ project_id: 'p1', question: 'Quelle teinte de façade ?' });
    expect(created.status).toBe(200);
    const id = created.body.id;
    expect(created.body.status).toBe('en_attente');

    const listed = await request(app).get('/api/rfis').query({ project_id: 'p1' }).set(authHeader(token));
    expect(listed.body.some((r: any) => r.id === id)).toBe(true);

    const answered = await request(app).put(`/api/rfis/${id}`).set(authHeader(token)).send({ question: 'Quelle teinte de façade ?', status: 'repondu', answer: 'RAL 7016' });
    expect(answered.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('rfis').find(r => r.id === id)?.answer).toBe('RAL 7016');

    const deleted = await request(app).delete(`/api/rfis/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('rfis').find(r => r.id === id)).toBeUndefined();
  });
});
