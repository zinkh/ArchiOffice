// Phase 7 batch 16: end-to-end Supertest coverage for the domains extracted
// into server/routes/{superpdp,chorusPro}.ts — confirms the extraction
// didn't change behavior. Both talk to external Plateformes Agréées via the
// native fetch API (not axios), stubbed here the same way batch 13 (Stancer
// billing) stubbed global.fetch.
//
// Known gap, same limitation already documented in fakeSupabaseAdmin.ts:
// both integrations' situation routes do `.select('*, marche:marches_entreprises(*)')`,
// an embedded relation the fake doesn't resolve (it returns the flat row —
// `sit.marche` stays undefined). search-situation-facture legitimately
// requires `marche.entreprise_siret`, so with this fake it can only be
// exercised down its validation-error branch, not its success path.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

// Matches by path suffix (ignoring host/query) against a table of canned
// responses; each entry may be a plain object (returned as JSON) or
// { text: string } (returned as text, e.g. the CII XML conversion step).
function mockFetch(responses: Record<string, any>) {
  global.fetch = vi.fn(async (url: any) => {
    const path = String(url).split('?')[0];
    const key = Object.keys(responses).find(p => path.endsWith(p));
    const body = key ? responses[key] : {};
    if (body && typeof body === 'object' && 'text' in body) {
      return { ok: true, headers: { get: () => 'application/xml' }, text: async () => body.text } as any;
    }
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as any;
  }) as any;
}

describe('SuperPDP', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('reports connected from settings', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, superpdp_client_id: 'cid', superpdp_client_secret: 'secret' }]);

    const res = await request(app).get('/api/superpdp/status').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });

  it('disconnects, clearing the credentials', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, superpdp_client_id: 'cid', superpdp_client_secret: 'secret' }]);

    const res = await request(app).delete('/api/superpdp/disconnect').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.superpdp_client_id).toBeNull();
  });

  it('tests credentials against the companies endpoint', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, superpdp_client_id: 'cid', superpdp_client_secret: 'secret' }]);
    mockFetch({ '/oauth2/token': { access_token: 'tok' }, '/v1.beta/companies/me': { formal_name: 'Cabinet ArchiTest' } });

    const res = await request(app).post('/api/superpdp/test').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, company: 'Cabinet ArchiTest' });
  });

  it('sends an invoice, persisting the superpdp_id and status', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, superpdp_client_id: 'cid', superpdp_client_secret: 'secret', agency_name: 'Cabinet ArchiTest' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv1', tenant_id: tenantId, invoice_number: 'F-001', amount: 1000, vat_rate: 20 }]);
    mockFetch({
      '/oauth2/token': { access_token: 'tok' },
      '/invoices/convert': { text: '<xml/>' },
      // matched by suffix, so the query-stringed create-invoice call lands here
      '/v1.beta/invoices': { id: 'spdp_1', events: [{ status_code: 'api:uploaded' }] },
    });

    const res = await request(app).post('/api/superpdp/send/inv1').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.superpdp_id).toBe('spdp_1');
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv1')?.superpdp_id).toBe('spdp_1');
  });

  it('refreshes lifecycle events for a sent invoice', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, superpdp_client_id: 'cid', superpdp_client_secret: 'secret' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv2', tenant_id: tenantId, superpdp_id: 'spdp_2' }]);
    mockFetch({ '/oauth2/token': { access_token: 'tok' }, '/invoice_events': { data: [{ status_code: 'api:sent' }, { status_code: 'api:accepted' }] } });

    const res = await request(app).get('/api/superpdp/events/inv2').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.latest_status).toBe('api:accepted');
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv2')?.superpdp_status).toBe('api:accepted');
  });

  it('lists invoices from Super PDP', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, superpdp_client_id: 'cid', superpdp_client_secret: 'secret' }]);
    mockFetch({ '/oauth2/token': { access_token: 'tok' }, '/v1.beta/invoices': { data: [{ id: 'spdp_9' }] } });

    const res = await request(app).get('/api/superpdp/invoices').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe('spdp_9');
  });

  it('rejects search-situation-facture when the linked marché has no SIRET (no embedded-join support in the fake)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, superpdp_client_id: 'cid', superpdp_client_secret: 'secret' }]);
    fakeSupabaseAdmin.seed('situations', [{ id: 'sit1', tenant_id: tenantId, numero_situation: 1 }]);

    const res = await request(app).post('/api/superpdp/search-situation-facture/sit1').set(authHeader(token)).send({ buyer_siret: '12345678900011' });
    expect(res.status).toBe(400);
  });

  it('links a situation to an already-found Super PDP facture', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('situations', [{ id: 'sit2', tenant_id: tenantId, numero_situation: 2 }]);

    const res = await request(app).post('/api/superpdp/link-situation/sit2').set(authHeader(token)).send({ superpdp_id: 777, buyer_siret: '12345678900011' });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('situations').find(s => s.id === 'sit2')?.superpdp_id).toBe(777);
  });

  it('attaches the état d\'acompte PDF to an already-linked facture', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, superpdp_client_id: 'cid', superpdp_client_secret: 'secret', agency_name: 'Cabinet ArchiTest' }]);
    fakeSupabaseAdmin.seed('situations', [{ id: 'sit3', tenant_id: tenantId, numero_situation: 3, date_situation: '2026-03-01', superpdp_id: 777 }]);
    fakeSupabaseAdmin.seed('detail_situations', [{ id: 'd1', tenant_id: tenantId, situation_id: 'sit3', montant_situation: 5000 }]);
    mockFetch({ '/oauth2/token': { access_token: 'tok' }, '/attachments': { success: true } });

    const res = await request(app).post('/api/superpdp/attach-etat-acompte/sit3').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('situations').find(s => s.id === 'sit3')?.etat_acompte_joint_at).toBeTruthy();
  });

  it('lists situations linked to Super PDP with their computed net amount', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('situations', [{ id: 'sit4', tenant_id: tenantId, numero_situation: 4, superpdp_id: 42 }]);
    fakeSupabaseAdmin.seed('detail_situations', [{ id: 'd2', tenant_id: tenantId, situation_id: 'sit4', montant_situation: 10000 }]);

    const res = await request(app).get('/api/superpdp/situations').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.find((s: any) => s.id === 'sit4')?.montant_ttc).toBeGreaterThan(0);
  });
});

