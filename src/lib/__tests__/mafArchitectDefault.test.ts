import { describe, expect, it } from 'vitest';
import { computePartInteret, computeMafCost } from '../mafUtils';

describe('MAF architect share default', () => {
  it('uses 100 percent for an unset share and produces a non-zero estimate', () => {
    const partInteret = computePartInteret(JSON.stringify({ missions: [
      { id: 'pc', amount: 4450, percentages: {} },
    ] }))!;
    expect(partInteret).toBe(100);
    const result = computeMafCost({ intercalaire: 'jaune', montantCumulFinAnnee: 445000,
      tauxMission: 30, partInteret, tauxContratPermil: 5.2473 });
    expect(result.assiette).toBe(133500);
    expect(result.cotisationEstimee).toBeCloseTo(700.51455);
  });
  it('preserves explicit zero and weights manual shares with missing shares', () => {
    expect(computePartInteret(JSON.stringify({ missions: [
      { id: 'pc', amount: 4450, percentages: { architect: 0 } },
    ] }))).toBe(0);
    expect(computePartInteret(JSON.stringify({ missions: [
      { id: 'aps', amount: 1000, percentages: { architect: 60 } },
      { id: 'apd', amount: 3000 },
    ] }))).toBe(90);
  });
});
