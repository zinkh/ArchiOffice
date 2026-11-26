// Barrière du collaborateur externe : refus par défaut.
//
// Un confrère invité sur une affaire sans cabinet à lui reçoit une adhésion de
// rôle `guest` au cabinet qui l'invite (c'est ce qui lui ouvre l'application,
// sans quoi il serait « sans agence »). Ce rôle ne donne RIEN par lui-même :
// ce garde, monté avant toutes les routes (server.ts), ne laisse passer que
// l'espace partagé (/api/shared), son propre profil et l'état du service.
//
// Refuser par défaut plutôt qu'énumérer les routes interdites : la centaine de
// routes du serveur ne connaissent pas ce rôle, et une route ajoutée demain ne
// doit pas s'ouvrir à un invité par oubli. Cela ferme aussi l'IA (coût au
// cabinet), les envois d'e-mail, la facturation, l'équipe et les contacts.
import { getMemberRole } from './tenantMemberships';
import { GUEST_SYSTEM_ROLE } from './projectShares/access';

/** Premiers segments d'URL (sans /api) ouverts à un invité. */
export const GUEST_ALLOWED_SEGMENTS = new Set(['shared', 'me', 'health']);

const REPONSE = {
  error: "Votre accès de collaborateur externe se limite aux affaires partagées avec vous.",
  code: 'GUEST_FORBIDDEN',
};

// Court cache (10 s) du rôle par personne et cabinet : le garde passe sur chaque
// requête /api, et le rôle ne change qu'à l'invitation ou au retrait.
const CACHE_TTL_MS = 10_000;
const roleCache = new Map<string, { guest: boolean; at: number }>();

/** À appeler quand une adhésion `guest` est créée ou retirée. */
export function invalidateGuestRoleCache(userId?: string) {
  if (!userId) { roleCache.clear(); return; }
  for (const key of roleCache.keys()) if (key.startsWith(`${userId}|`)) roleCache.delete(key);
}

async function isGuestIn(supabaseAdmin: any, tenantId: string, userId: string): Promise<boolean> {
  const key = `${userId}|${tenantId}`;
  const cached = roleCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.guest;
  const membership = await getMemberRole(supabaseAdmin, tenantId, userId);
  const guest = membership?.systemRole === GUEST_SYSTEM_ROLE;
  roleCache.set(key, { guest, at: Date.now() });
  return guest;
}

export function guestAccessGuard({ supabaseAdmin, getTenantId }: {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}) {
  return async (req: any, res: any, next: any) => {
    // Routes publiques (exemptées d'authentification) : pas de personne, rien à garder.
    if (!req.user?.id) return next();
    const first = String(req.path || '').split('?')[0].split('/').filter(Boolean)[0] ?? '';
    if (GUEST_ALLOWED_SEGMENTS.has(first)) return next();
    try {
      const tenantId = await getTenantId(req.user.id);
      if (await isGuestIn(supabaseAdmin, tenantId, req.user.id)) return res.status(403).json(REPONSE);
      return next();
    } catch (e: any) {
      // Compte sans cabinet : la route répond elle-même (NO_TENANT).
      if (e?.code === 'NO_TENANT') return next();
      // Un garde de sécurité qui tombe FERME l'accès : l'ouvrir laisserait
      // passer un invité pendant une panne de base.
      console.error('[guestAccessGuard]', e);
      return res.status(503).json({ error: 'Service momentanément indisponible.' });
    }
  };
}
