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
});
