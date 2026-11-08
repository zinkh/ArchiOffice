// Relais IA du poste de bureau, côté serveur en ligne : abonnement relu en base,
// crédits réservés puis réglés, aucun appel de modèle pour un cabinet non abonné.
// Fournisseur et crédits factices : seul le contrat de routes/desktopAi.ts est vérifié.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));

vi.mock('@zinkh/archioffice-agents/server/llm', async () => {
  const actual = await vi.importActual<any>('@zinkh/archioffice-agents/server/llm');
  return {
    ...actual,
    getTenantAiConfig: async () => ({}),
    resolveLlmProvider: () => ({ id: 'mistral', model: 'mistral-large-latest', supportsVision: true, supportsWebSearch: false, chat }),
  };
});

import { registerDesktopAiRoutes } from '../server/routes/desktopAi';

const FUTURE = new Date(Date.now() + 30 * 86400_000).toISOString();

function build(tenant: Record<string, unknown> | null, credit = true) {
  const deps = {
    supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tenant, error: null }) }) }) }) },
    getTenantId: async () => 'tenant-1',
    maybeRefreshMonthlyCredits: vi.fn(async () => {}),
    reserveAiCredit: vi.fn(async () => credit),
    refundAiCredit: vi.fn(async () => {}),
    estimateReserveCents: vi.fn(async () => 50),
    settleAiCredit: vi.fn(async () => ({ newBalance: 420, costCents: 7 })),
  };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = { id: 'user-1' }; next(); });
  registerDesktopAiRoutes(app, deps as any);
  return { app, deps };
}

async function post(app: express.Express, path: string, body: unknown) {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: (text.startsWith('{') ? JSON.parse(text) : {}) as any };
  } finally { server.close(); }
}

const chatBody = { messages: [{ role: 'user', content: 'bonjour' }] };

describe('relais IA du poste de bureau (serveur en ligne)', () => {
  beforeEach(() => { chat.mockReset(); chat.mockResolvedValue({ text: 'salut', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } }); });
  afterEach(() => { delete process.env.OFFLINE_MODE; });

  it('sert un cabinet abonné, facture le cabinet et rend le solde', async () => {
    const { app, deps } = build({ plan: 'pro', trial_ends_at: FUTURE, suspended_at: null });
    const res = await post(app, '/api/desktop/v1/ai/chat', chatBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ text: 'salut', provider: 'mistral', balance_eur_cents: 420, cost_eur_cents: 7 });
    expect(deps.reserveAiCredit).toHaveBeenCalledWith('tenant-1', 50);
    expect(deps.settleAiCredit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', endpointType: 'agent', inputTokens: 10, outputTokens: 5, reservedCents: 50 }));
  });

  it('refuse (402) un cabinet en essai, sans appeler le modèle ni toucher aux crédits', async () => {
    const { app, deps } = build({ plan: 'trial', trial_ends_at: FUTURE, suspended_at: null });
    const res = await post(app, '/api/desktop/v1/ai/chat', chatBody);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('AI_SUBSCRIPTION_REQUIRED');
    expect(chat).not.toHaveBeenCalled();
    expect(deps.reserveAiCredit).not.toHaveBeenCalled();
  });

  it('refuse un abonnement échu ou suspendu', async () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    expect((await post(build({ plan: 'pro', trial_ends_at: past, suspended_at: null }).app, '/api/desktop/v1/ai/chat', chatBody)).status).toBe(402);
    expect((await post(build({ plan: 'pro', trial_ends_at: FUTURE, suspended_at: past }).app, '/api/desktop/v1/ai/chat', chatBody)).status).toBe(402);
  });

  it('répond 402 NO_TOKENS quand le crédit ne couvre pas la réservation', async () => {
    const { app } = build({ plan: 'pro', trial_ends_at: FUTURE, suspended_at: null }, false);
    const res = await post(app, '/api/desktop/v1/ai/chat', chatBody);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('NO_TOKENS');
    expect(chat).not.toHaveBeenCalled();
  });

  it('rembourse la réservation quand le fournisseur échoue', async () => {
    chat.mockRejectedValue(new Error('timeout'));
    const { app, deps } = build({ plan: 'pro', trial_ends_at: FUTURE, suspended_at: null });
    const res = await post(app, '/api/desktop/v1/ai/chat', chatBody);
    expect(res.status).toBe(502);
    expect(deps.refundAiCredit).toHaveBeenCalledWith('tenant-1', 50);
    expect(deps.settleAiCredit).not.toHaveBeenCalled();
  });

  it('n\'enregistre rien sur une instance poste de bureau', async () => {
    process.env.OFFLINE_MODE = 'true';
    const { app } = build({ plan: 'pro', trial_ends_at: FUTURE, suspended_at: null });
    expect((await post(app, '/api/desktop/v1/ai/chat', chatBody)).status).toBe(404);
  });
});
