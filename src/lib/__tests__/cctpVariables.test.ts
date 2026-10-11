import { describe, expect, it } from 'vitest';
import { resoudreVariables } from '../cctpVariables';

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
