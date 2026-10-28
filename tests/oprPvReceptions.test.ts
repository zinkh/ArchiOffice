// PV d'OPR par lot : routes /api/receptions (régime déduit, lot figé, références contrôlées).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function cabinet(publicClient = false) {
  const tenantId = makeTenant();
  const { token } = makeUser(tenantId);
  fakeSupabaseAdmin.seed('projects', [
    { id: 'p1', tenant_id: tenantId, is_public_client: publicClient },
    { id: 'p2', tenant_id: tenantId },
  ]);
  fakeSupabaseAdmin.seed('marches_entreprises', [
    { id: 'm1', tenant_id: tenantId, project_id: 'p1', type_marche: 'marche' },
    { id: 'm-cadre', tenant_id: tenantId, project_id: 'p1', type_marche: 'accord_cadre' },
    { id: 'm-autre', tenant_id: tenantId, project_id: 'p2', type_marche: 'marche' },
  ]);
  fakeSupabaseAdmin.seed('project_lots', [
    { id: 'l1', tenant_id: tenantId, project_id: 'p1', lot_number: '01', lot_title: 'Gros œuvre' },
  ]);
  return { tenantId, token };
}

const ligne = (id: string) => fakeSupabaseAdmin.getTable('receptions').find(r => r.id === id);

describe("Création d'un PV d'OPR", () => {
  it("déduit le régime de l'affaire et n'écoute jamais celui du client", async () => {
    const { token } = cabinet(true);
    const res = await request(app).post('/api/receptions').set(authHeader(token))
      .send({ project_id: 'p1', date: '2026-11-03', type: 'provisoire', marche_id: 'm1', regime: 'prive', date_opr: '2026-11-03' });
    expect(res.status).toBe(200);
    expect(ligne(res.body.id)).toMatchObject({ regime: 'public', marche_id: 'm1', date_opr: '2026-11-03' });

    const prive = cabinet(false);
    const res2 = await request(app).post('/api/receptions').set(authHeader(prive.token))
      .send({ project_id: 'p1', date: '2026-11-03', type: 'provisoire', lot_id: 'l1', regime: 'public' });
    expect(ligne(res2.body.id)?.regime).toBe('prive');
  });

  it('exige un lot ou un marché : un PV par lot', async () => {
    const { token } = cabinet();
    const res = await request(app).post('/api/receptions').set(authHeader(token))
      .send({ project_id: 'p1', date: '2026-11-03', type: 'provisoire', date_opr: '2026-11-03' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/un PV par lot/);
  });

  it("refuse le marché d'une autre affaire, d'un autre cabinet, un accord-cadre et un lot étranger", async () => {
    const a = cabinet();
    const b = cabinet();
    const envoyer = (token: string, extra: object) => request(app).post('/api/receptions').set(authHeader(token))
      .send({ project_id: 'p1', date: '2026-11-03', type: 'provisoire', ...extra });

    expect((await envoyer(a.token, { marche_id: 'm-autre' })).status).toBe(400);
    expect((await envoyer(a.token, { marche_id: 'm-cadre' })).body.error).toMatch(/accord-cadre/);
    expect((await envoyer(a.token, { lot_id: 'inconnu' })).status).toBe(400);
    // Un marché du cabinet B n'est pas visible depuis le cabinet A (mêmes identifiants, autre tenant).
    fakeSupabaseAdmin.seed('marches_entreprises', [{ id: 'm-b', tenant_id: b.tenantId, project_id: 'p1', type_marche: 'marche' }]);
    expect((await envoyer(a.token, { marche_id: 'm-b' })).status).toBe(400);
  });

  it('refuse les valeurs invalides avant toute écriture', async () => {
    const { token } = cabinet();
    const avant = fakeSupabaseAdmin.getTable('receptions').length;
    const res = await request(app).post('/api/receptions').set(authHeader(token))
      .send({ project_id: 'p1', date: '2026-11-03', type: 'provisoire', marche_id: 'm1', proposition: { avis: 'peut-être' }, date_opr: 'demain' });
    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('receptions').length).toBe(avant);
  });

  it('un PV sans champ d\'OPR reste un PV générique, sans régime', async () => {
    const { token } = cabinet();
    const res = await request(app).post('/api/receptions').set(authHeader(token))
      .send({ project_id: 'p1', date: '2026-01-01', type: 'OPR', has_reserves: true });
    expect(res.status).toBe(200);
    expect(ligne(res.body.id)?.regime ?? null).toBeNull();
  });
});

