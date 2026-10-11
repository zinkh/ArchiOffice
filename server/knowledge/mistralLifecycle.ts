import { makeMistralLibraryClient } from './mistralLibrary';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RemotePublication {
  id: string;
  tenant_id: string;
  contribution_id: string;
  library_id: string;
  remote_name: string;
  remote_document_id: string | null;
  state: 'uploading' | 'uncertain' | 'published' | 'delete_pending' | 'deleting' | 'deleted';
  deletion_requested_at: string | null;
  created_at?: string | null;
  updated_at: string;
  /** Absents tant que supabase/migrate_knowledge_zz_remote_retry_backoff.sql n'est pas passée. */
  delete_attempts?: number | null;
  next_attempt_at?: string | null;
}

/** Au-delà, un envoi sans document distant retrouvé est considéré comme n'ayant jamais abouti. */
export const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;
/** Délai minimal entre deux rapprochements d'une même ligne (limite les parcours de la bibliothèque). */
export const RECONCILE_RETRY_MS = 5 * 60 * 1000;
/** Un envoi plus récent peut encore être en vol : le délai d'attente d'une requête Mistral est de 25 s. */
export const IN_FLIGHT_MS = 60_000;

/** Délai avant la prochaine suppression : 2 min, 4 min, 8 min... plafonné à 6 h. */
export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
/** À partir de ce nombre d'échecs, la ligne est signalée comme demandant une intervention. */
export const ALERT_AFTER_ATTEMPTS = 6;
export const backoffMs = (attempts: number) =>
  Math.min(BACKOFF_BASE_MS * 2 ** Math.max(1, attempts), BACKOFF_MAX_MS);
const IS_MISSING_COLUMN = (error: any) =>
  error?.code === '42703' || error?.code === 'PGRST204' || /delete_attempts|next_attempt_at/.test(error?.message || '');

const elapsedMs = (iso: string | null | undefined) => iso ? Date.now() - new Date(iso).getTime() : 0;
const IS_MISSING_TABLE = (error: any) =>
  error?.code === '42P01' || error?.code === 'PGRST205' || /does not exist|schema cache/i.test(error?.message || '');

export function remoteLibrary(row: RemotePublication) {
  if (!process.env.MISTRAL_API_KEY) throw new Error('Clé Mistral manquante.');
  return makeMistralLibraryClient(process.env.MISTRAL_API_KEY, row.library_id);
}

/** Reconcile by deterministic filename before any retry: never blind re-upload. */
export async function reconcileRemotePublication(db: any, row: RemotePublication) {
  const remote = await remoteLibrary(row).findByName(row.remote_name);
  const updates = {
    state: remote ? (row.deletion_requested_at ? 'delete_pending' : 'published') : 'uncertain',
    ...(remote ? { remote_document_id: remote.id, published_at: new Date().toISOString(), last_error: null } :
      { last_error: 'Transfert non confirmé : rapprochement Mistral nécessaire.' }),
    updated_at: new Date().toISOString(),
  };
  const result = await tenantScopedFrom(db, row.tenant_id, 'knowledge_remote_documents')
    .update(updates).eq('id', row.id).is('remote_document_id', null)
    .in('state', ['uploading', 'uncertain', 'delete_pending']).select().maybeSingle();
  if (result.error) throw result.error;
  return result.data || row;
}

/**
 * Clôt une réservation dont aucun document distant n'a été retrouvé après
 * ABANDON_AFTER_MS : il n'y a rien à supprimer chez Mistral, et la ligne ne doit
 * pas bloquer indéfiniment un retrait de consentement ou la fermeture du cabinet.
 * Pour republier, le cabinet supprime l'extrait puis le prépare de nouveau.
 */
