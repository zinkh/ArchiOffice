import { describe, expect, it, vi } from 'vitest';
import { AFFICHAGE_PLANNING, periodesPlanning, sanitizePlanning } from '../planningChantier';
import { bandesAxePlanning, exportPlanningToPDF, periodesDansPlage, tacheDansPlage } from '../planningChantierPdf';
import type { AgencySettings } from '../proposalExport';
const capture = vi.hoisted(() => ({ textes: [] as string[], couleurs: [] as unknown[][], rectangles: [] as number[][] }));
vi.mock('../pdfLetterhead', () => ({ drawAgencyHeader: () => 30, drawAgencyFooters: vi.fn(), loadLogoDataUrl: async () => null }));
vi.mock('jspdf', async original => {
  const { default: RealPdf } = await original<typeof import('jspdf')>();
  return { default: class {
    constructor(options: any) {
      const doc = new RealPdf(options);
      const text = doc.text.bind(doc);
      const rect = doc.rect.bind(doc);
      doc.rect = ((...args: any[]) => { capture.rectangles.push(args.slice(0, 4)); return (rect as any)(...args); }) as any;
      const color = doc.setFillColor.bind(doc);
      doc.text = ((value: any, ...args: any[]) => { capture.textes.push(...(Array.isArray(value) ? value : [value])); return (text as any)(value, ...args); }) as any;
      doc.setFillColor = ((...args: any[]) => { capture.couleurs.push(args); return (color as any)(...args); }) as any;
      return doc;
    }
  } };
});
const planning = sanitizePlanning({ taches: [
  { id: 'g', libelle: 'Installation', debut: '2026-12-30', fin: '2027-01-02' },
  { id: 'a', lotId: 'lot', libelle: 'Fondations', debut: '2027-01-03', fin: '2027-01-09', avancement: 35, dependencies: ['g'] },
] });
const lots = [{ id: 'lot', lot_number: '01', lot_title: 'GO' }];
describe('périmètre PDF du chantier', () => {
  it('exporte les tâches repliées, masque seulement les générales, conserve origine et couleurs', async () => {
    capture.textes.length = 0; capture.couleurs.length = 0;
    const pdf = await exportPlanningToPDF(planning, lots, {} as AgencySettings, {
      project: { name: 'École' }, couleurs: new Map([['lot', '#dc2626']]),
      affichage: { ...AFFICHAGE_PLANNING, relatif: true, echelle: 'mois', generales: false, replies: ['lot'] },
    });
    expect(pdf.blob.size).toBeGreaterThan(1000);
    expect(capture.textes.join('\n')).toContain('Fondations');
    expect(capture.textes.join('\n')).not.toContain('Tâches générales du chantier');
    expect(capture.textes.join('\n')).toContain('Origine S1 / M1 : 2026-12-30');
    expect(capture.textes).toContain('M1');
    expect(capture.textes.join('\n')).toContain('prédécesseur hors périmètre');
    expect(capture.couleurs).toContainEqual([220, 38, 38]);
  });
  it('porte les numéros ISO et toutes les tâches dans le mode complet', async () => {
    capture.textes.length = 0;
    await exportPlanningToPDF(planning, lots, {} as AgencySettings, { project: { name: 'École' } });
    expect(capture.textes).toContain('2026-S53');
    expect(capture.textes).toContain('2027-S01');
    expect(capture.textes.join('\n')).toContain('Tâches générales du chantier');
    expect(capture.textes.join('\n')).toContain('Installation');
  });
  it('masque les pourcentages et le réalisé, et applique la largeur des libellés au PDF', async () => {
    capture.textes.length = 0; capture.couleurs.length = 0; capture.rectangles.length = 0;
    await exportPlanningToPDF(planning, lots, {} as AgencySettings, { project: { name: 'École' },
      affichage: { ...AFFICHAGE_PLANNING, relatif: true, echelle: 'mois', avancement: false, largeurLibelles: 560 } });
    expect(capture.textes.join(' ')).not.toMatch(/35 %|Réalisé/);
    expect(capture.couleurs).not.toContainEqual([45, 45, 45]);
    expect(capture.rectangles.some(([x]) => x === 152)).toBe(true);
    expect(capture.textes.join(' ')).toContain('Fondations');
  });
  it('représente les fériés et congés configurés, et respecte leur masquage', async () => {
    const avecCalendrier = { ...planning, calendrier: { joursFeries: 'france' as const, periodes: [{ id: 'h', libelle: 'Fermeture de fin d’année', debut: '2026-12-31', fin: '2027-01-03', type: 'conge' as const }] } };
    capture.textes.length = 0; capture.couleurs.length = 0;
    await exportPlanningToPDF(avecCalendrier, lots, {} as AgencySettings, { project: { name: 'École' } });
    expect(capture.textes.join(' ')).toContain('Jour de l’an');
    expect(capture.textes.join(' ')).toContain('Fermeture de fin d’année');
    expect(capture.couleurs).toContainEqual([225, 236, 250]);
    capture.textes.length = 0; capture.couleurs.length = 0;
    await exportPlanningToPDF(avecCalendrier, lots, {} as AgencySettings, { project: { name: 'École' }, affichage: { ...AFFICHAGE_PLANNING, joursFeries: false, conges: false } });
    expect(capture.textes.join(' ')).not.toContain('Fermeture de fin d’année');
    expect(capture.textes.join(' ')).not.toContain('Jour de l’an');
    expect(capture.couleurs).not.toContainEqual([225, 236, 250]);
  });

  it('pose un bandeau mois ou année, le repère Aujourd’hui et une légende qui suit le contenu', async () => {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const enCours = sanitizePlanning({ taches: [{ id: 'a', lotId: 'lot', libelle: 'Fondations', debut: aujourdhui, fin: aujourdhui }] });
    capture.textes.length = 0;
    await exportPlanningToPDF(enCours, lots, {} as AgencySettings, { project: { name: 'École' } });
    expect(capture.textes.join(' ')).toMatch(/janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre/);
    expect(capture.textes).toContain('Aujourd’hui');
    expect(capture.textes).toContain('Prévu');
    expect(capture.textes).toContain('Jalon');
    expect(capture.textes).not.toContain('Jour férié');
    capture.textes.length = 0;
    await exportPlanningToPDF(enCours, lots, {} as AgencySettings, { project: { name: 'École' }, affichage: { ...AFFICHAGE_PLANNING, relatif: true } });
    expect(capture.textes.join(' ')).not.toMatch(/janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre/);
  });

  it('prépare une page A3 et limite le document à la plage choisie', async () => {
    capture.textes.length = 0;
    await exportPlanningToPDF(planning, lots, {} as AgencySettings, { project: { name: 'École' }, format: 'a3', plage: { debut: '2027-01-04' } });
    const texte = capture.textes.join('\n');
    expect(texte).toContain('Période imprimée : du 04/01/2027 jusqu’à la fin');
    expect(texte).toContain('Fondations');
    // La tâche générale n'est plus imprimée ; elle reste citée comme prédécesseur hors périmètre.
    expect(texte).not.toContain('Tâches générales du chantier');
    expect(texte).toContain('Installation -> Fondations (prédécesseur hors périmètre)');
    expect(texte).not.toContain('2026-S53');
    capture.textes.length = 0;
    await exportPlanningToPDF(planning, lots, {} as AgencySettings, { project: { name: 'École' }, plage: { debut: '2030-01-01' } });
    expect(capture.textes.join('\n')).toContain('Aucune tâche planifiée sur cette période.');
  });
});

