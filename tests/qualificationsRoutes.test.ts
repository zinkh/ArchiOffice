// Qualifications des entreprises : CRUD, attestation de contrôle, import RGE.
// L'isolation entre cabinets passe par tenantScopedFrom, vérifiée ici à travers
// l'application réelle ; l'API de l'ADEME est remplacée par un faux fetch.
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { resetRgeCache } from '../server/rgeLookup';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => resetRgeCache());
afterEach(() => vi.restoreAllMocks());

// Clé de Luhn correcte.
const SIRET = '55208131700018';
let n = 0;

function cabinet() {
  const tenantId = makeTenant();
  const { token } = makeUser(tenantId);
  n += 1;
  const contactId = `contact-${n}-${Date.now()}`;
  fakeSupabaseAdmin.seed('contacts', [{ id: contactId, tenant_id: tenantId, company_name: 'Dupont SARL', first_name: '', last_name: '', siret: SIRET }]);
  return { tenantId, token, contactId };
}

const lignes = (tenantId: string) =>
  fakeSupabaseAdmin.getTable('contact_qualifications').filter(r => r.tenant_id === tenantId);

describe('qualifications : écriture', () => {
  it('crée une qualification saisie à la main et la relit', async () => {
    const { tenantId, token, contactId } = cabinet();
    const create = await request(app).post(`/api/contacts/${contactId}/qualifications`).set(authHeader(token))
      .send({ organisme: 'qualibat', reference: '2111', libelle: 'Maçonnerie', date_fin: '15/03/2027' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ organisme: 'qualibat', reference: '2111', date_fin: '2027-03-15', source: 'saisie' });

    const list = await request(app).get(`/api/qualifications?contact_id=${contactId}`).set(authHeader(token));
    expect(list.body).toHaveLength(1);
    expect(lignes(tenantId)[0].created_by).toBeTruthy();
  });

  it('refuse un organisme inconnu et une date impossible', async () => {
    const { token, contactId } = cabinet();
    const a = await request(app).post(`/api/contacts/${contactId}/qualifications`).set(authHeader(token)).send({ organisme: 'bidon' });
    const b = await request(app).post(`/api/contacts/${contactId}/qualifications`).set(authHeader(token)).send({ organisme: 'rge', date_fin: '2027-13-40' });
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
  });

  it('refuse un contact d\'un autre cabinet', async () => {
    const a = cabinet();
    const b = cabinet();
    const res = await request(app).post(`/api/contacts/${a.contactId}/qualifications`).set(authHeader(b.token)).send({ organisme: 'rge' });
    expect(res.status).toBe(404);
    expect(lignes(a.tenantId)).toHaveLength(0);
  });

  it('ne montre ni ne supprime les qualifications d\'un autre cabinet', async () => {
    const a = cabinet();
    const b = cabinet();
    const create = await request(app).post(`/api/contacts/${a.contactId}/qualifications`).set(authHeader(a.token)).send({ organisme: 'qualibat', reference: '1' });
    const vue = await request(app).get('/api/qualifications').set(authHeader(b.token));
    expect(vue.body).toEqual([]);
    await request(app).delete(`/api/qualifications/${create.body.id}`).set(authHeader(b.token));
    expect(lignes(a.tenantId)).toHaveLength(1);
  });

  it('supprime la sienne', async () => {
    const { tenantId, token, contactId } = cabinet();
    const create = await request(app).post(`/api/contacts/${contactId}/qualifications`).set(authHeader(token)).send({ organisme: 'qualibat', reference: '1' });
    const del = await request(app).delete(`/api/qualifications/${create.body.id}`).set(authHeader(token));
    expect(del.status).toBe(200);
    expect(lignes(tenantId)).toHaveLength(0);
  });
});

describe('qualifications : attestation de contrôle', () => {
  it('atteste puis retire l\'attestation', async () => {
    const { token, contactId } = cabinet();
    const q = (await request(app).post(`/api/contacts/${contactId}/qualifications`).set(authHeader(token)).send({ organisme: 'qualibat', reference: '1' })).body;
    const ok = await request(app).post(`/api/qualifications/${q.id}/verify`).set(authHeader(token)).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.verified_at).toBeTruthy();
    const non = await request(app).post(`/api/qualifications/${q.id}/verify`).set(authHeader(token)).send({ verified: false });
    expect(non.body.verified_at).toBeNull();
  });

  it('modifier l\'échéance invalide l\'attestation, modifier une note non', async () => {
    const { token, contactId } = cabinet();
    const q = (await request(app).post(`/api/contacts/${contactId}/qualifications`).set(authHeader(token)).send({ organisme: 'qualibat', reference: '1', date_fin: '2027-01-01' })).body;
    await request(app).post(`/api/qualifications/${q.id}/verify`).set(authHeader(token)).send({});

    const note = await request(app).put(`/api/qualifications/${q.id}`).set(authHeader(token)).send({ notes: 'Certificat reçu par mail' });
    expect(note.body.verified_at).toBeTruthy();

    const echeance = await request(app).put(`/api/qualifications/${q.id}`).set(authHeader(token)).send({ date_fin: '2028-01-01' });
    expect(echeance.status).toBe(200);
    expect(echeance.body.date_fin).toBe('2028-01-01');
    expect(echeance.body.verified_at).toBeNull();
  });

  it('une qualification introuvable rend 404', async () => {
    const { token } = cabinet();
    const res = await request(app).post('/api/qualifications/inconnue/verify').set(authHeader(token)).send({});
    expect(res.status).toBe(404);
  });
});

