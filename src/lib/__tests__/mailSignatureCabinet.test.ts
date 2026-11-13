import { describe, expect, it } from 'vitest';
import { signatureEffective, signatureParDefaut } from '../mailSignatureCabinet';

describe('signatureParDefaut', () => {
  it('compose nom, agence, adresse et contact', () => {
    const s = signatureParDefaut({
      nom: 'Prénom Nom', agencyName: 'Agence Test', address: '1 rue du Test 75000 PARIS', phone: '0100000000', email: 'a@test.fr',
    });
    expect(s).toBe('Prénom Nom\nAgence Test\n1 rue du Test 75000 PARIS\nTél : 0100000000 - Mail : a@test.fr');
  });

  it('omet les champs absents', () => {
    expect(signatureParDefaut({ agencyName: 'Agence Test', email: 'a@test.fr' })).toBe('Agence Test\nMail : a@test.fr');
  });

  it('reste vide sans nom ni agence', () => {
    expect(signatureParDefaut({ address: '1 rue du Test', phone: '0100000000' })).toBe('');
    expect(signatureParDefaut(null)).toBe('');
  });

  it('ne contient jamais de tiret quadratin', () => {
    expect(signatureParDefaut({ nom: 'A', agencyName: 'B', phone: '1', email: 'c' })).not.toContain('—');
  });
});

describe('signatureEffective', () => {
  const identite = { agencyName: 'Agence Test' };
  it('préfère la signature personnelle', () => {
    expect(signatureEffective('Moi', identite)).toBe('Moi');
  });
  it('retombe sur celle du cabinet si la personnelle est vide ou blanche', () => {
    expect(signatureEffective('', identite)).toBe('Agence Test');
    expect(signatureEffective('  \n ', identite)).toBe('Agence Test');
    expect(signatureEffective(undefined, identite)).toBe('Agence Test');
  });
});
