// Appareils de synchronisation desktop : enregistrement par la session de l'application,
// jeton `ds_at_` limité à /api/desktop/v1, révocation, expiration, cabinet par en-tête.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  addMembership, authHeader, fakeSupabaseAdmin, getTestApp, makeTenant, makeUser, tenantHeader,
} from './testServer';
import { API, registerDevice } from './desktopSyncSupport';
import { hashToken } from '../server/telegramBot';
import { invalidateSuspensionCache, TENANT_SUSPENDED_CODE } from '../server/tenantSuspension';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Enregistrement d\'un appareil', () => {
  it('rend le jeton une seule fois et n\'en stocke que l\'empreinte', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);

    const res = await request(app).post(`${API}/devices`).set(authHeader(token))
      .send({ name: 'Poste de Sophie', platform: 'windows', appVersion: '1.2.3' });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^ds_at_/);
    expect(res.body.deviceId).toMatch(/^dev_/);

    const rows = fakeSupabaseAdmin.getTable('desktop_devices').filter(r => r.user_id === userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashToken(res.body.token));
    expect(JSON.stringify(rows[0])).not.toContain(res.body.token);

    const listed = await request(app).get(`${API}/devices`).set(authHeader(token));
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ name: 'Poste de Sophie', platform: 'windows', appVersion: '1.2.3' });
    expect(JSON.stringify(listed.body)).not.toContain('token_hash');
  });

  it('refuse un nom absent, une plateforme inconnue ou une version démesurée', async () => {
    const { token } = makeUser(makeTenant());
    for (const body of [
      { platform: 'windows' },
      { name: '   ', platform: 'windows' },
      { name: 'x'.repeat(81), platform: 'windows' },
      { name: 'PC', platform: 'linux' },
      { name: 'PC', platform: 'windows', appVersion: 'v'.repeat(41) },
    ]) {
      const res = await request(app).post(`${API}/devices`).set(authHeader(token)).send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_DEVICE');
    }
  });

  it('limite à 20 appareils par personne', async () => {
    const { token } = makeUser(makeTenant());
    for (let i = 0; i < 20; i += 1) await registerDevice(app, token);
    const res = await request(app).post(`${API}/devices`).set(authHeader(token)).send({ name: 'Un de trop', platform: 'macos' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TOO_MANY_DEVICES');
  });

  it('un appareil ne peut pas en enregistrer un autre', async () => {
    const { token } = makeUser(makeTenant());
    const device = await registerDevice(app, token);
    const res = await request(app).post(`${API}/devices`).set(bearer(device)).send({ name: 'Clone', platform: 'windows' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DEVICE_TOKEN_NOT_ALLOWED');
  });
});

describe('Portée du jeton d\'appareil', () => {
  it('ne donne accès qu\'à /api/desktop/v1', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const device = await registerDevice(app, token);

    for (const path of ['/api/projects', '/api/documents', '/api/me', '/api/storage/signed-url?url=x']) {
      const res = await request(app).get(path).set({ ...bearer(device), ...tenantHeader(tenantId) });
      expect(res.status, path).toBe(403);
      expect(res.body.code).toBe('DEVICE_SCOPE');
    }
    // Un préfixe voisin n'est pas le bon.
    const neighbour = await request(app).get('/api/desktop/v10/roots').set(bearer(device));
    expect(neighbour.status).toBe(403);
  });

  it('liste les cabinets de la personne sans en-tête de cabinet', async () => {
    const first = makeTenant();
    const second = makeTenant();
    const { userId, token } = makeUser(first, 'manager');
    addMembership(userId, second, 'user');
    const device = await registerDevice(app, token);

    const res = await request(app).get(`${API}/roots`).set(bearer(device));
    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.tenantId).sort()).toEqual([first, second].sort());
    const firstRoot = res.body.find((r: any) => r.tenantId === first);
    expect(firstRoot).toMatchObject({ role: 'manager', nodeId: `tenant:${first}` });
  });

  it('exige X-Tenant-Id pour lire l\'arborescence', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const device = await registerDevice(app, token);
    const res = await request(app).get(`${API}/nodes/tenant:${tenantId}`).set(bearer(device));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TENANT_REQUIRED');
  });

  it('refuse un cabinet dont la personne n\'est pas membre', async () => {
    const mine = makeTenant();
    const foreign = makeTenant();
    const { token } = makeUser(mine);
    const device = await registerDevice(app, token);
    const res = await request(app).get(`${API}/nodes/tenant:${foreign}`).set({ ...bearer(device), ...tenantHeader(foreign) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_NOT_MEMBER');
  });

  it('rend le cabinet choisi par l\'en-tête, parmi plusieurs adhésions', async () => {
    const first = makeTenant();
    const second = makeTenant();
    const { userId, token } = makeUser(first);
    addMembership(userId, second, 'user');
    const device = await registerDevice(app, token);

    const a = await request(app).get(`${API}/nodes/tenant:${first}`).set({ ...bearer(device), ...tenantHeader(first) });
    const b = await request(app).get(`${API}/nodes/tenant:${second}`).set({ ...bearer(device), ...tenantHeader(second) });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Le cabinet de l'en-tête fait foi : l'autre cabinet n'est pas lisible avec ce contexte.
    const mismatch = await request(app).get(`${API}/nodes/tenant:${second}`).set({ ...bearer(device), ...tenantHeader(first) });
    expect(mismatch.status).toBe(404);
  });
});

