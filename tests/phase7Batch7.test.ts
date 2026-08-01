// Phase 7 batch 7: end-to-end Supertest coverage for the domain extracted
// into server/routes/maf.ts (professional liability insurance declaration)
// — confirms the extraction didn't change behavior and that
// tenantScopedFrom() still enforces tenant isolation through the real app.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('MAF config', () => {
  it('returns an empty object when no settings row exists yet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/maf/v1/config').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('saves and reloads the MAF config for a tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const saved = await request(app).put('/api/maf/v1/config').set(authHeader(token)).send({
      maf_enabled: true, maf_numero_adherent: 'ADH-123', maf_taux_contrat_permil: 2.5, maf_declaration_year: 2026,
    });
    expect(saved.status).toBe(200);

    const reloaded = await request(app).get('/api/maf/v1/config').set(authHeader(token));
    expect(reloaded.body.maf_numero_adherent).toBe('ADH-123');
  });
});

describe('MAF entries', () => {
  it('creates, lists, updates the statut, and deletes an entry within one tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/maf/v1/entries').set(authHeader(token)).send({
      project_id: 'p1', declaration_year: 2026, intercalaire: 'violet', honoraires_ht: 5000, statut: 'brouillon',
    });
    expect(created.status).toBe(200);
    expect(created.body.tenant_id).toBe(tenantId);
    const entryId = created.body.id;

    const listed = await request(app).get('/api/maf/v1/entries').query({ year: 2026 }).set(authHeader(token));
    expect(listed.body.some((e: any) => e.id === entryId)).toBe(true);

    const statutUpdated = await request(app).patch(`/api/maf/v1/entries/${entryId}/statut`).set(authHeader(token)).send({ statut: 'declaree' });
    expect(statutUpdated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('maf_project_data').find(e => e.id === entryId)?.statut).toBe('declaree');

    const rejectedStatut = await request(app).patch(`/api/maf/v1/entries/${entryId}/statut`).set(authHeader(token)).send({ statut: 'bogus' });
    expect(rejectedStatut.status).toBe(400);

    const deleted = await request(app).delete(`/api/maf/v1/entries/${entryId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('maf_project_data').find(e => e.id === entryId)).toBeUndefined();
  });

  it('never lets a caller update or delete another tenant\'s entry', async () => {
    const tenantB = makeTenant();
    const entryId = 'entry-b';
    fakeSupabaseAdmin.seed('maf_project_data', [{ id: entryId, tenant_id: tenantB, declaration_year: 2026, intercalaire: 'violet', honoraires_ht: 'SECRET', statut: 'brouillon' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put(`/api/maf/v1/entries/${entryId}`).set(authHeader(token)).send({ honoraires_ht: 1 });
    expect(fakeSupabaseAdmin.getTable('maf_project_data').find(e => e.id === entryId)?.honoraires_ht).toBe('SECRET');

    await request(app).delete(`/api/maf/v1/entries/${entryId}`).set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('maf_project_data').find(e => e.id === entryId)).toBeDefined();
  });
});

describe('MAF summary', () => {
  it('computes the cotisation using the fixed taux for a "violet" (honoraires_ht) entry', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, maf_numero_adherent: 'ADH-1', maf_taux_contrat_permil: 5 }]);
    fakeSupabaseAdmin.seed('maf_project_data', [{ id: 'e1', tenant_id: tenantId, declaration_year: 2026, intercalaire: 'violet', honoraires_ht: 10000 }]);

    const res = await request(app).get('/api/maf/v1/summary').query({ year: 2026 }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.numeroAdherent).toBe('ADH-1');
    // violet taux fixe = 0.3593 ‰ -> cotisation = 10000 * 0.3593 / 1000
    expect(res.body.cotisationTotaleEstimee).toBeCloseTo(10000 * 0.3593 / 1000, 4);
    expect(res.body.intercalaires.violet.totalAssiette).toBe(10000);
  });

  it('never includes another tenant\'s entries in the summary', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('maf_project_data', [{ id: 'e-b', tenant_id: tenantB, declaration_year: 2026, intercalaire: 'violet', honoraires_ht: 99999 }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).get('/api/maf/v1/summary').query({ year: 2026 }).set(authHeader(token));
    expect(res.body.cotisationTotaleEstimee).toBe(0);
  });
});

describe('MAF export-pdf', () => {
  it('returns a non-empty PDF for the declaration', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, agency_name: 'Cabinet Test', maf_numero_adherent: 'ADH-9' }]);
    fakeSupabaseAdmin.seed('maf_project_data', [{ id: 'e2', tenant_id: tenantId, declaration_year: 2026, intercalaire: 'violet', honoraires_ht: 3000 }]);

    const res = await request(app).get('/api/maf/v1/export-pdf').query({ year: 2026 }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(Buffer.isBuffer(res.body) ? res.body.length : res.text.length).toBeGreaterThan(0);
  });
});

describe('MAF situations-cumul and suivi', () => {
  it('sums validated/paid situations up to end of year for a project', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('situations', [
      { id: 's1', tenant_id: tenantId, project_id: 'p1', numero_situation: 1, date_situation: '2026-03-01', etat: 'Payée' },
      { id: 's2', tenant_id: tenantId, project_id: 'p1', numero_situation: 2, date_situation: '2026-06-01', etat: 'Validée' },
    ]);
    fakeSupabaseAdmin.seed('detail_situations', [
      { id: 'd1', tenant_id: tenantId, situation_id: 's1', montant_situation: 1000 },
      { id: 'd2', tenant_id: tenantId, situation_id: 's2', montant_situation: 2000 },
    ]);

    const res = await request(app).get('/api/maf/v1/situations-cumul').query({ project_id: 'p1', year: 2026 }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.montantCumulFinAnnee).toBe(3000);
    expect(res.body.situationCount).toBe(2);
  });

  it('requires project_id and year', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/maf/v1/situations-cumul').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('lists entries across all years for suivi, scoped to the caller\'s tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('maf_project_data', [
      { id: 'e-2025', tenant_id: tenantId, declaration_year: 2025, intercalaire: 'violet', honoraires_ht: 100 },
      { id: 'e-2026', tenant_id: tenantId, declaration_year: 2026, intercalaire: 'violet', honoraires_ht: 200 },
    ]);

    const res = await request(app).get('/api/maf/v1/suivi').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.map((e: any) => e.id).sort()).toEqual(['e-2025', 'e-2026']);
  });
});

describe('MAF misc', () => {
  it('returns a stub 501 for submit', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/maf/v1/submit').set(authHeader(token));
    expect(res.status).toBe(501);
  });

  it('serves the OpenAPI spec', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/maf/v1/spec').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
  });
});
