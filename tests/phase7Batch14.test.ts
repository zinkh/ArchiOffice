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

  it('returns the Zoho consent URL as JSON, with a one-time state nonce (not the bare tenantId)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);

    // Called via an authenticated fetch (not a bare `window.location.href` navigation,
    // which can't carry the JWT) — the frontend then navigates to the returned URL.
    const res = await request(app).get('/api/zoho/auth').set(authHeader(token));
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.origin + url.pathname).toBe('https://accounts.zoho.com/oauth/v2/auth');
    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(state).not.toBe(tenantId); // a bare tenantId as state would let anyone replay another tenant's id
  });

  it('completes the callback (no auth header, matching Zoho\'s bare redirect) using a state minted by /api/zoho/auth', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { refresh_token: 'new-refresh-token' } } as any);

    const authRes = await request(app).get('/api/zoho/auth').set(authHeader(token));
    const state = new URL(authRes.body.url).searchParams.get('state')!;

    // No Authorization header here — this route is in AUTH_EXEMPT because Zoho's
    // redirect back is a bare browser navigation that can't carry one.
    const res = await request(app).get('/api/zoho/callback').query({ code: 'abc', state });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?zoho_connected=1');
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.zoho_refresh_token).toBe('new-refresh-token');
  });

  it('rejects a callback with an unknown or reused state (CSRF/replay protection)', async () => {
    const res = await request(app).get('/api/zoho/callback').query({ code: 'abc', state: 'not-a-real-nonce' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?zoho_error=expired_state');

    // Same nonce used twice — the second attempt must fail even with a valid code.
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { refresh_token: 'rt' } } as any);
    const authRes = await request(app).get('/api/zoho/auth').set(authHeader(token));
    const state = new URL(authRes.body.url).searchParams.get('state')!;

    const first = await request(app).get('/api/zoho/callback').query({ code: 'abc', state });
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe('/settings?zoho_connected=1');

    const replay = await request(app).get('/api/zoho/callback').query({ code: 'abc', state });
    expect(replay.status).toBe(302);
    expect(replay.headers.location).toBe('/settings?zoho_error=expired_state');
  });

  it('disconnects, clearing the refresh token', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_refresh_token: 'rt' }]);

    const res = await request(app).delete('/api/zoho/disconnect').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.zoho_refresh_token).toBeNull();
  });

  // Zoho can refuse the exchange either with a 200 + { error } body or with a
  // non-2xx that axios throws on. Both used to collapse into `zoho_error=1`,
  // which told the admin nothing about which console setting was wrong.
  it('forwards Zoho\'s error code when the token exchange is refused (200 body)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);
    const authRes = await request(app).get('/api/zoho/auth').set(authHeader(token));
    const state = new URL(authRes.body.url).searchParams.get('state')!;
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { error: 'invalid_code' } } as any);

    const res = await request(app).get('/api/zoho/callback').query({ code: 'abc', state });
    expect(res.headers.location).toBe('/settings?zoho_error=invalid_code');
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.zoho_refresh_token).toBeUndefined();
  });

  it('forwards Zoho\'s error code when the token endpoint returns a non-2xx', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);
    const authRes = await request(app).get('/api/zoho/auth').set(authHeader(token));
    const state = new URL(authRes.body.url).searchParams.get('state')!;
    vi.spyOn(axios, 'post').mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { error: 'invalid_client' } } }),
    );

    const res = await request(app).get('/api/zoho/callback').query({ code: 'abc', state });
    expect(res.headers.location).toBe('/settings?zoho_error=invalid_client');
  });

  // An upstream message must not be able to inject arbitrary text into the URL
  // the browser is redirected to.
  it('degrades an unrecognised error shape to a generic code', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);
    const authRes = await request(app).get('/api/zoho/auth').set(authHeader(token));
    const state = new URL(authRes.body.url).searchParams.get('state')!;
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { error: 'boom&injected=1 <script>' } } as any);

    const res = await request(app).get('/api/zoho/callback').query({ code: 'abc', state });
    expect(res.headers.location).toBe('/settings?zoho_error=1');
  });

  // The refresh failure reaches the browser through /api/zoho/sync's error
  // body; it used to JSON.stringify Zoho's whole response, echoing the
  // client_id and the rest of the request back with it.
  it('reports a failed token refresh without echoing the raw Zoho response', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_refresh_token: 'rt', zoho_client_id: 'secret-client-id', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { error: 'invalid_code' } } as any);

    const res = await request(app).post('/api/zoho/sync').set(authHeader(token));
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('invalid_code');
    expect(res.body.error).not.toContain('secret-client-id');
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

  it('pages through every Zoho invoice instead of stopping at the first page', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_refresh_token: 'rt', zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);
    fakeSupabaseAdmin.seed('invoices', [
      { id: 'inv-p1', tenant_id: tenantId, zoho_invoice_id: 'z-page1', status: 'Draft' },
      { id: 'inv-p2', tenant_id: tenantId, zoho_invoice_id: 'z-page2', status: 'Draft' },
    ]);

    vi.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } } as any);
    vi.spyOn(axios, 'get').mockImplementation(async (url: string, config: any) => {
      if (!url.endsWith('/invoices')) return { data: {} } as any;
      return config.params.page === 1
        ? { data: { invoices: [{ invoice_id: 'z-page1', status: 'sent' }], page_context: { has_more_page: true } } } as any
        : { data: { invoices: [{ invoice_id: 'z-page2', status: 'overdue' }], page_context: { has_more_page: false } } } as any;
    });

    const res = await request(app).post('/api/zoho/sync').set(authHeader(token));
    expect(res.body.pulled).toBe(2);
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-p1')?.status).toBe('Sent');
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-p2')?.status).toBe('Overdue');
  });

  // contact_name_contains matched substrings, so an invoice for "Dupont" bound
  // itself to the existing, unrelated "Dupont-Martin".
  it('binds an invoice only to an exactly-matching Zoho contact', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_refresh_token: 'rt', zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-x', tenant_id: tenantId, description: 'Dupont', amount: 100, zoho_invoice_id: null }]);

    let createdContact = false;
    vi.spyOn(axios, 'post').mockImplementation(async (url: string, body: any) => {
      if (url.includes('/oauth/v2/token')) return { data: { access_token: 'tok', expires_in: 3600 } } as any;
      if (url.endsWith('/contacts')) {
        createdContact = true;
        expect(body.contact_name).toBe('Dupont');
        return { data: { contact: { contact_id: 'cust-new' } } } as any;
      }
      if (url.endsWith('/invoices')) {
        expect(body.customer_id).toBe('cust-new');
        return { data: { invoice: { invoice_id: 'zoho-x' } } } as any;
      }
      return { data: {} } as any;
    });
    vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      // Zoho answers the near-miss; it must not be adopted.
      if (url.endsWith('/contacts')) return { data: { contacts: [{ contact_id: 'cust-wrong', contact_name: 'Dupont-Martin' }] } } as any;
      return { data: { invoices: [] } } as any;
    });

    const res = await request(app).post('/api/zoho/sync').set(authHeader(token));
    expect(res.body.pushed).toBe(1);
    expect(createdContact).toBe(true);
  });

  // Swallowing the contact search error created a duplicate Zoho contact every
  // time Zoho hiccuped; the invoice should fail instead.
  it('does not create a duplicate contact when the contact lookup fails', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_refresh_token: 'rt', zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-y', tenant_id: tenantId, description: 'Client Y', amount: 100, zoho_invoice_id: null }]);

    let createdContact = false;
    vi.spyOn(axios, 'post').mockImplementation(async (url: string) => {
      if (url.includes('/oauth/v2/token')) return { data: { access_token: 'tok', expires_in: 3600 } } as any;
      if (url.endsWith('/contacts')) { createdContact = true; return { data: { contact: { contact_id: 'dup' } } } as any; }
      return { data: {} } as any;
    });
    vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/contacts')) throw new Error('Zoho unavailable');
      return { data: { invoices: [] } } as any;
    });

    const res = await request(app).post('/api/zoho/sync').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.pushed).toBe(0);
    expect(createdContact).toBe(false);
    expect(res.body.errors[0]).toContain('inv-y');
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-y')?.zoho_invoice_id).toBeNull();
  });

  // Zoho's limiter only reopens on a timer, so continuing would spend the rest
  // of the request on calls that are all going to be refused.
  it('stops on a Zoho rate limit and reports what is left', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_refresh_token: 'rt', zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org' }]);
    fakeSupabaseAdmin.seed('invoices', [
      { id: 'inv-a', tenant_id: tenantId, description: 'A', amount: 1, zoho_invoice_id: null },
      { id: 'inv-b', tenant_id: tenantId, description: 'B', amount: 2, zoho_invoice_id: null },
      { id: 'inv-c', tenant_id: tenantId, description: 'C', amount: 3, zoho_invoice_id: null },
    ]);

    let invoiceCalls = 0;
    vi.spyOn(axios, 'post').mockImplementation(async (url: string) => {
      if (url.includes('/oauth/v2/token')) return { data: { access_token: 'tok', expires_in: 3600 } } as any;
      if (url.endsWith('/contacts')) return { data: { contact: { contact_id: 'c' } } } as any;
      if (url.endsWith('/invoices')) {
        invoiceCalls++;
        if (invoiceCalls === 1) return { data: { invoice: { invoice_id: 'zoho-a' } } } as any;
        throw Object.assign(new Error('Too many requests'), { response: { status: 429, data: {} } });
      }
      return { data: {} } as any;
    });
    vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/contacts')) return { data: { contacts: [] } } as any;
      return { data: { invoices: [] } } as any;
    });

    const res = await request(app).post('/api/zoho/sync').set(authHeader(token));
    expect(res.body.pushed).toBe(1);
    // Stopped after the refusal rather than trying the third invoice.
    expect(invoiceCalls).toBe(2);
    expect(res.body.remaining).toBe(2);
    expect(res.body.errors.join(' ')).toContain('Limite de requêtes Zoho');
  });
});

