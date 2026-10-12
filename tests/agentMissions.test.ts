import { describe, it, expect, vi } from 'vitest';

// No external model invocation during these tests.
vi.mock('@zinkh/archioffice-agents/server/llm', () => ({
  resolveLlmProvider: vi.fn(),
  getTenantAiConfig: vi.fn(),
}));

import { missionExcerpt, parseMissionPlan } from '../server/agentMissions';

const SOURCE = 'La maîtrise d\'ouvrage demande un compte-rendu avant vendredi 16 octobre 2026.';

const withTask = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  actionable: true,
  summary: 'Un compte-rendu est attendu.',
  task: {
    title: 'Préparer le compte-rendu',
    description: 'Préparer le document demandé.',
    priority: 'high',
    due_date: '2026-10-16',
    evidence: 'La maîtrise d\'ouvrage demande un compte-rendu',
    ...overrides,
  },
  delegate_agent_id: 'specialist-1',
  handoff_question: 'Vérifier le point DET.',
});

describe('missions agentiques — fidélité à la source', () => {
  it('conserve les citations exactes et la date explicitement fournie', () => {
    const plan = parseMissionPlan(withTask(), SOURCE, ['specialist-1']);
    expect(plan.actionable).toBe(true);
    expect(plan.task?.evidence).toBe('La maîtrise d\'ouvrage demande un compte-rendu');
    expect(plan.task?.due_date).toBe('2026-10-16');
    expect(plan.delegate_agent_id).toBe('specialist-1');
  });

  it('refuse une citation inventée même si le titre semble raisonnable', () => {
    expect(() => parseMissionPlan(withTask({ evidence: 'Le compte-rendu est urgent et validé' }), SOURCE, []))
      .toThrow(/citation exacte/);
  });

  it('refuse une citation trop courte pour justifier une écriture', () => {
    expect(() => parseMissionPlan(withTask({ evidence: 'avant' }), SOURCE, []))
      .toThrow(/citation exacte/);
  });

  it('n\'autorise pas un passage de relais vers un agent hors du cabinet', () => {
    const plan = parseMissionPlan(withTask(), SOURCE, ['autre-agent']);
    expect(plan.delegate_agent_id).toBeNull();
  });

  it('neutralise une date non conforme et une priorité inconnue', () => {
    const plan = parseMissionPlan(withTask({ due_date: 'vendredi', priority: 'catastrophique' }), SOURCE, []);
    expect(plan.task?.due_date).toBeNull();
    expect(plan.task?.priority).toBe('normal');
  });

  it('respecte une source sans action claire', () => {
    const plan = parseMissionPlan('Voici : ' + JSON.stringify({
      actionable: false, summary: 'Simple information', task: null,
      delegate_agent_id: 'specialist-1', handoff_question: '',
    }), SOURCE, ['specialist-1']);
    expect(plan.actionable).toBe(false);
    expect(plan.task).toBeNull();
    expect(plan.delegate_agent_id).toBeNull();
  });

  it('rejette une sortie non structurée, sans tentative de deviner', () => {
    expect(() => parseMissionPlan('Je vais créer la tâche.', SOURCE, []))
      .toThrow(/JSON/);
  });

  it('borne le texte source avant son enregistrement', () => {
    expect(missionExcerpt('a'.repeat(13000))).toHaveLength(12000);
    expect(missionExcerpt(' texte ')).toBe('texte');
  });
});
