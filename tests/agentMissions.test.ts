import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';

// No external model invocation during these tests.
const mockChat = vi.fn();
vi.mock('@zinkh/archioffice-agents/server/llm', () => ({
  resolveLlmProvider: () => ({ id: 'mock', model: 'mock-model', chat: mockChat }),
  getTenantAiConfig: async () => ({}),
}));

import { missionExcerpt, parseMissionPlan, runAgentMission } from '../server/agentMissions';

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

describe('mission runner — persistence and agent handoff', () => {
  let db: FakeSupabaseAdmin;
  const deps = {
    reserveAiCredit: async () => true,
    estimateReserveCents: async () => 5,
    settleAiCredit: async () => ({ costCents: 2, newBalance: 98 }),
    refundAiCredit: async () => {},
  };
  beforeEach(() => {
    db = new FakeSupabaseAdmin();
    mockChat.mockReset();
    db.seed('profiles', [{ id: 'user-1', tenant_id: 'tenant-1' }]);
    db.seed('tenants', [{ id: 'tenant-1', agent_billing_mode: 'prepaid', ai_credit_balance_eur_cents: 100, agent_missions_enabled: true, agent_missions_capture_mail: false, agent_missions_capture_mail_review: false }]);
    db.seed('agents', [
      { id: 'agent-1', tenant_id: 'tenant-1', name: 'Sophie', role_title: 'Coordinatrice', delegate_enabled: true, is_active: true },
      { id: 'specialist-1', tenant_id: 'tenant-1', name: 'Karim', role_title: 'DET', is_active: true },
      { id: 'outsider', tenant_id: 'tenant-2', name: 'Externe', role_title: 'Inconnu', is_active: true },
    ]);
    db.seed('agent_missions', [{
      id: 'mission-1', tenant_id: 'tenant-1', created_by: 'user-1',
      coordinator_agent_id: 'agent-1', source_type: 'manual', source_ref: null,
      source_excerpt: SOURCE, instruction: 'Préparer les suites à donner',
      status: 'queued', plan: null, attempts: 0, lease_until: null, created_at: new Date().toISOString(),
    }]);
  });

  it('enregistre une proposition puis un avis spécialisé en deux exécutions sans créer de tâche', async () => {
    mockChat.mockResolvedValueOnce({
      text: withTask(), usage: { inputTokens: 120, outputTokens: 60 }, toolCalls: [],
    }).mockResolvedValueOnce({
      text: 'Le compte-rendu doit préciser les réserves.', usage: { inputTokens: 75, outputTokens: 30 }, toolCalls: [],
    });
    const first = db.getTable('agent_missions')[0];
    expect(await runAgentMission(db as any, first, deps)).toBe(true);
    const delegated = db.getTable('agent_missions')[0];
    expect(delegated.status).toBe('delegated');
    expect(delegated.delegate_agent_id).toBe('specialist-1');
    expect(delegated.task_proposal.title).toBe('Préparer le compte-rendu');
    expect(db.getTable('tasks')).toHaveLength(0);
    expect(await runAgentMission(db as any, { ...delegated }, deps)).toBe(true);
    const ready = db.getTable('agent_missions')[0];
    expect(ready.status).toBe('review');
    expect(ready.specialist_report).toContain('réserves');
    expect(db.getTable('tasks')).toHaveLength(0);
    expect(db.getTable('agent_mission_events').map(e => e.kind)).toEqual(['handoff', 'specialist']);
    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockChat.mock.calls.every(call => call[0].tools?.length === 0)).toBe(true);
  });

  it('une mission en attente ne consomme aucun crédit quand le cabinet désactive l’autonomie', async () => {
    db.getTable('tenants')[0].agent_missions_enabled = false;
    const first = { ...db.getTable('agent_missions')[0] };
    expect(await runAgentMission(db as any, first, deps)).toBe(false);
    expect(db.getTable('agent_missions')[0].status).toBe('queued');
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('une mission déjà revendiquée ne se traite pas deux fois', async () => {
    mockChat.mockResolvedValue({
      text: withTask(), usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [],
    });
    const job = { ...db.getTable('agent_missions')[0] };
    expect(await runAgentMission(db as any, job, deps)).toBe(true);
    // Simule un second worker qui conserve l'état queued obsolète.
    // La transition CAS doit refuser cette seconde revendication.
    expect(await runAgentMission(db as any, job, deps)).toBe(false);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('une erreur incrémente les tentatives mais conserve la mission', async () => {
    mockChat.mockRejectedValue(new Error('Fournisseur temporairement indisponible'));
    const job = db.getTable('agent_missions')[0];
    expect(await runAgentMission(db as any, job, deps)).toBe(false);
    const updated = db.getTable('agent_missions')[0];
    expect(updated.status).toBe('queued');
    expect(updated.attempts).toBe(1);
    expect(updated.next_attempt_at).toBeTruthy();
    expect(updated.error_message).toContain('temporairement');
  });
});
