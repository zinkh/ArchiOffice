import { describe, expect, it } from 'vitest';
import { documentDejaVerse, documentDeLaPiece, indiceSuivant, nomFichierDce, rattacherPieces, type EntreePieceDce } from '../dceVersement';

describe('nommage systématique des fichiers du DCE', () => {
  it('« Code Nom Pièce Ind X » : 2604 SELIA DPGF Ind A.xlsx', () => {
    expect(nomFichierDce({ code: '2604', nom: 'SELIA', piece: 'DPGF', indice: 'A', ext: 'xlsx' })).toBe('2604 SELIA DPGF Ind A.xlsx');
    expect(nomFichierDce({ code: '2604', nom: 'SELIA', piece: 'RC', indice: 'B' })).toBe('2604 SELIA RC Ind B.pdf');
  });

  it('une pièce propre à un lot cite son lot, sans titre, pour que les lots ne se confondent pas', () => {
    expect(nomFichierDce({ code: '2419', nom: 'SELIA', piece: 'CCTP', lot: { numero: '05', titre: 'Menuiseries intérieures' }, indice: 'A' }))
      .toBe('2419 SELIA CCTP Lot 05 Ind A.pdf');
    expect(nomFichierDce({ code: '2419', nom: 'SELIA', piece: 'DPGF', lot: { numero: '09', titre: 'CHAUFFAGE - VENTILATION' }, indice: 'C' }))
      .toBe('2419 SELIA DPGF Lot 09 Ind C.pdf');
  });

  it('ne répète pas le nom quand il est le code, et retire les caractères interdits', () => {
    expect(nomFichierDce({ code: 'SELIA', nom: 'selia', piece: 'RC', indice: 'A' })).toBe('SELIA RC Ind A.pdf');
    expect(nomFichierDce({ code: '2604', nom: 'Salle/Mairie : phase 1', piece: 'CCAP', indice: 'A' })).toBe('2604 Salle Mairie phase 1 CCAP Ind A.pdf');
  });

  it('le CCTP et le DPGF d\'un même lot ne portent jamais le même nom', () => {
    const lot = { numero: '07', titre: 'Peinture' };
    expect(nomFichierDce({ code: 'SELIA', piece: 'CCTP', lot, indice: 'A' }))
      .not.toBe(nomFichierDce({ code: 'SELIA', piece: 'DPGF', lot, indice: 'A' }));
  });

  it('une pièce commune à tous les lots n\'a pas de lot dans son nom', () => {
    expect(nomFichierDce({ code: '2419', nom: 'SELIA', piece: 'RC', indice: 'B' })).toBe('2419 SELIA RC Ind B.pdf');
  });

  it('l\'indice suit le serveur : A au premier versement, puis la lettre suivante', () => {
    expect(indiceSuivant(undefined)).toBe('A');
    expect(indiceSuivant('A')).toBe('B');
    expect(indiceSuivant('b')).toBe('C');
  });

  it('retrouve le document de la pièce malgré le changement de nom (indice)', () => {
    const dce: EntreePieceDce[] = [{ id: 'a', nom: 'CCTP - Lot 05', type_doc: 'CCTP', tous_lots: false, lots_ids: ['L5'], document_ids: ['vieux', 'd5'] }];
    const docs = [{ id: 'd5', name: '2419_CCTP_05-Menuiseries-A.pdf', file_url: 'x', indice: 'A' }];
    const spec = { typeDoc: 'CCTP' as const, nom: 'CCTP - Lot 05', lotsIds: ['L5'] };
    expect(documentDeLaPiece(dce, docs, spec)?.id).toBe('d5');
    expect(documentDeLaPiece(dce, [], spec)).toBeUndefined();
  });
});

const ids = () => { let n = 0; return () => `n${++n}`; };

describe('versement au DCE', () => {
  it('crée la pièce d\'un lot, cochée pour ce seul lot, et la retrouve ensuite', () => {
    const spec = { typeDoc: 'CCTP' as const, nom: 'CCTP - Lot 02 Gros œuvre', lotsIds: ['L2'] };
    const un = rattacherPieces<EntreePieceDce>([], [{ spec, documentId: 'd1' }], ids());
    expect(un).toEqual([{ id: 'n1', nom: spec.nom, type_doc: 'CCTP', tous_lots: false, lots_ids: ['L2'], document_ids: ['d1'] }]);
    const deux = rattacherPieces(un, [{ spec, documentId: 'd1' }, { spec: { ...spec, nom: 'CCTP - Lot 03 Plâtrerie', lotsIds: ['L3'] }, documentId: 'd2' }], ids());
    expect(deux).toHaveLength(2);
    expect(deux[0].document_ids).toEqual(['d1']);
    expect(deux[1].lots_ids).toEqual(['L3']);
  });

  it('retrouve le RC par son type même renommé, mais l\'acte par son intitulé', () => {
    const dce: EntreePieceDce[] = [
      { id: 'a', nom: 'RC de l\'opération', type_doc: 'RC', tous_lots: true, lots_ids: [] },
      { id: 'b', nom: 'Plan de masse', type_doc: 'Autre', tous_lots: true, lots_ids: [] },
    ];
    const r = rattacherPieces(dce, [
      { spec: { typeDoc: 'RC', nom: 'Règlement de la Consultation', unique: true }, documentId: 'd1' },
      { spec: { typeDoc: 'Autre', nom: "Acte d'engagement (formulaire)" }, documentId: 'd2' },
    ], ids());
    expect(r).toHaveLength(3);
    expect(r[0].document_ids).toEqual(['d1']);
    expect(r[1].document_ids).toBeUndefined();
    expect(r[2]).toMatchObject({ nom: "Acte d'engagement (formulaire)", tous_lots: true });
  });

  it('reconnaît un document déjà versé (même pièce, même nom de fichier) pour en faire une nouvelle version', () => {
    const dce: EntreePieceDce[] = [{ id: 'a', nom: 'CCTP - Lot 02', type_doc: 'CCTP', tous_lots: false, lots_ids: ['L2'], document_ids: ['d1'] }];
    const docs = [{ id: 'd1', name: 'CCTP_Lot_02.pdf', file_url: 'x' }];
    const spec = { typeDoc: 'CCTP' as const, nom: 'CCTP - Lot 02', lotsIds: ['L2'] };
    expect(documentDejaVerse(dce, docs, spec, 'CCTP_Lot_02.pdf')?.id).toBe('d1');
    expect(documentDejaVerse(dce, docs, spec, 'autre.pdf')).toBeUndefined();
    expect(documentDejaVerse(dce, [], spec, 'CCTP_Lot_02.pdf')).toBeUndefined();
  });
});
