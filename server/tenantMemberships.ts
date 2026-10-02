// Appartenance d'une personne à un ou plusieurs cabinets.
//
// `profiles` porte une ligne par personne (clé = compte auth), donc un seul
// `tenant_id` : un architecte exerçant dans deux structures ne pouvait
// appartenir qu'à une seule. `tenant_memberships` (voir
// supabase/migrate_tenant_memberships.sql) porte le couple personne × cabinet
// et le rôle tenu DANS ce cabinet — on est souvent gérant du sien et simple
// collaborateur dans l'autre.
//
// `profiles.tenant_id` n'est pas abandonné pour autant : il reste le cabinet
// PAR DÉFAUT (celui sur lequel une session s'ouvre) et, surtout, le repli
// complet de ce module — une instance qui n'a pas encore joué la migration,
// ou une table d'adhésions vide, continue de fonctionner exactement comme
// avant. C'est ce repli qui rend le changement rétrocompatible plutôt que
// dépendant d'une migration réussie partout.

export interface Membership {
  tenantId: string;
  role: string | null;
  systemRole: string | null;
  managerId: string | null;
  isDefault: boolean;
}

export interface MembershipWithTenant extends Membership {
  tenantName: string | null;
}

function notAttachedError(): Error & { status?: number; code?: string } {
  const err: any = new Error("Ce compte n'est rattaché à aucune agence. Veuillez d'abord créer ou rejoindre une agence.");
  err.status = 409;
  err.code = 'NO_TENANT';
  return err;
}

export function notMemberError(): Error & { status?: number; code?: string } {
  const err: any = new Error("Vous n'appartenez pas à ce cabinet.");
  err.status = 403;
  err.code = 'TENANT_NOT_MEMBER';
  return err;
}

/** Lignes brutes de `tenant_memberships`, jamais une erreur : une table absente vaut « aucune adhésion ». */
async function rawMemberships(supabaseAdmin: any, userId: string): Promise<any[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('tenant_memberships')
      .select('tenant_id, role, system_role, manager_id, is_default, created_at')
      .eq('user_id', userId);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

async function profileRow(supabaseAdmin: any, userId: string): Promise<any | null> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('tenant_id, role, system_role, manager_id')
    .eq('id', userId)
    .maybeSingle();
  return data || null;
}

/**
 * Tous les cabinets de la personne, celui par défaut en tête.
 * Le cabinet de `profiles.tenant_id` est ajouté s'il manque parmi les
 * adhésions, pour que le repli décrit en tête de fichier tienne.
 */
export async function listMemberships(supabaseAdmin: any, userId: string): Promise<Membership[]> {
  const [rows, profile] = await Promise.all([
    rawMemberships(supabaseAdmin, userId),
    profileRow(supabaseAdmin, userId),
  ]);

  const memberships: Membership[] = rows.map((r: any) => ({
    tenantId: r.tenant_id,
    role: r.role ?? null,
    systemRole: r.system_role ?? null,
    managerId: r.manager_id ?? null,
    isDefault: !!r.is_default,
  }));

  if (profile?.tenant_id && !memberships.some(m => m.tenantId === profile.tenant_id)) {
    memberships.push({
      tenantId: profile.tenant_id,
      role: profile.role ?? null,
      systemRole: profile.system_role ?? null,
      managerId: profile.manager_id ?? null,
      isDefault: true,
    });
  }

  // Défaut d'abord ; à défaut de défaut, le cabinet du profil ; sinon l'ordre
  // d'arrivée, que la requête ci-dessus préserve.
  const defaultTenantId = profile?.tenant_id ?? null;
  return memberships.sort((a, b) => {
    const score = (m: Membership) => (m.isDefault ? 0 : m.tenantId === defaultTenantId ? 1 : 2);
    return score(a) - score(b);
  });
}

/** Les mêmes, avec le nom du cabinet — pour le sélecteur de cabinet côté client. */
export async function listMembershipsWithTenants(supabaseAdmin: any, userId: string): Promise<MembershipWithTenant[]> {
  const memberships = await listMemberships(supabaseAdmin, userId);
  if (!memberships.length) return [];
  // Deux requêtes plutôt qu'une jointure PostgREST imbriquée : le nom vient de
  // `tenants`, et l'écrire en deux temps garde la fonction lisible côté test.
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .in('id', memberships.map(m => m.tenantId));
  const names = new Map<string, string>((tenants || []).map((t: any) => [t.id, t.name]));
  return memberships.map(m => ({ ...m, tenantName: names.get(m.tenantId) ?? null }));
}

/** L'adhésion à ce cabinet précis, ou null si la personne n'en fait pas partie. */
export async function findMembership(supabaseAdmin: any, userId: string, tenantId: string): Promise<Membership | null> {
  const memberships = await listMemberships(supabaseAdmin, userId);
  return memberships.find(m => m.tenantId === tenantId) ?? null;
}

