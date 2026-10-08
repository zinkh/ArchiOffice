// POST /api/send-email relayait `attachments` tel quel à nodemailer, qui sait lire
// un fichier du serveur (`path`) ou une adresse (`href`) : n'importe quelle personne
// connectée pouvait se faire envoyer `.env` ou tout autre fichier lisible par le
// processus. Le serveur ne garde désormais que des octets reçus en base64.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const sendMail = vi.fn();
vi.mock('nodemailer', async (importOriginal) => {
  const actual: any = await importOriginal();
  const createTransport = () => ({ sendMail });
  return { ...actual, createTransport, default: { ...actual.default, createTransport } };
});

import { sanitizeEmailAttachments, MAX_EMAIL_ATTACHMENTS, MAX_EMAIL_ATTACHMENTS_BYTES } from '../server/emailAttachments';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('sanitizeEmailAttachments', () => {
  it('accepte l\'absence de pièce jointe', () => {
    expect(sanitizeEmailAttachments(undefined)).toEqual({ ok: true, attachments: [] });
    expect(sanitizeEmailAttachments([])).toEqual({ ok: true, attachments: [] });
  });

  it('décode une pièce jointe légitime en octets', () => {
    const r = sanitizeEmailAttachments([{ filename: 'facture.pdf', content: b64('%PDF-1.4'), encoding: 'base64', contentType: 'application/pdf' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0].filename).toBe('facture.pdf');
    expect(r.attachments[0].content.toString()).toBe('%PDF-1.4');
    expect(r.attachments[0].contentType).toBe('application/pdf');
  });

  it('retire path, href, raw et tout champ que nodemailer saurait suivre', () => {
    const r = sanitizeEmailAttachments([{
      filename: 'a.txt', content: b64('x'), encoding: 'base64',
      path: '/etc/passwd', href: 'http://interne/', raw: 'From: x', cid: 'c', headers: { 'X-Y': 'z' }, contentDisposition: 'inline',
    }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.attachments[0]).sort()).toEqual(['content', 'contentType', 'filename'].filter(k => k in r.attachments[0]).sort());
    expect(r.attachments[0]).not.toHaveProperty('path');
    expect(r.attachments[0]).not.toHaveProperty('href');
    expect(r.attachments[0]).not.toHaveProperty('raw');
  });

  it('refuse une pièce jointe qui ne porte qu\'un chemin ou une adresse', () => {
    expect(sanitizeEmailAttachments([{ path: '/etc/passwd' }]).ok).toBe(false);
    expect(sanitizeEmailAttachments([{ filename: 'x', href: 'file:///etc/passwd' }]).ok).toBe(false);
    expect(sanitizeEmailAttachments([{ filename: 'x', content: { type: 'Buffer', data: [1] } }]).ok).toBe(false);
  });

  it('refuse un encodage autre que base64, un contenu qui n\'en est pas, et un format de liste invalide', () => {
    expect(sanitizeEmailAttachments([{ filename: 'x', content: 'abc', encoding: 'utf8' }]).ok).toBe(false);
    expect(sanitizeEmailAttachments([{ filename: 'x', content: '../../etc/passwd', encoding: 'base64' }]).ok).toBe(false);
    expect(sanitizeEmailAttachments('pas une liste').ok).toBe(false);
    expect(sanitizeEmailAttachments([null]).ok).toBe(false);
  });

  it('assainit le nom de fichier : pas de chemin, pas de retour à la ligne', () => {
    const r = sanitizeEmailAttachments([{ filename: '../../etc/pass\r\nwd.txt', content: b64('x'), encoding: 'base64' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attachments[0].filename).not.toMatch(/[\\/\r\n]/);
    expect(r.attachments[0].filename.endsWith('.txt')).toBe(true);
  });

  it('ignore un type de contenu malformé au lieu de le relayer', () => {
    const r = sanitizeEmailAttachments([{ filename: 'a.bin', content: b64('x'), encoding: 'base64', contentType: 'text/plain\r\nBcc: x@y.fr' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attachments[0].contentType).toBeUndefined();
  });

  it('borne le nombre et le poids total des pièces jointes', () => {
    const one = { filename: 'a.txt', content: b64('x'), encoding: 'base64' };
    expect(sanitizeEmailAttachments(Array.from({ length: MAX_EMAIL_ATTACHMENTS + 1 }, () => one)).ok).toBe(false);
    const big = Buffer.alloc(MAX_EMAIL_ATTACHMENTS_BYTES + 1024).toString('base64');
    expect(sanitizeEmailAttachments([{ filename: 'gros.bin', content: big, encoding: 'base64' }]).ok).toBe(false);
  });
});

describe('POST /api/send-email : pièces jointes', () => {
  let app: Express;
  beforeAll(async () => { app = await getTestApp(); });
  beforeEach(() => { sendMail.mockReset(); sendMail.mockResolvedValue({ messageId: 'm1' }); });

  function setup() {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, smtp_host: 'smtp.test', smtp_port: '587', smtp_user: 'u', smtp_pass: 'p', email: 'cabinet@aazs.test' }]);
    return token;
  }
  const send = (token: string, attachments: unknown) =>
    request(app).post('/api/send-email').set(authHeader(token)).send({ to: 'dest@ent.test', subject: 'Bonjour', text: 'Texte', attachments });

  it('envoie une pièce jointe légitime comme des octets', async () => {
    const token = setup();
    const res = await send(token, [{ filename: 'facture.pdf', content: b64('%PDF-1.4'), encoding: 'base64', contentType: 'application/pdf' }]);
    expect(res.status).toBe(200);
    const [mail] = sendMail.mock.calls[0];
    expect(Buffer.isBuffer(mail.attachments[0].content)).toBe(true);
    expect(mail.attachments[0].content.toString()).toBe('%PDF-1.4');
  });

  it('ne laisse jamais nodemailer lire un fichier du serveur : `path` est refusé ou retiré', async () => {
    const token = setup();
    const refused = await send(token, [{ filename: 'passwd', path: '/etc/passwd' }]);
    expect(refused.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();

    const stripped = await send(token, [{ filename: 'a.txt', content: b64('ok'), encoding: 'base64', path: '/etc/passwd' }]);
    expect(stripped.status).toBe(200);
    const [mail] = sendMail.mock.calls[0];
    expect(mail.attachments[0]).not.toHaveProperty('path');
    expect(mail.attachments[0].content.toString()).toBe('ok');
  });

  it('refuse une adresse (href) comme source de pièce jointe', async () => {
    const token = setup();
    const res = await send(token, [{ filename: 'x', href: 'http://169.254.169.254/latest/meta-data/' }]);
    expect(res.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