describe("Mise à jour d'un PV d'OPR", () => {
  async function creer(token: string) {
    const res = await request(app).post('/api/receptions').set(authHeader(token))
      .send({ project_id: 'p1', date: '2026-11-03', type: 'provisoire', marche_id: 'm1', lieu: 'Chantier', reference_pv: 'OPR-1' });
    return res.body.id as string;
  }

  it("est partielle : un champ absent du corps n'est pas effacé", async () => {
    const { token } = cabinet();
    const id = await creer(token);
    const res = await request(app).put(`/api/receptions/${id}`).set(authHeader(token))
      .send({ proposition: { avis: 'sans_reserve', date_proposition: '2026-11-04' } });
    expect(res.status).toBe(200);
    expect(ligne(id)).toMatchObject({ lieu: 'Chantier', reference_pv: 'OPR-1', marche_id: 'm1' });
    expect(ligne(id)?.proposition).toMatchObject({ avis: 'sans_reserve', date_proposition: '2026-11-04' });

    // Une section présente remplace l'enregistrée, une autre section n'est pas touchée.
    await request(app).put(`/api/receptions/${id}`).set(authHeader(token)).send({ decision: { issue: 'non_receptionnee' } });
    expect(ligne(id)?.proposition).toMatchObject({ avis: 'sans_reserve' });
    expect(ligne(id)?.decision).toMatchObject({ issue: 'non_receptionnee' });
  });

  it('un champ historique présent mais vide est effacé', async () => {
    const { token } = cabinet();
    const id = await creer(token);
    await request(app).put(`/api/receptions/${id}`).set(authHeader(token)).send({ lieu: '' });
    expect(ligne(id)?.lieu).toBeNull();
  });

  it('ne change jamais le lot ni le régime', async () => {
    const { token } = cabinet();
    const id = await creer(token);
    const res = await request(app).put(`/api/receptions/${id}`).set(authHeader(token)).send({ marche_id: 'm-autre' });
    expect(res.status).toBe(400);
    const memes = await request(app).put(`/api/receptions/${id}`).set(authHeader(token)).send({ marche_id: 'm1', regime: 'public', date_opr: '2026-11-05' });
    expect(memes.status).toBe(200);
    expect(ligne(id)).toMatchObject({ marche_id: 'm1', regime: 'prive', date_opr: '2026-11-05' });
  });

  it('répond 404 pour un PV inconnu ou d\'un autre cabinet, et refuse les champs d\'OPR sur un PV générique', async () => {
    const a = cabinet();
    const b = cabinet();
    const idB = await creer(b.token);
    expect((await request(app).put(`/api/receptions/${idB}`).set(authHeader(a.token)).send({ date_opr: '2026-11-05' })).status).toBe(404);
    expect((await request(app).put('/api/receptions/inexistant').set(authHeader(a.token)).send({})).status).toBe(404);

    const generique = await request(app).post('/api/receptions').set(authHeader(a.token))
      .send({ project_id: 'p1', date: '2026-01-01', type: 'OPR' });
    const refus = await request(app).put(`/api/receptions/${generique.body.id}`).set(authHeader(a.token)).send({ date_opr: '2026-11-05' });
    expect(refus.status).toBe(400);
  });
});

describe('Référence automatique', () => {
  const creer = (token: string, extra: object = {}) => request(app).post('/api/receptions').set(authHeader(token))
    .send({ project_id: 'p1', date: '2026-11-03', type: 'provisoire', marche_id: 'm1', ...extra });

  it('attribue OPR-AAAA-NNN à la suite, par cabinet et par année', async () => {
    const a = cabinet();
    const b = cabinet();
    const un = await creer(a.token);
    const deux = await creer(a.token);
    expect(ligne(un.body.id)?.reference_pv).toBe('OPR-2026-001');
    expect(ligne(deux.body.id)?.reference_pv).toBe('OPR-2026-002');
    // Un autre cabinet repart de 001, une autre année aussi.
    expect(ligne((await creer(b.token)).body.id)?.reference_pv).toBe('OPR-2026-001');
    expect(ligne((await creer(a.token, { date: '2027-01-05' })).body.id)?.reference_pv).toBe('OPR-2027-001');
  });

  it('respecte une référence fournie, et ne numérote jamais un PV générique', async () => {
    const { token } = cabinet();
    const fournie = await creer(token, { reference_pv: 'PV-A-12' });
    expect(ligne(fournie.body.id)?.reference_pv).toBe('PV-A-12');
    const generique = await request(app).post('/api/receptions').set(authHeader(token)).send({ project_id: 'p1', date: '2026-01-01', type: 'OPR' });
    expect(ligne(generique.body.id)?.reference_pv ?? null).toBeNull();
    // La référence saisie à la main n'est pas lue comme un suffixe et ne fait pas sauter la suite.
    expect(ligne((await creer(token)).body.id)?.reference_pv).toBe('OPR-2026-001');
  });
});

