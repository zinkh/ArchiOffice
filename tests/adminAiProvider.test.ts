// Platform AI provider switch (GET/PUT /api/admin/ai-provider): the
// super-admin gate, the three refusals that stop a bad selection from taking
// the whole platform's AI offline, and the fact that API keys never cross
// this boundary.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
// Importé par le sous-chemin du paquet, comme le fait le serveur : un import
// relatif donnerait une seconde instance du module, donc un second cache, et
// vider celui du test ne viderait pas celui que les routes utilisent.
import { invalidatePlatformAiConfigCache, parseStoredConfig } from '@zinkh/archioffice-agents/server/llm';

let app: Express;
const SUPER_ADMIN_EMAIL = 'ai-switch-admin@archioffice.test';

function superAdminToken(): string {
  const token = `super-admin-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fakeSupabaseAdmin.registerUser(token, { id: crypto.randomUUID(), email: SUPER_ADMIN_EMAIL });
  return token;
}

const savedEnv = { ...process.env };

beforeAll(async () => {
  process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
  app = await getTestApp();
});

beforeEach(() => {
  // The stored setting is cached for 30s in-process; each test starts from a
  // clean read.
  invalidatePlatformAiConfigCache();
  // The fake has no reset and seed() appends, so a previous test's row would
  // otherwise survive — and platform_settings holds exactly one row, keyed
  // 'ai_provider'. seed([]) creates the table if needed; splice empties the
  // array the fake actually stores.
  fakeSupabaseAdmin.seed('platform_settings', []);
  fakeSupabaseAdmin.getTable('platform_settings').splice(0);
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
});

afterEach(() => {
  // Restaurer par affectation directe écrirait la chaîne "undefined" pour une
  // variable absente à l'origine — une valeur vraie, qui ferait passer un
  // fournisseur sans clé pour configuré dans les tests suivants.
  for (const key of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'MISTRAL_API_KEY'] as const) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  invalidatePlatformAiConfigCache();
});

describe('GET /api/admin/ai-provider', () => {
  it('is closed to anyone who is not a platform admin', async () => {
    const { token } = makeUser(makeTenant(), 'admin');
    const res = await request(app).get('/api/admin/ai-provider').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('reports the environment default when nothing has been chosen', async () => {
    const res = await request(app).get('/api/admin/ai-provider').set(authHeader(superAdminToken()));
    expect(res.status).toBe(200);
    expect(res.body.current).toMatchObject({ provider: 'gemini', source: 'default' });
  });

  it('marks a provider as unconfigured when its key is missing, and never returns a key', async () => {
    process.env.MISTRAL_API_KEY = 'mistral-test-key';
    const res = await request(app).get('/api/admin/ai-provider').set(authHeader(superAdminToken()));

    const byProvider = Object.fromEntries(res.body.providers.map((p: any) => [p.provider, p]));
    expect(byProvider.gemini.configured).toBe(true);
    expect(byProvider.mistral.configured).toBe(true);
    expect(byProvider.anthropic.configured).toBe(false);
    expect(byProvider.anthropic.envKey).toBe('ANTHROPIC_API_KEY');
    // The models a provider can run are listed, so the UI never has to
    // hardcode them.
    expect(byProvider.mistral.models.map((m: any) => m.model)).toContain('mistral-large-latest');
    // A model per provider, defaulting for those never configured, so every
    // row of the picker has a value.
    expect(res.body.models).toMatchObject({
      gemini: 'gemini-3-flash-preview',
      anthropic: 'claude-opus-5',
      mistral: 'mistral-large-latest',
    });
    // No key, or fragment of one, anywhere in the payload.
    expect(JSON.stringify(res.body)).not.toContain('test-key');
  });
});

describe('PUT /api/admin/ai-provider', () => {
  it('is closed to anyone who is not a platform admin', async () => {
    const { token } = makeUser(makeTenant(), 'admin');
    const res = await request(app).put('/api/admin/ai-provider').set(authHeader(token))
      .send({ provider: 'gemini', model: 'gemini-3-flash-preview' });
    expect(res.status).toBe(403);
  });

  it('requires a provider', async () => {
    const res = await request(app).put('/api/admin/ai-provider').set(authHeader(superAdminToken()))
      .send({ models: { gemini: 'gemini-3-flash-preview' } });
    expect(res.status).toBe(400);
  });

  it('accepts a provider alone, falling back to its default model', async () => {
    // Switching provider without restating a model is the common gesture
    // once the models are set; it must not be an error.
    const res = await request(app).put('/api/admin/ai-provider').set(authHeader(superAdminToken()))
      .send({ provider: 'gemini' });
    expect(res.status).toBe(200);
    expect(res.body.model).toBe('gemini-3-flash-preview');
  });

  it('refuses an unknown provider', async () => {
    const res = await request(app).put('/api/admin/ai-provider').set(authHeader(superAdminToken()))
      .send({ provider: 'openai', model: 'gpt-4' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('openai');
  });

  it('refuses a provider whose key is not configured, naming the variable to set', async () => {
    // Switching onto a keyless provider would 503 every AI call on the
    // platform — the whole reason this check exists.
    const res = await request(app).put('/api/admin/ai-provider').set(authHeader(superAdminToken()))
      .send({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('ANTHROPIC_API_KEY');
  });

  it('refuses a model that is not in the catalogue', async () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
    const res = await request(app).put('/api/admin/ai-provider').set(authHeader(superAdminToken()))
      .send({ provider: 'anthropic', model: 'claude-imaginary-9' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('claude-imaginary-9');
  });

  it('stores a valid selection, logs it, and serves it back as the current one', async () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
    const token = superAdminToken();

    const put = await request(app).put('/api/admin/ai-provider').set(authHeader(token))
      .send({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(put.status).toBe(200);

    invalidatePlatformAiConfigCache();
    const get = await request(app).get('/api/admin/ai-provider').set(authHeader(token));
    expect(get.body.current).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      source: 'database',
    });

    // Changing which model every tenant is billed for is an operator action
    // that has to leave a trace.
    // La dernière, pas la première : le journal est cumulatif et les tests
    // précédents y ont déjà écrit.
    const logged = fakeSupabaseAdmin.getTable('admin_audit_log')
      .filter((r: any) => r.action === 'platform.ai_provider_changed').at(-1);
    expect(logged?.details).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5' });
  });

  it('overrides the environment, which is the point of the switch', async () => {
    process.env.MISTRAL_API_KEY = 'mistral-test-key';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-3-flash-preview';
    const token = superAdminToken();

    await request(app).put('/api/admin/ai-provider').set(authHeader(token))
      .send({ provider: 'mistral', model: 'mistral-small-latest' });

    invalidatePlatformAiConfigCache();
    const get = await request(app).get('/api/admin/ai-provider').set(authHeader(token));
    expect(get.body.current).toMatchObject({
      provider: 'mistral',
      model: 'mistral-small-latest',
      source: 'database',
    });
  });
});

describe('Per-provider model selection', () => {
  it('remembers each provider\'s model, so switching back restores it', async () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
    process.env.MISTRAL_API_KEY = 'mistral-test-key';
    const token = superAdminToken();

    // Configure all three at once, running on Claude.
    await request(app).put('/api/admin/ai-provider').set(authHeader(token)).send({
      provider: 'anthropic',
      models: {
        gemini: 'gemini-3-flash-preview',
        anthropic: 'claude-sonnet-5',
        mistral: 'mistral-small-latest',
      },
    });

    // Try Mistral for a while.
    invalidatePlatformAiConfigCache();
    const toMistral = await request(app).put('/api/admin/ai-provider').set(authHeader(token))
      .send({ provider: 'mistral', models: { mistral: 'mistral-small-latest' } });
    expect(toMistral.body.model).toBe('mistral-small-latest');

    // Back to Claude: Sonnet, the deliberate earlier choice — not Opus, the
    // provider default a single shared model field would have reset to.
    invalidatePlatformAiConfigCache();
    const back = await request(app).put('/api/admin/ai-provider').set(authHeader(token))
      .send({ provider: 'anthropic' });
    expect(back.status).toBe(200);
    expect(back.body.model).toBe('claude-sonnet-5');
  });

  it('keeps the other providers\' models when only one is submitted', async () => {
    process.env.MISTRAL_API_KEY = 'mistral-test-key';
    const token = superAdminToken();

    await request(app).put('/api/admin/ai-provider').set(authHeader(token))
      .send({ provider: 'gemini', models: { gemini: 'gemini-3-flash-preview', mistral: 'mistral-small-latest' } });

    invalidatePlatformAiConfigCache();
    await request(app).put('/api/admin/ai-provider').set(authHeader(token))
      .send({ provider: 'mistral', models: { mistral: 'mistral-large-latest' } });

    invalidatePlatformAiConfigCache();
    const get = await request(app).get('/api/admin/ai-provider').set(authHeader(token));
    expect(get.body.models.gemini).toBe('gemini-3-flash-preview');
    expect(get.body.models.mistral).toBe('mistral-large-latest');
  });

  it('lets a model be set for a provider that has no key yet', async () => {
    // Preparing a provider before provisioning its key is legitimate; only
    // the ACTIVE provider needs one.
    const token = superAdminToken();
    const res = await request(app).put('/api/admin/ai-provider').set(authHeader(token))
      .send({ provider: 'gemini', models: { gemini: 'gemini-3-flash-preview', anthropic: 'claude-haiku-4-5' } });
    expect(res.status).toBe(200);
    expect(res.body.models.anthropic).toBe('claude-haiku-4-5');
  });

  it('still refuses an unknown model, whichever provider it is aimed at', async () => {
    const res = await request(app).put('/api/admin/ai-provider').set(authHeader(superAdminToken()))
      .send({ provider: 'gemini', models: { gemini: 'gemini-3-flash-preview', anthropic: 'claude-imaginary-9' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('claude-imaginary-9');
  });
});

describe('parseStoredConfig', () => {
  it('reads the current shape', () => {
    expect(parseStoredConfig({ provider: 'anthropic', models: { anthropic: 'claude-sonnet-5', gemini: 'g' } }))
      .toEqual({ provider: 'anthropic', model: 'claude-sonnet-5', models: { anthropic: 'claude-sonnet-5', gemini: 'g' } });
  });

  it('reads a row written in the earlier {provider, model} shape', () => {
    // Rows written before per-provider models existed must keep working
    // without a data migration.
    expect(parseStoredConfig({ provider: 'mistral', model: 'mistral-small-latest' }))
      .toEqual({ provider: 'mistral', model: 'mistral-small-latest', models: { mistral: 'mistral-small-latest' } });
  });

  it('ignores malformed values rather than propagating them', () => {
    expect(parseStoredConfig({ provider: 42, models: { gemini: null } })).toEqual({});
  });
});
