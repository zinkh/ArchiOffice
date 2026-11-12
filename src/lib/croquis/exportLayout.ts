// Calculs purs de l'export des croquis (PDF et Word) : cadrage d'une image dans une zone, réduction,
// décodage d'une image en octets. Testés dans src/lib/__tests__/croquisExportLayout.test.ts.
// Le chargement des images est dans src/lib/croquisExport.ts, le dessin PDF dans ./pdfSection.ts.

/** Une image de croquis prête à être insérée dans un document. */
export interface CroquisExportItem {
  id: string;
  title: string;
  /** Pour jsPDF. */
  dataUrl: string;
  /** Pour docx. */
  bytes: Uint8Array;
  width: number;
  height: number;
  /** PNG pour un dessin sur feuille blanche (traits nets, léger), JPEG par-dessus un plan ou une photo. */
  mime: 'image/png' | 'image/jpeg';
}

/** Plus grand côté d'une image exportée : assez net sur une page A4, sans alourdir le document. */
export const EXPORT_MAX_SIDE = 1400;

/** Format d'export : le JPEG pèse beaucoup moins qu'un PNG quand un plan ou une photo est dessous. */
export const exportMime = (hasBackground: boolean): CroquisExportItem['mime'] => (hasBackground ? 'image/jpeg' : 'image/png');

/** Agrandit ou réduit (w, h) pour tenir dans (maxW, maxH), rapport conservé. `{0, 0}` si une dimension est nulle. */
export function fitInBox(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0) || !(maxW > 0) || !(maxH > 0)) return { w: 0, h: 0 };
  const scale = Math.min(maxW / w, maxH / h);
  return { w: w * scale, h: h * scale };
}

/** Taille réduite pour que le grand côté ne dépasse pas `maxSide` ; jamais agrandie, jamais nulle. */
export function scaledSize(width: number, height: number, maxSide: number = EXPORT_MAX_SIDE): { width: number; height: number } {
  const ratio = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** Octets d'une image `data:` en base64. Lève si ce n'en est pas une. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const match = /^data:[^;,]+;base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Image de croquis illisible');
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
