import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DPGF } from '../../types/dpgf';
import type { BPU } from '../../types/bpu';

const appels: Array<{ fn: string; lots: string[]; args: unknown[] }> = [];
const faux = (fn: string, rangLots = 0) => vi.fn(async (...args: any[]) => {
  const doc = args[0];
  appels.push({ fn, lots: doc.lots.map((l: any) => l.numero), args });
  const opts = args[args.length - 1];
  await opts?.sortie?.(`${fn}.bin`, new Blob(['x']));
});

vi.mock('../proExport', () => ({
  exportDPGFtoPDF: faux('dpgf-pdf'), exportDPGFtoExcel: faux('dpgf-xlsx'),
  exportEstimationtoPDF: vi.fn(async (doc: any, _n: any, _s: any, sortie: any) => { appels.push({ fn: 'est-pdf', lots: doc.lots.map((l: any) => l.numero), args: [] }); await sortie('est.pdf', new Blob(['x'])); }),
  exportEstimationtoExcel: vi.fn(),
}));
vi.mock('../cctpExport', () => ({
  exportCctpPdf: vi.fn(async (doc: any, opts: any) => { appels.push({ fn: `cctp-pdf-${opts.batiment?.code ?? 'all'}`, lots: doc.lots.map((l: any) => l.numero), args: [] }); await opts.sortie(`cctp-${opts.batiment?.code ?? 'all'}.pdf`, new Blob(['x'])); }),
  exportCctpDocx: vi.fn(),
}));
vi.mock('../bpuExport', () => ({
  exportBPUtoPDF: vi.fn(async (bpu: any, opts: any) => { appels.push({ fn: `bpu-pdf-${opts.mode}-${opts.vierge}`, lots: bpu.lots.map((l: any) => l.numero), args: [] }); await opts.sortie('bpu.pdf', new Blob(['x'])); }),
  exportBPUtoExcel: vi.fn(),
}));

const ligne = (id: string) => ({ id, numero: id, designation: id, unite: 'u', quantite: 1, prixUnitaire: 1, prixTotal: 1, type: 'article' });
const lot = (n: string, extra = {}) => ({ id: n, numero: n, titre: n, sousTotal: 0, chapitres: [{ id: `c${n}`, numero: '1', titre: 'c', lignes: [ligne(`a${n}`)] }], ...extra });

const dpgf = {
  id: 'd', titre: 'DPGF', version: 1, TVA: 20, totalHT: 0, totalTTC: 0, multiBatiments: true,
  batiments: [{ id: 'A', code: 'A', libelle: '', ordre: 1 }, { id: 'B', code: 'B', libelle: '', ordre: 2 }],
  lots: [lot('01', { batimentId: 'A' }), lot('02', { batimentId: 'B' })],
} as unknown as DPGF;
const bpu = { id: 'b', titre: 'BPU', version: '1', TVA: 20, totalHT: 0, totalTTC: 0, tranches: [], lots: [lot('01'), lot('02')] } as unknown as BPU;

const base = { dpgf, bpu, selection: { lotNumeros: null, batimentCodes: null, phaseCodes: null }, avecPrix: false, cctpParBatiment: false, settings: {} };

beforeEach(() => { appels.length = 0; });

describe('produireDossier', () => {
  it('produit un fichier par document et format coché', async () => {
    const { produireDossier } = await import('../exportDossier');
    const r = await produireDossier({ ...base, documents: { cctp: 'pdf', dpgf: 'pdf', bpu: 'pdf' } });
    expect(r.fichiers.map(f => f.nom)).toEqual(['cctp-all.pdf', 'dpgf-pdf.bin', 'bpu.pdf']);
  });

  it('applique le même périmètre à tous les documents', async () => {
    const { produireDossier } = await import('../exportDossier');
    await produireDossier({ ...base, selection: { ...base.selection, lotNumeros: ['02'] }, documents: { cctp: 'pdf', dpgf: 'pdf', dqe: 'pdf' } });
    expect(appels.every(a => a.lots.join() === '02')).toBe(true);
    expect(appels).toHaveLength(3);
  });

  it('exporte sans prix par défaut et avec prix sur demande', async () => {
    const { produireDossier } = await import('../exportDossier');
    await produireDossier({ ...base, documents: { dpgf: 'pdf', bpu: 'pdf' } });
    expect(appels.find(a => a.fn === 'dpgf-pdf')!.args[4]).toMatchObject({ avecPrix: false });
    expect(appels.find(a => a.fn.startsWith('bpu'))!.fn).toBe('bpu-pdf-bpu-true');
    appels.length = 0;
    await produireDossier({ ...base, avecPrix: true, documents: { dpgf: 'pdf', bpu: 'pdf' } });
    expect(appels.find(a => a.fn === 'dpgf-pdf')!.args[4]).toMatchObject({ avecPrix: true });
    expect(appels.find(a => a.fn.startsWith('bpu'))!.fn).toBe('bpu-pdf-bpu-false');
  });

  it('produit un CCTP par bâtiment retenu', async () => {
    const { produireDossier } = await import('../exportDossier');
    const r = await produireDossier({ ...base, selection: { ...base.selection, batimentCodes: ['B'] }, documents: { cctp: 'pdf' } });
    expect(r.fichiers.map(f => f.nom)).toEqual(['cctp-B.pdf']);
  });

  it('signale un document sans article dans le périmètre', async () => {
    const { produireDossier } = await import('../exportDossier');
    const r = await produireDossier({ ...base, selection: { ...base.selection, lotNumeros: ['99'] }, documents: { dpgf: 'pdf' } });
    expect(r.fichiers).toHaveLength(0);
    expect(r.avertissements).toEqual([{ code: 'vide', document: 'dpgf' }]);
  });

  it('compte les fichiers de la demande', async () => {
    const { compterFichiers } = await import('../exportDossier');
    expect(compterFichiers({ dpgf, selection: base.selection, cctpParBatiment: true, documents: { cctp: 'both', dpgf: 'pdf' } })).toBe(5);
  });
});

describe('livrer', () => {
  it('nomsUniques rend uniques les noms identiques', async () => {
    const { nomsUniques } = await import('../exportSortie');
    const b = new Blob(['x']);
    expect(nomsUniques([{ nom: 'a.pdf', blob: b }, { nom: 'a.pdf', blob: b }]).map(f => f.nom)).toEqual(['a.pdf', 'a (2).pdf']);
  });
});
