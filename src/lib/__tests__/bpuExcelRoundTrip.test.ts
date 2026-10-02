import { describe, expect, it, vi } from 'vitest';
import type { BPU } from '../../types/bpu';

const { saveAsMock } = vi.hoisted(() => ({ saveAsMock: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: saveAsMock }));

import { exportBPUtoExcel, SHEET_META } from '../bpuExport';
import { parseOffreFile } from '../bpuImport';

const art = (id: string, numero: string, q: number, pu: number, extra: any = {}) => ({
  id, numero, designation: `Article ${numero}`, unite: 'm2',
  quantite: q, prixUnitaire: pu, prixTotal: q * pu, type: 'ouvrage' as const,
  refBpu: id.toUpperCase(), ...extra,
});

const bpu: BPU = {
  id: 'b1', projectId: 'p1', titre: 'BPU', version: '1.0',
  dateCreation: '2026-01-01', statut: 'draft',
  marche: { typeMarche: 'bons_de_commande', montantMiniHT: 10000, montantMaxiHT: 100000 },
  tranches: [], prixEnLettres: false, totalHT: 1500, TVA: 20, totalTTC: 1800,
  lots: [{
    id: 'lot1', numero: '01', titre: 'Gros œuvre', sousTotal: 1500,
    chapitres: [{
      id: 'c1', numero: '01.1', titre: 'Fondations',
      lignes: [art('a1', '01.1.1', 10, 100), art('a2', '01.1.2', 5, 100)],
    }],
  }],
};

const settings = { agencyName: 'AAZS', address: '23 Bd de l’Europe', siret: '102 663 416 00018' } as any;

async function exporter(over: { mode: 'bpu' | 'dqe'; vierge: boolean }) {
  saveAsMock.mockClear();
  await exportBPUtoExcel(bpu, { ...over, projectName: 'Villa Martin', settings });
  const [blob] = saveAsMock.mock.calls[0];
  return new File([await (blob as Blob).arrayBuffer()], 'x.xlsx');
}

describe('BPU/DQE Excel avec la charte du cabinet', () => {
  it('reste relu par l\'import : en-tête du cabinet au-dessus, mêmes prix en dessous', async () => {
    const fichier = await exporter({ mode: 'dqe', vierge: false });
    const res = await parseOffreFile(fichier, bpu as any);
    expect(res.meta.correspond).toBe(true);
    expect(res.meta.bpuId).toBe('b1');
    expect(res.rapprochements.length).toBe(2);
    expect(res.rapprochements.map(r => r.prixUnitaire)).toEqual([100, 100]);
    expect(res.rapprochements.every(r => r.method === 'ref')).toBe(true);
    expect(res.totalOffreHT).toBe(1500);
  });

  it('un bordereau vierge reste importable, prix à renseigner', async () => {
    const fichier = await exporter({ mode: 'bpu', vierge: true });
    const res = await parseOffreFile(fichier, bpu as any);
    expect(res.meta.correspond).toBe(true);
    expect(res.rapprochements.map(r => r.method)).toEqual(['ref', 'ref']);
    expect(res.rapprochements.every(r => r.prixUnitaire === null)).toBe(true);
  });

  it('garde la feuille technique masquée', async () => {
    saveAsMock.mockClear();
    await exportBPUtoExcel(bpu, { mode: 'bpu', vierge: false, settings });
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    await wb.xlsx.load(await (saveAsMock.mock.calls[0][0] as Blob).arrayBuffer() as any);
    expect(wb.getWorksheet(SHEET_META)?.state).toBe('hidden');
    expect(wb.getWorksheet('BPU')?.getCell('A1').value).toBe('AAZS');
  });
});
