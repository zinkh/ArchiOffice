import { describe, expect, test } from 'vitest';
import { projectIntervenants } from '../projectIntervenants';

const contacts: any[] = [
  { id: 'k1', company_name: 'BET Bern', phone_mobile: '0611223344', phone_work: '0383000000', email: 'luc@bern.fr' },
  { id: 'k2', first_name: 'Anne', last_name: 'Roux', phone_work: '0383111111' },
];

describe('projectIntervenants', () => {
  test('regroupe intervenants, cotraitants et entreprises avec leurs coordonnées', () => {
    const out = projectIntervenants({
      stakeholders_list: [{ id: 's1', project_id: 'p', name: '', role: 'BET structure', contact_id: 'k1' }],
      cotraitants_list: [{ id: 'c1', project_id: 'p', specialty: 'Fluides', contact_id: 'k2' }],
      lots_list: [{ id: 'l2', project_id: 'p', lot_number: '02', lot_title: 'Gros œuvre', contact_id: 'k1' }],
    } as any, contacts);
    expect(out.total).toBe(3);
    expect(out.stakeholders[0]).toMatchObject({ label: 'BET structure', name: 'BET Bern', phone: '0611223344', email: 'luc@bern.fr' });
    expect(out.cotraitants[0]).toMatchObject({ label: 'Fluides', name: 'Anne Roux', phone: '0383111111' });
    expect(out.entreprises[0]).toMatchObject({ label: 'Lot 02 · Gros œuvre', name: 'BET Bern' });
  });

  test('le nom saisi prime sur la fiche contact', () => {
    const out = projectIntervenants({ stakeholders_list: [{ id: 's', project_id: 'p', name: 'M. Martin', role: 'MOA', contact_id: 'k1' }] } as any, contacts);
    expect(out.stakeholders[0].name).toBe('M. Martin');
  });

  test('un lot sans entreprise n\'est pas listé, un contact inconnu ne casse rien', () => {
    const out = projectIntervenants({
      lots_list: [{ id: 'l1', project_id: 'p', lot_number: '01', lot_title: 'VRD' }],
      stakeholders_list: [{ id: 's', project_id: 'p', name: 'X', role: 'CT', contact_id: 'inconnu' }],
    } as any, contacts);
    expect(out.entreprises).toEqual([]);
    expect(out.stakeholders[0]).toMatchObject({ name: 'X', phone: undefined });
  });

  test('les entreprises sont triées par numéro de lot', () => {
    const out = projectIntervenants({ lots_list: [
      { id: 'a', project_id: 'p', lot_number: '10', lot_title: 'Peinture', contact_name: 'P' },
      { id: 'b', project_id: 'p', lot_number: '2', lot_title: 'Gros œuvre', contact_name: 'G' },
    ] } as any, []);
    expect(out.entreprises.map(e => e.name)).toEqual(['G', 'P']);
  });

  test('un projet sans liste donne un résultat vide', () => {
    expect(projectIntervenants({} as any).total).toBe(0);
  });
});
