import { describe, expect, it } from 'vitest';
import {
  INTERVALLE_MINI_SERVEUR_MS, LABEL_INSTANTANE_AUTO, MAX_INSTANTANES_AUTO, estInstantaneAuto, instantaneTropRecent, instantanesAElaguer,
} from '../instantanes';

const MIN = 60 * 1000;
const maintenant = Date.parse('2026-11-08T18:00:00.000Z');

describe('instantaneTropRecent', () => {
  it('refuse un instantané quand le précédent a moins de 9 minutes', () => {
    expect(instantaneTropRecent(new Date(maintenant - 2 * MIN).toISOString(), maintenant)).toBe(true);
    expect(instantaneTropRecent(new Date(maintenant - (INTERVALLE_MINI_SERVEUR_MS - 1)).toISOString(), maintenant)).toBe(true);
  });

  it('accepte un instantané à partir de 9 minutes', () => {
    expect(instantaneTropRecent(new Date(maintenant - INTERVALLE_MINI_SERVEUR_MS).toISOString(), maintenant)).toBe(false);
    expect(instantaneTropRecent(new Date(maintenant - 30 * MIN).toISOString(), maintenant)).toBe(false);
  });

  it('ne bloque jamais sur une date absente ou illisible', () => {
    expect(instantaneTropRecent(null, maintenant)).toBe(false);
    expect(instantaneTropRecent(undefined, maintenant)).toBe(false);
    expect(instantaneTropRecent('pas une date', maintenant)).toBe(false);
  });
});

describe('instantanesAElaguer', () => {
  const liste = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${i}` }));

  it('ne supprime rien sous la limite', () => {
    expect(instantanesAElaguer(liste(MAX_INSTANTANES_AUTO))).toEqual([]);
    expect(instantanesAElaguer(liste(3))).toEqual([]);
  });

  it('supprime les plus anciens au-delà de la limite, en gardant les plus récents', () => {
    const aSupprimer = instantanesAElaguer(liste(MAX_INSTANTANES_AUTO + 3));
    expect(aSupprimer).toEqual([`v${MAX_INSTANTANES_AUTO}`, `v${MAX_INSTANTANES_AUTO + 1}`, `v${MAX_INSTANTANES_AUTO + 2}`]);
  });

  it('accepte une limite donnée', () => {
    expect(instantanesAElaguer(liste(5), 2)).toEqual(['v2', 'v3', 'v4']);
  });
});

describe('estInstantaneAuto', () => {
  it('ne reconnaît que le libellé réservé', () => {
    expect(estInstantaneAuto(LABEL_INSTANTANE_AUTO)).toBe(true);
    expect(estInstantaneAuto('Phase APS')).toBe(false);
    expect(estInstantaneAuto(undefined)).toBe(false);
  });
});
