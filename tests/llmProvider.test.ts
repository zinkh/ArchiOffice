// Provider-neutral LLM layer (packages/archioffice-agents/src/server/llm/):
// the message → vendor-payload mapping and the response → LlmChatResult
// mapping, against a mocked @google/genai. This is the piece the agent chat
// loop and the CCTP suggestions both sit on, and the piece a second provider
// has to reproduce exactly, so it's pinned here rather than only exercised
// end-to-end through a live model.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent, anthropicCreate } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  anthropicCreate: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
    constructor(public opts: any) {}
  },
}));

import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from '../packages/archioffice-agents/src/server/llm/gemini';
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from '../packages/archioffice-agents/src/server/llm/anthropic';
import { createMistralProvider, DEFAULT_MISTRAL_MODEL } from '../packages/archioffice-agents/src/server/llm/mistral';
import { priceEurCents, isPricedModel, listPricedModels } from '../packages/archioffice-agents/src/server/llm/pricing';
import { resolveLlmProvider, describeLlmSelection, LlmNotConfiguredError } from '../packages/archioffice-agents/src/server/llm/index';
import type { LlmMessage, LlmToolDef } from '../packages/archioffice-agents/src/server/llm/types';

function mockResponse(over: Record<string, any> = {}) {
  generateContent.mockResolvedValue({
    text: 'Bonjour',
    functionCalls: [],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
    ...over,
  });
}

const provider = () => createGeminiProvider({ apiKey: 'test-key' });

