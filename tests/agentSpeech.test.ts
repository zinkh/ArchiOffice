// Synthèse vocale des réponses du chat : l'adaptateur Gemini TTS (qui rend du
// PCM brut, enveloppé ici dans un conteneur WAV lisible par un `<audio>`), le
// fait que la voix passe toujours par le modèle TTS dédié quel que soit le
// fournisseur choisi pour le chat, et la route POST /api/agents/speak de
// bout en bout.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { createGeminiProvider, DEFAULT_GEMINI_TTS_MODEL } from '../packages/archioffice-agents/src/server/llm/gemini';
import { resolveSpeechProvider } from '../packages/archioffice-agents/src/server/llm/index';
import { LlmNotConfiguredError } from '../packages/archioffice-agents/src/server/llm/types';

let app: Express;
const savedEnv = { ...process.env };

/** Du PCM plausible — le contenu n'a pas d'importance, seul l'emballage WAV
 *  est sous test ici. */
const PCM = Buffer.alloc(2000, 5);

function mockSpeech(pcm: Buffer = PCM, usageMetadata: Record<string, any> = {}) {
  generateContent.mockResolvedValue({
    candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString('base64') } }] } }],
    usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 400, ...usageMetadata },
  });
}

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  app = await getTestApp();
});

beforeEach(() => {
  generateContent.mockReset();
  mockSpeech();
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
});

afterEach(() => {
  for (const key of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_PROVIDER', 'AI_MODEL']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

afterAll(() => { vi.restoreAllMocks(); });

describe('adaptateur Gemini — synthèse vocale', () => {
  it('demande une sortie audio, avec la langue et la voix demandées', async () => {
    await createGeminiProvider({ apiKey: 'k', model: DEFAULT_GEMINI_TTS_MODEL }).speak!({
      text: 'Le devis est prêt.',
      language: 'fr-FR',
      voice: 'Kore',
    });

    const payload = generateContent.mock.calls[0][0];
    expect(payload.model).toBe(DEFAULT_GEMINI_TTS_MODEL);
    expect(payload.contents[0].parts[0].text).toBe('Le devis est prêt.');
    expect(payload.config.responseModalities).toEqual(['AUDIO']);
    expect(payload.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
    expect(payload.config.speechConfig.languageCode).toBe('fr-FR');
  });

  it('choisit une voix par défaut quand aucune n\'est demandée', async () => {
    await createGeminiProvider({ apiKey: 'k', model: DEFAULT_GEMINI_TTS_MODEL }).speak!({ text: 'Bonjour.' });
    const voiceName = generateContent.mock.calls[0][0].config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName;
    expect(typeof voiceName).toBe('string');
    expect(voiceName.length).toBeGreaterThan(0);
  });

  it('enveloppe le PCM renvoyé dans un conteneur WAV lisible', async () => {
    const result = await createGeminiProvider({ apiKey: 'k', model: DEFAULT_GEMINI_TTS_MODEL }).speak!({ text: 'Bonjour.' });
    expect(result.audio.mimeType).toBe('audio/wav');
    const wav = result.audio.data;
    // En-tête RIFF/WAVE et bloc 'data' portant le PCM d'origine intact — voir
    // pcmToWav() dans gemini.ts.
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.length).toBe(44 + PCM.length);
    expect(wav.subarray(44)).toEqual(PCM);
  });

  it('rapporte les jetons texte en entrée et audio en sortie', async () => {
    const result = await createGeminiProvider({ apiKey: 'k', model: DEFAULT_GEMINI_TTS_MODEL }).speak!({ text: 'Bonjour.' });
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 400 });
  });

  it('échoue explicitement si le fournisseur ne renvoie aucun audio', async () => {
    generateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'oups' }] } }], usageMetadata: {} });
    await expect(createGeminiProvider({ apiKey: 'k', model: DEFAULT_GEMINI_TTS_MODEL }).speak!({ text: 'Bonjour.' }))
      .rejects.toThrow(/aucun audio/);
  });
});

