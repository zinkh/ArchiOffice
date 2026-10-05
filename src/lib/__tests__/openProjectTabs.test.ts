import { describe, it, expect } from 'vitest';
import { MAX_OPEN_PROJECT_TABS, pathAfterClosing, projectIdFromPath, removeTab, upsertTab } from '../openProjectTabs';
import type { OpenProjectTab } from '../openProjectTabs';

const tab = (id: string, touchedAt: number): OpenProjectTab => ({ id, name: `Affaire ${id}`, path: `/projects/${id}`, touchedAt });

describe('openProjectTabs', () => {
  it('reconnaît l\'affaire d\'une adresse de fiche, et seulement elle', () => {
    expect(projectIdFromPath('/projects/abc-123')).toBe('abc-123');
    expect(projectIdFromPath('/projects/abc-123/')).toBe('abc-123');
    expect(projectIdFromPath('/projects')).toBeNull();
    expect(projectIdFromPath('/tenders/abc')).toBeNull();
    expect(projectIdFromPath('/projects/abc/extra')).toBeNull();
  });

  it('ajoute un onglet puis met à jour le même sans le dupliquer ni le déplacer', () => {
    const a = upsertTab([], 'a', { name: 'IUT' }, 1, true);
    const b = upsertTab(a, 'b', { name: 'Villa' }, 2, true);
    const c = upsertTab(b, 'a', { path: '/projects/a?tab=ACT' }, 3, true);
    expect(c.map(t => t.id)).toEqual(['a', 'b']);
    expect(c[0]).toMatchObject({ name: 'IUT', path: '/projects/a?tab=ACT', touchedAt: 3 });
  });

  it('plafonne à 5 onglets en refermant le moins récemment consulté, jamais le nouveau', () => {
    let list: OpenProjectTab[] = [];
    ['a', 'b', 'c', 'd', 'e'].forEach((id, i) => { list = upsertTab(list, id, { name: id }, i + 1, true); });
    list = upsertTab(list, 'a', {}, 10, true); // « a » redevient récent : « b » est le plus ancien
    list = upsertTab(list, 'f', { name: 'f' }, 11, true);
    expect(list).toHaveLength(MAX_OPEN_PROJECT_TABS);
    expect(list.map(t => t.id)).toEqual(['a', 'c', 'd', 'e', 'f']);
  });

  it('ne change pas l\'ordre de consultation quand on ne fait que renseigner le nom', () => {
    const list = upsertTab([tab('a', 5)], 'a', { name: 'Nom' }, 99, false);
    expect(list[0]).toMatchObject({ name: 'Nom', touchedAt: 5 });
  });

  it('rouvre le voisin à la fermeture, sinon la liste des affaires', () => {
    const list = [tab('a', 1), tab('b', 2), tab('c', 3)];
    expect(pathAfterClosing(list, 'b')).toBe('/projects/c');
    expect(pathAfterClosing(list, 'c')).toBe('/projects/b');
    expect(pathAfterClosing([tab('a', 1)], 'a')).toBe('/projects');
    expect(removeTab(list, 'a').map(t => t.id)).toEqual(['b', 'c']);
  });
});
