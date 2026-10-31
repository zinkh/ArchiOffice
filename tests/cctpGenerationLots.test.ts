// Génération du CCTP lot par lot : plan puis un appel par lot, pièces placées
// en tête de chaque prompt (cachePrefix) pour le cache de prompt, facturation
// des jetons de cache d'Anthropic, et un appel qui échoue sans perdre les autres.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const { chat, anthropicCreate } = vi.hoisted(() => ({ chat: vi.fn(), anthropicCreate: vi.fn() }));

vi.mock('@zinkh/archioffice-agents/server/llm', async (orig) => ({
  ...(await orig<any>()),
  resolveLlmProvider: () => ({ id: 'gemini', model: 'gemini-3-flash-preview', chat }),
  getTenantAiConfig: async () => ({}),
}));
vi.mock('@zinkh/archioffice-agents/server', async (orig) => ({
  ...(await orig<any>()),
  extractKnowledgeDocText: vi.fn(async () => 'PLAN RDC : salle polyvalente de 120 m2, ossature bois.'),
}));

import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { createAnthropicProvider } from '../packages/archioffice-agents/src/server/llm/anthropic';
import { prependCachePrefix } from '../packages/archioffice-agents/src/server/llm/cachePrefix';
import { normalizePlannedLots } from '../server/routes/cctpGeneration';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

describe('cachePrefix', () => {
  it('place le préfixe devant le premier message utilisateur seulement', () => {
    const out = prependCachePrefix([{ role: 'user', content: 'Tâche' }, { role: 'user', content: 'Suite' }], 'Pièces');
    expect((out[0] as any).content).toBe('Pièces\n\nTâche');
    expect((out[1] as any).content).toBe('Suite');
  });

  it('ne change rien sans préfixe', () => {
    const msgs = [{ role: 'user' as const, content: 'Tâche' }];
    expect(prependCachePrefix(msgs)).toBe(msgs);
  });
});

describe('adaptateur Anthropic et cache de prompt', () => {
  beforeEach(() => {
    anthropicCreate.mockReset();
    anthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000 },
      stop_reason: 'end_turn',
    });
    vi.doMock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: anthropicCreate }; } }));
  });

  it('marque le préfixe cache_control et compte les jetons de cache au prix réel', async () => {
    const res = await createAnthropicProvider({ apiKey: 'k' }).chat({
      system: 'S', cachePrefix: 'Pièces', messages: [{ role: 'user', content: 'Lot 1' }],
    });
    expect(anthropicCreate.mock.calls[0][0].messages[0].content).toEqual([
      { type: 'text', text: 'Pièces', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Lot 1' },
    ]);
    // 100 + 1000 × 1,25 écriture + 2000 × 0,1 lecture
    expect(res.usage.inputTokens).toBe(1550);
  });
});

describe('adaptateur Mistral et cache de prompt', () => {
  it('envoie prompt_cache_key et compte les jetons en cache à 10 %', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: 1013, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1008 } },
    }), { status: 200 }));
    const { createMistralProvider } = await import('../packages/archioffice-agents/src/server/llm/mistral');
    const res = await createMistralProvider({ apiKey: 'k' }).chat({ cacheKey: 'cctp-abc', cachePrefix: 'Pièces', messages: [{ role: 'user', content: 'Lot 1' }] });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.prompt_cache_key).toBe('cctp-abc');
    expect(body.messages[0].content).toBe('Pièces\n\nLot 1');
    expect(res.usage.inputTokens).toBe(Math.ceil(5 + 1008 * 0.1)); // 106
    fetchMock.mockRestore();
  });
});

describe('normalizePlannedLots', () => {
  it('écarte les lots sans titre et les doublons', () => {
    expect(normalizePlannedLots({ lots: [{ titre: 'Gros œuvre', perimetre: 'x' }, { titre: 'gros œuvre' }, { perimetre: 'y' }, { titre: 'Charpente' }] }))
      .toEqual([{ titre: 'Gros œuvre', perimetre: 'x' }, { titre: 'Charpente', perimetre: '' }]);
  });
});

