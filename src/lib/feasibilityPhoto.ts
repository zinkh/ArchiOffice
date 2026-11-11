// Photos externes insérées dans une rubrique de l'étude de faisabilité
// (FeasibilityStudy.tsx). Une photo de téléphone pèse plusieurs Mo : elle est
// réduite et ré-encodée en JPEG avant dépôt, l'export PDF/Word la ramenant de
// toute façon à 1600 px.

export const PHOTO_MAX_SIDE = 2000;
export const PHOTO_MAX_INPUT_BYTES = 25 * 1024 * 1024;
/** Limite d'illustrations par rubrique, alignée sur sanitizeIllustrations. */
export const MAX_ILLUSTRATIONS_PER_SECTION = 20;

/** Vrai pour une adresse http(s) bien formée ; seul filtre côté écran, le serveur revalide tout. */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Récupère une image publique par son lien (relayée par le serveur) sous forme de fichier. */
export async function fetchPhotoFromUrl(rawUrl: string, token: string | null | undefined): Promise<File> {
  const res = await fetch(`/api/feasibility/photo-from-url?url=${encodeURIComponent(rawUrl.trim())}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || 'fetch');
  }
  const blob = await res.blob();
  const type = blob.type || 'image/jpeg';
  const header = res.headers.get('X-Photo-Name');
  let name = 'photo';
  try { if (header) name = decodeURIComponent(header); } catch { /* nom brut */ }
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += `.${type.split('/')[1]?.replace('jpeg', 'jpg').replace(/\+.*/, '') || 'jpg'}`;
  return new File([blob], name, { type });
}

/** Dimensions réduites pour tenir dans un carré de `maxSide`, sans jamais agrandir. */
export function fitWithin(w: number, h: number, maxSide: number): { w: number; h: number } {
  const ratio = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * ratio)), h: Math.max(1, Math.round(h * ratio)) };
}

/** Nom d'affichage d'un fichier photo : sans extension, séparateurs en espaces. */
export function photoLabel(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 300);
}

/** Réduit l'image et la ré-encode en JPEG ; lève une erreur si le navigateur ne sait pas la lire. */
export async function photoToJpeg(file: File, maxSide = PHOTO_MAX_SIDE, quality = 0.88): Promise<Blob> {
  // `imageOrientation: 'from-image'` applique l'orientation EXIF des photos de téléphone.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { w, h } = fitWithin(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#fff'; // aplat sous la transparence d'un PNG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('encode');
    return blob;
  } finally {
    bitmap.close();
  }
}
