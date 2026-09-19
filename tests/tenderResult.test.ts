// Résultat de la consultation (entreprise retenue, montant des honoraires,
// enveloppe prévisionnelle) et candidatures similaires — server/routes/
// tenders.ts. Le pourcentage honoraires/enveloppe se calcule côté client
// (src/pages/TenderDetail.tsx), jamais stocké, donc rien à tester ici pour
// lui : ces tests couvrent la persistance des trois champs et le
// rapprochement des affaires similaires.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('tender result fields (enveloppe, entreprise retenue, honoraires)', () => {
  it('persists enveloppe_previsionnelle, entreprise_retenue and honoraires_retenus_montant on update', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-result-1';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client', submission_deadline: '', status: 'Draft' }]);

    const res = await request(app).put(`/api/tenders/${tenderId}`).set(authHeader(token)).send({
      title: 'Affaire', client: 'Client', submission_deadline: '', status: 'Won',
      enveloppe_previsionnelle: 50000, entreprise_retenue: 'Atelier Martin', honoraires_retenus_montant: 22000,
    });
    expect(res.status).toBe(200);
    expect(res.body.enveloppe_previsionnelle).toBe(50000);
    expect(res.body.entreprise_retenue).toBe('Atelier Martin');
    expect(res.body.honoraires_retenus_montant).toBe(22000);

    const stored = fakeSupabaseAdmin.getTable('tenders').find((t: any) => t.id === tenderId);
    expect(stored?.enveloppe_previsionnelle).toBe(50000);
    expect(stored?.entreprise_retenue).toBe('Atelier Martin');
    expect(stored?.honoraires_retenus_montant).toBe(22000);
  });

  it('accepts these fields on creation too', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/tenders').set(authHeader(token)).send({
      title: 'Nouvelle affaire', client: 'Client', submission_deadline: '', status: 'Draft',
      enveloppe_previsionnelle: 30000,
    });
    expect(res.status).toBe(201);
    expect(res.body.enveloppe_previsionnelle).toBe(30000);
  });
});

describe('GET /api/tenders/:id/candidatures-similaires', () => {
  it('returns other tenders with a known entreprise_retenue, matched by same type', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tenders', [
      { id: 'ref-tender', tenant_id: tenantId, title: 'Affaire en cours', client: 'Client A', type: 'MAPA', submission_deadline: '', status: 'Draft' },
      { id: 'similar-1', tenant_id: tenantId, title: 'Affaire gagnée', client: 'Client B', type: 'MAPA', entreprise_retenue: 'Atelier Martin', honoraires_retenus_montant: 15000, submission_deadline: '2024-01-01', status: 'Won' },
      { id: 'unrelated-1', tenant_id: tenantId, title: 'Affaire sans rapport', client: 'Client C', type: 'Concours', entreprise_retenue: 'Autre Atelier', submission_deadline: '2024-01-01', status: 'Won' },
      { id: 'no-result', tenant_id: tenantId, title: 'Affaire sans résultat', client: 'Client D', type: 'MAPA', submission_deadline: '2024-01-01', status: 'Submitted' },
    ]);

    const res = await request(app).get('/api/tenders/ref-tender/candidatures-similaires').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.map((t: any) => t.id)).toEqual(['similar-1']);
    expect(res.body[0].entreprise_retenue).toBe('Atelier Martin');
  });

  it('also matches on a shared specialty when the procedure type differs', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tenders', [
      { id: 'ref-tender-2', tenant_id: tenantId, title: 'Affaire en cours', client: 'Client A', type: 'Concours', submission_deadline: '', status: 'Draft' },
      { id: 'similar-2', tenant_id: tenantId, title: 'Affaire gagnée', client: 'Client B', type: 'MAPA', entreprise_retenue: 'BET Structure', submission_deadline: '2024-01-01', status: 'Won' },
    ]);
    fakeSupabaseAdmin.seed('tender_specialties', [
      { id: 'spec-1', tenant_id: tenantId, tender_id: 'ref-tender-2', specialty_name: 'Structure' },
      { id: 'spec-2', tenant_id: tenantId, tender_id: 'similar-2', specialty_name: 'structure' },
    ]);

    const res = await request(app).get('/api/tenders/ref-tender-2/candidatures-similaires').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.map((t: any) => t.id)).toEqual(['similar-2']);
  });

  it('never returns another tenant\'s tenders', async () => {
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('tenders', [
      { id: 'ref-tender-3', tenant_id: tenantA, title: 'Affaire A', client: 'Client A', type: 'MAPA', submission_deadline: '', status: 'Draft' },
      { id: 'victim-tender', tenant_id: tenantB, title: 'Affaire B secrète', client: 'Client B', type: 'MAPA', entreprise_retenue: 'Secret', submission_deadline: '2024-01-01', status: 'Won' },
    ]);

    const res = await request(app).get('/api/tenders/ref-tender-3/candidatures-similaires').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/tender-rss-matches/:id/convert (description and type carried over)', () => {
  it('copies the match description into tenders.description and the detected procedure type into tenders.type', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tender_rss_matches', [{
      id: 'm-conv-1', tenant_id: tenantId, title: 'Réhabilitation école',
      link: 'https://example.test/1', description: 'Procédure adaptée pour la réhabilitation.',
      pouvoir_adjudicateur: 'Mairie de Test', type_marche: 'MAPA', status: 'new',
    }]);

    const res = await request(app).post('/api/tender-rss-matches/m-conv-1/convert').set(authHeader(token));
    expect(res.status).toBe(201);

    const tender = fakeSupabaseAdmin.getTable('tenders').find((t: any) => t.id === res.body.id);
    expect(tender?.description).toBe('Procédure adaptée pour la réhabilitation.');
    expect(tender?.type).toBe('MAPA');
    expect(tender?.notes).toBe('https://example.test/1');
  });
});
