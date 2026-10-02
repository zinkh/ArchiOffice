// Covers the atomicity fixes for AI credit billing (server.ts's
// reserveAiCredit/settleAiCredit/refundAiCredit/maybeRefreshMonthlyCredits,
// wired into packages/archioffice-agents/src/server/routes.ts's agent chat
// route). Before this, the balance was read once BEFORE the (potentially
// slow) model call and deducted once AFTER it — a burst of concurrent
// requests against a low balance could all pass that stale pre-check and
// each run a real, billable provider call before any of them touched the
// balance. The fix reserves a conservative worst-case cost atomically
// before every model call and settles it against the real usage right
// after; this file locks in that a call is refused (and the model is never
// invoked) once the reservation can't be covered, and that the settle step
// correctly refunds the unused portion of an over-generous reservation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
    constructor(public opts: any) {}
  },
}));

import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
const originalKey = process.env.GEMINI_API_KEY;

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'fake-key-for-test';
  generateContent.mockReset();
});

afterEach(() => {
  process.env.GEMINI_API_KEY = originalKey;
});

function seedEnterpriseTenant(overrides: Record<string, any> = {}) {
  // ai_credit_last_refresh already this month: keeps the automatic monthly
  // top-up (PLAN_AI_MONTHLY_CREDIT_CENTS.enterprise) from interfering with
  // a test's controlled starting balance.
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  return makeTenant({ plan: 'enterprise', agent_billing_mode: 'prepaid', ai_credit_last_refresh: firstOfMonth, ...overrides });
}

function seedAgent(tenantId: string, id = 'agent-1') {
  fakeSupabaseAdmin.seed('agents', [{ id, tenant_id: tenantId, name: 'Assistant', role_title: 'Assistant', action_scopes: [], is_active: true }]);
  return id;
}

function mockGeminiReply(text: string, promptTokenCount = 20, candidatesTokenCount = 10) {
  generateContent.mockResolvedValueOnce({
    text, functionCalls: [],
    usageMetadata: { promptTokenCount, candidatesTokenCount },
  });
}

beforeEach(async () => {
  app = await getTestApp();
});

describe('Agent chat — atomic AI credit reservation', () => {
  it('refuses the call and never invokes the model when the balance cannot cover the reservation', async () => {
    const tenantId = seedEnterpriseTenant({ ai_credit_balance_eur_cents: 0 });
    const { token } = makeUser(tenantId);
    const agentId = seedAgent(tenantId);

    const res = await request(app).post(`/api/agents/${agentId}/chat`).set(authHeader(token)).send({ message: 'Bonjour' });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('NO_TOKENS');
    // The whole point of reserving BEFORE the call: an exhausted balance
    // must never reach the provider, which is what actually costs money.
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('settles the reservation against the real usage, refunding the unused portion', async () => {
    const tenantId = seedEnterpriseTenant({ ai_credit_balance_eur_cents: 500 });
    const { token } = makeUser(tenantId);
    const agentId = seedAgent(tenantId);
    mockGeminiReply('Bonjour, comment puis-je vous aider ?', 20, 10);

    const res = await request(app).post(`/api/agents/${agentId}/chat`).set(authHeader(token)).send({ message: 'Bonjour' });

    expect(res.status).toBe(200);
    // The reservation assumed up to 16000 output tokens; the real call used
    // only 10 — the settle step must have refunded the difference rather
    // than leaving the worst-case estimate deducted.
    const tenant = fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId);
    expect(tenant?.ai_credit_balance_eur_cents).toBe(500 - res.body.cost_eur_cents);
    expect(res.body.cost_eur_cents).toBeLessThan(50); // nowhere near a 16000-output-token reservation
    expect(res.body.remaining_balance).toBe(tenant?.ai_credit_balance_eur_cents);

    const usageRows = fakeSupabaseAdmin.getTable('agent_token_usage').filter(u => u.tenant_id === tenantId);
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0].cost_eur_cents).toBe(res.body.cost_eur_cents);
  });

  it('never lets a caller\'s balance go negative even under a sequence of calls it can barely afford', async () => {
    // Not true parallelism (this fake is synchronous), but exercises the
    // exact code path a real concurrent burst would hit: each call's
    // reservation is checked against the balance as it stands at that
    // moment, never against a value read before an earlier call settled.
    const tenantId = seedEnterpriseTenant({ ai_credit_balance_eur_cents: 2 });
    const { token } = makeUser(tenantId);
    const agentId = seedAgent(tenantId);
    mockGeminiReply('Réponse 1', 5, 5);
    mockGeminiReply('Réponse 2', 5, 5);
    mockGeminiReply('Réponse 3', 5, 5);

    const results: request.Response[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(await request(app).post(`/api/agents/${agentId}/chat`).set(authHeader(token)).send({ message: `Message ${i}` }));
    }

    const tenant = fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId);
    expect(tenant?.ai_credit_balance_eur_cents).toBeGreaterThanOrEqual(0);
    // At 1 cent per tiny call, a 2-cent balance affords at most 2 of the 3.
    expect(results.filter(r => r.status === 200).length).toBeLessThanOrEqual(2);
    expect(results.some(r => r.status === 402)).toBe(true);
  });
});

describe('Recharge mensuelle IA — atomicité', () => {
  it('ne recrédite pas deux fois le même mois', async () => {
    const tenantId = makeTenant({ plan: 'enterprise', agent_billing_mode: 'prepaid', ai_credit_balance_eur_cents: 0 });
    const { token } = makeUser(tenantId);
    const agentId = seedAgent(tenantId);
    mockGeminiReply('Bonjour', 5, 5);
    mockGeminiReply('Bonjour encore', 5, 5);

    // First call of the month: should top up PLAN_AI_MONTHLY_CREDIT_CENTS.enterprise (1000).
    const first = await request(app).post(`/api/agents/${agentId}/chat`).set(authHeader(token)).send({ message: 'Un' });
    expect(first.status).toBe(200);
    const afterFirst = fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.ai_credit_balance_eur_cents ?? 0;
    expect(afterFirst).toBeGreaterThan(900); // ~1000 minus one tiny call's cost

    // Second call, same month: must NOT top up again.
    const second = await request(app).post(`/api/agents/${agentId}/chat`).set(authHeader(token)).send({ message: 'Deux' });
    expect(second.status).toBe(200);
    const afterSecond = fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.ai_credit_balance_eur_cents ?? 0;
    // Only the second call's own (tiny) cost should have been deducted —
    // a second top-up would instead show a balance *higher* than afterFirst.
    expect(afterSecond).toBeLessThan(afterFirst);
    expect(afterSecond).toBeGreaterThan(afterFirst - 50);
  });
});
