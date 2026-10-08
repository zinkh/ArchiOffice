// Expéditeur d'un e-mail envoyé depuis l'application : l'adresse générale de
// l'agence, ou l'adresse PERSONNELLE de la personne DANS CE CABINET. Le même
// compte (contact@aazs.fr) n'a pas la même adresse d'envoi dans chaque agence, et
// le serveur ne croit jamais une adresse envoyée par le navigateur (usurpation).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const sendMail = vi.fn();
vi.mock('nodemailer', async (importOriginal) => {
  const actual: any = await importOriginal();
  const createTransport = () => ({ sendMail });
  return { ...actual, createTransport, default: { ...actual.default, createTransport } };
});

import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, addMembership, tenantHeader, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => { sendMail.mockReset(); sendMail.mockResolvedValue({ messageId: 'm1' }); });

const smtp = { smtp_host: 'smtp.test', smtp_port: '587', smtp_user: 'u', smtp_pass: 'p' };

function cabinet(email: string, senderOption: 'agency' | 'personal' = 'agency') {
  const tenantId = makeTenant();
  fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, email, sender_option: senderOption, ...smtp }]);
  return tenantId;
}

const send = (token: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  request(app).post('/api/send-email').set(authHeader(token)).set(headers)
    .send({ to: 'dest@ent.test', subject: 'Bonjour', text: 'Texte', ...extra });

const setSender = (userId: string, tenantId: string, senderEmail: string | null) => {
  const row = fakeSupabaseAdmin.getTable('tenant_memberships').find((m: any) => m.user_id === userId && m.tenant_id === tenantId);
  if (row) row.sender_email = senderEmail;
};

describe('expéditeur de POST /api/send-email', () => {
  it("part de l'adresse générale de l'agence par défaut", async () => {
    const tenantId = cabinet('agence@aacz.test');
    const { token } = makeUser(tenantId);
    const res = await send(token);
    expect(res.status).toBe(200);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: 'agence@aacz.test' });
    expect(sendMail.mock.calls[0][0].cc).toBeUndefined();
  });

  it("part de l'adresse personnelle de la personne dans ce cabinet, l'agence en copie", async () => {
    const tenantId = cabinet('agence@aacz.test', 'personal');
    const { userId, token } = makeUser(tenantId);
    setSender(userId, tenantId, 'ksektaoui@aacz.test');

    const res = await send(token);
    expect(res.status).toBe(200);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: 'ksektaoui@aacz.test', cc: 'agence@aacz.test', replyTo: 'ksektaoui@aacz.test' });
  });

  it("n'a pas la même adresse personnelle d'un cabinet à l'autre pour un même compte", async () => {
    const aazs = cabinet('agence@aazs.test', 'personal');
    const aacz = cabinet('agence@aacz.test', 'personal');
    const { userId, token } = makeUser(aazs);
    addMembership(userId, aacz, 'user');
    setSender(userId, aazs, 'perso@aazs.test');
    setSender(userId, aacz, 'ksektaoui@aacz.test');

    await send(token, {}, tenantHeader(aazs));
    await send(token, {}, tenantHeader(aacz));
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: 'perso@aazs.test', cc: 'agence@aazs.test' });
    expect(sendMail.mock.calls[1][0]).toMatchObject({ from: 'ksektaoui@aacz.test', cc: 'agence@aacz.test' });
  });

  it("retombe sur l'adresse de l'agence, jamais sans expéditeur, quand « personnel » n'a pas d'adresse", async () => {
    const tenantId = cabinet('agence@aacz.test', 'personal');
    const { token } = makeUser(tenantId);
    const res = await send(token);
    expect(res.status).toBe(200);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: 'agence@aacz.test' });
  });

  it("ignore une adresse d'expéditeur envoyée par le navigateur (usurpation)", async () => {
    const tenantId = cabinet('agence@aacz.test', 'personal');
    const { userId, token } = makeUser(tenantId);
    setSender(userId, tenantId, 'ksektaoui@aacz.test');

    await send(token, { userEmail: 'ceo@autre-societe.test' });
    expect(sendMail.mock.calls[0][0].from).toBe('ksektaoui@aacz.test');
    expect(JSON.stringify(sendMail.mock.calls[0][0])).not.toContain('autre-societe');

    sendMail.mockClear();
    const sansAdresse = cabinet('agence@aacz.test', 'personal');
    const other = makeUser(sansAdresse);
    await send(other.token, { userEmail: 'ceo@autre-societe.test' });
    expect(sendMail.mock.calls[0][0].from).toBe('agence@aacz.test');
  });

  it("respecte le choix personnel « agence » même si le cabinet propose « personnel » par défaut", async () => {
    const tenantId = cabinet('agence@aacz.test', 'personal');
    const { userId, token } = makeUser(tenantId);
    setSender(userId, tenantId, 'ksektaoui@aacz.test');
    const profile = fakeSupabaseAdmin.getTable('profiles').find((p: any) => p.id === userId);
    if (profile) profile.sender_option = 'agency';

    await send(token);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: 'agence@aacz.test' });
  });

  it("ignore une adresse personnelle illisible enregistrée en base", async () => {
    const tenantId = cabinet('agence@aacz.test', 'personal');
    const { userId, token } = makeUser(tenantId);
    setSender(userId, tenantId, 'pas une adresse\r\nBcc: x@y.fr');

    await send(token);
    expect(sendMail.mock.calls[0][0].from).toBe('agence@aacz.test');
  });
});

