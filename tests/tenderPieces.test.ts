import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('tender pieces (dossier de candidature)', () => {
  it('creates a piece and toggles its status to "fournie"', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-piece-1';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const create = await request(app).post('/api/tender-pieces').set(authHeader(token))
      .send({ tender_id: tenderId, section: 'candidature', label: 'DC1', obligatoire: true });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('a_fournir');

    const update = await request(app).put(`/api/tender-pieces/${create.body.id}`).set(authHeader(token))
      .send({ ...create.body, status: 'fournie' });
    expect(update.status).toBe(200);

    const list = await request(app).get(`/api/tender-pieces?tender_id=${tenderId}`).set(authHeader(token));
    expect(list.body[0].status).toBe('fournie');
  });

  it('rejects a piece referencing a document from another tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-piece-2';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const otherTenant = makeTenant();
    fakeSupabaseAdmin.seed('documents', [{ id: 'doc-victim', tenant_id: otherTenant, name: 'secret.pdf', file_url: 'x' }]);

    const res = await request(app).post('/api/tender-pieces').set(authHeader(token))
      .send({ tender_id: tenderId, label: 'DC1', document_id: 'doc-victim' });
    expect(res.status).toBe(400);
  });

  it('rejects a piece on a tender belonging to another tenant', async () => {
    const tenantB = makeTenant();
    const tenderId = 'tender-piece-victim';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantB, title: 'Secret', client: 'Client B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const res = await request(app).post('/api/tender-pieces').set(authHeader(token))
      .send({ tender_id: tenderId, label: 'DC1' });
    expect(res.status).toBe(400);
  });
});
