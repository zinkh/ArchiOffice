import { describe, it, expect } from 'vitest';
import { frenchVatNumber, streetWithoutCity } from './siren';

describe('frenchVatNumber', () => {
  it('derives the intra-community VAT number from a SIREN', () => {
    // Clé = (12 + 3 x (SIREN mod 97)) mod 97.
    expect(frenchVatNumber('102663416')).toBe('FR31102663416');
    expect(frenchVatNumber('552 032 534')).toBe('FR27552032534');
  });

  it('returns an empty string when the SIREN is unusable', () => {
    expect(frenchVatNumber('')).toBe('');
    expect(frenchVatNumber(undefined)).toBe('');
    expect(frenchVatNumber('1234')).toBe('');
  });
});

describe('streetWithoutCity', () => {
  it('strips the postcode and city a SIRENE or BAN address carries', () => {
    expect(streetWithoutCity("7 Chem. d'Alba 54210 Saint-Nicolas-de-Port", '54210', 'Saint-Nicolas-de-Port'))
      .toBe("7 Chem. d'Alba");
    expect(streetWithoutCity('23 Bd de l’Europe, 54500 Vandoeuvre-les-Nancy', '54500', 'Vandoeuvre-les-Nancy'))
      .toBe('23 Bd de l’Europe');
  });

  it('leaves an address alone when it carries no postal suffix', () => {
    expect(streetWithoutCity('23 Bd de l’Europe', '54500', 'Vandoeuvre-les-Nancy')).toBe('23 Bd de l’Europe');
    expect(streetWithoutCity('', '54500', 'Nancy')).toBe('');
  });
});
