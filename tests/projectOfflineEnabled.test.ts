// « Disponible hors connexion » par projet (projects.offline_enabled) — voir
// supabase/migrate_project_offline_enabled.sql et src/lib/offlinePrefetch.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Projet disponible hors connexion', () => {
  it('PUT persiste offline_enabled, repris par la liste et la fiche complète', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status: 'Planning', offline_enabled: false }]);

    const updated = await request(app).put('/api/projects/p1').set(authHeader(token))
      .send({ name: 'Villa Martin', client: 'M. Martin', offline_enabled: true });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('projects').find(p => p.id === 'p1')?.offline_enabled).toBe(true);

    const list = await request(app).get('/api/projects').set(authHeader(token));
    expect(list.body.find((p: any) => p.id === 'p1')?.offline_enabled).toBe(true);

    const full = await request(app).get('/api/projects/p1/full').set(authHeader(token));
    expect(full.body.project.offline_enabled).toBe(true);
  });

  it('décocher repasse offline_enabled à false', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p2', tenant_id: tenantId, name: 'Extension Dupont', client: 'M. Dupont', status: 'Planning', offline_enabled: true }]);

    const updated = await request(app).put('/api/projects/p2').set(authHeader(token))
      .send({ name: 'Extension Dupont', client: 'M. Dupont', offline_enabled: false });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('projects').find(p => p.id === 'p2')?.offline_enabled).toBe(false);
  });
});
