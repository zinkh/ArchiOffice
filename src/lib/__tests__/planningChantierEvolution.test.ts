import { describe, expect, it } from 'vitest';
import { AFFICHAGE_PLANNING, ajouterMois, appliquerGeneration, cycleDependances, incoherencesDependances, periodesPlanning, positionPlanning, sanitizeAffichage, sanitizePlanning, semaineIso, type TachePlanning } from '../planningChantier';
import { exportPlanningChantierXml } from '../planningChantierXml';
import { parsePlanningXml } from '../projectPlanningXml';
import { planningXmlParser } from '../projectPlanningXmlShared';
import { construireLegende, couleursParCle, couleursPlanning } from '../reserveCouleurs';
import type { Project } from '../../types';

const a: TachePlanning = { id: 'a', lotId: 'l1', libelle: 'Fondations & béton', debut: '2026-12-30', fin: '2027-01-03', avancement: 45, source: 'manuel' };
const b: TachePlanning = { ...a, id: 'b', lotId: 'l2', libelle: 'Charpente', debut: '2027-01-04', fin: '2027-01-04', avancement: 0, dependencies: ['a'] };
const j: TachePlanning = { ...b, id: 'j', lotId: '', libelle: 'Réception', debut: '2027-01-05', fin: '2027-01-05', jalon: true, dependencies: ['b'] };
const lots = [{ id: 'l1', lot_number: '01', lot_title: 'GO', contact_name: 'Martin' }, { id: 'l2', lot_number: '02', lot_title: 'Bois', contact_name: 'MARTIN' }];
const planning = sanitizePlanning({ taches: [a, b, j] });

describe('calendrier du chantier', () => {
  it('numérote les semaines ISO à cheval sur deux années', () => {
    expect(semaineIso('2021-01-01')).toBe('2020-S53');
    expect(semaineIso('2024-12-30')).toBe('2025-S01');
    expect(semaineIso('2027-01-03')).toBe('2026-S53');
  });
  it('ancre S1 exactement au premier jour, sans lundi implicite ni DST', () => {
    const p = periodesPlanning('2026-03-25', '2026-04-09', { ...AFFICHAGE_PLANNING, relatif: true });
    expect(p.map(x => [x.debut, x.libelle])).toEqual([['2026-03-25', 'S1'], ['2026-04-01', 'S2'], ['2026-04-08', 'S3']]);
    expect(positionPlanning('2026-03-29', p)).toBeCloseTo(4 / 7);
  });
  it('conserve le jour de référence pour les mois courts et bissextiles', () => {
    expect(ajouterMois('2024-01-31', 1)).toBe('2024-02-29');
    const p = periodesPlanning('2024-01-31', '2024-04-01', { ...AFFICHAGE_PLANNING, relatif: true, echelle: 'mois' });
    expect(p.map(x => x.debut)).toEqual(['2024-01-31', '2024-02-29', '2024-03-31']);
    expect(p.map(x => x.libelle)).toEqual(['M1', 'M2', 'M3']);
    expect(positionPlanning('2024-03-31', p)).toBe(2);
  });
  it('répare des préférences obsolètes ou malformées', () => {
    expect(sanitizeAffichage({ echelle: 'jour', replies: [null, 'l1'] })).toEqual({ ...AFFICHAGE_PLANNING, replies: ['l1'] });
  });
});

