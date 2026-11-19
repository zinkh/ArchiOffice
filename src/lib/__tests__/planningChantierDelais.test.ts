import { describe, expect, it } from 'vitest';
import {
  MAX_DELAI, avancerOuvres, decalerSuccesseurs, dureeOuvree, incoherencesDependances, joursOuvresEntre,
  placerApresPredecesseurs, premierJourOuvre, sanitizeCalendrierPlanning, sanitizePlanning, type TachePlanning,
} from '../planningChantier';
import { creerEstOuvre, estOuvreDuPlanning } from '../planningChantierCalendrier';
import { exportPlanningChantierXml } from '../planningChantierXml';

const tache = (id: string, debut: string, fin: string, extra: Partial<TachePlanning> = {}): TachePlanning =>
  ({ id, lotId: 'lot', libelle: id, debut, fin, avancement: 0, source: 'manuel', ...extra });
const dates = (t: TachePlanning) => [t.debut, t.fin];
// Janvier 2027 : le 1er est un vendredi (jour de l'an), le 4 un lundi.
const ouvre = creerEstOuvre({ joursFeries: 'france', periodes: [], joursOuvres: true });

describe('délais entre les tâches', () => {
  it('sont gardés pour les liens valides, bornés et arrondis, sinon écartés', () => {
    const p = sanitizePlanning({ taches: [
      { id: 'a', libelle: 'A', debut: '2027-01-04', fin: '2027-01-08' },
      { id: 'b', libelle: 'B', debut: '2027-01-20', fin: '2027-01-22', dependencies: ['a', 'inconnu'], delais: { a: 2.6, inconnu: 5, zzz: 1 } },
      { id: 'c', libelle: 'C', debut: '2027-01-25', fin: '2027-01-26', dependencies: ['a'], delais: { a: 0 } },
      { id: 'd', libelle: 'D', debut: '2027-01-25', fin: '2027-01-26', dependencies: ['a'], delais: { a: 99999 } },
      { id: 'e', libelle: 'E', debut: '2027-01-25', fin: '2027-01-26', dependencies: ['a'], delais: { a: 'abc' } },
      { id: 'f', libelle: 'F', debut: '2027-01-25', fin: '2027-01-26', delais: { a: 3 } },
    ] });
    const par = (id: string) => p.taches.find(t => t.id === id)!;
    expect(par('b').delais).toEqual({ a: 3 });
    expect(par('c').delais).toBeUndefined();
    expect(par('d').delais).toEqual({ a: MAX_DELAI });
    expect(par('e').delais).toBeUndefined();
    expect(par('f').delais).toBeUndefined(); // pas de lien, donc pas de délai
  });

  it('perdent leur délai quand le lien disparaît', () => {
    const p = sanitizePlanning({ taches: [
      { id: 'a', libelle: 'A', debut: '2027-01-04', fin: '2027-01-08' },
      { id: 'b', libelle: 'B', debut: '2027-01-20', fin: '2027-01-22', dependencies: [], delais: { a: 3 } },
    ] });
    expect(p.taches[1].delais).toBeUndefined();
  });

  it('placent la tâche après la fin du prédécesseur plus le délai, durée conservée', () => {
    const a = tache('a', '2027-01-04', '2027-01-08');
    const b = tache('b', '2027-01-04', '2027-01-06', { dependencies: ['a'], delais: { a: 3 } });
    expect(dates(placerApresPredecesseurs(b, [a, b]))).toEqual(['2027-01-12', '2027-01-14']);
  });

  it('suivent le prédécesseur le plus contraignant', () => {
    const a = tache('a', '2027-01-04', '2027-01-08');
    const x = tache('x', '2027-01-01', '2027-01-05');
    const b = tache('b', '2027-01-04', '2027-01-06', { dependencies: ['a', 'x'], delais: { x: 10 } });
    expect(placerApresPredecesseurs(b, [a, x, b]).debut).toBe('2027-01-16'); // 5 + 1 + 10, plus tard que le 9
  });

  it('sont signalés par l’alerte de dates incohérentes tant que l’écart manque', () => {
    const a = tache('a', '2027-01-04', '2027-01-08');
    const court = tache('b', '2027-01-11', '2027-01-12', { dependencies: ['a'], delais: { a: 3 } }); // 2 jours d'écart
    const bon = tache('c', '2027-01-12', '2027-01-13', { dependencies: ['a'], delais: { a: 3 } }); // 3 jours d'écart
    expect(incoherencesDependances([a, court, bon]).map(c => c.tache.id)).toEqual(['b']);
  });

  it('sont respectés par le décalage des successeurs', () => {
    const taches = [
      tache('a', '2027-01-10', '2027-01-14'),
      tache('b', '2027-01-15', '2027-01-16', { dependencies: ['a'], delais: { a: 2 } }),
      tache('c', '2027-01-17', '2027-01-18', { dependencies: ['b'] }),
    ];
    const r = decalerSuccesseurs(taches, ['a']);
    expect(dates(r.taches[1])).toEqual(['2027-01-17', '2027-01-18']);
    expect(dates(r.taches[2])).toEqual(['2027-01-19', '2027-01-20']);
  });
});

