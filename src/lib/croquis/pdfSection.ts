// Section « Croquis » d'un PDF jsPDF, commune à l'export de la réunion et à celui du compte-rendu de chantier :
// un titre, l'image cadrée dans la largeur utile, un filet gris, et un changement de page quand le suivant ne
// tient plus. Le titre de la section et la gestion des pages (en-tête compact du compte-rendu, par exemple)
// restent à l'appelant, qui les passe en fonctions. Testé dans src/lib/__tests__/croquisPdfSection.test.ts.
import type { jsPDF } from 'jspdf';
import { fitInBox, type CroquisExportItem } from './exportLayout';

export interface CroquisSectionLayout {
  /** Bord gauche de la zone utile, en mm. */
  x: number;
  /** Position courante. */
  y: number;
  contentW: number;
  /** Au-delà de cette ordonnée, on change de page. */
  bottomLimit: number;
  /** Ordonnée où une page neuve reprend (sous son en-tête). */
  topOfNewPage: number;
  /** Ajoute une page et rend l'ordonnée où reprendre. */
  newPage: () => number;
  /** Dessine le titre de la section à l'ordonnée donnée et rend l'ordonnée suivante. Appelé une seule fois. */
  drawHeading: (y: number) => number;
  /** Hauteur que prend ce titre : il ne reste jamais seul en bas de page, sans son premier croquis. */
  headingHeight: number;
  /** Hauteur maximale d'une image, en mm (135 par défaut : deux croquis de proportion 4:3 par page en portrait). */
  maxImageHeight?: number;
}

const TITLE_H = 6;
const GAP = 8;
const DEFAULT_MAX_IMAGE_H = 135;
const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_FILET: [number, number, number] = [209, 213, 219];

/** Dessine les croquis à la suite et rend l'ordonnée finale. Sans croquis, rend l'ordonnée reçue sans rien dessiner. */
export function drawCroquisSection(doc: jsPDF, items: readonly CroquisExportItem[], layout: CroquisSectionLayout): number {
  if (items.length === 0) return layout.y;
  const roomOnFreshPage = layout.bottomLimit - layout.topOfNewPage - layout.headingHeight - TITLE_H - GAP;
  const maxH = Math.max(40, Math.min(layout.maxImageHeight ?? DEFAULT_MAX_IMAGE_H, roomOnFreshPage));
  let y = layout.y;
  let first = true;

  for (const item of items) {
    const box = fitInBox(item.width, item.height, layout.contentW, maxH);
    if (box.w <= 0) continue;
    const headingH = first ? layout.headingHeight : 0;
    if (y + headingH + TITLE_H + box.h > layout.bottomLimit) y = layout.newPage();
    if (first) {
      y = layout.drawHeading(y);
      first = false;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...GRIS_TEXTE);
    const title = (doc.splitTextToSize(item.title || 'Croquis', layout.contentW) as string[])[0];
    doc.text(title, layout.x, y + 4);
    y += TITLE_H;
    try {
      // 'FAST' : sans cela jsPDF range un PNG décompressé (plusieurs Mo pour un simple croquis).
      doc.addImage(item.dataUrl, item.mime === 'image/png' ? 'PNG' : 'JPEG', layout.x, y, box.w, box.h, `croquis-${item.id}`, 'FAST');
    } catch {
      /* image illisible : le titre et le cadre restent, le reste du document est produit */
    }
    doc.setDrawColor(...GRIS_FILET);
    doc.setLineWidth(0.25);
    doc.rect(layout.x, y, box.w, box.h);
    y += box.h + GAP;
  }
  return y;
}
