// Shared by server/routes/{notesHonoraires,proposals,invoices}.ts — the
// auto-numbering scheme (PREFIX-YEAR-SEQ) used for devis, factures, and
// notes d'honoraires alike. Each caller supplies its own tenant setting
// column (the configurable prefix) and count table (the sequence source).
export async function getNextDocNumber(
  supabaseAdmin: any,
  tenantId: string,
  settingCol: string,
  countTable: string,
  defaultPrefix: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const { data: s } = await supabaseAdmin.from('settings').select(settingCol).eq('tenant_id', tenantId).single();
  const prefix = (s as any)?.[settingCol] || defaultPrefix;
  const { count } = await supabaseAdmin.from(countTable).select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  const seq = String((count || 0) + 1).padStart(3, '0');
  return `${prefix}-${year}-${seq}`;
}
