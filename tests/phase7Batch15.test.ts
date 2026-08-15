// Phase 7 batch 15: end-to-end Supertest coverage for the domains extracted
// into server/routes/{ragic,odoo}.ts — confirms the extraction didn't
// change behavior. Both are API-key-based integrations (no OAuth browser
// redirect), spied via axios like zohoInvoice.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import axios from 'axios';
import dns from 'dns/promises';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Ragic', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports connected from settings', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, ragic_api_key: 'key', ragic_account: 'acct' }]);

    const res = await request(app).get('/api/ragic/status').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });

  it('disconnects, clearing all ragic_* settings', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, ragic_api_key: 'key', ragic_account: 'acct', ragic_sheet_contacts: 'sheet1' }]);

    const res = await request(app).delete('/api/ragic/disconnect').set(authHeader(token));
    expect(res.status).toBe(200);
    const settings = fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId);
    expect(settings?.ragic_api_key).toBeNull();
    expect(settings?.ragic_sheet_contacts).toBeNull();
  });

  it('requires configuration before syncing', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId }]);

    const res = await request(app).post('/api/ragic/sync').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('pushes an unsynced contact and pulls a new one from Ragic, tenant-scoped', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, ragic_api_key: 'key', ragic_account: 'acct', ragic_sheet_contacts: 'contacts-sheet' }]);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'c1', tenant_id: tenantId, first_name: 'Jean', last_name: 'Dupont', ragic_id: null }]);

    vi.spyOn(axios, 'post').mockResolvedValue({ data: { 42: {} } } as any); // new Ragic record id 42
    vi.spyOn(axios, 'get').mockResolvedValue({ data: { 7: { first_name: 'Marie', last_name: 'Curie', email: 'marie@example.test' } } } as any);

    const res = await request(app).post('/api/ragic/sync').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.results.contacts.pushed).toBe(1);
    expect(res.body.results.contacts.pulled).toBe(1);
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'c1')?.ragic_id).toBe('42');
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.ragic_id === '7' && c.tenant_id === tenantId)?.first_name).toBe('Marie');
  });

  it('accepts a webhook call with no auth header and the correct secret', async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, ragic_api_key: 'the-secret' }]);

    const res = await request(app)
      .post('/api/ragic/webhook')
      .query({ entity: 'contacts', tenant: tenantId, secret: 'the-secret' })
      .send({ _ragicId: '99', first_name: 'Nouveau', last_name: 'Contact' });
    expect(res.status).toBe(200);
    expect(res.body.upserted).toBe(1);
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.ragic_id === '99')?.tenant_id).toBe(tenantId);
  });

  it('rejects a webhook call with the wrong secret', async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, ragic_api_key: 'the-real-secret' }]);

    const res = await request(app)
      .post('/api/ragic/webhook')
      .query({ entity: 'contacts', tenant: tenantId, secret: 'wrong' })
      .send({ _ragicId: '1', first_name: 'X' });
    expect(res.status).toBe(403);
  });

  it('rejects a webhook call with no secret at all, even though the tenant is configured', async () => {
    // Security fix: the check used to be `if (secret && secret !== apiKey)`,
    // so omitting `secret` entirely skipped validation outright — anyone who
    // guessed a tenant id could upsert contacts/projects/invoices/proposals.
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, ragic_api_key: 'the-real-secret' }]);

    const res = await request(app)
      .post('/api/ragic/webhook')
      .query({ entity: 'contacts', tenant: tenantId })
      .send({ _ragicId: '1', first_name: 'X' });
    expect(res.status).toBe(403);
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.ragic_id === '1')).toBeUndefined();
  });
});

describe('Odoo', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports connected from settings', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, odoo_url: 'https://odoo.example.test', odoo_api_key: 'key' }]);

    const res = await request(app).get('/api/odoo/status').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });

  it('disconnects, clearing odoo settings', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, odoo_url: 'x', odoo_db: 'd', odoo_username: 'u', odoo_api_key: 'k' }]);

    const res = await request(app).delete('/api/odoo/disconnect').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.odoo_url).toBeNull();
  });

  it('requires full configuration before syncing or testing', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, odoo_url: 'https://odoo.example.test' }]);

    const sync = await request(app).post('/api/odoo/sync').set(authHeader(token));
    expect(sync.status).toBe(400);

    const test = await request(app).post('/api/odoo/test').set(authHeader(token));
    expect(test.status).toBe(400);
  });

  it('reports connectivity and the company name on a successful test', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, odoo_url: 'https://odoo.example.test', odoo_db: 'db', odoo_username: 'user', odoo_api_key: 'key' }]);

    vi.spyOn(axios, 'post').mockResolvedValue({ data: { result: [{ name: 'Cabinet ArchiTest' }] } } as any);

    const res = await request(app).post('/api/odoo/test').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, company: 'Cabinet ArchiTest' });
  });

  it('pushes an unsynced contact and pulls a new one from Odoo, tenant-scoped', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, odoo_url: 'https://odoo.example.test', odoo_db: 'db', odoo_username: 'user', odoo_api_key: 'key' }]);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'c1', tenant_id: tenantId, first_name: 'Jean', last_name: 'Dupont', odoo_id: null }]);

    // /api/odoo/sync validates odoo_url through the SSRF guard, which resolves
    // the host; the sandbox has no DNS, so stub the lookup to a public address.
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

    vi.spyOn(axios, 'post').mockImplementation(async (_url: string, body: any) => {
      const { model, method } = body.params;
      if (model === 'res.partner' && method === 'create') return { data: { result: 55 } } as any;
      if (model === 'res.partner' && method === 'search_read') return { data: { result: [{ id: 10, name: 'Marie Curie', email: 'marie@example.test' }] } } as any;
      // Other models (projects/invoices/proposals) have nothing to push/pull in this test.
      if (method === 'search_read') return { data: { result: [] } } as any;
      return { data: { result: true } } as any;
    });

    const res = await request(app).post('/api/odoo/sync').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.results.contacts.pushed).toBe(1);
    expect(res.body.results.contacts.pulled).toBe(1);
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'c1' && c.tenant_id === tenantId)?.odoo_id).toBe(55);
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.odoo_id === 10 && c.tenant_id === tenantId)?.first_name).toBe('Marie');
  });
});
