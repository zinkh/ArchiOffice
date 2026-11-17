import { describe, expect, it } from 'vitest';
import { bilanVisite, libelleVisite } from '../actVisites';

describe('visites de consultation', () => {
  const lots = [{ id: 'go', lot_number: '01', lot_title: 'Gros œuvre' }, { id: 'cv', lot_number: '02', lot_title: 'Chauffage' }];
  it('distingue les inscrits et les présents par lot, sans compter deux fois une même entreprise dans le total', () => {
    const a = { id: 'a', lots_ids: ['go', 'cv'], visite_creneau_id: 's1', visite_presence: 'presente' as const };
    const bilan = bilanVisite('s1', [a, a, { id: 'b', lots_ids: ['go'], visite_creneau_id: 's1', visite_presence: 'confirmee' }, { id: 'c', lots_ids: [], visite_creneau_id: 's1', visite_presence: 'absente' }, { id: 'd', lots_ids: ['go'], visite_creneau_id: 's2', visite_presence: 'presente' }], lots);
    expect(bilan.inscrites).toBe(3); expect(bilan.presentes).toBe(1); expect(bilan.sansLot).toBe(1);
    expect(bilan.lots.map(l => [l.lot.id, l.inscrites, l.presentes])).toEqual([['go', 2, 1], ['cv', 1, 1]]);
  });
  it('ne considère pas un rendez-vous prévu comme une présence effective', () => {
    const bilan = bilanVisite('s1', [{ id: 'a', lots_ids: ['go'], visite_creneau_id: 's1' }], lots);
    expect(bilan.lots[0]).toMatchObject({ inscrites: 1, presentes: 0 });
  });
  it('affiche la date et l’heure locale sans décalage UTC', () => {
    expect(libelleVisite('2026-11-23T09:30')).toContain('09:30');
  });
});
