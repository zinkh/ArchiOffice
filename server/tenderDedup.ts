// Déduplication inter-sources des annonces de veille : un même avis publié
// au BOAMP, au JOUE (TED) et repris par un flux RSS ne doit apparaître
// qu'une fois dans tender_rss_matches. La clé est un md5 du titre normalisé
// (minuscules, sans accents ni ponctuation), complétée par un md5 de
// l'acheteur normalisé quand il est connu : deux lignes sont des doublons si
// leur titre normalisé est identique et que leurs acheteurs sont identiques
// ou inconnus d'un côté (les flux RSS n'ont souvent pas d'acheteur
// exploitable). Le SQL de migrate_add_tender_ted_connector.sql calcule la
// même clé (unaccent + regexp_replace + md5) pour les lignes existantes.
import { createHash } from 'node:crypto';

export function normalizeForKey(value: string | null | undefined): string {
  return (value || '')
    .replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

export function dedupTitleKey(title: string | null | undefined): string | null {
  const normalized = normalizeForKey(title);
  return normalized ? md5(normalized) : null;
}

export function dedupBuyerKey(buyer: string | null | undefined): string | null {
  const normalized = normalizeForKey(buyer);
  return normalized ? md5(normalized) : null;
}

export interface DedupRow {
  source_id: string;
  guid: string;
  dedup_key: string | null;
  dedup_buyer: string | null;
}

function sameNotice(a: DedupRow, b: DedupRow): boolean {
  if (!a.dedup_key || a.dedup_key !== b.dedup_key) return false;
  if (!a.dedup_buyer || !b.dedup_buyer) return true;
  return a.dedup_buyer === b.dedup_buyer;
}

/**
 * Retire d'un lot fraîchement récupéré les lignes qui dupliquent une annonce
 * déjà présente pour le cabinet (toutes sources confondues) ou une autre
 * ligne du même lot. Une ligne déjà présente pour la même source et le même
 * guid n'est pas un doublon inter-sources : elle est laissée à l'upsert
 * (source_id, guid), qui l'ignore.
 */
export async function dropDuplicates<T extends DedupRow>(supabaseAdmin: any, tenantId: string, rows: T[]): Promise<T[]> {
  const keys = [...new Set(rows.map(r => r.dedup_key).filter((k): k is string => !!k))];
  const existing: DedupRow[] = [];
  const CHUNK = 100;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('tender_rss_matches')
      .select('source_id, guid, dedup_key, dedup_buyer')
      .eq('tenant_id', tenantId)
      .in('dedup_key', keys.slice(i, i + CHUNK));
    if (error) throw new Error(`Dedup lookup failed: ${error.message}`);
    existing.push(...((data || []) as DedupRow[]));
  }

  const kept: T[] = [];
  for (const row of rows) {
    const sameSourceItem = existing.some(e => e.source_id === row.source_id && e.guid === row.guid);
    const duplicateOfExisting = !sameSourceItem && existing.some(e => sameNotice(row, e));
    const duplicateInBatch = kept.some(k => sameNotice(row, k));
    if (duplicateOfExisting || duplicateInBatch) continue;
    kept.push(row);
  }
  return kept;
}
