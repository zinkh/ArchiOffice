import { describe, expect, it } from 'vitest';
import type { DPGF } from '../../types/dpgf';
import { validateProDocument } from '../proValidation';

const document = (): DPGF => ({
  id: 'd1', projectId: 'p1', titre: 'DPGF', version: '1', dateCreation: '', statut: 'draft', TVA: 20,
  totalHT: 100, totalTTC: 120, multiBatiments: true, batiments: [{ id: 'b1', code: 'A', libelle: 'A', ordre: 1 }],
  lots: [{ id: 'lot', numero: '01', titre: 'Lot', sousTotal: 100, batimentId: 'b1', chapitres: [{ id: 'c', numero: '01.1', titre: 'Chapitre', lignes: [{
    id: 'l1', numero: '01.1.1', designation: 'Peinture', unite: 'm2', quantite: 10, prixUnitaire: 10, prixTotal: 100,
    type: 'ouvrage', cctpDescription: 'Deux couches.', quantiteDetails: [{ id: 'q1', local: 'Salle', quantite: 10 }],
  }] }] }],
});

describe('validateProDocument', () => {
  it('accepte un document cohérent et respecte le bâtiment hérité du lot', () => {
    expect(validateProDocument(document())).toEqual([]);
  });

  it('signale les écarts de ventilation, doublons et prescriptions absentes', () => {
    const d = document();
    d.lots[0].chapitres[0].lignes[0].quantiteDetails![0].quantite = 8;
    d.lots[0].chapitres[0].lignes[0].cctpDescription = '';
    d.lots[0].chapitres[0].lignes.push({ ...d.lots[0].chapitres[0].lignes[0], id: 'l2' });
    const codes = validateProDocument(d).map(i => i.code);
    expect(codes).toContain('ventilation_incoherente');
    expect(codes).toContain('cctp_absent');
    expect(codes).toContain('numero_duplique');
  });

  const codes = (d: DPGF) => validateProDocument(d).filter(i => i.code === 'batiment_absent');
  const doc2 = (): DPGF => {
    const d = document();
    d.batiments = [{ id: 'b1', code: 'A', libelle: 'A', ordre: 1 }, { id: 'b2', code: 'B', libelle: 'B', ordre: 2 }];
    delete d.lots[0].batimentId;
    d.lots[0].chapitres[0].lignes[0].quantiteDetails = undefined;
    return d;
  };

  it('ne signale pas un article réparti par bâtiment (quantitesBatiments)', () => {
    const d = doc2();
    Object.assign(d.lots[0].chapitres[0].lignes[0], { quantitesBatiments: { b1: 4, b2: 6 } });
    expect(codes(d)).toEqual([]);
  });

  it('ne signale pas un article qui hérite du bâtiment de son parent ou du chapitre', () => {
    const d = doc2();
    d.lots[0].chapitres[0].batimentId = 'b2';
    expect(codes(d)).toEqual([]);
    d.lots[0].chapitres[0].batimentId = undefined;
    const parent = d.lots[0].chapitres[0].lignes[0];
    parent.batimentId = 'b1';
    parent.children = [{ ...parent, id: 'enfant', numero: '01.1.1.1', children: undefined, batimentId: undefined }];
    expect(codes(d)).toEqual([]);
  });

  it('ne signale pas un chapitre ou un lot qui porte une liste de bâtiments', () => {
    const d = doc2();
    d.lots[0].batimentsIds = ['b1', 'b2'];
    expect(codes(d)).toEqual([]);
  });

  it('signale un article réellement sans bâtiment, sauf s\'il est réservé au CCTP', () => {
    const d = doc2();
    expect(codes(d)).toHaveLength(1);
    d.lots[0].chapitres[0].cctpOnly = true;
    const issues = validateProDocument(d).map(i => i.code);
    expect(issues).not.toContain('batiment_absent');
    expect(issues).not.toContain('unite_absente');
    expect(issues).not.toContain('quantite_nulle');
  });
});
