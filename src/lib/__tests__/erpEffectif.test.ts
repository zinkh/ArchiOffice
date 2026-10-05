import { describe, expect, test } from 'vitest';
import { ERP_NATURES, calculerEffectif, categorieErp, naturesDuType } from '../erpEffectif';
import { formatTypeEtCat, parseTypeEtCat } from '../erp';

const nature = (id: string) => ERP_NATURES.find(n => n.id === id)!;

describe('calculerEffectif', () => {
  test('restaurant adds seated, standing and waiting zones', () => {
    const r = calculerEffectif(nature('N'), { assise: 60, debout: 10, attente: 5 });
    expect(r.public).toBe(95);
  });
  test('J counts residents, one visitor per three residents, and staff apart', () => {
    const r = calculerEffectif(nature('J-ages'), { residents: 21, personnel: 6 });
    expect(r).toMatchObject({ public: 28, personnel: 6, total: 34 });
  });
  test('the largest formula applies', () => {
    const r = calculerEffectif(nature('X-omnisports'), { aire: 800, courts: 0, sp_sieges: 100 });
    expect(r.public).toBe(200);
    expect(r.formule).toContain('1 pers./4 m²');
  });
  test('a declared effectif overrides the public calculation', () => {
    expect(calculerEffectif(nature('W'), { amenages: 100 }, 40).public).toBe(40);
  });
  test('U with beds: patient + visitor per bed, staff one per three beds', () => {
    expect(calculerEffectif(nature('U-avec'), { lits: 30, consult: 1 })).toMatchObject({ public: 68, personnel: 10 });
  });
});

describe('categorieErp', () => {
  test('above 300 the headcount decides', () => {
    expect(categorieErp(nature('N'), 500).categorie).toBe(3);
  });
  test('below 300 is 5th until a threshold is reached', () => {
    expect(categorieErp(nature('N'), 150).categorie).toBe(5);
    expect(categorieErp(nature('N'), 200)).toMatchObject({ categorie: 4 });
  });
  test('basement threshold and prohibition', () => {
    expect(categorieErp(nature('P'), 60, { sousSol: 20 }).categorie).toBe(4);
    expect(categorieErp(nature('R-creche'), 40, { sousSol: 5 }).motifs[0]).toMatch(/interdit/);
  });
  test('J also has a residents threshold', () => {
    expect(categorieErp(nature('J-ages'), 40, { residents: 25 }).categorie).toBe(4);
    expect(categorieErp(nature('J-ages'), 40, { residents: 20 }).categorie).toBe(5);
  });
  test('floating establishments never reach the 5th', () => {
    expect(categorieErp(nature('EF'), 10).categorie).toBe(4);
  });
});

describe('stored text', () => {
  test('nature survives a round trip', () => {
    const txt = formatTypeEtCat({ code: 'L', nature: 'cabaret', categorie: 5 });
    expect(txt).toBe('L (cabaret) - 5e catégorie');
    expect(parseTypeEtCat(txt)).toEqual({ code: 'L', nature: 'cabaret', categorie: 5 });
  });
  test('every type has at least one nature', () => {
    for (const code of ['J', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'PA', 'SG', 'PS', 'GA', 'OA', 'REF', 'CTS', 'EF']) {
      expect(naturesDuType(code).length).toBeGreaterThan(0);
    }
  });
});
