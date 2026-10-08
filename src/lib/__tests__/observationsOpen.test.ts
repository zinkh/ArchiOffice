import { describe, it, expect } from 'vitest';
import { countOpenObservations, isOpenObservation } from '../observationsOpen';

describe('observations non levées', () => {
  it('compte tout ce qui n\'est pas levé, refusées et urgentes comprises', () => {
    const list = [{ statut: 'À faire' }, { statut: 'En cours' }, { statut: 'Urgent' }, { statut: 'Refusée' }, { statut: 'Levée' }] as any[];
    expect(countOpenObservations(list)).toBe(4);
  });
  it('une levée est close', () => {
    expect(isOpenObservation({ statut: 'Levée' } as any)).toBe(false);
  });
  it('liste vide', () => {
    expect(countOpenObservations([])).toBe(0);
  });
});