export async function abandonNeverSent(db: any, row: RemotePublication): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await tenantScopedFrom(db, row.tenant_id, 'knowledge_remote_documents')
    .update({
      state: 'deleted', deleted_at: now, updated_at: now,
      last_error: 'Envoi abandonné : aucun document distant retrouvé après 24 h.',
    })
    .eq('id', row.id).is('remote_document_id', null).in('state', ['uploading', 'uncertain', 'delete_pending'])
    .select().maybeSingle();
  if (result.error) throw result.error;
  return !!result.data;
}

/**
 * Reprend les réservations restées sans issue (arrêt du serveur entre la
 * réservation et l'enregistrement, réponse perdue) : cherche le document par son
 * nom opaque, jamais de nouvel envoi. Introuvable avant ABANDON_AFTER_MS : la
 * ligne reste `uncertain` ; après : elle est abandonnée.
 */
export async function reconcileStalePublications(
  db: any, tenantId?: string, limit = 20, minAgeMs = RECONCILE_RETRY_MS,
) {
  const before = new Date(Date.now() - Math.max(minAgeMs, IN_FLIGHT_MS)).toISOString();
  let query = db.from('knowledge_remote_documents')
    .select('*').in('state', ['uploading', 'uncertain']).is('remote_document_id', null)
    .is('deletion_requested_at', null).lt('updated_at', before)
    .order('updated_at', { ascending: true }).limit(limit);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw error;
  const summary = { checked: 0, reconciled: 0, abandoned: 0, uncertain: 0, errors: 0 };
  for (const row of (data || []) as RemotePublication[]) {
    summary.checked++;
    try {
      const result = await reconcileRemotePublication(db, row);
      if (result.remote_document_id) summary.reconciled++;
      else if (elapsedMs(row.created_at ?? row.updated_at) >= ABANDON_AFTER_MS && await abandonNeverSent(db, result)) summary.abandoned++;
      else summary.uncertain++;
    } catch {
      summary.errors++;
      // Surface le blocage (ex. plusieurs copies distantes) et repousse la prochaine tentative.
      await tenantScopedFrom(db, row.tenant_id, 'knowledge_remote_documents')
        .update({ last_error: 'Rapprochement impossible : examen manuel requis.', updated_at: new Date().toISOString() })
        .eq('id', row.id).is('remote_document_id', null);
    }
  }
  return summary;
}

/**
 * Idempotent deletion attempt. If an upload response was lost, resolve the
 * remote ID first; "not found" is NOT proof of deletion (upload may still run).
 * Pending failures are retained for retry by the background sweeper.
 */
