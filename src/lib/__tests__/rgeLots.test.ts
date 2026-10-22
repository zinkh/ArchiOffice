import { describe, it, expect } from 'vitest';
import { rgeExigeParDefaut } from '../rgeLots';

describe('rgeExigeParDefaut', () => {
  it('coche l\'isolation et le chauffage, accents et casse indifférents', () => {
    expect(rgeExigeParDefaut('Chauffage et ventilation')).toBe(true);
    expect(rgeExigeParDefaut('Façades et isolation thermique par l\'extérieur')).toBe(true);
    expect(rgeExigeParDefaut('ISOLATION DES COMBLES')).toBe(true);
  });
  it('ne coche ni les autres lots ni l\'isolation phonique', () => {
    expect(rgeExigeParDefaut('Peintures')).toBe(false);
    expect(rgeExigeParDefaut('Isolation phonique')).toBe(false);
    expect(rgeExigeParDefaut(null)).toBe(false);
  });
});
