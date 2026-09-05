// ── Passerelles DPGF <-> BPU ─────────────────────────────────────────────────
// Un projet peut porter les deux : une part forfaitaire décomposée en DPGF et
// une part à prix unitaires au bordereau. Ces deux conversions évitent de
// ressaisir l'arbre, sans jamais écraser un travail en silence.
import type { DPGF, Lot, Chapitre, Ligne } from '../types/dpgf';
import type { BPU, BPULot, BPUChapitre, BPULigne } from '../types/bpu';
import { EMPTY_BPU } from '../types/bpu';
import { recomputeLot, forEachLigne } from '../components/pro/treeOps';

/** Indexe tous les articles d'un arbre par identifiant, sous-articles compris. */
function indexById<T extends { id: string; children?: any[] }>(lots: any[]): Map<string, T> {
  const map = new Map<string, T>();
  forEachLigne(lots, (ligne: T) => map.set(ligne.id, ligne));
  return map;
}

/**
 * Initialise ou met à jour un BPU depuis le DPGF du projet.
 *
 * Les identifiants d'articles sont repris VERBATIM : les prix des offres
 * importées y sont indexés, et le versement vers le comparatif ACT en dépend.
 *
 * Avec un BPU existant, la fusion préserve ce qui a été saisi côté bordereau —
 * prix unitaire, libellé en lettres, nature, tranche, référence d'export.
 * Lancer « Initialiser depuis le DPGF » deux fois ne doit pas détruire de prix.
 */
export function dpgfToBpu(dpgf: DPGF, existing?: BPU | null): BPU {
  const base = existing ?? EMPTY_BPU(dpgf.projectId);
  const anciens = existing ? indexById<BPULigne>(existing.lots) : new Map<string, BPULigne>();

  const convertLigne = (l: Ligne): BPULigne => {
    const ancien = anciens.get(l.id);
    const converti: BPULigne = {
      ...l,
      // Ce qui vient du DPGF : structure, désignation, unité, quantités.
      children: l.children?.map(convertLigne),
      // Ce qui appartient au bordereau et survit à une réinitialisation.
      prixUnitaire: ancien?.prixUnitaire ?? l.prixUnitaire,
      prixTotal: (ancien?.prixUnitaire ?? l.prixUnitaire) * l.quantite,
      refBpu: ancien?.refBpu,
      prixUnitaireLettres: ancien?.prixUnitaireLettres,
      nature: ancien?.nature ?? 'base',
      trancheId: ancien?.trancheId,
      articleTypeId: ancien?.articleTypeId,
      qteMini: ancien?.qteMini,
      qteMaxi: ancien?.qteMaxi,
    };
    // Un article sans enfant ne porte pas de tableau vide inutile.
    if (!converti.children?.length) delete converti.children;
    return converti;
  };

  const anciensLots = new Map((existing?.lots ?? []).map(l => [l.id, l]));
  const anciensChaps = new Map(
    (existing?.lots ?? []).flatMap(l => l.chapitres.map(c => [c.id, c] as const)),
  );

  const lots: BPULot[] = dpgf.lots.map((lot: Lot) => recomputeLot<BPULot>({
    ...lot,
    trancheId: anciensLots.get(lot.id)?.trancheId,
    projectLotId: anciensLots.get(lot.id)?.projectLotId,
    chapitres: lot.chapitres.map((chap: Chapitre): BPUChapitre => ({
      ...chap,
      trancheId: anciensChaps.get(chap.id)?.trancheId,
      lignes: chap.lignes.map(convertLigne),
    })),
  }));

  const totalHT = lots.reduce((s, l) => s + l.sousTotal, 0);
  return {
    ...base,
    projectId: dpgf.projectId,
    dpgfId: dpgf.id,
    titre: base.titre || 'BPU',
    lots,
    TVA: existing?.TVA ?? dpgf.TVA,
    totalHT,
    totalTTC: totalHT * (1 + (existing?.TVA ?? dpgf.TVA) / 100),
  };
}

