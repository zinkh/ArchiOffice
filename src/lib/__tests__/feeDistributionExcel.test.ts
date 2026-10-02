import { describe, expect, it, vi } from 'vitest';

const { saveAsMock } = vi.hoisted(() => ({ saveAsMock: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: saveAsMock }));

import { exportFeeDistributionToXlsx } from '../feeDistribution';

const dist = JSON.stringify({
  missions: [
    { id: 'm1', name: 'Esquisse', category: 'Mission base', amount: 1000, percentages: { architect: 60, c1: 40 } },
    { id: 'm2', name: 'APS', category: 'Mission base', amount: 3000, percentages: { architect: 100 } },
    { id: 'm3', name: 'Suivi', category: 'Mission Exécution', amount: 2000, percentages: { architect: 50, c1: 50 } },
  ],
});

describe('export de la répartition des honoraires', () => {
  it('garde des formules justes sous l\'en-tête du cabinet', async () => {
    saveAsMock.mockClear();
    await exportFeeDistributionToXlsx(dist, [{ id: 's1', contact_id: 'c1', specialty_name: 'BET' }], [], 20, 'P1', { agencyName: 'AAZS' });
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    await wb.xlsx.load(await (saveAsMock.mock.calls[0][0] as Blob).arrayBuffer() as any);
    const ws = wb.worksheets[0];

    const lignes: Record<string, number> = {};
    ws.eachRow((row, n) => { const a = row.getCell(1).value; if (typeof a === 'string') lignes[a] = n; });
    const esq = lignes['Esquisse'];
    const f = (r: number, c: number) => (ws.getRow(r).getCell(c).value as any)?.formula;

    // Solde, montant architecte et montant du cotraitant visent leur propre ligne.
    expect(f(esq, 4)).toBe(`B${esq}*(100-(E${esq}+G${esq}))/100`);
    expect(f(esq, 6)).toBe(`B${esq}*E${esq}/100`);
    expect(f(esq, 8)).toBe(`B${esq}*G${esq}/100`);
    // « Rel % » se rapporte au sous-total de la mission de base, pour toutes les missions.
    const sousBase = lignes['Sous-total Mission base'];
    expect(f(esq, 3)).toBe(`B${esq}/$B$${sousBase}*100`);
    expect(f(lignes['Suivi'], 3)).toBe(`B${lignes['Suivi']}/$B$${sousBase}*100`);
    // Le sous-total couvre exactement les lignes de sa catégorie.
    expect(f(sousBase, 2)).toBe(`SUM(B${esq}:B${sousBase - 1})`);
    // Les totaux additionnent les sous-totaux, la TVA et le TTC visent le HT.
    const ht = lignes['TOTAL GENERAL HT'];
    expect(f(ht, 2)).toBe(`B${sousBase}+B${lignes['Sous-total Mission Exécution']}+B${lignes['Sous-total Missions complémentaires']}`);
    expect(f(lignes['TVA (20%)'], 2)).toBe(`B${ht}*20/100`);
    expect(f(lignes['TOTAL GENERAL TTC'], 2)).toBe(`B${ht}+B${ht + 1}`);
  });
});
