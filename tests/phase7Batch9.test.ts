// Phase 7 batch 9: end-to-end Supertest coverage for the domains extracted
// into server/routes/{tenders,tenderRss,milestones}.ts — confirms the
// extraction didn't change behavior, that tenantScopedFrom() still enforces
// tenant isolation, and locks in the Phase 2 tenant-scoping fix on
// PUT /api/tenders/:id (the "update filtered + unfiltered reread" pattern).
//
// POST /api/tender-rss-sources/poll-now is only exercised with zero enabled
// sources for the tenant — pollAllTenderRssSources performs a real network
// fetch per enabled source, which this sandbox can't reach; with nothing
// enabled it short-circuits to an empty loop, so the route's success path
// is still covered without any live network dependency.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Tenders', () => {
  it('creates a tender with specialties and milestones, then lists and reads it back', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/tenders').set(authHeader(token)).send({
      title: 'Médiathèque de Thionville', client: 'Ville de Thionville', value: 4500000,
      specialties_list: [{ specialty_name: 'BET Structure' }],
      milestones_list: [{ title: 'Remise des offres', due_date: '2026-06-15' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.tenant_id).toBe(tenantId);
    const tenderId = created.body.id;
    // FakeSupabaseAdmin doesn't resolve embedded relations (select('*, x(*)')
    // returns the flat row only), so the joined tender_specialties/milestones
    // are asserted directly against the underlying tables instead of the
    // response body — see tests/fakeSupabaseAdmin.ts's documented limitation.
    expect(fakeSupabaseAdmin.getTable('tender_specialties').filter(s => s.tender_id === tenderId)).toHaveLength(1);
    expect(fakeSupabaseAdmin.getTable('milestones').filter(m => m.tender_id === tenderId)).toHaveLength(1);

    const listed = await request(app).get('/api/tenders').set(authHeader(token));
    expect(listed.body.some((t: any) => t.id === tenderId)).toBe(true);

    const got = await request(app).get(`/api/tenders/${tenderId}`).set(authHeader(token));
    expect(got.status).toBe(200);
    expect(got.body.title).toBe('Médiathèque de Thionville');
  });

  it('updates a tender, replacing its specialties', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const created = await request(app).post('/api/tenders').set(authHeader(token)).send({ title: 'Gymnase', specialties_list: [{ specialty_name: 'Old' }] });

    const updated = await request(app).put(`/api/tenders/${created.body.id}`).set(authHeader(token)).send({
      title: 'Gymnase (révisé)', specialties_list: [{ specialty_name: 'Nouveau' }],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('Gymnase (révisé)');
    const specialties = fakeSupabaseAdmin.getTable('tender_specialties').filter(s => s.tender_id === created.body.id);
    expect(specialties.map(s => s.specialty_name)).toEqual(['Nouveau']);
  });

  it('deletes a tender and cascades its specialties and milestones', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const created = await request(app).post('/api/tenders').set(authHeader(token)).send({
      title: 'À supprimer', specialties_list: [{ specialty_name: 'X' }], milestones_list: [{ title: 'Étape', due_date: '2026-01-01' }],
    });
    const tenderId = created.body.id;

    const deleted = await request(app).delete(`/api/tenders/${tenderId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tenders').find(t => t.id === tenderId)).toBeUndefined();
    expect(fakeSupabaseAdmin.getTable('tender_specialties').some(s => s.tender_id === tenderId)).toBe(false);
    expect(fakeSupabaseAdmin.getTable('milestones').some(m => m.tender_id === tenderId)).toBe(false);
  });

  it('never leaks another tenant\'s tender through PUT (Phase 2 regression)', async () => {
    const tenantB = makeTenant();
    const tenderId = 'tender-b';
    fakeSupabaseAdmin.seed('tenders', [{ id: tenderId, tenant_id: tenantB, title: 'SECRET-TENDER-B', value: 999999 }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).put(`/api/tenders/${tenderId}`).set(authHeader(token)).send({ title: 'Hacked' });
    // The update touches 0 rows (tenant-scoped), and the reread is also
    // tenant-scoped, so it must never return tenant B's tender data.
    expect(res.body.title).not.toBe('SECRET-TENDER-B');
    expect(fakeSupabaseAdmin.getTable('tenders').find(t => t.id === tenderId)?.title).toBe('SECRET-TENDER-B');
  });
});

describe('Tender RSS', () => {
  it('creates, lists, updates, and deletes an RSS source', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/tender-rss-sources').set(authHeader(token)).send({ name: 'Marchés publics', url: 'https://example.test/feed.xml' });
    expect(created.status).toBe(201);
    const sourceId = created.body.id;

    const listed = await request(app).get('/api/tender-rss-sources').set(authHeader(token));
    expect(listed.body.some((s: any) => s.id === sourceId)).toBe(true);

    const updated = await request(app).put(`/api/tender-rss-sources/${sourceId}`).set(authHeader(token)).send({ name: 'Marchés publics (v2)', url: 'https://example.test/feed.xml', enabled: false });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tender_rss_sources').find(s => s.id === sourceId)?.name).toBe('Marchés publics (v2)');

    const deleted = await request(app).delete(`/api/tender-rss-sources/${sourceId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tender_rss_sources').find(s => s.id === sourceId)).toBeUndefined();
  });

  it('polls without error when no source is enabled', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/tender-rss-sources/poll-now').set(authHeader(token));
    expect(res.status).toBe(200);
  });

  it('filters matches by status, updates status, and converts a match to a tender', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('tender_rss_matches', [
      { id: 'm1', tenant_id: tenantId, title: 'Réhabilitation école', link: 'https://example.test/1', description: 'x', status: 'new' },
      { id: 'm2', tenant_id: tenantId, title: 'Ignoré', link: 'https://example.test/2', description: 'y', status: 'dismissed' },
    ]);

    const filtered = await request(app).get('/api/tender-rss-matches').query({ status: 'new' }).set(authHeader(token));
    expect(filtered.body.map((m: any) => m.id)).toEqual(['m1']);

    const statusUpdated = await request(app).put('/api/tender-rss-matches/m2').set(authHeader(token)).send({ status: 'new' });
    expect(statusUpdated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tender_rss_matches').find(m => m.id === 'm2')?.status).toBe('new');

    const converted = await request(app).post('/api/tender-rss-matches/m1/convert').set(authHeader(token));
    expect(converted.status).toBe(201);
    expect(fakeSupabaseAdmin.getTable('tenders').find(t => t.id === converted.body.id)?.tenant_id).toBe(tenantId);
    expect(fakeSupabaseAdmin.getTable('tender_rss_matches').find(m => m.id === 'm1')?.status).toBe('converted');
  });

  it('never lists another tenant\'s RSS sources or matches', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('tender_rss_sources', [{ id: 'src-b', tenant_id: tenantB, name: 'SECRET-SOURCE-B', url: 'https://example.test/b.xml' }]);
    fakeSupabaseAdmin.seed('tender_rss_matches', [{ id: 'match-b', tenant_id: tenantB, title: 'SECRET-MATCH-B', status: 'new' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const sources = await request(app).get('/api/tender-rss-sources').set(authHeader(token));
    expect(sources.body.some((s: any) => s.id === 'src-b')).toBe(false);

    const matches = await request(app).get('/api/tender-rss-matches').set(authHeader(token));
    expect(matches.body.some((m: any) => m.id === 'match-b')).toBe(false);
  });
});

describe('Milestones', () => {
  it('creates, filters by tender_id, updates, and deletes a milestone', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/milestones').set(authHeader(token)).send({ tender_id: 't1', title: 'Dépôt du dossier', due_date: '2026-06-15' });
    expect(created.status).toBe(201);
    expect(created.body.tenant_id).toBe(tenantId);
    const id = created.body.id;

    const filtered = await request(app).get('/api/milestones').query({ tender_id: 't1' }).set(authHeader(token));
    expect(filtered.body.some((m: any) => m.id === id)).toBe(true);

    const updated = await request(app).put(`/api/milestones/${id}`).set(authHeader(token)).send({ title: 'Dépôt du dossier (repoussé)', due_date: '2026-06-20', completed: true });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('milestones').find(m => m.id === id)?.completed).toBe(true);

    const deleted = await request(app).delete(`/api/milestones/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('milestones').find(m => m.id === id)).toBeUndefined();
  });

  it('never lets a caller update another tenant\'s milestone', async () => {
    const tenantB = makeTenant();
    const id = 'milestone-b';
    fakeSupabaseAdmin.seed('milestones', [{ id, tenant_id: tenantB, title: 'SECRET-MILESTONE-B', due_date: '2026-01-01' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put(`/api/milestones/${id}`).set(authHeader(token)).send({ title: 'Hacked', due_date: '2026-01-01' });
    expect(fakeSupabaseAdmin.getTable('milestones').find(m => m.id === id)?.title).toBe('SECRET-MILESTONE-B');
  });
});
