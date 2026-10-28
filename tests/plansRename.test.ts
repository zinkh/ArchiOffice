// Renommage d'un plan : seul le nom change, validé côté serveur, borné au cabinet.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const plan = (id: string) => fakeSupabaseAdmin.getTable('plans').find(p => p.id === id);

function cabinet() {
  const tenantId = makeTenant();
  const { token } = makeUser(tenantId);
  fakeSupabaseAdmin.seed('projects', [{ id: `p-${tenantId}`, tenant_id: tenantId }]);
  fakeSupabaseAdmin.seed('plans', [{ id: `pl-${tenantId}`, tenant_id: tenantId, project_id: `p-${tenantId}`, name: 'ancien.pdf', file_url: 'x', index: 'A' }]);
  return { tenantId, token, planId: `pl-${tenantId}` };
}

describe('PUT /api/plans/:id', () => {
  it('renomme le plan sans toucher au fichier', async () => {
    const { token, planId } = cabinet();
    const res = await request(app).put(`/api/plans/${planId}`).set(authHeader(token)).send({ name: '  Façade   nord.pdf ' });
    expect(res.status).toBe(200);
    expect(plan(planId)).toMatchObject({ name: 'Façade nord.pdf', file_url: 'x', index: 'A' });
  });

  it('refuse un nom vide ou trop long', async () => {
    const { token, planId } = cabinet();
    expect((await request(app).put(`/api/plans/${planId}`).set(authHeader(token)).send({ name: '   ' })).status).toBe(400);
    expect((await request(app).put(`/api/plans/${planId}`).set(authHeader(token)).send({ name: 'a'.repeat(201) })).status).toBe(400);
    expect(plan(planId)?.name).toBe('ancien.pdf');
  });

  it('ne touche jamais le plan d\'un autre cabinet', async () => {
    const a = cabinet();
    const b = cabinet();
    const res = await request(app).put(`/api/plans/${b.planId}`).set(authHeader(a.token)).send({ name: 'piraté.pdf' });
    expect(res.status).toBe(404);
    expect(plan(b.planId)?.name).toBe('ancien.pdf');
  });
});

describe('PUT /api/plans/order', () => {
  const rang = (id: string) => fakeSupabaseAdmin.getTable('plans').find(p => p.id === id)?.sort_order;

  function deuxPlans() {
    const c = cabinet();
    fakeSupabaseAdmin.seed('plans', [{ id: `${c.planId}-2`, tenant_id: c.tenantId, project_id: `p-${c.tenantId}`, name: 'b.pdf', file_url: 'y', index: 'A' }]);
    return { ...c, projectId: `p-${c.tenantId}`, ids: [`${c.planId}-2`, c.planId] };
  }

  it('enregistre le rang de chaque plan dans l\'ordre reçu', async () => {
    const { token, projectId, ids } = deuxPlans();
    const res = await request(app).put('/api/plans/order').set(authHeader(token)).send({ project_id: projectId, ids });
    expect(res.status).toBe(200);
    expect(rang(ids[0])).toBe(0);
    expect(rang(ids[1])).toBe(1);
  });

  it('refuse un plan d\'un autre cabinet, un doublon ou une liste invalide, sans rien écrire', async () => {
    const a = deuxPlans();
    const b = deuxPlans();
    const h = authHeader(a.token);
    expect((await request(app).put('/api/plans/order').set(h).send({ project_id: a.projectId, ids: [a.ids[0], b.ids[0]] })).status).toBe(400);
    expect((await request(app).put('/api/plans/order').set(h).send({ project_id: a.projectId, ids: [a.ids[0], a.ids[0]] })).status).toBe(400);
    expect((await request(app).put('/api/plans/order').set(h).send({ project_id: a.projectId, ids: [] })).status).toBe(400);
    expect((await request(app).put('/api/plans/order').set(h).send({ ids: a.ids })).status).toBe(400);
    expect(rang(a.ids[0])).toBeUndefined();
    expect(rang(b.ids[0])).toBeUndefined();
  });
});
