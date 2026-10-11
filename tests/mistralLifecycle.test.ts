// Cycle de vie des extraits publiés chez Mistral : server/knowledge/mistralLifecycle.ts.
// Mistral est simulé en mémoire (fetch global) : aucun appel réseau réel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import {
  ABANDON_AFTER_MS, processRemoteDeletion, reconcileStalePublications, settleRemoteDocumentsBeforePurge,
} from '../server/knowledge/mistralLifecycle';
import { purgeExpiredTenants } from '../server/tenantPurge';
import { installFakeMistral, FAKE_MISTRAL_LIBRARY as LIB, type FakeMistral } from './fakeMistral';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MINUTE = 60_000;

let db: FakeSupabaseAdmin;

function seedPublication(overrides: Record<string, unknown> = {}): Record<string, any> {
  const id = crypto.randomUUID();
  const contribution = crypto.randomUUID();
  const row: Record<string, any> = {
    id, tenant_id: TENANT, contribution_id: contribution, library_id: LIB,
    remote_name: 'archioffice-' + contribution + '.txt', remote_document_id: null,
    content_sha256: 'x', state: 'uncertain', deletion_requested_at: null,
    created_at: iso(60 * MINUTE), updated_at: iso(10 * MINUTE), last_error: null, ...overrides,
  };
  db.seed('knowledge_remote_documents', [row]);
  return row;
}
const rowOf = (id: string) => db.getTable('knowledge_remote_documents').find(r => r.id === id)!;
const deletes = (m: FakeMistral) => m.calls.filter(c => c.startsWith('DELETE'));

beforeEach(() => {
  db = new FakeSupabaseAdmin();
  process.env.MISTRAL_API_KEY = 'test-key';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MISTRAL_API_KEY;
});

describe('reconcileStalePublications : réservations restées sans issue', () => {
  it('retrouve le document distant d’un envoi incertain sans jamais renvoyer', async () => {
    const row = seedPublication();
    const mistral = installFakeMistral([{ name: row.remote_name as string }]);

    const summary = await reconcileStalePublications(db as any, TENANT);

    expect(summary).toMatchObject({ checked: 1, reconciled: 1, abandoned: 0 });
    expect(rowOf(row.id)).toMatchObject({ state: 'published', remote_document_id: mistral.docs[0].id });
    expect(mistral.calls.some(c => c.startsWith('POST'))).toBe(false);
  });

  it('reprend aussi une réservation restée en « uploading » (arrêt du serveur en cours d’envoi)', async () => {
    const row = seedPublication({ state: 'uploading', updated_at: iso(10 * MINUTE) });
    installFakeMistral([{ name: row.remote_name as string }]);

    await reconcileStalePublications(db as any, TENANT);

    expect(rowOf(row.id).state).toBe('published');
  });

  it('laisse « uncertain » un envoi introuvable tant que le délai d’abandon n’est pas écoulé', async () => {
    const row = seedPublication({ created_at: iso(2 * 60 * MINUTE) });
    installFakeMistral();

    const summary = await reconcileStalePublications(db as any, TENANT);

    expect(summary).toMatchObject({ uncertain: 1, abandoned: 0 });
    expect(rowOf(row.id).state).toBe('uncertain');
    expect(rowOf(row.id).last_error).toMatch(/non confirmé/);
  });

  it('abandonne un envoi introuvable après le délai, sans rien supprimer chez Mistral', async () => {
    const row = seedPublication({ created_at: iso(ABANDON_AFTER_MS + MINUTE) });
    const mistral = installFakeMistral([{ name: 'manuel-ajoute-a-la-main.pdf' }]);

    const summary = await reconcileStalePublications(db as any, TENANT);

    expect(summary).toMatchObject({ abandoned: 1, reconciled: 0 });
    expect(rowOf(row.id)).toMatchObject({ state: 'deleted' });
    expect(rowOf(row.id).last_error).toMatch(/abandonné/);
    expect(deletes(mistral)).toHaveLength(0);
    expect(mistral.docs).toHaveLength(1);
  });

  it('ignore les envois en vol, les lignes déjà en suppression et les autres cabinets', async () => {
    const inFlight = seedPublication({ state: 'uploading', updated_at: iso(10_000) });
    const recentlyChecked = seedPublication({ updated_at: iso(MINUTE) });
    const deleting = seedPublication({ deletion_requested_at: iso(MINUTE), updated_at: iso(10 * MINUTE) });
    const foreign = seedPublication({ tenant_id: OTHER_TENANT });
    installFakeMistral();

    const summary = await reconcileStalePublications(db as any, TENANT);

    expect(summary.checked).toBe(0);
    for (const row of [inFlight, recentlyChecked, deleting]) {
      expect(rowOf(row.id).last_error).toBeNull();
    }
    expect(rowOf(foreign.id).last_error).toBeNull();
  });

  it('signale une ambiguïté (plusieurs copies distantes) sans rien décider', async () => {
    const row = seedPublication();
    const mistral = installFakeMistral([{ name: row.remote_name as string }]);
    mistral.duplicateName = row.remote_name as string;

    const summary = await reconcileStalePublications(db as any, TENANT);

    expect(summary).toMatchObject({ errors: 1, reconciled: 0 });
    expect(rowOf(row.id)).toMatchObject({ state: 'uncertain', remote_document_id: null });
    expect(rowOf(row.id).last_error).toMatch(/examen manuel/);
    expect(deletes(mistral)).toHaveLength(0);
  });

  it('un rapprochement à la demande (délai nul) ne touche pas un envoi encore en vol', async () => {
    const inFlight = seedPublication({ state: 'uploading', updated_at: iso(10_000) });
    installFakeMistral();

    const summary = await reconcileStalePublications(db as any, TENANT, 20, 0);

    expect(summary.checked).toBe(0);
    expect(rowOf(inFlight.id).state).toBe('uploading');
  });
});

