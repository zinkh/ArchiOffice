// ── Périmètre d'un export du dossier PRO : tout, ou des lots / bâtiments / phases
// Logique pure, commune au CCTP, au DPGF, au DQE, au BPU et à l'estimation.
// Le CCTP et le DPGF sont un même document, le bordereau en est un autre avec
// ses propres registres de bâtiments et de phases : lots, bâtiments et phases
// se désignent donc par leur NUMÉRO ou leur CODE, identiques d'un document à
// l'autre, et non par un identifiant interne. Le document enregistré n'est
// jamais modifié : on produit une copie filtrée.
import type { DPGF, Lot, Chapitre, Ligne, DecoupageDocument } from '../types/dpgf';
import { batimentEffectif, phaseEffective } from '../types/dpgf';
import { recomputeBuildings } from './dpgfBuildings';

/** Code du groupe « sans bâtiment » / « sans phase » dans une sélection. */
export const SANS_AFFECTATION_EXPORT = '__sans__';

export interface ExportSelection {
  /** Numéros de lot retenus ; `null` : tous. */
  lotNumeros: string[] | null;
  /** Codes de bâtiment retenus ; `null` : tous. */
  batimentCodes: string[] | null;
  /** Codes de phase retenus ; `null` : toutes. */
  phaseCodes: string[] | null;
}

export const SELECTION_COMPLETE: ExportSelection = { lotNumeros: null, batimentCodes: null, phaseCodes: null };

export const cleLot = (numero: string): string => numero.trim().toUpperCase();

export function estSelectionComplete(sel: ExportSelection): boolean {
  return sel.lotNumeros === null && sel.batimentCodes === null && sel.phaseCodes === null;
}

/** Ce qu'il faut d'un document pour le filtrer : le DPGF et le BPU y répondent. */
export type DocumentFiltrable = DecoupageDocument & { lots: Lot[]; TVA: number };

export interface OptionsFiltre {
  /**
   * CCTP : les textes réservés au CCTP et les chapitres sans article
   * (prescriptions générales) sont conservés. Les bâtiments ne sont pas filtrés
   * ici : le CCTP se produit bâtiment par bâtiment (`cctpPourBatiment`).
   */
  cctp?: boolean;
}

/**
 * Copie du document réduite à la sélection. Un article est gardé s'il
 * appartient à un lot retenu ET à un bâtiment retenu ET à une phase retenue ;
 * un article réparti sur plusieurs bâtiments ne garde que les quantités des
 * bâtiments retenus. Un critère sur les bâtiments (ou les phases) est ignoré
 * par un document qui n'a pas activé ce découpage. Chapitres et lots devenus
 * vides disparaissent, les totaux sont recalculés.
 */
export function filtrerPourExport<D extends DocumentFiltrable>(doc: D, sel: ExportSelection, opts: OptionsFiltre = {}): D {
  const cctp = !!opts.cctp;
  if (estSelectionComplete(sel) && cctp) return doc;
  const lotsRetenus = sel.lotNumeros ? new Set(sel.lotNumeros.map(cleLot)) : null;
  const filtreBat = !cctp && doc.multiBatiments && sel.batimentCodes ? new Set(sel.batimentCodes) : null;
  const filtrePhase = doc.multiPhases && sel.phaseCodes ? new Set(sel.phaseCodes) : null;
  const codeBat = new Map((doc.batiments ?? []).map(b => [b.id, b.code]));
  const codePhase = new Map((doc.phases ?? []).map(p => [p.id, p.code]));

  const garder = (lot: Lot, chap: Chapitre, ligne: Ligne): Ligne | null => {
    if (ligne.cctpOnly) return cctp ? ligne : null;
    if (ligne.children?.length) {
      const enfants = ligne.children.map(c => garder(lot, chap, c)).filter((c): c is Ligne => c !== null);
      return enfants.length > 0 ? { ...ligne, children: enfants } : null;
    }
    if (filtrePhase) {
      const id = phaseEffective(lot, chap, ligne);
      if (!filtrePhase.has((id && codePhase.get(id)) || SANS_AFFECTATION_EXPORT)) return null;
    }
    if (!filtreBat) return ligne;
    if (ligne.quantitesBatiments !== undefined) {
      const quantites = Object.fromEntries(
        Object.entries(ligne.quantitesBatiments).filter(([id]) => filtreBat.has(codeBat.get(id) ?? '')),
      );
      return Object.keys(quantites).length > 0 ? { ...ligne, quantitesBatiments: quantites } : null;
    }
    const id = batimentEffectif(lot, chap, ligne);
    return filtreBat.has((id && codeBat.get(id)) || SANS_AFFECTATION_EXPORT) ? ligne : null;
  };

  const lots: Lot[] = [];
  for (const lot of doc.lots) {
    if (lotsRetenus && !lotsRetenus.has(cleLot(lot.numero))) continue;
    const chapitres: Chapitre[] = [];
    for (const chap of lot.chapitres) {
      if (chap.cctpOnly && !cctp) continue;
      const lignes = chap.lignes.map(l => garder(lot, chap, l)).filter((l): l is Ligne => l !== null);
      // Un chapitre sans article d'origine (prescriptions générales) ne vaut que pour le CCTP.
      if (lignes.length > 0 || (cctp && (chap.cctpOnly || chap.lignes.length === 0))) chapitres.push({ ...chap, lignes });
    }
    if (chapitres.length > 0 || (cctp && lot.chapitres.length === 0)) lots.push({ ...lot, chapitres });
  }

  // recomputeBuildings ne lit que `lots` et `TVA` : le bordereau a la même forme.
  return recomputeBuildings({ ...doc, lots } as unknown as DPGF) as unknown as D;
}

/** Nombre d'articles (feuilles) d'un document, pour les avertissements. */
export function compterArticles(doc: { lots: Lot[] }): number {
  const compter = (lignes: Ligne[]): number =>
    lignes.reduce((n, l) => n + (l.children?.length ? compter(l.children) : 1), 0);
  return doc.lots.reduce((n, lot) => n + lot.chapitres.reduce((m, c) => m + compter(c.lignes), 0), 0);
}
