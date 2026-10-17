import { describe, expect, it } from 'vitest';
import { buildProfitability, entryHours, normalizePhase, summarizeTimeByPhase } from '../profitability';

const entry = (over: Record<string, any> = {}) => ({
  user_id: 'u1', start_time: '2026-10-01T08:00:00Z', end_time: '2026-10-01T10:00:00Z', phase: 'APS', billable: true, ...over,
});

describe('normalizePhase', () => {
  it('accepte un code de phase de la mission, quelle que soit la casse', () => {
    expect(normalizePhase('aps')).toBe('APS');
    expect(normalizePhase(' DET ')).toBe('DET');
  });
  it('refuse une saisie libre', () => {
    expect(normalizePhase('Général')).toBeNull();
    expect(normalizePhase('n importe quoi')).toBeNull();
    expect(normalizePhase(42)).toBeNull();
  });
});

describe('entryHours', () => {
  it('compte 0 pour un pointage ouvert ou incohérent', () => {
    expect(entryHours({ start_time: '2026-10-01T08:00:00Z', end_time: null })).toBe(0);
    expect(entryHours({ start_time: '2026-10-01T10:00:00Z', end_time: '2026-10-01T08:00:00Z' })).toBe(0);
  });
  it('mesure la durée en heures', () => {
    expect(entryHours(entry())).toBe(2);
  });
});

describe('summarizeTimeByPhase', () => {
  it('cumule heures, temps facturable et coût par phase', () => {
    const { byPhase } = summarizeTimeByPhase(
      [entry(), entry({ billable: false }), entry({ phase: 'DET' })],
      { u1: 5000 },
    );
    expect(byPhase.APS).toEqual({ hours: 4, billableHours: 2, costCents: 20000 });
    expect(byPhase.DET.costCents).toBe(10000);
  });
  it('range le temps sans phase valide sous la clé vide', () => {
    const { byPhase } = summarizeTimeByPhase([entry({ phase: null }), entry({ phase: 'XXX' })], { u1: 1000 });
    expect(byPhase['']?.hours).toBe(4);
  });
  it('signale un membre sans coût plutôt que de le compter silencieusement', () => {
    const { byPhase, unratedUsers } = summarizeTimeByPhase([entry({ user_id: 'u2' })], { u1: 5000 });
    expect(unratedUsers).toEqual(['u2']);
    expect(byPhase.APS.costCents).toBe(0);
  });
  it('traite billable absent comme facturable', () => {
    const { byPhase } = summarizeTimeByPhase([entry({ billable: undefined })], { u1: 0 });
    expect(byPhase.APS.billableHours).toBe(2);
  });
});

describe('buildProfitability', () => {
  const missions = [
    { id: 'esquisse', pct: 10 }, { id: 'aps', pct: 20 }, { id: 'opc', pct: 5 }, { id: 'det', pct: 30, incluse: false },
  ];
  it('répartit les honoraires par mission et calcule la marge', () => {
    const { byPhase } = summarizeTimeByPhase([entry({ phase: 'APS' })], { u1: 10000 });
    const { rows, total } = buildProfitability(10000, missions, byPhase);
    const aps = rows.find(r => r.phase === 'APS')!;
    expect(aps.budget).toBe(2000);
    expect(aps.cost).toBe(200);
    expect(aps.margin).toBe(1800);
    expect(aps.marginPct).toBeCloseTo(90);
    expect(aps.feePerHour).toBe(1000);
    expect(total.budget).toBe(3000);
  });
  it('ignore les missions hors phase et les missions non incluses', () => {
    const { rows } = buildProfitability(10000, missions, {});
    expect(rows.map(r => r.phase)).toEqual(['ESQ', 'APS']);
  });
  it('ajoute une ligne sans phase avec un budget nul', () => {
    const { byPhase } = summarizeTimeByPhase([entry({ phase: null })], { u1: 5000 });
    const { rows } = buildProfitability(10000, missions, byPhase);
    const sans = rows.find(r => r.phase === '')!;
    expect(sans.budget).toBe(0);
    expect(sans.marginPct).toBeNull();
    expect(sans.margin).toBe(-100);
  });
});
