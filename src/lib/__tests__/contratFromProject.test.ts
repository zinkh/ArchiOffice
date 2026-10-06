import { describe, expect, test } from 'vitest';
import { contratFieldsFromProject, positiveNumber, projectWorksAddress } from '../contratFromProject';

const project: any = {
  id: 'p1', name: 'Villa Martin', client_id: 'c1', address: '3 rue des Lilas, 54000 Nancy',
  surface_plancher: '120,5 m²', start_date: '2026-03-01T00:00:00Z', end_date: '2027-01-15',
  construction_cost: 400000, remuneration: 40000, is_public_client: false,
  cotraitants_list: [{ id: 'x', project_id: 'p1', specialty: 'Structure', contact_id: 'k1' }],
};
const contacts: any[] = [{ id: 'k1', first_name: 'Luc', last_name: 'Bern', company_name: 'BET Bern' }];

describe('contratFieldsFromProject', () => {
  test('reprend toutes les informations de l\'affaire', () => {
    const out = contratFieldsFromProject(project, {}, contacts);
    expect(out).toMatchObject({
      project_id: 'p1', project_name: 'Villa Martin', client_id: 'c1', intitule_projet: 'Villa Martin',
      adresse_travaux: '3 rue des Lilas, 54000 Nancy', surface_plancher: 120.5,
      date_debut: '2026-03-01', date_fin: '2027-01-15',
      budget_previsionnel: 400000, montant_honoraires: 40000, mode_honoraires: 'forfait',
    });
    expect(out.cotraitants).toMatchObject([{ contact_id: 'k1', contact_name: 'BET Bern', specialty: 'Structure' }]);
  });

  test('ne remplace jamais les montants ni l\'équipe déjà saisis', () => {
    const out = contratFieldsFromProject(project, {
      budget_previsionnel: 1, montant_honoraires: 2, cotraitants: [{ id: 'a' }],
    }, contacts);
    expect(out.budget_previsionnel).toBeUndefined();
    expect(out.montant_honoraires).toBeUndefined();
    expect(out.mode_honoraires).toBeUndefined();
    expect(out.cotraitants).toBeUndefined();
  });

  test('ne vide rien de ce que l\'affaire ne porte pas', () => {
    const out = contratFieldsFromProject({ id: 'p2', name: 'Vide' } as any, { adresse_travaux: 'X' });
    expect(out).toEqual({ project_id: 'p2', project_name: 'Vide', intitule_projet: 'Vide' });
  });

  test('une affaire publique passe le contrat en maître d\'ouvrage public', () => {
    expect(contratFieldsFromProject({ ...project, is_public_client: true }, {}).type_moa).toBe('public');
  });
});

describe('helpers', () => {
  test('adresse : celle de l\'affaire, sinon celle du terrain', () => {
    expect(projectWorksAddress({ adresse_terrain: '5 av. Foch', cp_ville_terrain: '54000 Nancy' })).toBe('5 av. Foch, 54000 Nancy');
    expect(projectWorksAddress({})).toBeUndefined();
  });
  test('nombre positif', () => {
    expect(positiveNumber('0')).toBeUndefined();
    expect(positiveNumber('')).toBeUndefined();
    expect(positiveNumber(80)).toBe(80);
  });
});
