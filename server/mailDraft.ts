// Création de brouillons — pendant volontairement plus prudent de
// server/mailSend.ts's sendViaAccount() : rien ne part jamais du cabinet,
// le message atterrit dans le dossier Brouillons de la boîte connectée et
// c'est l'architecte qui le relit et l'envoie lui-même depuis Gmail/Outlook/
// son client IMAP. Introduit pour l'outil create_draft (mailTools.ts),
// utilisable sans la capacité d'envoi (mail_send_enabled) — composer un
// brouillon n'expose rien à l'extérieur du cabinet tant qu'un humain ne l'a
// pas explicitement envoyé.
//
// IMAP n'a pas d'API "créer un brouillon" comme Gmail/Outlook : il faut
// composer soi-même le message brut (MailComposer, comme pour Gmail),
// trouver le dossier Brouillons — reconnu par son attribut SPECIAL-USE
// (\Drafts) quand le serveur l'annonce, sinon par son nom usuel, le serveur
// n'ayant pas tous la même langue/convention — puis l'y ajouter par la
// commande APPEND avec le drapeau \Draft. server/routes/imapMailSync.ts
// n'avait jusqu'ici besoin que de LIRE une boîte IMAP ; ImapFlow (déjà une
// dépendance, déjà utilisée là) sait aussi faire cet APPEND.
import MailComposer from 'nodemailer/lib/mail-composer';
import { ImapFlow } from 'imapflow';
import { getGmailAccessToken, getOutlookAccessToken } from './mailOAuthTokens';
import { decryptSecret } from './secretsCrypto';
import type { MailAccountRow } from './mailAccounts';

const IMAP_CONNECT_TIMEOUT_MS = 10000;
// Même principe que imapMailSync.ts's withHardTimeout — un backstop distinct
// de connectionTimeout d'ImapFlow, qui ne couvre que la phase de connexion :
// une poignée de main TCP silencieusement perdue peut laisser une opération
// suivante (list, append) bloquée bien au-delà.
function withImapTimeout<T>(client: ImapFlow, promise: Promise<T>, ms = 15000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { client.close(); } catch { /* déjà fermé / jamais ouvert */ }
      reject(Object.assign(new Error('Délai dépassé : le serveur IMAP ne répond pas.'), { code: 'HARD_TIMEOUT' }));
    }, ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

// Repli sur les noms usuels quand le serveur n'annonce pas l'extension
// SPECIAL-USE (RFC 6154) — tous ne le font pas.
const DRAFTS_NAME_FALLBACK = /^(drafts|brouillons|inbox\.drafts|inbox\/drafts)$/i;

export interface CreateDraftParams {
  to: string;
  cc?: string;
  subject: string;
  text?: string;
}

export interface CreateDraftResult {
  id: string | null;
}

export async function createDraftViaAccount(supabaseAdmin: any, account: MailAccountRow, params: CreateDraftParams): Promise<CreateDraftResult> {
  const { to, cc, subject, text } = params;

  if (account.provider === 'google') {
    const composer = new MailComposer({
      from: account.external_account_email || undefined,
      to, cc: cc || undefined, subject, text,
    });
    const message: Buffer = await new Promise((resolve, reject) => {
      composer.compile().build((err: any, msg: Buffer) => (err ? reject(err) : resolve(msg)));
    });
    const accessToken = await getGmailAccessToken(account);
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: message.toString('base64url') } }),
    });
    const data: any = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || "Échec de la création du brouillon Gmail");
    return { id: data.id ?? null };
  }

  if (account.provider === 'microsoft') {
    // POST direct sur la collection /me/messages : Microsoft Graph le crée
    // à l'état de brouillon par construction — /sendMail est l'action
    // distincte qui, elle, expédie réellement (voir mailSend.ts).
    const accessToken = await getOutlookAccessToken(supabaseAdmin, account);
    const toRecipients = String(to).split(',').map(a => ({ emailAddress: { address: a.trim() } })).filter(r => r.emailAddress.address);
    const ccRecipients = cc ? String(cc).split(',').map(a => ({ emailAddress: { address: a.trim() } })).filter(r => r.emailAddress.address) : undefined;
    const resp = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body: { contentType: 'Text', content: text || '' }, toRecipients, ccRecipients }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error?.message || "Échec de la création du brouillon Outlook");
    return { id: data.id ?? null };
  }

  if (account.provider === 'infomaniak') {
    const composer = new MailComposer({
      from: account.external_account_email || account.imap_username,
      to, cc: cc || undefined, subject, text,
    });
    const message: Buffer = await new Promise((resolve, reject) => {
      composer.compile().build((err: any, msg: Buffer) => (err ? reject(err) : resolve(msg)));
    });

    const client = new ImapFlow({
      host: account.imap_host,
      port: account.imap_port,
      secure: true,
      auth: { user: account.imap_username, pass: decryptSecret(account.imap_password_encrypted) },
      logger: false,
      connectionTimeout: IMAP_CONNECT_TIMEOUT_MS,
    });
    try {
      await withImapTimeout(client, client.connect());
      const mailboxes = await withImapTimeout(client, client.list());
      const draftsBox = mailboxes.find(m => (m.specialUse || '').toLowerCase() === '\\drafts')
        || mailboxes.find(m => DRAFTS_NAME_FALLBACK.test(m.path));
      if (!draftsBox) {
        throw new Error("Dossier Brouillons introuvable sur ce compte IMAP.");
      }
      await withImapTimeout(client, client.append(draftsBox.path, message, ['\\Draft']));
    } finally {
      try { await client.logout(); } catch { /* connexion déjà fermée, ou coupée par le hard timeout */ }
    }
    return { id: null };
  }

  throw new Error("Fournisseur de messagerie inconnu.");
}
