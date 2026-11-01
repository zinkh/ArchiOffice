import { describe, expect, it } from 'vitest';
import { libellesLots, resoudreVariables } from '../cctpVariables';

describe('resoudreVariables', () => {
  const ctx = { operation: 'Villa Martin', adresse: '12 rue des Lilas, Nancy' };
  it('remplace les variables connues', () => {
    expect(resoudreVariables('Pour {{operation}} au {{ adresse }}, {{lot_titre}}', ctx, { lotTitre: 'Bardage' }))
      .toBe('Pour Villa Martin au 12 rue des Lilas, Nancy, Bardage');
  });
  it('signale une valeur absente et garde une clé inconnue', () => {
    expect(resoudreVariables('{{zone_plu}} {{inconnue}}', ctx, {})).toBe('[zone du plu à renseigner] {{inconnue}}');
  });
});

describe('liste_lots', () => {
  it('liste les lots en puces, un par ligne', () => {
    expect(resoudreVariables('{{liste_lots}}', { lots: ['Lot 01 · Gros œuvre', 'Lot 02 · Charpente'] }, {}))
      .toBe('- Lot 01 · Gros œuvre\n- Lot 02 · Charpente');
  });
  it('signale une liste vide', () => {
    expect(resoudreVariables('{{liste_lots}}', {}, {})).toBe('[liste des lots à renseigner]');
  });
  it('libellesLots écarte les lots sans numéro ni titre', () => {
    expect(libellesLots([{ numero: '01', titre: ' Gros œuvre ' }, { titre: 'Divers' }, {}]))
      .toEqual(['Lot 01 · Gros œuvre', 'Divers']);
  });
});
