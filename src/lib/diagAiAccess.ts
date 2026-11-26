// Accès à la rédaction assistée par l'IA des rapports de diagnostic (onglet DIAG).
//
//   - `full`    : plan Enterprise ;
//   - `preview` : essai de 15 jours en cours, l'architecte découvre la fonction ;
//   - `locked`  : tout autre plan, ou essai expiré.
//
// Le serveur reste l'autorité (`getTenantPlan` rend déjà « expired » quand l'essai est fini) ;
// l'écran applique la même règle pour afficher le bon message avant tout appel.
export type DiagAiAccess = 'full' | 'preview' | 'locked';

export function diagAiAccess(plan: string | null | undefined, trialEndsAt?: string | null, now: Date = new Date()): DiagAiAccess {
  const p = plan || 'trial';
  if (p === 'enterprise') return 'full';
  if (p === 'trial') {
    const end = trialEndsAt ? new Date(trialEndsAt) : null;
    if (end && !Number.isNaN(end.getTime()) && end < now) return 'locked';
    return 'preview';
  }
  return 'locked';
}
