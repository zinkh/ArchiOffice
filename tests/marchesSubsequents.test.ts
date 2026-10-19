// Accords-cadres et marchés subséquents : server/routes/marchesSubsequents.ts
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

let compteur = 0;
/** Cabinet, personne, affaire et marché ordinaire prêts à devenir accord-cadre. */
function monter(opts: { public?: boolean } = {}) {
  const n = ++compteur;
  const tenantId = makeTenant();
  const { token } = makeUser(tenantId);
  const projectId = `ms-p${n}`;
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Entretien bâtiments', client: 'Commune', status: 'Planning', is_public_client: opts.public ?? true }]);
  const marcheId = crypto.randomUUID();
  fakeSupabaseAdmin.seed('marches_entreprises', [{
    id: marcheId, tenant_id: tenantId, project_id: projectId, type_marche: 'marche', entreprise_nom: 'Dupont SARL',
    lot_numero: '02', lot_titre: 'Carrelage', montant_ht: 0, tva_rate: 20, statut_signature: 'signe', statut: 'en_cours',
    offre_snapshot: { prix: { a1: 45, a2: 30 } },
  }]);
  const auth = authHeader(token);
  return {
    tenantId, token, projectId, marcheId,
    erigir: (extra: object = {}) => request(app).post(`/api/marches-entreprises/${marcheId}/accord-cadre`).set(auth)
      .send({ mode_execution: 'marches_subsequents', montant_maxi_ht: 1000, ...extra }),
    emettre: (lignes: object[], extra: object = {}) => request(app).post(`/api/marches-entreprises/${marcheId}/subsequents`).set(auth).send({ lignes, ...extra }),
    modifier: (subId: string, lignes: object[], extra: object = {}) => request(app).put(`/api/marches-entreprises/${marcheId}/subsequents/${subId}`).set(auth).send({ lignes, ...extra }),
    liste: () => request(app).get(`/api/marches-entreprises/${marcheId}/subsequents`).set(auth),
    auth,
  };
}
const ligne = (quantite: number, prixUnitaire = 45, extra: object = {}) => ({ articleId: 'a1', designation: 'Carrelage', unite: 'm²', quantite, prixUnitaire, ...extra });

describe('Accord-cadre', () => {
  it('est réservé aux marchés publics', async () => {
    const m = monter({ public: false });
    const r = await m.erigir();
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('marchés publics');
  });

  it('érige un marché en accord-cadre et valide les conditions', async () => {
    const m = monter();
    expect((await m.erigir({ mode_execution: 'autre' })).status).toBe(400);
    expect((await m.erigir({ montant_mini_ht: 2000 })).status).toBe(400);
    expect((await m.erigir({ montant_maxi_ht: 'abc' })).status).toBe(400);
    expect((await m.erigir({ date_fin_accord_cadre: '31/12/2027' })).status).toBe(400);
    const ok = await m.erigir({ montant_mini_ht: 200, date_fin_accord_cadre: '2027-12-31' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ type_marche: 'accord_cadre', mode_execution: 'marches_subsequents', montant_mini_ht: 200, montant_maxi_ht: 1000 });
  });

  it('refuse l’accord-cadre d’un autre cabinet', async () => {
    const m = monter();
    const autre = makeUser(makeTenant());
    const r = await request(app).post(`/api/marches-entreprises/${m.marcheId}/accord-cadre`).set(authHeader(autre.token))
      .send({ mode_execution: 'mixte', montant_maxi_ht: 10 });
    expect(r.status).toBe(404);
  });

  it('refuse un marché qui porte déjà des situations', async () => {
    const m = monter();
    fakeSupabaseAdmin.seed('situations', [{ id: `sit-${m.marcheId}`, tenant_id: m.tenantId, project_id: m.projectId, marche_id: m.marcheId }]);
    const r = await m.erigir();
    expect(r.status).toBe(409);
  });
});

