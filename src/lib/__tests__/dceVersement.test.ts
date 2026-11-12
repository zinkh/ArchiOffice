import { describe, expect, it } from 'vitest';
import { documentDejaVerse, rattacherPieces, type EntreePieceDce } from '../dceVersement';

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
