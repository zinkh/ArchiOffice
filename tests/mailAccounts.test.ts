// Coverage for the multi-comptes mail support (server/mailAccounts.ts,
// server/routes/mailAccounts.ts) — the regression the old
// UNIQUE(user_id, provider) index made structurally impossible: two Gmail
// accounts for the same user, a resolvable default, and the ability to
// switch it.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

process.env.MAIL_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.VITE_GOOGLE_CLIENT_ID ||= 'fake-client-id.apps.googleusercontent.com';

let app: Express;
beforeAll(async () => {
  app = await getTestApp();
});

function seedGmail(tenantId: string, userId: string, id: string, email: string, isDefault: boolean) {
  fakeSupabaseAdmin.seed('email_connections', [{
    id, tenant_id: tenantId, user_id: userId, provider: 'google', auth_type: 'oauth',
    refresh_token: 'refresh-abc', access_token: 'access-abc',
    external_account_email: email, is_default: isDefault, created_at: new Date().toISOString(),
  }]);
}

describe('GET /api/mail/accounts', () => {
  it('lists every connected account for the user, across providers, without secrets', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedGmail(tenantId, userId, 'conn-1', 'agence@aazs.fr', true);
    seedGmail(tenantId, userId, 'conn-2', 'perso@gmail.test', false);

    const res = await request(app).get('/api/mail/accounts').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const emails = res.body.map((a: any) => a.email).sort();
    expect(emails).toEqual(['agence@aazs.fr', 'perso@gmail.test']);
    for (const account of res.body) {
      expect(account.refresh_token).toBeUndefined();
      expect(account.access_token).toBeUndefined();
    }
    expect(res.body.find((a: any) => a.email === 'agence@aazs.fr').isDefault).toBe(true);
  });

  it("only returns this user's own accounts, never a colleague's", async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    const other = makeUser(tenantId);
    seedGmail(tenantId, userId, 'conn-mine', 'mine@aazs.fr', true);
    seedGmail(tenantId, other.userId, 'conn-theirs', 'theirs@aazs.fr', true);

    const res = await request(app).get('/api/mail/accounts').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].email).toBe('mine@aazs.fr');
  });
});

describe('POST /api/mail/accounts/:id/default', () => {
  it('moves the default from one account to another (never two at once)', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedGmail(tenantId, userId, 'conn-1', 'agence@aazs.fr', true);
    seedGmail(tenantId, userId, 'conn-2', 'perso@gmail.test', false);

    const res = await request(app).post('/api/mail/accounts/conn-2/default').set(authHeader(token));
    expect(res.status).toBe(200);

    const rows = fakeSupabaseAdmin.getTable('email_connections').filter(r => r.user_id === userId);
    expect(rows.find(r => r.id === 'conn-1')?.is_default).toBe(false);
    expect(rows.find(r => r.id === 'conn-2')?.is_default).toBe(true);
  });

  it("404s on an account belonging to another user", async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const other = makeUser(tenantId);
    seedGmail(tenantId, other.userId, 'conn-theirs', 'theirs@aazs.fr', true);

    const res = await request(app).post('/api/mail/accounts/conn-theirs/default').set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/mail/accounts/:id', () => {
  it('disconnects one account and reassigns the default to the one remaining', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedGmail(tenantId, userId, 'conn-1', 'agence@aazs.fr', true);
    seedGmail(tenantId, userId, 'conn-2', 'perso@gmail.test', false);

    const res = await request(app).delete('/api/mail/accounts/conn-1').set(authHeader(token));
    expect(res.status).toBe(200);

    const rows = fakeSupabaseAdmin.getTable('email_connections').filter(r => r.user_id === userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('conn-2');
    expect(rows[0].is_default).toBe(true);
  });
});

describe('resolveMailAccount via /api/gmail/send (accountId threading)', () => {
  it('sends from the explicitly named account, not the default', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedGmail(tenantId, userId, 'conn-default', 'agence@aazs.fr', true);
    seedGmail(tenantId, userId, 'conn-other', 'perso@gmail.test', false);

    let capturedFrom: string | null = null;
    const originalFetch = global.fetch;
    global.fetch = (async (url: any, opts: any) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      if (u.endsWith('/messages/send')) {
        const raw = Buffer.from(JSON.parse(opts.body).raw, 'base64url').toString('utf8');
        capturedFrom = raw.includes('perso@gmail.test') ? 'perso@gmail.test' : 'agence@aazs.fr';
        return { ok: true, json: async () => ({ id: 'sent-1' }) } as any;
      }
      throw new Error('Unexpected fetch url: ' + u);
    }) as any;

    try {
      const res = await request(app).post('/api/gmail/send').set(authHeader(token)).send({
        to: 'destinataire@example.test', subject: 'Bonjour', text: 'Contenu', accountId: 'conn-other',
      });
      expect(res.status).toBe(200);
      expect(capturedFrom).toBe('perso@gmail.test');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("400s when accountId doesn't belong to this user's Gmail accounts", async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedGmail(tenantId, userId, 'conn-default', 'agence@aazs.fr', true);
    const other = makeUser(tenantId);
    seedGmail(tenantId, other.userId, 'conn-theirs', 'theirs@aazs.fr', true);

    const res = await request(app).post('/api/gmail/send').set(authHeader(token)).send({
      to: 'destinataire@example.test', subject: 'Bonjour', text: 'Contenu', accountId: 'conn-theirs',
    });
    expect(res.status).toBe(400);
  });
});
