// Phase 7 batch 11: end-to-end Supertest coverage for the domain extracted
// into server/routes/superAdmin.ts — confirms the extraction didn't change
// behavior. Unlike every other extracted module, this one is intentionally
// NOT tenant-scoped (it's the platform operator's cross-tenant admin
// panel), so these tests check the requireSuperAdmin gate instead of
// tenant isolation.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
const SUPER_ADMIN_EMAIL = 'super-admin@archioffice.test';

function makeSuperAdminToken(): string {
  const token = `super-admin-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fakeSupabaseAdmin.registerUser(token, { id: crypto.randomUUID(), email: SUPER_ADMIN_EMAIL });
  return token;
}

beforeAll(async () => {
  process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
  app = await getTestApp();
});

describe('Super-Admin gate', () => {
  it('reports isAdmin true only for the configured super-admin email', async () => {
    const tenantId = makeTenant();
    const { token: regularToken } = makeUser(tenantId);
    const regular = await request(app).get('/api/admin/is-admin').set(authHeader(regularToken));
    expect(regular.body.isAdmin).toBe(false);

    const admin = await request(app).get('/api/admin/is-admin').set(authHeader(makeSuperAdminToken()));
    expect(admin.body.isAdmin).toBe(true);
  });

  it('rejects every admin route for a non-super-admin caller', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const stats = await request(app).get('/api/admin/stats').set(authHeader(token));
    expect(stats.status).toBe(403);

    const tenants = await request(app).get('/api/admin/tenants').set(authHeader(token));
    expect(tenants.status).toBe(403);

    const plan = await request(app).patch(`/api/admin/tenants/${tenantId}/plan`).set(authHeader(token)).send({ plan: 'pro' });
    expect(plan.status).toBe(403);
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.plan).not.toBe('pro');
  });
});

describe('Super-Admin stats and tenant list', () => {
  it('computes plan counts and revenue from billing_events', async () => {
    const tenantA = makeTenant({ plan: 'pro' });
    const tenantB = makeTenant({ plan: 'trial' });
    fakeSupabaseAdmin.seed('billing_events', [
      { id: 'be1', tenant_id: tenantA, amount: 10000, status: 'paid', event_type: 'subscription_payment', created_at: new Date().toISOString() },
      { id: 'be2', tenant_id: tenantB, amount: 500, status: 'paid', event_type: 'credit_topup_created', created_at: new Date().toISOString() },
    ]);

    const res = await request(app).get('/api/admin/stats').set(authHeader(makeSuperAdminToken()));
    expect(res.status).toBe(200);
    expect(res.body.stats.total).toBeGreaterThanOrEqual(2);
    expect(res.body.stats.pro).toBeGreaterThanOrEqual(1);
    expect(res.body.stats.totalRevenue).toBeGreaterThanOrEqual(100);
    expect(res.body.stats.totalAiRevenue).toBeGreaterThanOrEqual(5);
  });

  it('enriches the tenant list with user/project counts and the owner', async () => {
    const tenantId = makeTenant({ plan: 'starter', slug: `slug-${Date.now()}` });
    const { userId } = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId, name: 'Villa Dupont' }]);

    const res = await request(app).get('/api/admin/tenants').set(authHeader(makeSuperAdminToken()));
    expect(res.status).toBe(200);
    const row = res.body.find((t: any) => t.id === tenantId);
    expect(row).toBeDefined();
    expect(row.user_count).toBeGreaterThanOrEqual(1);
    expect(row.project_count).toBe(1);
    expect(row.owner_email).toBe(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === userId)?.email);
  });
});

describe('Super-Admin tenant mutations', () => {
  it('changes a tenant\'s plan, rejecting an invalid one', async () => {
    const tenantId = makeTenant();
    const token = makeSuperAdminToken();

    const bad = await request(app).patch(`/api/admin/tenants/${tenantId}/plan`).set(authHeader(token)).send({ plan: 'gold' });
    expect(bad.status).toBe(400);

    const good = await request(app).patch(`/api/admin/tenants/${tenantId}/plan`).set(authHeader(token)).send({ plan: 'enterprise' });
    expect(good.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.plan).toBe('enterprise');
  });

  it('extends a tenant\'s trial, rejecting an out-of-range duration', async () => {
    const tenantId = makeTenant();
    const token = makeSuperAdminToken();

    const bad = await request(app).patch(`/api/admin/tenants/${tenantId}/trial`).set(authHeader(token)).send({ days: 400 });
    expect(bad.status).toBe(400);

    const good = await request(app).patch(`/api/admin/tenants/${tenantId}/trial`).set(authHeader(token)).send({ days: 30 });
    expect(good.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.plan).toBe('trial');
  });

  it('increments a tenant\'s AI credit balance via rpc, rejecting a zero amount', async () => {
    const tenantId = makeTenant({ ai_credit_balance_eur_cents: 1000 });
    const token = makeSuperAdminToken();

    const bad = await request(app).patch(`/api/admin/tenants/${tenantId}/ai-credit`).set(authHeader(token)).send({ amount_cents: 0 });
    expect(bad.status).toBe(400);

    const good = await request(app).patch(`/api/admin/tenants/${tenantId}/ai-credit`).set(authHeader(token)).send({ amount_cents: 500 });
    expect(good.status).toBe(200);
    expect(good.body.balance_eur_cents).toBe(1500);
  });

  it('creates a tenant with an admin user, rejecting a duplicate slug', async () => {
    const token = makeSuperAdminToken();
    const slug = `cabinet-test-${Date.now()}`;

    const created = await request(app).post('/api/admin/tenants').set(authHeader(token)).send({
      name: 'Cabinet Test', slug, adminEmail: 'owner@cabinet-test.fr', adminName: 'Owner',
    });
    expect(created.status).toBe(201);
    expect(created.body.tempPassword).toBeTruthy();
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === created.body.tenantId)?.slug).toBe(slug);
    expect(fakeSupabaseAdmin.getTable('profiles').some(p => p.tenant_id === created.body.tenantId && p.system_role === 'admin')).toBe(true);

    const dup = await request(app).post('/api/admin/tenants').set(authHeader(token)).send({
      name: 'Autre', slug, adminEmail: 'other@cabinet-test.fr', adminName: 'Other',
    });
    expect(dup.status).toBe(400);
  });

  it('deletes a tenant', async () => {
    const tenantId = makeTenant();
    const token = makeSuperAdminToken();

    const res = await request(app).delete(`/api/admin/tenants/${tenantId}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)).toBeUndefined();
  });
});
