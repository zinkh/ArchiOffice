// Coordinates invoice numbering with whichever accounting connector a
// tenant has designated as authoritative (settings.accounting_sync_provider)
// — Zoho Invoice, Zoho Books, or Odoo today, any future plugin tomorrow.
//
// The problem this closes: getNextDocNumber.ts assigns a local sequential
// number to every invoice at creation, but a tenant syncing with an
// accounting product needs THAT product's number to be the legal one —
// assigning a local number first and then pushing (as /api/zoho/sync used
// to, `if (inv.invoice_number) payload.invoice_number = inv.invoice_number`)
// either fights the connector's own sequence or silently keeps two
// "official" numbers for the same document. When a provider is active, the
// invoice is created as a numberless Draft and this module fills
// invoice_number in once the connector confirms it — never before.
import { pushInvoiceToZohoInvoice } from './routes/zohoInvoice';
import { pushInvoiceToZohoBooks } from './routes/zohoBooks';
import { pushInvoiceToOdoo } from './routes/odoo';

export type AccountingProvider = 'none' | 'zoho_invoice' | 'zoho_books' | 'odoo';

const CONNECTION_COLUMN: Record<Exclude<AccountingProvider, 'none'>, string> = {
  zoho_invoice: 'zoho_refresh_token',
  zoho_books: 'zoho_books_refresh_token',
  odoo: 'odoo_api_key',
};

/**
 * The tenant's numbering authority — 'none' unless BOTH a provider is chosen
 * in settings AND that provider is actually connected. A provider selected
 * in the UI but since disconnected (token revoked, credentials cleared)
 * must not leave every new invoice stuck numberless; falling back to local
 * numbering keeps invoicing usable while the admin reconnects.
 */
export async function getActiveAccountingProvider(supabaseAdmin: any, tenantId: string): Promise<AccountingProvider> {
  const { data } = await supabaseAdmin.from('settings')
    .select('accounting_sync_provider, zoho_refresh_token, zoho_books_refresh_token, odoo_api_key')
    .eq('tenant_id', tenantId).maybeSingle();
  const s = data as any;
  const provider = (s?.accounting_sync_provider || 'none') as AccountingProvider;
  if (provider === 'none') return 'none';
  return s?.[CONNECTION_COLUMN[provider]] ? provider : 'none';
}

/**
 * Idempotent: `.upsert(..., { onConflict: 'local_invoice_id,provider' })`
 * returns the SAME row (same idempotency_key) on every call for a given
 * invoice+provider pair instead of creating a second sync record — the
 * database-level half of task 3 (idempotent creation), the other half being
 * each provider's own reference_number/ref search-before-create above.
 */
export async function getOrCreateSyncRecord(supabaseAdmin: any, tenantId: string, localInvoiceId: string, provider: AccountingProvider) {
  const { data, error } = await supabaseAdmin.from('invoice_accounting_sync').upsert({
    id: `${localInvoiceId}:${provider}`,
    tenant_id: tenantId,
    local_invoice_id: localInvoiceId,
    provider,
    sync_status: 'pending',
    idempotency_key: localInvoiceId,
  }, { onConflict: 'local_invoice_id,provider', ignoreDuplicates: true }).select().single();
  if (error) throw error;
  return data;
}

async function dispatchPush(supabaseAdmin: any, tenantId: string, provider: AccountingProvider, invoice: any, idempotencyKey: string) {
  if (provider === 'zoho_invoice') return pushInvoiceToZohoInvoice(supabaseAdmin, tenantId, invoice, idempotencyKey);
  if (provider === 'zoho_books') return pushInvoiceToZohoBooks(supabaseAdmin, tenantId, invoice, idempotencyKey);
  if (provider === 'odoo') return pushInvoiceToOdoo(supabaseAdmin, tenantId, invoice, idempotencyKey);
  throw new Error(`Fournisseur comptable inconnu: ${provider}`);
}

/**
 * Best-effort push + settle, mirroring the "l'écriture est déjà faite, la
 * remontée est en best effort" pattern used elsewhere (see
 * server/articlePrices.ts): the invoice row already exists locally with
 * sync_status='pending' before this runs, so a connector outage here never
 * loses the invoice — it just leaves it numberless until a retry succeeds
 * (see POST /api/invoices/:id/sync-retry in server/routes/invoices.ts).
 */
export async function syncInvoiceToAccounting(supabaseAdmin: any, tenantId: string, invoiceId: string, provider: AccountingProvider, invoice: any) {
  const record = await getOrCreateSyncRecord(supabaseAdmin, tenantId, invoiceId, provider);
  try {
    const result = await dispatchPush(supabaseAdmin, tenantId, provider, invoice, record.idempotency_key);
    const now = new Date().toISOString();
    await supabaseAdmin.from('invoice_accounting_sync').update({
      external_invoice_id: result.external_id, invoice_number: result.invoice_number,
      sync_status: 'synced', last_synced_at: now, last_error: null, updated_at: now,
    }).eq('id', record.id).eq('tenant_id', tenantId);
    // Built without an `undefined` key for the id column the OTHER providers
    // don't use — a real supabase-js .update() would drop that key on
    // JSON.stringify anyway, but this fake test double assigns it verbatim
    // and would otherwise wipe out whichever of zoho_invoice_id/odoo_id the
    // row already had.
    const invoiceUpdate: Record<string, unknown> = { invoice_number: result.invoice_number, status: result.status };
    if (provider === 'odoo') invoiceUpdate.odoo_id = Number(result.external_id);
    else invoiceUpdate.zoho_invoice_id = result.external_id;
    await supabaseAdmin.from('invoices').update(invoiceUpdate).eq('id', invoiceId).eq('tenant_id', tenantId);
    return { ok: true as const, ...result };
  } catch (err: any) {
    await supabaseAdmin.from('invoice_accounting_sync').update({
      sync_status: 'error', last_error: err.message, updated_at: new Date().toISOString(),
    }).eq('id', record.id).eq('tenant_id', tenantId);
    return { ok: false as const, error: err.message };
  }
}
