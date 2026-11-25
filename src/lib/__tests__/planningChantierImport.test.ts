import { describe, expect, it } from 'vitest';
import type { Project } from '../../types';
import { exportPlanningChantierXml } from '../planningChantierXml';
import {
  appliquerImport, bornesImport, datesVraisemblables, lireXmlPlanning, planningDepuisPdf, rapprocherLot, typeFichierPlanning,
} from '../planningChantierImport';
import { sanitizePlanning, type LotPlanifiable, type PlanningChantier } from '../planningChantier';

const lots: LotPlanifiable[] = [
  { id: 'lot-1', lot_number: '01', lot_title: 'Gros œuvre' },
  { id: 'lot-2', lot_number: '02', lot_title: 'Charpente et couverture' },
  { id: 'lot-3', lot_number: '3', lot_title: 'Plomberie sanitaire' },
];
const projet = { id: 'p1', name: 'Salle polyvalente', start_date: '2026-03-02', end_date: '2026-09-30' } as Project;
let compteur = 0;
const fabrique = () => `n-${++compteur}`;

const planning: PlanningChantier = sanitizePlanning({
  taches: [
    { id: 'a', lotId: 'lot-1', libelle: 'Fondations', debut: '2026-03-02', fin: '2026-03-13', avancement: 40 },
    { id: 'b', lotId: 'lot-1', libelle: 'Élévations', debut: '2026-03-23', fin: '2026-04-17', dependencies: ['a'], delais: { a: 7 } },
    { id: 'c', lotId: 'lot-2', libelle: 'Charpente', debut: '2026-04-20', fin: '2026-05-01', dependencies: ['b'] },
    { id: 'd', lotId: '', libelle: 'Réception', debut: '2026-09-25', fin: '2026-09-25', jalon: true },
    { id: 'e', lotId: 'lot-9', libelle: 'Tâche d’un lot disparu', debut: '2026-06-01', fin: '2026-06-05' },
  ],
});

describe('typeFichierPlanning', () => {
  it('reconnaît les formats lus et signale le .mpp', () => {
    expect(typeFichierPlanning('planning.XML')).toBe('xml');
    expect(typeFichierPlanning('chantier.gan')).toBe('xml');
    expect(typeFichierPlanning('planning.pdf')).toBe('pdf');
    expect(typeFichierPlanning('planning.mpp')).toBe('mpp');
    expect(typeFichierPlanning('planning.xlsx')).toBeNull();
    expect(typeFichierPlanning('sans-extension')).toBeNull();
  });
});

describe('rapprocherLot', () => {
  it('prend le numéro avant le titre, zéros de tête ignorés', () => {
    expect(rapprocherLot('Lot 02 · Charpente et couverture', lots)).toEqual({ lot: lots[1] });
    expect(rapprocherLot('Lot 3 · Plomberie', lots)).toEqual({ lot: lots[2] });
    expect(rapprocherLot('LOT N°1', lots)).toEqual({ lot: lots[0] });
  });
  it('retombe sur l’intitulé, accents et casse ignorés', () => {
    expect(rapprocherLot('GROS ŒUVRE', lots)).toEqual({ lot: lots[0] });
    expect(rapprocherLot('plomberie sanitaire - étage', lots)).toEqual({ lot: lots[2] });
  });
  it('reconnaît les tâches générales et refuse de choisir entre plusieurs lots', () => {
    expect(rapprocherLot('Tâches générales', lots)).toEqual({ general: true });
    const ambigus = [...lots, { id: 'x', lot_number: '9', lot_title: 'Couverture' }, { id: 'y', lot_number: '10', lot_title: 'Couverture zinc' }];
    expect(rapprocherLot('Couverture zinc', ambigus)).toBeNull();
    expect(rapprocherLot('Travaux divers', lots)).toBeNull();
  });
});