/**
 * Le cabinet sur lequel une requête doit agir.
 * `requested` vient de l'en-tête X-Tenant-Id : il n'est jamais cru sur parole,
 * seulement accepté s'il correspond à une adhésion réelle.
 */
export async function resolveActiveTenantId(supabaseAdmin: any, userId: string, requested?: string | null): Promise<string> {
  const memberships = await listMemberships(supabaseAdmin, userId);
  if (!memberships.length) throw notAttachedError();
  if (requested) {
    const match = memberships.find(m => m.tenantId === requested);
    if (!match) throw notMemberError();
    return match.tenantId;
  }
  return memberships[0].tenantId;
}

/**
 * Le rôle tenu dans CE cabinet. L'adhésion fait foi ; le profil ne sert de
 * repli que pour son propre cabinet, jamais pour un autre — sans quoi un
 * collaborateur d'un cabinet hériterait de son rôle d'administrateur de
 * l'autre.
 */
export async function getMemberRole(
  supabaseAdmin: any, tenantId: string, userId: string,
): Promise<{ role: string | null; systemRole: string | null; managerId: string | null } | null> {
  const membership = await findMembership(supabaseAdmin, userId, tenantId);
  if (!membership) return null;
  return { role: membership.role, systemRole: membership.systemRole, managerId: membership.managerId };
}

/** Les identifiants des personnes rattachées à ce cabinet (adhésions ∪ profils). */
export async function listTenantMemberIds(supabaseAdmin: any, tenantId: string): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const { data, error } = await supabaseAdmin
      .from('tenant_memberships')
      .select('user_id')
      .eq('tenant_id', tenantId);
    if (!error) (data || []).forEach((r: any) => ids.add(r.user_id));
  } catch {
    // Table absente : le repli sur `profiles` ci-dessous suffit.
  }
  const { data: profiles } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', tenantId);
  (profiles || []).forEach((p: any) => ids.add(p.id));
  return [...ids];
}

/**
 * Les profils des personnes rattachées à ce cabinet.
 *
 * Remplace le `tenantScopedFrom(..., 'profiles')` d'avant, qui filtrait sur
 * `profiles.tenant_id` : ce filtre ne voyait plus que les personnes dont
 * c'est le cabinet PAR DÉFAUT, et faisait donc disparaître des listes
 * (équipe, mentions, notifications, congés) celles qui exercent aussi
 * ailleurs.
 */
export async function listTenantProfiles(
  supabaseAdmin: any, tenantId: string, columns = 'id, name',
): Promise<any[]> {
  const ids = await listTenantMemberIds(supabaseAdmin, tenantId);
  if (!ids.length) return [];
  const { data } = await supabaseAdmin.from('profiles').select(columns).in('id', ids);
  return data || [];
}

/** Les administrateurs du cabinet — ceux qui reçoivent les demandes de rattachement. */
export async function listTenantAdminIds(supabaseAdmin: any, tenantId: string): Promise<string[]> {
  const memberships = await tenantMembershipsByUser(supabaseAdmin, tenantId);
  const admins = new Set<string>();
  memberships.forEach((m, userId) => { if (m.systemRole === 'admin') admins.add(userId); });
  // Repli pour les comptes qu'aucune adhésion ne couvre encore.
  const { data } = await supabaseAdmin
    .from('profiles').select('id').eq('tenant_id', tenantId).eq('system_role', 'admin');
  (data || []).forEach((p: any) => { if (!memberships.has(p.id)) admins.add(p.id); });
  return [...admins];
}

/** Les adhésions à ce cabinet, indexées par personne (rôle tenu localement). */
export async function tenantMembershipsByUser(supabaseAdmin: any, tenantId: string): Promise<Map<string, Membership>> {
  const byUser = new Map<string, Membership>();
  try {
    const { data, error } = await supabaseAdmin
      .from('tenant_memberships')
      .select('user_id, tenant_id, role, system_role, manager_id, is_default')
      .eq('tenant_id', tenantId);
    if (!error) {
      (data || []).forEach((r: any) => byUser.set(r.user_id, {
        tenantId: r.tenant_id,
        role: r.role ?? null,
        systemRole: r.system_role ?? null,
        managerId: r.manager_id ?? null,
        isDefault: !!r.is_default,
      }));
    }
  } catch {
    // Idem : l'appelant retombe sur les colonnes de `profiles`.
  }
  return byUser;
}

/**
 * Rattache une personne à un cabinet. `makeDefault` en fait son cabinet
 * d'ouverture de session (et met `profiles.tenant_id` en accord).
 */
