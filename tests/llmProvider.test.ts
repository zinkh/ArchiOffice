// Provider-neutral LLM layer (packages/archioffice-agents/src/server/llm/):
// the message → vendor-payload mapping and the response → LlmChatResult
// mapping, against a mocked @google/genai. This is the piece the agent chat
// loop and the CCTP suggestions both sit on, and the piece a second provider
// has to reproduce exactly, so it's pinned here rather than only exercised
// end-to-end through a live model.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
    constructor(public opts: any) {}
  },
}));

import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from '../packages/archioffice-agents/src/server/llm/gemini';
import { resolveLlmProvider, LlmNotConfiguredError } from '../packages/archioffice-agents/src/server/llm/index';
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
    await createGeminiProvider({ apiKey: 'k', model: 'gemini-3-pro-preview' }).chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(generateContent.mock.calls[0][0].model).toBe('gemini-3-pro-preview');
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

  it('prefers an explicitly passed key over the environment', () => {
    process.env.GEMINI_API_KEY = 'env-key';
    expect(resolveLlmProvider({ apiKey: 'tenant-key', model: 'gemini-3-pro-preview' }).model).toBe('gemini-3-pro-preview');
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