describe('Gemini adapter — request mapping', () => {
  beforeEach(() => {
    generateContent.mockReset();
    mockResponse();
  });

  it('sends the system instruction out of band and maps user/assistant turns', async () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: 'Bonjour, comment puis-je aider ?' },
      { role: 'user', content: 'Liste mes projets' },
    ];
    await provider().chat({ system: 'Tu es Sophie.', messages });

    const payload = generateContent.mock.calls[0][0];
    expect(payload.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(payload.config.systemInstruction).toBe('Tu es Sophie.');
    expect(payload.contents).toEqual([
      { role: 'user', parts: [{ text: 'Bonjour' }] },
      { role: 'model', parts: [{ text: 'Bonjour, comment puis-je aider ?' }] },
      { role: 'user', parts: [{ text: 'Liste mes projets' }] },
    ]);
  });

  it('maps a tool round: functionCall on the model turn, functionResponse on a user turn', async () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: 'Crée le contact Dupont' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ name: 'create_record', args: { resource: 'contacts', data: { last_name: 'Dupont' } } }],
      },
      { role: 'tool', results: [{ name: 'create_record', response: { success: true, id: 'c1' } }] },
    ];
    await provider().chat({ messages });

    expect(generateContent.mock.calls[0][0].contents).toEqual([
      { role: 'user', parts: [{ text: 'Crée le contact Dupont' }] },
      {
        role: 'model',
        parts: [{ functionCall: { name: 'create_record', args: { resource: 'contacts', data: { last_name: 'Dupont' } } } }],
      },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'create_record', response: { success: true, id: 'c1' } } }],
      },
    ]);
  });

  it("rejoue les parts d'origine du modèle, avec leur signature de raisonnement", async () => {
    // Gemini 3 attache un thoughtSignature à chaque functionCall et exige de
    // le retrouver intact au tour suivant. Reconstruire l'appel à partir du
    // seul couple (nom, arguments) le perd, et l'API répond alors 400
    // « Function call is missing a thought_signature in functionCall parts »
    // dès le deuxième appel d'outil d'un même échange.
    const rawParts = [
      { text: 'Je vérifie.' },
      { functionCall: { name: 'search_records', args: { resource: 'contacts', query: 'Boublenza' } }, thoughtSignature: 'sig-abc123' },
    ];
    const messages: LlmMessage[] = [
      { role: 'user', content: 'Crée le devis pour Boublenza' },
      {
        role: 'assistant',
        content: 'Je vérifie.',
        toolCalls: [{ name: 'search_records', args: { resource: 'contacts', query: 'Boublenza' } }],
        raw: rawParts,
      },
      { role: 'tool', results: [{ name: 'search_records', response: { count: 0, matches: [] } }] },
    ];
    await provider().chat({ messages });

    expect(generateContent.mock.calls[0][0].contents[1]).toEqual({ role: 'model', parts: rawParts });
  });

  it('reconstruit le tour du modèle quand aucune part d\'origine n\'est disponible', async () => {
    // Chemin de repli : une conversation reprise depuis l'historique stocké
    // ne porte que du texte, sans parts ni signature — elle doit continuer à
    // fonctionner.
    const messages: LlmMessage[] = [
      { role: 'user', content: 'Et ensuite ?' },
      { role: 'assistant', content: 'Voici la suite.', raw: [] },
    ];
    await provider().chat({ messages });

    expect(generateContent.mock.calls[0][0].contents[1]).toEqual({ role: 'model', parts: [{ text: 'Voici la suite.' }] });
  });

  it('keeps text and tool calls together on a single model turn', async () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: 'Vérifie puis crée' },
      { role: 'assistant', content: 'Je vérifie.', toolCalls: [{ name: 'search_records', args: { query: 'Dupont' } }] },
    ];
    await provider().chat({ messages });

    expect(generateContent.mock.calls[0][0].contents[1]).toEqual({
      role: 'model',
      parts: [{ text: 'Je vérifie.' }, { functionCall: { name: 'search_records', args: { query: 'Dupont' } } }],
    });
  });

  it('drops a blank assistant turn, which the API rejects as an empty parts array', async () => {
    // This is the exact turn the agent chat's clarification round pushes.
    const messages: LlmMessage[] = [
      { role: 'user', content: 'Crée le devis' },
      { role: 'assistant', content: '', toolCalls: [] },
      { role: 'user', content: "Qu'est-ce qui te bloque ?" },
    ];
    await provider().chat({ messages });

    expect(generateContent.mock.calls[0][0].contents).toEqual([
      { role: 'user', parts: [{ text: 'Crée le devis' }] },
      { role: 'user', parts: [{ text: "Qu'est-ce qui te bloque ?" }] },
    ]);
  });

  it('declares tools only when the agent has some, under functionDeclarations', async () => {
    const tools: LlmToolDef[] = [
      { name: 'create_record', description: 'Crée', parametersJsonSchema: { type: 'object', properties: {} } },
    ];

    await provider().chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(generateContent.mock.calls[0][0].config.tools).toBeUndefined();

    await provider().chat({ messages: [{ role: 'user', content: 'x' }], tools });
    expect(generateContent.mock.calls[1][0].config.tools).toEqual([{ functionDeclarations: tools }]);
  });

  it('honours an explicit model override', async () => {
    await createGeminiProvider({ apiKey: 'k', model: 'gemini-2.5-flash' }).chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(generateContent.mock.calls[0][0].model).toBe('gemini-2.5-flash');
  });

  it('builds the SDK client once and reuses it across the turns of a request', async () => {
    const p = provider();
    await p.chat({ messages: [{ role: 'user', content: 'a' }] });
    await p.chat({ messages: [{ role: 'user', content: 'b' }] });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});

describe('Gemini adapter — response mapping', () => {
  beforeEach(() => generateContent.mockReset());

  it('returns text, tool calls and token usage in neutral form', async () => {
    mockResponse({
      text: 'Voici vos projets.',
      functionCalls: [{ name: 'search_records', args: { resource: 'projects', query: 'école' } }],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 340 },
    });

    const result = await provider().chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.text).toBe('Voici vos projets.');
    expect(result.toolCalls).toEqual([{ name: 'search_records', args: { resource: 'projects', query: 'école' } }]);
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 340 });
  });

  it("remonte les parts d'origine du modèle pour qu'elles puissent être rejouées", async () => {
    const parts = [
      { functionCall: { name: 'create_record', args: { resource: 'proposals' } }, thoughtSignature: 'sig-xyz' },
    ];
    mockResponse({
      text: '',
      functionCalls: [{ name: 'create_record', args: { resource: 'proposals' } }],
      candidates: [{ content: { parts } }],
    });

    const result = await provider().chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.raw).toEqual(parts);
  });

  it('normalizes a blank turn to empty text, no tool calls and zeroed usage', async () => {
    // Gemini can end a tool-calling turn with neither text nor calls, and
    // omits usageMetadata entirely on some responses — the chat route reads
    // these fields unconditionally, so they must never be undefined.
    generateContent.mockResolvedValue({});
    const result = await provider().chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(result).toEqual({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } });
  });
});

