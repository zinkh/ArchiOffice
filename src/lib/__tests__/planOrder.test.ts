import { describe, expect, it } from 'vitest';
import { appliquerOrdre, deplacer, trierPlans } from '../planOrder';

const p = (id: string, uploaded_at: string, sort_order?: number | null) => ({ id, uploaded_at, sort_order });

describe('trierPlans', () => {
  it('sans ordre manuel : le plus récent en tête', () => {
    expect(trierPlans([p('a', '2026-01-01'), p('b', '2026-03-01')]).map(x => x.id)).toEqual(['b', 'a']);
  });
  it('les plans rangés suivent leur rang, les non rangés passent devant', () => {
    const l = trierPlans([p('a', '2026-01-01', 1), p('b', '2026-01-02', 0), p('nouveau', '2026-05-01')]);
    expect(l.map(x => x.id)).toEqual(['nouveau', 'b', 'a']);
  });
  it('ne modifie pas le tableau reçu', () => {
    const src = [p('a', '2026-01-01'), p('b', '2026-03-01')];
    trierPlans(src);
    expect(src.map(x => x.id)).toEqual(['a', 'b']);
  });
  it('une date illisible ne fait pas échouer le tri', () => {
    expect(trierPlans([p('a', 'n/a'), p('b', '2026-03-01')]).map(x => x.id)).toEqual(['b', 'a']);
  });
});

describe('deplacer', () => {
  it('déplace vers le haut, vers le bas et borne le rang', () => {
    expect(deplacer(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(deplacer(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(deplacer(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a']);
  });
  it('rend la même liste si rien ne change ou si l\'id est inconnu', () => {
    const ids = ['a', 'b'];
    expect(deplacer(ids, 'a', 0)).toBe(ids);
    expect(deplacer(ids, 'z', 0)).toBe(ids);
  });
});

describe('appliquerOrdre', () => {
  it('donne un rang à chaque plan listé', () => {
    const r = appliquerOrdre([p('a', 'x'), p('b', 'x'), p('c', 'x', 5)], ['b', 'a']);
    expect(r.map(x => x.sort_order)).toEqual([1, 0, 5]);
  });
});

import { idsTriesParNom, sensProchainTri } from '../planOrder';

describe('idsTriesParNom', () => {
  const n = (id: string, name: string) => ({ id, name });
  it('ignore accents et casse, lit les nombres comme des nombres', () => {
    const l = [n('a', 'plan 10.pdf'), n('b', 'Étage.pdf'), n('c', 'plan 2.pdf'), n('d', 'etage 1.pdf')];
    expect(idsTriesParNom(l)).toEqual(['d', 'b', 'c', 'a']);
    expect(idsTriesParNom(l, 'desc')).toEqual(['a', 'c', 'b', 'd']);
  });
  it('conserve l\'ordre d\'arrivée à noms égaux', () => {
    expect(idsTriesParNom([n('x', 'a.pdf'), n('y', 'A.pdf')])).toEqual(['x', 'y']);
  });
});

describe('sensProchainTri', () => {
  it('A→Z d\'abord, puis Z→A quand la liste est déjà triée', () => {
    const l = [{ id: 'b', name: 'b' }, { id: 'a', name: 'a' }];
    expect(sensProchainTri(l)).toBe('asc');
    expect(sensProchainTri([l[1], l[0]])).toBe('desc');
  });
});
