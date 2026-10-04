// Cabinet suspendu par le superadmin plateforme (voir
// server/tenantSuspension.ts). Le serveur refuse alors toute requête visant ce
// cabinet en 403 TENANT_SUSPENDED. Ici, on transforme ce refus en un signal
// unique que l'écran de blocage (TenantSuspendedGate) écoute, plutôt que de
// laisser chaque page afficher sa propre erreur générique.

export const TENANT_SUSPENDED_CODE = 'TENANT_SUSPENDED';
export const TENANT_SUSPENDED_EVENT = 'archioffice:tenant-suspended';

export function signalTenantSuspended(message?: string): void {
  try {
    window.dispatchEvent(new CustomEvent(TENANT_SUSPENDED_EVENT, { detail: { message } }));
  } catch {
    // Hors navigateur (tests) : rien à signaler.
  }
}

/**
 * Inspecte une réponse /api passée par `window.fetch` (ou tout appel qui
 * n'emprunte pas baseFetchJson) et signale la suspension le cas échéant. Ne
 * lit jamais le corps de la réponse d'origine : seule une copie l'est, et
 * seulement sur un 403.
 */
export function inspectForSuspension(res: Response): void {
  if (res.status !== 403) return;
  res.clone().json().then((body) => {
    if (body?.code === TENANT_SUSPENDED_CODE) signalTenantSuspended(body?.error);
  }).catch(() => {
    // Corps non JSON : pas une réponse de suspension.
  });
}
