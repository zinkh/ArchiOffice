// Résultat de la consultation (groupement retenu, montant des honoraires,
// enveloppe prévisionnelle) et candidatures similaires — server/routes/
// tenders.ts. Le pourcentage honoraires/enveloppe se calcule côté client
// (src/pages/TenderDetail.tsx), jamais stocké, donc rien à tester ici pour
// lui : ces tests couvrent la persistance des champs et le rapprochement
// des affaires similaires. Le groupement retenu (tender_groupement_membres)
// remplace l'ancien champ unique tenders.entreprise_retenue — voir
// supabase/migrate_tender_groupement_retenu.sql — parce qu'un marché de
// maîtrise d'œuvre est souvent attribué à plusieurs entreprises (architecte,
// bureau d'études, économiste), pas à une seule.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('tender result fields (enveloppe, groupement retenu, honoraires)', () => {
  it('persists enveloppe_previsionnelle, groupement_retenu_list and honoraires_retenus_montant on update', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-result-1';
    const contactId = 'contact-bet-1';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client', submission_deadline: '', status: 'Draft' }]);
    fakeSupabaseAdmin.seed('contacts', [{ id: contactId, tenant_id: tenantId, first_name: 'BET', last_name: 'Structure' }]);

    const res = await request(app).put(`/api/tenders/${tenderId}`).set(authHeader(token)).send({
      title: 'Affaire', client: 'Client', submission_deadline: '', status: 'Won',
      enveloppe_previsionnelle: 50000, honoraires_retenus_montant: 22000,
      groupement_retenu_list: [
        { role: 'Architecte', name: 'Atelier Martin' },
        { role: 'BET Structure', contact_id: contactId },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.enveloppe_previsionnelle).toBe(50000);
    expect(res.body.honoraires_retenus_montant).toBe(22000);

    const stored = fakeSupabaseAdmin.getTable('tenders').find((t: any) => t.id === tenderId);
    expect(stored?.enveloppe_previsionnelle).toBe(50000);
    expect(stored?.honoraires_retenus_montant).toBe(22000);
    expect((stored as any)?.entreprise_retenue).toBeUndefined();

    const membres = fakeSupabaseAdmin.getTable('tender_groupement_membres').filter((m: any) => m.tender_id === tenderId);
    expect(membres).toHaveLength(2);
    expect(membres.find((m: any) => m.role === 'Architecte')?.name).toBe('Atelier Martin');
    expect(membres.find((m: any) => m.role === 'BET Structure')?.contact_id).toBe(contactId);
  });

  it('replaces the groupement on a second update rather than accumulating rows', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-result-2';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire', client: 'Client', submission_deadline: '', status: 'Draft' }]);

    await request(app).put(`/api/tenders/${tenderId}`).set(authHeader(token)).send({
      title: 'Affaire', client: 'Client', submission_deadline: '', status: 'Draft',
      groupement_retenu_list: [{ role: 'Architecte', name: 'Premier nom' }],
    });
    await request(app).put(`/api/tenders/${tenderId}`).set(authHeader(token)).send({
      title: 'Affaire', client: 'Client', submission_deadline: '', status: 'Won',
      groupement_retenu_list: [{ role: 'Architecte', name: 'Nom corrigé' }],
    });

    const membres = fakeSupabaseAdmin.getTable('tender_groupement_membres').filter((m: any) => m.tender_id === tenderId);
    expect(membres).toHaveLength(1);
    expect(membres[0].name).toBe('Nom corrigé');
  });

  it('rejects a groupement member whose contact_id belongs to another tenant', async () => {
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const tenderId = 'tender-result-3';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantA, title: 'Affaire', client: 'Client', submission_deadline: '', status: 'Draft' }]);
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-victim', tenant_id: tenantB, first_name: 'Autre', last_name: 'Cabinet' }]);

    const res = await request(app).put(`/api/tenders/${tenderId}`).set(authHeader(token)).send({
      title: 'Affaire', client: 'Client', submission_deadline: '', status: 'Draft',
      groupement_retenu_list: [{ role: 'BET', contact_id: 'contact-victim' }],
    });
    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('tender_groupement_membres').filter((m: any) => m.tender_id === tenderId)).toHaveLength(0);
  });

  it('accepts groupement_retenu_list on creation too', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/tenders').set(authHeader(token)).send({
      title: 'Nouvelle affaire', client: 'Client', submission_deadline: '', status: 'Draft',
      enveloppe_previsionnelle: 30000,
      groupement_retenu_list: [{ role: 'Économiste', name: 'Cabinet Coûts' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.enveloppe_previsionnelle).toBe(30000);
    expect(fakeSupabaseAdmin.getTable('tender_groupement_membres').filter((m: any) => m.tender_id === res.body.id)).toHaveLength(1);
  });
});

