// Valeurs connues du cabinet : server/knowledge/tenantIdentifiers.ts.
import { describe, expect, it } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';
import { loadTenantKnownValues, valuesFromRow } from '../server/knowledge/tenantIdentifiers';

describe('valuesFromRow', () => {
  it('classe les valeurs d’un contact et ajoute le nom de famille seul', () => {
    const values = valuesFromRow('contacts', { name: 'Sophie Lambert', company: 'Lambert Façades', email_work: 'sophie@lambert.fr', category: 'Entreprise' });
    expect(values).toEqual(expect.arrayContaining([
      { value: 'Sophie Lambert', category: 'PERSONNE' }, { value: 'Lambert', category: 'PERSONNE' },
      { value: 'Lambert Façades', category: 'ENTREPRISE' }, { value: 'sophie@lambert.fr', category: 'COORDONNEES' },
    ]));
    expect(values.map(v => v.value)).not.toContain('Entreprise');
  });

  it('range une affaire sous AFFAIRE, ses adresses et ses références', () => {
    const values = valuesFromRow('projects', { name: 'Villa Martin', project_code: '26014 ABC', adresse_terrain: '12 rue des Lilas', client: 'M. Martin', status: 'Planning', type_projet: 'Neuf' });
    expect(values).toEqual(expect.arrayContaining([
      { value: 'Villa Martin', category: 'AFFAIRE' }, { value: '26014 ABC', category: 'REFERENCE' },
      { value: '12 rue des Lilas', category: 'ADRESSE' }, { value: 'M. Martin', category: 'CLIENT' },
    ]));
    expect(values.map(v => v.value)).not.toContain('Planning');
  });

  it('ignore les colonnes qui n’identifient personne et les valeurs trop courtes ou numériques', () => {
    const values = valuesFromRow('contacts', { file_name: 'cctp.pdf', name: 'Al', phone_mobile: '0612345678', logo: 'logo.png' });
    // Un numéro de téléphone est tout chiffres : les règles de téléphone s'en chargent.
    expect(values).toEqual([]);
  });
});

describe('loadTenantKnownValues', () => {
  it('lit la base du cabinet, et d’aucun autre', async () => {
    const db = new FakeSupabaseAdmin();
    db.seed('tenants', [{ id: 't1', name: 'Atelier Zoméno Sektaoui' }, { id: 't2', name: 'Autre Cabinet Voisin' }]);
    db.seed('contacts', [
      { id: 'c1', tenant_id: 't1', name: 'Sophie Lambert', company: 'Lambert Façades' },
      { id: 'c2', tenant_id: 't2', name: 'Paul Voisin-Secret', company: 'Entreprise Voisine' },
    ]);
    db.seed('projects', [{ id: 'p1', tenant_id: 't1', name: 'Villa Martin', adresse_terrain: '12 rue des Lilas' }]);
    db.seed('settings', [{ id: 's1', tenant_id: 't1', agency_name: 'AAZS Architecture', architect_name: 'Khaldoun Sektaoui' }]);
    db.seed('profiles', [{ id: 'u1', tenant_id: 't1', name: 'Marie Collaboratrice' }]);
    db.seed('tenant_memberships', [{ id: 'm1', user_id: 'u1', tenant_id: 't1', system_role: 'user', is_default: true }]);

    const values = (await loadTenantKnownValues(db as any, 't1')).map(v => v.value);

    expect(values).toEqual(expect.arrayContaining([
      'Atelier Zoméno Sektaoui', 'Sophie Lambert', 'Lambert Façades', 'Villa Martin', '12 rue des Lilas',
      'AAZS Architecture', 'Khaldoun Sektaoui', 'Marie Collaboratrice',
    ]));
    expect(values).not.toContain('Paul Voisin-Secret');
    expect(values).not.toContain('Autre Cabinet Voisin');
  });

  it('échoue plutôt que de travailler avec une liste incomplète', async () => {
    const db = new FakeSupabaseAdmin();
    db.seed('tenants', [{ id: 't1', name: 'Cabinet' }]);
    db.breakTable('contacts');
    await expect(loadTenantKnownValues(db as any, 't1')).rejects.toBeTruthy();
  });
});
