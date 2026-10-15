import { describe, expect, it } from 'vitest';
import {
  ajouterIntemperie, groupesIntemperies, retirerIntemperie,
  basculerBatiment, batimentsDuLot, heureEffective, joursIntemperies, libellePenalite, montantPenalite,
  resumeBatiments, resumePenalites, retardCumule, totalPenalites,
} from '../siteReportLotSuivi';

const WET = { id: 'b1', code: 'W', libelle: 'WETLAB', ordre: 0 };
const DRY = { id: 'b2', code: 'D', libelle: 'DRYLAB', ordre: 1 };
const BATIMENTS = [WET, DRY];

describe('retardCumule', () => {
  const cr = (n: number, semaine?: number, ancienCumul?: number) => ({
    report_number: n,
    lot_tracking: [{ lot_id: 'lot-1', retard_semaine: semaine, retard_cumule: ancienCumul }],
  });

  it('additionne les retards de la semaine du compte-rendu et de tous les précédents', () => {
    const reports = [cr(1, 2), cr(2, 3), cr(3, 1)];
    expect(retardCumule('lot-1', reports, { report_number: 3 })).toBe(6);
  });

  it('ignore les comptes-rendus postérieurs à celui qu’on regarde', () => {
    const reports = [cr(1, 2), cr(2, 3), cr(3, 10)];
    expect(retardCumule('lot-1', reports, { report_number: 2 })).toBe(5);
  });

  it('ne mélange pas les lots', () => {
    const reports = [{ report_number: 1, lot_tracking: [{ lot_id: 'lot-2', retard_semaine: 9 }] }];
    expect(retardCumule('lot-1', reports, { report_number: 1 })).toBe(0);
  });

  it('garde le dernier ancien cumul saisi quand aucun retard de semaine n’existe', () => {
    const reports = [cr(1, undefined, 4), cr(2, undefined, 7)];
    expect(retardCumule('lot-1', reports, { report_number: 2 })).toBe(7);
  });

  it('préfère les retards de la semaine à l’ancien cumul dès qu’il y en a un', () => {
    const reports = [cr(1, undefined, 4), cr(2, 3, 99)];
    expect(retardCumule('lot-1', reports, { report_number: 2 })).toBe(3);
  });
});

describe('bâtiments concernés (W/D)', () => {
  it('relit un ancien choix W/D comme les bâtiments WETLAB et DRYLAB', () => {
    expect(batimentsDuLot({ concerned: 'WD' }, BATIMENTS)).toEqual(['b1', 'b2']);
    expect(batimentsDuLot({ concerned: 'W' }, BATIMENTS)).toEqual(['b1']);
  });

  it('donne la priorité aux bâtiments cochés et ignore ceux qui ne sont plus au registre', () => {
    expect(batimentsDuLot({ batiment_ids: ['b2', 'supprime'], concerned: 'W' }, BATIMENTS)).toEqual(['b2']);
  });

  it('coche et décoche dans l’ordre du registre', () => {
    const coche = basculerBatiment({ batiment_ids: ['b2'] }, 'b1', true, BATIMENTS);
    expect(coche).toEqual(['b1', 'b2']);
    expect(basculerBatiment({ batiment_ids: coche }, 'b2', false, BATIMENTS)).toEqual(['b1']);
  });

  it('décocher une lettre de l’ancien choix garde l’autre bâtiment', () => {
    expect(basculerBatiment({ concerned: 'WD' }, 'b1', false, BATIMENTS)).toEqual(['b2']);
  });

  it('imprime les repères cochés', () => {
    expect(resumeBatiments({ batiment_ids: ['b1', 'b2'] }, BATIMENTS)).toBe('W / D');
    expect(resumeBatiments(undefined, BATIMENTS)).toBe('');
  });
});

describe('heure de convocation', () => {
  it('prend celle du lot, à défaut l’heure par défaut du compte-rendu', () => {
    expect(heureEffective({ heure: '10:30' }, '09:00')).toBe('10:30');
    expect(heureEffective({}, '09:00')).toBe('09:00');
    expect(heureEffective(undefined, null)).toBe('');
  });
});

