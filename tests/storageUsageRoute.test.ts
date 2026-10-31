// Cartouche « Stockage » de la barre latérale : GET /api/billing/storage.
//
// Ce qui compte : le total et le plafond sont ouverts à tous les rôles, mais le détail
// par personne (et le « non attribué ») est réservé aux administrateurs et managers ;
// les autres ne voient que leur propre ligne, jamais celle d'un collègue.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { PLAN_LIMITS } from '../src/lib/billing';

let app: Express;
const MB = 1024 * 1024;

beforeAll(async () => {
  app = await getTestApp();
});

afterEach(() => {
  fakeSupabaseAdmin.storageBreakdownUnavailable = false;
});

function nameUser(userId: string, name: string) {
  const profile = fakeSupabaseAdmin.getTable('profiles').find(p => p.id === userId);
  if (profile) profile.name = name;
}

function seedVersion(tenantId: string, uploadedBy: string, mb: number, backend = 'supabase') {
  fakeSupabaseAdmin.seed('document_versions', [{
    id: `v-${tenantId}-${uploadedBy}-${mb}-${Math.random()}`, tenant_id: tenantId, document_id: 'd', version: 1,
    file_url: 'https://fake.supabase.test/storage/v1/object/public/documents/x.pdf',
    storage_backend: backend, uploaded_by: uploadedBy, size_bytes: mb * MB,
  }]);
}

function storage(token: string) {
  return request(app).get('/api/billing/storage').set(authHeader(token));
}

describe('GET /api/billing/storage', () => {
  it('rend le total, le plafond du plan et le détail de toute l\'équipe à un administrateur', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const { token, userId } = makeUser(tenantId, 'admin');
    nameUser(userId, 'Camille Durand');
    seedVersion(tenantId, 'Camille Durand', 30);
    seedVersion(tenantId, 'Samir Benali', 10);
    seedVersion(tenantId, 'Camille Durand', 5);
    // 60 Mo hébergés au total : 45 Mo ont un auteur, 15 Mo (photos, plans) n'en ont pas.
    fakeSupabaseAdmin.hostedStorageBytes.set(tenantId, 60 * MB);

    const res = await storage(token);

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('pro');
    expect(res.body.used_bytes).toBe(60 * MB);
    expect(res.body.limit_bytes).toBe(PLAN_LIMITS.pro.storage_mb * MB);
    expect(res.body.breakdown.scope).toBe('all');
    expect(res.body.breakdown.users).toEqual([
      { name: 'Camille Durand', bytes: 35 * MB, files: 2, is_me: true },
      { name: 'Samir Benali', bytes: 10 * MB, files: 1, is_me: false },
    ]);
    expect(res.body.breakdown.unattributed_bytes).toBe(15 * MB);
  });

  it('donne le même détail à un manager', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const { token } = makeUser(tenantId, 'manager');
    seedVersion(tenantId, 'Samir Benali', 10);

    const res = await storage(token);

    expect(res.status).toBe(200);
    expect(res.body.breakdown.scope).toBe('all');
    expect(res.body.breakdown.users).toHaveLength(1);
  });

  it('ne montre à un collaborateur que sa propre ligne, sans le non attribué', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const { token, userId } = makeUser(tenantId, 'user');
    nameUser(userId, 'Léa Martin');
    seedVersion(tenantId, 'Léa Martin', 8);
    seedVersion(tenantId, 'Samir Benali', 40);
    fakeSupabaseAdmin.hostedStorageBytes.set(tenantId, 70 * MB);

    const res = await storage(token);

    expect(res.status).toBe(200);
    expect(res.body.used_bytes).toBe(70 * MB);
    expect(res.body.breakdown.scope).toBe('self');
    expect(res.body.breakdown.users).toEqual([{ name: 'Léa Martin', bytes: 8 * MB, files: 1, is_me: true }]);
    expect(res.body.breakdown.unattributed_bytes).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('Samir Benali');
  });

  it('ne compte pas les fichiers hébergés sur l\'espace externe du cabinet', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const { token } = makeUser(tenantId, 'admin');
    seedVersion(tenantId, 'Samir Benali', 10);
    seedVersion(tenantId, 'Samir Benali', 500, 'external');

    const res = await storage(token);

    expect(res.body.breakdown.users).toEqual([{ name: 'Samir Benali', bytes: 10 * MB, files: 1, is_me: false }]);
  });

  it('ne laisse pas voir le stockage d\'un autre cabinet', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const other = makeTenant({ plan: 'pro' });
    const { token } = makeUser(tenantId, 'admin');
    seedVersion(other, 'Autre Cabinet', 999);

    const res = await storage(token);

    expect(res.body.breakdown.users).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('Autre Cabinet');
  });

  it('rend un plafond à zéro pour un essai expiré', async () => {
    const tenantId = makeTenant({ plan: 'trial', trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() });
    const { token } = makeUser(tenantId, 'admin');

    const res = await storage(token);

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('expired');
    expect(res.body.limit_bytes).toBe(0);
  });

  it('garde le total et le plafond quand la répartition n\'est pas disponible (instance non migrée)', async () => {
    fakeSupabaseAdmin.storageBreakdownUnavailable = true;
    const tenantId = makeTenant({ plan: 'starter' });
    const { token } = makeUser(tenantId, 'admin');
    seedVersion(tenantId, 'Samir Benali', 10);

    const res = await storage(token);

    expect(res.status).toBe(200);
    expect(res.body.limit_bytes).toBe(PLAN_LIMITS.starter.storage_mb * MB);
    expect(res.body.breakdown).toBeNull();
  });

  it('exige une session', async () => {
    const res = await request(app).get('/api/billing/storage');
    expect(res.status).toBe(401);
  });
});
