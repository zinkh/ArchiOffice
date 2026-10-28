import { describe, expect, it } from 'vitest';
import { contactPatchFromProposal, fillMissingClientFields } from '../proposalClient';

describe('coordonnées client d\'une proposition', () => {
  const contact = { id: 'c', address_work_street: '2 rue du Haut', zip: '54140', phone: '', email: 'a@b.fr' };

  it('remplit seulement les champs vides de la proposition depuis le contact', () => {
    const out = fillMissingClientFields({ adresse_client: '', cp_client: '99999', email_client: '' }, contact);
    expect(out).toMatchObject({ adresse_client: '2 rue du Haut', cp_client: '99999', email_client: 'a@b.fr' });
    expect(out.telephone).toBeUndefined();
  });

  it('complète les champs vides du contact, sans écraser les valeurs présentes', () => {
    const patch = contactPatchFromProposal({ adresse_client: 'autre', ville_client: 'JARVILLE', telephone: '0383000000', cp_client: '1' }, contact);
    expect(patch).toEqual({ city: 'JARVILLE', phone: '0383000000' });
  });

  it('sans contact, rien à faire', () => {
    expect(contactPatchFromProposal({ telephone: '1' }, undefined)).toEqual({});
  });
});