export async function processRemoteDeletion(db: any, original: RemotePublication): Promise<boolean> {
  const scope = tenantScopedFrom(db, original.tenant_id, 'knowledge_remote_documents');
  const read = await scope.select('*').eq('id', original.id).maybeSingle();
  if (read.error) throw read.error;
  let row = read.data as RemotePublication | null;
  if (!row || row.state === 'deleted') return true;
  if (!row.deletion_requested_at) return false;
  try {
    if (!row.remote_document_id) {
      const ageMs = Date.now() - new Date(row.updated_at).getTime();
      if (row.state === 'uploading' && ageMs < 60_000) return false;
      row = await reconcileRemotePublication(db, row) as RemotePublication;
      if (!row.remote_document_id) {
        // Pas d'orphelin silencieux tant que l'envoi peut encore avoir abouti ; passé
        // le délai, il n'y a plus rien à supprimer et la ligne ne doit pas bloquer.
        if (elapsedMs(row.created_at ?? row.updated_at) < ABANDON_AFTER_MS) return false;
        return abandonNeverSent(db, row);
      }
    }
    if (row.state === 'deleting') {
      const retryBefore = new Date(Date.now() - 90_000).toISOString();
      const released = await scope.update({ state: 'delete_pending', updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('state', 'deleting').lt('updated_at', retryBefore).select().maybeSingle();
      if (released.error) throw released.error;
      if (!released.data) return false;
    }
    const claimed = await scope.update({ state: 'deleting', updated_at: new Date().toISOString() })
      .eq('id', row.id).in('state', ['uploading', 'uncertain', 'published', 'delete_pending'])
      .not('deletion_requested_at', 'is', null).select().maybeSingle();
    if (claimed.error) throw claimed.error;
    if (!claimed.data) return false; // another worker owns deletion
    await remoteLibrary(row).remove(row.remote_document_id);
    const done = await scope.update({
      state: 'deleted', deleted_at: new Date().toISOString(), last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id).eq('state', 'deleting');
    if (done.error) throw done.error;
    return true;
  } catch {
    // Keep the durable ID even when Mistral or database is unavailable.
    // Délai croissant et compteur : une panne durable ne martèle plus Mistral
    // chaque minute, et un échec répété est signalé au lieu de rester silencieux.
    const attempts = (row.delete_attempts ?? 0) + 1;
    const base = {
      state: 'delete_pending',
      last_error: attempts >= ALERT_AFTER_ATTEMPTS
        ? 'Suppression distante en échec répété : intervention requise.'
        : 'Suppression distante à réessayer.',
      updated_at: new Date().toISOString(),
    };
    let pending = await scope.update({
      ...base, delete_attempts: attempts, next_attempt_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
    }).eq('id', row.id).neq('state', 'deleted');
    // Instance dont la migration n'est pas passée : on retombe sur l'ancien comportement.
    if (pending.error && IS_MISSING_COLUMN(pending.error)) {
      pending = await scope.update(base).eq('id', row.id).neq('state', 'deleted');
    }
    if (pending.error) throw pending.error;
    if (attempts === ALERT_AFTER_ATTEMPTS) {
      // Ni extrait ni nom de fichier dans le journal : seulement des identifiants internes.
      console.error(`[mistral] suppression distante en échec répété (cabinet ${row.tenant_id}, ligne ${row.id}) : intervention requise.`);
    }
    return false;
  }
}

/**
 * Process bounded batches; safe across multiple App Platform instances.
 * Les lignes dont la prochaine tentative n'est pas échue sont laissées de côté
 * (sauf `ignoreBackoff`, pour le geste manuel d'un administrateur).
 */
export async function flushPendingMistralDeletions(
  db: any, tenantId?: string, limit = 20, options: { ignoreBackoff?: boolean } = {},
) {
  let query = db.from('knowledge_remote_documents')
    .select('*').not('deletion_requested_at', 'is', null)
    .neq('state', 'deleted').order('updated_at', { ascending: true }).limit(limit);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []) as RemotePublication[];
  const now = new Date().toISOString();
  const due = options.ignoreBackoff ? rows : rows.filter(r => !r.next_attempt_at || r.next_attempt_at <= now);
  let deleted = 0;
  for (const row of due) {
    if (await processRemoteDeletion(db, row)) deleted++;
  }
  return { attempted: due.length, deleted, pending: rows.length - deleted, waiting: rows.length - due.length };
}

/**
 * Avant la purge d'un cabinet : exige que plus aucun document ne subsiste chez
 * Mistral. La clé étrangère vers `tenants` est en RESTRICT, la suppression du
 * cabinet échouerait sinon, et la perdre effacerait la trace d'une obligation de
 * suppression. Échec fermé : tant qu'il reste des lignes, la purge est reportée.
 */
export async function settleRemoteDocumentsBeforePurge(db: any, tenantId: string) {
  const scope = () => tenantScopedFrom(db, tenantId, 'knowledge_remote_documents');
  const marked = await scope()
    .update({ deletion_requested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .is('deletion_requested_at', null).neq('state', 'deleted');
  if (marked.error) {
    if (IS_MISSING_TABLE(marked.error)) return { ok: true, remaining: 0 }; // instance non migrée
    throw marked.error;
  }
  await flushPendingMistralDeletions(db, tenantId, 100).catch(() => undefined);
  const left = await scope().select('id').neq('state', 'deleted');
  if (left.error) throw left.error;
  const remaining = (left.data || []).length;
  return { ok: remaining === 0, remaining };
}
