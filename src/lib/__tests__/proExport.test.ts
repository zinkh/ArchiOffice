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

describe('article à sous-articles dans l\'export du DPGF', () => {
  const base = sampleDPGF.lots[0].chapitres[0].lignes[0];
  const avecEnfants: DPGF = {
    ...sampleDPGF,
    lots: [{
      ...sampleDPGF.lots[0],
      chapitres: [{
        ...sampleDPGF.lots[0].chapitres[0],
        lignes: [{
          ...base, id: 'p', numero: '01.1.1', designation: 'Cuisine', unite: 'forf', quantite: 1,
          children: [{ ...base, id: 'e1', numero: '01.1.1.1', unite: 'u', quantite: 2 }],
        }],
      }],
    }],
  };

  it("n'affiche ni unité ni quantité sur le parent, et les garde sur ses enfants (Excel)", async () => {
    const { exportDPGFtoExcel } = await import('../proExport');
    await exportDPGFtoExcel(avecEnfants, 'Projet', 'lot', {}, { avecPrix: true });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await saveAsMock.mock.calls[0][0].arrayBuffer());
    const lignes: unknown[][] = [];
    wb.worksheets[0].eachRow(r => lignes.push((r.values as unknown[]).slice(1)));
    const parent = lignes.find(l => l[0] === '01.1.1')!;
    const enfant = lignes.find(l => l[0] === '01.1.1.1')!;
    expect(parent[2] == null || parent[2] === '').toBe(true);
    expect(parent[3] == null || parent[3] === '').toBe(true);
    expect(enfant[2]).toBe('u');
    expect(enfant[3]).toBe(2);
  });

  it('montre la somme de ses enfants, signalée comme sous-total, sans prix unitaire (Excel)', async () => {
    const { exportDPGFtoExcel } = await import('../proExport');
    await exportDPGFtoExcel(avecEnfants, 'Projet', 'lot', {}, { avecPrix: true });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await saveAsMock.mock.calls[0][0].arrayBuffer());
    const lignes: unknown[][] = [];
    wb.worksheets[0].eachRow(r => lignes.push((r.values as unknown[]).slice(1)));
    const parent = lignes.find(l => l[0] === '01.1.1')!;
    expect(String(parent[1])).toContain('(sous-total)');
    expect(parent[4] == null || parent[4] === '').toBe(true);
    expect(parent[5]).toBe(base.prixTotal);
  });

  it("n'écrit pas le prix saisi sur le parent : seule la somme de ses enfants compte", async () => {
    const { exportDPGFtoExcel } = await import('../proExport');
    const perime: DPGF = {
      ...avecEnfants,
      lots: [{ ...avecEnfants.lots[0], chapitres: [{ ...avecEnfants.lots[0].chapitres[0], lignes: [
        { ...avecEnfants.lots[0].chapitres[0].lignes[0], prixUnitaire: 6200, prixTotal: 6200 },
      ] }] }],
    };
    await exportDPGFtoExcel(perime, 'Projet', 'lot', {}, { avecPrix: true });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await saveAsMock.mock.calls[0][0].arrayBuffer());
    const lignes: unknown[][] = [];
    wb.worksheets[0].eachRow(r => lignes.push((r.values as unknown[]).slice(1)));
    expect(lignes.find(l => l[0] === '01.1.1')![5]).toBe(base.prixTotal);
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

describe("export PDF de l'estimation", () => {
  const l = (id: string, numero: string, designation: string, quantite: number, prixUnitaire: number, extra: Record<string, unknown> = {}) => ({
    id, numero, designation, unite: 'm2', quantite, prixUnitaire, prixTotal: quantite * prixUnitaire, type: 'ouvrage' as const, ...extra,
  });
  const estimation: DPGF = {
    ...sampleDPGF, TVA: 20, totalHT: 12043.17, totalTTC: 14451.8,
    lots: [{
      id: 'lot', numero: '01', titre: 'Démolition', sousTotal: 12043.17,
      chapitres: [{
        id: 'chap', numero: '1', titre: 'Dépose', lignes: [
          l('a', '1.1', 'Dépose cloisons', 1, 12043.17),
          l('b', '1.2', 'Désamiantage extérieur', 1, 4350, { nature: 'option' }),
        ],
      }],
    }],
  };

  /** Le flux du PDF (texte non compressé), lu octet par octet comme latin1 : un U+202F y apparaîtrait en UTF-8. */
  const lirePdf = async (detaille: boolean) => {
    const { exportEstimationtoPDF } = await import('../proExport');
    let fichier: Blob | undefined;
    await exportEstimationtoPDF(estimation, 'Projet', {}, (_nom, blob) => { fichier = blob; }, { detaille });
    return Buffer.from(await fichier!.arrayBuffer()).toString('latin1');
  };

  it('écrit les milliers avec une espace insécable que le PDF sait afficher, jamais une espace fine', async () => {
    const flux = await lirePdf(false);
    expect(flux).toContain('12\u00a0043,17');
    expect(flux).not.toContain('\u00e2\u0080\u00af');
  });

  it("détaille les options à la suite du récapitulatif, sans lister les postes de base", async () => {
    const flux = await lirePdf(false);
    expect(flux).toContain('samiantage ext');
    expect(flux).not.toContain('pose cloisons');
  });

  it('exporte poste par poste quand le réglage est actif : postes de base, puis options détaillées', async () => {
    const flux = await lirePdf(true);
    expect(flux).toContain('pose cloisons');
    expect(flux).toContain('samiantage ext');
    expect(flux).toContain('poste par poste');
  });
});

describe("export Excel de l'estimation : options détaillées", () => {
  const l = (id: string, numero: string, designation: string, quantite: number, prixUnitaire: number, extra: Record<string, unknown> = {}) => ({
    id, numero, designation, unite: 'm2', quantite, prixUnitaire, prixTotal: quantite * prixUnitaire, type: 'ouvrage' as const, ...extra,
  });
  const estimation: DPGF = {
    ...sampleDPGF, TVA: 20, totalHT: 1500, totalTTC: 1800,
    lots: [{
      id: 'lot', numero: '01', titre: 'Démolition', sousTotal: 1500,
      chapitres: [{
        id: 'chap', numero: '1', titre: 'Dépose', lignes: [
          l('a', '1.1', 'Dépose cloisons', 10, 100),
          l('p', '1.2', 'Cuisine', 1, 0, { prixTotal: 0, children: [l('p1', '1.2.1', 'Plonge', 1, 500)] }),
          l('b', '1.3', 'Désamiantage extérieur', 1, 4350, { nature: 'option' }),
        ],
      }],
    }],
  };
  const lireFeuilles = async () => {
    const { exportEstimationtoExcel } = await import('../proExport');
    await exportEstimationtoExcel(estimation, 'Projet');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await saveAsMock.mock.calls[0][0].arrayBuffer());
    const feuille = (nom: string) => {
      const lignes: unknown[][] = [];
      wb.getWorksheet(nom)?.eachRow(r => lignes.push((r.values as unknown[]).slice(1)));
      return lignes;
    };
    return { noms: wb.worksheets.map(w => w.name), feuille };
  };

  it("ajoute une feuille qui détaille les options, avec leur total", async () => {
    const { noms, feuille } = await lireFeuilles();
    expect(noms).toContain('Options et variantes');
    const options = feuille('Options et variantes');
    const poste = options.find(r => r[0] === '1.3')!;
    expect(poste[5]).toBe(4350);
    const total = options.find(r => String(r[1]).startsWith('Options HT'))!;
    expect(total[5]).toBe(4350);
  });

  it('le détail ne compte que les postes de base, sous-articles compris, parent en somme de ses enfants', async () => {
    const { feuille } = await lireFeuilles();
    const detail = feuille('Détail');
    expect(detail.some(r => r[0] === '1.3')).toBe(false);
    expect(detail.find(r => r[0] === '1.2.1')![5]).toBe(500);
    const parent = detail.find(r => r[0] === '1.2')!;
    expect(parent[5]).toBe(500);
    expect(String(parent[1])).toContain('(sous-total)');
  });

  it("n'ajoute pas de feuille d'options quand il n'y en a pas", async () => {
    const { exportEstimationtoExcel } = await import('../proExport');
    await exportEstimationtoExcel({ ...estimation, lots: [{ ...estimation.lots[0], chapitres: [{ ...estimation.lots[0].chapitres[0], lignes: [estimation.lots[0].chapitres[0].lignes[0]] }] }] }, 'Projet');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await saveAsMock.mock.calls[0][0].arrayBuffer());
    expect(wb.worksheets.map(w => w.name)).not.toContain('Options et variantes');
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
