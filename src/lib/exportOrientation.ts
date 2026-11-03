// ── Orientation de la page A4 des exports CCTP et DPGF ───────────────────────
// Vertical (portrait) ou horizontal (paysage), au choix pour le PDF, le Word et
// l'Excel. Le CCTP est un texte courant (vertical par défaut), le DPGF un
// tableau large (horizontal par défaut) : ce sont les mises en page d'avant le
// choix, conservées quand rien n'est demandé.
import type { DPGF, Lot } from '../types/dpgf';
import { recomputeBuildings } from './dpgfBuildings';

export type Orientation = 'portrait' | 'paysage';

export const ORIENTATION_CCTP: Orientation = 'portrait';
export const ORIENTATION_DPGF: Orientation = 'paysage';

/** Orientation jsPDF correspondante. */
export const orientationPdf = (o: Orientation): 'portrait' | 'landscape' => (o === 'paysage' ? 'landscape' : 'portrait');

/** Largeur utile d'une page A4 aux marges par défaut de Word (2,54 cm), en twips. */
export const largeurUtileWord = (o: Orientation): number => (o === 'paysage' ? 13958 : 9026);

/** Un document par lot : copie réduite à ce lot, totaux recalculés. */
export function documentsParLot<D extends { lots: Lot[] }>(doc: D): Array<{ lot: Lot; doc: D }> {
  return doc.lots.map(lot => ({
    lot,
    doc: recomputeBuildings({ ...doc, lots: [lot] } as unknown as DPGF) as unknown as D,
  }));
}

/** Libellé d'un lot pour un nom de fichier ou un rappel de périmètre : « Lot 01 Gros œuvre ». */
export function suffixeLot(lot: Pick<Lot, 'numero' | 'titre'>): string {
  return `Lot ${lot.numero} ${lot.titre}`.trim();
}
