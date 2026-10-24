// Shared helpers for the "documents"/"plans"/"cv"/"message-attachments"/
// "feed-attachments"/"meeting-photos" storage buckets, which store business
// documents (and, for meeting-photos, site photos that can show people —
// personal data) and are now private (see ensureStorageBuckets in server.ts
// and the security audit — they used to be `public: true`, so any URL leak
// exposed the file with no auth, no tenant check, and no expiry).
// `uploadToStorage()` in server.ts still builds/returns a "public URL"-shaped
// string (getPublicUrl() just constructs that string; it doesn't check
// whether the bucket is actually public), so every existing DB row keeps
// working as a stable reference — it's just no longer directly fetchable.
// server/routes/storageAccess.ts exchanges that reference for a short-lived
// signed URL after checking the caller's tenant owns it.
const PUBLIC_URL_MARKER = '/object/public/';

/** Buckets eligible for the signed-URL resolver — the ones this pass made
 *  private. `logos` (agency branding/avatars) is deliberately excluded: it's
 *  meant to be public, matching real Supabase Storage's own "public bucket"
 *  semantics. */
export const PRIVATE_STORAGE_BUCKETS = new Set([
  'documents',
  'plans',
  'cv',
  'message-attachments',
  'feed-attachments',
  'meeting-photos',
  'reserve-photos',
  'support-attachments',
]);

export interface ParsedStorageRef {
  bucket: string;
  path: string;
}

/** Le nom d'objet RÉEL (décodé) d'une référence `…/object/public/<bucket>/<path>`,
 *  ou le texte tel quel quand ce n'est pas une URL de ce bucket (chemin déjà nu).
 *  L'URL est encodée (« Villa%20Martin ») alors que `remove()` et `download()`
 *  attendent le nom d'objet : sans décodage, un fichier à nom lisible n'est jamais
 *  retrouvé. */
export function objectPathFromRef(bucket: string, fileUrl: string): string {
  const marker = `${PUBLIC_URL_MARKER}${bucket}/`;
  const raw = fileUrl.includes(marker) ? fileUrl.split(marker)[1] : fileUrl;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // « % » littéral dans un chemin déjà brut
  }
}

/** Parses the bucket + object path back out of a stored `getPublicUrl()`-shaped
 *  string (…/storage/v1/object/public/<bucket>/<path>). Returns null for
 *  anything that isn't a URL of that shape (already-bare paths, foreign URLs). */
export function parseStorageRef(fileUrl: string): ParsedStorageRef | null {
  const idx = fileUrl.indexOf(PUBLIC_URL_MARKER);
  if (idx === -1) return null;
  const rest = fileUrl.slice(idx + PUBLIC_URL_MARKER.length);
  const slash = rest.indexOf('/');
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const path = decodeURIComponent(rest.slice(slash + 1));
  if (!bucket || !path) return null;
  return { bucket, path };
}
