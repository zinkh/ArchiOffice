// Suspension d'un cabinet par le superadmin (litige entre associés, compte
// piraté) : bloqué pour TOUS ses membres, administrateurs compris, sans rien
// supprimer. Seul le superadmin suspend et lève la suspension.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { invalidateSuspensionCache } from '../server/tenantSuspension';
import { purgeExpiredTenants } from '../server/tenantPurge';

let app: Express;
const SUPER_ADMIN_EMAIL = 'super-admin@archioffice.test';

function makeSuperAdminToken(): string {
  const token = `super-admin-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fakeSupabaseAdmin.registerUser(token, { id: crypto.randomUUID(), email: SUPER_ADMIN_EMAIL });
  return token;
}

function suspendInDb(tenantId: string): void {
  const tenant = fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId);
  tenant!.suspended_at = new Date().toISOString();
  invalidateSuspensionCache();
}

beforeAll(async () => {
  process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
  app = await getTestApp();
});

beforeEach(() => invalidateSuspensionCache());

describe('Cabinet suspendu : accès bloqué pour tous ses membres', () => {
  it('refuse même un administrateur du cabinet, avec le code TENANT_SUSPENDED', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    suspendInDb(tenantId);

    const res = await request(app).get('/api/team').set(authHeader(token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_SUSPENDED');
  });

  it('refuse aussi les écritures et les suppressions', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    suspendInDb(tenantId);

    const write = await request(app).post('/api/settings/tenant-deletion').set(authHeader(token));
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('TENANT_SUSPENDED');
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.deletion_requested_at).toBeFalsy();
  });

  it("ne révèle pas le motif de la suspension aux membres", async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const tenant = fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)!;
    tenant.suspension_reason = 'Litige entre associés, secret';
    suspendInDb(tenantId);

    const res = await request(app).get('/api/team').set(authHeader(token));
    expect(JSON.stringify(res.body)).not.toContain('Litige');
  });

  it("laisse passer /api/me pour que l'écran de blocage puisse s'afficher", async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    suspendInDb(tenantId);

    const res = await request(app).get('/api/me').set(authHeader(token));
    expect(res.status).toBe(200);
  });

  it("n'affecte pas un autre cabinet", async () => {
    const suspendedTenant = makeTenant();
    makeUser(suspendedTenant, 'admin');
    const otherTenant = makeTenant();
    const { token } = makeUser(otherTenant, 'admin');
    suspendInDb(suspendedTenant);

    const res = await request(app).get('/api/team').set(authHeader(token));
    expect(res.status).toBe(200);
  });
});

describe('Super-Admin : suspendre et lever la suspension', () => {
  it('suspend un cabinet avec un motif, et la suspension prend effet aussitôt', async () => {
    const tenantId = makeTenant();
    const { token: memberToken } = makeUser(tenantId, 'admin');
    const superToken = makeSuperAdminToken();

    const res = await request(app)
      .post(`/api/admin/tenants/${tenantId}/suspend`)
      .set(authHeader(superToken))
      .send({ reason: 'Accord écrit des associés du 2 octobre' });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.suspended_at).toBeTruthy();

    const blocked = await request(app).get('/api/team').set(authHeader(memberToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('TENANT_SUSPENDED');
  });

  it('exige un motif avec son justificatif', async () => {
    const tenantId = makeTenant();
    const res = await request(app)
      .post(`/api/admin/tenants/${tenantId}/suspend`)
      .set(authHeader(makeSuperAdminToken()))
      .send({ reason: 'court' });
    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.suspended_at).toBeFalsy();
  });

  it('refuse de suspendre deux fois', async () => {
    const tenantId = makeTenant();
    suspendInDb(tenantId);
    const res = await request(app)
      .post(`/api/admin/tenants/${tenantId}/suspend`)
      .set(authHeader(makeSuperAdminToken()))
      .send({ reason: 'Décision de justice du tribunal' });
    expect(res.status).toBe(409);
  });

  it('lève la suspension : les membres retrouvent leur accès', async () => {
    const tenantId = makeTenant();
    const { token: memberToken } = makeUser(tenantId, 'admin');
    suspendInDb(tenantId);

    const res = await request(app)
      .post(`/api/admin/tenants/${tenantId}/unsuspend`)
      .set(authHeader(makeSuperAdminToken()));
    expect(res.status).toBe(200);

    const after = await request(app).get('/api/team').set(authHeader(memberToken));
    expect(after.status).toBe(200);
  });

  it("est fermé à un administrateur de cabinet, même du cabinet visé", async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');

    const suspend = await request(app)
      .post(`/api/admin/tenants/${tenantId}/suspend`)
      .set(authHeader(token))
      .send({ reason: 'Tentative non autorisée' });
    expect(suspend.status).toBe(403);

    suspendInDb(tenantId);
    const lift = await request(app).post(`/api/admin/tenants/${tenantId}/unsuspend`).set(authHeader(token));
    expect(lift.status).toBe(403);
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.suspended_at).toBeTruthy();
  });
});

describe('Cabinet suspendu : aucune purge automatique', () => {
  it("ne purge jamais un cabinet suspendu dont la fermeture est échue", async () => {
    const tenantId = makeTenant();
    const tenant = fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)!;
    tenant.deletion_requested_at = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    suspendInDb(tenantId);

    await purgeExpiredTenants(fakeSupabaseAdmin as any);
    expect(fakeSupabaseAdmin.getTable('tenants').some(t => t.id === tenantId)).toBe(true);
  });
});