describe('Cycle de vie du jeton', () => {
  it('refuse un jeton inconnu', async () => {
    const res = await request(app).get(`${API}/roots`).set(bearer('ds_at_jamais-emis'));
    expect(res.status).toBe(401);
  });

  it('refuse un appareil révoqué, avec un code que le client sait traiter', async () => {
    const { token } = makeUser(makeTenant());
    const device = await registerDevice(app, token);
    const list = await request(app).get(`${API}/devices`).set(authHeader(token));
    const deviceId = list.body[0].id;

    expect((await request(app).get(`${API}/roots`).set(bearer(device))).status).toBe(200);
    const revoked = await request(app).delete(`${API}/devices/${deviceId}`).set(authHeader(token));
    expect(revoked.status).toBe(200);

    const after = await request(app).get(`${API}/roots`).set(bearer(device));
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('DEVICE_REVOKED');
    // Un appareil révoqué disparaît de la liste.
    expect((await request(app).get(`${API}/devices`).set(authHeader(token))).body).toHaveLength(0);
  });

  it('refuse un jeton expiré', async () => {
    const { userId, token } = makeUser(makeTenant());
    const device = await registerDevice(app, token);
    const row = fakeSupabaseAdmin.getTable('desktop_devices').find(r => r.user_id === userId)!;
    row.expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await request(app).get(`${API}/roots`).set(bearer(device));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('DEVICE_EXPIRED');
  });

  it('repousse l\'échéance à l\'usage, au plus une fois par heure', async () => {
    const { userId, token } = makeUser(makeTenant());
    const device = await registerDevice(app, token);
    const row = fakeSupabaseAdmin.getTable('desktop_devices').find(r => r.user_id === userId)!;
    const soon = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    row.expires_at = soon;

    await request(app).get(`${API}/roots`).set(bearer(device));
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(new Date(soon).getTime());
    expect(row.last_seen_at).toBeTruthy();

    // Un second appel dans l'heure ne réécrit rien.
    const stamp = row.last_seen_at;
    await request(app).get(`${API}/roots`).set(bearer(device));
    expect(row.last_seen_at).toBe(stamp);
  });

  it('ne laisse révoquer que ses propres appareils', async () => {
    const mine = makeUser(makeTenant());
    const other = makeUser(makeTenant());
    await registerDevice(app, other.token);
    const otherId = fakeSupabaseAdmin.getTable('desktop_devices').find(r => r.user_id === other.userId)!.id;

    const res = await request(app).delete(`${API}/devices/${otherId}`).set(authHeader(mine.token));
    expect(res.status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('desktop_devices').find(r => r.id === otherId)!.revoked_at).toBeNull();
  });

  it('un cabinet suspendu est refusé comme pour une session', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const device = await registerDevice(app, token);
    const before = await request(app).get(`${API}/nodes/tenant:${tenantId}`).set({ ...bearer(device), ...tenantHeader(tenantId) });
    expect(before.status).toBe(200);

    fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)!.suspended_at = new Date().toISOString();
    invalidateSuspensionCache();
    // La suspension s'applique à tous les modes d'authentification (server/tenantSuspension.ts).
    const res = await request(app).get(`${API}/nodes/tenant:${tenantId}`).set({ ...bearer(device), ...tenantHeader(tenantId) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(TENANT_SUSPENDED_CODE);
  });
});
