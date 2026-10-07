// Photos externes insérées dans une rubrique de l'étude de faisabilité
// (FeasibilityStudy.tsx). Une photo de téléphone pèse plusieurs Mo : elle est
// réduite et ré-encodée en JPEG avant dépôt, l'export PDF/Word la ramenant de
// toute façon à 1600 px.

export const PHOTO_MAX_SIDE = 2000;
export const PHOTO_MAX_INPUT_BYTES = 25 * 1024 * 1024;
/** Limite d'illustrations par rubrique, alignée sur sanitizeIllustrations. */
export const MAX_ILLUSTRATIONS_PER_SECTION = 20;

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

/** Copie de `items` où l'élément `from` est déplacé en position `to` (indices bornés). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [held] = next.splice(from, 1);
  next.splice(target, 0, held);
  return next;
}

/** Indice du rectangle dont le centre est le plus proche du point (x, y), -1 sans rectangle. */
export function nearestRectIndex(rects: ReadonlyArray<{ left: number; top: number; width: number; height: number }>, x: number, y: number): number {
  let best = -1;
  let bestDist = Infinity;
  rects.forEach((r, i) => {
    const dist = (r.left + r.width / 2 - x) ** 2 + (r.top + r.height / 2 - y) ** 2;
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  return best;
}
