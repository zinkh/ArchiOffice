import { describe, it, expect } from 'vitest';
import { roundFee, computeFees, applyDiscountAndVat, scopeShare, PC_SCOPE_DEFAULT_SHARE_PCT } from '../proposalFees';

describe('roundFee', () => {
  it('arrondit à l’euro, à la dizaine et à la centaine', () => {
    expect(roundFee(8000.05, 'euro')).toBe(8000);
    expect(roundFee(8004.5, 'ten')).toBe(8000);
    expect(roundFee(8050, 'hundred')).toBe(8100);
  });
  it('ne fait que ramener au centime sans arrondi', () => {
    expect(roundFee(8000.0549, 'none')).toBe(8000.05);
    expect(roundFee(NaN, 'euro')).toBe(0);
  });
});

describe('computeFees', () => {
  const base = { constructionCost: 277500, baseFeePercent: 2.8829001, complexityRate: 1, vatRate: 20 };
  it('arrondit le HT puis calcule la TVA sur le montant arrondi', () => {
    const r = computeFees({ ...base, rounding: 'euro' })!;
    expect(r.netHT).toBe(8000);
    expect(r.tva).toBe(1600);
    expect(r.ttc).toBe(9600);
  });
  it('applique une remise en pourcentage, les lignes s’additionnent', () => {
    const r = computeFees({ ...base, rounding: 'euro', discountMode: 'percent', discountValue: 10 })!;
    expect(r.brut).toBe(8000);
    expect(r.netHT).toBe(7200);
    expect(r.remise).toBe(800);
    expect(r.brut - r.remise).toBe(r.netHT);
  });
  it('plafonne une remise en montant au brut', () => {
    const r = computeFees({ ...base, discountMode: 'amount', discountValue: 99999 })!;
    expect(r.netHT).toBe(0);
  });
  it('un PC seul ne facture que la part de la mission complète', () => {
    const r = computeFees({ ...base, scope: 'pc', scopeSharePct: 40, rounding: 'euro' })!;
    expect(r.sharePct).toBe(40);
    expect(r.brut).toBe(3200);
  });
  it('utilise la part par défaut quand elle est absente', () => {
    expect(scopeShare('pc', 0)).toBe(PC_SCOPE_DEFAULT_SHARE_PCT);
    expect(scopeShare('complete', 12)).toBe(100);
  });
  it('rend null sans coût des travaux ou sans taux', () => {
    expect(computeFees({ constructionCost: 0, baseFeePercent: 3 })).toBeNull();
  });
  it('décompose des honoraires saisis à la main', () => {
    const r = applyDiscountAndVat(1000, { discountMode: 'percent', discountValue: 5, vatRate: 20 });
    expect(r.netHT).toBe(950);
    expect(r.ttc).toBe(1140);
  });
});
