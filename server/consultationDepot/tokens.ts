// Jetons des liens de dépôt. Le jeton clair n'existe que dans le lien remis à
// l'entreprise : la base ne garde que son SHA-256, comme pour les jetons
// d'automatisation (server/automationApiKeys.ts). Un export de la base ne
// donne donc aucun lien utilisable.
import crypto from 'crypto';

export const DEPOT_TOKEN_PREFIX = 'dpt_';
const FORME = /^dpt_[A-Za-z0-9_-]{43}$/;

export function genererJeton(): string {
  return DEPOT_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function hacherJeton(jeton: string): string {
  return crypto.createHash('sha256').update(jeton).digest('hex');
}

/** Filtre les valeurs absurdes avant tout accès à la base. */
export function jetonPlausible(jeton: unknown): jeton is string {
  return typeof jeton === 'string' && FORME.test(jeton);
}

export function lienDepot(jeton: string): string {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  return `${base}/depot/${jeton}`;
}
