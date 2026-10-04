// Situations de travaux et certificats de paiement : server/routes/situations.ts
// et le PDF du certificat (server/etatAcompte.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function seed(tenantId: string, projectId: string, marcheId: string) {
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status: 'Planning' }]);
  fakeSupabaseAdmin.seed('marches_entreprises', [{
    id: marcheId, tenant_id: tenantId, project_id: projectId, entreprise_nom: 'Maçonnerie Dupont',
    lot_numero: '02', lot_titre: 'Gros œuvre', montant_ht: 100000, tva_rate: 20, retenue_garantie_pct: 5,
  }]);
}

describe('Situations de travaux', () => {
  it('crée les situations numérotées par marché et garde les montants', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'st-p1', 'st-m1');
    const post = (body: object) => request(app).post('/api/situations').set(authHeader(token)).send({ project_id: 'st-p1', marche_id: 'st-m1', ...body });

    const s1 = await post({ montant_presente_ht: '30000,50', reference_entreprise: 'F-12' });
    expect(s1.status).toBe(201);
    expect(s1.body).toMatchObject({ numero_situation: 1, etat: 'Brouillon', montant_presente_ht: 30000.5, reference_entreprise: 'F-12' });

    const s2 = await post({});
    expect(s2.status).toBe(201);
    expect(s2.body.numero_situation).toBe(2);
  });

  it('refuse un marché d’un autre cabinet, un état inconnu ou un montant illisible', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'st-p2', 'st-m2');
    const autre = makeTenant();
    seed(autre, 'st-p3', 'st-m3');
    const post = (body: object) => request(app).post('/api/situations').set(authHeader(token)).send({ project_id: 'st-p2', ...body });

    expect((await post({ marche_id: 'st-m3' })).status).toBe(400);
    expect((await post({ marche_id: 'st-m2', etat: 'Signée' })).status).toBe(400);
    expect((await post({ marche_id: 'st-m2', montant_presente_ht: 'beaucoup' })).status).toBe(400);
  });

  it('établit le certificat puis produit son PDF', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'st-p4', 'st-m4');
    const created = await request(app).post('/api/situations').set(authHeader(token))
      .send({ project_id: 'st-p4', marche_id: 'st-m4', montant_presente_ht: 40000, montant_admis_ht: 35000 });

    const put = await request(app).put(`/api/situations/${created.body.id}`).set(authHeader(token))
      .send({ etat: 'Validée', date_certificat: '2026-10-03', chorus_pro_id: 'ignoré' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ etat: 'Validée', date_certificat: '2026-10-03', montant_admis_ht: 35000 });
    expect(put.body.chorus_pro_id).toBeUndefined();

    const pdf = await request(app).get(`/api/situations/${created.body.id}/etat-acompte-pdf`).set(authHeader(token))
      .buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('ne modifie pas la situation d’un autre cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const autre = makeTenant();
    seed(autre, 'st-p5', 'st-m5');
    fakeSupabaseAdmin.seed('situations', [{ id: 'st-s5', tenant_id: autre, project_id: 'st-p5', marche_id: 'st-m5', numero_situation: 1, etat: 'Brouillon' }]);
    const put = await request(app).put('/api/situations/st-s5').set(authHeader(token)).send({ etat: 'Payée' });
    expect(put.status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('situations').find((s: any) => s.id === 'st-s5')?.etat).toBe('Brouillon');
  });

  it('en mode détaillé, déduit le cumul présenté des lignes sans croire un montant envoyé', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'st-p6', 'st-m6');
    const lignes = [
      { ligneId: 'a', numero: '2.1.1', designation: 'Semelles', unite: 'm3', quantite: 10, prixUnitaire: 100, montantHt: 1, avancementPct: 50 },
      { ligneId: 'b', numero: '2.1.2', designation: 'Voiles', unite: 'm2', quantite: 20, prixUnitaire: 50, avancementPct: 25 },
    ];
    const created = await request(app).post('/api/situations').set(authHeader(token)).send({
      project_id: 'st-p6', marche_id: 'st-m6', mode_saisie: 'detaille', avancement_lignes: lignes, montant_presente_ht: 999999,
    });
    expect(created.status).toBe(201);
    expect(created.body.montant_presente_ht).toBe(750);
    expect(created.body.avancement_lignes[0].montantHt).toBe(1000);

    // Mise à jour des seules lignes : le mode enregistré reste détaillé.
    const put = await request(app).put(`/api/situations/${created.body.id}`).set(authHeader(token))
      .send({ avancement_lignes: lignes.map((l) => ({ ...l, avancementPct: 100 })) });
    expect(put.body.montant_presente_ht).toBe(2000);

    // Le PDF porte l'annexe ligne à ligne sans erreur.
    const pdf = await request(app).get(`/api/situations/${created.body.id}/etat-acompte-pdf`).set(authHeader(token));
    expect(pdf.status).toBe(200);

    const bad = await request(app).put(`/api/situations/${created.body.id}`).set(authHeader(token))
      .send({ avancement_lignes: [{ ...lignes[0], avancementPct: 140 }] });
    expect(bad.status).toBe(400);
    expect((await request(app).put(`/api/situations/${created.body.id}`).set(authHeader(token)).send({ mode_saisie: 'libre' })).status).toBe(400);
  });
});
