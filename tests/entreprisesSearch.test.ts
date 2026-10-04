// Recherche d'entreprises du bâtiment : validation des paramètres, lecture de
// l'annuaire public, enrichissements facultatifs (RGE, libellé NAF, fiche
// existante). Les deux API publiques sont remplacées par un faux fetch.
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { construireRequete, parseResultats } from '../server/routes/entreprisesSearch';
import { resetRgeCache } from '../server/rgeLookup';

let app: Express;
beforeAll(async () => {
  app = await getTestApp();
  fakeSupabaseAdmin.seed('ref_naf', [{ code: '43.99A', libelle: "Travaux d'étanchéification", niveau: 5 }]);
});
beforeEach(() => resetRgeCache());
afterEach(() => vi.restoreAllMocks());

const SIRET = '55208131700018';

const annuaire = {
  total_results: 1, total_pages: 1,
  results: [{
    siren: '552081317', nom_complet: 'ETANCHEITE DE L\'EST', activite_principale: '43.99A',
    tranche_effectif_salarie: '11', date_creation: '2001-04-02',
    siege: { siret: SIRET, adresse: '1 rue des Lilas 54000 NANCY', code_postal: '54000', libelle_commune: 'NANCY', departement: '54' },
    complements: { est_rge: true },
  }],
};

function fauxReseau({ ademe = 'ok' as 'ok' | 'ko', annuaireStatus = 200 } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: any) => {
    const u = String(url);
    if (u.includes('recherche-entreprises')) {
      return annuaireStatus === 200
        ? { ok: true, status: 200, json: async () => annuaire }
        : { ok: false, status: annuaireStatus, json: async () => ({}) };
    }
    if (u.includes('data.ademe.fr')) {
      if (ademe === 'ko') throw new Error('réseau');
      return { ok: true, status: 200, json: async () => ({ results: [
        { siret: SIRET, organisme: 'QUALIBAT', code_qualification: '7131', nom_qualification: 'Isolation', date_fin: '2027-01-01' },
      ] }) };
    }
    throw new Error(`appel inattendu : ${u}`);
  }) as any);
}

describe('construireRequete', () => {
  it('refuse une saisie trop courte', () => {
    expect(construireRequete({ q: 'a' })).toMatchObject({ ok: false });
    expect(construireRequete({})).toMatchObject({ ok: false });
  });
  it('restreint au bâtiment et au RGE à la demande, et borne la page', () => {
    const r = construireRequete({ q: 'étanchéité', departement: '54', batiment: '1', rge: 'true', page: '999' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = new URL(r.url);
    expect(u.searchParams.get('section_activite_principale')).toBe('F');
    expect(u.searchParams.get('est_rge')).toBe('true');
    expect(u.searchParams.get('departement')).toBe('54');
    expect(u.searchParams.get('page')).toBe('50');
    expect(u.searchParams.get('etat_administratif')).toBe('A');
  });
  it('n\'ajoute ni section ni RGE par défaut', () => {
    const r = construireRequete({ q: 'dupont' });
    if (!r.ok) throw new Error('attendu ok');
    const u = new URL(r.url);
    expect(u.searchParams.has('section_activite_principale')).toBe(false);
    expect(u.searchParams.has('est_rge')).toBe(false);
  });
  it('refuse un département invalide, jamais transmis tel quel', () => {
    expect(construireRequete({ q: 'dupont', departement: '54&x=1' })).toMatchObject({ ok: false });
    expect(construireRequete({ q: 'dupont', departement: '2a' })).toMatchObject({ ok: true });
  });
});

describe('parseResultats', () => {
  it('lit les champs et ignore une entrée sans nom ni SIREN', () => {
    const r = parseResultats({ results: [...annuaire.results, { siren: '', nom_complet: '' }, null] });
    expect(r.resultats).toHaveLength(1);
    expect(r.resultats[0]).toMatchObject({ siren: '552081317', siret: SIRET, commune: 'NANCY', rge_declaree: true });
  });
  it('tolère une réponse vide ou inattendue', () => {
    expect(parseResultats(null).resultats).toEqual([]);
    expect(parseResultats({ results: 'x' }).resultats).toEqual([]);
  });
});

describe('GET /api/entreprises/search', () => {
  it('enrichit avec les qualifications RGE, le libellé NAF et la fiche existante', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'deja', tenant_id: tenantId, company_name: 'Etanchéité Est', first_name: '', last_name: '', siret: '552 081 317 00018' }]);
    fauxReseau();
    const res = await request(app).get('/api/entreprises/search').query({ q: 'étanchéité', batiment: '1' }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.rge_indisponible).toBe(false);
    const r = res.body.resultats[0];
    expect(r).toMatchObject({ siret: SIRET, naf_libelle: "Travaux d'étanchéification", contact_id: 'deja' });
    expect(r.qualifications[0]).toMatchObject({ organisme: 'qualibat', reference: '7131', date_fin: '2027-01-01' });
  });

  it('ne signale pas comme existant le contact d\'un autre cabinet', async () => {
    const autre = makeTenant();
    fakeSupabaseAdmin.seed('contacts', [{ id: 'ailleurs', tenant_id: autre, company_name: 'X', first_name: '', last_name: '', siret: SIRET }]);
    const { token } = makeUser(makeTenant());
    fauxReseau();
    const res = await request(app).get('/api/entreprises/search').query({ q: 'étanchéité' }).set(authHeader(token));
    expect(res.body.resultats[0].contact_id).toBeNull();
  });

  it('garde les résultats quand la base RGE est injoignable, et le dit', async () => {
    const { token } = makeUser(makeTenant());
    fauxReseau({ ademe: 'ko' });
    const res = await request(app).get('/api/entreprises/search').query({ q: 'étanchéité' }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.rge_indisponible).toBe(true);
    expect(res.body.resultats).toHaveLength(1);
    expect(res.body.resultats[0].qualifications).toBeNull();
  });

  it('refuse les paramètres invalides sans appeler l\'annuaire', async () => {
    const { token } = makeUser(makeTenant());
    const spy = fauxReseau();
    const res = await request(app).get('/api/entreprises/search').query({ q: 'x' }).set(authHeader(token));
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('traduit une limite de débit amont en 429 et une panne en 502', async () => {
    const { token } = makeUser(makeTenant());
    fauxReseau({ annuaireStatus: 429 });
    expect((await request(app).get('/api/entreprises/search').query({ q: 'dupont' }).set(authHeader(token))).status).toBe(429);
    vi.restoreAllMocks();
    fauxReseau({ annuaireStatus: 500 });
    expect((await request(app).get('/api/entreprises/search').query({ q: 'dupont' }).set(authHeader(token))).status).toBe(502);
  });

  it('exige une authentification', async () => {
    const res = await request(app).get('/api/entreprises/search').query({ q: 'dupont' });
    expect([401, 403]).toContain(res.status);
  });
});
