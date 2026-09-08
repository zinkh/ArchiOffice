// Coverage for the DET-module fusion (see supabase/migrate_det_enrichment.sql
// and CLAUDE.md): observations gained type/urgence/photos, site_reports
// gained attendance/statut/decisions — carried over from the never-mounted
// src/pages/DET.tsx prototype (removed along with det_data) onto the real
// observations/site_reports model instead.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('observations — type/urgence/photos', () => {
  it('defaults type and urgence on create, then updates them', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = 'project-1';

    const created = await request(app)
      .post(`/api/projects/${projectId}/observations`)
      .set(authHeader(token))
      .send({ texte: 'Fissure façade nord' });
    expect(created.status).toBe(200);
    expect(created.body.type).toBe('observation');
    expect(created.body.urgence).toBe('normal');
    const obsId = created.body.id;

    const updated = await request(app)
      .put(`/api/observations/${obsId}`)
      .set(authHeader(token))
      .send({ type: 'reserve', urgence: 'bloquant', photos: ['https://storage.test/photo1.png'] });
    expect(updated.status).toBe(200);

    const row = fakeSupabaseAdmin.getTable('observations').find(r => r.id === obsId);
    expect(row?.type).toBe('reserve');
    expect(row?.urgence).toBe('bloquant');
    expect(row?.photos).toEqual(['https://storage.test/photo1.png']);
  });

  it('creates a reserve directly with a custom type/urgence', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = 'project-2';

    const created = await request(app)
      .post(`/api/projects/${projectId}/observations`)
      .set(authHeader(token))
      .send({ texte: 'Note de calcul manquante', type: 'reserve', urgence: 'urgent' });
    expect(created.status).toBe(200);
    expect(created.body.type).toBe('reserve');
    expect(created.body.urgence).toBe('urgent');
  });

  it('never lets a caller mutate another tenant\'s observation', async () => {
    const tenantB = makeTenant();
    const obsId = 'obs-b';
    fakeSupabaseAdmin.seed('observations', [{ id: obsId, tenant_id: tenantB, project_id: 'project-b', texte: 'SECRET', statut: 'À faire', type: 'observation', urgence: 'normal', photos: [] }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put(`/api/observations/${obsId}`).set(authHeader(token)).send({ urgence: 'bloquant' });
    expect(fakeSupabaseAdmin.getTable('observations').find(r => r.id === obsId)?.urgence).toBe('normal');
  });
});

describe('site_reports — attendance/statut/decisions', () => {
  it('persists meteo/temperature on create and attendance/statut/decisions on update', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = 'project-1';

    const created = await request(app)
      .post(`/api/projects/${projectId}/reports`)
      .set(authHeader(token))
      .send({ date: '2026-09-08', report_number: 1, meteo: 'Couvert', temperature: 17 });
    expect(created.status).toBe(201);
    const reportId = created.body.id;
    expect(fakeSupabaseAdmin.getTable('site_reports').find(r => r.id === reportId)?.meteo).toBe('Couvert');

    const updated = await request(app)
      .put(`/api/reports/${reportId}`)
      .set(authHeader(token))
      .send({
        attendance: [{ name: 'J. Dupont', role: 'Bâti Delacroix SA', present: true }],
        statut: 'diffuse',
        decisions: [{ auteur: 'CM', texte: 'Décalage du lot 04', tag: 'planning' }],
      });
    expect(updated.status).toBe(200);
    expect(updated.body.statut).toBe('diffuse');
    expect(updated.body.attendance).toHaveLength(1);
    expect(updated.body.decisions).toHaveLength(1);
  });
});
