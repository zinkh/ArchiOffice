// Envoi par SMTP avec repli sur l'expéditeur authentifié, message d'erreur combiné, et envoi Gmail
// des gros messages (server/smtpSend.ts, server/mailSend.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/mailOAuthTokens', () => ({
  getGmailAccessToken: vi.fn(async () => 'jeton-gmail'),
  getOutlookAccessToken: vi.fn(async () => 'jeton-outlook'),
}));

import { combinedSendError, isSenderRefused, sendMailWithSenderFallback } from '../server/smtpSend';
import { GMAIL_INLINE_LIMIT_BYTES, sendViaAccount } from '../server/mailSend';

const refus = () => Object.assign(new Error('Message failed: 550 5.7.1 Sender mismatch'), { responseCode: 550 });

describe('isSenderRefused', () => {
  it('reconnaît un refus d’expéditeur, pas un autre refus', () => {
    expect(isSenderRefused(refus())).toBe(true);
    expect(isSenderRefused({ response: '553 5.7.1 Sender address rejected: not owned by user a@b.fr' })).toBe(true);
    expect(isSenderRefused(new Error('Invalid login: 535 Authentication failed'))).toBe(false);
    expect(isSenderRefused(new Error('550 5.1.1 Mailbox unavailable'))).toBe(false);
  });
});

describe('sendMailWithSenderFallback', () => {
  const options = { from: '"AAZS" <contact@aazs.fr>', to: 'dest@exemple.fr', subject: 'Test', text: 'x' };

  it('renvoie une fois depuis la boîte authentifiée, avec l’expéditeur d’origine en « Répondre à »', async () => {
    const sendMail = vi.fn().mockRejectedValueOnce(refus()).mockResolvedValueOnce({ messageId: 'ok' });
    await sendMailWithSenderFallback({ sendMail }, options, 'khaldoun@aazs.fr');
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls[1][0]).toMatchObject({ from: 'khaldoun@aazs.fr', replyTo: 'contact@aazs.fr', to: 'dest@exemple.fr' });
  });

  it('garde le « Répondre à » déjà fourni', async () => {
    const sendMail = vi.fn().mockRejectedValueOnce(refus()).mockResolvedValueOnce({});
    await sendMailWithSenderFallback({ sendMail }, { ...options, replyTo: 'moi@aazs.fr' }, 'khaldoun@aazs.fr');
    expect(sendMail.mock.calls[1][0].replyTo).toBe('moi@aazs.fr');
  });

  it('ne rejoue pas pour une autre erreur', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('Invalid login: 535 Authentication failed'));
    await expect(sendMailWithSenderFallback({ sendMail }, options, 'khaldoun@aazs.fr')).rejects.toThrow('Invalid login');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('dit quoi faire quand l’identifiant SMTP n’est pas une adresse', async () => {
    const sendMail = vi.fn().mockRejectedValue(refus());
    await expect(sendMailWithSenderFallback({ sendMail }, options, 'utilisateur')).rejects.toThrow(/identifiant SMTP/);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('ne boucle pas si le second envoi est aussi refusé', async () => {
    const sendMail = vi.fn().mockRejectedValue(refus());
    await expect(sendMailWithSenderFallback({ sendMail }, options, 'khaldoun@aazs.fr')).rejects.toThrow('Sender mismatch');
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});

describe('combinedSendError', () => {
  it('garde la cause de la boîte connectée ET celle du SMTP', () => {
    const texte = combinedSendError({ provider: 'google' }, new Error('Request had insufficient authentication scopes'), refus());
    expect(texte).toContain('Gmail : Request had insufficient authentication scopes');
    expect(texte).toContain('SMTP du cabinet : Message failed: 550 5.7.1 Sender mismatch');
  });
});

describe('envoi Gmail', () => {
  afterEach(() => vi.unstubAllGlobals());
  const compte: any = { provider: 'google', external_account_email: 'khaldoun@aazs.fr' };

  it('un message léger part par l’appel JSON habituel', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'g1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendViaAccount({}, compte, { to: 'dest@exemple.fr', subject: 'Test', text: 'bonjour' });
    expect(res.id).toBe('g1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('un PDF de 4 Mo part en media upload, sans le second encodage', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'g2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const pdf = Buffer.alloc(4 * 1024 * 1024, 7);
    const res = await sendViaAccount({}, compte, { to: 'dest@exemple.fr', subject: 'Réserves', text: 'ci-joint', attachments: [{ filename: 'reserves.pdf', content: pdf, contentType: 'application/pdf' }] });
    expect(res.id).toBe('g2');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('message/rfc822');
    expect((init.body as Uint8Array).length).toBeGreaterThan(GMAIL_INLINE_LIMIT_BYTES);
  });

  it('remonte le motif de Gmail, avec le code quand il n’y en a pas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 413 })));
    await expect(sendViaAccount({}, compte, { to: 'dest@exemple.fr', subject: 'x', text: 'y' })).rejects.toThrow(/Gmail \(413\)/);
  });
});
