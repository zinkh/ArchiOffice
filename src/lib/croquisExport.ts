// Les croquis d'une réunion ou d'un compte-rendu, prêts à entrer dans un export PDF ou Word.
// La liste vient du cache puis du serveur, avec la file hors ligne rejouée par-dessus (comme à l'écran) :
// un croquis dessiné sur un chantier sans réseau figure dans l'export fait au bureau d'à côté, sur le même
// poste. L'image est l'aperçu PNG du croquis (gardé sur l'appareil ou lu sur le serveur) ; à défaut, il est
// redessiné depuis sa scène. Un croquis vide sur feuille blanche n'est pas exporté.
// Une lecture qui échoue ne doit JAMAIS empêcher l'export : on rend alors ce qu'on a, ou rien.
import '@fontsource/caveat/500.css';
import { db } from '../db';
import type { Croquis } from '../types';
import { backgroundFromBlob } from './croquis/background';
import { EXPORT_MAX_SIDE, dataUrlToBytes, exportMime, scaledSize, type CroquisExportItem } from './croquis/exportLayout';
import { renderSceneToCanvas } from './croquis/render';
import { applyPendingCroquisWrites, type CroquisParent } from './croquisOffline';
import { croquisListUrl, loadCroquisImage, readPendingCroquisWrites } from './croquisSync';
import { cachedListFirst } from './offlineReadCache';

async function readRows(parent: CroquisParent): Promise<Croquis[]> {
  const inScope = (row: Croquis) => (parent.kind === 'meeting' ? row.meeting_id === parent.id : row.site_report_id === parent.id);
  let rows: Croquis[] = [];
  if (parent.pending) {
    // Parent pas encore envoyé : le serveur ne le connaît pas, seuls le cache et la file ont ses croquis.
    try { rows = (await db.croquisCache.toArray()).filter(inScope); } catch { rows = []; }
  } else {
    await cachedListFirst(db.croquisCache, inScope, croquisListUrl(parent), (list) => { rows = list; });
  }
  return applyPendingCroquisWrites(rows, await readPendingCroquisWrites(), parent);
}

/**
 * Le croquis a-t-il un fond : une référence sur le serveur, ou une image posée depuis cet appareil et pas encore
 * partie. (Le drapeau « en attente » ne le dit pas : il vaut aussi pour un simple trait pas encore envoyé.)
 */
async function hasBackground(row: Croquis): Promise<boolean> {
  if (row.bg_path) return true;
  try { return Boolean(await db.croquisFiles.get(`${row.id}:bg`)); } catch { return false; }
}

const isBlank = (row: Croquis, withBackground: boolean): boolean => (row.scene?.elements?.length ?? 0) === 0 && !withBackground;

/** Redessine le croquis depuis sa scène quand aucun aperçu n'est disponible. */
async function redraw(row: Croquis, withBackground: boolean): Promise<Blob | null> {
  const bgBlob = withBackground ? await loadCroquisImage(row, 'bg').catch(() => null) : null;
  const background = bgBlob ? await backgroundFromBlob(bgBlob).catch(() => null) : null;
  // L'écriture manuscrite se charge à la première utilisation : sans attendre, le texte sortirait en police droite.
  if (row.scene.elements.some((e) => e.type === 'text' && e.rough)) {
    await document.fonts?.load('500 24px Caveat').catch(() => undefined);
  }
  const canvas = renderSceneToCanvas({ elements: row.scene.elements, background, bgOpacity: row.bg_opacity, maxSide: EXPORT_MAX_SIDE });
  if (!canvas) return null;
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Recopie l'image sur fond blanc, réduite, en PNG (dessin seul) ou JPEG (par-dessus un fond). */
async function toExportItem(row: Croquis, source: Blob, withBackground: boolean): Promise<CroquisExportItem> {
  const decoded = await backgroundFromBlob(source);
  const { width, height } = scaledSize(decoded.width, decoded.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(decoded.image, 0, 0, width, height);
  const mime = exportMime(withBackground);
  const dataUrl = mime === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88);
  return { id: row.id, title: row.title, dataUrl, bytes: dataUrlToBytes(dataUrl), width, height, mime };
}

export async function loadCroquisExportItems(parent: CroquisParent): Promise<CroquisExportItem[]> {
  try {
    const rows = await readRows(parent);
    const items: CroquisExportItem[] = [];
    for (const row of rows) {
      try {
        const withBackground = await hasBackground(row);
        if (isBlank(row, withBackground)) continue;
        const source = (await loadCroquisImage(row, 'preview').catch(() => null)) ?? (await redraw(row, withBackground));
        if (source) items.push(await toExportItem(row, source, withBackground));
      } catch {
        /* un croquis illisible n'empêche pas les autres, ni l'export */
      }
    }
    return items;
  } catch {
    return [];
  }
}
