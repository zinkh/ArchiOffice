// ── Opérations d'arbre partagées par les ateliers PRO ────────────────────────
// Logique pure, sans React et sans JSX, extraite verbatim de DPGFWorkspace.tsx
// pour être réutilisée par l'atelier BPU/DQE sans dupliquer 800 lignes ni
// toucher à l'éditeur DPGF en production.
//
// Tout est générique sur la FORME des nœuds plutôt que sur les types du DPGF,
// pour que les types du BPU — qui étendent ceux du DPGF — passent tels quels.

// ── Identifiants ─────────────────────────────────────────────────────────────
let _uid = 0;
/**
 * Conservé pour le DPGF, dont les identifiants existants ont cette forme.
 * À NE PAS utiliser pour des nœuds neufs de BPU : le compteur repart de zéro à
 * chaque rechargement, donc deux articles créés dans la même milliseconde de
 * part et d'autre d'un rechargement peuvent entrer en collision — et les prix
 * des offres étant indexés sur ces identifiants, une collision fusionnerait
 * silencieusement les prix de deux articles. Utiliser crypto.randomUUID().
 */
export const uid = () => `id_${Date.now()}_${_uid++}`;

// ── Formules ─────────────────────────────────────────────────────────────────
/**
 * Évalue une cellule commençant par « = ». Le jeu de caractères est filtré
 * avant évaluation, donc l'entrée est bornée à de l'arithmétique.
 *
 * RÉSERVÉ AUX CELLULES SAISIES PAR L'UTILISATEUR. Ne jamais l'appliquer à une
 * donnée importée : au-delà de l'odeur d'injection, la fonction renvoie 0 en
 * cas d'échec, ce qui transformerait « l'entreprise n'a pas chiffré ce poste »
 * en « l'entreprise a chiffré 0 € » — autre chose au moment de classer les
 * offres. Pour les fichiers reçus, voir parseFrenchNumber dans lib/bpuImport.
 */
export function evalFormula(raw: string): number {
  if (!raw.startsWith('=')) return parseFloat(raw) || 0;
  try {
    const expr = raw.slice(1).replace(/[^0-9+\-*/.() ]/g, '');
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + expr + ')')();
    return typeof result === 'number' && isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}

// Profondeur maximale : 0=lot, 1=chapitre, 2=article, 3 et 4=sous-articles.
export const MAX_ARTICLE_DEPTH = 4;

// ── Formes minimales attendues ───────────────────────────────────────────────
export interface LigneLike {
  id: string;
  prixTotal: number;
  children?: this[] | any[];
  cctpOnly?: boolean;
}
export interface ChapitreLike {
  id: string;
  lignes: any[];
  cctpOnly?: boolean;
}
export interface LotLike {
  id: string;
  chapitres: any[];
  sousTotal: number;
}

// ── Parcours récursifs ───────────────────────────────────────────────────────

export function mutateLigneAtPath<T extends { children?: any[] }>(
  lignes: T[], path: number[], fn: (l: T) => T,
): T[] {
  const [idx, ...rest] = path;
  const newLignes = [...lignes];
  if (rest.length === 0) {
    newLignes[idx] = fn({ ...newLignes[idx] });
  } else {
    const parent = { ...newLignes[idx] };
    parent.children = mutateLigneAtPath(parent.children || [], rest, fn as any);
    newLignes[idx] = parent;
  }
  return newLignes;
}

export function deleteLigneAtPath<T extends { children?: any[] }>(lignes: T[], path: number[]): T[] {
  const [idx, ...rest] = path;
  if (rest.length === 0) {
    return lignes.filter((_, i) => i !== idx);
  }
  const newLignes = [...lignes];
  const parent = { ...newLignes[idx] };
  parent.children = deleteLigneAtPath(parent.children || [], rest);
  newLignes[idx] = parent;
  return newLignes;
}

export function addChildToLigneAtPath<T extends { children?: any[] }>(
  lignes: T[], path: number[], newChild: T,
): T[] {
  const [idx, ...rest] = path;
  const newLignes = [...lignes];
  if (rest.length === 0) {
    const parent = { ...newLignes[idx] };
    parent.children = [...(parent.children || []), newChild];
    newLignes[idx] = parent;
  } else {
    const parent = { ...newLignes[idx] };
    parent.children = addChildToLigneAtPath(parent.children || [], rest, newChild);
    newLignes[idx] = parent;
  }
  return newLignes;
}

/** Un parent porte la somme de ses enfants plutôt que son propre montant. */
export function sumLigne<T extends { prixTotal: number; children?: any[] }>(ligne: T): number {
  if (ligne.children && ligne.children.length > 0) {
    return ligne.children.reduce((s: number, c: T) => s + sumLigne(c), 0);
  }
  return ligne.prixTotal;
}

export function collectLigneIdsWithChildren<T extends { id: string; children?: any[] }>(
  lignes: T[], set: Set<string>,
): void {
  lignes.forEach(l => {
    if (l.children && l.children.length > 0) {
      set.add(l.id);
      collectLigneIdsWithChildren(l.children, set);
    }
  });
}