describe('resolveLlmProvider', () => {
  const original = process.env.GEMINI_API_KEY;
  afterEach(() => { process.env.GEMINI_API_KEY = original; });

  it('defaults to Gemini on the process-wide key', () => {
    process.env.GEMINI_API_KEY = 'env-key';
    const p = resolveLlmProvider();
    expect(p.id).toBe('gemini');
    expect(p.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('resolves with an explicitly passed key even when the environment has none', () => {
    // The BYOK path of step 3: the tenant's own key, no process-wide key.
    delete process.env.GEMINI_API_KEY;
    const p = resolveLlmProvider({ apiKey: 'tenant-key' });
    expect(p.id).toBe('gemini');
    expect(p.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('throws a typed, catchable error when no key is configured — the routes 503', () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => resolveLlmProvider()).toThrow(LlmNotConfiguredError);
    try {
      resolveLlmProvider();
    } catch (e: any) {
      expect(e.code).toBe('LLM_NOT_CONFIGURED');
      expect(e.message).toBe('Gemini API key not configured');
    }
  });

  it('rejects an unknown provider rather than silently falling back to Gemini', () => {
    process.env.GEMINI_API_KEY = 'env-key';
    expect(() => resolveLlmProvider({ provider: 'anthropic' })).toThrow(LlmNotConfiguredError);
  });
});

// ── Step 2: Anthropic + Mistral adapters and per-model pricing ──────────────

describe('Anthropic adapter', () => {
  beforeEach(() => {
    anthropicCreate.mockReset();
    anthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Bonjour' }],
      usage: { input_tokens: 10, output_tokens: 4 },
      stop_reason: 'end_turn',
    });
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: anthropicCreate };
        constructor(public opts: any) {}
      },
    }));
  });

  // The adapter imports the SDK lazily, so doMock above is in place by the
  // time chat() runs; a fresh provider per test picks up the current mock.
  const provider = () => createAnthropicProvider({ apiKey: 'k' });

  it('sends the system prompt out of band and maps tool definitions to input_schema', async () => {
    await provider().chat({
      system: 'Tu es Sophie.',
      messages: [{ role: 'user', content: 'Bonjour' }],
      tools: [{ name: 'create_record', description: 'Crée', parametersJsonSchema: { type: 'object', properties: {} } }],
    });

    const payload = anthropicCreate.mock.calls[0][0];
    expect(payload.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(payload.system).toBe('Tu es Sophie.');
    expect(payload.tools).toEqual([
      { name: 'create_record', description: 'Crée', input_schema: { type: 'object', properties: {} } },
    ]);
  });

  it('correlates tool results with their call by id', async () => {
    await provider().chat({
      messages: [
        { role: 'user', content: 'Crée le contact' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_42', name: 'create_record', args: { x: 1 } }] },
        { role: 'tool', results: [{ id: 'toolu_42', name: 'create_record', response: { success: true } }] },
      ],
    });

    const [assistant, toolTurn] = anthropicCreate.mock.calls[0][0].messages.slice(1);
    expect(assistant).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_42', name: 'create_record', input: { x: 1 } }],
    });
    expect(toolTurn).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_42', content: '{"success":true}' }],
    });
  });

  it('pairs a call and its result by position when no id is present', async () => {
    // A conversation whose earlier turns were produced by Gemini, which has
    // no call ids, then continued on Claude — which rejects a tool_result
    // whose tool_use_id matches nothing.
    await provider().chat({
      messages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: '', toolCalls: [{ name: 'search_records', args: {} }] },
        { role: 'tool', results: [{ name: 'search_records', response: { count: 0 } }] },
      ],
    });

    const [assistant, toolTurn] = anthropicCreate.mock.calls[0][0].messages.slice(1);
    expect(assistant.content[0].id).toBe('tool_0');
    expect(toolTurn.content[0].tool_use_id).toBe('tool_0');
  });

  it('replays the provider blocks verbatim so thinking blocks survive the round trip', async () => {
    const raw = [
      { type: 'thinking', thinking: '', signature: 'sig-abc' },
      { type: 'tool_use', id: 'toolu_1', name: 'search_records', input: {} },
    ];
    await provider().chat({
      messages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_1', name: 'search_records', args: {} }], raw },
        { role: 'tool', results: [{ id: 'toolu_1', name: 'search_records', response: {} }] },
      ],
    });

    expect(anthropicCreate.mock.calls[0][0].messages[1]).toEqual({ role: 'assistant', content: raw });
  });

  it('returns text, tool calls, usage and the raw blocks', async () => {
    anthropicCreate.mockResolvedValue({
      content: [
        { type: 'text', text: 'Je crée le contact.' },
        { type: 'tool_use', id: 'toolu_9', name: 'create_record', input: { resource: 'contacts' } },
      ],
      usage: { input_tokens: 900, output_tokens: 120 },
      stop_reason: 'tool_use',
    });

    const result = await provider().chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.text).toBe('Je crée le contact.');
    expect(result.toolCalls).toEqual([{ id: 'toolu_9', name: 'create_record', args: { resource: 'contacts' } }]);
    expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 120 });
    expect(result.raw).toHaveLength(2);
  });

  it('turns a safety refusal into a plain message instead of an empty turn', async () => {
    // A refusal is HTTP 200 with empty content; left unhandled the chat route
    // would read it as "the model went quiet" and spend another call asking
    // what went wrong.
    anthropicCreate.mockResolvedValue({
      content: [],
      usage: { input_tokens: 50, output_tokens: 0 },
      stop_reason: 'refusal',
    });

    const result = await provider().chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.text).toContain('refusé');
    expect(result.toolCalls).toEqual([]);
    expect(result.usage.inputTokens).toBe(50);
  });
});