describe('processRemoteDeletion : retrait du consentement sur une ligne sans identifiant distant', () => {
  it('ne se bloque plus indéfiniment : abandonne après le délai, sans rien supprimer chez Mistral', async () => {
    const row = seedPublication({ deletion_requested_at: iso(MINUTE), created_at: iso(ABANDON_AFTER_MS + MINUTE) });
    const mistral = installFakeMistral();

    const done = await processRemoteDeletion(db as any, row as any);

    expect(done).toBe(true);
    expect(rowOf(row.id).state).toBe('deleted');
    expect(deletes(mistral)).toHaveLength(0);
  });

  it('reste en attente tant que l’envoi peut encore avoir abouti', async () => {
    const row = seedPublication({ deletion_requested_at: iso(MINUTE), created_at: iso(30 * MINUTE) });
    installFakeMistral();

    expect(await processRemoteDeletion(db as any, row as any)).toBe(false);
    expect(rowOf(row.id).state).not.toBe('deleted');
  });

  it('supprime le document retrouvé par son nom opaque, et lui seul', async () => {
    const row = seedPublication({ deletion_requested_at: iso(MINUTE) });
    const mistral = installFakeMistral([{ name: row.remote_name as string }, { name: 'fiche-test-utilisateur.pdf' }]);

    expect(await processRemoteDeletion(db as any, row as any)).toBe(true);

    expect(rowOf(row.id).state).toBe('deleted');
    expect(mistral.docs.map(d => d.name)).toEqual(['fiche-test-utilisateur.pdf']);
  });
});

describe('settleRemoteDocumentsBeforePurge : fermeture d’un cabinet', () => {
  it('supprime les documents publiés chez Mistral avant d’autoriser la purge', async () => {
    const row = seedPublication({ state: 'published', remote_document_id: crypto.randomUUID() });
    const mistral = installFakeMistral();
    mistral.docs.push({ id: row.remote_document_id as string, library_id: LIB, name: row.remote_name as string });

    const result = await settleRemoteDocumentsBeforePurge(db as any, TENANT);

    expect(result).toEqual({ ok: true, remaining: 0 });
    expect(rowOf(row.id).state).toBe('deleted');
    expect(mistral.docs).toHaveLength(0);
  });

  it('échoue fermé : tant que Mistral ne confirme pas, la purge reste interdite', async () => {
    const row = seedPublication({ state: 'published', remote_document_id: crypto.randomUUID() });
    const mistral = installFakeMistral();
    mistral.failDelete = true;

    const result = await settleRemoteDocumentsBeforePurge(db as any, TENANT);

    expect(result).toEqual({ ok: false, remaining: 1 });
    expect(rowOf(row.id)).toMatchObject({ state: 'delete_pending' });
    expect(rowOf(row.id).deletion_requested_at).toBeTruthy();
  });

  it('autorise la purge d’un cabinet qui n’a jamais rien publié', async () => {
    installFakeMistral();
    expect(await settleRemoteDocumentsBeforePurge(db as any, TENANT)).toEqual({ ok: true, remaining: 0 });
  });

  it('ne touche pas aux documents d’un autre cabinet', async () => {
    const foreign = seedPublication({ tenant_id: OTHER_TENANT, state: 'published', remote_document_id: crypto.randomUUID() });
    installFakeMistral();

    await settleRemoteDocumentsBeforePurge(db as any, TENANT);

    expect(rowOf(foreign.id)).toMatchObject({ state: 'published', deletion_requested_at: null });
  });
});

describe('purgeExpiredTenants : documents Mistral', () => {
  function seedClosingTenant() {
    db.seed('tenants', [{
      id: TENANT, name: 'Cabinet', slug: TENANT, suspended_at: null,
      deletion_requested_at: iso(40 * 24 * 60 * MINUTE),
    }]);
    return seedPublication({ state: 'published', remote_document_id: crypto.randomUUID() });
  }

  it('reporte la suppression du cabinet tant que Mistral n’a pas confirmé', async () => {
    const row = seedClosingTenant();
    const mistral = installFakeMistral();
    mistral.docs.push({ id: row.remote_document_id as string, library_id: LIB, name: row.remote_name as string });
    mistral.failDelete = true;

    await purgeExpiredTenants(db as any);

    expect(db.getTable('tenants').some(t => t.id === TENANT)).toBe(true);
    expect(mistral.docs).toHaveLength(1);
  });

  it('supprime le cabinet une fois les documents effacés chez Mistral', async () => {
    const row = seedClosingTenant();
    const mistral = installFakeMistral();
    mistral.docs.push({ id: row.remote_document_id as string, library_id: LIB, name: row.remote_name as string });

    await purgeExpiredTenants(db as any);

    expect(mistral.docs).toHaveLength(0);
    expect(db.getTable('tenants').some(t => t.id === TENANT)).toBe(false);
  });
});
