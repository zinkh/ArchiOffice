import { describe, expect, it } from 'vitest';
import { documentsAJoindre, lignesIndices, piecesDeEntreprise, type DocumentDce } from '../dceIndices';

const doc = (id: string, name: string, indice?: string, uploaded_at?: string): DocumentDce => ({ id, name, file_url: `ref/${id}`, indice, uploaded_at });
const documents = [
  doc('d1', 'RC.pdf', 'B', '2026-09-14T08:00:00Z'),
  doc('d2', 'Plan RDC.pdf', 'C', '2026-09-20T08:00:00Z'),
  doc('d3', 'Plan R+1.pdf', 'A'),
];

describe('tableau d\'indices du DCE', () => {
  it('numérote un fichier unique « 1 » et plusieurs « 2.1 », « 2.2 »', () => {
    const l = lignesIndices([
      { libelle: 'RC', tous_lots: true, lots_ids: [], document_ids: ['d1'] },
      { libelle: 'Plans', tous_lots: true, lots_ids: [], document_ids: ['d2', 'd3'] },
    ], documents);
    expect(l.map(x => x.numero)).toEqual(['1', '2.1', '2.2']);
    expect(l[0]).toMatchObject({ designation: 'RC', fichier: 'RC.pdf', indice: 'B', manquant: false });
    expect(l[1].indice).toBe('C');
    expect(l[2].date).toBe('');
  });

  it('signale une pièce sans fichier ou dont le fichier a disparu', () => {
    const l = lignesIndices([
      { libelle: 'CCAP', tous_lots: true, lots_ids: [] },
      { libelle: 'CCTP', tous_lots: true, lots_ids: [], document_ids: ['absent'] },
    ], documents);
    expect(l.every(x => x.manquant)).toBe(true);
  });

  it('ne joint chaque document qu\'une fois', () => {
    const pieces = [
      { libelle: 'Plans', tous_lots: true, lots_ids: [], document_ids: ['d2'] },
      { libelle: 'Plan de masse', tous_lots: true, lots_ids: [], document_ids: ['d2', 'd1'] },
    ];
    expect(documentsAJoindre(pieces, documents).map(d => d.id)).toEqual(['d2', 'd1']);
  });

  it('ne retient que les pièces de tous les lots ou d\'un lot de l\'entreprise', () => {
    const pieces = [
      { libelle: 'RC', tous_lots: true, lots_ids: [] },
      { libelle: 'CCTP lot 2', tous_lots: false, lots_ids: ['L2'] },
      { libelle: 'CCTP lot 3', tous_lots: false, lots_ids: ['L3'] },
    ];
    expect(piecesDeEntreprise(pieces, ['L2']).map(p => p.libelle)).toEqual(['RC', 'CCTP lot 2']);
  });
});
