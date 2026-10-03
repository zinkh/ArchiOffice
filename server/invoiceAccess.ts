// Qui voit et qui écrit les factures, selon le rôle.
//
// - `admin` et `manager` : inchangé (toute l'agence côté serveur, le manager
//   étant ramené à son équipe par le tableau de bord).
// - `pm` (chef de projet) : voit les factures de SES affaires, celles dont il
//   est membre (`project_members`), et ne crée, ne modifie ni ne supprime
//   aucune facture. Il prépare des notes d'honoraires, la facture reste émise
//   par l'administrateur ou le manager.
// - `user` n'est volontairement PAS restreint : c'est le rôle par défaut d'un
//   membre, et lui retirer la facturation casserait les cabinets existants.
//
// Un rôle inconnu ou absent (instance non migrée, mode local) n'est PAS
// restreint : on ne ferme un accès qu'à un rôle explicitement limité, pour ne
// rien casser là où aucun rôle n'est renseigné.

import { getMemberRole } from './tenantMemberships';

const RESTRICTED_ROLES = ['pm'];

export function isRestrictedRole(systemRole: string | null | undefined): boolean {
  return !!systemRole && RESTRICTED_ROLES.includes(systemRole);
}

export async function getCallerRole(supabaseAdmin: any, tenantId: string, userId: string): Promise<string | null> {
  const membership = await getMemberRole(supabaseAdmin, tenantId, userId);
  return membership?.systemRole ?? null;
}

/**
 * Les affaires dont la personne est membre, ou `null` quand elle n'est pas
 * restreinte (toutes les affaires). Table absente : ensemble vide, un rôle
 * limité ne doit jamais retomber sur « tout voir ».
 */
export async function visibleProjectIds(
  supabaseAdmin: any, tenantId: string, userId: string, systemRole: string | null,
): Promise<Set<string> | null> {
  if (!isRestrictedRole(systemRole)) return null;
  const { data, error } = await supabaseAdmin
    .from('project_members')
    .select('project_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId);
  if (error) return new Set();
  return new Set((data || []).map((r: any) => r.project_id));
}

/**
 * Garde d'écriture des factures : répond 403 et renvoie false pour un rôle
 * limité. À appeler en tête de route (`if (!(await ...)) return;`).
 */
export async function ensureCanWriteInvoices(
  supabaseAdmin: any, tenantId: string, userId: string, res: any,
): Promise<boolean> {
  const role = await getCallerRole(supabaseAdmin, tenantId, userId);
  if (!isRestrictedRole(role)) return true;
  res.status(403).json({
    error: 'Votre rôle ne permet pas de créer ou modifier une facture. Préparez une note d\'honoraires : l\'administrateur ou un manager émettra la facture.',
    code: 'INVOICE_WRITE_FORBIDDEN',
  });
  return false;
}
