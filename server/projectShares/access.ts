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

/**
 * Ateliers partageables aujourd'hui (les autres suivront, voir ROADMAP.md). Un droit se donne PAR ATELIER,
 * jamais par lot : aucun accès, lecture (et commentaire là où il existe), ou lecture et modification.
 */
export const SHARE_KINDS = ['lots', 'tasks', 'documents', 'cctp', 'dpgf', 'act', 'reports', 'reserves', 'gpa'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
/** Du plus faible au plus fort : lire < commenter < écrire. Chaque niveau comprend les précédents. */
export type ShareAccess = 'read' | 'comment' | 'write';

/**
 * Types sur lesquels une écriture a un sens et est branchée côté serveur.
 * Pour `tasks`, « écrire » modifie la tâche. Pour `cctp` et `dpgf`, « écrire » signifie PROPOSER :
 * l'invité n'écrit jamais dans le document, il dépose une proposition que le cabinet
 * valide (server/routes/projectShareProposals.ts). Le CCTP couvre les textes et titres, le DPGF
 * les quantités, prix et unités. Pour `reports` (comptes rendus de chantier), `reserves` (réserves
 * AOR) et `gpa` (réserves GPA), « écrire » modifie directement une liste blanche de champs de LA
 * ligne visée (server/routes/projectShareChantier.ts) : chaque ligne est un enregistrement
 * indépendant, pas un document JSON réécrit en bloc, une proposition n'y a pas d'intérêt.
 */
export const WRITABLE_KINDS: readonly ShareKind[] = ['tasks', 'cctp', 'dpgf', 'reports', 'reserves', 'gpa'];
/** Types qu'un invité peut commenter (sans rien modifier). */
export const COMMENTABLE_KINDS: readonly ShareKind[] = ['cctp', 'dpgf'];
/**
 * Plus aucun droit par lot : un atelier est accordé en entier. Les droits par lot d'avant (CCTP, DPGF)
 * sont convertis par supabase/migrate_project_share_ateliers.sql, et la lecture ignore toute ligne qui
 * porte encore un lot (refus par défaut : jamais un accès plus large que celui qui avait été accordé).
 */
export const LOT_SCOPED_KINDS: readonly ShareKind[] = [];
/** Borne de taille d'une liste de droits reçue d'un client. */
export const MAX_GRANTS_PER_SHARE = 200;
const ACCESS_RANK: Record<ShareAccess, number> = { read: 0, comment: 1, write: 2 };

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
  /** Fiche contact du confrère dans l'annuaire du cabinet (suivi des collaborations). Absente sur une instance non migrée. */
  confrere_contact_id?: string | null;
  created_at?: string;
  revoked_at?: string | null;
}

export type LimitCheck = { ok: true } | { ok: false; code: string; message: string };

/**
 * Valide et normalise les droits reçus d'un client. Un atelier n'y figure qu'une fois : en cas de doublon
 * le niveau le plus haut l'emporte. Un `lotId` envoyé par un ancien client (agent, MCP) est ignoré : le droit
 * vaut pour l'atelier entier, c'est au cabinet de décider de l'accorder ou non.
 */
export function normalizeGrants(input: unknown): { grants: ShareGrant[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: 'Accordez au moins un droit : sans droit, le confrère ne verrait rien.' };
  }
  if (input.length > MAX_GRANTS_PER_SHARE) return { error: 'Trop de droits dans une même demande.' };
  const byKind = new Map<ShareKind, ShareGrant>();
  for (const raw of input) {
    const kind = raw?.kind;
    const access = raw?.access;
    if (!SHARE_KINDS.includes(kind)) return { error: `Atelier non partageable : ${String(kind)}.` };
    if (access !== 'read' && access !== 'comment' && access !== 'write') {
      return { error: `Droit invalide pour ${kind} : « lecture », « commentaire » ou « écriture ».` };
    }
    if (access === 'write' && !WRITABLE_KINDS.includes(kind)) {
      return { error: `La modification n'est pas disponible pour ${kind} : accordez la lecture.` };
    }
    if (access === 'comment' && !COMMENTABLE_KINDS.includes(kind)) {
      return { error: `Les commentaires ne sont pas disponibles pour ${kind} : accordez la lecture.` };
    }
    const current = byKind.get(kind);
    if (!current || ACCESS_RANK[access] > ACCESS_RANK[current.access]) byKind.set(kind, { kind, access });
  }
  return { grants: [...byKind.values()] };
}

/**
 * Le droit couvre-t-il l'accès demandé ? Chaque niveau comprend les précédents
 * (écrire implique commenter, qui implique lire). Le troisième paramètre n'existe que pour les appelants
 * d'avant les ateliers : un lot ne change plus rien au droit.
 */
export function allows(grants: readonly ShareGrant[], kind: ShareKind, access: ShareAccess, _lotId?: string): boolean {
  const grant = grants.find(g => g.kind === kind);
  if (!grant) return false;
  return ACCESS_RANK[grant.access] >= ACCESS_RANK[access];
}

/**
 * Les lots de l'affaire sur lesquels le niveau demandé est accordé : tous si l'atelier l'est, aucun sinon.
 * Les vues CCTP et DPGF se construisent encore lot par lot (le document est découpé ainsi), mais le
 * droit, lui, est celui de l'atelier.
 */
export async function lotIdsForAtelier(
  supabaseAdmin: any, share: Pick<ShareRow, 'tenant_id' | 'project_id'>, grants: readonly ShareGrant[], kind: ShareKind, access: ShareAccess = 'read',
): Promise<Set<string>> {
  if (!allows(grants, kind, access)) return new Set();
  const { data } = await supabaseAdmin.from('project_lots').select('id')
    .eq('project_id', share.project_id).eq('tenant_id', share.tenant_id);
  return new Set<string>((data || []).map((l: any) => l.id));
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
    // Un droit qui porte encore un lot date d'avant les ateliers : il n'ouvre rien tant que la migration
    // (migrate_project_share_ateliers.sql) ne l'a pas converti, plutôt que d'ouvrir tout l'atelier par erreur.
    if (row.project_lot_id) continue;
    const access: ShareAccess = row.access === 'write' ? 'write' : row.access === 'comment' ? 'comment' : 'read';
    const list = byShare.get(row.share_id) ?? [];
    const current = list.find(g => g.kind === row.resource_kind);
    if (!current) list.push({ kind: row.resource_kind, access });
    else if (ACCESS_RANK[access] > ACCESS_RANK[current.access]) current.access = access;
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
      resource_kind: g.kind, access: g.access, project_lot_id: null,
    })),
  );
  if (error) throw error;
}
