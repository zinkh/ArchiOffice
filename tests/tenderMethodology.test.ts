import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('tender methodology notes', () => {
  it('creates a section as "a_rediger" then marks it "redige" once content is saved', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-meth-1';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const create = await request(app).post('/api/tender-methodology-notes').set(authHeader(token))
      .send({ tender_id: tenderId, title: 'Compréhension des enjeux', sort_order: 0 });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('a_rediger');

    const update = await request(app).put(`/api/tender-methodology-notes/${create.body.id}`).set(authHeader(token))
      .send({ title: create.body.title, content: 'Le projet...', sort_order: 0 });
    expect(update.status).toBe(200);

    const list = await request(app).get(`/api/tender-methodology-notes?tender_id=${tenderId}`).set(authHeader(token));
    expect(list.body[0].status).toBe('redige');
  });

  it('rejects a section on a tender belonging to another tenant', async () => {
    const tenantB = makeTenant();
    const tenderId = 'tender-meth-victim';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantB, title: 'Secret', client: 'Client B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const res = await request(app).post('/api/tender-methodology-notes').set(authHeader(token))
      .send({ tender_id: tenderId, title: 'X' });
    expect(res.status).toBe(400);
  });

  it('deletes a section', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-meth-2';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const create = await request(app).post('/api/tender-methodology-notes').set(authHeader(token))
      .send({ tender_id: tenderId, title: 'X' });
    const del = await request(app).delete(`/api/tender-methodology-notes/${create.body.id}`).set(authHeader(token));
    expect(del.status).toBe(200);
    const list = await request(app).get(`/api/tender-methodology-notes?tender_id=${tenderId}`).set(authHeader(token));
    expect(list.body).toHaveLength(0);
  });
});