/** Recalcule le sous-total d'un lot en descendant dans les sous-articles. */
export function recomputeLot<L extends LotLike>(lot: L): L {
  const sousTotal = lot.chapitres.reduce(
    (s: number, c: any) => s + c.lignes.reduce((ls: number, l: any) => ls + sumLigne(l), 0), 0,
  );
  return { ...lot, sousTotal };
}

/** Parcourt tous les articles d'un arbre de lots, sous-articles compris. */
export function forEachLigne<L extends LotLike>(
  lots: L[],
  fn: (ligne: any, chapitre: any, lot: L, path: number[]) => void,
): void {
  lots.forEach(lot => {
    lot.chapitres.forEach((chap: any) => {
      const walk = (lignes: any[], prefix: number[]) => {
        lignes.forEach((ligne, i) => {
          const path = [...prefix, i];
          fn(ligne, chap, lot, path);
          if (ligne.children?.length) walk(ligne.children, path);
        });
      };
      walk(chap.lignes, []);
    });
  });
}

// ── Aplatissement pour le rendu de la table ──────────────────────────────────

export interface FlatRow<L = any, C = any, G = any> {
  kind: 'lot' | 'chapitre' | 'ligne';
  lotIdx: number;
  chapIdx?: number;
  lignePath?: number[];
  lot: L;
  chapitre?: C;
  ligne?: G;
  depth: number;
}

export interface ExpansionState {
  expandedLots: Set<string>;
  expandedChaps: Set<string>;
  expandedLignes: Set<string>;
}

/**
 * Construit les lignes visibles de la table. Les nœuds marqués `cctpOnly` sont
 * écartés : ils n'existent que dans la vue CCTP. Les types du BPU ne posent
 * jamais ce drapeau, le filtre est donc sans effet de ce côté.
 */
export function buildFlatRows<L extends LotLike, C extends ChapitreLike, G extends LigneLike>(
  lots: L[], { expandedLots, expandedChaps, expandedLignes }: ExpansionState,
): FlatRow<L, C, G>[] {
  const rows: FlatRow<L, C, G>[] = [];
  lots.forEach((lot, li) => {
    rows.push({ kind: 'lot', depth: 0, lotIdx: li, lot });
    if (!expandedLots.has(lot.id)) return;
    lot.chapitres.forEach((chap: C, ci: number) => {
      if (chap.cctpOnly) return;
      rows.push({ kind: 'chapitre', depth: 1, lotIdx: li, chapIdx: ci, lot, chapitre: chap });
      if (!expandedChaps.has(chap.id)) return;
      const pushLignes = (lignes: G[], pathPrefix: number[], depth: number) => {
        lignes.forEach((ligne, lgi) => {
          if (ligne.cctpOnly) return;
          const lignePath = [...pathPrefix, lgi];
          rows.push({ kind: 'ligne', depth, lotIdx: li, chapIdx: ci, lignePath, lot, chapitre: chap, ligne });
          if (ligne.children && ligne.children.length > 0 && expandedLignes.has(ligne.id) && depth < MAX_ARTICLE_DEPTH) {
            pushLignes(ligne.children as G[], lignePath, depth + 1);
          }
        });
      };
      pushLignes(chap.lignes as G[], [], 2);
    });
  });
  return rows;
}

// ── Clés de ligne ────────────────────────────────────────────────────────────
// Positionnelles, et relues telles quelles. Format conservé à l'identique pour
// que le comportement du DPGF ne bouge pas d'un octet, mais la lecture est
// désormais centralisée ici plutôt que réécrite à la main dans commitEdit.

export function rowKey(r: FlatRow): string {
  return r.kind === 'lot' ? `lot-${r.lotIdx}`
    : r.kind === 'chapitre' ? `chap-${r.lotIdx}-${r.chapIdx}`
    : `ligne-${r.lotIdx}-${r.chapIdx}-${r.lignePath!.join('-')}`;
}

export type ParsedRowKey =
  | { kind: 'lot'; lotIdx: number }
  | { kind: 'chapitre'; lotIdx: number; chapIdx: number }
  | { kind: 'ligne'; lotIdx: number; chapIdx: number; lignePath: number[] }
  | null;

export function parseRowKey(key: string): ParsedRowKey {
  const parts = key.split('-');
  if (parts[0] === 'lot' && parts.length === 2) {
    return { kind: 'lot', lotIdx: Number(parts[1]) };
  }
  if (parts[0] === 'chap' && parts.length === 3) {
    return { kind: 'chapitre', lotIdx: Number(parts[1]), chapIdx: Number(parts[2]) };
  }
  if (parts[0] === 'ligne' && parts.length >= 4) {
    return { kind: 'ligne', lotIdx: Number(parts[1]), chapIdx: Number(parts[2]), lignePath: parts.slice(3).map(Number) };
  }
  return null;
}
