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

/** One relational id of a payload: the table it points at, its value, and the
 *  French noun used in the refusal message ("Projet introuvable pour ce cabinet."). */
export interface TenantRelation {
  table: string;
  id: unknown;
  label: string;
}

/**
 * Validates SEVERAL relational ids of one payload in a single call and returns
 * the refusal message of the first one the tenant does not own, or null when
 * all of them are fine (the caller answers 400 with it).
 *
 * - An absent, null or empty id is skipped: clearing a relation is allowed.
 * - A present id that is not a string (an object or array smuggled through the
 *   JSON body) is refused outright rather than handed to the query builder.
 * - A foreign id and a non-existent id get the SAME message: the response never
 *   reveals that an id exists in another cabinet.
 */
export async function firstForeignRelation(
  supabaseAdmin: any,
  tenantId: string,
  relations: TenantRelation[],
): Promise<string | null> {
  for (const { table, id, label } of relations) {
    if (id === undefined || id === null || id === '') continue;
    if (typeof id !== 'string' || !(await assertTenantEntity(supabaseAdmin, table, id, tenantId))) {
      return `${label} introuvable pour ce cabinet.`;
    }
  }
  return null;
}
