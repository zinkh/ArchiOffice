import { describe, expect, it } from 'vitest';
import {
  appliquerGeneration, bornesPlanning, etatTache, lundiDe, planningDepuisReponse, planningParLot,
  sanitizePlanning, semainesEntre, type LotPlanifiable, type TachePlanning,
} from '../planningChantier';

const lots: LotPlanifiable[] = [
  { id: 'l1', lot_number: '01', lot_title: 'Gros œuvre', contact_name: 'Maçonnerie Martin' },
  { id: 'l2', lot_number: '2', lot_title: 'Charpente' },
  { id: 'l3', lot_number: '10', lot_title: 'Peinture' },
];

const tache = (over: Partial<TachePlanning> = {}): TachePlanning => ({
  id: 't1', lotId: 'l1', libelle: 'Fondations', debut: '2026-03-02', fin: '2026-03-13', avancement: 0, source: 'manuel', ...over,
});

describe('dates', () => {
  it('trouve le lundi de la semaine, dimanche compris', () => {
    expect(lundiDe('2026-03-04')).toBe('2026-03-02'); // mercredi
    expect(lundiDe('2026-03-02')).toBe('2026-03-02'); // lundi
    expect(lundiDe('2026-03-08')).toBe('2026-03-02'); // dimanche
  });

  it('ne se décale pas au passage à l’heure d’été', () => {
    expect(semainesEntre('2026-03-23', '2026-04-06')).toEqual(['2026-03-23', '2026-03-30', '2026-04-06']);
  });
});

describe('sanitizePlanning', () => {
  it('remet début et fin dans l’ordre et borne l’avancement', () => {
    const p = sanitizePlanning({ taches: [{ id: 'a', lotId: 'l1', libelle: ' Dalle ', debut: '2026-03-10', fin: '2026-03-02', avancement: 140 }] });
    expect(p.taches[0]).toMatchObject({ libelle: 'Dalle', debut: '2026-03-02', fin: '2026-03-10', avancement: 100, source: 'manuel' });
  });

  it('écarte une tâche sans libellé ou sans date lisible, et une date impossible', () => {
    const p = sanitizePlanning({ taches: [
      { libelle: '', debut: '2026-03-02' },
      { libelle: 'x', debut: 'demain' },
      { libelle: 'y', debut: '2026-02-30' },
      { libelle: 'ok', debut: '2026-03-02' },
    ] });
    expect(p.taches.map(t => t.libelle)).toEqual(['ok']);
  });

  it('rend unique chaque identifiant et ramène un jalon à un jour', () => {
    const p = sanitizePlanning({ taches: [
      { id: 'a', libelle: 'un', debut: '2026-03-02' },
      { id: 'a', libelle: 'deux', debut: '2026-03-03', fin: '2026-03-20', jalon: true },
    ] });
    expect(new Set(p.taches.map(t => t.id)).size).toBe(2);
    expect(p.taches[1]).toMatchObject({ jalon: true, debut: '2026-03-03', fin: '2026-03-03' });
  });

  it('tolère n’importe quelle entrée', () => {
    expect(sanitizePlanning(null).taches).toEqual([]);
    expect(sanitizePlanning('x').taches).toEqual([]);
  });
});

describe('planningParLot', () => {
  it('range par lot dans l’ordre des lots, tâches générales en tête', () => {
    const p = sanitizePlanning({ taches: [
      tache({ id: 'a', lotId: 'l2', libelle: 'Charpente', debut: '2026-04-06', fin: '2026-04-17' }),
      tache({ id: 'b', lotId: 'l1' }),
      tache({ id: 'c', lotId: '', libelle: 'Installation de chantier', debut: '2026-03-02', fin: '2026-03-06' }),
      tache({ id: 'd', lotId: 'inconnu', libelle: 'Orpheline', debut: '2026-03-02', fin: '2026-03-02' }),
    ] });
    const lignes = planningParLot(p, lots);
    expect(lignes.map(l => l.lot?.id ?? null)).toEqual([null, 'l1', 'l2']);
    // Même début : la plus courte d'abord.
    expect(lignes[0].taches.map(t => t.id)).toEqual(['d', 'c']);
  });

  it('pondère l’avancement du lot par la durée des tâches', () => {
    const p = sanitizePlanning({ taches: [
      tache({ id: 'a', debut: '2026-03-02', fin: '2026-03-06', avancement: 100 }), // 5 jours
      tache({ id: 'b', debut: '2026-03-09', fin: '2026-03-23', avancement: 0 }),   // 15 jours
    ] });
    expect(planningParLot(p, lots)[0].avancement).toBe(25);
  });

  it('donne les bornes du planning', () => {
    expect(bornesPlanning(sanitizePlanning({}))).toBeNull();
    const p = sanitizePlanning({ taches: [tache({ id: 'a' }), tache({ id: 'b', debut: '2026-05-04', fin: '2026-05-08' })] });
    expect(bornesPlanning(p)).toEqual({ debut: '2026-03-02', fin: '2026-05-08' });
  });
});

