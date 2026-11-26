// Qui peut partager une affaire : les administrateurs et managers du cabinet.
//
// Partager, c'est ouvrir les données du cabinet à un tiers : on ne le fait pas sans
// en avoir le pouvoir. Le rôle se lit sur l'ADHÉSION au cabinet actif, jamais sur
// `profiles` (voir server/tenantMemberships.ts).
import { getMemberRole } from '../tenantMemberships';

export function makeRequireSharer(supabaseAdmin: any, getTenantId: (userId: string) => Promise<string>) {
  /** Le cabinet de l'appelant, ou une erreur 403 s'il n'y est ni administrateur ni manager. */
  return async function requireSharer(userId: string): Promise<string> {
    const tenantId = await getTenantId(userId);
    const membership = await getMemberRole(supabaseAdmin, tenantId, userId);
    if (!membership || !['admin', 'manager'].includes(membership.systemRole ?? '')) {
      const err: any = new Error('Réservé aux administrateurs et managers du cabinet.');
      err.status = 403;
      throw err;
    }
    return tenantId;
  };
}
