import { describe, expect, it } from 'vitest';
import { contactEmail, missingBuyerMentions } from '../invoiceLegalMentions';

describe('missingBuyerMentions', () => {
  it('signale tout sans contact', () => {
    expect(missingBuyerMentions(null)).toEqual(['name', 'address', 'siret']);
  });
  it('accepte une fiche complète, SIRET avec espaces et adresse de travail', () => {
    expect(missingBuyerMentions({
      company_name: 'Mairie de Nancy', address_work_street: '1 place Stanislas',
      address_work_city: 'Nancy', siret: '212 505 439 00014',
    })).toEqual([]);
  });
  it('signale une adresse sans ville et un SIRET invalide', () => {
    expect(missingBuyerMentions({ company_name: 'X', address: '1 rue A', siret: '123' })).toEqual(['address', 'siret']);
  });
});

describe('contactEmail', () => {
  it('retombe sur l’e-mail professionnel', () => {
    expect(contactEmail({ email: ' ', email_work: 'compta@x.fr' })).toBe('compta@x.fr');
    expect(contactEmail(null)).toBe('');
  });
});
