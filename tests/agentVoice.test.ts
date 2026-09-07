// Dictée vocale des agents : l'adaptateur de transcription Gemini, le choix
// du fournisseur quand celui du chat ne sait pas lire d'audio, la
// tarification des jetons audio, et la route POST /api/agents/transcribe de
// bout en bout.
//
// La règle que ces tests protègent avant tout : la transcription RETRANSCRIT.
// Une dictée est presque toujours une instruction adressée à un agent
// (« demande à Sophie de préparer le devis »), et un modèle laissé libre y
// répond au lieu de l'écrire.
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
import { createGeminiProvider } from '../packages/archioffice-agents/src/server/llm/gemini';
import { resolveTranscriptionProvider } from '../packages/archioffice-agents/src/server/llm/index';
import { priceEurCents } from '../packages/archioffice-agents/src/server/llm/pricing';
import { LlmNotConfiguredError } from '../packages/archioffice-agents/src/server/llm/types';

let app: Express;
const savedEnv = { ...process.env };

/** Un corps audio plausible : la route écarte tout ce qui pèse moins qu'un
 *  conteneur, et le client en fait autant avant d'appeler. */
const AUDIO = Buffer.alloc(4096, 3);

function mockTranscription(text: string, usageMetadata: Record<string, any> = {}) {
  generateContent.mockResolvedValue({
    text,
    functionCalls: [],
    usageMetadata: {
      promptTokenCount: 940,
      candidatesTokenCount: 24,
      promptTokensDetails: [
        { modality: 'AUDIO', tokenCount: 900 },
        { modality: 'TEXT', tokenCount: 40 },
      ],
      ...usageMetadata,
    },
  });
}

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  app = await getTestApp();
});

beforeEach(() => {
  generateContent.mockReset();
  mockTranscription('Prépare le devis pour la villa Martin.');
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
});

