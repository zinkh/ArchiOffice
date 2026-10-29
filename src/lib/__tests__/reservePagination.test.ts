import { describe, expect, it } from 'vitest';
import {
  RESERVE_PAGE_SIZE, limitToReveal, nextChunk, nextLimit, paginateFlat, paginateGroups, rankInFlat, rankInGroups,
} from '../reservePagination';

type Row = { id: string };
const rows = (prefix: string, n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}` }));
const idOf = (r: Row) => r.id;
const open = () => true;

describe('paginateFlat', () => {
  it("limite l'affichage sans perdre le total", () => {
    const page = paginateFlat(rows('r', 3000), RESERVE_PAGE_SIZE);
    expect(page.items).toHaveLength(50);
    expect(page.shown).toBe(50);
    expect(page.total).toBe(3000);
    expect(page.items[0].id).toBe('r1');
  });

  it('affiche tout quand la liste tient dans la fenêtre', () => {
    const page = paginateFlat(rows('r', 12), 50);
    expect(page.shown).toBe(12);
    expect(page.total).toBe(12);
  });

  it("une liste vide ou une limite négative n'affiche rien", () => {
    expect(paginateFlat([], 50)).toEqual({ items: [], shown: 0, total: 0 });
    expect(paginateFlat(rows('r', 5), -3).shown).toBe(0);
  });
});

describe('paginateGroups', () => {
  const groups: [string, Row[]][] = [['Gros œuvre', rows('a', 30)], ['Peinture', rows('b', 30)], ['Électricité', rows('c', 30)]];

  it("coupe au milieu d'un groupe, dans l'ordre des groupes", () => {
    const page = paginateGroups(groups, 40, open);
    expect(page.shown).toBe(40);
    expect(page.total).toBe(90);
    expect(page.groups.map(g => [g.key, g.rows.length, g.total])).toEqual([['Gros œuvre', 30, 30], ['Peinture', 10, 30]]);
  });

  it("un groupe entièrement au-delà de la fenêtre n'a pas encore d'en-tête", () => {
    const page = paginateGroups(groups, 30, open);
    expect(page.groups.map(g => g.key)).toEqual(['Gros œuvre']);
  });

  it("un groupe replié garde son en-tête, annonce son effectif et ne consomme aucune ligne", () => {
    const page = paginateGroups(groups, 40, key => key !== 'Gros œuvre');
    expect(page.groups[0]).toEqual({ key: 'Gros œuvre', rows: [], total: 30, expanded: false });
    expect(page.shown).toBe(40);
    // Les 30 lignes repliées ne comptent pas dans « 40 sur 60 ».
    expect(page.total).toBe(60);
  });

  it('afficher tout rend chaque ligne exactement une fois', () => {
    const page = paginateGroups(groups, 10_000, open);
    expect(page.shown).toBe(90);
    expect(page.groups.flatMap(g => g.rows.map(idOf))).toHaveLength(90);
  });
});

describe('nextLimit et nextChunk', () => {
  it("la liste grandit d'une page à la fois", () => {
    expect(nextLimit(50)).toBe(100);
    expect(nextLimit(100, 25)).toBe(125);
  });

  it('annonce le nombre de lignes que le bouton ajoutera, jamais plus que ce qui reste', () => {
    expect(nextChunk(50, 3000)).toBe(50);
    expect(nextChunk(2980, 3000)).toBe(20);
    expect(nextChunk(3000, 3000)).toBe(0);
    expect(nextChunk(60, 40)).toBe(0);
  });
});

describe("rang et révélation d'une ligne", () => {
  it('rang dans une liste à plat', () => {
    expect(rankInFlat(rows('r', 100), idOf, 'r75')).toBe(75);
    expect(rankInFlat(rows('r', 100), idOf, 'absente')).toBeNull();
  });

  it('rang dans un tableau groupé : seuls les groupes dépliés comptent', () => {
    const groups: [string, Row[]][] = [['A', rows('a', 30)], ['B', rows('b', 30)], ['C', rows('c', 30)]];
    expect(rankInGroups(groups, open, idOf, 'c5')).toBe(65);
    expect(rankInGroups(groups, key => key !== 'A', idOf, 'c5')).toBe(35);
    // Une ligne d'un groupe replié n'est pas affichable : pas de rang.
    expect(rankInGroups(groups, key => key !== 'B', idOf, 'b1')).toBeNull();
  });

  it('la limite grandit par pages entières pour révéler une réserve créée au-delà de la fenêtre', () => {
    expect(limitToReveal(10, 50)).toBe(50);
    expect(limitToReveal(50, 50)).toBe(50);
    expect(limitToReveal(51, 50)).toBe(100);
    expect(limitToReveal(230, 50)).toBe(250);
    // Jamais de recul : une limite déjà large reste telle quelle.
    expect(limitToReveal(60, 200)).toBe(200);
  });
});
