// Jetons des liens de dépôt du DOE. Le jeton clair n'existe que dans le lien
// remis à l'entreprise : la base ne garde que son SHA-256 (comme pour le dépôt
// des offres, server/consultationDepot/tokens.ts). Un export de la base ne
// donne donc aucun lien utilisable.
import crypto from 'crypto';

export const DOE_TOKEN_PREFIX = 'doe_';
const FORME = /^doe_[A-Za-z0-9_-]{43}$/;

export function genererJetonDoe(): string {
  return DOE_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function hacherJetonDoe(jeton: string): string {
  return crypto.createHash('sha256').update(jeton).digest('hex');
}

/** Filtre les valeurs absurdes avant tout accès à la base. */
export function jetonDoePlausible(jeton: unknown): jeton is string {
  return typeof jeton === 'string' && FORME.test(jeton);
}

export function lienDoe(jeton: string): string {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  return `${base}/doe/${jeton}`;
}
