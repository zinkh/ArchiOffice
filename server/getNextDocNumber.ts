// Shared by server/routes/{notesHonoraires,proposals,invoices}.ts — the
// auto-numbering scheme (PREFIX-YEAR-SEQ) used for devis, factures, and
// notes d'honoraires alike. Each caller supplies its own tenant setting
// column (the configurable prefix) and count table (which names the sequence).
//
// The sequence value comes from an atomic SQL function (documentSequence.ts,
// supabase/migrate_atomic_document_numbering.sql), not from counting rows:
// two concurrent creations for one tenant used to read the same count and
// receive the same number. The count survives only as the fallback for a
// database that has not run that migration yet.
import { nextDocumentSequence } from './documentSequence';

const SERIES_BY_TABLE: Record<string, string> = {
  invoices: 'invoice',
  proposals: 'proposal',
  notes_honoraires: 'note_honoraires',
};

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
  const countRows = async () => {
    const { count } = await supabaseAdmin.from(countTable).select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
    return count || 0;
  };
  const series = SERIES_BY_TABLE[countTable];
  const next = series ? await nextDocumentSequence(supabaseAdmin, tenantId, series, countRows) : (await countRows()) + 1;
  const seq = String(next).padStart(3, '0');
  return `${prefix}-${year}-${seq}`;
}
