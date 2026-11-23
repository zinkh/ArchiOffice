import { describe, expect, it, vi } from 'vitest';
import { Workbook } from 'exceljs';

const { saveAsMock } = vi.hoisted(() => ({ saveAsMock: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: saveAsMock }));

import { generateComparatifExcel } from '../actAnalysisExport';
import { versComparatif } from '../bpuToAct';
import type { Lot, OffreDocument } from '../../types/dpgf';

const art = (id: string, numero: string, designation: string, q: number, pu: number) => ({
  id, numero, designation, unite: 'm²', quantite: q, prixUnitaire: pu, prixTotal: q * pu, type: 'ouvrage' as const,
});
const lot = (): Lot => ({
  id: 'lot1', numero: '02', titre: 'Gros œuvre', sousTotal: 0, projectLotId: 'pl2',
  chapitres: [{ id: 'c1', numero: '2.1', titre: 'Fondations', lignes: [art('a1', '2.1.1', 'Terrassement', 100, 20), art('a2', '2.1.2', 'Béton', 10, 100)] }],
});
const offre = (id: string, entrepriseId: string, prix: Record<string, number | null>, extra: Partial<OffreDocument> = {}): OffreDocument => ({
  id, entrepriseId, entrepriseNom: `Ent ${entrepriseId}`, dateReception: '2026-02-01', fichierNom: 'offre.xlsx',
  importedAt: '2026-02-01T10:00:00Z', documentVersion: '1', prix, anomalies: [], statut: 'validee', ...extra,
});

const lots = [{ id: 'pl2', lot_number: '02', lot_title: 'Gros œuvre' }] as any;
const entreprises = [{ id: 'e1', nom: 'Dupont' }, { id: 'e2', nom: 'Martin' }];

async function exporter(offres: OffreDocument[], base: 'moe' | 'entreprise') {
  saveAsMock.mockClear();
  const comparatif = versComparatif([lot()], offres, base).comparatif;
  await generateComparatifExcel(lots, {
    entreprises, criteres: [], attributions: [], base_quantites: base, comparatif,
    offres: [
      { lot_id: 'pl2', entreprise_id: 'e1', montant_base: 3000, note_technique: 0, conforme: true },
      { lot_id: 'pl2', entreprise_id: 'e2', montant_base: base === 'moe' ? 3100 : 2720, note_technique: 0, conforme: true },
    ],
  } as any, 'Villa Martin', {} as any);
  const [blob] = saveAsMock.mock.calls[0];
  const wb = new Workbook();
  await wb.xlsx.load(await (blob as Blob).arrayBuffer());
  return wb;
}
const lignes = (wb: Workbook, feuille: string) => {
  const ws = wb.getWorksheet(feuille)!;
  const out: unknown[][] = [];
  ws.eachRow(r => { out.push((r.values as unknown[]).slice(1).map(v => (v && typeof v === 'object' && 'result' in (v as any) ? (v as any).result : v))); });
  return out;
};

const avecEcarts = [
  offre('o1', 'e1', { a1: 20, a2: 100 }),
  offre('o2', 'e2', { a1: 19, a2: 100 }, { quantites: { a1: 80, a2: 12 }, quantitesAcceptees: ['a2'] }),
];

describe('export Excel du comparatif et quantités des entreprises', () => {
  it('ajoute la feuille « Quantités modifiées » avec l\'effet en euros, et le dit dans le sous-titre', async () => {
    const wb = await exporter(avecEcarts, 'moe');
    expect(wb.worksheets.map(w => w.name)).toContain('Quantités modifiées');
    const l = lignes(wb, 'Quantités modifiées').map(r => r.join('|'));
    expect(l.some(x => x.includes('Martin') && x.includes('Terrassement') && x.includes('100|80|-20|19|-380') && x.endsWith('Non'))).toBe(true);
    expect(l.some(x => x.includes('Martin') && x.includes('Béton') && x.includes('10|12|2|100|200') && x.endsWith('Oui'))).toBe(true);
    expect(l.some(x => x.includes('jamais modifié'))).toBe(true);
    const comparaison = lignes(wb, 'Comparaison').flat().join(' ');
    expect(comparaison).toContain('Quantités du maître d\'œuvre');
  });

  it('la feuille d\'une entreprise concernée gagne les quantités document et entreprise, pas les autres', async () => {
    const wb = await exporter(avecEcarts, 'entreprise');
    const martin = lignes(wb, 'Martin');
    const entete = martin.find(r => r.includes('Désignation'))!;
    expect(entete).toContain('Qté document');
    expect(entete).toContain('Qté entreprise');
    const terrassement = martin.find(r => r.includes('Terrassement'))!;
    expect(terrassement).toContain(100);
    expect(terrassement).toContain(80);
    expect(lignes(wb, 'Dupont').find(r => r.includes('Désignation'))).not.toContain('Qté entreprise');
    expect(wb.getWorksheet('Comparaison')!.getRow(1).values).toBeDefined();
    expect(lignes(wb, 'Comparaison').flat().join(' ')).toContain('Quantités de chaque entreprise');
  });

  it('sans quantité modifiée, le classeur est celui d\'avant : ni feuille en plus, ni colonnes en plus', async () => {
    const wb = await exporter([offre('o1', 'e1', { a1: 20, a2: 100 }), offre('o2', 'e2', { a1: 19, a2: 100 })], 'moe');
    expect(wb.worksheets.map(w => w.name)).toEqual(['Comparaison', 'Dupont', 'Martin']);
    expect(lignes(wb, 'Martin').find(r => r.includes('Désignation'))).not.toContain('Qté entreprise');
    expect(lignes(wb, 'Comparaison').flat().join(' ')).not.toContain('Base de comparaison');
  });
});
