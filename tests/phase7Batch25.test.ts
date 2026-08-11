// Phase 7 batch 25 (final lot): end-to-end Supertest coverage for the last
// domains extracted out of server.ts — Settings, Uploads (logo/avatar),
// Lots, and AI CCTP-article suggestions. After this lot, server.ts only
// contains its own bootstrap (health check, SPA fallback, Sentry error
// handler) — no more inline route handlers.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Settings', () => {
  it('returns camelCase settings, defaulting to just the tenant id when none exist', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/settings').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.tenant_id).toBe(tenantId);
  });

  it('maps snake_case columns to camelCase for the frontend', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, agency_name: 'Cabinet Test', num_prefix_devis: 'DEV' }]);

    const res = await request(app).get('/api/settings').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe('Cabinet Test');
    expect(res.body.numPrefixDevis).toBe('DEV');
  });

  it('lets an admin update settings, dropping unknown fields', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');

    const res = await request(app).put('/api/settings').set(authHeader(token)).send({ agencyName: 'Nouveau nom', notARealField: 'ignored' });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.agency_name).toBe('Nouveau nom');
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.notARealField).toBeUndefined();
  });

  it('blocks a non-admin from updating settings', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    const res = await request(app).put('/api/settings').set(authHeader(token)).send({ agencyName: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('rejects a test-smtp call with incomplete configuration', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/test-smtp').set(authHeader(token)).send({ smtpHost: 'smtp.example.test' });
    expect(res.status).toBe(400);
  });
});

// A real (8-byte) PNG signature — server/imageUpload.ts's sniffImageMime()
// checks actual file bytes, not just the client-claimed Content-Type/extension,
// so fixtures need to look like a genuine image now.
const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

describe('Uploads', () => {
  it('uploads a logo, creating the bucket if missing, and persists it to settings', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');

    const res = await request(app).post('/api/upload/logo').set(authHeader(token)).attach('file', PNG_MAGIC_BYTES, 'logo.png');
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/logos/');
    expect(fakeSupabaseAdmin.getTable('settings').find(s => s.tenant_id === tenantId)?.logo_url).toBe(res.body.url);
  });

  it('rejects a logo upload with no file', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const res = await request(app).post('/api/upload/logo').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects a logo upload whose content is not actually an image, regardless of filename/Content-Type', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const res = await request(app)
      .post('/api/upload/logo')
      .set(authHeader(token))
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('rejects a logo upload from a non-admin member of the tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    const res = await request(app).post('/api/upload/logo').set(authHeader(token)).attach('file', PNG_MAGIC_BYTES, 'logo.png');
    expect(res.status).toBe(403);
  });

  it('uploads an avatar and updates the caller\'s own profile', async () => {
    const tenantId = makeTenant();
    const { token, userId } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('profiles', [{ id: userId, tenant_id: tenantId, email: 'x@example.test' }]);

    const res = await request(app).post('/api/upload/avatar').set(authHeader(token)).attach('file', PNG_MAGIC_BYTES, 'avatar.png');
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === userId)?.avatar).toBe(res.body.url);
  });
});

describe('Lots', () => {
  it('creates, lists, and deletes a lot', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/projects/p1/lots').set(authHeader(token)).send({ lot_number: '01', lot_title: 'Gros œuvre' });
    expect(created.status).toBe(201);

    const listed = await request(app).get('/api/projects/p1/lots').set(authHeader(token));
    expect(listed.body.some((l: any) => l.id === created.body.id)).toBe(true);

    const deleted = await request(app).delete(`/api/lots/${created.body.id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('project_lots').find(l => l.id === created.body.id)).toBeUndefined();
  });

  it('never lets a caller delete another tenant\'s lot', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('project_lots', [{ id: 'lot-b', tenant_id: tenantB, project_id: 'p1', lot_number: '99', lot_title: 'Secret' }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).delete('/api/lots/lot-b').set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('project_lots').find(l => l.id === 'lot-b')).toBeDefined();
  });
});

describe('AI CCTP article suggestions', () => {
  const originalKey = process.env.GEMINI_API_KEY;
  afterAll(() => { process.env.GEMINI_API_KEY = originalKey; });

  it('requires lot_name', async () => {
    delete process.env.GEMINI_API_KEY;
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/ai/suggest-articles').set(authHeader(token)).send({});
    expect(res.status).toBe(400);
  });

  it('returns 503 when Gemini is not configured', async () => {
    delete process.env.GEMINI_API_KEY;
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/ai/suggest-articles').set(authHeader(token)).send({ lot_name: 'Charpente' });
    expect(res.status).toBe(503);
  });

  it('returns 402 when the tenant\'s prepaid AI credit balance is exhausted', async () => {
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    const tenantId = makeTenant({ plan: 'trial', agent_billing_mode: 'prepaid', ai_credit_balance_eur_cents: 0 });
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/ai/suggest-articles').set(authHeader(token)).send({ lot_name: 'Charpente' });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('NO_TOKENS');
  });
});
