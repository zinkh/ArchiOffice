// ── Affectation des articles aux bâtiments ───────────────────────────────────
// Une opération à plusieurs bâtiments n'a pas les mêmes prestations partout :
// un bardage vertical peut concerner le préau ET le bâtiment A, un bardage
// horizontal le seul bâtiment A. Un article porte donc la LISTE de ses
// bâtiments, avec une quantité par bâtiment (`Ligne.quantitesBatiments`) ;
// sa quantité DPGF est la somme, son montant la somme × P.U.
//
// Un article sans `quantitesBatiments` garde l'ancien régime : un seul bâtiment
// (`batimentId`, hérité du chapitre puis du lot) et sa quantité propre. Une
// chaîne vide dans `batimentId` veut dire « aucun bâtiment », sans héritage.
//
// Toutes les fonctions rendent un arbre neuf.
import type { DPGF, Ligne, Lot, Chapitre } from '../types/dpgf';
import { parseRowKey, recomputeLot } from '../components/pro/treeOps';
import { ligneAtPath } from '../components/pro/hierarchyOps';

/** Bâtiments d'un article feuille et quantité de chacun. */
export function quantitesParBatiment(ligne: Ligne, herite?: string): Record<string, number> {
  if (ligne.quantitesBatiments !== undefined) return ligne.quantitesBatiments;
  const id = ligne.batimentId ?? herite;
  return id ? { [id]: ligne.quantite } : {};
}

export function batimentsDeLigne(ligne: Ligne, herite?: string): string[] {
  return Object.keys(quantitesParBatiment(ligne, herite));
}

/** Quantité et montant d'un article qui ventile sa quantité par bâtiment. */
function recalculer(ligne: Ligne): Ligne {
  if (ligne.quantitesBatiments === undefined) return ligne;
  const quantite = Object.values(ligne.quantitesBatiments).reduce((s, q) => s + (Number(q) || 0), 0);
  return { ...ligne, quantite, prixTotal: quantite * ligne.prixUnitaire };
}

/**
 * Donne à un article feuille exactement ces bâtiments. Un bâtiment déjà
 * affecté garde sa quantité ; un nouveau part à 0, sauf quand l'article
 * n'avait aucun bâtiment : sa quantité saisie revient alors au premier choisi
 * plutôt que de disparaître. Retirer tous les bâtiments rend à l'article une
 * quantité simple, sans héritage du chapitre.
 */
export function affecterBatiments(ligne: Ligne, ids: string[], herite?: string): Ligne {
  const avant = quantitesParBatiment(ligne, herite);
  const uniques = [...new Set(ids)];
  if (!uniques.length) {
    return { ...ligne, quantitesBatiments: undefined, batimentId: '' };
  }
  const reprise = Object.keys(avant).length === 0;
  const quantites: Record<string, number> = {};
  uniques.forEach((id, i) => {
    quantites[id] = id in avant ? avant[id] : reprise && i === 0 ? ligne.quantite : 0;
  });
  return recalculer({ ...ligne, quantitesBatiments: quantites, batimentId: undefined });
}

/** Ajoute ou retire un bâtiment, sans toucher aux autres. */
export function basculerBatiment(ligne: Ligne, id: string, actif: boolean, herite?: string): Ligne {
  const actuels = batimentsDeLigne(ligne, herite);
  const next = actif ? [...actuels.filter(b => b !== id), id] : actuels.filter(b => b !== id);
  if (actif && actuels.includes(id)) return ligne;
  if (!actif && !actuels.includes(id)) return ligne;
  return affecterBatiments(ligne, next, herite);
}

/** Quantité d'un bâtiment déjà affecté à l'article. */
export function fixerQuantiteBatiment(ligne: Ligne, id: string, quantite: number, herite?: string): Ligne {
  const actuelles = quantitesParBatiment(ligne, herite);
  if (!(id in actuelles)) return ligne;
  return recalculer({ ...ligne, quantitesBatiments: { ...actuelles, [id]: quantite }, batimentId: undefined });
}

// ── Sélection en masse ───────────────────────────────────────────────────────

interface Feuille { lotIdx: number; chapIdx: number; path: number[]; ligne: Ligne; herite?: string }

