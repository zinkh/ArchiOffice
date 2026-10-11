// Publication vers Mistral Libraries : server/routes/knowledgeSharing.ts.
// Mistral est simulé (tests/fakeMistral.ts) ; la base est le faux Supabase.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { FAKE_MISTRAL_LIBRARY, installFakeMistral } from './fakeMistral';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

const ENV_KEYS = ['MISTRAL_API_KEY', 'MISTRAL_KNOWLEDGE_LIBRARY_ID', 'MISTRAL_KNOWLEDGE_PUBLISH_ENABLED', 'SUPER_ADMIN_EMAIL'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  process.env.MISTRAL_API_KEY = 'test-key';
  process.env.MISTRAL_KNOWLEDGE_LIBRARY_ID = FAKE_MISTRAL_LIBRARY;
  process.env.MISTRAL_KNOWLEDGE_PUBLISH_ENABLED = 'true';
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

function cabinet(role: 'admin' | 'user' = 'admin') {
  const tenantId = makeTenant();
  return { tenantId, ...makeUser(tenantId, role) };
}

function seedReviewedContribution(tenantId: string, optedIn = true) {
  fakeSupabaseAdmin.seed('knowledge_sharing_preferences', [{ tenant_id: tenantId, opted_in: optedIn }]);
  const id = crypto.randomUUID();
  fakeSupabaseAdmin.seed('knowledge_contributions', [{
    id, tenant_id: tenantId, document_id: 'doc-1', status: 'reviewed',
    sanitized_text: 'Bardage vertical, entraxe 600 mm.', warnings: [],
  }]);
  return id;
}

const publish = (token: string, id: string, body: object = { confirmed_external_transfer: true }) =>
  request(app).post(`/api/knowledge-sharing/contributions/${id}/publish`).set(authHeader(token)).send(body);
const remoteRows = (tenantId: string) =>
  fakeSupabaseAdmin.getTable('knowledge_remote_documents').filter((r: any) => r.tenant_id === tenantId);

describe('Statut Mistral côté cabinet : rien de la bibliothèque commune n’est exposé', () => {
  it('indique seulement si la liaison fonctionne', async () => {
    const { token } = cabinet();
    installFakeMistral([{ name: 'document-de-test-utilisateur.pdf' }]);

    const res = await request(app).get('/api/knowledge-sharing/mistral/status').set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, connected: true, publication_active: true });
    expect(JSON.stringify(res.body)).not.toContain(FAKE_MISTRAL_LIBRARY);
    expect(JSON.stringify(res.body)).not.toContain('Bac à sable');
  });

  it('ne tente aucun appel et le dit quand la bibliothèque n’est pas configurée', async () => {
    const { token } = cabinet();
    delete process.env.MISTRAL_KNOWLEDGE_LIBRARY_ID;
    const mistral = installFakeMistral();

    const res = await request(app).get('/api/knowledge-sharing/mistral/status').set(authHeader(token));

    expect(res.body).toMatchObject({ configured: false, connected: false });
    expect(mistral.calls).toHaveLength(0);
  });

  it('reste réservé aux administrateurs du cabinet', async () => {
    const { token } = cabinet('user');
    expect((await request(app).get('/api/knowledge-sharing/mistral/status').set(authHeader(token))).status).toBe(403);
  });
});

describe('Diagnostic détaillé de la bibliothèque : super-administrateur seul', () => {
  it('refuse un administrateur de cabinet', async () => {
    const { token } = cabinet('admin');
    installFakeMistral();
    const res = await request(app).get('/api/admin/knowledge-library/status').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('donne le détail au super-administrateur', async () => {
    const { token, userId } = cabinet('admin');
    fakeSupabaseAdmin.seed('platform_admins', [{ user_id: userId }]);
    installFakeMistral([{ name: 'a.pdf' }, { name: 'b.pdf' }]);

    const res = await request(app).get('/api/admin/knowledge-library/status').set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      connected: true, library_id: FAKE_MISTRAL_LIBRARY, name: 'Bac à sable', visible_documents_on_first_page: 2,
    });
  });
});

