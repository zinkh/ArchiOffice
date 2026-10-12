/**
 * Texte d'un document du cabinet, pour la préparation d'un extrait. Partagé par
 * la préparation manuelle (route) et le traitement automatique : une seule
 * lecture, donc un seul comportement.
 */
import * as XLSX from 'xlsx';

export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

export interface SourceDocument { id: string; name: string; file_url: string; mime_type?: string | null; size_bytes?: number | null }

export async function extractDocumentSource(
  db: any, tenantId: string, doc: SourceDocument,
): Promise<{ text: string | null; unreadable?: boolean }> {
  // Ne jamais utiliser le parseur Nomic : son moteur optionnel est externe.
  const { extractKnowledgeDocText, readStorageObject } = await import('@zinkh/archioffice-agents/server');
  if (/\.xlsx?$/i.test(doc.name)) {
    const fetched = await readStorageObject(db, tenantId, doc.file_url);
    if (!fetched || fetched.buffer.length > MAX_SOURCE_BYTES) return { text: null, unreadable: true };
    const workbook = XLSX.read(fetched.buffer, { type: 'buffer' });
    const text = workbook.SheetNames.slice(0, 10)
      .map((sheet) => XLSX.utils.sheet_to_csv(workbook.Sheets[sheet]).slice(0, 12000)).join('\n');
    return { text };
  }
  return { text: await extractKnowledgeDocText(db, tenantId, doc, false) };
}
