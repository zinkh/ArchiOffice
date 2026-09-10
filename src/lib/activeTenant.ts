// Le cabinet sur lequel cette session travaille.
//
// Un architecte peut exercer dans plusieurs structures (voir
// supabase/migrate_tenant_memberships.sql). Le serveur ne peut pas le deviner
// depuis le seul jeton : chaque requête vers /api le désigne par l'en-tête
// X-Tenant-Id, posé ici.
//
// Le choix est gardé dans le localStorage plutôt qu'en mémoire pour survivre
// à un rechargement — la bascule elle-même en provoque un (voir
// switchTenant() dans src/UserContext.tsx). Il est aussi enregistré côté
// serveur comme cabinet par défaut, ce qui fait qu'un autre poste rouvre
// l'application sur le même cabinet.

const ACTIVE_TENANT_KEY = 'archioffice_active_tenant';

export function getActiveTenantId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TENANT_KEY) || null;
  } catch {
    // localStorage indisponible (navigation privée) : le serveur retombe
    // alors sur le cabinet par défaut du compte, ce qui reste utilisable.
    return null;
  }
}

export function setActiveTenantId(tenantId: string | null): void {
  try {
    if (tenantId) localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
    else localStorage.removeItem(ACTIVE_TENANT_KEY);
  } catch {
    // idem
  }
}

/**
 * Pose l'en-tête de cabinet sur une requête /api, sans écraser celui qu'un
 * appelant aurait déjà choisi.
 */
export function applyTenantHeader(headers: Headers): Headers {
  const tenantId = getActiveTenantId();
  if (tenantId && !headers.has('X-Tenant-Id')) headers.set('X-Tenant-Id', tenantId);
  return headers;
}

/**
 * Le serveur répond 403 TENANT_NOT_MEMBER quand le cabinet demandé n'est plus
 * l'un des siens (départ du cabinet, adhésion révoquée). Le sélectionné est
 * alors effacé et la page rechargée : la session reprend sur le cabinet par
 * défaut du compte au lieu de rejouer indéfiniment une requête refusée.
 */
export function handleTenantRejection(): void {
  setActiveTenantId(null);
  try {
    window.location.reload();
  } catch {
    // Hors navigateur (tests) : rien à recharger.
  }
}
