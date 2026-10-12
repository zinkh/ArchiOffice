// Partage automatique, routes : réglage, dépôt de document, documents existants, retrait.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function cabinet(role: 'admin' | 'user' = 'admin') {
  const tenantId = makeTenant();
  return { tenantId, ...makeUser(tenantId, role) };
}
const optIn = (tenantId: string, extra: Record<string, unknown> = {}) =>
  fakeSupabaseAdmin.seed('knowledge_sharing_preferences', [{ tenant_id: tenantId, opted_in: true, ...extra }]);
const auto = (token: string, body: object) => request(app).put('/api/knowledge-sharing/auto').set(authHeader(token)).send(body);
const prefsOf = (tenantId: string) => fakeSupabaseAdmin.getTable('knowledge_sharing_preferences').find((p: any) => p.tenant_id === tenantId);
const contributionsOf = (tenantId: string) => fakeSupabaseAdmin.getTable('knowledge_contributions').filter((c: any) => c.tenant_id === tenantId);

describe('PUT /api/knowledge-sharing/auto : réglage du partage automatique', () => {
  it('est réservé aux administrateurs', async () => {
    const { token } = cabinet('user');
    expect((await auto(token, { enabled: true, categories: ['CCTP'], confirmed_ai_review: true })).status).toBe(403);
  });

  it('exige d’abord l’autorisation de contribution anonymisée', async () => {
    const { token } = cabinet();
    expect((await auto(token, { enabled: true, categories: ['CCTP'], confirmed_ai_review: true })).status).toBe(403);
  });

  it('exige un choix booléen, au moins un type et la confirmation de l’analyse par l’IA', async () => {
    const { token, tenantId } = cabinet();
    optIn(tenantId);
    expect((await auto(token, {})).status).toBe(400);
    expect((await auto(token, { enabled: true, categories: [], confirmed_ai_review: true })).status).toBe(400);
    const noConfirm = await auto(token, { enabled: true, categories: ['CCTP'] });
    expect(noConfirm.status).toBe(400);
    expect(noConfirm.body.error).toMatch(/Mistral/);
    expect(prefsOf(tenantId)!.auto_share_enabled).toBeUndefined();
  });

  it.each(['Contrat', 'Devis', 'OS', 'CR réunion', 'Plan', 'Autre', 'n’importe quoi'])('refuse le type « %s »', async (type) => {
    const { token, tenantId } = cabinet();
    optIn(tenantId);
    const res = await auto(token, { enabled: true, categories: ['CCTP', type], confirmed_ai_review: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non partageable/);
  });

  it('active, en gardant la trace de qui a consenti et quand', async () => {
    const { token, tenantId, userId } = cabinet();
    optIn(tenantId);
    const res = await auto(token, { enabled: true, categories: ['CCTP', 'Note technique', 'CCTP'], confirmed_ai_review: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, categories: ['CCTP', 'Note technique'] });
    expect(prefsOf(tenantId)).toMatchObject({ auto_share_enabled: true, auto_share_categories: ['CCTP', 'Note technique'], auto_share_consented_by: userId });
    expect(prefsOf(tenantId)!.auto_share_consented_at).toBeTruthy();
  });

  it('désactive en supprimant ce qui n’est pas encore parti, sans toucher à ce qui a été publié', async () => {
    const { token, tenantId } = cabinet();
    optIn(tenantId, { auto_share_enabled: true, auto_share_categories: ['CCTP'] });
    const row = (id: string, status: string) => ({ id, tenant_id: tenantId, document_id: id, status, origin: 'auto', sanitized_text: 'x' });
    fakeSupabaseAdmin.seed('knowledge_contributions', [
      row('c-queued', 'queued'), row('c-reviewed', 'reviewed'), row('c-held', 'held'), row('c-published', 'reviewed'),
      { ...row('c-manual', 'draft'), origin: 'manual' },
    ]);
    fakeSupabaseAdmin.seed('knowledge_remote_documents', [{ id: 'r1', tenant_id: tenantId, contribution_id: 'c-published', state: 'published' }]);

    const res = await auto(token, { enabled: false });

    expect(res.status).toBe(200);
    expect(prefsOf(tenantId)!.auto_share_enabled).toBe(false);
    expect(contributionsOf(tenantId).map((c: any) => c.id).sort()).toEqual(['c-manual', 'c-published']);
  });
});

describe('dépôt de document', () => {
  async function upload(token: string, docType: string) {
    return request(app).post('/api/documents').set(authHeader(token))
      .field('name', 'CCTP lot 04').field('category', 'General').field('doc_type', docType)
      .attach('file', Buffer.from('%PDF-1.4 contenu'), 'cctp.pdf');
  }

  it('met en file un document du type choisi, sans retarder le dépôt', async () => {
    const { token, tenantId } = cabinet();
    optIn(tenantId, { auto_share_enabled: true, auto_share_categories: ['CCTP'] });
    const res = await upload(token, 'CCTP');
    expect(res.status).toBe(201);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(contributionsOf(tenantId)).toEqual([expect.objectContaining({ document_id: res.body.id, status: 'queued', origin: 'auto' })]);
  });

  it('ne met rien en file pour un autre type, ni sans partage automatique', async () => {
    const a = cabinet();
    optIn(a.tenantId, { auto_share_enabled: true, auto_share_categories: ['CCTP'] });
    expect((await upload(a.token, 'Contrat')).status).toBe(201);
    const b = cabinet();
    optIn(b.tenantId, { auto_share_enabled: false, auto_share_categories: ['CCTP'] });
    expect((await upload(b.token, 'CCTP')).status).toBe(201);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(contributionsOf(a.tenantId)).toHaveLength(0);
    expect(contributionsOf(b.tenantId)).toHaveLength(0);
  });
});

describe('GET /api/knowledge-sharing et documents déjà présents', () => {
  it('annonce le réglage, les types partageables avec leur nombre de documents et le plafond', async () => {
    const { token, tenantId } = cabinet();
    optIn(tenantId, { auto_share_enabled: true, auto_share_categories: ['CCTP'] });
    fakeSupabaseAdmin.seed('documents', [
      { id: 'd1', tenant_id: tenantId, name: 'a', doc_type: 'CCTP' }, { id: 'd2', tenant_id: tenantId, name: 'b', doc_type: 'CCTP' },
      { id: 'd3', tenant_id: tenantId, name: 'c', doc_type: 'Contrat' },
    ]);
    const res = await request(app).get('/api/knowledge-sharing').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.auto).toMatchObject({ enabled: true, categories: ['CCTP'], daily_cap: 25 });
    expect(res.body.auto.available).toEqual(expect.arrayContaining([{ name: 'CCTP', count: 2 }, { name: 'DPGF', count: 0 }]));
    expect(res.body.auto.available.map((t: any) => t.name)).not.toContain('Contrat');
  });

  it('met en file, sur demande, les documents déjà présents des types choisis, et eux seuls', async () => {
    const { token, tenantId } = cabinet();
    optIn(tenantId, { auto_share_enabled: true, auto_share_categories: ['CCTP'] });
    const url = 'https://x.supabase.co/storage/v1/object/public/documents/t/x.pdf';
    fakeSupabaseAdmin.seed('documents', [
      { id: 'd1', tenant_id: tenantId, name: 'a.pdf', file_url: url, size_bytes: 10, doc_type: 'CCTP' },
      { id: 'd2', tenant_id: tenantId, name: 'b.pdf', file_url: url, size_bytes: 10, doc_type: 'Contrat' },
      { id: 'd3', tenant_id: 'autre-cabinet', name: 'c.pdf', file_url: url, size_bytes: 10, doc_type: 'CCTP' },
    ]);
    const res = await request(app).post('/api/knowledge-sharing/auto/backfill').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ examined: 1, queued: 1 });
    expect(contributionsOf(tenantId).map((c: any) => c.document_id)).toEqual(['d1']);
  });

  it('refuse de mettre en file quand le partage automatique est désactivé', async () => {
    const { token, tenantId } = cabinet();
    optIn(tenantId);
    expect((await request(app).post('/api/knowledge-sharing/auto/backfill').set(authHeader(token))).status).toBe(403);
  });
});

describe('retrait de l’autorisation', () => {
  it('arrête aussi le partage automatique, qui ne reprend pas tout seul si l’autorisation est redonnée', async () => {
    const { token, tenantId } = cabinet();
    optIn(tenantId, { auto_share_enabled: true, auto_share_categories: ['CCTP'] });
    const off = await request(app).put('/api/knowledge-sharing/consent').set(authHeader(token)).send({ opted_in: false });
    expect(off.status).toBe(200);
    expect(prefsOf(tenantId)).toMatchObject({ opted_in: false, auto_share_enabled: false });

    await request(app).put('/api/knowledge-sharing/consent').set(authHeader(token)).send({ opted_in: true });
    expect(prefsOf(tenantId)).toMatchObject({ opted_in: true, auto_share_enabled: false });
  });
});
