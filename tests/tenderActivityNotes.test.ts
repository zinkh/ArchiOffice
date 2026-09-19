import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('tender activity notes (journal de suivi)', () => {
  it('adds a note, stamped with the author name, newest first', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-note-1';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const create = await request(app).post('/api/tender-activity-notes').set(authHeader(token))
      .send({ tender_id: tenderId, content: 'Contact pris avec le BET fluides.' });
    expect(create.status).toBe(201);
    expect(create.body.author_name).toBeTruthy();

    const list = await request(app).get(`/api/tender-activity-notes?tender_id=${tenderId}`).set(authHeader(token));
    expect(list.body).toHaveLength(1);
  });

  it('rejects an empty note', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-note-2';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const res = await request(app).post('/api/tender-activity-notes').set(authHeader(token))
      .send({ tender_id: tenderId, content: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a note on a tender belonging to another tenant', async () => {
    const tenantB = makeTenant();
    const tenderId = 'tender-note-victim';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantB, title: 'Secret', client: 'Client B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const res = await request(app).post('/api/tender-activity-notes').set(authHeader(token))
      .send({ tender_id: tenderId, content: 'x' });
    expect(res.status).toBe(400);
  });
});
