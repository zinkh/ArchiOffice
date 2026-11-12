// Fonds possibles d'un croquis tirés de l'affaire : ses plans (PDF ou image) et les photos de ses
// observations. La logique de liste est pure et testée (src/lib/__tests__/croquisProjectBackground.test.ts) ;
// le chargement (rendu de la première page d'un PDF, lecture d'une photo) passe par les mêmes outils que
// l'import depuis l'appareil : le fond choisi est réduit à 2600 px, aplati sur blanc et enregistré comme lui.
import {
  BACKGROUND_JPEG_QUALITY,
  BACKGROUND_MAX_SIDE,
  BackgroundLoadError,
  fitSize,
  loadBackgroundFromBlob,
  type LoadedBackground,
} from './background';

export interface BackgroundSource {
  kind: 'plan' | 'photo';
  /** Identifiant du plan, ou référence de la photo. */
  id: string;
  /** Nom du plan ; vide pour une photo (l'écran la numérote). */
  name: string;
  /** « Indice B · v2 » pour un plan, intitulé du lot pour une photo. */
  detail: string;
  fileUrl: string;
  isPdf: boolean;
}

export interface PlanLike {
  id: string;
  name?: string | null;
  file_url?: string | null;
  index?: string | null;
  version?: number | null;
  parent_id?: string | null;
}

export interface ObservationLike {
  photos?: string[] | null;
  lot?: { lot_title?: string | null } | null;
}

/** Même lecture que `isPdfRef` de planRender.ts : une référence de bucket ou d'espace du cabinet finit par le nom du fichier. */
const PDF = /\.pdf(\?|$)/i;
const IMAGE = /\.(jpe?g|png|webp|gif)(\?|$)/i;

/** `pdf`, `image`, ou `null` pour un format qu'on ne sait pas poser en fond (DWG, DXF, Word...). */
export function backgroundFormat(fileUrl: string, name?: string | null): 'pdf' | 'image' | null {
  for (const candidate of [fileUrl, name ?? '']) {
    if (PDF.test(candidate)) return 'pdf';
    if (IMAGE.test(candidate)) return 'image';
  }
  return null;
}

const byName = (a: BackgroundSource, b: BackgroundSource) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Les plans qu'on peut poser en fond : seulement la DERNIÈRE version de chaque plan (un plan remplacé par un
 * nouvel indice via `parent_id` n'est plus proposé), sans les formats illisibles (DWG, DXF), triés par nom.
 */
export function plansToSources(plans: readonly PlanLike[]): BackgroundSource[] {
  const replaced = new Set(plans.map((p) => p.parent_id).filter((id): id is string => Boolean(id)));
  const sources: BackgroundSource[] = [];
  for (const plan of plans) {
    if (replaced.has(plan.id) || !plan.file_url) continue;
    const format = backgroundFormat(plan.file_url, plan.name);
    if (!format) continue;
    const detail = [plan.index ? `Indice ${plan.index}` : '', plan.version && plan.version > 1 ? `v${plan.version}` : '']
      .filter(Boolean)
      .join(' · ');
    sources.push({ kind: 'plan', id: plan.id, name: plan.name?.trim() || '', detail, fileUrl: plan.file_url, isPdf: format === 'pdf' });
  }
  return sources.sort(byName);
}

/** Les photos des observations de l'affaire, chacune une fois, dans l'ordre où elles arrivent. */
export function photosToSources(observations: readonly ObservationLike[]): BackgroundSource[] {
  const seen = new Set<string>();
  const sources: BackgroundSource[] = [];
  for (const observation of observations) {
    for (const url of observation.photos ?? []) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ kind: 'photo', id: url, name: '', detail: observation.lot?.lot_title?.trim() || '', fileUrl: url, isPdf: false });
    }
  }
  return sources;
}

/** Recopie un rendu (page de PDF, image) en JPEG sur fond blanc, réduit à 2600 px comme tout fond de croquis. */
async function loadedFromCanvas(source: HTMLCanvasElement): Promise<LoadedBackground> {
  const { width, height } = fitSize(source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new BackgroundLoadError('unreadable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', BACKGROUND_JPEG_QUALITY));
  if (!blob) throw new BackgroundLoadError('unreadable');
  return { background: { image: canvas, width, height }, blob };
}

/** Charge le fond choisi. Lève `BackgroundLoadError` si le fichier est introuvable ou illisible. */
export async function loadBackgroundFromSource(source: BackgroundSource): Promise<LoadedBackground> {
  try {
    if (source.kind === 'plan') {
      // pdf.js ne se charge que pour un plan : l'éditeur n'en dépend pas.
      const { renderPlanToCanvas } = await import('../planRender');
      return await loadedFromCanvas(await renderPlanToCanvas(source.fileUrl, BACKGROUND_MAX_SIDE));
    }
    // Chargé à la demande : ce module (liste des fonds) reste pur et testable sans client d'API.
    const { resolveSignedUrl } = await import('../signedStorageUrl');
    const response = await fetch(await resolveSignedUrl(source.fileUrl));
    if (!response.ok) throw new BackgroundLoadError('unreadable');
    return await loadBackgroundFromBlob(await response.blob());
  } catch (error) {
    throw error instanceof BackgroundLoadError ? error : new BackgroundLoadError('unreadable');
  }
}