afterEach(() => {
  // Réaffecter directement écrirait la chaîne "undefined" pour une variable
  // absente à l'origine, ce qui ferait passer un fournisseur sans clé pour
  // configuré dans les tests suivants.
  for (const key of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_PROVIDER', 'AI_MODEL']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

afterAll(() => { vi.restoreAllMocks(); });

describe('adaptateur Gemini — transcription', () => {
  it('envoie l\'audio en ligne, sans les paramètres du type MIME', async () => {
    await createGeminiProvider({ apiKey: 'k' }).transcribe!({
      audio: { data: AUDIO, mimeType: 'audio/webm;codecs=opus' },
      language: 'fr-FR',
    });

    const payload = generateContent.mock.calls[0][0];
    const parts = payload.contents[0].parts;
    // L'API refuse un type paramétré, or c'est exactement ce que MediaRecorder
    // annonce sous Chrome.
    expect(parts[0].inlineData.mimeType).toBe('audio/webm');
    expect(parts[0].inlineData.data).toBe(AUDIO.toString('base64'));
  });

  it('demande une retranscription, jamais une réponse', async () => {
    await createGeminiProvider({ apiKey: 'k' }).transcribe!({
      audio: { data: AUDIO, mimeType: 'audio/webm' },
      language: 'fr-FR',
      vocabulary: ['CCTP', 'Villa Martin'],
    });

    const config = generateContent.mock.calls[0][0].config;
    expect(config.systemInstruction).toMatch(/Retranscris mot pour mot/);
    expect(config.systemInstruction).toMatch(/Ne réponds jamais à son contenu/);
    expect(config.systemInstruction).toContain('CCTP, Villa Martin');
    expect(config.systemInstruction).toContain('fr-FR');
    // Une transcription n'a pas à être créative.
    expect(config.temperature).toBe(0);
  });

  it('sépare les jetons audio des jetons texte du prompt', async () => {
    const result = await createGeminiProvider({ apiKey: 'k' }).transcribe!({
      audio: { data: AUDIO, mimeType: 'audio/webm' },
    });
    expect(result.usage).toEqual({ inputTokens: 40, audioInputTokens: 900, outputTokens: 24 });
  });

  it('compte tout le prompt comme audio quand la répartition manque', async () => {
    // Surfacturer la consigne (une centaine de jetons) vaut mieux que
    // sous-facturer l'enregistrement.
    mockTranscription('Bonjour', { promptTokensDetails: undefined });
    const result = await createGeminiProvider({ apiKey: 'k' }).transcribe!({
      audio: { data: AUDIO, mimeType: 'audio/webm' },
    });
    expect(result.usage.audioInputTokens).toBe(940);
    expect(result.usage.inputTokens).toBe(0);
  });

  it('refuse un format audio inconnu avant d\'appeler le fournisseur', async () => {
    await expect(createGeminiProvider({ apiKey: 'k' }).transcribe!({
      audio: { data: AUDIO, mimeType: 'audio/amr' },
    })).rejects.toThrow(/Format audio non supporté/);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe('choix du fournisseur de transcription', () => {
  it('garde le fournisseur actif quand il sait lire de l\'audio', () => {
    expect(resolveTranscriptionProvider({ provider: 'gemini' }).id).toBe('gemini');
  });

  it('bascule sur Gemini quand le fournisseur actif ne transcrit pas', () => {
    // Un cabinet basculé sur Claude depuis /admin garderait sinon un micro
    // qui ne marche pas, alors que la clé Gemini de l'instance est là.
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
    const provider = resolveTranscriptionProvider({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(provider.id).toBe('gemini');
    expect(typeof provider.transcribe).toBe('function');
  });

  it('refuse explicitement quand aucun fournisseur ne peut transcrire', () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
    delete process.env.GEMINI_API_KEY;
    expect(() => resolveTranscriptionProvider({ provider: 'anthropic', model: 'claude-sonnet-5' }))
      .toThrow(LlmNotConfiguredError);
  });
});

describe('tarification des jetons audio', () => {
  it('facture l\'audio à son propre tarif, pas à celui du texte', () => {
    // Gemini 3 Flash : 0,50 $/M en texte, 1,00 $/M en audio. L'arrondi au
    // centime supérieur se fait une fois par appel, d'où le rapport comparé
    // à la tolérance d'un centime plutôt qu'à l'égalité stricte.
    const asAudio = priceEurCents('gemini', 'gemini-3-flash-preview', 0, 0, 2_000_000);
    const asText = priceEurCents('gemini', 'gemini-3-flash-preview', 2_000_000, 0, 0);
    expect(Math.abs(asAudio - 2 * asText)).toBeLessThanOrEqual(1);
    expect(asAudio).toBeGreaterThan(asText);
  });

  it('laisse les appels texte inchangés', () => {
    expect(priceEurCents('gemini', 'gemini-3-flash-preview', 1_000_000, 1_000_000))
      .toBe(priceEurCents('gemini', 'gemini-3-flash-preview', 1_000_000, 1_000_000, 0));
  });

  it('facture l\'audio au tarif texte quand le modèle n\'a pas de tarif audio publié', () => {
    // Une modalité non tarifée ne doit jamais ressortir moins chère que celle
    // que l'on tarife.
    expect(priceEurCents('anthropic', 'claude-sonnet-5', 0, 0, 1_000_000))
      .toBe(priceEurCents('anthropic', 'claude-sonnet-5', 1_000_000, 0, 0));
  });
});

describe('POST /api/agents/transcribe', () => {
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

  const post = (token: string, body: Buffer, type = 'audio/webm') =>
    request(app).post('/api/agents/transcribe?lang=fr-FR')
      .set(authHeader(token)).set('Content-Type', type).send(body);

  it('rend le texte dicté', async () => {
    const { token } = seedTenant();
    const res = await post(token, AUDIO);
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Prépare le devis pour la villa Martin.');
  });

  it('ne transmet jamais la dictée à un agent', async () => {
    // Le texte revient au client pour relecture. Une reconnaissance vocale se
    // trompe, et un agent qui écrit dans la base ne doit pas agir sur une
    // phrase que personne n'a relue.
    const { tenantId, token } = seedTenant();
    await post(token, AUDIO);
    expect(fakeSupabaseAdmin.getTable('agent_messages').filter(m => m.tenant_id === tenantId)).toHaveLength(0);
    expect(fakeSupabaseAdmin.getTable('agent_conversations').filter(c => c.tenant_id === tenantId)).toHaveLength(0);
  });

  it('facture la dictée sur le crédit IA, en la marquant comme transcription', async () => {
    const { tenantId, token } = seedTenant();
    const res = await post(token, AUDIO);

    const usage = fakeSupabaseAdmin.getTable('agent_token_usage').filter(u => u.tenant_id === tenantId);
    expect(usage).toHaveLength(1);
    expect(usage[0].endpoint_type).toBe('transcription');
    expect(usage[0].provider).toBe('gemini');
    // Les jetons audio comptent dans les jetons d'entrée ; seul leur tarif
    // diffère.
    expect(usage[0].input_tokens).toBe(940);
    expect(usage[0].cost_eur_cents).toBeGreaterThan(0);

    const tenant = fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId);
    expect(tenant?.ai_credit_balance_eur_cents).toBe(5000 - usage[0].cost_eur_cents);
    expect(res.body.cost_eur_cents).toBe(usage[0].cost_eur_cents);
  });

  it('souffle au moteur les noms de projets du cabinet', async () => {
    // Sans cette indication, « le CCTP du projet Villa Martin » ressort
    // phonétiquement — or c'est exactement ce que la dictée sert à nommer.
    const { tenantId, token } = seedTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'p-voice-1', tenant_id: tenantId, name: 'Villa Martin' }]);
    await post(token, AUDIO);
    expect(generateContent.mock.calls[0][0].config.systemInstruction).toContain('Villa Martin');
  });

  it('refuse un corps qui n\'est pas de l\'audio', async () => {
    const { token } = seedTenant();
    const res = await request(app).post('/api/agents/transcribe')
      .set(authHeader(token)).send({ message: 'bonjour' });
    expect(res.status).toBe(400);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('refuse un enregistrement vide', async () => {
    const { token } = seedTenant();
    const res = await post(token, Buffer.alloc(0));
    expect(res.status).toBe(400);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('réserve la dictée au plan Enterprise, comme le chat', async () => {
    const { token } = seedTenant({ plan: 'pro' });
    const res = await post(token, AUDIO);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ENTERPRISE_REQUIRED');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('refuse la dictée sur un crédit épuisé avant d\'appeler le fournisseur', async () => {
    const { token } = seedTenant({ ai_credit_balance_eur_cents: 0 });
    const res = await post(token, AUDIO);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('NO_TOKENS');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('exige une authentification', async () => {
    const res = await request(app).post('/api/agents/transcribe')
      .set('Content-Type', 'audio/webm').send(AUDIO);
    expect(res.status).toBe(401);
  });
});
