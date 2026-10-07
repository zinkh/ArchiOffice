// Bâtiments et phases d'un chantier : server/routes/chantierDecoupage.ts, plus
// l'affectation portée par les comptes-rendus et les observations.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seedProject(tenantId: string, id: string) {
  fakeSupabaseAdmin.seed('projects', [{ id, tenant_id: tenantId, name: 'Groupe scolaire', client: 'Mairie', status: 'Planning' }]);
}

describe('Registre bâtiments / phases du chantier', () => {
  it('assainit et enregistre le registre, puis le relit', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'cd1');
    const put = await request(app).put('/api/projects/cd1/chantier-decoupage').set(authHeader(token)).send({
      batiments: [{ id: 'b1', code: 'A', libelle: 'Principal', ordre: 0 }, { id: 'b1', code: 'doublon', ordre: 1 }, { code: 'sans id' }],
      phases: [{ id: 'p1', code: 'PH1', libelle: 'Gros œuvre', ordre: 0 }],
    });
    expect(put.status).toBe(200);
    expect(put.body.batiments).toHaveLength(1);
    expect(put.body).toMatchObject({ multiBatiments: true, multiPhases: true });
    const get = await request(app).get('/api/projects/cd1/chantier-decoupage').set(authHeader(token));
    expect(get.body.batiments[0]).toMatchObject({ id: 'b1', code: 'A' });
  });

  it('refuse une opération d’un autre cabinet', async () => {
    const owner = makeTenant();
    seedProject(owner, 'cd2');
    const { token } = makeUser(makeTenant());
    const res = await request(app).put('/api/projects/cd2/chantier-decoupage').set(authHeader(token)).send({});
    expect(res.status).toBe(404);
  });

  it('un chantier sans registre se lit vide', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'cd3');
    const res = await request(app).get('/api/projects/cd3/chantier-decoupage').set(authHeader(token));
    expect(res.body).toMatchObject({ multiBatiments: false, batiments: [], phases: [] });
  });
});

describe('Affectation d’un compte-rendu et d’une observation', () => {
  it('porte le bâtiment et la phase à la création et à la modification', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'cd4');
    const created = await request(app).post('/api/projects/cd4/reports').set(authHeader(token))
      .send({ id: 'rep-1', date: '2026-10-07', batiment_id: 'b1', phase_id: 'p1' });
    expect(created.status).toBe(201);
    expect(fakeSupabaseAdmin.getTable('site_reports')[0]).toMatchObject({ batiment_id: 'b1', phase_id: 'p1' });

    const upd = await request(app).put('/api/reports/rep-1').set(authHeader(token)).send({ batiment_id: null });
    expect(upd.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('site_reports')[0]).toMatchObject({ batiment_id: null, phase_id: 'p1' });

    const obs = await request(app).post('/api/projects/cd4/observations').set(authHeader(token))
      .send({ id: 'obs-1', texte: 'Fissure', batiment_id: 'b2' });
    expect(obs.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('observations')[0]).toMatchObject({ batiment_id: 'b2', phase_id: null });
  });

  it('une rubrique créée avec son id n’est jamais dupliquée au rejeu', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'cd5');
    fakeSupabaseAdmin.seed('site_reports', [{ id: 'rep-5', tenant_id: tenantId, project_id: 'cd5', date: '2026-10-07', report_number: 1 }]);
    const body = { id: 'note-1', category: 'Sécurité', note_number: 1, text: '', status: 'open' };
    await request(app).post('/api/reports/rep-5/notes').set(authHeader(token)).send(body);
    const again = await request(app).post('/api/reports/rep-5/notes').set(authHeader(token)).send(body);
    expect(again.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('site_report_notes')).toHaveLength(1);
  });
});
