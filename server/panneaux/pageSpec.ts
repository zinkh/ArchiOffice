// Formats de panneau et mise à l'échelle. Les gabarits sont dessinés une seule
// fois à une taille de base (A0 : 841 mm de large en portrait, 1189 mm en
// paysage) puis mis à l'échelle par `zoom` pour les autres formats : un A1 est
// un A0 réduit, pas une autre mise en page.
export type PanneauOrientation = 'portrait' | 'paysage';
export type PanneauFormat = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | '80x120' | '100x150';

export const PANNEAU_FORMATS: Record<PanneauFormat, { w: number; h: number }> = {
  A0: { w: 841, h: 1189 },
  A1: { w: 594, h: 841 },
  A2: { w: 420, h: 594 },
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  '80x120': { w: 800, h: 1200 },
  '100x150': { w: 1000, h: 1500 },
};

export const CHANTIER_FORMATS: PanneauFormat[] = ['A0', 'A1', 'A2', 'A3'];
export const PERMIS_FORMATS: PanneauFormat[] = ['A0', '80x120', '100x150', 'A3', 'A4'];

/**
 * Plus petite dimension exigée du panneau de permis : 80 cm de côté. Le texte parle de dimensions « supérieures à 80 cm » ;
 * le panneau du commerce de 80 x 120 cm est accepté ici (lecture « au moins 80 cm », à confirmer sur Légifrance).
 */
export const PERMIS_MIN_SIDE_MM = 800;

const BASE_WIDTH_MM = { portrait: 841, paysage: 1189 } as const;

export interface PageSpec {
  format: PanneauFormat;
  orientation: PanneauOrientation;
  /** Taille réelle de la page imprimée. */
  widthMm: number;
  heightMm: number;
  /** Taille de la page dans le repère de dessin (avant `zoom`). */
  baseWidthMm: number;
  baseHeightMm: number;
  zoom: number;
}

export function isPanneauFormat(value: unknown): value is PanneauFormat {
  return typeof value === 'string' && value in PANNEAU_FORMATS;
}

export function pageSpec(format: PanneauFormat, orientation: PanneauOrientation): PageSpec {
  const f = PANNEAU_FORMATS[format];
  const widthMm = orientation === 'portrait' ? f.w : f.h;
  const heightMm = orientation === 'portrait' ? f.h : f.w;
  const baseWidthMm = BASE_WIDTH_MM[orientation];
  const zoom = widthMm / baseWidthMm;
  return { format, orientation, widthMm, heightMm, baseWidthMm, baseHeightMm: heightMm / zoom, zoom };
}

/** Un panneau de permis n'est réglementaire que si ses DEUX côtés font au moins 80 cm. */
export function isRegulatorySize(format: PanneauFormat): boolean {
  const f = PANNEAU_FORMATS[format];
  return Math.min(f.w, f.h) >= PERMIS_MIN_SIDE_MM;
}
