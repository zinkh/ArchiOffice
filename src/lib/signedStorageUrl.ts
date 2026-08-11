// The `documents`/`plans`/`cv`/`message-attachments`/`feed-attachments`
// storage buckets are private (see server/storagePaths.ts and the security
// audit) — a `file_url`/`attachment_url`/`cv_url` value read from the API is
// a stable *reference*, not a directly fetchable URL anymore. This resolves
// one to a signed URL (valid ~1h) via GET /api/storage/signed-url, which
// checks the caller's tenant owns the object before minting it.
import { apiFetch } from './api';

export async function resolveSignedUrl(fileUrl: string): Promise<string> {
  const { url } = await apiFetch<{ url: string }>(`/api/storage/signed-url?url=${encodeURIComponent(fileUrl)}`);
  return url;
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
    alert("Impossible d'accéder à ce fichier pour le moment.");
  }
}
