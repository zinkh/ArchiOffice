// Circuit de contribution documentaire : server/routes/knowledgeSharing.ts.
// Couvre ce que signalait l'audit ecc-tools du PR #453 (routes d'API sans
// test d'intégration) : verrou de consentement, validation d'entrée,
// isolation entre cabinets et absence de publication.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

const DOC_ID = '11111111-1111-4111-8111-111111111111';

function seedCabinet(role: 'admin' | 'user' = 'admin') {
  const tenantId = makeTenant();
  const { token, userId } = makeUser(tenantId, role);
  return { tenantId, token, userId };
}

function seedDraft(tenantId: string, overrides: Record<string, any> = {}) {
  const row = {
    id: `c-${Math.random().toString(36).slice(2)}`, tenant_id: tenantId, document_id: DOC_ID,
    status: 'draft', sanitized_text: 'Bardage vertical, entraxe 600 mm.', warnings: [],
    created_at: new Date().toISOString(), ...overrides,
  };
  fakeSupabaseAdmin.seed('knowledge_contributions', [row]);
  return row;
}

describe('Mémoire documentaire : consentement', () => {
  it('est désactivée par défaut et n’annonce aucune publication', async () => {
    const { token } = seedCabinet();
    const res = await request(app).get('/api/knowledge-sharing').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ opted_in: false, contributions: [], publication_active: false });
  });

  it('réserve la lecture et le consentement aux administrateurs', async () => {
    const { token } = seedCabinet('user');
    expect((await request(app).get('/api/knowledge-sharing').set(authHeader(token))).status).toBe(403);
    const put = await request(app).put('/api/knowledge-sharing/consent').set(authHeader(token)).send({ opted_in: true });
    expect(put.status).toBe(403);
  });

  it('exige un choix booléen explicite', async () => {
    const { token } = seedCabinet();
    for (const body of [{}, { opted_in: 'true' }, { opted_in: 1 }]) {
      const res = await request(app).put('/api/knowledge-sharing/consent').set(authHeader(token)).send(body);
      expect(res.status).toBe(400);
    }
  });

  it('journalise l’activation et efface les brouillons du cabinet à la désactivation, sans toucher les autres', async () => {
    const mine = seedCabinet();
    const other = seedCabinet();
    seedDraft(mine.tenantId);
    seedDraft(other.tenantId);

    const on = await request(app).put('/api/knowledge-sharing/consent').set(authHeader(mine.token)).send({ opted_in: true });
    expect(on.body).toEqual({ opted_in: true });
    const off = await request(app).put('/api/knowledge-sharing/consent').set(authHeader(mine.token)).send({ opted_in: false });
    expect(off.body).toMatchObject({ opted_in: false, pending_deletions: 0 });

    const rows = fakeSupabaseAdmin.getTable('knowledge_contributions');
    expect(rows.filter((r: any) => r.tenant_id === mine.tenantId)).toHaveLength(0);
    expect(rows.filter((r: any) => r.tenant_id === other.tenantId)).toHaveLength(1);
    const events = fakeSupabaseAdmin.getTable('knowledge_sharing_events').filter((e: any) => e.tenant_id === mine.tenantId);
    expect(events.map((e: any) => e.action)).toEqual(['opt_in', 'opt_out']);
  });
});

