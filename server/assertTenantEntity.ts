// A caller-supplied foreign-key id (project_id on an invoice, a contact_id,
// ...) is routinely accepted straight from the request body and written
// into a row without ever checking WHOSE it is. tenantScopedFrom.ts already
// stops a payload from re-parenting the ROW BEING WRITTEN into another
// tenant's namespace, but it says nothing about ids the payload merely
// REFERENCES — an invoice gets the right tenant_id, but nothing stops its
// project_id from pointing at another tenant's project. The invoice's own
// list/detail queries then join `projects(name)` through the service-role
// client, which bypasses RLS, so that cross-tenant reference silently
// leaks the other tenant's project name into this tenant's invoice list.
//
// This is deliberately generic (table name + id, not a per-entity helper)
// so any route accepting a foreign id can add one call rather than hand-
// rolling a `.select('id').eq('id', x).eq('tenant_id', tenantId)` each time.
export async function assertTenantEntity(
  supabaseAdmin: any,
  table: string,
  id: string | null | undefined,
  tenantId: string,
): Promise<boolean> {
  if (!id) return true; // no reference supplied — nothing to own
  const { data } = await supabaseAdmin.from(table).select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  return !!data;
}
