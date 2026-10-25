// Journal de changements lu par le client desktop. Voir docs/desktop-sync-contract.md,
// section 6.
//
// Le journal est ÉCRIT par des déclencheurs en base (supabase/migrate_desktop_sync.sql) :
// plusieurs chemins du serveur modifient `documents` (dépôts, DOE, agents, MCP, migration
// de stockage) et un seul d'entre eux oublié ferait manquer un changement au client.
// Ce module ne fait que le LIRE, le rendre idempotent et le traduire en événements d'état :
// un `upsert` porte le nœud complet, jamais un delta.
import { parseNodeId } from '../../src/lib/desktopNodes';
import { getLiveLocks, toLockView, type LockView } from './locks';
import { DesktopError, loadDocuments, nodesForDocuments, type DesktopNode, type NodeContext } from './nodes';

export const CHANGES_DEFAULT_LIMIT = 200;
export const CHANGES_MAX_LIMIT = 500;

export interface ChangeRow {
  seq: number;
  type: 'upsert' | 'delete' | 'lock' | 'unlock' | 'scope';
  node_id: string;
  project_id: string | null;
}

export type ChangeEvent =
  | { seq: number; type: 'upsert'; node: DesktopNode }
  | { seq: number; type: 'delete'; id: string; projectId: string | null }
  | { seq: number; type: 'lock'; id: string; lock: LockView }
  | { seq: number; type: 'unlock'; id: string }
  | { seq: number; type: 'scope'; id: string; projectId: string | null };

/** Plus petit curseur encore servable (voir desktop_changes_prune). */
export async function getFloor(db: any): Promise<number> {
  const { data, error } = await db.from('desktop_sync_state').select('value').eq('key', 'floor_seq').maybeSingle();
  if (error) throw error;
  return Number(data?.value ?? 0);
}

/** Le curseur « maintenant » : le plus grand `seq` écrit, tous cabinets confondus (un nombre, sans fuite). */
export async function currentCursor(db: any): Promise<string> {
  const { data, error } = await db.from('desktop_changes').select('seq').order('seq', { ascending: false }).limit(1);
  if (error) throw error;
  const latest = Number(data?.[0]?.seq ?? 0);
  return String(Math.max(latest, await getFloor(db)));
}

export function parseCursor(raw: unknown): number {
  const text = String(raw ?? '');
  if (!/^\d{1,15}$/.test(text)) throw new DesktopError(400, 'INVALID_CURSOR', 'Curseur invalide.');
  return Number(text);
}

export function parseLimit(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return CHANGES_DEFAULT_LIMIT;
  return Math.min(n, CHANGES_MAX_LIMIT);
}

export async function readChangeRows(
  db: any,
  tenantId: string,
  cursor: number,
  limit: number,
): Promise<{ rows: ChangeRow[]; hasMore: boolean }> {
  const { data, error } = await db.from('desktop_changes').select('*')
    .eq('tenant_id', tenantId).gt('seq', cursor).order('seq', { ascending: true }).limit(limit + 1);
  if (error) throw error;
  const rows = ((data || []) as any[]).map(r => ({ ...r, seq: Number(r.seq) })) as ChangeRow[];
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

/**
 * Garde le DERNIER événement de chaque nœud et de chaque nature (état du nœud / verrou /
 * affaire) : l'événement porte l'état courant, les intermédiaires n'apprennent rien au client.
 * Verrou et contenu sont des natures distinctes, sinon un `lock` masquerait un `upsert` récent.
 */
export function collapseRows(rows: readonly ChangeRow[]): ChangeRow[] {
  const group = (type: ChangeRow['type']) => (type === 'lock' || type === 'unlock' ? 'lock' : type === 'scope' ? 'scope' : 'node');
  const last = new Map<string, ChangeRow>();
  for (const row of rows) last.set(`${row.node_id}|${group(row.type)}`, row);
  return [...last.values()].sort((a, b) => a.seq - b.seq);
}

export async function buildEvents(ctx: NodeContext, rows: readonly ChangeRow[]): Promise<ChangeEvent[]> {
  const collapsed = collapseRows(rows);
  const documentId = (nodeId: string) => {
    const parsed = parseNodeId(nodeId);
    return parsed?.kind === 'doc' ? parsed.documentId : null;
  };

  const upsertIds = collapsed.filter(r => r.type === 'upsert').map(r => documentId(r.node_id)).filter((id): id is string => !!id);
  const lockIds = collapsed.filter(r => r.type === 'lock').map(r => documentId(r.node_id)).filter((id): id is string => !!id);
  const [docs, locks] = await Promise.all([
    loadDocuments(ctx, upsertIds),
    getLiveLocks(ctx.db, ctx.tenantId, lockIds),
  ]);
  const nodes = new Map((await nodesForDocuments(ctx, docs)).map(n => [n.id, n]));

  const events: ChangeEvent[] = [];
  for (const row of collapsed) {
    switch (row.type) {
      case 'upsert': {
        const node = nodes.get(row.node_id);
        // Absent : supprimé depuis, ou hors de ce cabinet. L'état courant est « n'existe pas ».
        events.push(node
          ? { seq: row.seq, type: 'upsert', node }
          : { seq: row.seq, type: 'delete', id: row.node_id, projectId: row.project_id });
        break;
      }
      case 'delete':
        events.push({ seq: row.seq, type: 'delete', id: row.node_id, projectId: row.project_id });
        break;
      case 'lock': {
        const id = documentId(row.node_id);
        const lock = id ? locks.get(id) : undefined;
        events.push(lock
          ? { seq: row.seq, type: 'lock', id: row.node_id, lock: toLockView(lock, ctx.userId) }
          : { seq: row.seq, type: 'unlock', id: row.node_id });
        break;
      }
      case 'unlock':
        events.push({ seq: row.seq, type: 'unlock', id: row.node_id });
        break;
      case 'scope':
        events.push({ seq: row.seq, type: 'scope', id: row.node_id, projectId: row.project_id });
        break;
    }
  }
  return events;
}

let lastPruneAt = 0;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

/** Purge opportuniste (au plus une fois par heure et par processus), sans jamais gêner la requête. */
export async function maybePrune(db: any): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now;
  try {
    await db.rpc('desktop_changes_prune', {});
  } catch {
    // Fonction absente ou rôle sans droit : la purge se fera au prochain essai.
  }
}