describe('délais dans les exports XML', () => {
  const planning = sanitizePlanning({ taches: [
    { id: 'a', lotId: 'lot', libelle: 'Fondations', debut: '2027-01-04', fin: '2027-01-08' },
    { id: 'b', lotId: 'lot', libelle: 'Dallage', debut: '2027-01-12', fin: '2027-01-15', dependencies: ['a'], delais: { a: 3 } },
    { id: 'c', lotId: 'lot', libelle: 'Murs', debut: '2027-01-18', fin: '2027-01-22', dependencies: ['b'] },
  ] });
  const lots = [{ id: 'lot', lot_number: '01', lot_title: 'GO' }];
  const projet = { id: 'p', name: 'École' } as any;

  it('écrivent le délai comme décalage du lien, zéro sans délai', () => {
    const gan = exportPlanningChantierXml(projet, planning, lots, 'ganttproject');
    expect(gan).toMatch(/difference="3"/);
    expect(gan).toMatch(/difference="0"/);
    const mpp = exportPlanningChantierXml(projet, planning, lots, 'msproject');
    expect(mpp).toMatch(/<LinkLag>14400<\/LinkLag>/); // 3 jours de 8 h, en dixièmes de minute
    expect(mpp).toMatch(/<LinkLag>0<\/LinkLag>/);
  });

  it('écrivent l’écart calendaire réel quand le calcul est en jours ouvrés', () => {
    const ouvres = sanitizePlanning({ ...planning, calendrier: { joursFeries: 'france', periodes: [], joursOuvres: true } });
    // Fin vendredi 8, début mardi 12 : trois jours calendaires entre les deux (samedi, dimanche, lundi).
    expect(exportPlanningChantierXml(projet, ouvres, lots, 'ganttproject')).toMatch(/difference="3"/);
  });
});

