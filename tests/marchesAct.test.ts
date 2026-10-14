// Marchés constitués depuis l'ACT : server/routes/marchesEntreprises.ts
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seed(tenantId: string, projectId: string) {
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status: 'Planning' }]);
}
const marche = (extra: object = {}) => ({
  act_lot_id: 'L2', act_entreprise_id: 'E1', entreprise_nom: 'Dupont SARL', lot_numero: '02', lot_titre: 'Gros oeuvre',
  montant_ht: 1000, tva_rate: 20, ...extra,
});

describe('Marchés constitués depuis l’ACT', () => {
  it('crée un marché « à signer » par lot attribué, sans doublon au second appel', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'ma-p1');
    const post = (marches: object[]) => request(app).post('/api/projects/ma-p1/marches-act').set(authHeader(token)).send({ marches });

    const a = await post([marche()]);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ crees: 1, misAJour: 0, ignores: 0 });
    expect(a.body.marches[0]).toMatchObject({ statut_signature: 'a_signer', act_lot_id: 'L2', montant_ht: 1000 });

    const b = await post([marche({ montant_ht: 1200 })]);
    expect(b.body).toMatchObject({ crees: 0, misAJour: 1, ignores: 0 });
    expect(b.body.marches).toHaveLength(1);
    expect(b.body.marches[0].montant_ht).toBe(1200);
  });

  it('ne touche jamais un marché signé', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'ma-p2');
    const created = await request(app).post('/api/projects/ma-p2/marches-act').set(authHeader(token)).send({ marches: [marche()] });
    const id = created.body.marches[0].id;
    const sign = await request(app).post(`/api/marches-entreprises/${id}/signature`).set(authHeader(token)).send({ mode: 'papier', date_signature: '2026-10-14' });
    expect(sign.status).toBe(200);
    expect(sign.body).toMatchObject({ statut_signature: 'signe', mode_signature: 'papier', date_signature: '2026-10-14' });

    const again = await request(app).post('/api/projects/ma-p2/marches-act').set(authHeader(token)).send({ marches: [marche({ montant_ht: 5, entreprise_nom: 'Autre' })] });
    expect(again.body).toMatchObject({ crees: 0, misAJour: 0, ignores: 1 });
    expect(again.body.marches[0]).toMatchObject({ montant_ht: 1000, entreprise_nom: 'Dupont SARL' });

    const reopen = await request(app).post(`/api/marches-entreprises/${id}/signature/rouvrir`).set(authHeader(token));
    expect(reopen.body).toMatchObject({ statut_signature: 'a_signer', mode_signature: null, date_signature: null });
  });

  it('valide le corps : projet étranger, montant, mode et date de signature', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'ma-p3');
    const autre = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'ma-etranger', tenant_id: autre, name: 'X', client: 'Y', status: 'Planning' }]);
    const post = (p: string, marches: object[]) => request(app).post(`/api/projects/${p}/marches-act`).set(authHeader(token)).send({ marches });

    expect((await post('ma-etranger', [marche()])).status).toBe(400);
    expect((await post('ma-p3', [])).status).toBe(400);
    expect((await post('ma-p3', [marche({ montant_ht: 'abc' })])).status).toBe(400);
    expect((await post('ma-p3', [marche({ montant_ht: -1 })])).status).toBe(400);
    expect((await post('ma-p3', [marche({ act_lot_id: '' })])).status).toBe(400);
    expect((await post('ma-p3', [marche({ contact_id: 'inconnu' })])).status).toBe(400);

    const created = await post('ma-p3', [marche()]);
    const id = created.body.marches[0].id;
    const sign = (body: object) => request(app).post(`/api/marches-entreprises/${id}/signature`).set(authHeader(token)).send(body);
    expect((await sign({ mode: 'oral', date_signature: '2026-10-14' })).status).toBe(400);
    expect((await sign({ mode: 'papier', date_signature: '14/10/2026' })).status).toBe(400);
    expect((await sign({ mode: 'electronique', date_signature: '2026-10-14', document_id: 'inconnu' })).status).toBe(400);
  });

  it('le POST/PUT générique ne peut pas écrire les colonnes de signature', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'ma-p4');
    const created = await request(app).post('/api/marches-entreprises').set(authHeader(token))
      .send({ project_id: 'ma-p4', entreprise_nom: 'Manuel', montant_ht: 10, statut_signature: 'signe', act_lot_id: 'Z' });
    expect(created.status).toBe(201);
    expect(created.body.statut_signature).not.toBe('signe');
    expect(created.body.act_lot_id ?? null).toBeNull();
    const put = await request(app).put(`/api/marches-entreprises/${created.body.id}`).set(authHeader(token)).send({ statut_signature: 'signe', notes: 'x' });
    expect(put.body.statut_signature).not.toBe('signe');
    expect(put.body.notes).toBe('x');
  });

  it('refuse un marché ou un document d’un autre cabinet pour la signature', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const autre = makeTenant();
    fakeSupabaseAdmin.seed('marches_entreprises', [{ id: 'ma-autre', tenant_id: autre, project_id: 'z', entreprise_nom: 'X', montant_ht: 1 }]);
    const r = await request(app).post('/api/marches-entreprises/ma-autre/signature').set(authHeader(token)).send({ mode: 'papier', date_signature: '2026-10-14' });
    expect(r.status).toBe(404);
  });
});
