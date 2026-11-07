import { describe, expect, it } from 'vitest';
import { idsAssocies, MAX_ASSOCIES, nettoyerAssocies } from '../postesAssocies';

describe('nettoyerAssocies', () => {
  it('rend [] pour une valeur qui n\'est pas une liste', () => {
    expect(nettoyerAssocies(undefined)).toEqual([]);
    expect(nettoyerAssocies('x')).toEqual([]);
    expect(nettoyerAssocies({})).toEqual([]);
  });
  it('écarte les entrées sans identifiant, les doublons et l\'article lui-même', () => {
    expect(nettoyerAssocies([{ articleId: 'a' }, { articleId: 'a' }, { articleId: '' }, null, { articleId: 'me' }, { articleId: ' b ' }], 'me'))
      .toEqual([{ articleId: 'a' }, { articleId: 'b' }]);
  });
  it('garde un coefficient valable différent de 1, écarte les autres', () => {
    expect(nettoyerAssocies([{ articleId: 'a', coefficient: 2.5 }, { articleId: 'b', coefficient: 1 }, { articleId: 'c', coefficient: -3 }, { articleId: 'd', coefficient: 'x' }, { articleId: 'e', coefficient: 1e7 }]))
      .toEqual([{ articleId: 'a', coefficient: 2.5 }, { articleId: 'b' }, { articleId: 'c' }, { articleId: 'd' }, { articleId: 'e' }]);
  });
  it('borne le nombre d\'associés', () => {
    const beaucoup = Array.from({ length: 50 }, (_, i) => ({ articleId: `x${i}` }));
    expect(nettoyerAssocies(beaucoup)).toHaveLength(MAX_ASSOCIES);
  });
});

describe('idsAssocies', () => {
  it('propose les associés dans l\'ordre, sans ceux déjà choisis ni doublon', () => {
    const choisis = [
      { id: 'fenetre', associes: [{ articleId: 'volet' }, { articleId: 'allege' }] },
      { id: 'porte', associes: [{ articleId: 'volet' }, { articleId: 'fenetre' }, { articleId: 'seuil' }] },
    ];
    expect(idsAssocies(choisis)).toEqual(['volet', 'allege', 'seuil']);
  });
  it('rien à proposer sans associés', () => {
    expect(idsAssocies([{ id: 'a' }, { id: 'b', associes: [] }])).toEqual([]);
  });
});
