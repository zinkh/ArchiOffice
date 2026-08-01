// Phase 7 batch 17: end-to-end Supertest coverage for the domains extracted
// into server/routes/{registration,agencySetup}.ts, plus the Google OAuth2
// token-exchange route added to the existing server/routes/contactSync.ts
// (it's the prerequisite step of the same "connect Google Contacts" flow
// already covered there). All three are onboarding-adjacent flows for an
// authenticated-but-tenantless account or a brand-new signup — distinct
// from the still-deferred Team/join-request-approval routes.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

let counter = 0;
function uniqueId(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

/** A registered auth token whose profile (if any) has no tenant_id yet. */
function makeTenantlessUser() {
  const userId = uniqueId('user');
  const email = `${userId}@example.test`;
  const token = uniqueId('token');
  fakeSupabaseAdmin.registerUser(token, { id: userId, email });
  return { userId, token, email };
}

describe('Google OAuth2 token exchange', () => {
  const originalFetch = global.fetch;
  const originalClientId = process.env.VITE_GOOGLE_CLIENT_ID;
  process.env.VITE_GOOGLE_CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';
  afterEach(() => { global.fetch = originalFetch; });
  afterAll(() => { process.env.VITE_GOOGLE_CLIENT_ID = originalClientId; });

  it('exchanges an authorization code for an access_token when authenticated', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'ya29.fake' }) })) as any;

    const res = await request(app).post('/api/auth/google/token').set(authHeader(token))
      .send({ code: 'abc', code_verifier: 'verifier', redirect_uri: 'https://app.test/auth/google/callback' });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBe('ya29.fake');
  });

  it('rejects a request with no session', async () => {
    const res = await request(app).post('/api/auth/google/token')
      .send({ code: 'abc', code_verifier: 'verifier', redirect_uri: 'https://app.test/auth/google/callback' });
    expect(res.status).toBe(401);
  });
});

describe('Inscription SaaS', () => {
  it('registers a new cabinet and its admin profile', async () => {
    const slug = uniqueId('cabinet');
    const res = await request(app).post('/api/public/register').send({
      cabinet_name: 'Cabinet Test', slug, admin_name: 'Jeanne Architecte', email: `${slug}@example.test`, password: 'longenough',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const tenant = fakeSupabaseAdmin.getTable('tenants').find(t => t.slug === slug);
    expect(tenant).toBeDefined();
    const profile = fakeSupabaseAdmin.getTable('profiles').find(p => p.tenant_id === tenant!.id);
    expect(profile?.system_role).toBe('admin');
  });

  it('rejects a slug that is already taken', async () => {
    const slug = uniqueId('cabinet');
    fakeSupabaseAdmin.seed('tenants', [{ id: uniqueId('tenant'), slug, name: 'Existant' }]);

    const res = await request(app).post('/api/public/register').send({
      cabinet_name: 'Cabinet Test', slug, admin_name: 'Jeanne', email: 'jeanne@example.test', password: 'longenough',
    });
    expect(res.status).toBe(409);
  });

  it('rejects a password shorter than 8 characters', async () => {
    const res = await request(app).post('/api/public/register').send({
      cabinet_name: 'Cabinet Test', slug: uniqueId('cabinet'), admin_name: 'Jeanne', email: 'jeanne@example.test', password: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('looks up a tenant\'s public branding by slug', async () => {
    const tenantId = makeTenant({ name: 'Cabinet Fallback' });
    const tenant = fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)!;
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, agency_name: 'Cabinet Public', logo_url: 'https://x/logo.png' }]);

    const res = await request(app).get(`/api/public/tenant/${tenant.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Cabinet Public');
    expect(res.body.logoUrl).toBe('https://x/logo.png');
  });

  it('404s for an unknown slug', async () => {
    const res = await request(app).get('/api/public/tenant/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('Agency setup', () => {
  it('reports no tenant and no pending request for a brand-new account', async () => {
    const { token } = makeTenantlessUser();
    const res = await request(app).get('/api/agency-setup/status').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasTenant: false, pendingRequest: null });
  });

  it('reports hasTenant true for an account already attached', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/agency-setup/status').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.hasTenant).toBe(true);
  });

  it('searches tenants by name', async () => {
    makeTenant({ name: 'Atelier Lumière' });
    makeTenant({ name: 'Cabinet Ombre' });
    const { token } = makeTenantlessUser();

    const res = await request(app).get('/api/agency-setup/search').query({ q: 'Lumi' }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((t: any) => t.name === 'Atelier Lumière')).toBe(true);
    expect(res.body.some((t: any) => t.name === 'Cabinet Ombre')).toBe(false);
  });

  it('creates a brand-new agency and attaches the caller as its admin', async () => {
    const { token, userId, email } = makeTenantlessUser();

    const res = await request(app).post('/api/agency-setup/create').set(authHeader(token))
      .send({ agencyName: 'Nouveau Cabinet', address: '1 rue de la Paix', phone: '0102030405', email });
    expect(res.status).toBe(200);
    const tenantId = res.body.tenantId;
    expect(tenantId).toBeTruthy();
    const profile = fakeSupabaseAdmin.getTable('profiles').find(p => p.id === userId);
    expect(profile?.tenant_id).toBe(tenantId);
    expect(profile?.system_role).toBe('admin');
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.agency_name).toBe('Nouveau Cabinet');
  });

  it('refuses to create a second agency for an already-attached account', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/agency-setup/create').set(authHeader(token)).send({ agencyName: 'Autre Cabinet' });
    expect(res.status).toBe(409);
  });

  it('files a join request against an existing tenant', async () => {
    const targetTenantId = makeTenant({ name: 'Cabinet Cible' });
    const { token, userId } = makeTenantlessUser();

    const res = await request(app).post('/api/agency-setup/join').set(authHeader(token)).send({ tenantId: targetTenantId });
    expect(res.status).toBe(200);
    expect(res.body.tenantName).toBe('Cabinet Cible');
    const jr = fakeSupabaseAdmin.getTable('join_requests').find(j => j.user_id === userId);
    expect(jr?.tenant_id).toBe(targetTenantId);
  });

  it('cancels a pending join request', async () => {
    const targetTenantId = makeTenant();
    const { token, userId } = makeTenantlessUser();
    fakeSupabaseAdmin.seed('join_requests', [{ id: uniqueId('jr'), tenant_id: targetTenantId, user_id: userId, status: 'pending' }]);

    const res = await request(app).delete('/api/agency-setup/join').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('join_requests').find(j => j.user_id === userId && j.status === 'pending')).toBeUndefined();
  });
});