describe('Mistral adapter', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Bonjour', tool_calls: [] } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  const provider = () => createMistralProvider({ apiKey: 'k' });
  const body = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  it('sends the system prompt as the leading message and authenticates as a bearer token', async () => {
    await provider().chat({ system: 'Tu es Sophie.', messages: [{ role: 'user', content: 'Bonjour' }] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(body().model).toBe(DEFAULT_MISTRAL_MODEL);
    expect(body().messages[0]).toEqual({ role: 'system', content: 'Tu es Sophie.' });
  });

  it('serializes tool call arguments and emits one message per tool result', async () => {
    await provider().chat({
      messages: [
        { role: 'user', content: 'x' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'c1', name: 'create_record', args: { resource: 'contacts' } },
            { id: 'c2', name: 'search_records', args: { query: 'Dupont' } },
          ],
        },
        {
          role: 'tool',
          results: [
            { id: 'c1', name: 'create_record', response: { success: true } },
            { id: 'c2', name: 'search_records', response: { count: 2 } },
          ],
        },
      ],
    });

    const msgs = body().messages;
    expect(msgs[1].tool_calls[0].function).toEqual({ name: 'create_record', arguments: '{"resource":"contacts"}' });
    // OpenAI-shaped APIs take one message per result, not one holding all.
    expect(msgs[2]).toEqual({ role: 'tool', name: 'create_record', tool_call_id: 'c1', content: '{"success":true}' });
    expect(msgs[3]).toEqual({ role: 'tool', name: 'search_records', tool_call_id: 'c2', content: '{"count":2}' });
  });

  it('declares tools under the function wrapper', async () => {
    await provider().chat({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'create_record', description: 'Crée', parametersJsonSchema: { type: 'object' } }],
    });
    expect(body().tools).toEqual([
      { type: 'function', function: { name: 'create_record', description: 'Crée', parameters: { type: 'object' } } },
    ]);
    expect(body().tool_choice).toBe('auto');
  });

  it('parses tool arguments returned as a JSON string', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'c1', function: { name: 'create_record', arguments: '{"resource":"contacts"}' } }],
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    });

    const result = await provider().chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([{ id: 'c1', name: 'create_record', args: { resource: 'contacts' } }]);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it('falls back to empty arguments rather than throwing on malformed JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'x', arguments: '{oops' } }] } }],
        usage: {},
      }),
    });
    const result = await provider().chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.toolCalls[0].args).toEqual({});
  });

  it('raises an error carrying the provider status on a failed call', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });
    await expect(provider().chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/401/);
  });
});

