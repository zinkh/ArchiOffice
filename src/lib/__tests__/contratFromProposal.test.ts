import { describe, expect, it } from 'vitest';
import { categorieDeMission, contratFieldsFromProposal, estPropositionValidee } from '../contratFromProposal';
import type { Proposal } from '../../types';

const missions = [
  { id: 'esq', name: 'Esquisse', category: 'Mission base', amount: 3000, percentages: { archi: 100 } },
  { id: 'pro', name: 'Projet', category: 'Mission base', amount: 7000, percentages: { archi: 60, bet: 40 } },
  { id: 'det', name: 'DET', category: 'Mission Exécution', amount: 5000, percentages: { archi: 100 } },
];

const base = (extra: Partial<Proposal> = {}): Proposal => ({
  id: 'p1',
  title: 'Maison Martin',
  client_id: 'c1',
  amount: 15000,
  status: 'Accepted',
  description: '',
  created_at: '2026-11-01',
  adresse_terrain: '12 rue des Lilas',
  cp_ville_terrain: '54000 Nancy',
  surface_plancher: '120,5 m²',
  construction_cost: 250000,
  fee_distribution: JSON.stringify({ missions }),
  specialties_list: [{ id: 's1', proposal_id: 'p1', specialty_name: 'Structure', contact_id: 'bet', contact_name: 'BET Est' }],
  ...extra,
} as Proposal);

describe('estPropositionValidee', () => {
  it('accepte une proposition acceptée ou convertie', () => {
    expect(estPropositionValidee({ status: 'Accepted' })).toBe(true);
    expect(estPropositionValidee({ status: 'Sent', archive_reason: 'converted' })).toBe(true);
    expect(estPropositionValidee({ status: 'Sent' })).toBe(false);
    expect(estPropositionValidee({ status: 'Rejected' })).toBe(false);
  });
});

describe('categorieDeMission', () => {
  it('traduit les libellés en clair vers le vocabulaire du contrat', () => {
    expect(categorieDeMission('Mission base')).toBe('base');
    expect(categorieDeMission('Mission Exécution')).toBe('exe');
    expect(categorieDeMission('Missions complémentaires')).toBe('complementaire');
    expect(categorieDeMission(undefined)).toBe('base');
  });
});

describe('contratFieldsFromProposal', () => {
  it('reprend identité, lieu, surface, budget et honoraires', () => {
    const f = contratFieldsFromProposal(base());
    expect(f.intitule_projet).toBe('Maison Martin');
    expect(f.client_id).toBe('c1');
    expect(f.adresse_travaux).toBe('12 rue des Lilas, 54000 Nancy');
    expect(f.surface_plancher).toBe(120.5);
    expect(f.budget_previsionnel).toBe(250000);
    expect(f.montant_honoraires).toBe(15000);
    expect(f.mode_honoraires).toBe('forfait');
  });

  it('rapporte la part de chaque mission aux missions de base et les classe', () => {
    const f = contratFieldsFromProposal(base());
    const [esq, pro, det] = f.missions_list!;
    expect(esq.pct).toBeCloseTo(30);
    expect(pro.pct).toBeCloseTo(70);
    expect(det.category).toBe('exe');
    expect(det.pct).toBeCloseTo(50);
    expect(f.missions_list!.every(m => m.incluse)).toBe(true);
  });

  it('calcule la quote-part de chaque cotraitant sur le total des honoraires', () => {
    const f = contratFieldsFromProposal(base());
    expect(f.cotraitants).toHaveLength(1);
    expect(f.cotraitants![0].montant_honoraires).toBe(2800);
    expect(f.cotraitants![0].fee_pct).toBeCloseTo(2800 / 15000 * 100);
    expect(f.cotraitants![0].contact_id).toBe('bet');
  });

  it('reprend la tranche ferme seule quand le choix est enregistré', () => {
    const fee = {
      contrat_tranches: 'ferme',
      tranches: [
        { id: 'f', label: 'Tranche ferme', type: 'ferme' },
        { id: 'c', label: 'Tranche conditionnelle', type: 'conditionnelle' },
      ],
      missions: [
        { id: 'esq', name: 'Esquisse', category: 'Mission base', amount: 3000, percentages: {}, tranche_id: 'f' },
        { id: 'det', name: 'DET', category: 'Mission base', amount: 5000, percentages: {}, tranche_id: 'c' },
      ],
    };
    const f = contratFieldsFromProposal(base({ fee_distribution: JSON.stringify(fee) }));
    expect(f.montant_honoraires).toBe(3000);
    expect(f.missions_list).toHaveLength(1);
    expect(f.missions_list![0].tranche).toBe('Tranche ferme');
  });

  it('reprend l\'équipe sans quote-part quand aucune répartition n\'est enregistrée', () => {
    const f = contratFieldsFromProposal(base({ fee_distribution: undefined }));
    expect(f.missions_list).toBeUndefined();
    expect(f.cotraitants![0].fee_pct).toBe(0);
  });

  it('ne vide jamais ce que la proposition ne porte pas', () => {
    const f = contratFieldsFromProposal(base({
      adresse_terrain: '', cp_ville_terrain: '', surface_plancher: '', construction_cost: undefined,
      fee_distribution: 'pas du json', specialties_list: [],
    }));
    expect('adresse_travaux' in f).toBe(false);
    expect('surface_plancher' in f).toBe(false);
    expect('budget_previsionnel' in f).toBe(false);
    expect('missions_list' in f).toBe(false);
    expect('cotraitants' in f).toBe(false);
  });
});
