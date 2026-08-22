// Coverage for the "real mailbox action" routes added on top of the
// read-only Gmail/Outlook/IMAP connectors: archive/trash (Gmail),
// move/delete (Outlook), move (IMAP). Mocks global.fetch for Gmail/Graph so
// the exact URL/body sent can be asserted — this is what catches a
// regression like "used messages.delete instead of messages.trash" before
// it ever touches a real mailbox. IMAP is mocked at the imapflow module
// level, same idea as tests mocking nodemailer elsewhere in this suite.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { encryptSecret } from '../server/secretsCrypto';

process.env.MAIL_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.VITE_GOOGLE_CLIENT_ID ||= 'fake-client-id.apps.googleusercontent.com';
process.env.AZURE_CLIENT_ID ||= 'fake-azure-client-id';
process.env.AZURE_CLIENT_SECRET ||= 'fake-azure-client-secret';

const imapFakeClient = {
  connect: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  close: vi.fn(() => {}),
  list: vi.fn(async () => ([
    { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox' },
    { path: 'Archive', name: 'Archive', specialUse: '\\Archive' },
    { path: 'Trash', name: 'Trash', specialUse: '\\Trash' },
  ])),
  mailboxOpen: vi.fn(async () => ({ exists: 10 })),
  messageMove: vi.fn(async () => ({ path: 'INBOX', destination: 'Archive' })),
};
vi.mock('imapflow', () => ({ ImapFlow: vi.fn().mockImplementation(function ImapFlow() { return imapFakeClient; }) }));

let app: Express;
beforeAll(async () => {
  app = await getTestApp();
});

describe('Gmail archive/trash', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  function seedGoogleConnection(tenantId: string, userId: string) {
    fakeSupabaseAdmin.seed('email_connections', [{
      id: `conn-google-${userId}`, tenant_id: tenantId, user_id: userId, provider: 'google', auth_type: 'oauth',
      refresh_token: 'refresh-abc', access_token: 'access-abc', external_account_email: 'me@gmail.test',
    }]);
  }

  it('archives by removing the INBOX label via messages.modify', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedGoogleConnection(tenantId, userId);

    global.fetch = vi.fn(async (url: any, opts: any) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      if (u.includes('/messages/msg123/modify')) {
        expect(JSON.parse(opts.body)).toEqual({ removeLabelIds: ['INBOX'] });
        return { ok: true, json: async () => ({ id: 'msg123' }) } as any;
      }
      throw new Error('Unexpected fetch url: ' + u);
    }) as any;

    const res = await request(app).post('/api/gmail/messages/msg123/archive').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('trashes via messages.trash, never the permanent messages.delete endpoint', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedGoogleConnection(tenantId, userId);

    const calledUrls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      calledUrls.push(u);
      if (u.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      if (u.endsWith('/messages/msg123/trash')) {
        return { ok: true, json: async () => ({ id: 'msg123' }) } as any;
      }
      throw new Error('Unexpected fetch url: ' + u);
    }) as any;

    const res = await request(app).post('/api/gmail/messages/msg123/trash').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(calledUrls.some(u => u.endsWith('/trash'))).toBe(true);
    // A regression that swapped in the permanent-delete verb would show up
    // as a call shaped like DELETE .../messages/msg123 with no /trash.
    expect(calledUrls.some(u => /\/messages\/msg123$/.test(u))).toBe(false);
  });

  it('surfaces INSUFFICIENT_SCOPE when the stored token lacks gmail.modify', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedGoogleConnection(tenantId, userId);

    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: { errors: [{ reason: 'insufficientPermissions' }], status: 'PERMISSION_DENIED' } }),
      } as any;
    }) as any;

    const res = await request(app).post('/api/gmail/messages/msg123/archive').set(authHeader(token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_SCOPE');
  });
});

describe('Outlook move/delete', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  function seedOutlookConnection(tenantId: string, userId: string) {
    fakeSupabaseAdmin.seed('email_connections', [{
      id: `conn-ms-${userId}`, tenant_id: tenantId, user_id: userId, provider: 'microsoft', auth_type: 'oauth',
      refresh_token: 'refresh-abc', access_token: 'access-abc', external_account_email: 'me@outlook.test',
    }]);
  }

  it('archives via POST .../move with destinationId "archive"', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedOutlookConnection(tenantId, userId);

    global.fetch = vi.fn(async (url: any, opts: any) => {
      const u = String(url);
      if (u.includes('login.microsoftonline.com')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      if (u.endsWith('/messages/msg123/move')) {
        expect(JSON.parse(opts.body)).toEqual({ destinationId: 'archive' });
        return { ok: true, status: 200, json: async () => ({ id: 'msg123' }) } as any;
      }
      throw new Error('Unexpected fetch url: ' + u);
    }) as any;

    const res = await request(app).post('/api/outlook/messages/msg123/move').set(authHeader(token)).send({ destinationId: 'archive' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('deletes via DELETE /me/messages/:id', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedOutlookConnection(tenantId, userId);

    global.fetch = vi.fn(async (url: any, opts: any) => {
      const u = String(url);
      if (u.includes('login.microsoftonline.com')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      if (u.endsWith('/messages/msg123') && opts?.method === 'DELETE') {
        return { ok: true, status: 204, json: async () => ({}) } as any;
      }
      throw new Error('Unexpected fetch call: ' + u);
    }) as any;

    const res = await request(app).delete('/api/outlook/messages/msg123').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('surfaces INSUFFICIENT_SCOPE on Authorization_RequestDenied', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedOutlookConnection(tenantId, userId);

    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('login.microsoftonline.com')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      return { ok: false, status: 403, json: async () => ({ error: { code: 'Authorization_RequestDenied' } }) } as any;
    }) as any;

    const res = await request(app).delete('/api/outlook/messages/msg123').set(authHeader(token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_SCOPE');
  });
});

describe('IMAP move', () => {
  function seedImapConnection(tenantId: string, userId: string) {
    fakeSupabaseAdmin.seed('email_connections', [{
      id: `conn-imap-${userId}`, tenant_id: tenantId, user_id: userId, provider: 'infomaniak', auth_type: 'imap',
      imap_host: 'mail.infomaniak.com', imap_port: 993, imap_username: 'me@example.test',
      imap_password_encrypted: encryptSecret('s3cret'), external_account_email: 'me@example.test',
    }]);
  }

  it('moves a message to the Archive special-use folder', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedImapConnection(tenantId, userId);

    const res = await request(app).post('/api/mail/imap/messages/INBOX/42/move').set(authHeader(token)).send({ destination: 'archive' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(imapFakeClient.messageMove).toHaveBeenCalledWith(42, 'Archive', { uid: true });
  });

  it('moves a message to the Trash special-use folder', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedImapConnection(tenantId, userId);

    const res = await request(app).post('/api/mail/imap/messages/INBOX/43/move').set(authHeader(token)).send({ destination: 'trash' });
    expect(res.status).toBe(200);
    expect(imapFakeClient.messageMove).toHaveBeenCalledWith(43, 'Trash', { uid: true });
  });

  it('rejects an invalid destination', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedImapConnection(tenantId, userId);

    const res = await request(app).post('/api/mail/imap/messages/INBOX/44/move').set(authHeader(token)).send({ destination: 'somewhere' });
    expect(res.status).toBe(400);
  });
});