describe('Per-model pricing', () => {
  const originalMarkup = process.env.AI_PRICE_MARKUP;
  afterEach(() => {
    if (originalMarkup === undefined) delete process.env.AI_PRICE_MARKUP;
    else process.env.AI_PRICE_MARKUP = originalMarkup;
  });

  it('reproduces the flat rates it replaces, to the cent', () => {
    // The rates removed from server.ts were €0.67/M input and €4.00/M output
    // for gemini-3-flash-preview. Both must still come out unchanged, or
    // this step silently re-prices every existing tenant.
    delete process.env.AI_PRICE_MARKUP;
    expect(priceEurCents('gemini', 'gemini-3-flash-preview', 1_000_000, 0)).toBe(67);
    expect(priceEurCents('gemini', 'gemini-3-flash-preview', 0, 1_000_000)).toBe(400);
  });

  it('charges a Claude Opus call far more than the same call on Gemini Flash', () => {
    delete process.env.AI_PRICE_MARKUP;
    const gemini = priceEurCents('gemini', 'gemini-3-flash-preview', 1_000_000, 100_000);
    const opus = priceEurCents('anthropic', 'claude-opus-5', 1_000_000, 100_000);
    // The gap this whole table exists to stop being invisible.
    expect(opus).toBeGreaterThan(gemini * 5);
  });

  it('prices the EU-hosted Mistral models below the Gemini default', () => {
    delete process.env.AI_PRICE_MARKUP;
    expect(priceEurCents('mistral', 'mistral-large-latest', 0, 1_000_000))
      .toBeLessThan(priceEurCents('gemini', 'gemini-3-flash-preview', 0, 1_000_000));
  });

  it('applies AI_PRICE_MARKUP as the single margin knob', () => {
    process.env.AI_PRICE_MARKUP = '2';
    expect(priceEurCents('gemini', 'gemini-3-flash-preview', 0, 1_000_000)).toBe(600); // 3.00 x 2
  });

  it('never bills zero: a sub-cent call still costs one cent', () => {
    delete process.env.AI_PRICE_MARKUP;
    expect(priceEurCents('gemini', 'gemini-3-flash-preview', 1, 1)).toBe(1);
  });

  it('bills an unpriced model at the highest known rate rather than nothing', () => {
    delete process.env.AI_PRICE_MARKUP;
    const unknown = priceEurCents('anthropic', 'claude-some-future-model', 0, 1_000_000);
    expect(unknown).toBe(priceEurCents('anthropic', 'claude-opus-5', 0, 1_000_000));
  });

  it('knows exactly which models may run', () => {
    expect(isPricedModel('anthropic', 'claude-opus-5')).toBe(true);
    expect(isPricedModel('anthropic', 'claude-opus-4-1')).toBe(false);
    expect(listPricedModels().map(m => `${m.provider}/${m.model}`)).toContain('mistral/mistral-large-latest');
  });

  it('prices the Mistral rows at their published rates', () => {
    // Pinned against https://mistral.ai/pricing (Sept. 2026): Large 3 at
    // $0.50/$1.50, Medium 3.5 at $1.50/$7.50, Small 4 at $0.15/$0.60. Medium
    // is the tool-calling one and by far the priciest of the three — the kind
    // of gap that used to be invisible under a single flat rate.
    process.env.AI_PRICE_MARKUP = '1';
    expect(priceEurCents('mistral', 'mistral-large-latest', 1_000_000, 1_000_000)).toBe(200);
    expect(priceEurCents('mistral', 'mistral-medium-latest', 1_000_000, 1_000_000)).toBe(900);
    expect(priceEurCents('mistral', 'mistral-small-latest', 1_000_000, 1_000_000)).toBe(75);
  });
});

