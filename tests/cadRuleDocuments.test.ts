// Règle CAO sur l'écran Documents : un fichier CAO, BIM ou 3D n'entre jamais dans
// Supabase Storage (server/externalStorage/storeBusinessFile.ts), et le mode de
// verrouillage de la synchronisation desktop se règle dans /api/settings.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage,
} from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

beforeEach(() => {
  memoryDrive.reset();
});

function seedProject(tenantId: string, id: string) {
  fakeSupabaseAdmin.seed('projects', [{ id, tenant_id: tenantId, project_code: '26014', name: 'Villa Martin' }]);
}

function upload(token: string, projectId: string, filename: string) {
  return request(app).post('/api/documents').set(authHeader(token))
    .field('name', 'Plan').field('category', 'Plans').field('phase', 'APD').field('project_id', projectId)
    .attach('file', Buffer.from('%PDF-fake'), filename);
}

describe('Documents : règle CAO', () => {
  it('refuse un fichier CAO sans espace externe, et rien n’est écrit', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'c1');

    const res = await upload(token, 'c1', 'facade.DWG');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXTERNAL_STORAGE_REQUIRED');
    expect(fakeSupabaseAdmin.getTable('documents').filter((d) => d.tenant_id === tenantId)).toHaveLength(0);
  });

  it('accepte un fichier CAO quand l’espace du cabinet est branché', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'c2');

    const res = await upload(token, 'c2', 'maquette.ifc');
    expect(res.status).toBe(201);
    const doc = fakeSupabaseAdmin.getTable('documents').find((d) => d.id === res.body.id);
    expect(doc?.storage_backend).toBe('external');
  });

  it('laisse passer un fichier ordinaire sans espace externe', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'c3');

    const res = await upload(token, 'c3', 'note.pdf');
    expect(res.status).toBe(201);
  });
});

describe('Réglage du mode de verrouillage desktop', () => {
  it('enregistre un mode valide et refuse les autres', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');

    const refus = await request(app).put('/api/settings').set(authHeader(token)).send({ desktopLockMode: 'strict' });
    expect(refus.status).toBe(400);

    const ok = await request(app).put('/api/settings').set(authHeader(token)).send({ desktopLockMode: 'enforced' });
    expect(ok.status).toBe(200);
    const lu = await request(app).get('/api/settings').set(authHeader(token));
    expect(lu.body.desktopLockMode).toBe('enforced');
  });
});
