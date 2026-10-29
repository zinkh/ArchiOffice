// The `documents`/`plans`/`cv`/`message-attachments`/`feed-attachments`
// storage buckets are private (see server/storagePaths.ts and the security
// audit) — a `file_url`/`attachment_url`/`cv_url` value read from the API is
// a stable *reference*, not a directly fetchable URL anymore. This resolves
// one to a signed URL (valid ~1h) via GET /api/storage/signed-url, which
// checks the caller's tenant owns the object before minting it.
import { apiFetch } from './api';
import i18n from '../i18n';

// Une liste de réserves affiche une miniature par ligne : sans cache, chaque rendu, chaque retour
// sur l'onglet et chaque rechargement de la liste redemandait une URL au serveur pour CHAQUE
// photo, et obtenait une URL différente, donc une image que le navigateur ne retrouvait jamais
// dans son cache. Sur iPad, ces requêtes se disputaient la connexion avec les envois de photos.
//
// On garde donc l'URL signée jusqu'à 80 % de sa durée de vie (le reste est une marge pour une
// page restée ouverte), on fusionne les demandes simultanées pour une même référence, et on limite
// le nombre de résolutions en parallèle pour ne pas saturer la connexion.
const FALLBACK_TTL_MS = 20 * 60_000;
const TTL_SHARE = 0.8;
const MAX_CACHED = 500;
const MAX_PARALLEL = 4;

const cache = new Map<string, { url: string; expiresAt: number }>();
const inFlight = new Map<string, Promise<string>>();
let active = 0;
const waiting: Array<() => void> = [];

/** Une place parmi `MAX_PARALLEL` ; la place libérée passe directement au suivant en attente. */
async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next(); else active--;
  }
}

function remember(fileUrl: string, url: string, expiresInSeconds: unknown): void {
  const ttl = typeof expiresInSeconds === 'number' && expiresInSeconds > 0 ? expiresInSeconds * 1000 * TTL_SHARE : FALLBACK_TTL_MS;
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(fileUrl, { url, expiresAt: Date.now() + ttl });
}

/** Oublie une URL signée (fichier remplacé, ou changement de cabinet : les références ne sont plus les mêmes). */
export function forgetSignedUrls(fileUrl?: string): void {
  if (fileUrl) cache.delete(fileUrl);
  else cache.clear();
}

export async function resolveSignedUrl(fileUrl: string): Promise<string> {
  const cached = cache.get(fileUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const pending = inFlight.get(fileUrl);
  if (pending) return pending;

  const request = withSlot(async () => {
    const { url, expiresIn } = await apiFetch<{ url: string; expiresIn?: number }>(`/api/storage/signed-url?url=${encodeURIComponent(fileUrl)}`);
    remember(fileUrl, url, expiresIn);
    return url;
  }).finally(() => { inFlight.delete(fileUrl); });
  inFlight.set(fileUrl, request);
  return request;
}

/** Resolves `fileUrl` to a signed URL and opens it in a new tab — the
 *  drop-in replacement for the old `window.open(fileUrl, '_blank')` /
 *  `<a href={fileUrl} target="_blank">` pattern used throughout the app. */
export async function openSignedUrl(fileUrl: string): Promise<void> {
  try {
    const url = await resolveSignedUrl(fileUrl);
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (err) {
    console.error('[signedStorageUrl] Failed to resolve download link:', err);
    alert(i18n.t('signed_storage_url_unavailable'));
  }
}