describe('etatTache', () => {
  const t = tache({ debut: '2026-03-02', fin: '2026-03-13' }); // 12 jours
  it('est terminée à 100 %', () => expect(etatTache({ ...t, avancement: 100 }, '2026-06-01')).toBe('terminee'));
  it('est en retard une fois la fin passée', () => expect(etatTache(t, '2026-03-20')).toBe('en_retard'));
  it('est à venir avant le début', () => expect(etatTache(t, '2026-02-20')).toBe('a_venir'));
  it('est en cours dans les temps, en retard si l’avancement traîne de plus de 20 points', () => {
    expect(etatTache({ ...t, avancement: 50 }, '2026-03-08')).toBe('en_cours');
    expect(etatTache({ ...t, avancement: 0 }, '2026-03-12')).toBe('en_retard');
  });
});

describe('planningDepuisReponse', () => {
  let n = 0;
  const id = () => `g${++n}`;

  it('pose les dates du lundi de la semaine de démarrage au vendredi de la dernière semaine', () => {
    const r = planningDepuisReponse({ taches: [
      { lot_numero: '01', libelle: 'Terrassement', semaine_debut: 1, duree_semaines: 2 },
      { lot_numero: '2', libelle: 'Levage', semaine_debut: 4, duree_semaines: 1 },
    ] }, lots, '2026-03-04', id);
    expect(r.taches[0]).toMatchObject({ lotId: 'l1', debut: '2026-03-02', fin: '2026-03-13', source: 'ia', avancement: 0 });
    expect(r.taches[1]).toMatchObject({ lotId: 'l2', debut: '2026-03-23', fin: '2026-03-27' });
  });

  it('rapproche « 02 », « 2 » et « Lot 2 » du même lot', () => {
    const r = planningDepuisReponse({ taches: ['02', '2', 'Lot 2'].map(lot_numero => ({ lot_numero, libelle: 'x', semaine_debut: 1, duree_semaines: 1 })) }, lots, '2026-03-02', id);
    expect(r.taches.every(t => t.lotId === 'l2')).toBe(true);
  });

  it('écarte un lot inconnu sans en créer, et compte les tâches écartées', () => {
    const r = planningDepuisReponse({ taches: [
      { lot_numero: '99', libelle: 'Fantôme', semaine_debut: 1, duree_semaines: 2 },
      { lot_numero: '01', libelle: 'Durée illisible', semaine_debut: 1, duree_semaines: 'longtemps' },
      { lot_numero: '01', libelle: 'Valide', semaine_debut: 1, duree_semaines: 1 },
    ] }, lots, '2026-03-02', id);
    expect(r.taches.map(t => t.libelle)).toEqual(['Valide']);
    expect(r.ecartees).toBe(2);
  });

  it('accepte une tâche générale et un jalon sans durée', () => {
    const r = planningDepuisReponse({ taches: [
      { lot_numero: 'général', libelle: 'Installation de chantier', semaine_debut: 1, duree_semaines: 1 },
      { lot_numero: '', libelle: 'Réception', semaine_debut: 20, jalon: true },
    ] }, lots, '2026-03-02', id);
    expect(r.taches[0].lotId).toBe('');
    expect(r.taches[1]).toMatchObject({ jalon: true, debut: r.taches[1].fin });
  });

  it('retient les hypothèses', () => {
    expect(planningDepuisReponse({ taches: [], hypotheses: ['Pas de congés d’été', '  '] }, lots, '2026-03-02', id).hypotheses).toEqual(['Pas de congés d’été']);
  });
});

describe('appliquerGeneration', () => {
  const actuel = sanitizePlanning({ taches: [
    tache({ id: 'ia1', lotId: 'l1', source: 'ia' }),
    tache({ id: 'm1', lotId: 'l1', libelle: 'Saisie à la main', source: 'manuel' }),
    tache({ id: 'm2', lotId: 'l3', libelle: 'Peinture', source: 'ia' }),
  ] });
  const genere = { taches: [tache({ id: 'n1', lotId: 'l1', libelle: 'Nouveau', source: 'ia' })], hypotheses: ['H'], ecartees: 0 };

  it('remplace l’IA des lots générés, garde le manuel et les autres lots', () => {
    const r = appliquerGeneration(actuel, genere, new Set(['l1']), { garderManuel: true });
    expect(r.taches.map(t => t.id).sort()).toEqual(['m1', 'm2', 'n1']);
    expect(r.hypotheses).toEqual(['H']);
    expect(r.genereLe).not.toBeNull();
  });

  it('remplace aussi le manuel quand on le demande', () => {
    const r = appliquerGeneration(actuel, genere, new Set(['l1']), { garderManuel: false });
    expect(r.taches.map(t => t.id).sort()).toEqual(['m2', 'n1']);
  });
});
