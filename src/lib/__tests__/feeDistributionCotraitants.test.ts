import { describe, it, expect } from 'vitest';
import { applyDefaultCotraitantShares, defaultFeeDistribution } from '../feeDistribution';

describe('applyDefaultCotraitantShares', () => {
  it('ne change rien sans cotraitant', () => {
    const { missions } = defaultFeeDistribution();
    expect(applyDefaultCotraitantShares(missions, [])).toBeNull();
  });

  it('pose la part type du premier cotraitant et celle de l\'architecte', () => {
    const { missions } = defaultFeeDistribution();
    const res = applyDefaultCotraitantShares(missions, ['c1'])!;
    const par = (id: string) => res.find(m => m.id === id)!.percentages;
    expect(par('aps')).toEqual({ architect: 80, c1: 20 });
    expect(par('projet')).toEqual({ architect: 50, c1: 50 });
    expect(par('det')).toEqual({ architect: 75, c1: 25 });
    expect(par('opc')).toEqual({ architect: 0, c1: 100 });
  });

  it('donne 0 aux cotraitants suivants et ne touche pas une valeur déjà saisie', () => {
    const { missions } = defaultFeeDistribution();
    const saisi = missions.map(m => (m.id === 'aps' ? { ...m, percentages: { architect: 0, c1: 55 } } : m));
    const res = applyDefaultCotraitantShares(saisi, ['c1', 'c2'])!;
    const aps = res.find(m => m.id === 'aps')!.percentages;
    expect(aps).toEqual({ architect: 0, c1: 55, c2: 0 });
    expect(res.find(m => m.id === 'apd')!.percentages).toEqual({ architect: 60, c1: 40, c2: 0 });
  });

  it('renvoie null quand tout est déjà renseigné', () => {
    const { missions } = defaultFeeDistribution();
    const une = applyDefaultCotraitantShares(missions, ['c1'])!;
    expect(applyDefaultCotraitantShares(une, ['c1'])).toBeNull();
  });
});
