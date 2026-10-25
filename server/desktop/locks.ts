// Verrous de document pour la synchronisation desktop. Voir docs/desktop-sync-contract.md,
// section 7.
//
// Le mode est un réglage du cabinet (`settings.desktop_lock_mode`) :
//  * `off`      : aucun verrou, les conflits se règlent par versions ;
//  * `advisory` : le verrou SIGNALE (« en cours de modification par X »), il ne bloque pas ;
//  * `enforced` : le verrou BLOQUE le dépôt d'une autre personne (423).
// Un verrou expiré n'existe plus : il est ignoré à la lecture et repris à la pose suivante.

export type LockMode = 'off' | 'advisory' | 'enforced';
export const DEFAULT_LOCK_MODE: LockMode = 'advisory';
/** Sans renouvellement, un verrou tombe au bout de 8 heures. */
export const LOCK_TTL_MS = 8 * 60 * 60 * 1000;

export interface LockRow {
  document_id: string;
  tenant_id: string;
  user_id: string;
  user_name: string | null;
  device_id: string | null;
  locked_at: string;
  expires_at: string;
}

export interface LockView {
  by: { id: string; name: string | null };
  mine: boolean;
  since: string;
  expiresAt: string;
}

export function toLockView(row: LockRow, userId: string): LockView {
  return {
    by: { id: row.user_id, name: row.user_name ?? null },
    mine: row.user_id === userId,
    since: row.locked_at,
    expiresAt: row.expires_at,
  };
}

export function isLive(row: Pick<LockRow, 'expires_at'>, now = Date.now()): boolean {
  return new Date(row.expires_at).getTime() > now;
}

/** Le mode du cabinet. Une instance non migrée (colonne absente) retombe sur `advisory`. */
export async function getLockMode(supabaseAdmin: any, tenantId: string): Promise<LockMode> {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings').select('desktop_lock_mode').eq('tenant_id', tenantId).maybeSingle();
    if (error) return DEFAULT_LOCK_MODE;
    const mode = data?.desktop_lock_mode;
    return mode === 'off' || mode === 'advisory' || mode === 'enforced' ? mode : DEFAULT_LOCK_MODE;
  } catch {
    return DEFAULT_LOCK_MODE;
  }
}

export async function getLiveLock(supabaseAdmin: any, tenantId: string, documentId: string): Promise<LockRow | null> {
  const { data } = await supabaseAdmin
    .from('document_locks').select('*').eq('tenant_id', tenantId).eq('document_id', documentId).maybeSingle();
  return data && isLive(data) ? (data as LockRow) : null;
}

/** Les verrous en cours de plusieurs documents, en une requête par tranche. */
export async function getLiveLocks(
  supabaseAdmin: any,
  tenantId: string,
  documentIds: readonly string[],
): Promise<Map<string, LockRow>> {
  const result = new Map<string, LockRow>();
  const ids = [...new Set(documentIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabaseAdmin
      .from('document_locks').select('*').eq('tenant_id', tenantId).in('document_id', ids.slice(i, i + 200));
    for (const row of (data || []) as LockRow[]) {
      if (isLive(row)) result.set(row.document_id, row);
    }
  }
  return result;
}

export type AcquireResult = { ok: true; lock: LockRow } | { ok: false; holder: LockRow };

/**
 * Pose le verrou, ou le renouvelle s'il appartient déjà à la personne. Prend la place d'un
 * verrou expiré par une mise à jour CONDITIONNELLE (le détenteur et l'échéance lus doivent
 * être inchangés) : deux postes qui se disputent un verrou expiré ne le gagnent pas tous les deux.
 */
export async function acquireLock(
  supabaseAdmin: any,
  params: { tenantId: string; documentId: string; userId: string; userName: string | null; deviceId: string | null },
): Promise<AcquireResult> {
  const { tenantId, documentId, userId, userName, deviceId } = params;
  const now = new Date();
  const fresh = {
    document_id: documentId,
    tenant_id: tenantId,
    user_id: userId,
    user_name: userName,
    device_id: deviceId,
    locked_at: now.toISOString(),
    expires_at: new Date(now.getTime() + LOCK_TTL_MS).toISOString(),
  };

  const { data: existing } = await supabaseAdmin
    .from('document_locks').select('*').eq('document_id', documentId).eq('tenant_id', tenantId).maybeSingle();

  if (!existing) {
    const { error } = await supabaseAdmin.from('document_locks').insert(fresh);
    if (!error) return { ok: true, lock: fresh };
    // Un autre poste a posé le sien entre la lecture et l'écriture (clé primaire).
    if (error.code !== '23505') throw error;
    const holder = await getLiveLock(supabaseAdmin, tenantId, documentId);
    if (holder) return { ok: false, holder };
    throw error;
  }

  if (isLive(existing) && existing.user_id !== userId) return { ok: false, holder: existing as LockRow };

  const patch = isLive(existing) && existing.user_id === userId
    ? { expires_at: fresh.expires_at, device_id: deviceId ?? existing.device_id }
    : fresh;
  const { data: updated, error } = await supabaseAdmin
    .from('document_locks').update(patch)
    .eq('document_id', documentId).eq('tenant_id', tenantId)
    .eq('user_id', existing.user_id).eq('expires_at', existing.expires_at)
    .select();
  if (error) throw error;
  if (updated && updated.length > 0) return { ok: true, lock: updated[0] as LockRow };
  const holder = await getLiveLock(supabaseAdmin, tenantId, documentId);
  if (holder && holder.user_id === userId) return { ok: true, lock: holder };
  if (holder) return { ok: false, holder };
  return acquireLock(supabaseAdmin, params);
}

/** Prolonge un verrou en cours qui appartient à la personne ; null sinon. */
export async function renewLock(
  supabaseAdmin: any,
  params: { tenantId: string; documentId: string; userId: string },
): Promise<LockRow | null> {
  const current = await getLiveLock(supabaseAdmin, params.tenantId, params.documentId);
  if (!current || current.user_id !== params.userId) return null;
  const expires = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  const { error } = await supabaseAdmin.from('document_locks')
    .update({ expires_at: expires })
    .eq('document_id', params.documentId).eq('tenant_id', params.tenantId).eq('user_id', params.userId);
  if (error) throw error;
  return { ...current, expires_at: expires };
}

export type ReleaseResult = 'released' | 'not_locked' | 'not_owner';

/** Libère un verrou. Sans `force`, seul son détenteur le peut ; libérer l'absence de verrou réussit. */
export async function releaseLock(
  supabaseAdmin: any,
  params: { tenantId: string; documentId: string; userId: string; force: boolean },
): Promise<{ result: ReleaseResult; previous: LockRow | null }> {
  const { data: row } = await supabaseAdmin
    .from('document_locks').select('*').eq('document_id', params.documentId).eq('tenant_id', params.tenantId).maybeSingle();
  if (!row) return { result: 'not_locked', previous: null };
  const live = isLive(row);
  if (live && row.user_id !== params.userId && !params.force) return { result: 'not_owner', previous: row };
  const { error } = await supabaseAdmin.from('document_locks')
    .delete().eq('document_id', params.documentId).eq('tenant_id', params.tenantId);
  if (error) throw error;
  return { result: 'released', previous: row };
}