describe('Publication : bibliothèque obligatoire, jamais de repli sur le bac à sable', () => {
  it('refuse tant que la publication est désactivée sur l’instance', async () => {
    const { token, tenantId } = cabinet();
    const id = seedReviewedContribution(tenantId);
    process.env.MISTRAL_KNOWLEDGE_PUBLISH_ENABLED = 'false';
    const mistral = installFakeMistral();

    expect((await publish(token, id)).status).toBe(403);
    expect(mistral.calls).toHaveLength(0);
    expect(remoteRows(tenantId)).toHaveLength(0);
  });

  it('refuse sans identifiant de bibliothèque, sans rien réserver ni envoyer', async () => {
    const { token, tenantId } = cabinet();
    const id = seedReviewedContribution(tenantId);
    delete process.env.MISTRAL_KNOWLEDGE_LIBRARY_ID;
    const mistral = installFakeMistral();

    const res = await publish(token, id);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/non configurée/);
    expect(mistral.calls).toHaveLength(0);
    expect(remoteRows(tenantId)).toHaveLength(0);
  });

  it('refuse un identifiant de bibliothèque mal formé', async () => {
    const { token, tenantId } = cabinet();
    const id = seedReviewedContribution(tenantId);
    process.env.MISTRAL_KNOWLEDGE_LIBRARY_ID = 'pas-un-uuid';
    installFakeMistral();

    expect((await publish(token, id)).status).toBe(503);
  });

  it('exige la confirmation explicite du transfert et le consentement du cabinet', async () => {
    const { token, tenantId } = cabinet();
    const id = seedReviewedContribution(tenantId, false);
    const mistral = installFakeMistral();

    expect((await publish(token, id, {})).status).toBe(400);
    expect((await publish(token, id)).status).toBe(403);
    expect(mistral.calls).toHaveLength(0);
  });

  it('publie un extrait relu sous un nom opaque et enregistre l’identifiant distant', async () => {
    const { token, tenantId } = cabinet();
    const id = seedReviewedContribution(tenantId);
    const mistral = installFakeMistral();

    const res = await publish(token, id);

    expect(res.status).toBe(201);
    expect(res.body.published).toBe(true);
    expect(mistral.docs).toHaveLength(1);
    expect(mistral.docs[0].name).toBe(`archioffice-${id}.txt`);
    expect(remoteRows(tenantId)[0]).toMatchObject({
      contribution_id: id, state: 'published', remote_document_id: mistral.docs[0].id, library_id: FAKE_MISTRAL_LIBRARY,
    });
  });

  it('garde la trace d’un envoi non confirmé au lieu de le renvoyer', async () => {
    const { token, tenantId } = cabinet();
    const id = seedReviewedContribution(tenantId);
    const mistral = installFakeMistral();
    mistral.failUpload = true;

    const res = await publish(token, id);

    expect(res.status).toBe(502);
    expect(remoteRows(tenantId)[0].state).toBe('uncertain');
    expect(remoteRows(tenantId)[0].remote_document_id ?? null).toBeNull();
  });
});

describe('Rapprochement à la demande', () => {
  it('retrouve un envoi incertain, sans nouvel envoi, et laisse les documents tiers intacts', async () => {
    const { token, tenantId } = cabinet();
    const contribution = crypto.randomUUID();
    const remoteName = `archioffice-${contribution}.txt`;
    fakeSupabaseAdmin.seed('knowledge_remote_documents', [{
      id: crypto.randomUUID(), tenant_id: tenantId, contribution_id: contribution, library_id: FAKE_MISTRAL_LIBRARY,
      remote_name: remoteName, remote_document_id: null, content_sha256: 'x', state: 'uncertain',
      deletion_requested_at: null, created_at: new Date(Date.now() - 3600_000).toISOString(),
      updated_at: new Date(Date.now() - 3600_000).toISOString(),
    }]);
    const mistral = installFakeMistral([{ name: remoteName }, { name: 'fiche-test-utilisateur.pdf' }]);

    const res = await request(app).post('/api/knowledge-sharing/mistral/reconcile').set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reconciled_uploads: 1, uncertain_uploads: 0, abandoned_uploads: 0 });
    expect(remoteRows(tenantId)[0]).toMatchObject({ state: 'published' });
    expect(mistral.calls.some(c => c.startsWith('POST') || c.startsWith('DELETE'))).toBe(false);
    expect(mistral.docs).toHaveLength(2);
  });

  it('signale l’abandon d’un envoi introuvable après 24 h', async () => {
    const { token, tenantId } = cabinet();
    const contribution = crypto.randomUUID();
    fakeSupabaseAdmin.seed('knowledge_remote_documents', [{
      id: crypto.randomUUID(), tenant_id: tenantId, contribution_id: contribution, library_id: FAKE_MISTRAL_LIBRARY,
      remote_name: `archioffice-${contribution}.txt`, remote_document_id: null, content_sha256: 'x', state: 'uploading',
      deletion_requested_at: null, created_at: new Date(Date.now() - 25 * 3600_000).toISOString(),
      updated_at: new Date(Date.now() - 25 * 3600_000).toISOString(),
    }]);
    installFakeMistral();

    const res = await request(app).post('/api/knowledge-sharing/mistral/reconcile').set(authHeader(token));

    expect(res.body).toMatchObject({ abandoned_uploads: 1 });
    expect(remoteRows(tenantId)[0].state).toBe('deleted');
  });
});