describe('routes plan et generate-lot', () => {
  function seed() {
    const tenantId = makeTenant({ plan: 'enterprise', ai_credit_balance_eur_cents: 5000, agent_billing_mode: 'prepaid', ai_credit_last_refresh: new Date().toISOString() });
    const { token } = makeUser(tenantId, 'admin');
    const projectId = crypto.randomUUID();
    const docId = crypto.randomUUID();
    fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Salle polyvalente' }]);
    fakeSupabaseAdmin.seed('documents', [{ id: docId, tenant_id: tenantId, project_id: projectId, name: 'plan.pdf', file_url: 'x' }]);
    return { token, projectId, docId };
  }
  const reply = (text: string) => ({ text, toolCalls: [], usage: { inputTokens: 100, outputTokens: 50 } });

  beforeEach(() => chat.mockReset());

  it('le plan rend les lots et envoie les pièces en préfixe de cache', async () => {
    const { token, projectId, docId } = seed();
    chat.mockResolvedValueOnce(reply('{"lots":[{"titre":"Gros œuvre","perimetre":"Dallage"},{"titre":"Charpente"}]}'));
    const res = await request(app).post(`/api/projects/${projectId}/cctp/plan`).set(authHeader(token)).send({ document_ids: [docId] });
    expect(res.status).toBe(200);
    expect(res.body.lots.map((l: any) => l.titre)).toEqual(['Gros œuvre', 'Charpente']);
    expect(chat.mock.calls[0][0].cachePrefix).toContain('PLAN RDC');
  });

  it('un lot réutilise exactement le même préfixe que le plan et ne rédige que ce lot', async () => {
    const { token, projectId, docId } = seed();
    chat.mockResolvedValueOnce(reply('{"lots":[{"titre":"Gros œuvre"}]}'));
    await request(app).post(`/api/projects/${projectId}/cctp/plan`).set(authHeader(token)).send({ document_ids: [docId] });
    chat.mockResolvedValueOnce(reply('{"lots":[{"titre":"Gros œuvre","chapitres":[{"titre":"Dallage","articles":[{"designation":"Dallage BA","description":"12 cm"}]}]}]}'));
    const res = await request(app).post(`/api/projects/${projectId}/cctp/generate-lot`).set(authHeader(token))
      .send({ document_ids: [docId], lot: { titre: 'Gros œuvre', perimetre: 'Dallage' }, other_lots: ['Gros œuvre', 'Charpente'] });
    expect(res.status).toBe(200);
    expect(res.body.lot.chapitres[0].articles[0].designation).toBe('Dallage BA');
    expect(chat.mock.calls[1][0].cachePrefix).toBe(chat.mock.calls[0][0].cachePrefix);
    expect(chat.mock.calls[1][0].messages[0].content).toContain('« Gros œuvre »');
    expect(chat.mock.calls[1][0].messages[0].content).toContain('Charpente');
  });

  it('refuse un lot sans titre et une réponse illisible', async () => {
    const { token, projectId, docId } = seed();
    const bad = await request(app).post(`/api/projects/${projectId}/cctp/generate-lot`).set(authHeader(token)).send({ document_ids: [docId], lot: {} });
    expect(bad.status).toBe(400);
    chat.mockResolvedValueOnce(reply('pas du JSON'));
    const res = await request(app).post(`/api/projects/${projectId}/cctp/generate-lot`).set(authHeader(token)).send({ document_ids: [docId], lot: { titre: 'Gros œuvre' } });
    expect(res.status).toBe(502);
  });

  it('read-piece lit une pièce une seule fois : le plan réutilise son texte sans relire', async () => {
    const agents: any = await import('@zinkh/archioffice-agents/server');
    const { token, projectId, docId } = seed();
    agents.extractKnowledgeDocText.mockClear();
    const lue = await request(app).post(`/api/projects/${projectId}/cctp/read-piece`).set(authHeader(token)).send({ document_id: docId });
    expect(lue.status).toBe(200);
    expect(lue.body).toMatchObject({ name: 'plan.pdf', read: true });
    expect(lue.body.chars).toBeGreaterThan(0);
    chat.mockResolvedValueOnce(reply('{"lots":[{"titre":"Gros œuvre"}]}'));
    const plan = await request(app).post(`/api/projects/${projectId}/cctp/plan`).set(authHeader(token)).send({ document_ids: [docId] });
    expect(plan.status).toBe(200);
    expect(agents.extractKnowledgeDocText).toHaveBeenCalledTimes(1);
  });

  it('read-piece : pièce d\'une autre affaire ou absente refusée, pièce illisible signalée', async () => {
    const agents: any = await import('@zinkh/archioffice-agents/server');
    const { token, projectId, docId } = seed();
    const autre = await request(app).post(`/api/projects/${crypto.randomUUID()}/cctp/read-piece`).set(authHeader(token)).send({ document_id: docId });
    expect(autre.status).toBe(404);
    const sans = await request(app).post(`/api/projects/${projectId}/cctp/read-piece`).set(authHeader(token)).send({});
    expect(sans.status).toBe(400);
    agents.extractKnowledgeDocText.mockResolvedValueOnce(null);
    const illisible = await request(app).post(`/api/projects/${projectId}/cctp/read-piece`).set(authHeader(token)).send({ document_id: docId });
    expect(illisible.status).toBe(200);
    expect(illisible.body).toMatchObject({ read: false, chars: 0 });
  });

  it('crédit épuisé : 402 sans appel au modèle', async () => {
    const { token, projectId, docId } = seed();
    const tenants = fakeSupabaseAdmin.getTable('tenants');
    tenants[tenants.length - 1].ai_credit_balance_eur_cents = 0;
    const res = await request(app).post(`/api/projects/${projectId}/cctp/plan`).set(authHeader(token)).send({ document_ids: [docId] });
    expect(res.status).toBe(402);
    expect(chat).not.toHaveBeenCalled();
  });
});