describe('lot qui déborde sur la page suivante', () => {
  it('rappelle le lot en tête de page et ne laisse pas un titre de lot seul en bas', async () => {
    const taches = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, lotId: 'lot', libelle: `Tâche ${i + 1}`, debut: '2027-01-04', fin: '2027-01-08' }));
    capture.textes.length = 0;
    await exportPlanningToPDF(sanitizePlanning({ taches }), lots, {} as AgencySettings, { project: { name: 'École' } });
    expect(capture.textes.filter(t => t === 'Lot 01  GO (suite)').length).toBeGreaterThanOrEqual(1);
    expect(capture.textes.filter(t => t === 'Lot 01  GO')).toHaveLength(1);
  });
});

describe('axe du PDF chantier', () => {
  it('regroupe les semaines par mois du jeudi, les mois par année, rien en relatif', () => {
    const semaines = periodesPlanning('2026-12-28', '2027-01-20', AFFICHAGE_PLANNING);
    expect(bandesAxePlanning(semaines, AFFICHAGE_PLANNING).map(b => b.libelle)).toEqual(['décembre 2026', 'janvier 2027']);
    const mois = periodesPlanning('2026-11-05', '2027-02-10', { ...AFFICHAGE_PLANNING, echelle: 'mois' });
    expect(bandesAxePlanning(mois, { ...AFFICHAGE_PLANNING, echelle: 'mois' }).map(b => [b.libelle, b.debut, b.fin])).toEqual([['2026', 0, 2], ['2027', 2, 4]]);
    expect(bandesAxePlanning(semaines, { ...AFFICHAGE_PLANNING, relatif: true })).toEqual([]);
  });
  it('garde la numérotation du planning complet quand une plage est imprimée', () => {
    const toutes = periodesPlanning('2026-12-30', '2027-02-20', { ...AFFICHAGE_PLANNING, relatif: true });
    const plage = periodesDansPlage(toutes, { debut: '2027-01-20' });
    expect(plage[0].libelle).toBe('S4');
    expect(tacheDansPlage({ debut: '2027-01-01', fin: '2027-01-10' }, { debut: '2027-01-11' })).toBe(false);
    expect(tacheDansPlage({ debut: '2027-01-01', fin: '2027-01-11' }, { debut: '2027-01-11' })).toBe(true);
  });
});
