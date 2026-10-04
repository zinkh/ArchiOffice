import { describe, it, expect } from 'vitest';
import { budgetDelta, isBudgetOverrun, nextPhase, sortPhaseNotes, summarizeByPhase, type PhaseNote } from '../phaseJournal';

const note = (over: Partial<PhaseNote>): PhaseNote => ({
  id: over.id ?? 'n', project_id: 'p1', phase: 'APS', kind: 'observation', body: 'texte', occurred_on: '2026-09-01', ...over,
});

describe('journal de l’opération', () => {
  it('calcule l’écart d’un dépassement en euros et en pourcentage', () => {
    expect(budgetDelta({ budget_before: 200000, budget_after: 230000 })).toEqual({ amount: 30000, pct: 15 });
    expect(budgetDelta({ budget_before: 0, budget_after: 1000 })).toEqual({ amount: 1000, pct: null });
    expect(budgetDelta({ budget_before: 200000, budget_after: null })).toBeNull();
  });

  it('ne compte comme dépassement qu’une hausse sur une note de budget', () => {
    expect(isBudgetOverrun(note({ kind: 'budget', budget_before: 100, budget_after: 120 }))).toBe(true);
    expect(isBudgetOverrun(note({ kind: 'budget', budget_before: 120, budget_after: 100 }))).toBe(false);
    expect(isBudgetOverrun(note({ kind: 'observation', budget_before: 100, budget_after: 120 }))).toBe(false);
  });

  it('résume les entrées par phase pour le stepper', () => {
    const summary = summarizeByPhase([
      note({ id: 'a', phase: 'APS' }),
      note({ id: 'b', phase: 'APS', kind: 'budget', budget_before: 100, budget_after: 150 }),
      note({ id: 'c', phase: 'APD' }),
    ]);
    expect(summary.APS).toEqual({ count: 2, overrun: true });
    expect(summary.APD).toEqual({ count: 1, overrun: false });
    expect(summary.ESQ).toBeUndefined();
  });

  it('trie du plus récent au plus ancien', () => {
    const sorted = sortPhaseNotes([
      note({ id: 'old', occurred_on: '2026-01-10' }),
      note({ id: 'new', occurred_on: '2026-03-02' }),
      note({ id: 'same-later', occurred_on: '2026-01-10', created_at: '2026-01-11T09:00:00Z' }),
    ]);
    expect(sorted.map(n => n.id)).toEqual(['new', 'same-later', 'old']);
  });

  it('donne la phase suivante dans la liste des missions du contrat', () => {
    const phases = ['ESQ', 'APS', 'PC', 'DET'] as const;
    expect(nextPhase(phases, 'APS')).toBe('PC');
    expect(nextPhase(phases, 'DET')).toBeUndefined();
    expect(nextPhase(phases, undefined)).toBe('ESQ');
  });
});
