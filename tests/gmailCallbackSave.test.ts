import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => {
  process.env.VITE_GOOGLE_CLIENT_ID = 'test-client';
  app = await getTestApp();
});
afterEach(() => {
  vi.restoreAllMocks();
  fakeSupabaseAdmin.unbreakTable('email_connections');
});

// Réponses de Google : échange du code, puis adresse du compte.
function mockGoogle(email: string) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), { status: 200 });
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) {
      return new Response(JSON.stringify({ email }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function startConsent(token: string): Promise<string> {
  const res = await request(app).get('/api/gmail/auth').query({ returnTo: '/mailbox' }).set(authHeader(token));
  return new URL(res.body.url).searchParams.get('state')!;
}

describe('retour de Google après la connexion Gmail', () => {
  it('enregistre la boîte et renvoie gmail_connected', async () => {
    const tenantId = makeTenant();
    const { token, userId } = makeUser(tenantId) as any;
    const state = await startConsent(token);
    mockGoogle('boite@exemple.fr');
    const res = await request(app).get('/api/gmail/callback').query({ code: 'c', state });
    expect(res.headers.location).toBe('/mailbox?gmail_connected=1');
    const row = fakeSupabaseAdmin.getTable('email_connections').find(r => r.tenant_id === tenantId && r.external_account_email === 'boite@exemple.fr');
    expect(row?.provider).toBe('google');
    if (userId) expect(row?.user_id).toBe(userId);
  });

  it('ne prétend jamais avoir connecté une boîte que la base a refusée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const state = await startConsent(token);
    mockGoogle('refusee@exemple.fr');
    fakeSupabaseAdmin.breakTable('email_connections');
    const res = await request(app).get('/api/gmail/callback').query({ code: 'c', state });
    expect(res.headers.location).toBe('/mailbox?gmail_error=save');
  });
});