describe('jours ouvrés', () => {
  it('sautent week-ends, jours fériés et périodes de fermeture', () => {
    expect(avancerOuvres('2027-01-08', 1, ouvre)).toBe('2027-01-11'); // vendredi -> lundi
    expect(avancerOuvres('2026-12-31', 1, ouvre)).toBe('2027-01-04'); // jour de l'an un vendredi
    expect(avancerOuvres('2027-11-10', 1, ouvre)).toBe('2027-11-12'); // 11 novembre un jeudi
    const ferme = creerEstOuvre({ joursFeries: 'france', joursOuvres: true, periodes: [{ id: 'p', libelle: 'Fermeture', debut: '2027-02-01', fin: '2027-02-05', type: 'conge' }] });
    expect(avancerOuvres('2027-01-29', 1, ferme)).toBe('2027-02-08');
    expect(premierJourOuvre('2027-01-09', ouvre)).toBe('2027-01-11');
  });

  it('comptent les jours travaillés et rendent au moins un jour', () => {
    expect(joursOuvresEntre('2027-01-04', '2027-01-10', ouvre)).toBe(5);
    expect(dureeOuvree({ debut: '2027-01-09', fin: '2027-01-10' }, ouvre)).toBe(1); // week-end seul
    expect(dureeOuvree({ debut: '2027-01-04', fin: '2027-01-10' })).toBe(7); // sans calendrier : jours calendaires
  });

  it('gardent la durée en jours ouvrés quand la tâche est replacée après son prédécesseur', () => {
    const a = tache('a', '2027-01-04', '2027-01-08');
    const quatreJours = tache('b', '2027-01-07', '2027-01-12', { dependencies: ['a'] }); // jeudi, vendredi, lundi, mardi
    expect(dates(placerApresPredecesseurs(quatreJours, [a, quatreJours], ouvre))).toEqual(['2027-01-11', '2027-01-14']);
    // Même tâche en jours calendaires : six jours, comme avant.
    expect(dates(placerApresPredecesseurs(quatreJours, [a, quatreJours]))).toEqual(['2027-01-09', '2027-01-14']);
  });

  it('comptent le délai en jours ouvrés', () => {
    const a = tache('a', '2027-01-04', '2027-01-08');
    const b = tache('b', '2027-01-04', '2027-01-05', { dependencies: ['a'], delais: { a: 2 } });
    expect(placerApresPredecesseurs(b, [a, b], ouvre).debut).toBe('2027-01-13'); // lundi 11, mardi 12 de délai
    expect(placerApresPredecesseurs(b, [a, b]).debut).toBe('2027-01-11'); // calendaire : samedi 9, dimanche 10
  });

  it('ne signalent pas un début de week-end directement après la fin du prédécesseur', () => {
    const a = tache('a', '2027-01-04', '2027-01-08');
    const samedi = tache('b', '2027-01-09', '2027-01-12', { dependencies: ['a'] });
    expect(incoherencesDependances([a, samedi], ouvre)).toEqual([]);
    const lundiAvecDelai = tache('c', '2027-01-11', '2027-01-12', { dependencies: ['a'], delais: { a: 2 } });
    expect(incoherencesDependances([a, lundiAvecDelai], ouvre)).toHaveLength(1);
  });

  it('décalent les successeurs sur le prochain jour ouvré avec la durée en jours ouvrés', () => {
    const taches = [
      tache('a', '2027-01-04', '2027-01-08'),
      tache('b', '2027-01-06', '2027-01-12', { dependencies: ['a'] }), // mercredi à mardi : 5 jours ouvrés
    ];
    const r = decalerSuccesseurs(taches, ['a'], ouvre);
    expect(dates(r.taches[1])).toEqual(['2027-01-11', '2027-01-15']);
    expect(r.decalees).toEqual([{ id: 'b', jours: 5 }]);
  });

  it('se lisent strictement dans le calendrier et n’existent que sur demande', () => {
    expect(sanitizeCalendrierPlanning({ joursOuvres: true }).joursOuvres).toBe(true);
    expect(sanitizeCalendrierPlanning({ joursOuvres: 'oui' }).joursOuvres).toBeUndefined();
    expect(sanitizeCalendrierPlanning({}).joursOuvres).toBeUndefined();
    expect(estOuvreDuPlanning(undefined)('2027-01-09')).toBe(true);
    expect(estOuvreDuPlanning({ joursFeries: 'france', periodes: [] })('2027-01-09')).toBe(true);
    expect(estOuvreDuPlanning({ joursFeries: 'france', periodes: [], joursOuvres: true })('2027-01-09')).toBe(false);
    const planning = sanitizePlanning({ taches: [], calendrier: { joursFeries: 'france', periodes: [], joursOuvres: true } });
    expect(planning.calendrier?.joursOuvres).toBe(true);
  });
});
