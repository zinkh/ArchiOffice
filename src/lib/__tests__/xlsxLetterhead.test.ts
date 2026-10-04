import { describe, expect, it, vi } from 'vitest';

const { saveAsMock } = vi.hoisted(() => ({ saveAsMock: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: saveAsMock }));

import { ajouterFeuille, nouveauClasseur } from '../xlsxLetterhead';
import { exportEntreprisesConsulteesToExcel, groupByLot } from '../actExport';

const settings = {
  agencyName: 'AAZS & Associés', address: '23 Bd de l’Europe 54500 VANDOEUVRE-LES-NANCY',
  phone: '0684016633', email: 'contact@aazs.fr', siret: '102 663 416 00018',
} as any;

const lots = [
  { id: 'l1', lot_number: '01', lot_title: 'Gros œuvre' },
  { id: 'l2', lot_number: '02', lot_title: 'Charpente' },
];
const entreprises = [
  { id: 'e1', nom: 'Maçonnerie Dupont', lots_ids: ['l1'] },
  { id: 'e2', nom: 'Bois & Co', lots_ids: ['l2', 'l1'], offre_recue_le: '2026-03-02' },
  { id: 'e3', nom: 'Sans lot', lots_ids: [] },
];

describe('xlsxLetterhead', () => {
  it('pose l\'en-tête du cabinet, l\'entête de tableau et le pied « P1|2 »', async () => {
    const wb = await nouveauClasseur();
    const f = ajouterFeuille(wb, {
      nom: 'Test/[x]', settings, title: 'Titre', subtitle: 'Projet',
      colonnes: [{ header: 'A', width: 20 }, { header: 'B', width: 20 }, { header: 'C', width: 20, align: 'right' }],
    });
    f.groupe('Lot 01');
    f.ligne(['x', 'y', 1]);
    expect(f.ws.name).toBe('Test__x_');
    expect(f.ws.getCell('A1').value).toBe('AAZS & Associés');
    expect(f.ws.getCell('C1').value).toBe('Titre');
    expect(f.ws.getCell('A6').value).toBe('A');
    expect(f.ws.getCell('A7').value).toBe('LOT 01');
    expect(f.ws.pageSetup.printTitlesRow).toBe('6:6');
    const pied = f.ws.headerFooter.oddFooter as string;
    expect(pied).toContain('P&P|&N');
    expect(pied).toContain('AAZS && Associés');
  });

  it('place le titre sous l\'en-tête quand le tableau est trop étroit', async () => {
    const wb = await nouveauClasseur();
    const f = ajouterFeuille(wb, {
      nom: 'Etroit', settings, title: 'Un titre de document bien trop long pour ce tableau étroit', colonnes: [{ header: 'A', width: 20 }, { header: 'B', width: 10 }],
    });
    expect(f.ws.getCell('A5').value).toBe('Un titre de document bien trop long pour ce tableau étroit');
    expect(f.ws.getCell('A8').value).toBe('A');
  });
});

describe('export des entreprises consultées', () => {
  it('classe par lot, avec « Sans lot assigné » en dernier', () => {
    const g = groupByLot(entreprises as any, lots);
    expect(g.map(x => x.libelle)).toEqual(['Lot 01 — Gros œuvre', 'Lot 02 — Charpente', 'Sans lot assigné']);
    expect(g[0].entreprises.map(e => (e as any).nom)).toEqual(['Maçonnerie Dupont', 'Bois & Co']);
  });

  it('écrit un classeur groupé par lot', async () => {
    await exportEntreprisesConsulteesToExcel(entreprises as any, lots, settings, 'Villa Martin');
    const [blob, nom] = saveAsMock.mock.calls[0];
    expect(nom).toBe('Entreprises_consultees_Villa_Martin.xlsx');
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    await wb.xlsx.load(await (blob as Blob).arrayBuffer() as any);
    const ws = wb.worksheets[0];
    const colA: string[] = [];
    ws.eachRow(r => colA.push(String(r.getCell(1).value ?? '')));
    expect(colA).toContain('LOT 01 — GROS ŒUVRE');
    expect(colA).toContain('SANS LOT ASSIGNÉ');
    expect(colA.some(v => v.includes('CORPS'))).toBe(false);
  });
});

describe('exporterListe', () => {
  it('écrit une liste sous l\'en-tête du cabinet, montants en nombres', async () => {
    const { exporterListe, FORMAT_EURO } = await import('../xlsxLetterhead');
    saveAsMock.mockClear();
    await exporterListe({
      fichier: 'liste.xlsx', nom: 'Liste', title: 'Liste', subtitle: '2 lignes', settings,
      colonnes: [
        { cle: 'nom', header: 'Nom', width: 20 },
        { cle: 'a', header: 'A', width: 20 },
        { cle: 'montant', header: 'Montant', width: 16, align: 'right', numFmt: FORMAT_EURO },
      ],
      lignes: [{ nom: 'Un', a: 'x', montant: 1500 }, { nom: 'Deux', a: 'y', montant: '' }],
    });
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    await wb.xlsx.load(await (saveAsMock.mock.calls[0][0] as Blob).arrayBuffer() as any);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('AAZS & Associés');
    expect(ws.getCell('A7').value).toBe('Un');
    expect(ws.getCell('C7').value).toBe(1500);
    expect(ws.getCell('C8').value).toBeNull();
  });
});