describe('Marchés subséquents', () => {
  it('exige un accord-cadre signé', async () => {
    const m = monter();
    await m.erigir();
    fakeSupabaseAdmin.getTable('marches_entreprises').find(r => r.id === m.marcheId)!.statut_signature = 'a_signer';
    const r = await m.emettre([ligne(1)]);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ACCORD_CADRE_NON_SIGNE');
  });

  it('numérote et recalcule le montant depuis les lignes, jamais depuis le client', async () => {
    const m = monter();
    await m.erigir();
    const a = await m.emettre([ligne(10)], { montant_ht: 1, objet: 'Salle B' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ type_marche: 'subsequent', numero_subsequent: 1, montant_ht: 450, objet: 'Salle B', parent_marche_id: m.marcheId, entreprise_nom: 'Dupont SARL', statut_signature: 'a_signer' });
    const b = await m.emettre([ligne(2)]);
    expect(b.body).toMatchObject({ numero_subsequent: 2, montant_ht: 90 });

    const liste = await m.liste();
    expect(liste.body.subsequents).toHaveLength(2);
    expect(liste.body.consommation).toMatchObject({ cumulHT: 540, resteMaxiHT: 460, statut: 'normal' });
  });

  it('bloque au plafond mais l’atteint exactement', async () => {
    const m = monter();
    await m.erigir({ montant_maxi_ht: 900 });
    expect((await m.emettre([ligne(10)])).status).toBe(201);
    const trop = await m.emettre([ligne(11)]);
    expect(trop.status).toBe(409);
    expect(trop.body.code).toBe('PLAFOND_DEPASSE');
    expect(trop.body.error).toContain('Reste disponible : 450');
    expect((await m.emettre([ligne(10)])).status).toBe(201);
    expect((await m.liste()).body.consommation.statut).toBe('atteint');
  });

  it('ne laisse pas des émissions simultanées franchir le plafond', async () => {
    const m = monter();
    await m.erigir({ montant_maxi_ht: 1000 });
    const reponses = await Promise.all(Array.from({ length: 6 }, () => m.emettre([ligne(10)])));
    expect(reponses.filter(r => r.status === 201)).toHaveLength(2);
    expect(reponses.filter(r => r.status === 409).every(r => r.body.code === 'PLAFOND_DEPASSE')).toBe(true);
    const numeros = (await m.liste()).body.subsequents.map((s: any) => s.numero_subsequent);
    expect(numeros).toEqual([1, 2]);
  });

  it('refuse une notification après la fin de l’accord-cadre', async () => {
    const m = monter();
    await m.erigir({ date_fin_accord_cadre: '2027-12-31' });
    const r = await m.emettre([ligne(1)], { date_notification: '2028-01-02' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ACCORD_CADRE_ECHU');
    expect((await m.emettre([ligne(1)], { date_notification: '2027-12-31' })).status).toBe(201);
  });

  it('refuse un prix ou un article hors bordereau', async () => {
    const m = monter();
    await m.erigir();
    expect((await m.emettre([ligne(1, 50)])).status).toBe(400);
    expect((await m.emettre([ligne(1, 45, { articleId: 'zz' })])).status).toBe(400);
    expect((await m.emettre([])).status).toBe(400);
    expect((await m.emettre([ligne(-1)])).status).toBe(400);
  });

  it('modifie sans compter le subséquent édité deux fois, et le gèle une fois signé', async () => {
    const m = monter();
    await m.erigir({ montant_maxi_ht: 500 });
    const a = await m.emettre([ligne(10)]);
    const modif = await m.modifier(a.body.id, [ligne(11)]);
    expect(modif.status).toBe(200);
    expect(modif.body.montant_ht).toBe(495);
    expect((await m.modifier(a.body.id, [ligne(12)])).body.code).toBe('PLAFOND_DEPASSE');

    await request(app).post(`/api/marches-entreprises/${a.body.id}/signature`).set(m.auth).send({ mode: 'papier', date_signature: '2026-10-20' });
    const gele = await m.modifier(a.body.id, [ligne(1)]);
    expect(gele.status).toBe(409);
    expect(gele.body.code).toBe('SUBSEQUENT_SIGNE');
  });

  it('un PUT générique ne peut ni changer le montant ni détacher un subséquent', async () => {
    const m = monter();
    await m.erigir();
    const a = await m.emettre([ligne(10)]);
    const put = await request(app).put(`/api/marches-entreprises/${a.body.id}`).set(m.auth)
      .send({ montant_ht: 1, parent_marche_id: null, type_marche: 'marche', notes: 'ok' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ montant_ht: 450, type_marche: 'subsequent', parent_marche_id: m.marcheId, notes: 'ok' });
  });

  it('un résilié libère le plafond', async () => {
    const m = monter();
    await m.erigir({ montant_maxi_ht: 450 });
    const a = await m.emettre([ligne(10)]);
    expect((await m.emettre([ligne(1)])).status).toBe(409);
    await request(app).put(`/api/marches-entreprises/${a.body.id}`).set(m.auth).send({ statut: 'resilie' });
    expect((await m.emettre([ligne(10)])).status).toBe(201);
  });
});

describe('Suppression', () => {
  it('protège l’accord-cadre qui a des subséquents, et un subséquent signé', async () => {
    const m = monter();
    await m.erigir();
    const a = await m.emettre([ligne(1)]);
    const b = await m.emettre([ligne(1)]);

    expect((await request(app).delete(`/api/marches-entreprises/${m.marcheId}`).set(m.auth)).status).toBe(409);
    expect((await request(app).delete(`/api/marches-entreprises/${m.marcheId}/accord-cadre`).set(m.auth)).status).toBe(409);

    await request(app).post(`/api/marches-entreprises/${b.body.id}/signature`).set(m.auth).send({ mode: 'papier', date_signature: '2026-10-20' });
    expect((await request(app).delete(`/api/marches-entreprises/${b.body.id}`).set(m.auth)).status).toBe(409);
    expect((await request(app).delete(`/api/marches-entreprises/${m.marcheId}/subsequents/${b.body.id}`).set(m.auth)).status).toBe(409);

    expect((await request(app).delete(`/api/marches-entreprises/${m.marcheId}/subsequents/${a.body.id}`).set(m.auth)).status).toBe(200);
    expect((await m.liste()).body.subsequents).toHaveLength(1);
  });

  it('refuse de supprimer un subséquent qui porte des situations', async () => {
    const m = monter();
    await m.erigir();
    const a = await m.emettre([ligne(1)]);
    fakeSupabaseAdmin.seed('situations', [{ id: `sit-${a.body.id}`, tenant_id: m.tenantId, project_id: m.projectId, marche_id: a.body.id }]);
    expect((await request(app).delete(`/api/marches-entreprises/${m.marcheId}/subsequents/${a.body.id}`).set(m.auth)).status).toBe(409);
  });

  it('redevient un marché ordinaire sans subséquent', async () => {
    const m = monter();
    await m.erigir();
    const r = await request(app).delete(`/api/marches-entreprises/${m.marcheId}/accord-cadre`).set(m.auth);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ type_marche: 'marche', mode_execution: null, montant_maxi_ht: null });
  });
});
