import { describe, expect, it } from 'vitest';
import { sanitizePlanning, type TachePlanning } from '../planningChantier';
import { ecartJalonMission, jalonMissionAvecDate, jalonsMissionDepuisApi } from '../planningJalonsMission';

const reponse = [
  { id: 'm-aor', project_id: 'p', title: 'AOR', due_date: '2027-02-01T00:00:00.000Z', completed: false, duration_days: 30, dependencies: [] },
  { id: 'm-det', project_id: 'p', title: ' DET ', due_date: '2026-12-01', completed: true, duration_days: 90, dependencies: ['m-apd'] },
  { id: 'm-sans-date', title: 'PRO', due_date: 'bientôt' },
  { id: '', title: 'Sans identifiant', due_date: '2027-01-01' },
  { id: 'm-det', title: 'Doublon', due_date: '2027-01-01' },
  { id: 'm-vide', title: '   ', due_date: '2027-01-01' },
  null, 'texte',
];
const jalon = (extra: Partial<TachePlanning> = {}): TachePlanning => ({ id: 'rec', lotId: '', libelle: 'Réception', debut: '2027-01-25', fin: '2027-01-25', avancement: 0, source: 'manuel', jalon: true, ...extra });

describe('jalons de mission lus dans la réponse de l’API', () => {
  it('garde les jalons valides, ramène l’échéance au jour et trie par date', () => {
    const jalons = jalonsMissionDepuisApi(reponse);
    expect(jalons).toEqual([
      { id: 'm-det', title: 'DET', due_date: '2026-12-01', completed: true },
      { id: 'm-aor', title: 'AOR', due_date: '2027-02-01', completed: false },
    ]);
  });
  it('rend une liste vide pour une réponse inattendue', () => {
    expect(jalonsMissionDepuisApi(undefined)).toEqual([]);
    expect(jalonsMissionDepuisApi({ erreur: 'x' })).toEqual([]);
  });
});

describe('écart entre un jalon du planning et sa mission', () => {
  const missions = jalonsMissionDepuisApi(reponse);
  it('compte les jours, positif quand la mission est plus tard', () => {
    expect(ecartJalonMission(jalon({ jalonMission: 'm-aor' }), missions)).toMatchObject({ jours: 7, mission: { title: 'AOR' } });
    expect(ecartJalonMission(jalon({ debut: '2027-02-04', fin: '2027-02-04', jalonMission: 'm-aor' }), missions)?.jours).toBe(-3);
    expect(ecartJalonMission(jalon({ debut: '2027-02-01', fin: '2027-02-01', jalonMission: 'm-aor' }), missions)?.jours).toBe(0);
  });
  it('ne rend rien sans lien, sans jalon, ou si la mission a disparu', () => {
    expect(ecartJalonMission(jalon(), missions)).toBeNull();
    expect(ecartJalonMission(jalon({ jalon: false, jalonMission: 'm-aor' }), missions)).toBeNull();
    expect(ecartJalonMission(jalon({ jalonMission: 'supprimé' }), missions)).toBeNull();
  });
});

describe('mise à jour de la mission', () => {
  it('rend le corps complet avec la seule échéance changée, tel que la route le réécrit', () => {
    const corps = jalonMissionAvecDate(reponse, 'm-det', '2027-03-15');
    expect(corps).toEqual({ ...(reponse[1] as object), due_date: '2027-03-15' });
    expect(corps).toMatchObject({ title: ' DET ', completed: true, duration_days: 90, dependencies: ['m-apd'] });
    expect((reponse[1] as { due_date: string }).due_date).toBe('2026-12-01'); // la réponse reçue n'est pas modifiée
  });
  it('refuse une date illisible ou une mission inconnue', () => {
    expect(jalonMissionAvecDate(reponse, 'm-det', '15/03/2027')).toBeNull();
    expect(jalonMissionAvecDate(reponse, 'inconnu', '2027-03-15')).toBeNull();
    expect(jalonMissionAvecDate(undefined, 'm-det', '2027-03-15')).toBeNull();
  });
});

describe('lien enregistré dans le planning', () => {
  it('est conservé pour un jalon, écarté pour une tâche ordinaire', () => {
    const p = sanitizePlanning({ taches: [
      { id: 'a', libelle: 'Réception', debut: '2027-01-25', jalon: true, jalonMission: 'm-aor' },
      { id: 'b', libelle: 'Dallage', debut: '2027-01-25', fin: '2027-01-30', jalonMission: 'm-aor' },
      { id: 'c', libelle: 'Hors d’eau', debut: '2027-01-25', jalon: true, jalonMission: 42 },
    ] });
    expect(p.taches.map(t => t.jalonMission)).toEqual(['m-aor', undefined, undefined]);
  });
});