/**
 * Articles feuilles visés par une sélection : un lot ou un chapitre sélectionné
 * vaut tous ses articles, un article à sous-articles vaut ses sous-articles.
 * Chacun n'est compté qu'une fois.
 */
export function feuillesSelectionnees(lots: Lot[], keys: Iterable<string>): Feuille[] {
  const out = new Map<string, Feuille>();
  const descendre = (lotIdx: number, chapIdx: number, lignes: Ligne[], prefix: number[], herite?: string) => {
    lignes.forEach((l, i) => {
      const path = [...prefix, i];
      if (l.children?.length) descendre(lotIdx, chapIdx, l.children, path, l.batimentId ?? herite);
      else out.set(`${lotIdx}-${chapIdx}-${path.join('-')}`, { lotIdx, chapIdx, path, ligne: l, herite });
    });
  };
  for (const key of keys) {
    const s = parseRowKey(key);
    if (!s) continue;
    const lot = lots[s.lotIdx];
    if (!lot) continue;
    const chapitres = s.kind === 'lot' ? lot.chapitres.map((c, i) => [c, i] as const) : [[lot.chapitres[s.chapIdx], s.chapIdx] as const];
    for (const [chap, chapIdx] of chapitres) {
      if (!chap) continue;
      const heriteChap = chap.batimentId ?? lot.batimentId;
      if (s.kind !== 'ligne') { descendre(s.lotIdx, chapIdx, chap.lignes, [], heriteChap); continue; }
      // Héritage jusqu'à l'article visé.
      let herite = heriteChap;
      let lignes = chap.lignes;
      for (const idx of s.lignePath.slice(0, -1)) { herite = lignes[idx]?.batimentId ?? herite; lignes = lignes[idx]?.children ?? []; }
      const ligne = ligneAtPath(chap.lignes, s.lignePath);
      if (!ligne) continue;
      if (ligne.children?.length) descendre(s.lotIdx, chapIdx, ligne.children, s.lignePath, ligne.batimentId ?? herite);
      else out.set(`${s.lotIdx}-${chapIdx}-${s.lignePath.join('-')}`, { lotIdx: s.lotIdx, chapIdx, path: s.lignePath, ligne, herite });
    }
  }
  return [...out.values()];
}

/** Coché pour tous, pour certains ou pour aucun des articles sélectionnés. */
export function etatBatimentSelection(lots: Lot[], keys: Iterable<string>, id: string): 'tous' | 'certains' | 'aucun' {
  const feuilles = feuillesSelectionnees(lots, keys);
  if (!feuilles.length) return 'aucun';
  const n = feuilles.filter(f => batimentsDeLigne(f.ligne, f.herite).includes(id)).length;
  return n === 0 ? 'aucun' : n === feuilles.length ? 'tous' : 'certains';
}

function remplacerLigne(lignes: Ligne[], path: number[], fn: (l: Ligne) => Ligne): Ligne[] {
  const [i, ...reste] = path;
  return lignes.map((l, j) => j !== i ? l : !reste.length ? fn(l) : { ...l, children: remplacerLigne(l.children ?? [], reste, fn) });
}

/** Les parents portent la somme de leurs enfants, CCTP seuls exclus. */
function recalculerParents(lignes: Ligne[]): Ligne[] {
  return lignes.map(l => {
    if (!l.children?.length) return l;
    const children = recalculerParents(l.children);
    return { ...l, children, prixTotal: children.reduce((s, c) => s + (c.cctpOnly ? 0 : c.prixTotal), 0) };
  });
}

/** Applique `fn` à chaque article feuille visé, puis recalcule lots et parents. */
export function modifierFeuilles(lots: Lot[], feuilles: Feuille[], fn: (f: Feuille) => Ligne): Lot[] {
  let next = lots;
  for (const f of feuilles) {
    next = next.map((lot, li) => li !== f.lotIdx ? lot : {
      ...lot,
      chapitres: lot.chapitres.map((c, ci) => ci !== f.chapIdx ? c : { ...c, lignes: remplacerLigne(c.lignes, f.path, () => fn(f)) }),
    });
  }
  const touches = new Set(feuilles.map(f => f.lotIdx));
  return next.map((lot, li) => !touches.has(li) ? lot : recomputeLot({
    ...lot, chapitres: lot.chapitres.map(c => ({ ...c, lignes: recalculerParents(c.lignes) })),
  }));
}

