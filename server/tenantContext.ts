import { AsyncLocalStorage } from 'node:async_hooks';

// Le cabinet actif de la requête en cours.
//
// Toutes les routes résolvent leur cabinet par `getTenantId(req.user.id)` —
// une signature qui ne reçoit que l'identifiant de la personne, et qui est
// injectée dans une soixantaine de fichiers de routes. Avec plusieurs
// cabinets par personne, cet identifiant ne suffit plus à trancher : il faut
// aussi savoir sur lequel la requête travaille (l'en-tête X-Tenant-Id).
//
// Plutôt que de propager un paramètre supplémentaire dans chaque appel de
// chaque route, le middleware d'authentification dépose le cabinet résolu ici
// et `getTenantId()` le relit. AsyncLocalStorage est fait pour ça : le
// contexte suit la chaîne asynchrone de la requête, et deux requêtes
// simultanées ne peuvent pas se mélanger.
//
// Le contexte est absent hors requête HTTP (traitements de fond : relances,
// alertes métier, exécutions planifiées). C'est voulu : ces traitements
// bouclent déjà sur les cabinets eux-mêmes et n'ont aucun « cabinet actif »
// à hériter.

export interface TenantRequestContext {
  userId: string;
  tenantId: string | null;
}

const storage = new AsyncLocalStorage<TenantRequestContext>();

export function runWithTenantContext<T>(ctx: TenantRequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Le cabinet actif de la requête en cours, pour cette personne précise.
 *
 * La comparaison sur `userId` n'est pas décorative : une route qui résout le
 * cabinet d'une AUTRE personne que l'appelant (approbation d'une demande de
 * rattachement, outils d'agent) ne doit pas récupérer le cabinet actif de
 * l'appelant à sa place.
 */
export function activeTenantFor(userId: string): string | null {
  const ctx = storage.getStore();
  if (!ctx || ctx.userId !== userId) return null;
  return ctx.tenantId;
}

/** L'en-tête par lequel le client désigne le cabinet sur lequel il travaille. */
export const TENANT_HEADER = 'x-tenant-id';
