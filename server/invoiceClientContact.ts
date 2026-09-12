// Shared by the invoices CRUD route (server/routes/invoices.ts) and the
// three accounting connectors (zohoInvoice.ts, zohoBooks.ts, odoo.ts): the
// Maître d'Ouvrage a facture is billed to. A French invoice must carry the
// buyer's legal identity (name, SIRET, address) alongside the seller's
// (already covered by invoices.seller_* — see supabase/schema.sql) —
// invoices.client_id (supabase/migrate_invoice_client_link.sql) is the FK
// that makes that possible, resolved here from either the invoice itself or
// its project, since a general invoice (no project_id) still needs a buyer.
import { CONTACT_CATEGORY_CLIENT } from '../src/lib/contactCategories';

export interface ClientContactInfo {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  country?: string | null;
  siret?: string | null;
  vat_number?: string | null;
}

function contactDisplayName(c: any): string {
  return (c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || '').trim();
}

function toClientInfo(c: any): ClientContactInfo {
  return {
    name: contactDisplayName(c) || 'Client',
    email: c.email || c.email_work || null,
    phone: c.phone || c.phone_main || c.phone_work || c.phone_mobile || null,
    address: c.address || c.address_work_street || null,
    city: c.city || c.address_work_city || null,
    zip: c.zip || c.address_work_zip || null,
    country: c.country || c.address_work_country || null,
    siret: c.siret || null,
    vat_number: c.vat_number || null,
  };
}

/**
 * The contact id an invoice's buyer should resolve to: its own client_id if
 * set, else its project's client_id (a general/imported invoice with
 * neither has no buyer to resolve). Read-only — never writes client_id back;
 * callers that create/update the invoice row decide that themselves.
 */
export async function resolveInvoiceClientId(
  supabaseAdmin: any,
  tenantId: string,
  invoice: { client_id?: string | null; project_id?: string | null },
): Promise<string | null> {
  if (invoice.client_id) return invoice.client_id;
  if (!invoice.project_id) return null;
  const { data: proj } = await supabaseAdmin.from('projects').select('client_id')
    .eq('id', invoice.project_id).eq('tenant_id', tenantId).maybeSingle();
  return (proj as any)?.client_id || null;
}

/** Full contact row + normalized display fields, for GET /api/invoices/:id. */
export async function loadInvoiceClientContact(
  supabaseAdmin: any,
  tenantId: string,
  invoice: { client_id?: string | null; project_id?: string | null },
): Promise<ClientContactInfo | null> {
  const clientId = await resolveInvoiceClientId(supabaseAdmin, tenantId, invoice);
  if (!clientId) return null;
  const { data: contact } = await supabaseAdmin.from('contacts').select('*')
    .eq('id', clientId).eq('tenant_id', tenantId).maybeSingle();
  return contact ? toClientInfo(contact) : null;
}

/**
 * Match-or-create a local contact from a connector's own customer record
 * (Zoho, Odoo, ...) — used on PULL, when an invoice imported from a
 * connector references a customer ArchiOffice has never seen. Matches by
 * email first (most reliable across systems), then by exact display name,
 * so re-pulling the same customer twice never creates a duplicate contact.
 * Odoo is the exception: its own contact sync (server/routes/odoo.ts)
 * already pulls every res.partner into `contacts` with its own matching by
 * odoo_id, so this is only reached by Zoho Invoice/Books.
 */
export async function resolveOrCreateContactFromExternal(
  supabaseAdmin: any,
  tenantId: string,
  info: Partial<ClientContactInfo>,
): Promise<string | null> {
  const name = (info.name || '').trim();
  const email = (info.email || '').trim();
  if (!name && !email) return null;

  if (email) {
    const { data } = await supabaseAdmin.from('contacts').select('id')
      .eq('tenant_id', tenantId).eq('email', email).maybeSingle();
    if ((data as any)?.id) return (data as any).id;
  }
  if (name) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('id, company_name, first_name, last_name').eq('tenant_id', tenantId);
    const match = (data || []).find((c: any) => contactDisplayName(c).toLowerCase() === name.toLowerCase());
    if (match) return (match as any).id;
  }

  const id = crypto.randomUUID();
  // company_name AND last_name both carry the name: contactDisplayName()
  // prefers company_name (the common case, a Zoho/Odoo "customer" is
  // usually a company), but an individual MOA still displays correctly
  // through the first_name/last_name fallback either way.
  const { error } = await supabaseAdmin.from('contacts').insert({
    id, tenant_id: tenantId,
    first_name: '', last_name: name || email,
    company_name: name || '',
    email: email || null, phone: info.phone || null,
    address: info.address || null, city: info.city || null,
    zip: info.zip || null, country: info.country || null,
    siret: info.siret || null, vat_number: info.vat_number || null,
    category: CONTACT_CATEGORY_CLIENT, created_at: new Date().toISOString(),
  });
  if (error) throw error;
  return id;
}
