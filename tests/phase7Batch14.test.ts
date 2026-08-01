// Phase 7 batch 14: end-to-end Supertest coverage for the domains extracted
// into server/routes/{zohoInvoice,zohoBooks}.ts — confirms the extraction
// didn't change behavior. Zoho Invoice uses axios (spied directly);
// Zoho Books uses the global fetch (stubbed like contactSync/billing).
// Both only ever touch invoices.status/zoho_invoice_id, never invoice
// content, so no invoice-creation logic is exercised here.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import axios from 'axios';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Zoho Invoice', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports connected/has_credentials from settings', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org', zoho_refresh_token: 'rt' }]);

    const res = await request(app).get('/api/zoho/status').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, has_credentials: true });
  });

  it('requires credentials before starting the OAuth flow', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId }]);

    const res = await request(app).get('/api/zoho/auth').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('redirects to the Zoho consent screen when credentials are present', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);

    const res = await request(app).get('/api/zoho/auth').set(authHeader(token));
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.zoho.com/oauth/v2/auth');
    expect(res.headers.location).toContain(`state=${tenantId}`);
  });

  it('exchanges the OAuth code for a refresh token on callback', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec' }]);
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { refresh_token: 'new-refresh-token' } } as any);

    // The redirect from Zoho's consent screen doesn't carry our app's JWT — this
    // route identifies the tenant purely via the OAuth `state` param, so an
    // Authorization header is still required to pass the global auth middleware
    // (this route is not in AUTH_EXEMPT), a pre-existing quirk unchanged by
    // this extraction, not something introduced by it.
    const res = await request(app).get('/api/zoho/callback').query({ code: 'abc', state: tenantId }).set(authHeader(token));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?zoho_connected=1');
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.zoho_refresh_token).toBe('new-refresh-token');
  });

  it('disconnects, clearing the refresh token', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_refresh_token: 'rt' }]);

    const res = await request(app).delete('/api/zoho/disconnect').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.zoho_refresh_token).toBeNull();
  });

  it('requires being connected before syncing', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId }]);

    const res = await request(app).post('/api/zoho/sync').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('pushes an unsynced invoice and pulls a status update, tenant-scoped', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_refresh_token: 'rt', zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);
    fakeSupabaseAdmin.seed('invoices', [
      { id: 'inv-new', tenant_id: tenantId, description: 'Honoraires phase 1', amount: 5000, zoho_invoice_id: null },
      { id: 'inv-synced', tenant_id: tenantId, zoho_invoice_id: 'zoho-existing', status: 'Draft' },
    ]);

    vi.spyOn(axios, 'post').mockImplementation(async (url: string) => {
      if (url.includes('/oauth/v2/token')) return { data: { access_token: 'tok', expires_in: 3600 } } as any;
      if (url.endsWith('/contacts')) return { data: { contact: { contact_id: 'cust-1' } } } as any;
      if (url.endsWith('/invoices')) return { data: { invoice: { invoice_id: 'zoho-new' } } } as any;
      return { data: {} } as any;
    });
    vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/contacts')) return { data: { contacts: [] } } as any;
      if (url.endsWith('/invoices')) return { data: { invoices: [{ invoice_id: 'zoho-existing', status: 'paid' }] } } as any;
      return { data: {} } as any;
    });

    const res = await request(app).post('/api/zoho/sync').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.pushed).toBe(1);
    expect(res.body.pulled).toBe(1);
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-new')?.zoho_invoice_id).toBe('zoho-new');
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-synced')?.status).toBe('Paid');
  });
});

describe('Zoho Books', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('reports connected/has_credentials from settings (books org id or shared org id)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_books_org_id: 'books-org', zoho_refresh_token: 'rt' }]);

    const res = await request(app).get('/api/zoho-books/status').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, has_credentials: true });
  });

  it('requires being connected before syncing', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId }]);

    const res = await request(app).post('/api/zoho-books/sync').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('disconnects, clearing the refresh token', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_refresh_token: 'rt' }]);

    const res = await request(app).delete('/api/zoho-books/disconnect').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.zoho_refresh_token).toBeNull();
  });

  it('pushes an unsynced invoice and pulls a status update, tenant-scoped', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_refresh_token: 'rt', zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_books_org_id: 'org' }]);
    fakeSupabaseAdmin.seed('invoices', [
      { id: 'inv-new-b', tenant_id: tenantId, client_name: 'Client A', amount: 3000, zoho_invoice_id: null },
      { id: 'inv-synced-b', tenant_id: tenantId, zoho_invoice_id: 'zoho-b-existing', status: 'draft' },
    ]);

    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/oauth/v2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) } as any;
      if (u.includes('status=all')) return { ok: true, json: async () => ({ invoices: [{ invoice_id: 'zoho-b-existing', status: 'paid' }] }) } as any;
      if (u.includes('/invoices')) return { ok: true, json: async () => ({ invoice: { invoice_id: 'zoho-b-new' } }) } as any;
      return { ok: true, json: async () => ({}) } as any;
    }) as any;

    const res = await request(app).post('/api/zoho-books/sync').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.pushed).toBe(1);
    expect(res.body.pulled).toBe(1);
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-new-b')?.zoho_invoice_id).toBe('zoho-b-new');
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-synced-b')?.status).toBe('paid');
  });

  it('never syncs another tenant\'s invoices', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-victim', tenant_id: tenantB, client_name: 'Victim', amount: 1, zoho_invoice_id: null }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantA, zoho_refresh_token: 'rt', zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_books_org_id: 'org' }]);

    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/oauth/v2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) } as any;
      if (u.includes('status=all')) return { ok: true, json: async () => ({ invoices: [] }) } as any;
      return { ok: true, json: async () => ({ invoice: { invoice_id: 'should-not-be-used' } }) } as any;
    }) as any;

    const res = await request(app).post('/api/zoho-books/sync').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.pushed).toBe(0);
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-victim')?.zoho_invoice_id).toBeNull();
  });
});
