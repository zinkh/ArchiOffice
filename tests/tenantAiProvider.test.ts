// Fournisseur IA par cabinet : la surcharge de tenants.ai_provider l'emporte
// sur le réglage plateforme, sans jamais en déduire un modèle d'un autre
// fournisseur, et les routes /api/admin/tenants/:id/ai-provider gardent les
// mêmes refus que le réglage plateforme.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, authHeader } from './testServer';
import { getTenantAiConfig, invalidatePlatformAiConfigCache } from '@zinkh/archioffice-agents/server/llm';

let app: Express;
const SUPER_ADMIN_EMAIL = 'tenant-ai-admin@archioffice.test';
const savedEnv = { ...process.env };

function superAdminToken(): string {
  const token = `super-admin-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fakeSupabaseAdmin.registerUser(token, { id: crypto.randomUUID(), email: SUPER_ADMIN_EMAIL });
  return token;
}

beforeAll(async () => {
  process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
  app = await getTestApp();
});

beforeEach(() => {
  invalidatePlatformAiConfigCache();
  fakeSupabaseAdmin.seed('platform_settings', []);
  fakeSupabaseAdmin.getTable('platform_settings').splice(0);
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
  delete process.env.MISTRAL_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
});

afterEach(() => {
  for (const key of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'MISTRAL_API_KEY'] as const) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  invalidatePlatformAiConfigCache();
});

describe('getTenantAiConfig', () => {
  it('uses the tenant override when one is set', async () => {
    const tenantId = makeTenant({ ai_provider: 'anthropic', ai_model: 'claude-sonnet-5-5' });
    expect(await getTenantAiConfig(fakeSupabaseAdmin, tenantId)).toEqual({
      provider: 'anthropic', model: 'claude-sonnet-5-5',
    });
  });

  it('leaves the model open when the tenant names only a provider', async () => {
    const tenantId = makeTenant({ ai_provider: 'anthropic' });
    expect(await getTenantAiConfig(fakeSupabaseAdmin, tenantId)).toEqual({ provider: 'anthropic' });
  });

  it('falls back to the platform setting when the tenant has no override', async () => {
    fakeSupabaseAdmin.seed('platform_settings', [
      { key: 'ai_provider', value: { provider: 'mistral', models: { mistral: 'mistral-large-latest' } } },
    ]);
    const tenantId = makeTenant();
    expect(await getTenantAiConfig(fakeSupabaseAdmin, tenantId)).toMatchObject({ provider: 'mistral' });
  });
});

describe('PUT /api/admin/tenants/:id/ai-provider', () => {
  it('is closed to anyone who is not a platform admin', async () => {
    const tenantId = makeTenant();
    const res = await request(app).put(`/api/admin/tenants/${tenantId}/ai-provider`).send({ provider: 'anthropic' });
    expect([401, 403]).toContain(res.status);
  });

  it('stores the provider and its default model', async () => {
    const tenantId = makeTenant();
    const res = await request(app).put(`/api/admin/tenants/${tenantId}/ai-provider`)
      .set(authHeader(superAdminToken())).send({ provider: 'anthropic' });
    expect(res.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('tenants').find((t: any) => t.id === tenantId)!;
    expect(row.ai_provider).toBe('anthropic');
    expect(row.ai_model).toBeTruthy();
  });

  it('refuses a provider with no API key, an unknown provider and an unpriced model', async () => {
    const tenantId = makeTenant();
    const token = superAdminToken();
    const put = (body: any) => request(app).put(`/api/admin/tenants/${tenantId}/ai-provider`).set(authHeader(token)).send(body);
    expect((await put({ provider: 'mistral' })).status).toBe(400);
    expect((await put({ provider: 'nope' })).status).toBe(400);
    expect((await put({ provider: 'anthropic', model: 'claude-inexistant' })).status).toBe(400);
  });

  it('returns the tenant to the platform setting when provider is null', async () => {
    const tenantId = makeTenant({ ai_provider: 'anthropic', ai_model: 'claude-sonnet-5-5' });
    const res = await request(app).put(`/api/admin/tenants/${tenantId}/ai-provider`)
      .set(authHeader(superAdminToken())).send({ provider: null });
    expect(res.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('tenants').find((t: any) => t.id === tenantId)!;
    expect(row.ai_provider).toBeNull();
    expect(row.ai_model).toBeNull();
  });

  it('404s on an unknown tenant', async () => {
    const res = await request(app).put(`/api/admin/tenants/${crypto.randomUUID()}/ai-provider`)
      .set(authHeader(superAdminToken())).send({ provider: 'anthropic' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/tenants/:id/ai-provider', () => {
  it('reports override, platform and effective selection', async () => {
    const tenantId = makeTenant({ ai_provider: 'anthropic', ai_model: 'claude-sonnet-5-5' });
    const res = await request(app).get(`/api/admin/tenants/${tenantId}/ai-provider`).set(authHeader(superAdminToken()));
    expect(res.status).toBe(200);
    expect(res.body.override).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(res.body.platform.provider).toBe('gemini');
    expect(res.body.effective).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
  });
});