/** Coche ou décoche un bâtiment sur tous les articles de la sélection. */
export function basculerBatimentEnMasse(lots: Lot[], keys: Iterable<string>, id: string, actif: boolean): Lot[] {
  const feuilles = feuillesSelectionnees(lots, keys);
  return modifierFeuilles(lots, feuilles, f => basculerBatiment(f.ligne, id, actif, f.herite));
}

// ── CCTP d'un bâtiment ───────────────────────────────────────────────────────

const aDesArticles = (lignes: Ligne[]): boolean => lignes.length > 0;
const neutreOuEgal = (batimentId: string | undefined, id: string) => !batimentId || batimentId === id;

/**
 * Le CCTP d'un seul bâtiment : ses articles seulement, sans quantité. Un
 * chapitre sans article (généralités, prescriptions communes) reste, sauf s'il
 * est affecté à un autre bâtiment ; un lot reste s'il garde un article, ou s'il
 * ne porte que du texte commun. Un article chiffrable sans bâtiment n'appartient
 * à aucun ; un texte propre au CCTP sans bâtiment appartient à tous.
 */
export function cctpPourBatiment(doc: DPGF, id: string): DPGF {
  const filtrer = (lignes: Ligne[], herite?: string): Ligne[] => lignes.flatMap(l => {
    if (l.children?.length) {
      const children = filtrer(l.children, l.batimentId ?? herite);
      return children.length ? [{ ...l, children }] : [];
    }
    const batiments = batimentsDeLigne(l, herite);
    // Un texte propre au CCTP sans bâtiment (prescriptions générales) vaut
    // pour tous ; un article chiffrable sans bâtiment, pour aucun.
    if (!batiments.length) return l.cctpOnly ? [l] : [];
    return batiments.includes(id) ? [l] : [];
  });
  const lots = doc.lots.flatMap(lot => {
    const avaitDesArticles = lot.chapitres.some(c => aDesArticles(c.lignes));
    const chapitres: Chapitre[] = lot.chapitres.flatMap(c => {
      const herite = c.batimentId ?? lot.batimentId;
      if (!aDesArticles(c.lignes)) return neutreOuEgal(herite, id) ? [c] : [];
      const lignes = filtrer(c.lignes, herite);
      return lignes.length ? [{ ...c, lignes }] : [];
    });
    const garde = chapitres.some(c => aDesArticles(c.lignes))
      || (!avaitDesArticles && neutreOuEgal(lot.batimentId, id));
    return garde ? [{ ...lot, chapitres }] : [];
  });
  return { ...doc, lots };
}

/** Articles qui ne figurent dans le CCTP d'aucun bâtiment. */
export function articlesSansBatiment(doc: DPGF): Ligne[] {
  const out: Ligne[] = [];
  const walk = (lignes: Ligne[], herite?: string) => lignes.forEach(l => {
    if (l.children?.length) walk(l.children, l.batimentId ?? herite);
    else if (!l.cctpOnly && !batimentsDeLigne(l, herite).length) out.push(l);
  });
  doc.lots.forEach(lot => lot.chapitres.forEach(c => walk(c.lignes, c.batimentId ?? lot.batimentId)));
  return out;
}

/** Bâtiment hérité par l'article à `path` (lot, chapitre, puis ses parents), hors le sien. */
export function heritagePour(lot: Lot, chap: Chapitre, path: number[]): string | undefined {
  let herite = chap.batimentId ?? lot.batimentId;
  let lignes = chap.lignes;
  for (const idx of path.slice(0, -1)) {
    herite = lignes[idx]?.batimentId ?? herite;
    lignes = lignes[idx]?.children ?? [];
  }
  return herite;
}

export const batimentsParOrdre = <T extends { ordre: number }>(items: T[] = []) => [...items].sort((a, b) => a.ordre - b.ordre);
