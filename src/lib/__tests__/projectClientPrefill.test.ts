import { describe, expect, test } from 'vitest';
import { missionFlagsFromMaf } from '../mafUtils';
import { clientFieldsFromContact, mirroredAddress, progressFromMilestones, tvaFromSiren } from '../projectClientPrefill';

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

describe('tvaFromSiren', () => {
  test('computes the French VAT key from a SIREN or a SIRET', () => {
    expect(tvaFromSiren('732 829 320')).toBe('FR44732829320');
    expect(tvaFromSiren('73282932000074')).toBe('FR44732829320');
  });
  test('refuses anything that is not 9 or 14 digits', () => {
    expect(tvaFromSiren('123')).toBeUndefined();
    expect(tvaFromSiren(undefined)).toBeUndefined();
  });
});

describe('progressFromMilestones', () => {
  test('share of completed milestones, rounded', () => {
    expect(progressFromMilestones([{ completed: true }, { completed: false }, { completed: false }])).toBe(33);
  });
  test('undefined without milestones', () => {
    expect(progressFromMilestones([])).toBeUndefined();
  });
});

describe('missionFlagsFromMaf', () => {
  test('jaune follows the mission rate', () => {
    expect(missionFlagsFromMaf('jaune', 100)).toEqual({ is_complete_mission: true, is_chantier: true });
    expect(missionFlagsFromMaf('jaune', 60)).toEqual({ is_complete_mission: false, is_chantier: false });
  });
  test('types without works execution have no site mission', () => {
    expect(missionFlagsFromMaf('violet', undefined)).toEqual({ is_complete_mission: false, is_chantier: false });
  });
  test('undecided types leave the flags alone', () => {
    expect(missionFlagsFromMaf(undefined, 100)).toEqual({});
    expect(missionFlagsFromMaf('jaune', undefined)).toEqual({});
    expect(missionFlagsFromMaf('puc', 100)).toEqual({});
  });
});
