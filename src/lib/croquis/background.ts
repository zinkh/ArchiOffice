// Fond d'un croquis : un plan ou une photo posé sous le dessin.
// L'image est réduite à 2600 px de côté (le poids du fichier compte pour le
// stockage du cabinet et pour la lecture hors ligne) et aplatie sur blanc.
import type { CroquisBackground } from '../../types/croquis';

export const BACKGROUND_MAX_SIDE = 2600;
export const BACKGROUND_JPEG_QUALITY = 0.88;

/** Taille réduite pour tenir dans `max` pixels sur le grand côté. Jamais agrandie, jamais nulle. */
export function fitSize(width: number, height: number, max: number = BACKGROUND_MAX_SIDE): { width: number; height: number } {
  const ratio = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

export interface LoadedBackground {
  background: CroquisBackground;
  /** JPEG prêt à être envoyé au stockage du cabinet. */
  blob: Blob;
}

/** Erreurs de chargement : `not_image` (mauvais type de fichier) ou `unreadable` (image illisible). */
export class BackgroundLoadError extends Error {
  constructor(public readonly code: 'not_image' | 'unreadable') {
    super(code);
    this.name = 'BackgroundLoadError';
  }
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new BackgroundLoadError('unreadable'));
    img.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new BackgroundLoadError('unreadable'))),
      'image/jpeg',
      BACKGROUND_JPEG_QUALITY,
    );
  });
}

/**
 * Refait le fond d'un croquis à partir d'une image déjà réduite (celle gardée sur l'appareil ou lue sur le
 * serveur) : les dimensions sont celles de l'image. Lève si elle est illisible.
 */
export async function backgroundFromBlob(blob: Blob): Promise<CroquisBackground> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { image: bitmap, width: bitmap.width, height: bitmap.height };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await decodeImage(url);
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Lit un fichier image, le réduit et l'aplatit sur blanc. */
export async function loadBackgroundFromFile(file: File): Promise<LoadedBackground> {
  if (!/^image\//.test(file.type)) throw new BackgroundLoadError('not_image');
  return loadBackgroundFromBlob(file);
}

/** Même chose pour une image déjà en mémoire (plan ou photo de l'affaire, voir l'étape 6). */
export async function loadBackgroundFromBlob(source: Blob): Promise<LoadedBackground> {
  const url = URL.createObjectURL(source);
  try {
    const img = await decodeImage(url);
    const { width, height } = fitSize(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new BackgroundLoadError('unreadable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasToJpeg(canvas);
    return { background: { image: canvas, width, height }, blob };
  } finally {
    URL.revokeObjectURL(url);
  }
}