describe('resolveLlmProvider — multi-provider', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env.GEMINI_API_KEY = saved.GEMINI_API_KEY;
    process.env.ANTHROPIC_API_KEY = saved.ANTHROPIC_API_KEY;
    process.env.MISTRAL_API_KEY = saved.MISTRAL_API_KEY;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
  });

  it('resolves Claude and Mistral from their own environment keys', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.MISTRAL_API_KEY = 'mist-test';
    expect(resolveLlmProvider({ provider: 'anthropic' }).model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(resolveLlmProvider({ provider: 'mistral' }).id).toBe('mistral');
  });

  it('lets AI_PROVIDER move the whole instance off Gemini', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.AI_PROVIDER = 'anthropic';
    expect(resolveLlmProvider().id).toBe('anthropic');
  });

  it('refuses a model that carries no price, rather than billing an invented amount', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(() => resolveLlmProvider({ provider: 'anthropic', model: 'claude-imaginary-9' }))
      .toThrow(LlmNotConfiguredError);
  });

  it('names the missing environment variable when a provider has no key', () => {
    delete process.env.MISTRAL_API_KEY;
    try {
      resolveLlmProvider({ provider: 'mistral' });
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.code).toBe('LLM_NOT_CONFIGURED');
      expect(e.message).toContain('MISTRAL_API_KEY');
    }
  });
});

describe('describeLlmSelection — precedence', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env.AI_PROVIDER = saved.AI_PROVIDER;
    process.env.AI_MODEL = saved.AI_MODEL;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
  });

  it('falls back to Gemini when nothing is set anywhere', () => {
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    expect(describeLlmSelection()).toEqual({
      provider: 'gemini',
      model: DEFAULT_GEMINI_MODEL,
      source: 'default',
    });
  });

  it('reads the environment when no override is given', () => {
    process.env.AI_PROVIDER = 'mistral';
    process.env.AI_MODEL = 'mistral-small-latest';
    expect(describeLlmSelection()).toEqual({
      provider: 'mistral',
      model: 'mistral-small-latest',
      source: 'environment',
    });
  });

  it('lets the override win over the environment — the point of the admin switch', () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = DEFAULT_GEMINI_MODEL;
    expect(describeLlmSelection({ provider: 'anthropic', model: 'claude-sonnet-5' })).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      source: 'override',
    });
  });

  it("never pairs one source's provider with another source's model", () => {
    // The trap: an instance pinned to a Gemini model, switched to Anthropic
    // from the back-office. Taking the provider from the override and the
    // model from AI_MODEL would ask Claude for a Gemini model and fail on
    // every call. The provider's own default is used instead.
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = DEFAULT_GEMINI_MODEL;
    expect(describeLlmSelection({ provider: 'anthropic' })).toEqual({
      provider: 'anthropic',
      model: DEFAULT_ANTHROPIC_MODEL,
      source: 'override',
    });
  });

  it('resolves that same pair into a runnable provider', () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = DEFAULT_GEMINI_MODEL;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const p = resolveLlmProvider({ provider: 'anthropic' });
    expect(p.id).toBe('anthropic');
    expect(p.model).toBe(DEFAULT_ANTHROPIC_MODEL);
  });
});
