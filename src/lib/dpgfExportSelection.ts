// ── Périmètre d'un export du DPGF : tout, ou des lots / bâtiments / phases ───
// Logique pure, partagée par la modale d'export et testée à part. Le document
// enregistré n'est jamais modifié : on produit une copie filtrée.
import type { DPGF, Lot, Chapitre, Ligne } from '../types/dpgf';
import { batimentEffectif, phaseEffective } from '../types/dpgf';
import { recomputeBuildings } from './dpgfBuildings';

/** Identifiant du groupe « sans bâtiment » / « sans phase » dans une sélection. */
export const SANS_AFFECTATION_EXPORT = '__sans__';

export interface ExportSelection {
  /** `null` : tous les lots. */
  lotIds: string[] | null;
  /** `null` : tous les bâtiments. */
  batimentIds: string[] | null;
  /** `null` : toutes les phases. */
  phaseIds: string[] | null;
}

export const SELECTION_COMPLETE: ExportSelection = { lotIds: null, batimentIds: null, phaseIds: null };

export function estSelectionComplete(sel: ExportSelection): boolean {
  return sel.lotIds === null && sel.batimentIds === null && sel.phaseIds === null;
}

/**
 * Copie du DPGF réduite à la sélection. Un article est gardé s'il appartient à
 * un lot retenu ET à un bâtiment retenu ET à une phase retenue ; pour un
 * article réparti sur plusieurs bâtiments, seules les quantités des bâtiments
 * retenus restent. Chapitres et lots devenus vides disparaissent, les totaux
 * sont recalculés. Les éléments réservés au CCTP n'ont pas leur place dans un
 * DPGF et sont écartés.
 */
export function filtrerDpgfPourExport(dpgf: DPGF, sel: ExportSelection): DPGF {
  if (estSelectionComplete(sel)) return dpgf;
  const lotsRetenus = sel.lotIds ? new Set(sel.lotIds) : null;
  const batsRetenus = sel.batimentIds ? new Set(sel.batimentIds) : null;
  const phasesRetenues = sel.phaseIds ? new Set(sel.phaseIds) : null;

  const garder = (lot: Lot, chap: Chapitre, ligne: Ligne): Ligne | null => {
    if (ligne.cctpOnly) return null;
    const enfants = ligne.children?.length
      ? ligne.children.map(c => garder(lot, chap, c)).filter((c): c is Ligne => c !== null)
      : undefined;
    if (ligne.children?.length) {
      return enfants && enfants.length > 0 ? { ...ligne, children: enfants } : null;
    }
    if (phasesRetenues) {
      const phase = phaseEffective(lot, chap, ligne) ?? SANS_AFFECTATION_EXPORT;
      if (!phasesRetenues.has(phase)) return null;
    }
    if (!batsRetenus) return ligne;
    if (ligne.quantitesBatiments !== undefined) {
      const quantites = Object.fromEntries(
        Object.entries(ligne.quantitesBatiments).filter(([id]) => batsRetenus.has(id)),
      );
      return Object.keys(quantites).length > 0 ? { ...ligne, quantitesBatiments: quantites } : null;
    }
    const bat = batimentEffectif(lot, chap, ligne) ?? SANS_AFFECTATION_EXPORT;
    return batsRetenus.has(bat) ? ligne : null;
  };

  const lots = dpgf.lots
    .filter(lot => !lotsRetenus || lotsRetenus.has(lot.id))
    .map(lot => ({
      ...lot,
      chapitres: lot.chapitres
        .filter(chap => !chap.cctpOnly)
        .map(chap => ({
          ...chap,
          lignes: chap.lignes.map(l => garder(lot, chap, l)).filter((l): l is Ligne => l !== null),
        }))
        .filter(chap => chap.lignes.length > 0),
    }))
    .filter(lot => lot.chapitres.length > 0);

  return recomputeBuildings({ ...dpgf, lots });
}

/** Nombre d'articles (feuilles) d'un document, pour l'aperçu de la modale. */
export function compterArticles(dpgf: DPGF): number {
  const compter = (lignes: Ligne[]): number =>
    lignes.reduce((n, l) => n + (l.children?.length ? compter(l.children) : 1), 0);
  return dpgf.lots.reduce((n, lot) => n + lot.chapitres.reduce((m, c) => m + compter(c.lignes), 0), 0);
}
