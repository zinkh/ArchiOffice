// Covers the two invoicing reliability fixes: (1) a tenant with an active
// accounting connector (Zoho Invoice/Books, Odoo) never gets a locally
// generated invoice_number — the connector's own number is the only legal
// one, and (2) a client-supplied project_id is rejected when it belongs to
// another tenant (server/assertTenantEntity.ts).
//
// The three connector push functions (pushInvoiceToZohoInvoice/Books/Odoo)
// make real outbound HTTP calls, which this sandbox can't exercise — they're
// mocked here so the tests stay fast and offline while still exercising the
// real numbering/locking/idempotency logic in server/invoiceAccountingSync.ts
// and server/routes/invoices.ts around them.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

const pushInvoiceToZohoInvoice = vi.fn();
vi.mock('../server/routes/zohoInvoice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/routes/zohoInvoice')>();
  return { ...actual, pushInvoiceToZohoInvoice: (...args: any[]) => pushInvoiceToZohoInvoice(...args) };
});

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

beforeEach(() => {
  pushInvoiceToZohoInvoice.mockClear();
});

function activateZohoInvoice(tenantId: string) {
  fakeSupabaseAdmin.seed('settings', [{
    tenant_id: tenantId, accounting_sync_provider: 'zoho_invoice', zoho_refresh_token: 'encrypted-token-stub',
  }]);
}

describe('Invoice numbering with an active accounting connector', () => {
  it('never assigns a local invoice_number once Zoho Invoice is the numbering authority, even on success', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    activateZohoInvoice(tenantId);
    pushInvoiceToZohoInvoice.mockResolvedValueOnce({ external_id: 'zoho-1', invoice_number: 'ZINV-2026-0001', status: 'Draft' });

    const res = await request(app).post('/api/invoices').set(authHeader(token)).send({ amount: 1000 });

    expect(res.status).toBe(201);
    // The connector's number, never a locally generated FAC-xxxx one.
    expect(res.body.invoice_number).toBe('ZINV-2026-0001');
    expect(res.body.zoho_invoice_id).toBe('zoho-1');
    expect(res.body.accounting_sync).toMatchObject({ provider: 'zoho_invoice', ok: true });
    const syncRows = fakeSupabaseAdmin.getTable('invoice_accounting_sync').filter(r => r.local_invoice_id === res.body.id);
    expect(syncRows).toHaveLength(1);
    expect(syncRows[0].sync_status).toBe('synced');
  });

  it('ignores a client-supplied invoice_number when a connector is active — the connector decides, not the client', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    activateZohoInvoice(tenantId);
    pushInvoiceToZohoInvoice.mockResolvedValueOnce({ external_id: 'zoho-2', invoice_number: 'ZINV-2026-0002', status: 'Draft' });

    const res = await request(app).post('/api/invoices').set(authHeader(token)).send({ amount: 500, invoice_number: 'FAC-CLIENT-SUPPLIED' });

    expect(res.status).toBe(201);
    expect(res.body.invoice_number).toBe('ZINV-2026-0002');
    expect(res.body.invoice_number).not.toBe('FAC-CLIENT-SUPPLIED');
  });

  it('leaves the invoice numberless (never fabricates a number) when the connector push fails, and records the error', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    activateZohoInvoice(tenantId);
    pushInvoiceToZohoInvoice.mockRejectedValueOnce(new Error('Zoho indisponible'));

    const res = await request(app).post('/api/invoices').set(authHeader(token)).send({ amount: 750 });

    expect(res.status).toBe(201);
    expect(res.body.invoice_number).toBeNull();
    expect(res.body.status).toBe('Draft');
    expect(res.body.accounting_sync).toMatchObject({ provider: 'zoho_invoice', ok: false, error: 'Zoho indisponible' });
    const syncRow = fakeSupabaseAdmin.getTable('invoice_accounting_sync').find(r => r.local_invoice_id === res.body.id);
    expect(syncRow?.sync_status).toBe('error');
  });

  it('retrying a failed sync is idempotent: only one sync record ever exists per invoice+provider', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    activateZohoInvoice(tenantId);
    pushInvoiceToZohoInvoice.mockRejectedValueOnce(new Error('Timeout'));

    const created = await request(app).post('/api/invoices').set(authHeader(token)).send({ amount: 300 });
    expect(created.body.invoice_number).toBeNull();

    pushInvoiceToZohoInvoice.mockResolvedValueOnce({ external_id: 'zoho-3', invoice_number: 'ZINV-2026-0003', status: 'Draft' });
    const retried = await request(app).post(`/api/invoices/${created.body.id}/sync-retry`).set(authHeader(token));

    expect(retried.status).toBe(200);
    expect(retried.body.ok).toBe(true);
    const syncRows = fakeSupabaseAdmin.getTable('invoice_accounting_sync').filter(r => r.local_invoice_id === created.body.id);
    expect(syncRows).toHaveLength(1); // upsert reused the same row, never a second one
    expect(syncRows[0].sync_status).toBe('synced');

    const refreshed = await request(app).get('/api/invoices').set(authHeader(token));
    expect(refreshed.body.find((i: any) => i.id === created.body.id)?.invoice_number).toBe('ZINV-2026-0003');
  });

  it('falls back to local numbering when the tenant chose a provider but it is no longer connected', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    // accounting_sync_provider is set, but the refresh token was revoked —
    // getActiveAccountingProvider must not leave invoices numberless forever.
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, accounting_sync_provider: 'zoho_invoice', zoho_refresh_token: null, num_prefix_facture: 'FAC' }]);

    const res = await request(app).post('/api/invoices').set(authHeader(token)).send({ amount: 200 });

    expect(res.status).toBe(201);
    expect(res.body.invoice_number).toMatch(/^FAC-\d{4}-\d{3}$/);
    expect(pushInvoiceToZohoInvoice).not.toHaveBeenCalled();
  });

  it('locks invoice_number and legal fields once the connector has confirmed the invoice, even while status is still Draft', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-synced', tenant_id: tenantId, status: 'Draft', invoice_number: 'ZINV-2026-0009', amount: 900 }]);
    fakeSupabaseAdmin.seed('invoice_accounting_sync', [{ id: 'inv-synced:zoho_invoice', tenant_id: tenantId, local_invoice_id: 'inv-synced', provider: 'zoho_invoice', sync_status: 'synced', idempotency_key: 'inv-synced' }]);

    const res = await request(app).put('/api/invoices/inv-synced').set(authHeader(token)).send({ invoice_number: 'FAC-HACKED-0001' });

    expect(res.status).toBe(409);
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-synced')?.invoice_number).toBe('ZINV-2026-0009');
  });
});

describe('Cross-tenant project_id reference on invoices', () => {
  it('rejects creating an invoice against another tenant\'s project_id', async () => {
    const otherTenant = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-other', tenant_id: otherTenant, name: 'Projet confidentiel' }]);
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/invoices').set(authHeader(token)).send({ amount: 100, project_id: 'proj-other' });

    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('invoices').some(i => i.project_id === 'proj-other' && i.tenant_id === tenantId)).toBe(false);
  });

  it('rejects re-attaching an invoice to another tenant\'s project_id on update', async () => {
    const otherTenant = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-other-2', tenant_id: otherTenant, name: 'Autre projet' }]);
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-reparent', tenant_id: tenantId, status: 'Draft', amount: 50 }]);

    const res = await request(app).put('/api/invoices/inv-reparent').set(authHeader(token)).send({ project_id: 'proj-other-2' });

    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-reparent')?.project_id).not.toBe('proj-other-2');
  });
});
