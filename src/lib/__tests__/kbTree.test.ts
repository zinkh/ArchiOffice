// Arbre de pages de la base de données : src/lib/kbTree.ts (logique pure).
import { describe, expect, it } from 'vitest';
import type { KbPage } from '../kb';
import { buildKbTree, kbBreadcrumb, kbFavorites, kbIsSelfOrDescendant, kbPositionBetween, kbTrashRoots } from '../kbTree';

const page = (id: string, parent: string | null, extra: Partial<KbPage> = {}): KbPage => ({
  id, parent_id: parent, kind: 'page', title: id, icon: null, position: 0, is_favorite: false, ...extra,
});

describe('buildKbTree', () => {
  it('imbrique les pages et trie par position puis par titre', () => {
    const tree = buildKbTree([
      page('b', null, { position: 2 }),
      page('a', null, { position: 1 }),
      page('a2', 'a', { position: 2 }),
      page('a1', 'a', { position: 1 }),
      page('c', null, { position: 2, title: 'Aaa' }),
    ]);
    expect(tree.map(n => n.page.id)).toEqual(['a', 'c', 'b']);
    expect(tree[0].children.map(n => n.page.id)).toEqual(['a1', 'a2']);
  });

  it('écarte la corbeille, les lignes de base et les pages orphelines', () => {
    const tree = buildKbTree([
      page('db', null, { kind: 'database' }),
      page('row', 'db'),
      page('old', null, { trashed_at: '2026-11-26T10:00:00Z' }),
      page('child-of-old', 'old'),
      page('ghost-child', 'missing'),
      page('ok', null),
    ]);
    expect(tree.map(n => n.page.id).sort()).toEqual(['db', 'ok']);
    expect(tree.find(n => n.page.id === 'db')!.children).toEqual([]);
  });

  it('ne boucle pas sur une chaîne cyclique corrompue', () => {
    const tree = buildKbTree([page('x', 'y'), page('y', 'x'), page('root', null)]);
    expect(tree.map(n => n.page.id)).toEqual(['root']);
  });
});

describe('favoris, corbeille et fil d\'Ariane', () => {
  it('liste les favoris hors corbeille, dans l\'ordre du titre', () => {
    const favs = kbFavorites([
      page('z', null, { is_favorite: true, title: 'Zinc' }),
      page('a', null, { is_favorite: true, title: 'Acier' }),
      page('t', null, { is_favorite: true, trashed_at: '2026-11-26T10:00:00Z' }),
      page('n', null),
    ]);
    expect(favs.map(p => p.id)).toEqual(['a', 'z']);
  });

  it('ne garde en corbeille que les pages dont le parent n\'y est pas, la plus récente d\'abord', () => {
    const roots = kbTrashRoots([
      page('p', null, { trashed_at: '2026-11-25T08:00:00Z' }),
      page('c', 'p', { trashed_at: '2026-11-25T08:00:00Z' }),
      page('q', null, { trashed_at: '2026-11-26T08:00:00Z' }),
      page('live', null),
    ]);
    expect(roots.map(p => p.id)).toEqual(['q', 'p']);
  });

  it('rend la chaîne de la racine à la page et s\'arrête sur un parent manquant ou une boucle', () => {
    const pages = [page('a', null), page('b', 'a'), page('c', 'b'), page('lost', 'nope'), page('x', 'y'), page('y', 'x')];
    expect(kbBreadcrumb(pages, 'c').map(p => p.id)).toEqual(['a', 'b', 'c']);
    expect(kbBreadcrumb(pages, 'lost').map(p => p.id)).toEqual(['lost']);
    expect(kbBreadcrumb(pages, 'x').length).toBe(2);
    expect(kbBreadcrumb(pages, 'inconnue')).toEqual([]);
  });

  it('reconnaît une page, ses descendants, et pas les autres', () => {
    const pages = [page('a', null), page('b', 'a'), page('c', 'b'), page('d', null)];
    expect(kbIsSelfOrDescendant(pages, 'a', 'a')).toBe(true);
    expect(kbIsSelfOrDescendant(pages, 'a', 'c')).toBe(true);
    expect(kbIsSelfOrDescendant(pages, 'a', 'd')).toBe(false);
  });
});

describe('kbPositionBetween', () => {
  it('place entre deux voisines, en tête ou en queue de liste', () => {
    expect(kbPositionBetween(1, 3)).toBe(2);
    expect(kbPositionBetween(null, 5)).toBe(4);
    expect(kbPositionBetween(5, null)).toBe(6);
    expect(kbPositionBetween(null, null)).toBe(0);
  });
});
