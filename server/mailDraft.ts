// Création de brouillons — pendant volontairement plus prudent de
// server/mailSend.ts's sendViaAccount() : rien ne part jamais du cabinet,
// le message atterrit dans le dossier Brouillons de la boîte connectée et
// c'est l'architecte qui le relit et l'envoie lui-même depuis Gmail/Outlook.
// Introduit pour l'outil create_draft (mailTools.ts), utilisable sans la
// capacité d'envoi (mail_send_enabled) — composer un brouillon n'expose rien
// à l'extérieur du cabinet tant qu'un humain ne l'a pas explicitement envoyé.
//
// IMAP n'a pas d'équivalent simple : ajouter un message au dossier Brouillons
// demande une commande APPEND, hors du périmètre actuel (server/routes/
// imapMailSync.ts ne fait que lire). Une boîte IMAP reçoit donc une erreur
// explicite plutôt qu'un brouillon silencieusement perdu.
import MailComposer from 'nodemailer/lib/mail-composer';
import { getGmailAccessToken, getOutlookAccessToken } from './mailOAuthTokens';
import type { MailAccountRow } from './mailAccounts';

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

  throw new Error("Ce compte ne permet pas de créer un brouillon (IMAP non supporté pour cette action).");
}