describe.each(['msproject', 'ganttproject'] as const)('import du XML %s (aller-retour avec l’export)', format => {
  const xml = exportPlanningChantierXml(projet, planning, lots, format);
  const importe = lireXmlPlanning(xml, lots, fabrique);

  it('reprend les tâches sans les groupes récapitulatifs', () => {
    expect(importe.format).toBe(format);
    // L'export range les tâches générales d'abord : l'import suit l'ordre du fichier.
    expect(importe.taches.map(t => t.libelle).sort()).toEqual(['Charpente', 'Élévations', 'Fondations', 'Réception', 'Tâche d’un lot disparu'].sort());
    expect(importe.taches).toHaveLength(5);
  });
  it('range chaque tâche dans son lot, et les autres en tâches générales', () => {
    const lotDe = (libelle: string) => importe.taches.find(t => t.libelle === libelle)?.lotId;
    expect(lotDe('Fondations')).toBe('lot-1');
    expect(lotDe('Charpente')).toBe('lot-2');
    expect(lotDe('Réception')).toBe('');
  });
  it('conserve dates, avancement et jalon', () => {
    const fondations = importe.taches.find(t => t.libelle === 'Fondations')!;
    expect(fondations).toMatchObject({ debut: '2026-03-02', fin: '2026-03-13', avancement: 40, source: 'manuel' });
    const reception = importe.taches.find(t => t.libelle === 'Réception')!;
    expect(reception).toMatchObject({ jalon: true, debut: '2026-09-25', fin: '2026-09-25' });
  });
  it('conserve les liens et leurs délais, avec les nouveaux identifiants', () => {
    const idDe = (libelle: string) => importe.taches.find(t => t.libelle === libelle)!.id;
    const elevations = importe.taches.find(t => t.libelle === 'Élévations')!;
    expect(elevations.dependencies).toEqual([idDe('Fondations')]);
    expect(elevations.delais).toEqual({ [idDe('Fondations')]: 7 });
    expect(importe.taches.find(t => t.libelle === 'Charpente')!.dependencies).toEqual([idDe('Élévations')]);
  });
  it('ne signale rien quand tout est rangé comme à l’export (tâches générales comprises)', () => {
    // L'export place déjà la tâche d'un lot disparu sous « Tâches générales » : c'est un rangement voulu.
    expect(importe.sansLot).toBe(0);
    expect(importe.avertissements).toEqual([]);
    expect(importe.taches.find(t => t.libelle === 'Tâche d’un lot disparu')?.lotId).toBe('');
  });
  it('donne des bornes et passe le contrôle des dates', () => {
    expect(bornesImport(importe)).toEqual({ debut: '2026-03-02', fin: '2026-09-25' });
    expect(datesVraisemblables(importe)).toBe(true);
  });
});

describe('fichiers XML inexploitables ou particuliers', () => {
  it('refuse un XML d’un autre format et un fichier sans tâche', () => {
    expect(() => lireXmlPlanning('<html><body/></html>', lots, fabrique)).toThrow(/Format XML non reconnu/);
    expect(() => lireXmlPlanning('<project name="vide"><tasks/></project>', lots, fabrique)).toThrow(/aucune tâche importable/);
  });
  it('lit un GanttProject à plat en cherchant le lot dans le titre de la tâche', () => {
    const xml = `<project name="Plat"><tasks>
      <task id="1" name="Lot 02 Charpente : pose" start="2026-05-04" duration="5" complete="0"/>
      <task id="2" name="Nettoyage" start="2026-05-11" duration="1" complete="0"/></tasks></project>`;
    const importe = lireXmlPlanning(xml, lots, fabrique);
    expect(importe.taches.map(t => t.lotId)).toEqual(['lot-2', '']);
    expect(importe.taches[0]).toMatchObject({ debut: '2026-05-04', fin: '2026-05-08' });
    // « Nettoyage » n'est dans aucun groupe et ne cite aucun lot : rangée faute de mieux, et signalée.
    expect(importe.sansLot).toBe(1);
    expect(importe.avertissements.join(' ')).toContain('1 tâche sans lot reconnu');
  });
  it('signale les tâches d’un groupe qui ne correspond à aucun lot de l’opération', () => {
    const xml = `<project name="Autre"><tasks>
      <task id="1" name="Lot 77 Piscine" start="2026-03-02" duration="10"><task id="2" name="Bassin" start="2026-03-02" duration="10"/><task id="3" name="Plage" start="2026-03-16" duration="5"/></task></tasks></project>`;
    const importe = lireXmlPlanning(xml, lots, fabrique);
    expect(importe.taches.map(t => t.lotId)).toEqual(['', '']);
    expect(importe.sansLot).toBe(2);
    expect(importe.avertissements[0]).toContain('2 tâches sans lot reconnu rangées');
  });
  it('écarte un lien qui part d’un groupe et le dit', () => {
    // Le groupe « Lot 01 » (id 1) précède la tâche 3 : le planning relie des tâches, pas des groupes.
    const xml = `<project name="G"><tasks>
      <task id="1" name="Lot 01 Gros œuvre" start="2026-03-02" duration="10"><depend id="3"/>
        <task id="2" name="Dalle" start="2026-03-02" duration="10"/></task>
      <task id="3" name="Charpente" start="2026-03-16" duration="5"/></tasks></project>`;
    const importe = lireXmlPlanning(xml, lots, fabrique);
    expect(importe.taches.map(t => t.libelle)).toEqual(['Dalle', 'Charpente']);
    expect(importe.taches.every(t => !t.dependencies?.length)).toBe(true);
    expect(importe.avertissements.join(' ')).toContain('lien');
  });
});