export interface ReversementDiff {
  /** Articles du DPGF dont le prix unitaire change. */
  modifies: { id: string; numero: string; designation: string; ancien: number; nouveau: number }[];
  /** Articles du DPGF que le BPU ne chiffre pas. */
  nonChiffres: { numero: string; designation: string }[];
  /** Articles présents dans le seul BPU : signalés, jamais ajoutés en silence. */
  absentsDuDpgf: { numero: string; designation: string }[];
}

/**
 * Reverse les prix unitaires du BPU/DQE dans le DPGF.
 *
 * Rend le DPGF modifié ET le détail des écarts : écraser un DPGF depuis un DQE
 * est l'action la plus destructrice de cette fonctionnalité, l'appelant doit
 * pouvoir la faire confirmer article par article avant de l'appliquer.
 * Les articles que seul le BPU possède sont rapportés, jamais ajoutés.
 */
export function bpuToDpgf(
  bpu: BPU, dpgf: DPGF, options: { reprendreQuantites?: boolean } = {},
): { dpgf: DPGF; diff: ReversementDiff } {
  const source = indexById<BPULigne>(bpu.lots);
  const diff: ReversementDiff = { modifies: [], nonChiffres: [], absentsDuDpgf: [] };
  const vus = new Set<string>();

  const convert = (l: Ligne): Ligne => {
    const src = source.get(l.id);
    const children = l.children?.map(convert);
    if (!src) {
      if (!children?.length) diff.nonChiffres.push({ numero: l.numero, designation: l.designation });
      return children ? { ...l, children } : l;
    }
    vus.add(l.id);
    const quantite = options.reprendreQuantites ? src.quantite : l.quantite;
    if (src.prixUnitaire !== l.prixUnitaire) {
      diff.modifies.push({
        id: l.id, numero: l.numero, designation: l.designation,
        ancien: l.prixUnitaire, nouveau: src.prixUnitaire,
      });
    }
    return {
      ...l, children,
      quantite,
      prixUnitaire: src.prixUnitaire,
      prixTotal: quantite * src.prixUnitaire,
    };
  };

  const lots: Lot[] = dpgf.lots.map(lot => recomputeLot<Lot>({
    ...lot,
    chapitres: lot.chapitres.map(chap => ({ ...chap, lignes: chap.lignes.map(convert) })),
  }));

  for (const [id, ligne] of source) {
    if (!vus.has(id) && !ligne.children?.length) {
      diff.absentsDuDpgf.push({ numero: ligne.numero, designation: ligne.designation });
    }
  }

  const totalHT = lots.reduce((s, l) => s + l.sousTotal, 0);
  return {
    dpgf: { ...dpgf, lots, totalHT, totalTTC: totalHT * (1 + dpgf.TVA / 100) },
    diff,
  };
}

/**
 * Attribue une référence courte et stable aux articles qui n'en ont pas.
 * C'est cette référence, et non l'identifiant interne, que porte la colonne
 * « Réf. » des exports : un bordereau déjà envoyé reste rapprochable même si
 * la forme des identifiants change plus tard.
 */
export function assignerReferences(bpu: BPU): BPU {
  const prises = new Set<string>();
  forEachLigne(bpu.lots, (l: BPULigne) => { if (l.refBpu) prises.add(l.refBpu); });

  let compteur = prises.size;
  const suivante = (): string => {
    let ref: string;
    do {
      ref = (++compteur).toString(36).toUpperCase().padStart(3, '0');
    } while (prises.has(ref));
    prises.add(ref);
    return ref;
  };

  let modifie = false;
  const convert = (l: BPULigne): BPULigne => {
    const children = l.children?.map(convert);
    if (l.refBpu) return children ? { ...l, children } : l;
    modifie = true;
    return { ...l, refBpu: suivante(), ...(children ? { children } : {}) };
  };

  const lots = bpu.lots.map(lot => ({
    ...lot,
    chapitres: lot.chapitres.map(chap => ({ ...chap, lignes: chap.lignes.map(convert) })),
  }));

  return modifie ? { ...bpu, lots } : bpu;
}
