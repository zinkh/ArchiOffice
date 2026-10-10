// ── Export PDF d'une planche d'inspiration ───────────────────────────────────
// Une planche = une page au format choisi (A4/A3, portrait/paysage, 16:9) avec
// l'en-tête du cabinet, le titre de la planche et ses références composées
// selon la disposition retenue (grille, mosaïque, matériaux). Pied de page et
// pagination « P1|2 » du cabinet (pdfLetterhead.ts), nuances de gris : les
// images sont la seule couleur du document.
//
// Les images sont réduites avant d'être embarquées (loadPhotoDataUrl) : les
// originaux feraient un PDF de plusieurs dizaines de Mo. Une référence dont
// l'image ne peut pas être lue (URL externe sans CORS, fichier supprimé) est
// remplacée par un cadre légendé, jamais omise en silence.
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl } from './pdfLetterhead';
import type { InspirationBoard, InspirationItem } from '../types';

export interface InspirationExportProject {
  name: string;
  project_code?: string;
}

export interface InspirationExportOptions {
  onProgress?: (message: string) => void;
}

const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_DOUX: [number, number, number] = [107, 114, 128];
const GRIS_FILET: [number, number, number] = [209, 213, 219];
const GRIS_FOND: [number, number, number] = [243, 244, 246];

const MARGIN = 14;
const FOOTER_RESERVE = 16; // hauteur réservée au pied de page
const GAP = 4;
const CAPTION_H = 9;
const IMAGE_MAX_SIDE = 1400;

interface PageSpec {
  format: [number, number]; // mm, portrait
  landscape: boolean;
}

const FORMATS: Record<string, PageSpec> = {
  A4P: { format: [210, 297], landscape: false },
  A4L: { format: [210, 297], landscape: true },
  A3P: { format: [297, 420], landscape: false },
  A3L: { format: [297, 420], landscape: true },
  '16:9': { format: [180, 320], landscape: true },
  FREE: { format: [210, 297], landscape: true },
};

const sanitize = (s: string) => (s || 'planche').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_');

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Hauteur de la zone image (légende exclue). */
  imageH: number;
}

/**
 * Découpe la zone utile en cases selon la disposition. Reprend la logique de
 * l'écran : 3 colonnes en grille et mosaïque (la première référence occupe 2x2
 * en mosaïque), 4 colonnes en matériaux avec des images carrées.
 */
export function computeBoardCells(
  count: number, layout: InspirationBoard['layout'], x0: number, y0: number, width: number, height: number,
): Cell[] {
  if (count <= 0) return [];
  const cols = layout === 'materials' ? 4 : 3;
  const ratio = layout === 'materials' ? 1 : 3 / 4; // hauteur / largeur de l'image
  const colW = (width - GAP * (cols - 1)) / cols;
  const cells: Cell[] = [];

  // Occupation de la grille (mosaïque : la case 0 prend 2x2).
  const occupied: boolean[][] = [];
  const isFree = (r: number, c: number) => !(occupied[r] && occupied[r][c]);
  const mark = (r: number, c: number) => { (occupied[r] ||= [])[c] = true; };

  let row = 0;
  let col = 0;
  for (let i = 0; i < count; i++) {
    const big = layout === 'mosaic' && i === 0;
    const span = big ? 2 : 1;
    while (true) {
      if (col + span > cols) { col = 0; row++; continue; }
      let ok = true;
      for (let dr = 0; dr < span; dr++) for (let dc = 0; dc < span; dc++) if (!isFree(row + dr, col + dc)) ok = false;
      if (ok) break;
      col++;
    }
    for (let dr = 0; dr < span; dr++) for (let dc = 0; dc < span; dc++) mark(row + dr, col + dc);
    cells.push({
      x: x0 + col * (colW + GAP),
      y: row, // rang provisoire, converti ci-dessous
      w: colW * span + GAP * (span - 1),
      h: 0,
      imageH: colW * ratio * span + (span > 1 ? GAP * (span - 1) * ratio : 0),
    });
    col += span;
  }

  // Hauteur d'une rangée = case simple + légende ; les cases doubles couvrent deux rangées.
  const rowH = colW * ratio + CAPTION_H + GAP;
  const rows = cells.reduce((m, c, i) => Math.max(m, c.y + (layout === 'mosaic' && i === 0 ? 2 : 1)), 0);
  const natural = rows * rowH - GAP;
  // Une planche trop haute pour la page est réduite en bloc (largeur incluse),
  // plutôt que de déborder sur le pied de page.
  const scale = natural > height ? height / natural : 1;
  const offsetX = (width - width * scale) / 2;

  return cells.map((c, i) => {
    const span = layout === 'mosaic' && i === 0 ? 2 : 1;
    const x = x0 + offsetX + (c.x - x0) * scale;
    const y = y0 + c.y * rowH * scale;
    const w = c.w * scale;
    const h = (span * rowH - GAP) * scale;
    return { x, y, w, h, imageH: Math.max(1, h - CAPTION_H * scale) };
  });
}

interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
}

async function loadItemImage(item: InspirationItem): Promise<LoadedImage | null> {
  const ref = item.file_url || item.source_url;
  if (!ref) return null;
  // Chargé à la demande : planRender embarque pdf.js, inutile tant qu'on n'exporte pas.
  const { loadPhotoDataUrl } = await import('./planRender');
  return loadPhotoDataUrl(ref, IMAGE_MAX_SIDE);
}

/** Dessine l'image en « cover » dans la case, recadrée au centre, sans déformation. */
function drawCover(doc: any, img: LoadedImage, x: number, y: number, w: number, h: number) {
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;
  // Recadrage via canvas : jsPDF ne sait pas rogner une image.
  const canvas = document.createElement('canvas');
  let sw = img.width;
  let sh = img.height;
  let sx = 0;
  let sy = 0;
  if (imgRatio > boxRatio) { sw = img.height * boxRatio; sx = (img.width - sw) / 2; }
  else { sh = img.width / boxRatio; sy = (img.height - sh) / 2; }
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  return new Promise<boolean>(resolve => {
    const el = new Image();
    el.onload = () => {
      ctx.drawImage(el, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      try {
        doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', x, y, w, h);
        resolve(true);
      } catch { resolve(false); }
    };
    el.onerror = () => resolve(false);
    el.src = img.dataUrl;
  });
}

function truncate(doc: any, text: string, maxW: number): string {
  const [first] = doc.splitTextToSize(text, maxW) as string[];
  return first ?? '';
}

/**
 * Exporte une planche d'inspiration en PDF, au format et dans la disposition
 * choisis à l'écran, avec l'en-tête et le pied de page du cabinet.
 */
export async function exportInspirationBoardToPDF(
  board: InspirationBoard,
  items: InspirationItem[],
  project: InspirationExportProject,
  settings: AgencySettings,
  opts: InspirationExportOptions = {},
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const progress = opts.onProgress || (() => {});
  const spec = FORMATS[board.format] || FORMATS.A3L;

  const doc = new jsPDF({
    orientation: spec.landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: spec.format,
  });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = {
    title: 'Planche d’inspiration',
    subtitle: project.name,
    reference: project.project_code,
    margin: MARGIN,
    logo,
  };

  let y = drawAgencyHeader(doc, settings, letterhead) + 3;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...GRIS_TEXTE);
  doc.text(truncate(doc, board.title, pageW - MARGIN * 2), MARGIN, y);
  y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRIS_DOUX);
  const meta = [`Phase ${board.phase}`, `${items.length} référence${items.length > 1 ? 's' : ''}`].join('  ·  ');
  doc.text(meta, MARGIN, y);
  y += 3;
  if (board.description) {
    const lines = doc.splitTextToSize(board.description, pageW - MARGIN * 2) as string[];
    y += 2;
    doc.setTextColor(...GRIS_TEXTE);
    doc.text(lines.slice(0, 3), MARGIN, y);
    y += Math.min(lines.length, 3) * 3.6;
  }
  y += 3;

  const cells = computeBoardCells(
    items.length, board.layout, MARGIN, y, pageW - MARGIN * 2, pageH - FOOTER_RESERVE - y,
  );

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const cell = cells[i];
    progress(`Image ${i + 1}/${items.length}…`);
    const image = await loadItemImage(item);

    doc.setDrawColor(...GRIS_FILET);
    doc.setLineWidth(0.25);
    let drawn = false;
    if (image) drawn = await drawCover(doc, image, cell.x, cell.y, cell.w, cell.imageH);
    if (!drawn) {
      doc.setFillColor(...GRIS_FOND);
      doc.rect(cell.x, cell.y, cell.w, cell.imageH, 'F');
      doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(...GRIS_DOUX);
      doc.text('Image indisponible', cell.x + cell.w / 2, cell.y + cell.imageH / 2, { align: 'center' });
    }
    doc.rect(cell.x, cell.y, cell.w, cell.imageH);

    const capY = cell.y + cell.imageH + 3.6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...GRIS_TEXTE);
    doc.text(truncate(doc, item.title || 'Sans titre', cell.w), cell.x, capY);
    const sub = [item.caption, item.category].filter(Boolean).join('  ·  ');
    if (sub) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...GRIS_DOUX);
      doc.text(truncate(doc, sub, cell.w), cell.x, capY + 3.2);
    }
  }

  if (items.length === 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(...GRIS_DOUX);
    doc.text('Cette planche ne contient pas encore de référence.', MARGIN, y + 6);
  }

  progress('Finalisation…');
  drawAgencyFooters(doc, settings, letterhead);
  doc.save(`Planche_${sanitize(project.project_code || '')}_${sanitize(board.title)}.pdf`);
}
