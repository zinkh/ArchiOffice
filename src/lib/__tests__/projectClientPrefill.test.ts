import { describe, expect, test } from 'vitest';
import { clientFieldsFromContact, mirroredAddress } from '../projectClientPrefill';

const contact: any = {
  first_name: 'Anne', last_name: 'Durand', company_name: 'SCI Les Lilas', job_title: 'Gérante',
  siret: '123 456 789 00012', vat_number: 'FR12345678901', address_work_street: '3 rue des Lilas',
  address_work_zip: '54000', address_work_city: 'Nancy', phone_mobile: '0611223344', phone: '0383000000', email: 'a@sci.fr',
};

describe('clientFieldsFromContact', () => {
  test('fills every empty client field from the contact', () => {
    const out = clientFieldsFromContact(contact, {});
    expect(out).toMatchObject({
      nom_societe: 'SCI Les Lilas', representant: 'Anne Durand', qualite: 'Gérante',
      client_siret: '123 456 789 00012', cp_client: '54000', ville_client: 'Nancy',
      portable: '0611223344', telephone: '0383000000', email_client: 'a@sci.fr', is_entreprise: true,
    });
  });
  test('never overwrites a value already typed', () => {
    const out = clientFieldsFromContact(contact, { email_client: 'moi@x.fr', ville_client: 'Metz' });
    expect(out.email_client).toBeUndefined();
    expect(out.ville_client).toBeUndefined();
  });
  test('an individual gets no company or representative', () => {
    const out = clientFieldsFromContact({ first_name: 'Paul', last_name: 'Roux', email: 'p@x.fr' } as any, {});
    expect(out).toEqual({ email_client: 'p@x.fr' });
  });
});

describe('mirroredAddress', () => {
  test('copies into an empty or identical counterpart', () => {
    expect(mirroredAddress('a', '', 'b')).toBe('b');
    expect(mirroredAddress('a', 'a', 'b')).toBe('b');
  });
  test('keeps a deliberately different counterpart', () => {
    expect(mirroredAddress('a', 'z', 'b')).toBeUndefined();
  });
});
