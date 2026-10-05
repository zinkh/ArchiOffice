import { describe, expect, test } from 'vitest';
import { categorieFromEffectif, formatTypeEtCat, parseTypeEtCat } from '../erp';

describe('type et catégorie ERP', () => {
  test('round trips through the stored text', () => {
    expect(formatTypeEtCat({ code: 'N', categorie: 4 })).toBe('N - 4e catégorie');
    expect(parseTypeEtCat('N - 4e catégorie')).toEqual({ code: 'N', categorie: 4 });
  });
  test('reads older free text and long codes', () => {
    expect(parseTypeEtCat('PA 3ème catégorie')).toEqual({ code: 'PA', categorie: 3 });
    expect(parseTypeEtCat('')).toEqual({ code: '', categorie: null });
  });
  test('category from headcount above 300 only', () => {
    expect(categorieFromEffectif(1501)).toBe(1);
    expect(categorieFromEffectif(701)).toBe(2);
    expect(categorieFromEffectif(301)).toBe(3);
    expect(categorieFromEffectif(120)).toBeNull();
  });
});
