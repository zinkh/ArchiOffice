// L'abonnement d'un cabinet (tenants.plan, tenants.trial_ends_at) vit sur le
// cloud : c'est là que le cabinet paie et renouvelle. La table `tenants` n'est
// pas dans SYNC_TABLES, et le lien cloud n'en copiait que id, slug et name :
// la copie locale prenait donc les valeurs par défaut de la base, soit un essai
// de 14 jours à la date du lien. Passé ce délai, le poste affichait « essai
// expiré » (plafonds à zéro, création bloquée en 402) même pour un cabinet à
// jour de son abonnement.
//
// Meilleur effort : un échec (hors ligne, session expirée) laisse l'abonnement
// local tel quel et n'interrompt jamais le lien ni la synchronisation.
import type { SupabaseClient } from '@supabase/supabase-js';

export const TENANT_PLAN_REFRESH_MS = 10 * 60 * 1000;

export interface TenantPlanSnapshot {
  plan: string;
  trial_ends_at: string | null;
}

export async function readCloudTenantPlan(
  cloudClient: SupabaseClient,
  tenantId: string,
): Promise<TenantPlanSnapshot | null> {
  const { data, error } = await cloudClient
    .from('tenants')
    .select('plan, trial_ends_at')
    .eq('id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { plan?: string | null; trial_ends_at?: string | null };
  // Sans plan lisible on n'écrit rien : mieux vaut garder l'état local que de
  // le remplacer par une valeur vide.
  if (!row.plan) return null;
  return { plan: row.plan, trial_ends_at: row.trial_ends_at ?? null };
}

/** Recopie l'abonnement du cloud dans la base locale. Rend vrai si écrit. */
export async function pullTenantPlan(
  cloudClient: SupabaseClient,
  supabaseAdmin: SupabaseClient,
  tenantId: string,
): Promise<boolean> {
  try {
    const snapshot = await readCloudTenantPlan(cloudClient, tenantId);
    if (!snapshot) return false;
    const { error } = await supabaseAdmin
      .from('tenants')
      .update({ plan: snapshot.plan, trial_ends_at: snapshot.trial_ends_at })
      .eq('id', tenantId);
    return !error;
  } catch {
    return false;
  }
}
