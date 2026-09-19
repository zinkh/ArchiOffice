import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('tender competitors', () => {
  it('creates, lists and deletes a competitor scoped to the tender\'s tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-comp-1';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const create = await request(app).post('/api/tender-competitors').set(authHeader(token))
      .send({ tender_id: tenderId, name: 'Atelier Concurrent', info: 'Réf. locales', risk_level: 'eleve' });
    expect(create.status).toBe(201);
    expect(create.body.risk_level).toBe('eleve');

    const list = await request(app).get(`/api/tender-competitors?tender_id=${tenderId}`).set(authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const del = await request(app).delete(`/api/tender-competitors/${create.body.id}`).set(authHeader(token));
    expect(del.status).toBe(200);
    const listAfter = await request(app).get(`/api/tender-competitors?tender_id=${tenderId}`).set(authHeader(token));
    expect(listAfter.body).toHaveLength(0);
  });

  it('rejects a competitor on a tender belonging to another tenant', async () => {
    const tenantB = makeTenant();
    const tenderId = 'tender-comp-victim';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantB, title: 'Secret', client: 'Client B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const res = await request(app).post('/api/tender-competitors').set(authHeader(token))
      .send({ tender_id: tenderId, name: 'X' });
    expect(res.status).toBe(400);
  });

  it('defaults an invalid risk_level to "moyen"', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-comp-2';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const create = await request(app).post('/api/tender-competitors').set(authHeader(token))
      .send({ tender_id: tenderId, name: 'X', risk_level: 'invalid' });
    expect(create.status).toBe(201);
    expect(create.body.risk_level).toBe('moyen');
  });
});
