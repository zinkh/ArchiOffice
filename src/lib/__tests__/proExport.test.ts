import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DPGF } from '../../types/dpgf';

const saveAsMock = vi.fn();
vi.mock('file-saver', () => ({ saveAs: saveAsMock }));

// jsPDF's Node build writes real files to disk on `.save(filename)` (it has no
// browser to trigger a download in, and `save` is set as an own instance
// property in the constructor, so it can't be spied on via the prototype) —
// override it post-construction so these tests don't litter the repo working
// directory with generated PDFs.
const { pdfSaveSpy } = vi.hoisted(() => ({ pdfSaveSpy: vi.fn() }));
vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  class TestJsPDF extends (actual as any).default {
    constructor(...args: any[]) {
      super(...args);
      (this as any).save = (...saveArgs: any[]) => { pdfSaveSpy(...saveArgs); return this; };
    }
  }
  return { ...actual, default: TestJsPDF };
});

const sampleDPGF: DPGF = {
  id: 'dpgf1',
  projectId: 'proj1',
  titre: 'DPGF Extension Dupont',
  version: '1',
  dateCreation: '2026-01-10T00:00:00Z',
  statut: 'draft',
  TVA: 20,
  totalHT: 15000,
  totalTTC: 18000,
  lots: [
    {
      id: 'lot1',
      numero: '01',
      titre: 'Gros œuvre',
      sousTotal: 10000,
      chapitres: [
        {
          id: 'chap1',
          numero: '01.1',
          titre: 'Fondations',
          lignes: [
            {
              id: 'l1',
              numero: '01.1.1',
              designation: 'Fouilles en rigole',
              unite: 'm3',
              quantite: 12,
              prixUnitaire: 80,
              prixTotal: 960,
              type: 'ouvrage',
            },
          ],
        },
      ],
    },
    {
      id: 'lot2',
      numero: '02',
      titre: 'Charpente',
      sousTotal: 5000,
      chapitres: [],
    },
  ],
};

beforeEach(() => {
  saveAsMock.mockClear();
  pdfSaveSpy.mockClear();
});

describe('exportDPGFtoExcel', () => {
  it('writes a non-empty xlsx blob via saveAs', async () => {
    const { exportDPGFtoExcel } = await import('../proExport');
    await exportDPGFtoExcel(sampleDPGF, 'Projet Dupont');

    expect(saveAsMock).toHaveBeenCalledTimes(1);
    const [blob, filename] = saveAsMock.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(filename).toBe('DPGF_DPGF_Extension_Dupont.xlsx');
  });
});

describe('DPGF sans prix : cadre de réponse pour les entreprises', () => {
  it('garde les colonnes P.U. et Total, vides, pour un import ultérieur dans l\'ACT', async () => {
    const { exportDPGFtoExcel } = await import('../proExport');
    await exportDPGFtoExcel(sampleDPGF, 'Projet', 'lot');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await saveAsMock.mock.calls[0][0].arrayBuffer());
    const lignes: unknown[][] = [];
    wb.worksheets[0].eachRow(r => lignes.push((r.values as unknown[]).slice(1)));
    const entete = lignes.find(l => l.includes('P.U. HT (€)'))!;
    expect(entete).toEqual(['N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)']);
    const poste = lignes.find(l => l.includes('01.1.1'))!;
    expect(poste[3]).toBe(12);
    expect(poste.slice(4).every(v => v == null || v === '')).toBe(true);
    expect(lignes.some(l => l.includes('TOTAL HT'))).toBe(false);
  });
});

