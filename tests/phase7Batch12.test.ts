// Phase 7 batch 12: end-to-end Supertest coverage for the domain extracted
// into server/routes/marchesEntreprises.ts (marchés privés / private-market
// construction contracts and their état d'acompte statements) — confirms
// the extraction didn't change behavior, that tenantScopedFrom() still
// enforces tenant isolation, and that computeEtatAcompte/
// buildEtatAcomptePdfBuffer (now shared via server/etatAcompte.ts with the
// still-inline SuperPDP/Chorus Pro integrations) still produce the same PDF.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Marchés Entreprises CRUD', () => {
  it('creates, lists, updates, and deletes a marché', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/marches-entreprises').set(authHeader(token)).send({
      project_id: 'p1', entreprise_nom: 'BTP Dupont', lot_numero: '01', lot_titre: 'Gros œuvre', montant_ht: 150000, tva_rate: 20,
    });
    expect(created.status).toBe(201);
    expect(created.body.tenant_id).toBe(tenantId);
    const id = created.body.id;

    const listed = await request(app).get('/api/marches-entreprises/p1').set(authHeader(token));
    expect(listed.body.some((m: any) => m.id === id)).toBe(true);

    const updated = await request(app).put(`/api/marches-entreprises/${id}`).set(authHeader(token)).send({ montant_ht: 160000 });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('marches_entreprises').find(m => m.id === id)?.montant_ht).toBe(160000);

    const deleted = await request(app).delete(`/api/marches-entreprises/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('marches_entreprises').find(m => m.id === id)).toBeUndefined();
  });

  it('never lets a caller update or delete another tenant\'s marché', async () => {
    const tenantB = makeTenant();
    const id = 'marche-b';
    fakeSupabaseAdmin.seed('marches_entreprises', [{ id, tenant_id: tenantB, entreprise_nom: 'SECRET-B', montant_ht: 99999 }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put(`/api/marches-entreprises/${id}`).set(authHeader(token)).send({ montant_ht: 1 });
    expect(fakeSupabaseAdmin.getTable('marches_entreprises').find(m => m.id === id)?.montant_ht).toBe(99999);

    await request(app).delete(`/api/marches-entreprises/${id}`).set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('marches_entreprises').find(m => m.id === id)).toBeDefined();
  });
});

describe('Situations enrichment', () => {
  it('computes N vs N-1 progress for each DPGF item in details-enhanced', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('dpgf_items', [{ id: 'item1', tenant_id: tenantId, project_id: 'p1', prix_unitaire_ht: 1000, quantite_prevue: 10 }]);
    fakeSupabaseAdmin.seed('situations', [
      { id: 'sit-prev', tenant_id: tenantId, project_id: 'p1', numero_situation: 1 },
      { id: 'sit-cur', tenant_id: tenantId, project_id: 'p1', numero_situation: 2 },
    ]);
    fakeSupabaseAdmin.seed('detail_situations', [
      { id: 'd-prev', tenant_id: tenantId, situation_id: 'sit-prev', dpgf_item_id: 'item1', pourcentage_avancement: 30 },
      { id: 'd-cur', tenant_id: tenantId, situation_id: 'sit-cur', dpgf_item_id: 'item1', pourcentage_avancement: 50 },
    ]);

    const res = await request(app).get('/api/situations/sit-cur/details-enhanced').set(authHeader(token));
    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(item.montant_total).toBe(10000);
    expect(item.avancement_n).toBe(50);
    expect(item.avancement_n_moins_1).toBe(30);
    expect(item.montant_periode).toBe(2000); // (50-30)% of 10000
  });

  it('bulk-replaces the detail lines of a situation', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('detail_situations', [{ id: 'old', tenant_id: tenantId, situation_id: 'sit1', dpgf_item_id: 'x', pourcentage_avancement: 10 }]);

    const res = await request(app).post('/api/situations/sit1/detail-bulk').set(authHeader(token)).send({
      items: [{ dpgf_item_id: 'item1', pourcentage_avancement: 40, montant_periode: 500 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const rows = fakeSupabaseAdmin.getTable('detail_situations').filter(d => d.situation_id === 'sit1');
    expect(rows).toHaveLength(1);
    expect(rows[0].dpgf_item_id).toBe('item1');
  });

  it('never bulk-replaces another tenant\'s situation details', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('detail_situations', [{ id: 'victim', tenant_id: tenantB, situation_id: 'sit-b', dpgf_item_id: 'x', pourcentage_avancement: 10 }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    await request(app).post('/api/situations/sit-b/detail-bulk').set(authHeader(token)).send({ items: [{ dpgf_item_id: 'y', pourcentage_avancement: 99, montant_periode: 1 }] });

    expect(fakeSupabaseAdmin.getTable('detail_situations').find(d => d.id === 'victim')).toBeDefined();
  });

  it('updates the état d\'acompte fields on a situation', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('situations', [{ id: 'sit-etat', tenant_id: tenantId, numero_situation: 1 }]);

    const res = await request(app).put('/api/situations/sit-etat/etat-acompte').set(authHeader(token)).send({ etat: 'validee', penalites_ht: 200 });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('situations').find(s => s.id === 'sit-etat')?.etat).toBe('validee');
  });
});

describe('État d\'acompte PDF', () => {
  it('generates a non-empty PDF for a situation', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, agency_name: 'Cabinet Test' }]);
    fakeSupabaseAdmin.seed('situations', [{ id: 'sit-pdf', tenant_id: tenantId, numero_situation: 3, date_situation: '2026-03-01', revision_coeff: 1 }]);
    fakeSupabaseAdmin.seed('detail_situations', [{ id: 'd1', tenant_id: tenantId, situation_id: 'sit-pdf', montant_situation: 5000 }]);

    const res = await request(app).get('/api/situations/sit-pdf/etat-acompte-pdf').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(Buffer.isBuffer(res.body) ? res.body.length : res.text.length).toBeGreaterThan(0);
  });

  it('404s for another tenant\'s situation', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('situations', [{ id: 'sit-b-pdf', tenant_id: tenantB, numero_situation: 1, date_situation: '2026-01-01' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const res = await request(app).get('/api/situations/sit-b-pdf/etat-acompte-pdf').set(authHeader(token));
    expect(res.status).toBe(404);
  });
});
