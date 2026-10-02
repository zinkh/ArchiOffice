// Le quota de stockage quand le cabinet héberge lui-même ses fichiers —
// server/externalStorage/storageUsage.ts, lu par server.ts::checkStorageQuota
// (le plafond qui refuse un dépôt) et par server/routes/billing.ts (la jauge
// « Stockage » de l'écran Abonnement).
//
// C'est la raison d'être de toute la fonctionnalité : des octets qui vivent sur
// l'espace du cabinet ne nous coûtent rien et ne doivent donc plus ni bloquer
// un dépôt, ni faire monter sa jauge. Un filtre posé sur l'un mais oublié sur
// l'autre donnerait un écran qui monte sans jamais bloquer — incompréhensible.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage,
} from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';
import { PLAN_LIMITS } from '../src/lib/billing';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

beforeEach(() => {
  memoryDrive.reset();
});

/** Remplit le quota Supabase du cabinet jusqu'à son plafond d'essai. */
function fillSupabaseQuota(tenantId: string) {
  fakeSupabaseAdmin.seed('document_versions', [{
    id: `plein-${tenantId}`, tenant_id: tenantId, document_id: 'x', version: 1,
    file_url: 'https://fake.supabase.test/storage/v1/object/public/documents/x/y.pdf',
    storage_backend: 'supabase',
    size_bytes: PLAN_LIMITS.trial.storage_mb * 1024 * 1024,
  }]);
}

function seedProject(tenantId: string, id: string) {
  fakeSupabaseAdmin.seed('projects', [{ id, tenant_id: tenantId, project_code: '26014', name: 'Villa Martin' }]);
}

function upload(token: string, projectId: string, filename: string) {
  return request(app).post('/api/documents').set(authHeader(token))
    .field('project_id', projectId).field('name', 'CCTP').field('category', 'CCTP').field('phase', 'DCE')
    .attach('file', Buffer.from('%PDF-fake'), filename);
}

describe('quota de stockage', () => {
  it('refuse un dépôt au-delà du plafond quand le fichier reste chez nous', async () => {
    const tenantId = makeTenant({ plan: 'trial' });
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'q1');
    fillSupabaseQuota(tenantId);

    const res = await upload(token, 'q1', 'trop.pdf');
    expect(res.status).toBe(402);
    expect(res.body.error).toContain('Limite de stockage atteinte');
  });

  it('accepte le même dépôt quand il part sur l’espace du cabinet', async () => {
    const tenantId = makeTenant({ plan: 'trial' });
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'q2');
    fillSupabaseQuota(tenantId);
    connectExternalStorage(tenantId);

    const res = await upload(token, 'q2', 'ok.pdf');
    expect(res.status).toBe(201);
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/DCE/ok.pdf']);
  });

  it('ne compte pas les octets hébergés chez le cabinet dans la jauge d’abonnement', async () => {
    const tenantId = makeTenant({ plan: 'trial' });
    const { token } = makeUser(tenantId, 'admin');
    seedProject(tenantId, 'q3');
    connectExternalStorage(tenantId);

    const before = await request(app).get('/api/billing/status').set(authHeader(token));
    expect(before.status).toBe(200);
    const usedBefore = before.body.usage.storage.used;

    await upload(token, 'q3', 'externe.pdf');

    const after = await request(app).get('/api/billing/status').set(authHeader(token));
    expect(after.body.usage.storage.used).toBe(usedBefore);
  });

  it('continue de compter les octets restés chez nous', async () => {
    const tenantId = makeTenant({ plan: 'trial' });
    const { token } = makeUser(tenantId, 'admin');
    seedProject(tenantId, 'q4');
    fakeSupabaseAdmin.seed('document_versions', [{
      id: `compte-${tenantId}`, tenant_id: tenantId, document_id: 'x', version: 1,
      file_url: 'https://fake.supabase.test/storage/v1/object/public/documents/x/y.pdf',
      storage_backend: 'supabase',
      size_bytes: 5 * 1024 * 1024,
    }]);

    const res = await request(app).get('/api/billing/status').set(authHeader(token));
    expect(res.body.usage.storage.used).toBe(5);
  });
});
