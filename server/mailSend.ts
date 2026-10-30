// Envoi unifié pour un compte mail résolu (server/mailAccounts.ts) — le
// point d'appel n'a plus besoin de savoir si le compte est Gmail, Outlook ou
// une boîte IMAP dotée de son propre SMTP. Consommé par
// server/routes/sendEmail.ts (POST /api/send-email) pour que les envois
// documentaires (facture, devis, note d'honoraires) puissent partir de
// l'adresse par défaut de l'utilisateur plutôt que systématiquement du SMTP
// du cabinet.
//
// Ne remplace pas POST /api/gmail/send ni /api/outlook/send : ces deux
// routes gèrent en plus les pièces jointes multipart, le threading Gmail et
// la réponse native Outlook — un périmètre plus large que ce dont
// /api/send-email a besoin. Le rafraîchissement de jeton, lui, est partagé
// (server/mailOAuthTokens.ts) pour ne pas dupliquer la rotation du refresh
// token Microsoft.
import MailComposer from 'nodemailer/lib/mail-composer';
import nodemailer from 'nodemailer';
import { getGmailAccessToken, getOutlookAccessToken } from './mailOAuthTokens';
import { decryptSecret } from './secretsCrypto';
import type { MailAccountRow } from './mailAccounts';

export interface SendViaAccountParams {
  to: string;
  cc?: string;
  subject: string;
  text?: string;
  html?: string;
  /** Pièces jointes déjà réduites à des octets (server/emailAttachments.ts) ou fournies par le serveur. */
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

/**
 * Gmail : l'appel simple (`raw` en base64url dans du JSON) double l'encodage d'un message qui contient déjà ses pièces jointes
 * en base64 : un PDF de 4 Mo pèse alors plus de 7 Mo dans la requête et dépasse ce que l'appel accepte. Au-delà de ce seuil,
 * le message part en « media upload » (corps RFC 822 brut, jusqu'à 35 Mo), sans le second encodage.
 */
export const GMAIL_INLINE_LIMIT_BYTES = 3 * 1024 * 1024;

/** Outlook (Graph sendMail) n'accepte que des pièces jointes en ligne de moins de ~3 Mo. */
const OUTLOOK_MAX_INLINE_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export interface SendViaAccountResult {
  id: string | null;
}

/**
 * Envoie via le compte résolu. Lève si le compte n'a aucune capacité
 * d'envoi (IMAP sans SMTP configuré) — à l'appelant de retomber sur le SMTP
 * du cabinet dans ce cas, comme /api/send-email le fait déjà.
 */
export async function sendViaAccount(supabaseAdmin: any, account: MailAccountRow, params: SendViaAccountParams): Promise<SendViaAccountResult> {
  const { to, cc, subject, text, html, attachments } = params;

  if (account.provider === 'google') {
    const composer = new MailComposer({
      from: account.external_account_email || undefined,
      to, cc: cc || undefined, subject, text, html, attachments,
    });
    const message: Buffer = await new Promise((resolve, reject) => {
      composer.compile().build((err: any, msg: Buffer) => (err ? reject(err) : resolve(msg)));
    });
    const accessToken = await getGmailAccessToken(account);
    const resp = message.length > GMAIL_INLINE_LIMIT_BYTES
      ? await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'message/rfc822' },
        body: new Uint8Array(message),
      })
      : await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: message.toString('base64url') }),
      });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error?.message || `Échec de l'envoi via Gmail (${resp.status})`);
    return { id: data.id ?? null };
  }

  if (account.provider === 'microsoft') {
    const accessToken = await getOutlookAccessToken(supabaseAdmin, account);
    const toRecipients = String(to).split(',').map(a => ({ emailAddress: { address: a.trim() } })).filter(r => r.emailAddress.address);
    const ccRecipients = cc ? String(cc).split(',').map(a => ({ emailAddress: { address: a.trim() } })).filter(r => r.emailAddress.address) : undefined;
    if (attachments?.some(a => a.content.length > OUTLOOK_MAX_INLINE_ATTACHMENT_BYTES)) {
      throw new Error('Pièce jointe trop volumineuse pour un envoi via Outlook (3 Mo au plus).');
    }
    const fileAttachments = attachments?.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.content.toString('base64'),
    }));
    const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { subject, body: { contentType: html ? 'HTML' : 'Text', content: html || text || '' }, toRecipients, ccRecipients, attachments: fileAttachments },
        saveToSentItems: true,
      }),
    });
    if (resp.status !== 202) {
      const data: any = await resp.json().catch(() => ({}));
      throw new Error(data.error?.message || "Échec de l'envoi via Outlook");
    }
    return { id: null };
  }

  // infomaniak / IMAP : n'a de capacité d'envoi que si un SMTP a été
  // explicitement renseigné pour ce compte (le protocole IMAP lui-même n'en
  // a pas) — cf. migrate_multi_mail_calendar.sql.
  if (!account.smtp_host || !account.smtp_username || !account.smtp_password_encrypted) {
    throw new Error('Ce compte ne peut pas envoyer de message (aucun SMTP configuré).');
  }
  const transporter = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port || 465,
    secure: (account.smtp_port || 465) === 465,
    auth: { user: account.smtp_username, pass: decryptSecret(account.smtp_password_encrypted) },
  });
  const info = await transporter.sendMail({
    from: account.external_account_email || account.smtp_username,
    to, cc, subject, text, html, attachments,
  });
  return { id: info.messageId || null };
}
