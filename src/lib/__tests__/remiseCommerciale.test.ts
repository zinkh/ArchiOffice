import { describe, it, expect } from 'vitest';
import {
  brutDeOffre, libelleRemise, montantRemise, montantsAvecRemise, netApresRemise,
  pourcentageEquivalent, remiseActive, remiseSaisie,
} from '../remiseCommerciale';

describe('remise commerciale', () => {
  it('déduit un pourcentage ou un montant du prix brut', () => {
    expect(montantRemise(52000, { mode: 'pourcentage', valeur: 3 })).toBe(1560);
    expect(netApresRemise(52000, { mode: 'pourcentage', valeur: 3 })).toBe(50440);
    expect(netApresRemise(52000, { mode: 'montant', valeur: 1500 })).toBe(50500);
  });

  it('arrondit au centime', () => {
    expect(montantRemise(1000.5, { mode: 'pourcentage', valeur: 3.333 })).toBe(33.35);
  });

  it('ne rend jamais l\'offre négative', () => {
    expect(netApresRemise(1000, { mode: 'pourcentage', valeur: 150 })).toBe(0);
    expect(netApresRemise(1000, { mode: 'montant', valeur: 5000 })).toBe(0);
  });

  it('ignore une remise absente, nulle ou négative', () => {
    expect(netApresRemise(1000, undefined)).toBe(1000);
    expect(netApresRemise(1000, { mode: 'montant', valeur: 0 })).toBe(1000);
    expect(netApresRemise(1000, { mode: 'montant', valeur: -50 })).toBe(1000);
    expect(netApresRemise(0, { mode: 'pourcentage', valeur: 5 })).toBe(0);
    expect(remiseActive({ mode: 'montant', valeur: 0 })).toBe(false);
  });

  it('compare un montant à un pourcentage', () => {
    expect(pourcentageEquivalent(50000, { mode: 'montant', valeur: 1500 })).toBeCloseTo(0.03, 5);
    expect(pourcentageEquivalent(50000, undefined)).toBeNull();
  });

  it('une valeur vide retire la remise saisie', () => {
    expect(remiseSaisie('montant', undefined)).toBeUndefined();
    expect(remiseSaisie('montant', 0)).toBeUndefined();
    expect(remiseSaisie('pourcentage', 2)).toEqual({ mode: 'pourcentage', valeur: 2 });
  });

  it('écrit la remise en clair', () => {
    expect(libelleRemise({ mode: 'pourcentage', valeur: 3 })).toBe('3 %');
    expect(libelleRemise({ mode: 'montant', valeur: 1500 })).toMatch(/^1\s?500 €$/);
    expect(libelleRemise(undefined)).toBe('');
  });

  it('range le prix final dans montant_base et le brut seulement quand une remise s\'applique', () => {
    expect(montantsAvecRemise(52000, { mode: 'pourcentage', valeur: 3 }))
      .toEqual({ montant_base: 50440, montant_brut: 52000, remise: { mode: 'pourcentage', valeur: 3 } });
    expect(montantsAvecRemise(52000, undefined)).toEqual({ montant_base: 52000, montant_brut: undefined, remise: undefined });
    // Une remise à 0 reste saisie (le champ ne doit pas se vider) mais ne change rien au prix.
    expect(montantsAvecRemise(52000, { mode: 'montant', valeur: 0 })).toEqual({ montant_base: 52000, montant_brut: undefined, remise: { mode: 'montant', valeur: 0 } });
    // Sans prix, la remise est conservée pour le jour où le montant sera saisi.
    expect(montantsAvecRemise(0, { mode: 'pourcentage', valeur: 3 })).toEqual({ montant_base: 0, montant_brut: undefined, remise: { mode: 'pourcentage', valeur: 3 } });
  });

  it('retrouve le brut d\'une offre, remisée ou non', () => {
    expect(brutDeOffre({ montant_base: 50440, montant_brut: 52000 })).toBe(52000);
    expect(brutDeOffre({ montant_base: 10000 })).toBe(10000);
  });

  it('changer la remise repart toujours du brut, sans l\'empiler', () => {
    const a = montantsAvecRemise(52000, { mode: 'pourcentage', valeur: 3 });
    const b = montantsAvecRemise(brutDeOffre(a), { mode: 'montant', valeur: 2000 });
    expect(b.montant_base).toBe(50000);
    const c = montantsAvecRemise(brutDeOffre(b), undefined);
    expect(c.montant_base).toBe(52000);
  });
});
