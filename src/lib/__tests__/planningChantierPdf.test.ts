import { describe, expect, it, vi } from 'vitest';
import { AFFICHAGE_PLANNING, sanitizePlanning } from '../planningChantier';
import { exportPlanningToPDF } from '../planningChantierPdf';
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

});
