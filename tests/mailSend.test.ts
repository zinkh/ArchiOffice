// Coverage for the compose/reply/send routes added on top of the read-only
// Gmail/Outlook connectors. Gmail's MailComposer-built RFC822 message is
// exercised for real (no network call of its own — nodemailer's
// mail-composer only builds a buffer) and only the final Gmail API POST is
// mocked, so the test also catches a regression in the MIME-building path
// itself, not just the HTTP call shape.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

process.env.VITE_GOOGLE_CLIENT_ID ||= 'fake-client-id.apps.googleusercontent.com';
process.env.AZURE_CLIENT_ID ||= 'fake-azure-client-id';
process.env.AZURE_CLIENT_SECRET ||= 'fake-azure-client-secret';

let app: Express;
beforeAll(async () => {
  app = await getTestApp();
});

describe('Gmail send', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  function seedGoogleConnection(tenantId: string, userId: string) {
    fakeSupabaseAdmin.seed('email_connections', [{
      id: `conn-google-send-${userId}`, tenant_id: tenantId, user_id: userId, provider: 'google', auth_type: 'oauth',
      refresh_token: 'refresh-abc', access_token: 'access-abc', external_account_email: 'me@gmail.test',
    }]);
  }

  it('builds a real RFC822 message and sends it via messages.send', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedGoogleConnection(tenantId, userId);

    let capturedRaw: string | null = null;
    global.fetch = vi.fn(async (url: any, opts: any) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      if (u.endsWith('/messages/send')) {
        capturedRaw = JSON.parse(opts.body).raw;
        return { ok: true, json: async () => ({ id: 'sent-1', threadId: 'thread-1' }) } as any;
      }
      throw new Error('Unexpected fetch url: ' + u);
    }) as any;

    const res = await request(app).post('/api/gmail/send').set(authHeader(token)).send({
      to: 'destinataire@example.test', subject: 'Bonjour', text: 'Contenu du message',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(capturedRaw).toBeTruthy();

    const decoded = Buffer.from(capturedRaw as unknown as string, 'base64url').toString('utf8');
    expect(decoded).toContain('To: destinataire@example.test');
    expect(decoded).toContain('Subject: Bonjour');
    expect(decoded).toContain('Contenu du message');
  });

  it('threads a reply via threadId + In-Reply-To/References headers', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedGoogleConnection(tenantId, userId);

    let capturedBody: any = null;
    global.fetch = vi.fn(async (url: any, opts: any) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      if (u.endsWith('/messages/send')) {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ id: 'sent-2', threadId: 'thread-orig' }) } as any;
      }
      throw new Error('Unexpected fetch url: ' + u);
    }) as any;

    const res = await request(app).post('/api/gmail/send').set(authHeader(token)).send({
      to: 'destinataire@example.test', subject: 'Re: Bonjour', text: 'Réponse',
      threadId: 'thread-orig', inReplyTo: '<orig@gmail.com>', references: '<orig@gmail.com>',
    });
    expect(res.status).toBe(200);
    expect(capturedBody.threadId).toBe('thread-orig');
    const decoded = Buffer.from(capturedBody.raw, 'base64url').toString('utf8');
    expect(decoded).toContain('In-Reply-To: <orig@gmail.com>');
    expect(decoded).toContain('References: <orig@gmail.com>');
  });

  it('rejects a send with no recipient', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedGoogleConnection(tenantId, userId);
    const res = await request(app).post('/api/gmail/send').set(authHeader(token)).send({ subject: 'x', text: 'y' });
    expect(res.status).toBe(400);
  });
});

describe('Outlook send/reply', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  function seedOutlookConnection(tenantId: string, userId: string) {
    fakeSupabaseAdmin.seed('email_connections', [{
      id: `conn-ms-send-${userId}`, tenant_id: tenantId, user_id: userId, provider: 'microsoft', auth_type: 'oauth',
      refresh_token: 'refresh-abc', access_token: 'access-abc', external_account_email: 'me@outlook.test',
    }]);
  }

  it('sends a new message via structured JSON to /me/sendMail', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedOutlookConnection(tenantId, userId);

    let capturedBody: any = null;
    global.fetch = vi.fn(async (url: any, opts: any) => {
      const u = String(url);
      if (u.includes('login.microsoftonline.com')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      if (u.endsWith('/sendMail')) {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 202, json: async () => ({}) } as any;
      }
      throw new Error('Unexpected fetch url: ' + u);
    }) as any;

    const res = await request(app).post('/api/outlook/send').set(authHeader(token)).send({
      to: 'destinataire@example.test', subject: 'Bonjour', text: 'Contenu du message',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(capturedBody.saveToSentItems).toBe(true);
    expect(capturedBody.message.subject).toBe('Bonjour');
    expect(capturedBody.message.toRecipients[0].emailAddress.address).toBe('destinataire@example.test');
  });

  it('replies via the native Graph reply endpoint with a plain comment', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedOutlookConnection(tenantId, userId);

    let capturedBody: any = null;
    let capturedUrl = '';
    global.fetch = vi.fn(async (url: any, opts: any) => {
      const u = String(url);
      if (u.includes('login.microsoftonline.com')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      if (u.endsWith('/messages/msg123/reply')) {
        capturedUrl = u;
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 202, json: async () => ({}) } as any;
      }
      throw new Error('Unexpected fetch url: ' + u);
    }) as any;

    const res = await request(app).post('/api/outlook/messages/msg123/reply').set(authHeader(token)).send({ comment: 'Merci pour votre message.' });
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain('/reply');
    expect(capturedBody).toEqual({ comment: 'Merci pour votre message.' });
  });

  it('uses replyAll when requested', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    seedOutlookConnection(tenantId, userId);

    let capturedUrl = '';
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('login.microsoftonline.com')) {
        return { ok: true, json: async () => ({ access_token: 'access-xyz', expires_in: 3600 }) } as any;
      }
      if (u.includes('/messages/msg123/replyAll')) {
        capturedUrl = u;
        return { ok: true, status: 202, json: async () => ({}) } as any;
      }
      throw new Error('Unexpected fetch url: ' + u);
    }) as any;

    const res = await request(app).post('/api/outlook/messages/msg123/reply').set(authHeader(token)).send({ comment: 'x', replyAll: 'true' });
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain('/replyAll');
  });
});
