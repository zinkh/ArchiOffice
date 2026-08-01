// Phase 7 of the engineering-maturity plan: the root cause behind the
// cross-tenant leaks fixed in Phase 2 was that tenant scoping is manual —
// every single `supabaseAdmin.from(table)...` call has to remember to chain
// `.eq('tenant_id', tenantId)` itself, and `supabaseAdmin` (service-role key)
// bypasses RLS entirely, so a forgotten filter isn't caught by anything.
// This wraps that pattern so the filter can't be forgotten for select/
// update/delete, and is applied automatically to insert payloads — used by
// newly-extracted route modules (see server/routes/*) as they're carved out
// of server.ts. Existing inline routes in server.ts are untouched; this is
// additive, not a retrofit of the whole file.
export interface TenantScopedTable {
  select: (columns?: string) => any;
  update: (payload: Record<string, unknown>) => any;
  delete: () => any;
  insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => any;
}

export function tenantScopedFrom(supabaseAdmin: any, tenantId: string, table: string): TenantScopedTable {
  return {
    select: (columns?: string) => supabaseAdmin.from(table).select(columns).eq('tenant_id', tenantId),
    update: (payload: Record<string, unknown>) => supabaseAdmin.from(table).update(payload).eq('tenant_id', tenantId),
    delete: () => supabaseAdmin.from(table).delete().eq('tenant_id', tenantId),
    insert: (payload: Record<string, unknown> | Record<string, unknown>[]) =>
      supabaseAdmin.from(table).insert(
        Array.isArray(payload) ? payload.map(row => ({ ...row, tenant_id: tenantId })) : { ...payload, tenant_id: tenantId },
      ),
  };
}
