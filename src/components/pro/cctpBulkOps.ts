// ── Opérations groupées du CCTP ──────────────────────────────────────────────
// Dupliquer et modifier plusieurs postes d'un coup. Les clés de sélection sont
// positionnelles (cf. treeOps.rowKey) : tout est traité du dernier élément vers
// le premier quand la structure change, et un parent sélectionné avec ses
// descendants ne compte qu'une fois (sa copie emporte déjà les siens).
import type { Lot, Ligne } from '../../types/dpgf';
import { ajouterClause } from '../../lib/bibliothequeClauses';
import { basculerBatimentEnMasse } from '../../lib/batimentsArticles';
import { duplicateHierarchy, ligneAtPath, type HierarchySelection } from './hierarchyOps';
import { parseSelection } from './selectionOps';

const tuple = (s: HierarchySelection): number[] =>
  s.kind === 'lot' ? [s.lotIdx] : s.kind === 'chapitre' ? [s.lotIdx, s.chapIdx] : [s.lotIdx, s.chapIdx, ...s.lignePath];

/** Les éléments de plus haut niveau : ceux dont aucun ancêtre n'est aussi sélectionné. */
export function racinesDeSelection(keys: Iterable<string>): HierarchySelection[] {
  const sel = parseSelection(keys);
  return sel.filter(s => !sel.some(o => {
    if (o === s) return false;
    const a = tuple(o);
    const b = tuple(s);
    return a.length < b.length && a.every((n, i) => n === b[i]);
  }));
}

/**
 * Duplique chaque élément sélectionné juste après lui (même niveau), du dernier
 * au premier pour qu'aucune copie ne décale un élément restant à traiter.
 * `copies` est le nombre d'éléments dupliqués.
 */
export function dupliquerSelection<L extends Lot>(lots: L[], keys: Iterable<string>, newId: () => string): { lots: L[]; copies: number } {
  const racines = racinesDeSelection(keys).reverse();
  let courant = lots;
  for (const s of racines) courant = duplicateHierarchy(courant, s, newId).lots;
  return { lots: courant, copies: racines.length };
}

// ── Modification en masse ────────────────────────────────────────────────────

export interface PatchMasse {
  /** Articles et chapitres : visible dans le DPGF (vrai) ou propre au CCTP (faux). */
  visibleDpgf?: boolean;
  /** Phase de l'opération ; chaîne vide : retire l'affectation. */
  phaseId?: string;
  /** Bâtiments à ajouter ou à retirer sur les articles des éléments choisis. */
  batiments?: { ajouter?: string[]; retirer?: string[] };
  /** Articles seulement ; chaîne vide : efface. */
  localisation?: string;
  unite?: string;
  /** Texte technique : ajouté au début ou à la fin, ou une expression remplacée par une autre. */
  texte?:
    | { mode: 'debut' | 'fin'; valeur: string }
    | { mode: 'remplacer'; cherche: string; valeur: string };
}

export interface ResultatMasse<L extends Lot> {
  lots: L[];
  /** Éléments réellement modifiés (un texte déjà présent ou absent ne compte pas). */
  modifies: number;
}

/** Nouveau texte après l'opération, ou `null` quand rien ne change. */
export function appliquerTexte(actuel: string, op: NonNullable<PatchMasse['texte']>): string | null {
  if (op.mode === 'remplacer') {
    if (!op.cherche || !actuel.includes(op.cherche)) return null;
    const nouveau = actuel.split(op.cherche).join(op.valeur);
    return nouveau === actuel ? null : nouveau;
  }
  const valeur = op.valeur.trim();
  if (!valeur) return null;
  if (op.mode === 'fin') {
    const r = ajouterClause(actuel, valeur);
    return r.ajoute ? r.texte : null;
  }
  if (actuel.includes(valeur)) return null;
  return actuel.trim() ? `${valeur}\n\n${actuel.trimStart()}` : valeur;
}

/**
 * Applique `patch` aux éléments sélectionnés eux-mêmes (pas à leurs
 * descendants). Un champ absent du patch n'est pas touché. Rend un nouvel arbre,
 * l'original reste intact.
 */
export function modifierEnMasse<L extends Lot>(lots: L[], keys: Iterable<string>, patch: PatchMasse): ResultatMasse<L> {
  const cles = [...keys];
  const selection = parseSelection(cles);
  let next = structuredClone(lots) as L[];
  const modifies = new Set<string>();
  const cleDe = (s: HierarchySelection) => tuple(s).join('-') + s.kind;

  for (const s of selection) {
    const lot = next[s.lotIdx];
    if (!lot) continue;
    const noeud: any = s.kind === 'lot' ? lot
      : s.kind === 'chapitre' ? lot.chapitres[s.chapIdx]
        : ligneAtPath(lot.chapitres[s.chapIdx]?.lignes ?? [], s.lignePath);
    if (!noeud) continue;

    if (patch.visibleDpgf !== undefined && s.kind !== 'lot' && !!noeud.cctpOnly !== !patch.visibleDpgf) {
      noeud.cctpOnly = !patch.visibleDpgf;
      modifies.add(cleDe(s));
    }
    if (patch.phaseId !== undefined && (noeud.phaseId ?? '') !== patch.phaseId) {
      if (patch.phaseId) noeud.phaseId = patch.phaseId; else delete noeud.phaseId;
      modifies.add(cleDe(s));
    }
    if (s.kind === 'ligne') {
      const l = noeud as Ligne;
      if (patch.localisation !== undefined && (l.localisation ?? '') !== patch.localisation.trim()) {
        l.localisation = patch.localisation.trim() || undefined;
        modifies.add(cleDe(s));
      }
      if (patch.unite !== undefined && (l.unite ?? '') !== patch.unite.trim()) {
        l.unite = patch.unite.trim();
        modifies.add(cleDe(s));
      }
    }
    if (patch.texte) {
      const nouveau = appliquerTexte(noeud.cctpDescription ?? '', patch.texte);
      if (nouveau !== null) { noeud.cctpDescription = nouveau; modifies.add(cleDe(s)); }
    }
  }

  // Les bâtiments passent par l'opération existante (héritage lot > chapitre > article),
  // qui agit sur les articles contenus : un élément dont les bâtiments changent compte.
  const ajouter = patch.batiments?.ajouter ?? [];
  const retirer = patch.batiments?.retirer ?? [];
  if (ajouter.length || retirer.length) {
    const avant = next;
    for (const id of ajouter) next = basculerBatimentEnMasse(next, cles, id, true) as L[];
    for (const id of retirer) next = basculerBatimentEnMasse(next, cles, id, false) as L[];
    if (JSON.stringify(next) !== JSON.stringify(avant)) for (const s of selection) modifies.add(cleDe(s));
  }

  return { lots: next, modifies: modifies.size };
}