describe('pénalités', () => {
  const p = { id: 'p1', type: 'retard_documents' as const, jours: 3, montant_jour: 150 };

  it('calcule jours × montant par jour', () => {
    expect(montantPenalite(p)).toBe(450);
    expect(montantPenalite({ jours: 2.5, montant_jour: 40.2 })).toBe(100.5);
  });

  it('refuse les valeurs négatives ou illisibles', () => {
    expect(montantPenalite({ jours: -1, montant_jour: 10 })).toBe(0);
    expect(montantPenalite({ jours: Number.NaN, montant_jour: 10 })).toBe(0);
  });

  it('totalise et résume', () => {
    const t = { penalites: [p, { id: 'p2', type: 'absence_reunion' as const, jours: 1, montant_jour: 100 }] };
    expect(totalPenalites(t)).toEqual({ nombre: 2, jours: 4, montant: 550 });
    expect(resumePenalites(t)).toBe('2 pénalités · 550,00 €');
    expect(resumePenalites({})).toBe('');
  });

  it('nomme le motif d’une pénalité « autre »', () => {
    expect(libellePenalite({ type: 'autre', motif: 'Dépôt sauvage' })).toBe('Dépôt sauvage');
    expect(libellePenalite({ type: 'retard_execution' })).toBe("Retard d'exécution des travaux");
  });
});

describe('intempéries saisies pour plusieurs entreprises', () => {
  const ids = () => { let n = 0; return () => `id${++n}`; };

  it('recopie l’épisode dans le suivi de chaque entreprise concernée, avec un groupe commun', () => {
    const suivi = ajouterIntemperie([{ lot_id: 'l1' }], ['l1', 'l2'], { type: 'pluie', date: '2026-10-14', jours: 1 }, ids());
    expect(suivi.map(t => t.lot_id)).toEqual(['l1', 'l2']);
    const [a, b] = suivi.map(t => t.intemperies_list![0]);
    expect(a.groupe).toBe(b.groupe);
    expect(a.id).not.toBe(b.id);
    expect(groupesIntemperies(suivi)).toEqual([{ key: a.groupe, type: 'pluie', date: '2026-10-14', jours: 1, lotIds: ['l1', 'l2'] }]);
  });

  it('ne touche pas aux entreprises non concernées', () => {
    const suivi = ajouterIntemperie([{ lot_id: 'l1' }, { lot_id: 'l3', effectif: 4 }], ['l1'], { type: 'gel', jours: 0.5 }, ids());
    expect(suivi.find(t => t.lot_id === 'l3')).toEqual({ lot_id: 'l3', effectif: 4 });
  });

  it('retire l’épisode de toutes les entreprises d’un coup', () => {
    const suivi = ajouterIntemperie([], ['l1', 'l2'], { type: 'vent', jours: 1 }, ids());
    const key = groupesIntemperies(suivi)[0].key;
    const apres = retirerIntemperie(suivi, key);
    expect(apres.every(t => t.intemperies_list === undefined)).toBe(true);
    expect(groupesIntemperies(apres)).toEqual([]);
  });

  it('traite une entrée sans groupe (saisie précédente) comme un épisode à part', () => {
    const suivi = [{ lot_id: 'l1', intemperies_list: [{ id: 'x', type: 'pluie' as const, jours: 1 }] }];
    expect(groupesIntemperies(suivi)[0]).toMatchObject({ key: 'x', lotIds: ['l1'] });
    expect(retirerIntemperie(suivi, 'x')[0].intemperies_list).toBeUndefined();
  });
});

describe('intempéries', () => {
  it('additionne les épisodes et l’ancienne saisie en jours', () => {
    expect(joursIntemperies({ intemperies_list: [{ id: 'i1', type: 'pluie', jours: 1 }, { id: 'i2', type: 'gel', jours: 0.5 }], intemperies_jours: 2 })).toBe(3.5);
    expect(joursIntemperies(undefined)).toBe(0);
  });
});
