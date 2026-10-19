// Accord-cadre à plusieurs titulaires et remise en concurrence :
// server/routes/marchesSubsequents.ts et server/routes/accordCadreConsultations.ts
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

let compteur = 0;
/** Deux titulaires d'un même accord-cadre signé (maximum 1000 € HT partagé). */
async function monterGroupe() {
  const n = ++compteur;
  const tenantId = makeTenant();
  const { token } = makeUser(tenantId);
  const auth = authHeader(token);
  const projectId = `cg-p${n}`;
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Entretien', client: 'Commune', status: 'Planning', is_public_client: true }]);
  const marche = (id: string, nom: string, prix: Record<string, number>) => ({
    id, tenant_id: tenantId, project_id: projectId, type_marche: 'marche', entreprise_nom: nom, lot_numero: '02',
    lot_titre: 'Carrelage', montant_ht: 0, tva_rate: 20, statut_signature: 'signe', statut: 'en_cours', offre_snapshot: { prix },
  });
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  fakeSupabaseAdmin.seed('marches_entreprises', [marche(a, 'Dupont SARL', { a1: 45, a2: 30 }), marche(b, 'Martin SAS', { a1: 48, a2: 28 })]);
  expect((await request(app).post(`/api/marches-entreprises/${a}/accord-cadre`).set(auth)
    .send({ mode_execution: 'marches_subsequents', montant_maxi_ht: 1000 })).status).toBe(200);
  const rejoint = await request(app).post(`/api/marches-entreprises/${b}/accord-cadre`).set(auth).send({ groupe_avec: a });
  expect(rejoint.status).toBe(200);
  return {
    tenantId, projectId, a, b, auth, rejoint,
    emettre: (id: string, quantite: number, prix = 45) => request(app).post(`/api/marches-entreprises/${id}/subsequents`).set(auth)
      .send({ lignes: [{ articleId: 'a1', designation: 'Carrelage', unite: 'm²', quantite, prixUnitaire: prix }] }),
    creer: (extra: object = {}) => request(app).post(`/api/marches-entreprises/${a}/consultations`).set(auth).send({
      objet: 'Salle B', lignes: [
        { articleId: 'a1', designation: 'Carrelage', unite: 'm²', quantite: 10 },
        { articleId: 'a2', designation: 'Plinthe', unite: 'ml', quantite: 5 },
      ], ...extra,
    }),
    offres: (cid: string, offres: object[]) => request(app).put(`/api/accord-cadre-consultations/${cid}`).set(auth).send({ offres }),
    attribuer: (cid: string, corps: object) => request(app).post(`/api/accord-cadre-consultations/${cid}/attribuer`).set(auth).send(corps),
  };
}

describe('Accord-cadre à plusieurs titulaires', () => {
  it('un titulaire rejoint la tête et n’a pas de conditions propres', async () => {
    const g = await monterGroupe();
    expect(g.rejoint.body).toMatchObject({ type_marche: 'accord_cadre', accord_cadre_groupe_id: g.a, montant_maxi_ht: null });
    const ajuste = await request(app).post(`/api/marches-entreprises/${g.b}/accord-cadre`).set(g.auth)
      .send({ mode_execution: 'mixte', montant_maxi_ht: 5 });
    expect(ajuste.status).toBe(409);
  });

  it('partage le plafond et la numérotation entre titulaires', async () => {
    const g = await monterGroupe();
    expect((await g.emettre(g.a, 10)).body.numero_subsequent).toBe(1);   // 450
    const deuxieme = await g.emettre(g.b, 10, 48);                      // 480 → 930
    expect(deuxieme.status).toBe(201);
    expect(deuxieme.body.numero_subsequent).toBe(2);
    const refus = await g.emettre(g.a, 2);                              // 90 → 1020
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('PLAFOND_DEPASSE');
    const liste = await request(app).get(`/api/marches-entreprises/${g.b}/subsequents`).set(g.auth);
    expect(liste.body.subsequents).toHaveLength(2);
    expect(liste.body.consommation).toMatchObject({ cumulHT: 930, resteMaxiHT: 70 });
  });

  it('accepte un prix inférieur au bordereau, pas supérieur', async () => {
    const g = await monterGroupe();
    expect((await g.emettre(g.a, 1, 40)).status).toBe(201);
    expect((await g.emettre(g.a, 1, 46)).status).toBe(400);
  });

  it('refuse de défaire la tête tant que d’autres titulaires y sont rattachés', async () => {
    const g = await monterGroupe();
    expect((await request(app).delete(`/api/marches-entreprises/${g.a}/accord-cadre`).set(g.auth)).status).toBe(409);
    expect((await request(app).delete(`/api/marches-entreprises/${g.b}/accord-cadre`).set(g.auth)).status).toBe(200);
    expect((await request(app).delete(`/api/marches-entreprises/${g.a}/accord-cadre`).set(g.auth)).status).toBe(200);
  });

  it('un marché d’une autre opération ne rejoint pas le groupe', async () => {
    const g = await monterGroupe();
    const autre = crypto.randomUUID();
    fakeSupabaseAdmin.seed('projects', [{ id: `${g.projectId}-x`, tenant_id: g.tenantId, name: 'Autre', status: 'Planning', is_public_client: true }]);
    fakeSupabaseAdmin.seed('marches_entreprises', [{ id: autre, tenant_id: g.tenantId, project_id: `${g.projectId}-x`, type_marche: 'marche', entreprise_nom: 'X', montant_ht: 0 }]);
    const r = await request(app).post(`/api/marches-entreprises/${autre}/accord-cadre`).set(g.auth).send({ groupe_avec: g.a });
    expect(r.status).toBe(400);
  });
});

