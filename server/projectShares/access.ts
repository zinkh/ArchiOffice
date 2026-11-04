// Partage d'une affaire avec un confrère : modèle de droits et accès aux données.
//
// Un collaborateur externe n'est pas membre du cabinet. Le partage lie UNE
// personne à UNE affaire (`project_shares`) et porte des droits par type de
// ressource (`project_share_grants`). Aucun droit par défaut : ce qui n'est pas
// accordé est invisible, pas seulement en lecture seule.
//
// Stratégie commerciale : le confrère est invité GRATUITEMENT, dans des limites
// (SHARE_LIMITS), sans IA, sans facturation, sans création d'affaire. S'il veut
// son propre cabinet, il s'abonne comme tout le monde.

export const GUEST_SYSTEM_ROLE = 'guest';
export const GUEST_ROLE_LABEL = 'Collaborateur externe';

/** Types de ressources partageables aujourd'hui (les autres suivront, voir ROADMAP.md). */
export const SHARE_KINDS = ['lots', 'tasks'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
export type ShareAccess = 'read' | 'write';

/** Types sur lesquels une écriture a un sens et est branchée côté serveur. */
export const WRITABLE_KINDS: readonly ShareKind[] = ['tasks'];

/** Limites de la gratuité : invités actifs par affaire, et par cabinet (personnes distinctes). */
export const SHARE_LIMITS = { guestsPerProject: 3, guestsPerTenant: 10 } as const;

export interface ShareGrant { kind: ShareKind; access: ShareAccess }

export interface ShareRow {
  id: string;
  tenant_id: string;
  project_id: string;
  user_id: string;
  email: string;
  status: 'active' | 'revoked';
  invited_by: string | null;
  created_at?: string;
  revoked_at?: string | null;
}

export type LimitCheck = { ok: true } | { ok: false; code: string; message: string };

/** Valide et normalise les droits reçus d'un client. Une même ressource n'y figure qu'une fois (la dernière gagne). */
export function normalizeGrants(input: unknown): { grants: ShareGrant[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: 'Accordez au moins un droit : sans droit, le confrère ne verrait rien.' };
  }
  const byKind = new Map<ShareKind, ShareAccess>();
  for (const raw of input) {
    const kind = raw?.kind;
    const access = raw?.access;
    if (!SHARE_KINDS.includes(kind)) return { error: `Type de ressource non partageable : ${String(kind)}.` };
    if (access !== 'read' && access !== 'write') return { error: `Droit invalide pour ${kind} : « lecture » ou « écriture ».` };
    if (access === 'write' && !WRITABLE_KINDS.includes(kind)) {
      return { error: `L'écriture n'est pas disponible pour ${kind} : accordez la lecture.` };
    }
    byKind.set(kind, access);
  }
  return { grants: [...byKind.entries()].map(([kind, access]) => ({ kind, access })) };
}

/** Le droit couvre-t-il l'accès demandé ? L'écriture implique la lecture. */
export function allows(grants: readonly ShareGrant[], kind: ShareKind, access: ShareAccess): boolean {
  const grant = grants.find(g => g.kind === kind);
  if (!grant) return false;
  return access === 'read' ? true : grant.access === 'write';
}

/** Les droits de plusieurs partages, indexés par partage. Table absente : aucun droit (jamais « tout »). */
export async function loadGrants(supabaseAdmin: any, shareIds: string[]): Promise<Map<string, ShareGrant[]>> {
  const byShare = new Map<string, ShareGrant[]>();
  if (!shareIds.length) return byShare;
  const { data, error } = await supabaseAdmin
    .from('project_share_grants')
    .select('share_id, resource_kind, access')
    .in('share_id', shareIds);
  if (error) return byShare;
  for (const row of data || []) {
    if (!SHARE_KINDS.includes(row.resource_kind)) continue;
    const list = byShare.get(row.share_id) ?? [];
    list.push({ kind: row.resource_kind, access: row.access === 'write' ? 'write' : 'read' });
    byShare.set(row.share_id, list);
  }
  return byShare;
}

/** Le partage ACTIF de cette personne sur cette affaire, avec ses droits, ou null. Indépendant du cabinet actif. */
export async function activeShareFor(
  supabaseAdmin: any, userId: string, projectId: string,
): Promise<{ share: ShareRow; grants: ShareGrant[] } | null> {
  const { data, error } = await supabaseAdmin
    .from('project_shares')
    .select('*')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .eq('status', 'active')
    .maybeSingle();
  if (error || !data) return null;
  const grants = (await loadGrants(supabaseAdmin, [data.id])).get(data.id) ?? [];
  return { share: data as ShareRow, grants };
}

/** Tous les partages actifs d'un cabinet (pour compter les invités et appliquer les limites). */
export async function activeSharesOfTenant(supabaseAdmin: any, tenantId: string): Promise<ShareRow[]> {
  const { data, error } = await supabaseAdmin
    .from('project_shares')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'active');
  if (error) return [];
  return (data || []) as ShareRow[];
}

/** Applique les limites de la gratuité avant d'ajouter un invité à une affaire. */
export function checkShareLimits(
  activeShares: readonly ShareRow[], projectId: string, userId: string,
): LimitCheck {
  const onProject = activeShares.filter(s => s.project_id === projectId);
  if (onProject.length >= SHARE_LIMITS.guestsPerProject) {
    return {
      ok: false, code: 'SHARE_LIMIT_PROJECT',
      message: `Limite atteinte : ${SHARE_LIMITS.guestsPerProject} confrères invités par affaire. Retirez un invité pour en ajouter un autre.`,
    };
  }
  const distinctGuests = new Set(activeShares.map(s => s.user_id));
  if (!distinctGuests.has(userId) && distinctGuests.size >= SHARE_LIMITS.guestsPerTenant) {
    return {
      ok: false, code: 'SHARE_LIMIT_TENANT',
      message: `Limite atteinte : ${SHARE_LIMITS.guestsPerTenant} confrères invités pour le cabinet. Retirez un invité pour en ajouter un autre.`,
    };
  }
  return { ok: true };
}

/** Remplace les droits d'un partage. Un échec laisse au pire MOINS de droits, jamais plus. */
export async function replaceGrants(
  supabaseAdmin: any, share: Pick<ShareRow, 'id' | 'tenant_id'>, grants: readonly ShareGrant[],
): Promise<void> {
  const { error: delError } = await supabaseAdmin.from('project_share_grants').delete().eq('share_id', share.id);
  if (delError) throw delError;
  if (!grants.length) return;
  const { error } = await supabaseAdmin.from('project_share_grants').insert(
    grants.map(g => ({
      id: crypto.randomUUID(), share_id: share.id, tenant_id: share.tenant_id,
      resource_kind: g.kind, access: g.access,
    })),
  );
  if (error) throw error;
}
