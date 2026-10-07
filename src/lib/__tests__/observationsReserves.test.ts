import { describe, it, expect } from 'vitest';
import { compterReprenables, isReprenable } from '../observationsReserves';
import type { Observation } from '../../types';

const obs = (patch: Partial<Observation>): Observation => ({ id: 'o', ...patch } as Observation);

describe('isReprenable', () => {
  it('accepte une observation ouverte jamais reprise', () => {
    expect(isReprenable(obs({ statut: 'À faire' }))).toBe(true);
  });

  it('refuse une observation levée, refusée ou déjà reprise', () => {
    expect(isReprenable(obs({ statut: 'Levée' }))).toBe(false);
    expect(isReprenable(obs({ statut: 'Refusée' }))).toBe(false);
    expect(isReprenable(obs({ statut: 'En cours', reserve_id: 'r1' }))).toBe(false);
  });
});

describe('compterReprenables', () => {
  it('ne compte que les observations « à lever » ouvertes et synchronisées', () => {
    const liste = [
      obs({ id: '1', type: 'reserve', statut: 'À faire' }),
      obs({ id: '2', type: 'reserve', statut: 'Urgent' }),
      obs({ id: '3', type: 'reserve', statut: 'Levée' }),
      obs({ id: '4', type: 'reserve', statut: 'À faire', reserve_id: 'r9' }),
      obs({ id: '5', type: 'reserve', statut: 'À faire', pendingSync: true }),
      obs({ id: '6', type: 'observation', statut: 'À faire' }),
      obs({ id: '7', statut: 'À faire' }),
    ];
    expect(compterReprenables(liste)).toBe(2);
  });

  it('rend 0 pour une liste vide', () => {
    expect(compterReprenables([])).toBe(0);
  });
});
