import { describe, expect, it } from 'vitest';
import { aDejaVisite, entreprisesAyantVisite, visitePourMessage } from '../actVisites';
import { entreprisesAConvoquer, planEnvoiGroupe } from '../dceEnvoiGroupe';
import { planEmargement } from '../actVisitesExport';

const creneaux = [
  { id: 's2', date_heure: '2026-12-02T09:00' },
  { id: 's1', date_heure: '2026-11-18T11:00' },
];
const entreprise = (id: string, nom: string, extra: Record<string, unknown> = {}) => ({
  id, nom, lots_ids: ['go'], email: `${id}@exemple.fr`, ...extra,
}) as any;

describe('entreprise ayant déjà visité', () => {
  it('ne l\'est qu\'avec un créneau ET une présence pointée', () => {
    expect(aDejaVisite({ visite_creneau_id: 's1', visite_presence: 'presente' })).toBe(true);
    expect(aDejaVisite({ visite_creneau_id: 's1', visite_presence: 'confirmee' })).toBe(false);
    expect(aDejaVisite({ visite_creneau_id: 's1', visite_presence: 'absente' })).toBe(false);
    expect(aDejaVisite({ visite_presence: 'presente' })).toBe(false);
  });

  it('n\'annonce ni ne propose aucune visite dans le message du DCE', () => {
    const avant = new Date('2026-11-01T08:00');
    expect(visitePourMessage({ visite_creneau_id: 's1', visite_presence: 'presente' }, creneaux, undefined, avant)).toBeUndefined();
    // Une absente garde son créneau ; une entreprise sans créneau se voit proposer les créneaux à venir.
    expect(visitePourMessage({ visite_creneau_id: 's1', visite_presence: 'absente' }, creneaux, undefined, avant)?.assigne).toBe(true);
    expect(visitePourMessage({}, creneaux, undefined, avant)?.creneaux).toHaveLength(2);
  });

  it('n\'est plus à convoquer et est écartée de la convocation avec son motif', () => {
    const venue = entreprise('a', 'Alpha', { visite_creneau_id: 's1', visite_presence: 'presente' });
    const prevue = entreprise('b', 'Bravo', { visite_creneau_id: 's1', visite_presence: 'prevue' });
    expect(entreprisesAConvoquer([venue, prevue]).map(e => e.id)).toEqual(['b']);
    const plan = planEnvoiGroupe([venue, prevue], 'visite');
    expect(plan[0].motif).toBe('deja_visite');
    expect(plan[1].motif).toBeUndefined();
  });

  it('ne change rien pour le renvoi du DCE lui-même', () => {
    const venue = entreprise('a', 'Alpha', { visite_creneau_id: 's1', visite_presence: 'presente' });
    expect(planEnvoiGroupe([venue], 'dce')[0].motif).toBeUndefined();
  });
});

describe('liste des entreprises ayant fait la visite', () => {
  it('classe par date puis par nom et ignore les absents, prévus et créneaux supprimés', () => {
    const liste = entreprisesAyantVisite([
      entreprise('c', 'Charlie', { visite_creneau_id: 's2', visite_presence: 'presente' }),
      entreprise('b', 'Bravo', { visite_creneau_id: 's1', visite_presence: 'presente' }),
      entreprise('a', 'Alpha', { visite_creneau_id: 's1', visite_presence: 'presente' }),
      entreprise('d', 'Delta', { visite_creneau_id: 's1', visite_presence: 'absente' }),
      entreprise('e', 'Echo', { visite_creneau_id: 'supprime', visite_presence: 'presente' }),
      entreprise('f', 'Foxtrot'),
    ], creneaux);
    expect(liste.map(l => [l.entreprise.nom, l.creneau.id])).toEqual([['Alpha', 's1'], ['Bravo', 's1'], ['Charlie', 's2']]);
  });
});

describe('tableau d\'émargement', () => {
  it('prévoit une feuille par créneau, dans l\'ordre des dates, sans les entreprises qui ne répondent pas', () => {
    const feuilles = planEmargement([
      entreprise('a', 'Alpha', { visite_creneau_id: 's2' }),
      entreprise('b', 'Bravo', { visite_creneau_id: 's1' }),
      entreprise('c', 'Charlie', { visite_creneau_id: 's1', ne_repond_pas: true }),
    ], creneaux);
    expect(feuilles.map(f => [f.creneau?.id, f.entreprises.map(e => e.nom)])).toEqual([['s1', ['Bravo']], ['s2', ['Alpha']]]);
  });

  it('sans créneau défini, une feuille générale reprend toutes les entreprises consultées', () => {
    const feuilles = planEmargement([entreprise('b', 'Bravo'), entreprise('a', 'Alpha')], []);
    expect(feuilles).toHaveLength(1);
    expect(feuilles[0].creneau).toBeUndefined();
    expect(feuilles[0].entreprises.map(e => e.nom)).toEqual(['Alpha', 'Bravo']);
  });
});