describe('planningDepuisPdf', () => {
  const reponse = {
    taches: [
      { ref: 'T1', lot_numero: '01', libelle: 'Terrassements', debut: '2026-03-02', fin: '2026-03-06', avancement: 100 },
      { ref: 'T2', lot_numero: 'Lot 02', libelle: 'Charpente', debut: '2026-03-09', fin: '2026-03-27', predecesseurs: ['T1', 'T9', 'T2'] },
      { ref: 'T3', lot_numero: 'general', libelle: 'Réception', debut: '2026-09-25', jalon: true },
      { ref: 'T4', lot_numero: '77', libelle: 'Lot inconnu', debut: '2026-04-01', fin: '2026-03-30' },
      { ref: 'T5', lot_numero: '01', libelle: 'Date impossible', debut: '2026-02-30' },
      { ref: 'T6', lot_numero: '01', libelle: '', debut: '2026-04-01' },
    ],
    remarques: ['Année supposée 2026 pour les dates sans année'],
  };
  const importe = planningDepuisPdf(reponse, lots, fabrique);

  it('rattache aux lots connus, jamais à un lot créé', () => {
    expect(importe.taches.map(t => t.lotId)).toEqual(['lot-1', 'lot-2', '', '']);
  });
  it('n’invente aucune date : une date impossible ou une tâche sans intitulé est écartée', () => {
    expect(importe.taches.map(t => t.libelle)).toEqual(['Terrassements', 'Charpente', 'Réception', 'Lot inconnu']);
    expect(importe.ecartees).toBe(2);
  });
  it('remet début et fin dans l’ordre et ramène un jalon à un jour', () => {
    expect(importe.taches[3]).toMatchObject({ debut: '2026-03-30', fin: '2026-04-01' });
    expect(importe.taches[2]).toMatchObject({ jalon: true, debut: '2026-09-25', fin: '2026-09-25' });
  });
  it('garde les prédécesseurs connus, sans lien vers soi ni vers une référence inconnue', () => {
    expect(importe.taches[1].dependencies).toEqual([importe.taches[0].id]);
  });
  it('porte les remarques du modèle et le décompte des tâches au lot inconnu', () => {
    expect(importe.format).toBe('pdf');
    // « general » est un rangement voulu ; seul le lot 77 est compté comme non reconnu.
    expect(importe.sansLot).toBe(1);
    expect(importe.avertissements[0]).toBe('Année supposée 2026 pour les dates sans année');
    expect(importe.avertissements.join(' ')).toMatch(/1 tâche sans lot reconnu/);
  });
  it('supporte une réponse vide ou invalide', () => {
    expect(planningDepuisPdf(null, lots, fabrique).taches).toEqual([]);
    expect(planningDepuisPdf({ taches: 'non' }, lots, fabrique).taches).toEqual([]);
  });
});

describe('appliquerImport', () => {
  const importe = lireXmlPlanning(exportPlanningChantierXml(projet, planning, lots, 'msproject'), lots, fabrique);
  const existant = sanitizePlanning({
    taches: [{ id: 'x', lotId: 'lot-3', libelle: 'Réseaux', debut: '2026-07-01', fin: '2026-07-10' }],
    hypotheses: ['Hypothèse IA'], genereLe: '2026-01-01T00:00:00.000Z',
    calendrier: { joursFeries: 'alsace_moselle', periodes: [] },
  });

  it('ajoute sans toucher à l’existant', () => {
    const resultat = appliquerImport(existant, importe, 'ajouter');
    expect(resultat.taches).toHaveLength(1 + importe.taches.length);
    expect(resultat.taches[0].libelle).toBe('Réseaux');
    expect(resultat.hypotheses).toEqual(['Hypothèse IA']);
  });
  it('remplace les tâches, garde le calendrier et vide les hypothèses de l’ancienne génération', () => {
    const resultat = appliquerImport(existant, importe, 'remplacer');
    expect(resultat.taches).toHaveLength(importe.taches.length);
    expect(resultat.taches.some(t => t.libelle === 'Réseaux')).toBe(false);
    expect(resultat.calendrier?.joursFeries).toBe('alsace_moselle');
    expect(resultat.hypotheses).toEqual([]);
    expect(resultat.genereLe).toBeNull();
  });
  it('marque tout comme saisi à la main : une génération IA ne l’efface pas', () => {
    expect(appliquerImport(existant, importe, 'remplacer').taches.every(t => t.source === 'manuel')).toBe(true);
  });
});

describe('datesVraisemblables', () => {
  it('signale une lecture aberrante', () => {
    const tache = (debut: string, fin: string) => ({ taches: [{ id: 'a', lotId: '', libelle: 'x', debut, fin, avancement: 0, source: 'manuel' as const }] });
    expect(datesVraisemblables(tache('2026-03-02', '2026-03-06'))).toBe(true);
    expect(datesVraisemblables(tache('1926-03-02', '1926-03-06'))).toBe(false);
    expect(datesVraisemblables(tache('2026-03-02', '2126-03-06'))).toBe(false);
  });
});