export async function addMembership(supabaseAdmin: any, params: {
  userId: string; tenantId: string;
  role?: string | null; systemRole?: string | null; managerId?: string | null;
  makeDefault?: boolean;
}): Promise<void> {
  const { userId, tenantId, role, systemRole, managerId, makeDefault } = params;
  if (makeDefault) await clearDefault(supabaseAdmin, userId);
  await supabaseAdmin.from('tenant_memberships').upsert({
    user_id: userId,
    tenant_id: tenantId,
    role: role ?? 'Member',
    system_role: systemRole ?? 'user',
    manager_id: managerId ?? null,
    is_default: !!makeDefault,
  }, { onConflict: 'user_id,tenant_id' });
  if (makeDefault) {
    await supabaseAdmin.from('profiles').update({ tenant_id: tenantId }).eq('id', userId);
  }
}

/** Met à jour le rôle tenu dans un cabinet (sans toucher aux autres). */
export async function updateMembership(supabaseAdmin: any, params: {
  userId: string; tenantId: string;
  role?: string | null; systemRole?: string | null; managerId?: string | null;
}): Promise<void> {
  const patch: Record<string, any> = {};
  if (params.role !== undefined) patch.role = params.role;
  if (params.systemRole !== undefined) patch.system_role = params.systemRole;
  if (params.managerId !== undefined) patch.manager_id = params.managerId;
  if (!Object.keys(patch).length) return;
  await supabaseAdmin
    .from('tenant_memberships')
    .update(patch)
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId);
}

async function clearDefault(supabaseAdmin: any, userId: string): Promise<void> {
  // L'index unique partiel n'autorise qu'un seul défaut par personne : il faut
  // donc retirer l'ancien avant de poser le nouveau, pas l'inverse.
  await supabaseAdmin
    .from('tenant_memberships')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('is_default', true);
}

/**
 * Choisit le cabinet par défaut. Appelé au moment de la bascule : rouvrir
 * l'application sur un autre poste doit reprendre là où on s'est arrêté.
 */
export async function setDefaultTenant(supabaseAdmin: any, userId: string, tenantId: string): Promise<void> {
  const membership = await findMembership(supabaseAdmin, userId, tenantId);
  if (!membership) throw notMemberError();
  await clearDefault(supabaseAdmin, userId);
  // Une adhésion peut manquer si l'on est encore sur le repli `profiles` :
  // l'upsert la crée avec le rôle connu plutôt que d'échouer silencieusement.
  await supabaseAdmin.from('tenant_memberships').upsert({
    user_id: userId,
    tenant_id: tenantId,
    role: membership.role ?? 'Member',
    system_role: membership.systemRole ?? 'user',
    manager_id: membership.managerId ?? null,
    is_default: true,
  }, { onConflict: 'user_id,tenant_id' });
  await supabaseAdmin.from('profiles').update({ tenant_id: tenantId }).eq('id', userId);
}

/**
 * Les personnes dont CE cabinet est le seul — celles dont la suppression du
 * cabinet doit aussi emporter le compte.
 *
 * Une fermeture de cabinet supprimait jusqu'ici le compte d'authentification
 * de tous ses profils. Depuis qu'une même personne peut exercer dans deux
 * structures, fermer la première effacerait son compte alors qu'elle
 * travaille toujours dans la seconde : ce filtre est ce qui l'en empêche.
 */
export async function listUsersOnlyIn(supabaseAdmin: any, tenantId: string): Promise<string[]> {
  const memberIds = await listTenantMemberIds(supabaseAdmin, tenantId);
  const exclusive: string[] = [];
  for (const userId of memberIds) {
    const memberships = await listMemberships(supabaseAdmin, userId);
    if (memberships.every(m => m.tenantId === tenantId)) exclusive.push(userId);
  }
  return exclusive;
}

/** Détache une personne d'un cabinet. */
export async function removeMembership(supabaseAdmin: any, userId: string, tenantId: string): Promise<void> {
  await supabaseAdmin.from('tenant_memberships').delete().eq('user_id', userId).eq('tenant_id', tenantId);
  const profile = await profileRow(supabaseAdmin, userId);
  if (profile?.tenant_id === tenantId) {
    // Le profil pointait sur le cabinet quitté : le faire pointer sur ce qu'il
    // reste, sinon le compte se retrouverait « sans agence » alors qu'il en a
    // encore une.
    const remaining = await listMemberships(supabaseAdmin, userId);
    const next = remaining.find(m => m.tenantId !== tenantId) ?? null;
    await supabaseAdmin.from('profiles').update({ tenant_id: next?.tenantId ?? null }).eq('id', userId);
    if (next) await setDefaultTenant(supabaseAdmin, userId, next.tenantId);
  }
}