describe('choix du fournisseur de synthèse vocale', () => {
  it('passe toujours par le modèle TTS dédié, même si le chat tourne sur un autre fournisseur', () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
    const provider = resolveSpeechProvider({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(provider.id).toBe('gemini');
    expect(provider.model).toBe(DEFAULT_GEMINI_TTS_MODEL);
    expect(typeof provider.speak).toBe('function');
  });

  it('refuse explicitement sans clé Gemini', () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => resolveSpeechProvider({})).toThrow(LlmNotConfiguredError);
  });
});

describe('POST /api/agents/speak', () => {
  function seedTenant(over: Record<string, any> = {}) {
    const tenantId = makeTenant({
      plan: 'enterprise',
      ai_credit_balance_eur_cents: 5000,
      agent_billing_mode: 'prepaid',
      ai_credit_last_refresh: new Date().toISOString(),
      ...over,
    });
    const { userId, token } = makeUser(tenantId, 'admin');
    return { tenantId, userId, token };
  }

  const post = (token: string, body: Record<string, any>) =>
    request(app).post('/api/agents/speak').set(authHeader(token)).send(body);

  it('rend un fichier WAV', async () => {
    const { token } = seedTenant();
    const res = await post(token, { text: 'Le devis est prêt pour la villa Martin.' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/wav');
    expect(Buffer.from(res.body).subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('facture la synthèse sur le crédit IA, en la marquant comme telle', async () => {
    const { tenantId, token } = seedTenant();
    const res = await post(token, { text: 'Bonjour, voici votre compte rendu.' });

    const usage = fakeSupabaseAdmin.getTable('agent_token_usage').filter(u => u.tenant_id === tenantId);
    expect(usage).toHaveLength(1);
    expect(usage[0].endpoint_type).toBe('speech');
    expect(usage[0].provider).toBe('gemini');
    expect(usage[0].model).toBe(DEFAULT_GEMINI_TTS_MODEL);
    expect(usage[0].cost_eur_cents).toBeGreaterThan(0);

    const tenant = fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId);
    expect(tenant?.ai_credit_balance_eur_cents).toBe(5000 - usage[0].cost_eur_cents);
    expect(Number(res.headers['x-cost-eur-cents'])).toBe(usage[0].cost_eur_cents);
  });

  it("n'écrit jamais dans la conversation de l'agent", async () => {
    // La synthèse lit un texte déjà affiché ; elle n'a rien à voir avec le
    // fil de la conversation elle-même.
    const { tenantId, token } = seedTenant();
    await post(token, { text: 'Bonjour.' });
    expect(fakeSupabaseAdmin.getTable('agent_messages').filter(m => m.tenant_id === tenantId)).toHaveLength(0);
  });

  it('refuse un texte manquant ou vide', async () => {
    const { token } = seedTenant();
    const res = await post(token, { text: '   ' });
    expect(res.status).toBe(400);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('refuse un texte trop long avant d\'appeler le fournisseur', async () => {
    const { token } = seedTenant();
    const res = await post(token, { text: 'a'.repeat(5000) });
    expect(res.status).toBe(400);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('réserve la synthèse au plan Enterprise, comme le reste des agents', async () => {
    const { token } = seedTenant({ plan: 'pro' });
    const res = await post(token, { text: 'Bonjour.' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ENTERPRISE_REQUIRED');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('refuse sur un crédit épuisé avant d\'appeler le fournisseur', async () => {
    const { token } = seedTenant({ ai_credit_balance_eur_cents: 0 });
    const res = await post(token, { text: 'Bonjour.' });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('NO_TOKENS');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('exige une authentification', async () => {
    const res = await request(app).post('/api/agents/speak').send({ text: 'Bonjour.' });
    expect(res.status).toBe(401);
  });
});
