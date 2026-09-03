// Platform AI provider switch (GET/PUT /api/admin/ai-provider): the
// super-admin gate, the three refusals that stop a bad selection from taking
// the whole platform's AI offline, and the fact that API keys never cross
// this boundary.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { invalidatePlatformAiConfigCache } from '../packages/archioffice-agents/src/server/llm/config';

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
  fakeSupabaseAdmin.seed('platform_settings', []);
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
});

afterEach(() => {
  process.env.GEMINI_API_KEY = savedEnv.GEMINI_API_KEY;
  process.env.ANTHROPIC_API_KEY = savedEnv.ANTHROPIC_API_KEY;
  process.env.MISTRAL_API_KEY = savedEnv.MISTRAL_API_KEY;
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

  it('requires both a provider and a model', async () => {
    const res = await request(app).put('/api/admin/ai-provider').set(authHeader(superAdminToken()))
      .send({ provider: 'gemini' });
    expect(res.status).toBe(400);
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
    const logged = fakeSupabaseAdmin.getTable('admin_audit_log')
      .find((r: any) => r.action === 'platform.ai_provider_changed');
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
