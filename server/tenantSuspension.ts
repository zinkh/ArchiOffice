// Suspension d'un cabinet par le superadmin plateforme (litige entre associés,
// compte administrateur piraté ou malveillant).
//
// Un cabinet suspendu est bloqué pour TOUS ses membres, administrateurs
// compris : toute requête /api qui vise ce cabinet est refusée en
// 403 TENANT_SUSPENDED. Rien n'est supprimé — la suspension gèle, elle ne
// détruit pas. Seul le superadmin peut la lever (server/routes/superAdmin.ts).
//
// Le contrôle vit dans le middleware d'authentification (server.ts) plutôt
// que dans chaque route : une soixantaine de fichiers de routes écrivent,
// et un contrôle à la carte en oublierait un.
import { resolveActiveTenantId } from './tenantMemberships';
import { isSuperAdmin } from './superAdminAuth';

export const TENANT_SUSPENDED_CODE = 'TENANT_SUSPENDED';
export const TENANT_SUSPENDED_MESSAGE =
  "Ce cabinet est suspendu. Contactez le support ArchiOffice pour en savoir plus.";

// Les cabinets suspendus se comptent sur les doigts d'une main : on relit la
// liste entière, brièvement mise en cache, plutôt qu'un cabinet par requête.
// Quand aucun cabinet n'est suspendu (le cas courant), le coût d'une requête
// se réduit à lire ce cache.
const CACHE_TTL_MS = 10_000;

export interface TenantSuspension {
  tenantId: string;
  suspendedAt: string;
}

let cache: { loadedAt: number; byTenant: Map<string, TenantSuspension> } | null = null;

export function invalidateSuspensionCache(): void {
  cache = null;
}

export async function loadSuspendedTenants(supabaseAdmin: any): Promise<Map<string, TenantSuspension>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.byTenant;
  const byTenant = new Map<string, TenantSuspension>();
  try {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id, suspended_at')
      .not('suspended_at', 'is', null);
    // Colonne absente (instance dont la migration n'a pas encore été jouée) :
    // aucune suspension plutôt qu'une API entière en erreur.
    if (!error) {
      (data || []).forEach((t: any) => byTenant.set(t.id, { tenantId: t.id, suspendedAt: t.suspended_at }));
    }
  } catch {
    // idem
  }
  cache = { loadedAt: Date.now(), byTenant };
  return byTenant;
}

/**
 * Ce qu'un membre d'un cabinet suspendu peut encore appeler : de quoi
 * s'identifier, voir ses cabinets et basculer sur un autre. Rien d'autre —
 * en particulier ni lecture, ni écriture, ni export du cabinet suspendu.
 */
export function isSuspensionExempt(method: string, pathOnly: string): boolean {
  if (pathOnly === '/api/health') return true;
  // Le back-office plateforme se garde lui-même (requireSuperAdmin).
  if (pathOnly === '/api/admin' || pathOnly.startsWith('/api/admin/')) return true;
  const m = method.toUpperCase();
  if (m === 'GET' && (pathOnly === '/api/me' || pathOnly === '/api/tenants' || pathOnly === '/api/tenants/active')) return true;
  if (m === 'POST' && pathOnly === '/api/tenants/switch') return true;
  return false;
}

/**
 * La suspension qui s'applique à cette requête, ou null.
 *
 * `tenantId` est le cabinet désigné par la requête (en-tête X-Tenant-Id,
 * jeton MCP/Telegram/automatisation). Sans lui, c'est le cabinet par défaut
 * du compte qui sert — il faut donc le résoudre, mais seulement s'il existe
 * au moins un cabinet suspendu.
 *
 * `user` n'est fourni que pour une session humaine : le superadmin garde la
 * main sur un cabinet suspendu (il doit pouvoir l'inspecter avant de décider).
 */
export async function suspensionFor(
  supabaseAdmin: any,
  params: { userId: string; tenantId: string | null; user?: { id?: string; email?: string }; method: string; pathOnly: string },
): Promise<TenantSuspension | null> {
  const suspended = await loadSuspendedTenants(supabaseAdmin);
  if (suspended.size === 0) return null;
  if (isSuspensionExempt(params.method, params.pathOnly)) return null;

  let tenantId = params.tenantId;
  if (!tenantId) {
    try {
      tenantId = await resolveActiveTenantId(supabaseAdmin, params.userId, null);
    } catch {
      return null; // compte rattaché à aucun cabinet : rien à suspendre
    }
  }
  const suspension = suspended.get(tenantId);
  if (!suspension) return null;
  if (params.user && (await isSuperAdmin(supabaseAdmin, params.user))) return null;
  return suspension;
}