describe('Mémoire documentaire : brouillons', () => {
  async function optIn(token: string) {
    await request(app).put('/api/knowledge-sharing/consent').set(authHeader(token)).send({ opted_in: true });
  }

  it('refuse toute préparation, édition ou validation sans consentement', async () => {
    const { token, tenantId } = seedCabinet();
    const draft = seedDraft(tenantId);
    const post = await request(app).post('/api/knowledge-sharing/drafts').set(authHeader(token)).send({ document_id: DOC_ID });
    const put = await request(app).put(`/api/knowledge-sharing/drafts/${draft.id}`).set(authHeader(token)).send({ sanitized_text: 'texte' });
    const review = await request(app).post(`/api/knowledge-sharing/drafts/${draft.id}/review`).set(authHeader(token))
      .send({ confirmed_anonymity: true, confirmed_rights: true });
    expect([post.status, put.status, review.status]).toEqual([403, 403, 403]);
  });

  it('rejette un identifiant de document invalide et un document d’un autre cabinet', async () => {
    const mine = seedCabinet();
    const other = seedCabinet();
    await optIn(mine.token);
    fakeSupabaseAdmin.seed('documents', [{
      id: DOC_ID, tenant_id: other.tenantId, name: 'cctp.pdf', file_url: 'x', mime_type: 'application/pdf', size_bytes: 10,
    }]);
    const bad = await request(app).post('/api/knowledge-sharing/drafts').set(authHeader(mine.token)).send({ document_id: 'abc' });
    expect(bad.status).toBe(400);
    const foreign = await request(app).post('/api/knowledge-sharing/drafts').set(authHeader(mine.token)).send({ document_id: DOC_ID });
    expect(foreign.status).toBe(404);
  });

  it('refuse un fichier hors du stockage privé du cabinet', async () => {
    const { token, tenantId } = seedCabinet();
    await optIn(token);
    fakeSupabaseAdmin.seed('documents', [{
      id: DOC_ID, tenant_id: tenantId, name: 'cctp.pdf', file_url: 'https://exemple.test/cctp.pdf', mime_type: 'application/pdf', size_bytes: 10,
    }]);
    const res = await request(app).post('/api/knowledge-sharing/drafts').set(authHeader(token)).send({ document_id: DOC_ID });
    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('knowledge_contributions').filter((r: any) => r.tenant_id === tenantId)).toHaveLength(0);
  });

  it('anonymise l’extrait modifié à la main et borne sa taille', async () => {
    const { token, tenantId } = seedCabinet();
    await optIn(token);
    const draft = seedDraft(tenantId);
    const empty = await request(app).put(`/api/knowledge-sharing/drafts/${draft.id}`).set(authHeader(token)).send({ sanitized_text: '  ' });
    const huge = await request(app).put(`/api/knowledge-sharing/drafts/${draft.id}`).set(authHeader(token)).send({ sanitized_text: 'a'.repeat(25001) });
    expect([empty.status, huge.status]).toEqual([400, 400]);

    const ok = await request(app).put(`/api/knowledge-sharing/drafts/${draft.id}`).set(authHeader(token))
      .send({ sanitized_text: 'Contact marie@example.fr pour le lot 04, entraxe 600 mm.' });
    expect(ok.status).toBe(200);
    expect(ok.body.sanitized_text).not.toContain('marie@example.fr');
    expect(ok.body.sanitized_text).toContain('[EMAIL]');
  });

  it('exige les deux confirmations avant validation, puis ne publie rien et fige le brouillon', async () => {
    const { token, tenantId } = seedCabinet();
    await optIn(token);
    const draft = seedDraft(tenantId);
    const url = `/api/knowledge-sharing/drafts/${draft.id}/review`;

    for (const body of [{}, { confirmed_anonymity: true }, { confirmed_anonymity: true, confirmed_rights: 'oui' }]) {
      expect((await request(app).post(url).set(authHeader(token)).send(body)).status).toBe(400);
    }
    const ok = await request(app).post(url).set(authHeader(token)).send({ confirmed_anonymity: true, confirmed_rights: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'reviewed', publication_active: false });

    // Un brouillon validé n'est plus modifiable ni re-validable.
    const edit = await request(app).put(`/api/knowledge-sharing/drafts/${draft.id}`).set(authHeader(token)).send({ sanitized_text: 'autre' });
    const again = await request(app).post(url).set(authHeader(token)).send({ confirmed_anonymity: true, confirmed_rights: true });
    expect([edit.status, again.status]).toEqual([404, 404]);
  });

  it('ne laisse pas un cabinet valider ou supprimer la contribution d’un autre', async () => {
    const mine = seedCabinet();
    const other = seedCabinet();
    await optIn(mine.token);
    const theirs = seedDraft(other.tenantId);

    const review = await request(app).post(`/api/knowledge-sharing/drafts/${theirs.id}/review`).set(authHeader(mine.token))
      .send({ confirmed_anonymity: true, confirmed_rights: true });
    expect(review.status).toBe(404);
    await request(app).delete(`/api/knowledge-sharing/contributions/${theirs.id}`).set(authHeader(mine.token));
    const row = fakeSupabaseAdmin.getTable('knowledge_contributions').find((r: any) => r.id === theirs.id);
    expect(row).toMatchObject({ status: 'draft' });
  });

  it('supprime une contribution du cabinet', async () => {
    const { token, tenantId } = seedCabinet();
    const draft = seedDraft(tenantId, { status: 'reviewed' });
    const res = await request(app).delete(`/api/knowledge-sharing/contributions/${draft.id}`).set(authHeader(token));
    expect(res.body).toMatchObject({ success: true, pending_deletions: 0 });
    expect(fakeSupabaseAdmin.getTable('knowledge_contributions').find((r: any) => r.id === draft.id)).toBeUndefined();
  });
});
