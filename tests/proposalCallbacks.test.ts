// Rappel téléphonique d'une proposition sans réponse après un mois (appel + tâche), import des chiffres
// d'une proposition acceptée dans l'affaire créée.
import { describe, expect, it } from 'vitest';
import { fakeSupabaseAdmin, makeTenant } from './testServer';
import { executerRappelsPropositions } from '../server/proposalCallbacks';
import { projectFinancials } from '../src/lib/proposalToProject';
import { proposalCallbackDue, PROPOSAL_CALLBACK_DAYS } from '../src/lib/proposalFollowUp';

const DAY = 86400000;
const NOW = new Date('2026-11-14T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

function seedProposal(tenantId: string, over: Record<string, any> = {}) {
  const id = over.id || `prop-${Math.random().toString(36).slice(2, 10)}`;
  fakeSupabaseAdmin.seed('proposals', [{
    id, tenant_id: tenantId, title: 'Extension maison', reference: 'DEVIS-2026-001', status: 'Sent',
    sent_at: daysAgo(35), archived_at: null, last_response_at: null, callback_call_id: null, signature_status: null,
    telephone: '0600000000', ...over,
  }]);
  return id;
}

describe('proposalCallbackDue', () => {
  it('se déclenche à 30 jours sans réponse, pas avant', () => {
    const base = { status: 'Sent', archived_at: null, last_response_at: null };
    expect(proposalCallbackDue({ ...base, sent_at: daysAgo(PROPOSAL_CALLBACK_DAYS - 1) }, NOW.getTime())).toBe(false);
    expect(proposalCallbackDue({ ...base, sent_at: daysAgo(PROPOSAL_CALLBACK_DAYS) }, NOW.getTime())).toBe(true);
  });

  it('ne concerne ni une proposition archivée, ni une réponse reçue, ni une signature terminée, ni une date absente', () => {
    const old = daysAgo(60);
    expect(proposalCallbackDue({ status: 'Sent', sent_at: old, archived_at: daysAgo(1) }, NOW.getTime())).toBe(false);
    expect(proposalCallbackDue({ status: 'Sent', sent_at: old, last_response_at: daysAgo(2) }, NOW.getTime())).toBe(false);
    expect(proposalCallbackDue({ status: 'Sent', sent_at: old, signature_status: 'completed' }, NOW.getTime())).toBe(false);
    expect(proposalCallbackDue({ status: 'Sent', sent_at: null }, NOW.getTime())).toBe(false);
    expect(proposalCallbackDue({ status: 'Accepted', sent_at: old }, NOW.getTime())).toBe(false);
  });
});

describe('executerRappelsPropositions', () => {
  it('crée un appel sortant et sa tâche liée, attribués à un administrateur, une seule fois', async () => {
    const tenantId = makeTenant();
    fakeSupabaseAdmin.seed('tenant_memberships', [{ user_id: `admin-${tenantId}`, tenant_id: tenantId, system_role: 'admin' }]);
    const id = seedProposal(tenantId);

    const first = await executerRappelsPropositions(fakeSupabaseAdmin, NOW);
    expect(first.crees).toBeGreaterThanOrEqual(1);

    const proposal = fakeSupabaseAdmin.getTable('proposals').find(p => p.id === id)!;
    expect(proposal.callback_call_id).toBeTruthy();
    const call = fakeSupabaseAdmin.getTable('phone_calls').find(c => c.id === proposal.callback_call_id)!;
    expect(call).toMatchObject({ tenant_id: tenantId, direction: 'sortant', caller_phone: '0600000000', assignee_id: `admin-${tenantId}`, callback_due: '2026-11-14' });
    expect(call.subject).toContain('DEVIS-2026-001');
    const task = fakeSupabaseAdmin.getTable('tasks').find(t => t.id === call.task_id)!;
    expect(task).toMatchObject({ tenant_id: tenantId, assignee_id: `admin-${tenantId}`, status: 'todo', due_date: '2026-11-14' });

    // Deuxième cycle : rien de plus pour cette proposition.
    const before = fakeSupabaseAdmin.getTable('phone_calls').filter(c => c.tenant_id === tenantId).length;
    await executerRappelsPropositions(fakeSupabaseAdmin, NOW);
    expect(fakeSupabaseAdmin.getTable('phone_calls').filter(c => c.tenant_id === tenantId).length).toBe(before);
  });

  it('ignore une proposition trop récente, archivée, ayant reçu une réponse ou déjà rappelée', async () => {
    const tenantId = makeTenant();
    seedProposal(tenantId, { id: 'recente', sent_at: daysAgo(10) });
    seedProposal(tenantId, { id: 'archivee', archived_at: daysAgo(1) });
    seedProposal(tenantId, { id: 'repondue', last_response_at: daysAgo(3) });
    seedProposal(tenantId, { id: 'deja', callback_call_id: 'call-existant' });

    await executerRappelsPropositions(fakeSupabaseAdmin, NOW);
    expect(fakeSupabaseAdmin.getTable('phone_calls').filter(c => c.tenant_id === tenantId)).toHaveLength(0);
  });
});

describe('projectFinancials (import d\'une proposition acceptée)', () => {
  it('prend le montant des travaux pour budget, les honoraires pour rémunération et la surface de plancher', () => {
    expect(projectFinancials({ amount: 8000, construction_cost: 277500, surface_plancher: '550' }))
      .toEqual({ budget: 277500, construction_cost: 277500, remuneration: 8000, surface: '550' });
  });

  it('retombe sur les honoraires pour budget sans montant de travaux, et ne remplit rien d\'inventé', () => {
    expect(projectFinancials({ amount: 8000, construction_cost: 0, surface_plancher: '  ' }))
      .toEqual({ budget: 8000, construction_cost: null, remuneration: 8000, surface: null });
    expect(projectFinancials({})).toEqual({ budget: null, construction_cost: null, remuneration: null, surface: null });
  });
});
