// Choix du chemin d'envoi (server/mailRoute.ts) : un cabinet sans SMTP propre ne doit plus écrire
// depuis l'adresse du SMTP de la plateforme quand la personne a connecté sa boîte.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendViaAccount = vi.fn();
vi.mock('../server/mailSend', () => ({ sendViaAccount: (...args: unknown[]) => sendViaAccount(...args) }));

import { hasOwnSmtp, sendViaBestRoute, type MailRoute } from '../server/mailRoute';

const mail = { to: 'dest@exemple.test', subject: 'Objet', text: 'Texte', html: '<p>Texte</p>', attachments: [] };
const account = { id: 'a1', provider: 'google' };

describe('hasOwnSmtp', () => {
  it("exige l'hôte, l'identifiant et le mot de passe", () => {
    expect(hasOwnSmtp({ smtp_host: 'smtp.cabinet.fr', smtp_user: 'contact@cabinet.fr', smtp_pass: 'x' })).toBe(true);
    expect(hasOwnSmtp({ smtp_host: 'smtp.cabinet.fr', smtp_user: 'contact@cabinet.fr', smtp_pass: null })).toBe(false);
    expect(hasOwnSmtp(null)).toBe(false);
  });
});

describe('sendViaBestRoute', () => {
  let sendMail: ReturnType<typeof vi.fn<(options: unknown) => Promise<unknown>>>;
  beforeEach(() => {
    sendViaAccount.mockReset().mockResolvedValue(undefined);
    sendMail = vi.fn().mockResolvedValue({});
  });

  const route = (patch: Record<string, unknown>): MailRoute => ({
    supabaseAdmin: {}, transporter: { sendMail: (options: unknown) => sendMail(options) }, smtpUser: 'contact@plateforme.test',
    defaultAccount: null, ownSmtp: false, from: 'cabinet@exemple.test', replyTo: 'cabinet@exemple.test', ...patch,
  });

  it("sans SMTP propre, écrit depuis la boîte connectée et jamais depuis celui de la plateforme", async () => {
    await sendViaBestRoute(route({ defaultAccount: account }), mail);
    expect(sendViaAccount).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("n'utilise pas le SMTP de la plateforme en repli d'une boîte connectée qui échoue", async () => {
    sendViaAccount.mockRejectedValue(new Error('Gmail refusé'));
    await expect(sendViaBestRoute(route({ defaultAccount: account }), mail)).rejects.toThrow('Gmail refusé');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("avec un SMTP propre, l'essaie d'abord depuis l'adresse de l'agence", async () => {
    await sendViaBestRoute(route({ defaultAccount: account, ownSmtp: true }), mail);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'cabinet@exemple.test', to: 'dest@exemple.test' }));
    expect(sendViaAccount).not.toHaveBeenCalled();
  });

  it('avec un SMTP propre en échec, retombe sur la boîte connectée', async () => {
    sendMail.mockRejectedValue(new Error('connexion refusée'));
    await sendViaBestRoute(route({ defaultAccount: account, ownSmtp: true }), mail);
    expect(sendViaAccount).toHaveBeenCalledTimes(1);
  });

  it("sans boîte connectée, le SMTP de la plateforme reste le seul chemin", async () => {
    await sendViaBestRoute(route({}), mail);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendViaAccount).not.toHaveBeenCalled();
  });

  it("refuse l'envoi quand aucun chemin n'existe", async () => {
    await expect(sendViaBestRoute(route({ transporter: null }), mail)).rejects.toThrow("Aucun moyen d'envoi");
  });
});
