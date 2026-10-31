// Classement par glisser-déposer : PUT /api/documents/:id rattache un document à une autre affaire.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seed() {
  const tenantId = makeTenant({});
  const { token } = makeUser(tenantId, 'admin');
  const autreCabinet = makeTenant({});
  const p1 = crypto.randomUUID(), p2 = crypto.randomUUID(), pEtranger = crypto.randomUUID(), docId = crypto.randomUUID();
  fakeSupabaseAdmin.seed('projects', [
    { id: p1, tenant_id: tenantId, name: 'A' }, { id: p2, tenant_id: tenantId, name: 'B' },
    { id: pEtranger, tenant_id: autreCabinet, name: 'Étranger' },
  ]);
  fakeSupabaseAdmin.seed('documents', [{ id: docId, tenant_id: tenantId, project_id: p1, name: 'plan.pdf', category: 'General', phase: 'ESQ', file_url: 'x' }]);
  return { token, p2, pEtranger, docId, tenantId };
}

describe('PUT /api/documents/:id avec project_id', () => {
  it('déplace le document vers une autre affaire et une autre phase', async () => {
    const { token, p2, docId } = seed();
    const res = await request(app).put(`/api/documents/${docId}`).set(authHeader(token))
      .send({ name: 'plan.pdf', category: 'General', phase: 'APS', project_id: p2 });
    expect(res.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('documents').find((d: any) => d.id === docId);
    expect(row.project_id).toBe(p2);
    expect(row.phase).toBe('APS');
  });

  it('refuse une affaire d\'un autre cabinet', async () => {
    const { token, pEtranger, docId } = seed();
    const res = await request(app).put(`/api/documents/${docId}`).set(authHeader(token))
      .send({ name: 'plan.pdf', category: 'General', project_id: pEtranger });
    expect(res.status).toBe(400);
  });

  it('détache le document avec une chaîne vide', async () => {
    const { token, docId } = seed();
    const res = await request(app).put(`/api/documents/${docId}`).set(authHeader(token))
      .send({ name: 'plan.pdf', category: 'General', project_id: '' });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('documents').find((d: any) => d.id === docId).project_id).toBeNull();
  });
});