describe('Chorus Pro', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('reports connected only when all four credential fields are set', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, chorus_pro_piste_client_id: 'a', chorus_pro_piste_client_secret: 'b', chorus_pro_technical_login: 'c' }]);

    const res = await request(app).get('/api/chorus-pro/status').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false); // missing chorus_pro_technical_password
  });

  it('disconnects, clearing all four credential fields', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, chorus_pro_piste_client_id: 'a', chorus_pro_piste_client_secret: 'b', chorus_pro_technical_login: 'c', chorus_pro_technical_password: 'd' }]);

    const res = await request(app).delete('/api/chorus-pro/disconnect').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.chorus_pro_piste_client_id).toBeNull();
  });

  it('tests credentials by looking up the tenant SIRET', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, siret: '12345678900011', chorus_pro_piste_client_id: 'a', chorus_pro_piste_client_secret: 'b', chorus_pro_technical_login: 'c', chorus_pro_technical_password: 'd' }]);
    mockFetch({ '/api/oauth/token': { access_token: 'tok' }, '/rechercher/siret': { success: true } });

    const res = await request(app).post('/api/chorus-pro/test').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });

  it('submits an invoice with an explicit buyer SIRET', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, chorus_pro_piste_client_id: 'a', chorus_pro_piste_client_secret: 'b', chorus_pro_technical_login: 'c', chorus_pro_technical_password: 'd' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv3', tenant_id: tenantId, invoice_number: 'F-002', amount: 2000, vat_rate: 20 }]);
    mockFetch({ '/api/oauth/token': { access_token: 'tok' }, '/soumettre': { identifiantFactureCPP: 'cp_1' } });

    const res = await request(app).post('/api/chorus-pro/send/inv3').set(authHeader(token)).send({ buyer_siret: '98765432100011' });
    expect(res.status).toBe(200);
    expect(res.body.chorus_pro_id).toBe('cp_1');
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv3')?.chorus_pro_id).toBe('cp_1');
  });

  it('falls back to the linked project\'s client SIRET when no buyer SIRET is given', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, chorus_pro_piste_client_id: 'a', chorus_pro_piste_client_secret: 'b', chorus_pro_technical_login: 'c', chorus_pro_technical_password: 'd' }]);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId, name: 'Villa', client_siret: '11122233300011' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv4', tenant_id: tenantId, project_id: 'p1', invoice_number: 'F-003', amount: 500, vat_rate: 20 }]);
    mockFetch({ '/api/oauth/token': { access_token: 'tok' }, '/soumettre': { identifiantFactureCPP: 'cp_2' } });

    const res = await request(app).post('/api/chorus-pro/send/inv4').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv4')?.buyer_siret).toBe('11122233300011');
  });

  it('requires a buyer SIRET when none is provided and no project is linked', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, chorus_pro_piste_client_id: 'a', chorus_pro_piste_client_secret: 'b', chorus_pro_technical_login: 'c', chorus_pro_technical_password: 'd' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv5', tenant_id: tenantId, invoice_number: 'F-004', amount: 500, vat_rate: 20 }]);

    const res = await request(app).post('/api/chorus-pro/send/inv5').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('refreshes the status history for a submitted invoice', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, chorus_pro_piste_client_id: 'a', chorus_pro_piste_client_secret: 'b', chorus_pro_technical_login: 'c', chorus_pro_technical_password: 'd' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv6', tenant_id: tenantId, chorus_pro_id: 'cp_3' }]);
    mockFetch({ '/api/oauth/token': { access_token: 'tok' }, '/historique_statut': { listeHistoriqueStatutVo: [{ statut: 'DEPOSEE' }, { statut: 'MISE_A_DISPOSITION' }] } });

    const res = await request(app).get('/api/chorus-pro/status/inv6').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.latest_status).toBe('MISE_A_DISPOSITION');
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv6')?.chorus_pro_status).toBe('MISE_A_DISPOSITION');
  });

  it('lists only the caller tenant\'s invoices submitted to Chorus Pro', async () => {
    const tenantA = makeTenant();
    fakeSupabaseAdmin.seed('invoices', [{ id: 'ia', tenant_id: tenantA, chorus_pro_id: 'cp_a', created_at: new Date().toISOString() }]);
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('invoices', [{ id: 'ib', tenant_id: tenantB, chorus_pro_id: 'cp_b', created_at: new Date().toISOString() }]);
    const { token } = makeUser(tenantA);

    const res = await request(app).get('/api/chorus-pro/invoices').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((i: any) => i.id === 'ia')).toBe(true);
    expect(res.body.some((i: any) => i.id === 'ib')).toBe(false);
  });

  it('links a situation to an already-found Chorus Pro facture, tenant-scoped', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('situations', [{ id: 'sit-b', tenant_id: tenantB, numero_situation: 1 }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).post('/api/chorus-pro/link-situation/sit-b').set(authHeader(token)).send({ chorus_pro_id: 999 });
    expect(res.status).toBe(200);
    // The situation belongs to tenant B — the tenant-scoped update must not touch it.
    expect(fakeSupabaseAdmin.getTable('situations').find(s => s.id === 'sit-b')?.chorus_pro_id).toBeUndefined();
  });
});
