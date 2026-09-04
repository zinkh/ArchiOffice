import { describe, it, expect } from 'vitest';
import { frenchVatNumber, parseDirectors, streetWithoutCity } from './siren';

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

describe('parseDirectors', () => {
  it('reads the shape the Recherche d’entreprises API returns for a person', () => {
    expect(parseDirectors([
      { nom: 'SEKTAOUI', prenoms: 'KHALDOUN', qualite: 'Gérant', type_dirigeant: 'personne physique' },
    ])).toEqual([
      { id: 'd0', firstName: 'Khaldoun', lastName: 'SEKTAOUI', label: 'Khaldoun SEKTAOUI', role: 'Gérant', isCompany: false },
    ]);
  });

  it('keeps only the first given name and title-cases compound ones', () => {
    const [d] = parseDirectors([{ nom: 'DUPONT', prenoms: 'JEAN-PIERRE MARIE', fonction: 'Président' }]);
    expect(d.firstName).toBe('Jean-Pierre');
    expect(d.role).toBe('Président');
  });

  it('falls back to a single nom_complet field', () => {
    const [d] = parseDirectors([{ nom_complet: 'MARIE CURIE', qualite: 'Directrice générale' }]);
    expect(d).toMatchObject({ firstName: 'Marie', lastName: 'CURIE', isCompany: false });
  });

  it('flags a legal person, which carries no identity to copy', () => {
    const [d] = parseDirectors([{ denomination: 'HOLDING XYZ', qualite: 'Président', type_dirigeant: 'personne morale' }]);
    expect(d).toMatchObject({ label: 'HOLDING XYZ', isCompany: true, firstName: '', lastName: '' });
  });

  it('ignores anything unusable', () => {
    expect(parseDirectors(undefined)).toEqual([]);
    expect(parseDirectors([null, {}, { qualite: 'Gérant' }])).toEqual([]);
  });
});
