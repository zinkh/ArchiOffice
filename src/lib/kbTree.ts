// Arbre de pages de la base de données du cabinet : logique pure (liste à plat -> arbre, fil d'Ariane,
// positions). Les lignes d'une base n'apparaissent pas dans l'arbre, comme dans la barre latérale de Notion.
import type { KbPage } from './kb';

export interface KbTreeNode {
  page: KbPage;
  children: KbTreeNode[];
}

const byPositionThenTitle = (a: KbPage, b: KbPage) =>
  (a.position - b.position) || (a.title || '').localeCompare(b.title || '', 'fr', { sensitivity: 'base' });

/**
 * Arbre des pages visibles. Sont écartées : la corbeille, les lignes d'une base (leur parent est une
 * base) et les pages orphelines (parent en corbeille ou introuvable), qu'on ne sait pas où afficher.
 */
export function buildKbTree(pages: KbPage[]): KbTreeNode[] {
  const visible = pages.filter(p => !p.trashed_at);
  const byId = new Map(visible.map(p => [p.id, p]));
  const childrenOf = new Map<string | null, KbPage[]>();

  for (const page of visible) {
    const parent = page.parent_id ? byId.get(page.parent_id) : undefined;
    if (page.parent_id && !parent) continue;
    if (parent?.kind === 'database') continue;
    const key = page.parent_id ?? null;
    const list = childrenOf.get(key) ?? [];
    list.push(page);
    childrenOf.set(key, list);
  }

  const seen = new Set<string>();
  const build = (parentId: string | null): KbTreeNode[] =>
    (childrenOf.get(parentId) ?? [])
      .sort(byPositionThenTitle)
      .filter(page => !seen.has(page.id) && (seen.add(page.id), true))
      .map(page => ({ page, children: build(page.id) }));

  return build(null);
}

/** Pages marquées en favori, dans l'ordre du titre. */
export function kbFavorites(pages: KbPage[]): KbPage[] {
  return pages
    .filter(p => p.is_favorite && !p.trashed_at)
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'fr', { sensitivity: 'base' }));
}

/** Pages mises en corbeille dont le parent n'y est pas (la corbeille d'un parent emporte ses enfants). */
export function kbTrashRoots(pages: KbPage[]): KbPage[] {
  const trashed = new Map(pages.filter(p => p.trashed_at).map(p => [p.id, p]));
  return [...trashed.values()]
    .filter(p => !p.parent_id || !trashed.has(p.parent_id))
    .sort((a, b) => String(b.trashed_at).localeCompare(String(a.trashed_at)));
}

/** Chaîne de la racine jusqu'à la page (comprise). S'arrête si l'arbre boucle ou si un parent manque. */
export function kbBreadcrumb(pages: KbPage[], id: string): KbPage[] {
  const byId = new Map(pages.map(p => [p.id, p]));
  const chain: KbPage[] = [];
  const seen = new Set<string>();
  let cursor: string | null = id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const page = byId.get(cursor);
    if (!page) break;
    chain.unshift(page);
    cursor = page.parent_id;
  }
  return chain;
}

/** Vrai si `candidateId` est la page elle-même ou l'un de ses descendants. */
export function kbIsSelfOrDescendant(pages: KbPage[], pageId: string, candidateId: string): boolean {
  return kbBreadcrumb(pages, candidateId).some(p => p.id === pageId);
}

/** Position à donner à une page glissée entre deux voisines (le haut ou le bas de la liste si l'une manque). */
export function kbPositionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}
