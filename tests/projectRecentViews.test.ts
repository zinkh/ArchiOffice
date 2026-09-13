// Classement « ouverts récemment » de la liste des projets : voir
// server/projectRecentViews.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Projets ouverts récemment', () => {
  it("ouvrir la fiche complète pose last_opened_at pour la personne, et pour elle seule", async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    const { token: otherToken } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [
      { id: 'p-a', tenant_id: tenantId, name: 'A', client: 'x', status: 'Planning' },
      { id: 'p-b', tenant_id: tenantId, name: 'B', client: 'x', status: 'Planning' },
    ]);

    const before = await request(app).get('/api/projects').set(authHeader(token));
    expect(before.status).toBe(200);
    expect(before.body.every((p: any) => p.last_opened_at === null)).toBe(true);

    const full = await request(app).get('/api/projects/p-b/full').set(authHeader(token));
    expect(full.status).toBe(200);

    const after = await request(app).get('/api/projects').set(authHeader(token));
    const pb = after.body.find((p: any) => p.id === 'p-b');
    const pa = after.body.find((p: any) => p.id === 'p-a');
    expect(pb.last_opened_at).toBeTruthy();
    expect(pa.last_opened_at).toBeNull();

    // Une seule ligne par (personne, projet) : rouvrir met à jour la date,
    // n'empile pas.
    await request(app).get('/api/projects/p-b/full').set(authHeader(token));
    const rows = fakeSupabaseAdmin.getTable('project_recent_views').filter(r => r.user_id === userId && r.project_id === 'p-b');
    expect(rows).toHaveLength(1);

    // Un collègue du même cabinet n'hérite pas de mes ouvertures.
    const other = await request(app).get('/api/projects').set(authHeader(otherToken));
    expect(other.body.find((p: any) => p.id === 'p-b').last_opened_at).toBeNull();
  });

  it('la liste paginée porte aussi last_opened_at', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p-c', tenant_id: tenantId, name: 'C', client: 'x', status: 'Planning' }]);
    await request(app).get('/api/projects/p-c/full').set(authHeader(token));
    const page = await request(app).get('/api/projects').query({ limit: 10 }).set(authHeader(token));
    expect(page.status).toBe(200);
    expect(page.body.data.find((p: any) => p.id === 'p-c').last_opened_at).toBeTruthy();
  });
});
