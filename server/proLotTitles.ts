import { appliquerTitresLots } from '../src/lib/lotTitles';

/** Titles belong to project_lots, even when a document has not been opened recently. */
export async function withProjectLotTitles<T>(db: any, tenantId: string, projectId: string, document: T): Promise<T> {
  if (!document || !Array.isArray((document as any).lots)) return document;
  const { data, error } = await db.from('project_lots').select('id, lot_number, lot_title')
    .eq('project_id', projectId).eq('tenant_id', tenantId);
  if (error) throw error;
  return appliquerTitresLots(document as any, data ?? []) as T;
}
