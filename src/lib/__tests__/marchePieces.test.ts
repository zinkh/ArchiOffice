import { describe, expect, it } from 'vitest';
import { contexteMarche } from '../marchePieces';

describe('contexteMarche', () => {
  it('complète les réglages vides avec ce que l\'affaire sait déjà, sans écraser une saisie', () => {
    const c = contexteMarche({ moa_nom: 'SELIA' }, {
      nom: 'SELIA', code: '2419', adresse: '981 Route Forestière', maitreOuvrage: 'Association X', permisNumero: 'PC 088', permisDate: '2026-05-01',
    });
    expect(c.params.moa_nom).toBe('SELIA');
    expect(c.params.lieu_construction).toBe('981 Route Forestière');
    expect(c.params.permis_numero).toBe('PC 088');
    expect(c.params.permis_date).toBe('2026-05-01');
    expect(c.operation).toEqual({ nom: 'SELIA', code: '2419', adresse: '981 Route Forestière' });
  });

  it('garde les valeurs par défaut de la norme quand rien n\'est saisi', () => {
    const c = contexteMarche(undefined, { nom: 'X' });
    expect(c.params.retenue_garantie_pct).toBe(5);
    expect(c.params.moa_nom).toBeUndefined();
  });
});
