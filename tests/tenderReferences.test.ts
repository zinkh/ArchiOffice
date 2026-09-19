import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('tender references', () => {
  it('attaches a project reference, enriches it, then toggles required', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-ref-1';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-1', tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status: 'Completed' }]);

    const create = await request(app).post('/api/tender-references').set(authHeader(token))
      .send({ tender_id: tenderId, project_id: 'proj-1', required: false });
    expect(create.status).toBe(201);

    const list = await request(app).get(`/api/tender-references?tender_id=${tenderId}`).set(authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('Villa Martin');
    expect(list.body[0].source).toBe('project');

    const update = await request(app).put(`/api/tender-references/${create.body.id}`).set(authHeader(token)).send({ required: true });
    expect(update.status).toBe(200);
  });

  it('rejects a reference to a project from another tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-ref-2';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const otherTenant = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-victim', tenant_id: otherTenant, name: 'Secret', client: 'X', status: 'Completed' }]);

    const res = await request(app).post('/api/tender-references').set(authHeader(token))
      .send({ tender_id: tenderId, project_id: 'proj-victim' });
    expect(res.status).toBe(400);
  });

  it('requires either a project_id or a custom_reference_id', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-ref-3';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client' }]);

    const res = await request(app).post('/api/tender-references').set(authHeader(token)).send({ tender_id: tenderId });
    expect(res.status).toBe(400);
  });
});
