// Résolution d'un lien de dépôt : le jeton présenté → l'invitation du cabinet.
import { hacherJeton, jetonPlausible } from './tokens';

export interface InvitationDepot {
  id: string;
  tenant_id: string;
  project_id: string;
  entreprise_id: string;
  entreprise_nom: string;
  contact_id: string | null;
  email: string | null;
  lots_ids: string[];
  expires_at: string;
  revoked_at: string | null;
  last_opened_at: string | null;
  created_at: string;
}

/**
 * L'invitation active d'un jeton, ou null. Un jeton mal formé, inconnu, révoqué
 * ou expiré donne la même réponse : on ne dit jamais à un tiers lequel de ces
 * cas s'applique.
 */
export async function resoudreInvitation(
  supabaseAdmin: any,
  jeton: unknown,
  now: Date = new Date(),
): Promise<InvitationDepot | null> {
  if (!jetonPlausible(jeton)) return null;
  const { data } = await supabaseAdmin
    .from('consultation_depot_invites')
    .select('*')
    .eq('token_hash', hacherJeton(jeton))
    .maybeSingle();
  if (!data) return null;
  const inv = data as InvitationDepot;
  if (inv.revoked_at) return null;
  if (new Date(inv.expires_at).getTime() <= now.getTime()) return null;
  return { ...inv, lots_ids: Array.isArray(inv.lots_ids) ? inv.lots_ids : [] };
}
