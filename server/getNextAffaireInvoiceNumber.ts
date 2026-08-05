// Business-reference numbering for acompte invoices, scoped to a single
// project ("affaire") — complements the tenant-wide legal sequential
// invoice_number from getNextDocNumber.ts, it never replaces it. Format:
// `${project_code}-ACO-${seq}` (project_code is the affaire number already
// generated at project creation, see server/routes/projects.ts).
export async function getNextAffaireInvoiceNumber(
  supabaseAdmin: any,
  tenantId: string,
  projectId: string,
): Promise<string> {
  const { data: project } = await supabaseAdmin.from('projects').select('project_code').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
  const affaireCode = (project as any)?.project_code || projectId.slice(0, 8);
  const { count } = await supabaseAdmin.from('invoices').select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('project_id', projectId).eq('invoice_type', 'acompte');
  const seq = String((count || 0) + 1).padStart(2, '0');
  return `${affaireCode}-ACO-${seq}`;
}
