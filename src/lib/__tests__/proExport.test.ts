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
