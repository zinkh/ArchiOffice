// Pagination PROGRESSIVE de la liste des réserves (ReserveTracker) : 50 lignes, puis 50 de plus au
// défilement. Un OPR compte des centaines, parfois des milliers de réserves ; la liste les rendait
// toutes, deux fois (liste mobile ET tableau, l'un masqué par CSS), chacune avec sa vignette et son
// sélecteur de statut. Sur un iPad, ouvrir l'onglet suffisait à figer l'écran.
//
// Ce n'est pas `usePagination` (pages numérotées, retour à la page 1 dès que le nombre de lignes
// change) : sur un chantier on crée une réserve, on change un statut, et la liste ne doit pas
// remonter en haut. Les compteurs, les repères de plan et l'export PDF continuent de porter sur
// TOUTE la liste en mémoire : seul l'affichage est limité.

export const RESERVE_PAGE_SIZE = 50;

export interface FlatPage<T> {
  items: T[];
  shown: number;
  total: number;
}

/** Les `limit` premières lignes d'une liste à plat (liste mobile). */
export function paginateFlat<T>(items: T[], limit: number): FlatPage<T> {
  const taken = items.slice(0, Math.max(0, limit));
  return { items: taken, shown: taken.length, total: items.length };
}

export interface GroupPage<T> {
  key: string;
  /** Lignes affichées de ce groupe (vide pour un groupe replié). */
  rows: T[];
  /** Nombre de lignes du groupe, affichées ou non : c'est ce qu'annonce son en-tête. */
  total: number;
  expanded: boolean;
}

export interface GroupsPage<T> {
  groups: GroupPage<T>[];
  shown: number;
  /** Lignes des groupes dépliés : un groupe replié n'affiche rien, il ne compte donc pas dans « N sur M ». */
  total: number;
}

/**
 * Les `limit` premières lignes d'un tableau groupé (par lot), dans l'ordre des groupes. Un groupe
 * dont aucune ligne n'est encore affichée n'a pas d'en-tête : il apparaît avec la suite. Un groupe
 * replié garde son en-tête (on peut le déplier) sans consommer de lignes.
 */
export function paginateGroups<T>(
  groups: [string, T[]][],
  limit: number,
  isExpanded: (key: string) => boolean,
): GroupsPage<T> {
  let budget = Math.max(0, limit);
  let shown = 0;
  let total = 0;
  const page: GroupPage<T>[] = [];
  for (const [key, rows] of groups) {
    if (!isExpanded(key)) {
      page.push({ key, rows: [], total: rows.length, expanded: false });
      continue;
    }
    total += rows.length;
    if (budget <= 0) continue;
    const taken = rows.slice(0, budget);
    budget -= taken.length;
    shown += taken.length;
    page.push({ key, rows: taken, total: rows.length, expanded: true });
  }
  return { groups: page, shown, total };
}

/** Prochaine limite d'affichage : une page de plus. */
export function nextLimit(limit: number, step: number = RESERVE_PAGE_SIZE): number {
  return Math.max(0, limit) + step;
}

/** Nombre de lignes que le prochain « Afficher la suite » ajoutera (jamais plus que ce qui reste). */
export function nextChunk(shown: number, total: number, step: number = RESERVE_PAGE_SIZE): number {
  return Math.max(0, Math.min(step, total - shown));
}

/** Rang (à partir de 1) d'une ligne dans une liste à plat, ou null si elle n'y figure pas. */
export function rankInFlat<T>(items: T[], idOf: (row: T) => string, id: string): number | null {
  const index = items.findIndex(row => idOf(row) === id);
  return index === -1 ? null : index + 1;
}

/** Rang (à partir de 1) d'une ligne dans un tableau groupé : seules les lignes des groupes dépliés comptent. */
export function rankInGroups<T>(
  groups: [string, T[]][],
  isExpanded: (key: string) => boolean,
  idOf: (row: T) => string,
  id: string,
): number | null {
  let rank = 0;
  for (const [key, rows] of groups) {
    if (!isExpanded(key)) continue;
    const index = rows.findIndex(row => idOf(row) === id);
    if (index !== -1) return rank + index + 1;
    rank += rows.length;
  }
  return null;
}

/**
 * Limite à appliquer pour qu'une ligne de rang `rank` soit affichée : la limite actuelle si elle y
 * est déjà, sinon la page entière qui la contient (la liste grandit par pages, jamais d'une ligne).
 */
export function limitToReveal(rank: number, current: number, step: number = RESERVE_PAGE_SIZE): number {
  if (rank <= current) return current;
  return Math.ceil(rank / step) * step;
}