describe("Signature d'un PV d'OPR", () => {
  async function pvPret(token: string, extra: object = {}) {
    const res = await request(app).post('/api/receptions').set(authHeader(token)).send({
      project_id: 'p1', date: '2026-11-03', type: 'provisoire', marche_id: 'm1', date_opr: '2026-11-03',
      proposition: { avis: 'sans_reserve', date_proposition: '2026-11-04' }, ...extra,
    });
    return res.body.id as string;
  }
  const signer = (token: string, id: string, corps: object = { mode: 'papier', date: '2026-11-10' }) =>
    request(app).post(`/api/receptions/${id}/signature`).set(authHeader(token)).send(corps);

  it('fige le contenu : un PUT répond 409 PV_SIGNE jusqu\'à la réouverture', async () => {
    const { token } = cabinet();
    const id = await pvPret(token);
    const signe = await signer(token, id);
    expect(signe.status).toBe(200);
    expect(ligne(id)).toMatchObject({ signed_at: '2026-11-10', signed_mode: 'papier' });

    const refus = await request(app).put(`/api/receptions/${id}`).set(authHeader(token)).send({ lieu: 'Autre' });
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('PV_SIGNE');
    expect((await signer(token, id)).status).toBe(409);

    const rouvert = await request(app).post(`/api/receptions/${id}/signature/rouvrir`).set(authHeader(token)).send({});
    expect(rouvert.status).toBe(200);
    expect(ligne(id)?.signed_at).toBeNull();
    expect((await request(app).put(`/api/receptions/${id}`).set(authHeader(token)).send({ lieu: 'Autre' })).status).toBe(200);
  });

  it('refuse un mode inconnu, une date invalide et un document étranger', async () => {
    const { token } = cabinet();
    const id = await pvPret(token);
    expect((await signer(token, id, { mode: 'oral', date: '2026-11-10' })).status).toBe(400);
    expect((await signer(token, id, { mode: 'papier', date: 'demain' })).status).toBe(400);
    expect((await signer(token, id, { mode: 'papier', date: '2026-11-10', document_id: 'inconnu' })).status).toBe(400);
    expect(ligne(id)?.signed_at ?? null).toBeNull();
  });

  it('refuse de signer un PV incohérent, en listant ce qui manque', async () => {
    const { token } = cabinet();
    const id = await pvPret(token, { proposition: { avis: 'sous_reserve', date_proposition: '2026-11-04' } });
    const res = await signer(token, id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PV_INCOHERENT');
    expect(res.body.erreurs.map((e: any) => e.code)).toContain('proposition_conditions_manquantes');
    expect(ligne(id)?.signed_at ?? null).toBeNull();
  });

  it('refuse « sans réserve » tant que des réserves du PV restent à lever', async () => {
    const { tenantId, token } = cabinet();
    const id = await pvPret(token);
    fakeSupabaseAdmin.seed('reserves', [
      { id: 'r-ouverte', tenant_id: tenantId, project_id: 'p1', reception_id: id, title: 'Joint', status: 'A faire' },
      { id: 'r-levee', tenant_id: tenantId, project_id: 'p1', reception_id: id, title: 'Peinture', status: 'Levée' },
    ]);
    const res = await signer(token, id);
    expect(res.status).toBe(409);
    expect(res.body.erreurs.map((e: any) => e.code)).toContain('reserves_ouvertes');
    fakeSupabaseAdmin.getTable('reserves').find(r => r.id === 'r-ouverte')!.status = 'Quitus Transmis';
    expect((await signer(token, id)).status).toBe(200);
  });

  it('ne signe ni un PV générique, ni le PV d\'un autre cabinet', async () => {
    const a = cabinet();
    const b = cabinet();
    const generique = await request(app).post('/api/receptions').set(authHeader(a.token)).send({ project_id: 'p1', date: '2026-01-01', type: 'OPR' });
    expect((await signer(a.token, generique.body.id)).status).toBe(400);
    expect((await request(app).post(`/api/receptions/${generique.body.id}/signature/rouvrir`).set(authHeader(a.token)).send({})).status).toBe(400);
    const idB = await pvPret(b.token);
    expect((await signer(a.token, idB)).status).toBe(404);
    expect((await request(app).post(`/api/receptions/${idB}/signature/rouvrir`).set(authHeader(a.token)).send({})).status).toBe(404);
  });
});

describe('Affaire archivée', () => {
  it('refuse en 409 la création et la modification d\'un PV', async () => {
    const { tenantId, token } = cabinet();
    fakeSupabaseAdmin.seed('projects', [{ id: 'p-archive', tenant_id: tenantId, archived_at: '2026-10-01T00:00:00Z' }]);
    fakeSupabaseAdmin.seed('receptions', [{ id: 'r-archive', tenant_id: tenantId, project_id: 'p-archive', date: '2026-01-01', type: 'OPR' }]);

    const creation = await request(app).post('/api/receptions').set(authHeader(token))
      .send({ project_id: 'p-archive', date: '2026-11-03', type: 'provisoire' });
    expect(creation.status).toBe(409);
    expect(creation.body.code).toBe('PROJECT_ARCHIVED');

    const edition = await request(app).put('/api/receptions/r-archive').set(authHeader(token)).send({ date: '2026-02-01', type: 'OPR' });
    expect(edition.status).toBe(409);
  });
});