describe('tender honoraires fields (fee_distribution, vat_rate, decimal_precision)', () => {
  it('persists the fee distribution and its calculation settings on update', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const tenderId = 'tender-hon-1';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantId, title: 'Affaire MAPA', client: 'Client', type: 'MAPA', submission_deadline: '', status: 'Draft' }]);

    const feeDistribution = JSON.stringify({ missions: [{ id: 'esquisse', name: 'Esquisse', category: 'Mission base', amount: 1000, percentages: { architect: 100 } }] });
    const res = await request(app).put(`/api/tenders/${tenderId}`).set(authHeader(token)).send({
      title: 'Affaire MAPA', client: 'Client', type: 'MAPA', submission_deadline: '', status: 'Draft',
      value: 10000, construction_cost: 500000, complexity_rate: 1.1, base_fee_percent: 10,
      fee_distribution: feeDistribution, vat_rate: 20, decimal_precision: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body.fee_distribution).toBe(feeDistribution);
    expect(res.body.vat_rate).toBe(20);
    expect(res.body.decimal_precision).toBe(2);

    const stored = fakeSupabaseAdmin.getTable('tenders').find((t: any) => t.id === tenderId);
    expect(stored?.fee_distribution).toBe(feeDistribution);
    expect(stored?.construction_cost).toBe(500000);
    expect(stored?.complexity_rate).toBe(1.1);
  });

  it('defaults vat_rate and decimal_precision on creation when not provided', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/tenders').set(authHeader(token)).send({
      title: 'Nouvelle affaire MAPA', client: 'Client', type: 'MAPA', submission_deadline: '', status: 'Draft',
    });
    expect(res.status).toBe(201);
    expect(res.body.vat_rate).toBe(20);
    expect(res.body.decimal_precision).toBe(2);
  });
});

describe('GET /api/tenders/:id/candidatures-similaires', () => {
  it('returns other tenders with a known groupement retenu, matched by same type', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tenders', [
      { id: 'ref-tender', tenant_id: tenantId, title: 'Affaire en cours', client: 'Client A', type: 'MAPA', submission_deadline: '', status: 'Draft' },
      { id: 'similar-1', tenant_id: tenantId, title: 'Affaire gagnée', client: 'Client B', type: 'MAPA', honoraires_retenus_montant: 15000, submission_deadline: '2024-01-01', status: 'Won' },
      { id: 'unrelated-1', tenant_id: tenantId, title: 'Affaire sans rapport', client: 'Client C', type: 'Concours', submission_deadline: '2024-01-01', status: 'Won' },
      { id: 'no-result', tenant_id: tenantId, title: 'Affaire sans résultat', client: 'Client D', type: 'MAPA', submission_deadline: '2024-01-01', status: 'Submitted' },
    ]);
    fakeSupabaseAdmin.seed('tender_groupement_membres', [
      { id: 'gm-1', tenant_id: tenantId, tender_id: 'similar-1', role: 'Architecte', name: 'Atelier Martin', sort_order: 0 },
      { id: 'gm-2', tenant_id: tenantId, tender_id: 'unrelated-1', role: 'Architecte', name: 'Autre Atelier', sort_order: 0 },
    ]);

    const res = await request(app).get('/api/tenders/ref-tender/candidatures-similaires').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.map((t: any) => t.id)).toEqual(['similar-1']);
    expect(res.body[0].groupement_retenu_list).toEqual([{ id: 'gm-1', tenant_id: tenantId, tender_id: 'similar-1', role: 'Architecte', name: 'Atelier Martin', sort_order: 0 }]);
  });

  it('also matches on a shared specialty when the procedure type differs', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tenders', [
      { id: 'ref-tender-2', tenant_id: tenantId, title: 'Affaire en cours', client: 'Client A', type: 'Concours', submission_deadline: '', status: 'Draft' },
      { id: 'similar-2', tenant_id: tenantId, title: 'Affaire gagnée', client: 'Client B', type: 'MAPA', submission_deadline: '2024-01-01', status: 'Won' },
    ]);
    fakeSupabaseAdmin.seed('tender_specialties', [
      { id: 'spec-1', tenant_id: tenantId, tender_id: 'ref-tender-2', specialty_name: 'Structure' },
      { id: 'spec-2', tenant_id: tenantId, tender_id: 'similar-2', specialty_name: 'structure' },
    ]);
    fakeSupabaseAdmin.seed('tender_groupement_membres', [
      { id: 'gm-3', tenant_id: tenantId, tender_id: 'similar-2', role: 'BET Structure', name: 'BET Structure', sort_order: 0 },
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
      { id: 'victim-tender', tenant_id: tenantB, title: 'Affaire B secrète', client: 'Client B', type: 'MAPA', submission_deadline: '2024-01-01', status: 'Won' },
    ]);
    fakeSupabaseAdmin.seed('tender_groupement_membres', [
      { id: 'gm-victim', tenant_id: tenantB, tender_id: 'victim-tender', role: 'Architecte', name: 'Secret', sort_order: 0 },
    ]);

    const res = await request(app).get('/api/tenders/ref-tender-3/candidatures-similaires').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns an empty list when no tender in the tenant has a known result', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tenders', [{ id: 'ref-tender-4', tenant_id: tenantId, title: 'Affaire', client: 'Client', type: 'MAPA', submission_deadline: '', status: 'Draft' }]);

    const res = await request(app).get('/api/tenders/ref-tender-4/candidatures-similaires').set(authHeader(token));
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

describe('GET /api/tender-rss-matches?tender_id= (source announcement lookup for a converted tender)', () => {
  it('returns the match that was converted into this tender', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tender_rss_matches', [
      { id: 'm-src-1', tenant_id: tenantId, title: 'Annonce A', status: 'converted', tender_id: 'tender-src-1' },
      { id: 'm-src-2', tenant_id: tenantId, title: 'Annonce B', status: 'new', tender_id: null },
    ]);

    const res = await request(app).get('/api/tender-rss-matches').query({ tender_id: 'tender-src-1' }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.map((m: any) => m.id)).toEqual(['m-src-1']);
  });
});