describe('colonne TVA dédiée du DPGF', () => {
  const avecTauxDedie: DPGF = {
    ...sampleDPGF,
    lots: [{
      ...sampleDPGF.lots[0],
      chapitres: [{
        ...sampleDPGF.lots[0].chapitres[0],
        lignes: [
          { ...sampleDPGF.lots[0].chapitres[0].lignes[0], tva: 10 },
          { ...sampleDPGF.lots[0].chapitres[0].lignes[0], id: 'l2', numero: '01.1.2', tva: 5.5, prixTotal: 200 },
          { ...sampleDPGF.lots[0].chapitres[0].lignes[0], id: 'l3', numero: '01.1.3' },
        ],
      }],
    }],
  };

  const lireFeuille = async (opts: { avecPrix?: boolean; avecTva?: boolean }) => {
    const { exportDPGFtoExcel } = await import('../proExport');
    await exportDPGFtoExcel(avecTauxDedie, 'Projet', 'lot', {}, opts);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await saveAsMock.mock.calls[0][0].arrayBuffer());
    const lignes: unknown[][] = [];
    wb.worksheets[0].eachRow(r => lignes.push((r.values as unknown[]).slice(1)));
    return lignes;
  };

  it('reste absente par défaut, même avec les prix', async () => {
    const lignes = await lireFeuille({ avecPrix: true });
    expect(lignes.some(l => l.includes('TVA dédiée (€)'))).toBe(false);
  });

  it('ajoute taux et montant des seuls postes à taux dédié, avec leur total', async () => {
    const lignes = await lireFeuille({ avecPrix: true, avecTva: true });
    expect(lignes.some(l => l.includes('TVA dédiée (€)'))).toBe(true);
    const poste = lignes.find(l => l.includes('01.1.1'))!;
    expect(poste.slice(-2)).toEqual([10, 96]);
    const sans = lignes.find(l => l.includes('01.1.3'))!;
    expect(sans.slice(6).every(v => v == null || v === '')).toBe(true);
    // Une ligne de calcul par taux (base, taux, montant), puis le total.
    const t55 = lignes.find(l => l.includes('TVA 5,5 %'))!;
    expect(t55.slice(-3)).toEqual([200, 5.5, 11]);
    const t10 = lignes.find(l => l.includes('TVA 10 %'))!;
    expect(t10.slice(-3)).toEqual([960, 10, 96]);
    const total = lignes.find(l => l.includes('TOTAL TVA dédiée'))!;
    expect(total[total.length - 1]).toBeCloseTo(107, 5);
  });

  it("n'ajoute rien sans les prix", async () => {
    const lignes = await lireFeuille({ avecPrix: false, avecTva: true });
    expect(lignes.some(l => l.includes('TVA dédiée (€)'))).toBe(false);
  });

  it('génère le PDF avec la colonne', async () => {
    const { exportDPGFtoPDF } = await import('../proExport');
    await exportDPGFtoPDF(avecTauxDedie, 'Projet', 'lot', {}, { avecPrix: true, avecTva: true });
    expect(pdfSaveSpy).toHaveBeenCalledTimes(1);
  });
});

describe('exportEstimationtoExcel', () => {
  it('writes a non-empty xlsx blob with a Détail and Récapitulatif sheet', async () => {
    const { exportEstimationtoExcel } = await import('../proExport');
    await exportEstimationtoExcel(sampleDPGF, 'Projet Dupont');

    expect(saveAsMock).toHaveBeenCalledTimes(1);
    const [blob, filename] = saveAsMock.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(filename).toBe('Estimation_DPGF_Extension_Dupont.xlsx');
  });
});

describe('exportDPGFtoPDF / exportEstimationtoPDF', () => {
  it('builds a PDF and calls save() with the expected filename, without touching disk', async () => {
    const { exportDPGFtoPDF, exportEstimationtoPDF } = await import('../proExport');
    await exportDPGFtoPDF(sampleDPGF, 'Projet Dupont');
    await exportEstimationtoPDF(sampleDPGF, 'Projet Dupont');

    expect(pdfSaveSpy).toHaveBeenCalledTimes(2);
    expect(pdfSaveSpy.mock.calls[0][0]).toBe('DPGF_DPGF_Extension_Dupont.pdf');
    expect(pdfSaveSpy.mock.calls[1][0]).toBe('Estimation_DPGF_Extension_Dupont.pdf');
  });
});