describe('dépendances', () => {
  it('garde des identifiants uniques même en cas de collision avec un identifiant de repli', () => {
    const p = sanitizePlanning({ taches: [{ ...a, id: 't-2-1' }, { ...b, id: '' }] });
    expect(new Set(p.taches.map(t => t.id)).size).toBe(2);
  });
  it('conserve les prédécesseurs après sérialisation et relecture', () => {
    expect(sanitizePlanning(JSON.parse(JSON.stringify(planning)))).toEqual(planning);
    expect(planning.taches[1].dependencies).toEqual(['a']);
    expect(cycleDependances(planning.taches)).toBe(false);
  });
  it('détecte cycles indirects et liens vers soi-même et assainit les anciennes données', () => {
    expect(cycleDependances([{ id: 'a', dependencies: ['a'] }])).toBe(true);
    const taches = [{ ...a, dependencies: ['j'] }, b, j];
    expect(cycleDependances(taches)).toBe(true);
    expect(cycleDependances(sanitizePlanning({ taches }).taches)).toBe(false);
  });
  it('nettoie après suppression et remplacement IA', () => {
    expect(sanitizePlanning({ taches: [b, j] }).taches[0].dependencies).toBeUndefined();
    const actuel = sanitizePlanning({ taches: [{ ...a, source: 'ia' }, b, j] });
    const regen = appliquerGeneration(actuel, { taches: [{ ...a, id: 'nouveau' }], hypotheses: [], ecartees: 0 }, new Set(['l1']), { garderManuel: true });
    expect(regen.taches.find(t => t.id === 'b')?.dependencies).toBeUndefined();
    expect(regen.taches.find(t => t.id === 'j')?.dependencies).toEqual(['b']);
  });
  it('signale le chevauchement inclusif, sans décaler les dates', () => {
    const t = { ...b, debut: a.fin };
    expect(incoherencesDependances([a, t])).toHaveLength(1);
    expect(t.debut).toBe(a.fin);
    expect(incoherencesDependances(planning.taches)).toEqual([]);
  });
});

it('réutilise la table AOR, y compris normalisation entreprise et repli lot', () => {
  const aor = Object.fromEntries(couleursParCle(construireLegende([{ entreprises: ['Autre'] }, { entreprises: ['Martin'] }])));
  const couleurs = couleursPlanning(lots, aor);
  expect(couleurs.get('l1')).toBe(aor['e:martin']);
  expect(couleurs.get('l2')).toBe(couleurs.get('l1'));
});

for (const format of ['msproject', 'ganttproject'] as const) describe(`XML chantier ${format}`, () => {
  const xml = exportPlanningChantierXml({ id: 'p', name: 'École & gymnase' } as Project, planning, lots, format);
  const parsed = parsePlanningXml(xml);
  it('relit noms, dates, avancement, jalons et dépendances dans les importeurs existants', () => {
    expect(parsed.tasks).toHaveLength(6); // trois groupes, trois interventions
    const aa = parsed.tasks.find(t => t.title === a.libelle)!;
    const bb = parsed.tasks.find(t => t.title === b.libelle)!;
    const jj = parsed.tasks.find(t => t.title === j.libelle)!;
    expect(aa).toMatchObject({ start_date: a.debut, end_date: a.fin, progress: 45, milestone: false });
    expect(bb).toMatchObject({ dependencies: [aa.sourceId], milestone: false });
    expect(jj).toMatchObject({ dependencies: [bb.sourceId], milestone: true, start_date: j.debut, end_date: j.fin });
    expect(new Set(parsed.tasks.map(t => t.sourceId)).size).toBe(parsed.tasks.length);
  });
  it('encode une structure hiérarchique', () => {
    const root = planningXmlParser.parse(xml);
    if (format === 'ganttproject') {
      expect(root.project.tasks.task[0].task).toBeDefined();
      expect(root.project.calendars['day-types']['default-week']['@_sun']).toBe('0');
      expect(root.project.tasks['@_empty-milestones']).toBe('true');
    } else {
      expect(root.Project.Tasks.Task.map((t: any) => t.OutlineLevel)).toEqual(['1', '2', '1', '2', '1', '2']);
      expect(root.Project.Calendars.Calendar.WeekDays.WeekDay).toHaveLength(7);
    }
  });
});


it('relit également les jalons natifs GanttProject (attribut meeting)', () => {
  const parsed = parsePlanningXml('<project><tasks><task id="1" name="Réception" start="2027-01-18" duration="0" meeting="true" /></tasks></project>');
  expect(parsed.tasks[0]).toMatchObject({ milestone: true, start_date: '2027-01-18', end_date: '2027-01-18' });
});
