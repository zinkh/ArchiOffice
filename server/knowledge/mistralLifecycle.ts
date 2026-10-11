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
  updated_at: string;
}

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
      if (!row.remote_document_id) return false; // preserve uncertainty, no silent orphan
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
    const pending = await scope.update({
      state: 'delete_pending', last_error: 'Suppression distante à réessayer.',
      updated_at: new Date().toISOString(),
    }).eq('id', row.id).neq('state', 'deleted');
    if (pending.error) throw pending.error;
    return false;
  }
}

/** Process bounded batches; safe across multiple App Platform instances. */
export async function flushPendingMistralDeletions(db: any, tenantId?: string, limit = 20) {
  let query = db.from('knowledge_remote_documents')
    .select('*').not('deletion_requested_at', 'is', null)
    .neq('state', 'deleted').order('updated_at', { ascending: true }).limit(limit);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw error;
  let deleted = 0;
  for (const row of (data || []) as RemotePublication[]) {
    if (await processRemoteDeletion(db, row)) deleted++;
  }
  return { attempted: (data || []).length, deleted, pending: (data || []).length - deleted };
}