describe('Remise en concurrence', () => {
  it('exige au moins deux titulaires', async () => {
    const g = await monterGroupe();
    await request(app).delete(`/api/marches-entreprises/${g.b}/accord-cadre`).set(g.auth);
    expect((await g.creer()).status).toBe(409);
  });

  it('refuse un prix d’offre supérieur au bordereau du titulaire', async () => {
    const g = await monterGroupe();
    const c = (await g.creer()).body;
    const r = await g.offres(c.id, [{ marche_id: g.a, prix: { a1: 46, a2: 30 } }]);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('supérieur au bordereau');
  });

  it('attribue au moins-disant : émet le subséquent aux prix de son offre', async () => {
    const g = await monterGroupe();
    const c = (await g.creer()).body;
    expect(c.numero).toBe(1);
    const ok = await g.offres(c.id, [
      { marche_id: g.a, prix: { a1: 45, a2: 30 } },   // 600
      { marche_id: g.b, prix: { a1: 40, a2: 28 } },   // 540
    ]);
    expect(ok.status).toBe(200);
    const r = await g.attribuer(c.id, { marche_id: g.b });
    expect(r.status).toBe(201);
    expect(r.body.subsequent).toMatchObject({ parent_marche_id: g.b, montant_ht: 540, numero_subsequent: 1 });
    expect(r.body.consultation).toMatchObject({ statut: 'attribuee', retenue_marche_id: g.b, subsequent_id: r.body.subsequent.id });
    expect((await g.attribuer(c.id, { marche_id: g.b })).status).toBe(409);
  });

  it('exige un motif pour retenir une offre qui n’est pas la moins-disante', async () => {
    const g = await monterGroupe();
    const c = (await g.creer()).body;
    await g.offres(c.id, [
      { marche_id: g.a, prix: { a1: 45, a2: 30 } },
      { marche_id: g.b, prix: { a1: 40, a2: 28 } },
    ]);
    expect((await g.attribuer(c.id, { marche_id: g.a })).status).toBe(400);
    expect((await g.attribuer(c.id, { marche_id: g.a, motif_choix: 'Délai plus court' })).status).toBe(201);
  });

  it('refuse une offre incomplète et rend la consultation ouverte si le plafond est dépassé', async () => {
    const g = await monterGroupe();
    const c = (await g.creer({ lignes: [{ articleId: 'a1', designation: 'Carrelage', unite: 'm²', quantite: 100 }] })).body;
    await g.offres(c.id, [{ marche_id: g.a, prix: { a1: 45 } }, { marche_id: g.b, prix: {} }]);
    expect((await g.attribuer(c.id, { marche_id: g.b })).status).toBe(400);   // incomplète
    const refus = await g.attribuer(c.id, { marche_id: g.a });                 // 4500 > 1000
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('PLAFOND_DEPASSE');
    const apres = await request(app).get(`/api/marches-entreprises/${g.a}/consultations`).set(g.auth);
    expect(apres.body[0]).toMatchObject({ statut: 'en_cours', retenue_marche_id: null });
    expect(apres.body[0].subsequent_id ?? null).toBeNull();
  });

  it('abandon, puis plus aucune modification ; une consultation close sans marché se supprime', async () => {
    const g = await monterGroupe();
    const c = (await g.creer()).body;
    expect((await request(app).post(`/api/accord-cadre-consultations/${c.id}/abandonner`).set(g.auth).send({ motif: 'Besoin annulé' })).status).toBe(200);
    expect((await g.offres(c.id, [])).status).toBe(409);
    expect((await request(app).delete(`/api/accord-cadre-consultations/${c.id}`).set(g.auth)).status).toBe(200);
  });

  it('isole les cabinets', async () => {
    const g = await monterGroupe();
    const c = (await g.creer()).body;
    const autre = authHeader(makeUser(makeTenant()).token);
    expect((await request(app).get(`/api/marches-entreprises/${g.a}/consultations`).set(autre)).status).toBe(404);
    expect((await request(app).put(`/api/accord-cadre-consultations/${c.id}`).set(autre).send({ offres: [] })).status).toBe(404);
  });
});
