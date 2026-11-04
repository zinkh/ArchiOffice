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
export const SHARE_KINDS = ['lots', 'tasks', 'documents', 'cctp', 'dpgf'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
/** Du plus faible au plus fort : lire < commenter < écrire. Chaque niveau comprend les précédents. */
export type ShareAccess = 'read' | 'comment' | 'write';

/**
 * Types sur lesquels une écriture a un sens et est branchée côté serveur.
 * Pour `tasks`, « écrire » modifie la tâche. Pour `cctp`, « écrire » signifie PROPOSER :
 * l'invité n'écrit jamais dans le document, il dépose une proposition que le cabinet
 * valide (server/routes/projectShareProposals.ts). Le DPGF n'est pas encore concerné :
 * ses quantités et ses prix demandent une autre validation.
 */
export const WRITABLE_KINDS: readonly ShareKind[] = ['tasks', 'cctp'];
/** Types qu'un invité peut commenter (sans rien modifier). */
export const COMMENTABLE_KINDS: readonly ShareKind[] = ['cctp', 'dpgf'];
/**
 * Types dont le droit se donne LOT PAR LOT (clé : project_lots.id). Le CCTP et le DPGF
 * sont un seul document dont chaque lot porte textes ET prix : « tout le document »
 * n'existe donc pas comme droit, pour qu'un lot n'ouvre jamais les prix des autres.
 */
export const LOT_SCOPED_KINDS: readonly ShareKind[] = ['cctp', 'dpgf'];
/** Borne de taille d'une liste de droits reçue d'un client. */
export const MAX_GRANTS_PER_SHARE = 200;
const ACCESS_RANK: Record<ShareAccess, number> = { read: 0, comment: 1, write: 2 };

/** Limites de la gratuité : invités actifs par affaire, et par cabinet (personnes distinctes). */
export const SHARE_LIMITS = { guestsPerProject: 3, guestsPerTenant: 10 } as const;

export interface ShareGrant { kind: ShareKind; access: ShareAccess; /** project_lots.id, pour les types par lot. */ lotId?: string }

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
  if (input.length > MAX_GRANTS_PER_SHARE) return { error: 'Trop de droits dans une même demande.' };
  // Clé = type + lot : un même type peut figurer pour plusieurs lots, une seule fois par lot.
  const byKey = new Map<string, ShareGrant>();
  for (const raw of input) {
    const kind = raw?.kind;
    const access = raw?.access;
    if (!SHARE_KINDS.includes(kind)) return { error: `Type de ressource non partageable : ${String(kind)}.` };
    if (access !== 'read' && access !== 'comment' && access !== 'write') {
      return { error: `Droit invalide pour ${kind} : « lecture », « commentaire » ou « écriture ».` };
    }
    if (access === 'write' && !WRITABLE_KINDS.includes(kind)) {
      return { error: `L'écriture n'est pas disponible pour ${kind} : accordez la lecture.` };
    }
    if (access === 'comment' && !COMMENTABLE_KINDS.includes(kind)) {
      return { error: `Les commentaires ne sont pas disponibles pour ${kind} : accordez la lecture.` };
    }
    const scoped = LOT_SCOPED_KINDS.includes(kind);
    const lotId = raw?.lotId;
    if (scoped) {
      if (typeof lotId !== 'string' || !lotId.trim() || lotId.length > 100) {
        return { error: `Le droit sur ${kind} se donne lot par lot : désignez le lot.` };
      }
    } else if (lotId !== undefined && lotId !== null) {
      return { error: `Le droit sur ${kind} ne se donne pas par lot.` };
    }
    const grant: ShareGrant = scoped ? { kind, access, lotId: lotId.trim() } : { kind, access };
    byKey.set(`${kind}|${grant.lotId ?? ''}`, grant);
  }
  return { grants: [...byKey.values()] };
}

/**
 * Le droit couvre-t-il l'accès demandé ? Chaque niveau comprend les précédents
 * (écrire implique commenter, qui implique lire). Pour un type par lot, `lotId` est
 * obligatoire : sans lui, rien n'est jamais accordé.
 */
export function allows(grants: readonly ShareGrant[], kind: ShareKind, access: ShareAccess, lotId?: string): boolean {
  const scoped = LOT_SCOPED_KINDS.includes(kind);
  if (scoped && !lotId) return false;
  const grant = grants.find(g => g.kind === kind && (!scoped || g.lotId === lotId));
  if (!grant) return false;
  return ACCESS_RANK[grant.access] >= ACCESS_RANK[access];
}

/** Les lots sur lesquels le niveau demandé est accordé, pour un type par lot. */
export function grantedLotIds(grants: readonly ShareGrant[], kind: ShareKind, access: ShareAccess = 'read'): Set<string> {
  const ids = new Set<string>();
  for (const g of grants) {
    if (g.kind === kind && g.lotId && ACCESS_RANK[g.access] >= ACCESS_RANK[access]) ids.add(g.lotId);
  }
  return ids;
}

/** Les droits de plusieurs partages, indexés par partage. Table absente : aucun droit (jamais « tout »). */
export async function loadGrants(supabaseAdmin: any, shareIds: string[]): Promise<Map<string, ShareGrant[]>> {
  const byShare = new Map<string, ShareGrant[]>();
  if (!shareIds.length) return byShare;
  const { data, error } = await supabaseAdmin
    .from('project_share_grants')
    .select('share_id, resource_kind, access, project_lot_id')
    .in('share_id', shareIds);
  if (error) return byShare;
  for (const row of data || []) {
    if (!SHARE_KINDS.includes(row.resource_kind)) continue;
    const scoped = LOT_SCOPED_KINDS.includes(row.resource_kind);
    // Un droit par lot sans lot est inutilisable : on l'ignore, il n'ouvre jamais « tout le document ».
    if (scoped && !row.project_lot_id) continue;
    const access: ShareAccess = row.access === 'write' ? 'write' : row.access === 'comment' ? 'comment' : 'read';
    const list = byShare.get(row.share_id) ?? [];
    list.push(scoped ? { kind: row.resource_kind, access, lotId: row.project_lot_id } : { kind: row.resource_kind, access });
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
      resource_kind: g.kind, access: g.access, project_lot_id: g.lotId ?? null,
    })),
  );
  if (error) throw error;
}