describe('Zoho Books', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('reports connected/has_credentials from settings (books org id or shared org id)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_books_org_id: 'books-org', zoho_books_refresh_token: 'rt' }]);

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

  it('returns the consent URL with a one-time state nonce, then completes the callback with no auth header', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_data_center: 'com' }]);

    const authRes = await request(app).get('/api/zoho-books/auth').set(authHeader(token));
    expect(authRes.status).toBe(200);
    const state = new URL(authRes.body.url).searchParams.get('state');
    expect(state).toBeTruthy();
    expect(state).not.toBe(tenantId);

    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ refresh_token: 'books-refresh-token' }) })) as any;

    const res = await request(app).get('/api/zoho-books/callback').query({ code: 'abc', state: state! });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?zoho_books_connected=1');
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.zoho_books_refresh_token).toBe('books-refresh-token');
  });

  it('rejects a Zoho Books callback with an unknown state', async () => {
    const res = await request(app).get('/api/zoho-books/callback').query({ code: 'abc', state: 'not-a-real-nonce' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?zoho_books_error=expired_state');
  });

  // Books redirects to its own path. Advertising Zoho Invoice's URL (what the
  // Paramètres page used to show) sends the admin to register the wrong
  // "Authorized Redirect URI", and Zoho then refuses the consent request.
  it('advertises a callback URL distinct from Zoho Invoice\'s', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const books = await request(app).get('/api/zoho-books/callback-url').set(authHeader(token));
    const invoice = await request(app).get('/api/zoho/callback-url').set(authHeader(token));

    expect(books.status).toBe(200);
    expect(books.body.url).toMatch(/\/api\/zoho-books\/callback$/);
    expect(books.body.url).not.toBe(invoice.body.url);
  });

  // The two integrations request different scopes, so their refresh tokens are
  // not interchangeable. They used to share one column, which meant connecting
  // either one silently broke the other.
  it('keeps its refresh token separate from Zoho Invoice\'s', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_org_id: 'org', zoho_refresh_token: 'invoice-rt' }]);

    // Zoho Invoice connected, Zoho Books not — Books must not claim otherwise.
    const before = await request(app).get('/api/zoho-books/status').set(authHeader(token));
    expect(before.body.connected).toBe(false);

    const authRes = await request(app).get('/api/zoho-books/auth').set(authHeader(token));
    const state = new URL(authRes.body.url).searchParams.get('state');
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ refresh_token: 'books-rt' }) })) as any;
    await request(app).get('/api/zoho-books/callback').query({ code: 'abc', state: state! });

    const settings = fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId);
    expect(settings?.zoho_books_refresh_token).toBe('books-rt');
    expect(settings?.zoho_refresh_token).toBe('invoice-rt');

    // ...and disconnecting Books leaves Zoho Invoice connected.
    await request(app).delete('/api/zoho-books/disconnect').set(authHeader(token));
    const after = fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId);
    expect(after?.zoho_books_refresh_token).toBeNull();
    expect(after?.zoho_refresh_token).toBe('invoice-rt');
  });

  // Zoho answers 200 with an { error } body rather than an HTTP error status,
  // so the old `!refresh_token` check turned every distinct cause into the same
  // unactionable "zoho_books_error=1".
  it('forwards Zoho\'s error code when the token exchange is refused', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec' }]);

    const authRes = await request(app).get('/api/zoho-books/auth').set(authHeader(token));
    const state = new URL(authRes.body.url).searchParams.get('state');
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ error: 'invalid_client' }) })) as any;

    const res = await request(app).get('/api/zoho-books/callback').query({ code: 'abc', state: state! });
    expect(res.headers.location).toBe('/settings?zoho_books_error=invalid_client');
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.zoho_books_refresh_token).toBeUndefined();
  });

  // An upstream message must not be able to inject arbitrary text into the URL
  // the browser is redirected to.
  it('degrades an unrecognised error shape to a generic code', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_client_id: 'cid', zoho_client_secret: 'sec' }]);

    const authRes = await request(app).get('/api/zoho-books/auth').set(authHeader(token));
    const state = new URL(authRes.body.url).searchParams.get('state');
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ error: 'boom&injected=1 <script>' }) })) as any;

    const res = await request(app).get('/api/zoho-books/callback').query({ code: 'abc', state: state! });
    expect(res.headers.location).toBe('/settings?zoho_books_error=1');
  });

  it('disconnects, clearing the refresh token', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_books_refresh_token: 'rt' }]);

    const res = await request(app).delete('/api/zoho-books/disconnect').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.zoho_books_refresh_token).toBeNull();
  });

  it('pushes an unsynced invoice and pulls a status update, tenant-scoped', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_books_refresh_token: 'rt', zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_books_org_id: 'org' }]);
    fakeSupabaseAdmin.seed('invoices', [
      { id: 'inv-new-b', tenant_id: tenantId, invoice_number: 'FAC-001', issue_date: '2026-03-04T00:00:00Z', amount: 3000, zoho_invoice_id: null },
      { id: 'inv-synced-b', tenant_id: tenantId, zoho_invoice_id: 'zoho-b-existing', status: 'Draft' },
    ]);

    let pushBody: any = null;
    global.fetch = vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes('/oauth/v2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) } as any;
      if (u.includes('status=all')) return { ok: true, json: async () => ({ invoices: [{ invoice_id: 'zoho-b-existing', status: 'paid' }] }) } as any;
      if (u.includes('/invoices')) {
        pushBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ invoice: { invoice_id: 'zoho-b-new' } }) } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    }) as any;

    const res = await request(app).post('/api/zoho-books/sync').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.pushed).toBe(1);
    expect(res.body.pulled).toBe(1);
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-new-b')?.zoho_invoice_id).toBe('zoho-b-new');
    // Capitalized: 'paid' (what this used to write) is not one of the values
    // invoices.status is allowed to hold, so the app couldn't render it.
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-synced-b')?.status).toBe('Paid');
    // The push payload reads the real columns — it used to read client_name /
    // number / date, none of which exist, so every invoice went across as
    // "Client" with its UUID for a number and today's date.
    expect(pushBody.invoice_number).toBe('FAC-001');
    expect(pushBody.date).toBe('2026-03-04');
    expect(pushBody.line_items[0].rate).toBe(3000);
  });

  it('pages through every Zoho Books invoice instead of stopping at the first page', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, zoho_books_refresh_token: 'rt', zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_books_org_id: 'org' }]);
    fakeSupabaseAdmin.seed('invoices', [
      { id: 'inv-bp1', tenant_id: tenantId, zoho_invoice_id: 'zb-page1', status: 'Draft' },
      { id: 'inv-bp2', tenant_id: tenantId, zoho_invoice_id: 'zb-page2', status: 'Draft' },
    ]);

    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/oauth/v2/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) } as any;
      if (u.includes('page=1')) return { ok: true, json: async () => ({ invoices: [{ invoice_id: 'zb-page1', status: 'sent' }], page_context: { has_more_page: true } }) } as any;
      if (u.includes('page=2')) return { ok: true, json: async () => ({ invoices: [{ invoice_id: 'zb-page2', status: 'paid' }], page_context: { has_more_page: false } }) } as any;
      return { ok: true, json: async () => ({}) } as any;
    }) as any;

    const res = await request(app).post('/api/zoho-books/sync').set(authHeader(token));
    expect(res.body.pulled).toBe(2);
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-bp2')?.status).toBe('Paid');
  });

  it('never syncs another tenant\'s invoices', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-victim', tenant_id: tenantB, client_name: 'Victim', amount: 1, zoho_invoice_id: null }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantA, zoho_books_refresh_token: 'rt', zoho_client_id: 'cid', zoho_client_secret: 'sec', zoho_books_org_id: 'org' }]);

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
