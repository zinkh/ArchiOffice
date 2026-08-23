// Shared by the Zoho Invoice and Zoho Books sync routes (server/routes/
// zohoInvoice.ts, zohoBooks.ts). Both write the SAME `invoices` rows, so the
// pieces that decide what lands in the database — the status vocabulary and the
// invoice→Zoho payload mapping — have to live in one place. They didn't: Books
// mapped Zoho statuses to lowercase ('paid', 'sent', ...) while Invoice mapped
// them to the capitalized values the app actually uses, so whichever
// integration synced last decided whether `invoices.status` was readable.

/** The only values `invoices.status` is allowed to hold — see Invoice in src/types.ts. */
export type InvoiceStatus = 'Draft' | 'Sent' | 'Paid' | 'Overdue';

// Zoho's own invoice statuses, across both products. Anything unmapped (and
// Zoho adds statuses over time) returns null, which callers treat as "leave the
// local status alone" rather than guessing.
const ZOHO_STATUS: Record<string, InvoiceStatus> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Sent',
  paid: 'Paid',
  paidthroughretainer: 'Paid',
  overdue: 'Overdue',
  partially_paid: 'Sent',
  unpaid: 'Sent',
  // A voided invoice is not a paid one; 'Draft' keeps it out of the receivables
  // figures without inventing a status the app can't render.
  void: 'Draft',
};

export function mapZohoStatus(zohoStatus: string | undefined): InvoiceStatus | null {
  if (!zohoStatus) return null;
  const key = String(zohoStatus).toLowerCase();
  // hasOwn, not a bare lookup: a Zoho status of "constructor" or "toString"
  // would otherwise resolve against Object.prototype and pass the null check.
  return Object.prototype.hasOwnProperty.call(ZOHO_STATUS, key) ? ZOHO_STATUS[key] : null;
}

// Zoho's APIs have no timeout of their own, and neither does Node's fetch. An
// unbounded call here holds the whole sync request open past the client's
// deadline, which is what a stalled "Synchroniser" looks like to the user.
export const ZOHO_TIMEOUT_MS = 15_000;

// A sync runs inside one HTTP request the browser is waiting on, and each push
// costs 1-3 Zoho calls. Cap the work per run so a large backlog drains over
// several syncs instead of blowing the client's deadline; each pushed invoice
// is persisted as it goes, so the next run resumes where this one stopped.
export const ZOHO_MAX_PUSH_PER_RUN = 40;

// Zoho paginates at 200/page. The cap keeps a runaway/looping page_context from
// spinning forever — 25 pages is 5 000 invoices, well past any real tenant.
export const ZOHO_PAGE_SIZE = 200;
export const ZOHO_MAX_PULL_PAGES = 25;

/** Zoho wants plain YYYY-MM-DD; our columns hold either that or a full ISO timestamp. */
export function zohoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  return value.split('T')[0];
}

/**
 * Line items for a Zoho invoice payload, from our own invoice row. Falls back
 * to a single line carrying the invoice total when the row has no itemised
 * breakdown.
 */
export function zohoLineItems(inv: any): any[] {
  const items = Array.isArray(inv?.items) ? inv.items : [];
  if (items.length) {
    return items.map((item: any) => ({
      name: item.description || 'Honoraires',
      description: item.description || '',
      quantity: item.quantity || 1,
      rate: item.unit_price ?? item.amount ?? 0,
      tax_percentage: item.vat_rate || 0,
    }));
  }
  return [{
    name: inv?.description || 'Honoraires',
    description: inv?.description || '',
    quantity: 1,
    rate: inv?.amount || 0,
    tax_percentage: inv?.vat_rate || 0,
  }];
}

/**
 * Local invoices for a batch of Zoho ids, keyed by zoho_invoice_id.
 *
 * The pull loops used to run one tenant-scoped query per invoice returned by
 * Zoho — 200 serial round trips for a single page, each with a `.single()` that
 * raised PGRST116 for every Zoho invoice with no local counterpart (the common
 * case). One `.in(...)` replaces the lot.
 */
export async function localInvoicesByZohoId(
  supabaseAdmin: any,
  tenantId: string,
  zohoIds: string[],
): Promise<Map<string, { id: string; status: string }>> {
  const byZohoId = new Map<string, { id: string; status: string }>();
  const ids = zohoIds.filter(Boolean);
  if (!ids.length) return byZohoId;

  // Chunked: a very large `.in(...)` list can outgrow PostgREST's URL limit.
  for (let i = 0; i < ids.length; i += ZOHO_PAGE_SIZE) {
    const { data } = await supabaseAdmin
      .from('invoices')
      .select('id, status, zoho_invoice_id')
      .eq('tenant_id', tenantId)
      .in('zoho_invoice_id', ids.slice(i, i + ZOHO_PAGE_SIZE));
    for (const row of (data || [])) {
      if (row?.zoho_invoice_id) byZohoId.set(row.zoho_invoice_id, { id: row.id, status: row.status });
    }
  }
  return byZohoId;
}

/**
 * True when Zoho is rate-limiting us. Zoho's per-minute cap is easy to hit on a
 * first sync of a large backlog; the callers stop the run and report what's
 * left rather than hammering a limiter that only opens on a timer anyway.
 */
export function isRateLimited(status: number | undefined, body?: any): boolean {
  return status === 429 || body?.code === 1301;
}