describe("adresse d'envoi personnelle : GET /api/me et PUT /api/team/:id", () => {
  it('se lit et se règle pour le cabinet actif seulement', async () => {
    const aazs = cabinet('agence@aazs.test');
    const aacz = cabinet('agence@aacz.test');
    const { userId, token } = makeUser(aazs);
    addMembership(userId, aacz, 'user');

    const put = await request(app).put(`/api/team/${userId}`).set(authHeader(token)).set(tenantHeader(aacz))
      .send({ name: 'Khaldoun', mailSenderEmail: '  ksektaoui@aacz.test ' });
    expect(put.status).toBe(200);

    const meAacz = await request(app).get('/api/me').set(authHeader(token)).set(tenantHeader(aacz));
    const meAazs = await request(app).get('/api/me').set(authHeader(token)).set(tenantHeader(aazs));
    expect(meAacz.body.mailSenderEmail).toBe('ksektaoui@aacz.test');
    expect(meAazs.body.mailSenderEmail).toBe('');
  });

  it("l'efface quand on le vide", async () => {
    const tenantId = cabinet('agence@aacz.test');
    const { userId, token } = makeUser(tenantId);
    setSender(userId, tenantId, 'ksektaoui@aacz.test');

    const put = await request(app).put(`/api/team/${userId}`).set(authHeader(token)).send({ name: 'K', mailSenderEmail: '' });
    expect(put.status).toBe(200);
    const me = await request(app).get('/api/me').set(authHeader(token));
    expect(me.body.mailSenderEmail).toBe('');
  });

  it('refuse une adresse invalide sans rien enregistrer', async () => {
    const tenantId = cabinet('agence@aacz.test');
    const { userId, token } = makeUser(tenantId);
    for (const bad of ['pas-une-adresse', 'a@b.fr, c@d.fr', 'a@b.fr\nBcc: x@y.fr']) {
      const put = await request(app).put(`/api/team/${userId}`).set(authHeader(token)).send({ name: 'K', mailSenderEmail: bad });
      expect(put.status).toBe(400);
    }
    const me = await request(app).get('/api/me').set(authHeader(token));
    expect(me.body.mailSenderEmail).toBe('');
  });

  it("n'est modifiable que par la personne elle-même, pas par un administrateur", async () => {
    const tenantId = cabinet('agence@aacz.test');
    const admin = makeUser(tenantId, 'admin');
    const member = makeUser(tenantId);

    const put = await request(app).put(`/api/team/${member.userId}`).set(authHeader(admin.token))
      .send({ name: 'Membre', mailSenderEmail: 'directeur@aacz.test' });
    expect(put.status).toBe(403);
    const me = await request(app).get('/api/me').set(authHeader(member.token));
    expect(me.body.mailSenderEmail).toBe('');
  });
});
