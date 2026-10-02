// ── Rendu d'un plan en image, extraits et chargement de photos ───────────────
// Sert la fiche d'une réserve (extrait de plan autour du repère) et l'export
// PDF de la liste de réserves (plan entier avec tous les repères, extrait par
// réserve, photos). Un plan est un PDF (première page — c'est celle sur
// laquelle PlanAnnotator pose les repères) ou une image.
//
// Les coordonnées d'un repère (`x`/`y`) sont en POURCENTAGE de la page,
// comme les stocke PlanAnnotator : indépendantes de l'échelle de rendu.
import { pdfjs } from 'react-pdf';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { resolveSignedUrl } from './signedStorageUrl';

// Même worker auto-hébergé que PlanAnnotator : ce module peut être chargé
// sans lui (export lancé depuis une liste sans plan affiché).
if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const isPdfRef = (fileUrl: string) => fileUrl.includes('application/pdf') || /\.pdf(\?|$)/i.test(fileUrl);

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = url;
  });
}

// Un même plan est demandé une fois par réserve qui s'y rapporte : le rendu
// (coûteux pour un PDF A0) est mis en cache par référence de fichier.
const planCache = new Map<string, Promise<HTMLCanvasElement>>();

/**
 * Rend la première page d'un plan sur un canvas de `maxWidth` px de large au
 * plus (le rapport largeur/hauteur est conservé).
 */
export function renderPlanToCanvas(fileUrl: string, maxWidth = 1800): Promise<HTMLCanvasElement> {
  const key = `${fileUrl}#${maxWidth}`;
  let pending = planCache.get(key);
  if (!pending) {
    pending = (async () => {
      const url = await resolveSignedUrl(fileUrl);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas indisponible');
      if (isPdfRef(fileUrl)) {
        const doc = await pdfjs.getDocument({ url }).promise;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(maxWidth / base.width, 4);
        const viewport = page.getViewport({ scale });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport } as any).promise;
      } else {
        const img = await loadImageElement(url);
        const scale = Math.min(1, maxWidth / img.naturalWidth);
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      return canvas;
    })();
    planCache.set(key, pending);
    pending.catch(() => planCache.delete(key));
  }
  return pending;
}

export interface PlanMarker {
  x: number;
  y: number;
  label: string;
}

/**
 * Dessine un repère numéroté : une pastille sombre à bord blanc, le numéro en
 * blanc — lisible sur un plan quel que soit le fond, sans couleur vive.
 */
export function drawMarker(ctx: CanvasRenderingContext2D, cx: number, cy: number, label: string, radius: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#1f2937';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, radius * 0.18);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(radius * (label.length > 2 ? 0.85 : 1.1))}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + radius * 0.05);
  ctx.restore();
}

/** Le plan entier, tous les repères posés dessus, en data URL JPEG. */
export async function renderPlanWithMarkers(fileUrl: string, markers: PlanMarker[], maxWidth = 1800): Promise<{ dataUrl: string; width: number; height: number }> {
  const source = await renderPlanToCanvas(fileUrl, maxWidth);
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  const radius = Math.max(10, Math.round(source.width / 90));
  for (const m of markers) {
    drawMarker(ctx, (m.x / 100) * source.width, (m.y / 100) * source.height, m.label, radius);
  }
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height };
}

/**
 * Un extrait carré du plan autour d'un repère (une fenêtre de `windowPct` %
 * de la largeur du plan), le repère dessiné au centre. Sert la fiche d'une
 * réserve et sa vignette dans l'export.
 */
export async function renderPlanExcerpt(fileUrl: string, x: number, y: number, label: string, opts: { windowPct?: number; size?: number } = {}): Promise<string> {
  const source = await renderPlanToCanvas(fileUrl);
  const windowPct = opts.windowPct ?? 22;
  const size = opts.size ?? 600;
  const win = Math.round((windowPct / 100) * source.width);
  const half = win / 2;
  const cx = (x / 100) * source.width;
  const cy = (y / 100) * source.height;
  // La fenêtre reste dans le plan : un repère près d'un bord décale la
  // fenêtre plutôt que de la remplir de vide.
  const sx = Math.min(Math.max(0, cx - half), Math.max(0, source.width - win));
  const sy = Math.min(Math.max(0, cy - half), Math.max(0, source.height - win));
  const sw = Math.min(win, source.width);
  const sh = Math.min(win, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = Math.round(size * (sh / sw));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const scale = canvas.width / sw;
  drawMarker(ctx, (cx - sx) * scale, (cy - sy) * scale, label, Math.max(14, size / 22));
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Charge une photo (référence de bucket privé) en data URL JPEG, réduite à
 * `maxSide` px : assez pour une vignette de 45 mm dans un PDF, sans y
 * embarquer la photo originale de plusieurs Mo.
 */
export async function loadPhotoDataUrl(fileUrl: string, maxSide = 900): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const url = await resolveSignedUrl(fileUrl);
    const img = await loadImageElement(url);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}
