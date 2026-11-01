import { describe, it, expect } from 'vitest';
import { chargerEtatArbre, cleEtatArbre, ouvertsSauf, repliesParmi, sauverEtatArbre } from '../cctpTreeState';

const faux = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    m,
  };
};

describe('état d’ouverture de l’arbre du CCTP', () => {
  it('relit ce qui a été enregistré, par projet', () => {
    const s = faux();
    sauverEtatArbre('p1', { lots: new Set(['l1']), chapitres: new Set(['c1', 'c2']) }, s);
    const lu = chargerEtatArbre('p1', s);
    expect([...lu.lots]).toEqual(['l1']);
    expect([...lu.chapitres]).toEqual(['c1', 'c2']);
    expect(chargerEtatArbre('p2', s).lots.size).toBe(0);
  });

  it('efface la clé quand plus rien n’est replié', () => {
    const s = faux();
    sauverEtatArbre('p1', { lots: new Set(['l1']), chapitres: new Set() }, s);
    sauverEtatArbre('p1', { lots: new Set(), chapitres: new Set() }, s);
    expect(s.m.has(cleEtatArbre('p1'))).toBe(false);
  });

  it('ignore un contenu illisible ou mal formé', () => {
    const s = faux();
    s.m.set(cleEtatArbre('p1'), '{pas du json');
    expect(chargerEtatArbre('p1', s).lots.size).toBe(0);
    s.m.set(cleEtatArbre('p1'), JSON.stringify({ lots: [1, 'a', null], chapitres: 'x' }));
    const lu = chargerEtatArbre('p1', s);
    expect([...lu.lots]).toEqual(['a']);
    expect(lu.chapitres.size).toBe(0);
  });

  it('ne plante pas sans stockage ni projet', () => {
    expect(chargerEtatArbre(undefined, faux()).lots.size).toBe(0);
    expect(chargerEtatArbre('p1', null).lots.size).toBe(0);
    expect(() => sauverEtatArbre('p1', { lots: new Set(['l']), chapitres: new Set() }, null)).not.toThrow();
    const plein = { setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    expect(() => sauverEtatArbre('p1', { lots: new Set(['l']), chapitres: new Set() }, plein)).not.toThrow();
  });

  it('un nouvel élément arrive ouvert, un élément disparu n’est pas gardé', () => {
    const replies = new Set(['l1', 'disparu']);
    const ouverts = ouvertsSauf(['l1', 'l2', 'l3'], replies);
    expect([...ouverts]).toEqual(['l2', 'l3']);
    expect([...repliesParmi(['l1', 'l2', 'l3'], ouverts)]).toEqual(['l1']);
  });
});