const lignesAdeme = [
  { siret: SIRET, organisme: 'QUALIBAT', code_qualification: '7131', nom_qualification: 'Isolation', domaine: 'Murs', date_debut: '2025-01-01', date_fin: '2027-01-01' },
  { siret: SIRET, organisme: 'QUALIBAT', code_qualification: '7131', nom_qualification: 'Isolation', domaine: 'Combles', date_debut: '2025-01-01', date_fin: '2027-01-01' },
  { siret: SIRET, organisme: 'QUALIFELEC', code_qualification: 'E1', date_fin: '2026-12-31' },
];

function fauxAdeme(results: any[] = lignesAdeme) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((async () => ({
    ok: true, status: 200, json: async () => ({ results }),
  })) as any);
}

describe('qualifications : import RGE (ADEME)', () => {
  it('importe, regroupe par qualification et rend la liste', async () => {
    const { tenantId, token, contactId } = cabinet();
    fauxAdeme();
    const res = await request(app).post(`/api/contacts/${contactId}/qualifications/rge-sync`).set(authHeader(token)).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ found: 2, created: 2, updated: 0, skipped: 0 });
    expect(lignes(tenantId).map(l => l.organisme).sort()).toEqual(['qualibat', 'qualifelec']);
    expect(lignes(tenantId).every(l => l.source === 'ademe')).toBe(true);
  });

  it('rejoué, met à jour sans doublonner', async () => {
    const { tenantId, token, contactId } = cabinet();
    fauxAdeme();
    await request(app).post(`/api/contacts/${contactId}/qualifications/rge-sync`).set(authHeader(token)).send({});
    resetRgeCache();
    const again = await request(app).post(`/api/contacts/${contactId}/qualifications/rge-sync`).set(authHeader(token)).send({});
    expect(again.body).toMatchObject({ created: 0, updated: 2 });
    expect(lignes(tenantId)).toHaveLength(2);
  });

  it('n\'écrase jamais une qualification saisie à la main', async () => {
    const { tenantId, token, contactId } = cabinet();
    await request(app).post(`/api/contacts/${contactId}/qualifications`).set(authHeader(token))
      .send({ organisme: 'qualibat', reference: '7131', date_fin: '2030-05-05' });
    fauxAdeme();
    const res = await request(app).post(`/api/contacts/${contactId}/qualifications/rge-sync`).set(authHeader(token)).send({});
    expect(res.body).toMatchObject({ created: 1, skipped: 1 });
    const manuelle = lignes(tenantId).find(l => l.organisme === 'qualibat')!;
    expect(manuelle.date_fin).toBe('2030-05-05');
    expect(manuelle.source).toBe('saisie');
  });

  it('refuse sans SIRET exploitable', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'sans-siret', tenant_id: tenantId, company_name: 'X', first_name: '', last_name: '' }]);
    const spy = fauxAdeme();
    const res = await request(app).post('/api/contacts/sans-siret/qualifications/rge-sync').set(authHeader(token)).send({});
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rend 502 quand la base ADEME est injoignable, sans rien écrire', async () => {
    const { tenantId, token, contactId } = cabinet();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('réseau'));
    const res = await request(app).post(`/api/contacts/${contactId}/qualifications/rge-sync`).set(authHeader(token)).send({});
    expect(res.status).toBe(502);
    expect(lignes(tenantId)).toHaveLength(0);
  });

  it('une entreprise sans qualification RGE rend found = 0, pas une erreur', async () => {
    const { token, contactId } = cabinet();
    fauxAdeme([]);
    const res = await request(app).post(`/api/contacts/${contactId}/qualifications/rge-sync`).set(authHeader(token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(0);
  });

  it('refuse le contact d\'un autre cabinet', async () => {
    const a = cabinet();
    const b = cabinet();
    const spy = fauxAdeme();
    const res = await request(app).post(`/api/contacts/${a.contactId}/qualifications/rge-sync`).set(authHeader(b.token)).send({});
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});
