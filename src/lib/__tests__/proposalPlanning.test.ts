import { describe, it, expect } from 'vitest';
import { parsePlanning, serializePlanning, withOverride } from '../proposalPlanning';

describe('proposalPlanning', () => {
  it('rend le planning par défaut pour une valeur absente ou illisible', () => {
    expect(parsePlanning(null)).toEqual({ showDependencies: true, items: {} });
    expect(parsePlanning('{pas du json')).toEqual({ showDependencies: true, items: {} });
  });
  it('ne garde que des durées et débuts valides', () => {
    const p = parsePlanning(JSON.stringify({ showDependencies: false, items: { a: { duree: 20.4, debut: -3 }, b: { duree: 'x' } } }));
    expect(p).toEqual({ showDependencies: false, items: { a: { duree: 20 } } });
  });
  it('n’enregistre rien quand rien n’est réglé', () => {
    expect(serializePlanning({ showDependencies: true, items: {} })).toBeNull();
    expect(serializePlanning({ showDependencies: false, items: {} })).not.toBeNull();
  });
  it('retire une clé remise à undefined', () => {
    const p = withOverride({ showDependencies: true, items: {} }, 'aps', { duree: 20 });
    expect(withOverride(p, 'aps', { duree: undefined }).items).toEqual({});
  });
});
