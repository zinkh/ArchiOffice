// Intervenants des entreprises d'un lot (onglet DET > Entreprises) : server/routes/lotIntervenants.ts
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seed(tenantId: string, suffixe: string) {
  fakeSupabaseAdmin.seed('projects', [{ id: `li-p-${suffixe}`, tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status: 'Planning' }]);
  fakeSupabaseAdmin.seed('project_lots', [{ id: `li-lot-${suffixe}`, tenant_id: tenantId, project_id: `li-p-${suffixe}`, lot_number: '04', lot_title: 'Gros oeuvre' }]);
}

describe('intervenants d’un lot', () => {
  it('plusieurs intervenants pour une même entreprise, chacun avec son rôle', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'a');
    const un = await request(app).post('/api/lots/li-lot-a/intervenants').set(authHeader(token))
      .send({ entreprise: 'HCT', nom: 'Paul Durand', role: 'Conducteur de travaux', email: 'paul@hct.fr' });
    const deux = await request(app).post('/api/lots/li-lot-a/intervenants').set(authHeader(token))
      .send({ entreprise: 'HCT', nom: 'Léa Roux', role: 'Chef de chantier', telephone: '0600000000' });
    expect(un.status).toBe(201);
    expect(deux.status).toBe(201);
    const liste = await request(app).get('/api/projects/li-p-a/lot-intervenants').set(authHeader(token));
    expect(liste.status).toBe(200);
    expect(liste.body).toHaveLength(2);
    expect(liste.body[0]).toMatchObject({ project_id: 'li-p-a', lot_id: 'li-lot-a', entreprise: 'HCT', nom: 'Paul Durand', role: 'Conducteur de travaux' });
  });

  it('exige un nom et une entreprise', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'b');
    const sansNom = await request(app).post('/api/lots/li-lot-b/intervenants').set(authHeader(token)).send({ entreprise: 'HCT', nom: '  ' });
    const sansEntreprise = await request(app).post('/api/lots/li-lot-b/intervenants').set(authHeader(token)).send({ nom: 'Paul' });
    expect(sansNom.status).toBe(400);
    expect(sansEntreprise.status).toBe(400);
  });

  it('refuse le lot d’un autre cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'c');
    const autre = makeTenant();
    fakeSupabaseAdmin.seed('project_lots', [{ id: 'li-lot-etranger', tenant_id: autre, project_id: 'li-p-x', lot_number: '01', lot_title: 'VRD' }]);
    const res = await request(app).post('/api/lots/li-lot-etranger/intervenants').set(authHeader(token)).send({ entreprise: 'X', nom: 'Y' });
    expect(res.status).toBe(404);
  });

  it('modifie puis supprime un intervenant, sans toucher à ceux d’un autre cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'd');
    const cree = await request(app).post('/api/lots/li-lot-d/intervenants').set(authHeader(token)).send({ entreprise: 'HCT', nom: 'Paul', role: 'Chef' });
    const maj = await request(app).put(`/api/lot-intervenants/${cree.body.id}`).set(authHeader(token)).send({ nom: 'Paul Durand', role: 'Conducteur de travaux' });
    expect(maj.status).toBe(200);
    expect(maj.body).toMatchObject({ nom: 'Paul Durand', role: 'Conducteur de travaux', entreprise: 'HCT' });

    const autre = makeTenant();
    const { token: tokenAutre } = makeUser(autre);
    const refus = await request(app).put(`/api/lot-intervenants/${cree.body.id}`).set(authHeader(tokenAutre)).send({ nom: 'Piraté' });
    expect(refus.status).toBe(404);
    await request(app).delete(`/api/lot-intervenants/${cree.body.id}`).set(authHeader(tokenAutre));
    expect(fakeSupabaseAdmin.getTable('lot_intervenants').some((i: any) => i.id === cree.body.id)).toBe(true);

    const suppr = await request(app).delete(`/api/lot-intervenants/${cree.body.id}`).set(authHeader(token));
    expect(suppr.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('lot_intervenants').some((i: any) => i.id === cree.body.id)).toBe(false);
  });
});
