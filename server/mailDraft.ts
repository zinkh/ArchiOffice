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
import { fetchGmailFullMessage, fetchOutlookFullMessage, fetchImapFullMessage } from './mailFullMessage';

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

// ── Lecture et modification des brouillons ──────────────────────────────────
// Un brouillon vit dans la boîte du fournisseur : on le relit et on le réécrit
// là où il est, sans jamais le copier en base. Gmail et Outlook le modifient
// en place (PUT drafts/{id}, PATCH messages/{id}) ; IMAP n'a pas de mise à
// jour de message, donc le brouillon est réécrit (APPEND) puis l'ancien
// supprimé, et son identifiant (uid) change.

export interface DraftSummary {
  id: string;
  to: string;
  subject: string;
  snippet: string;
  date: string | null;
}

export interface DraftContent {
  id: string;
  to: string;
  cc: string;
  subject: string;
  text: string;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toContent(m: { id: string; to: string; cc: string; subject: string; bodyText: string | null; bodyHtml: string | null }): DraftContent {
  return { id: m.id, to: m.to, cc: m.cc, subject: m.subject, text: m.bodyText ?? (m.bodyHtml ? htmlToPlainText(m.bodyHtml) : '') };
}

const DRAFT_LIST_LIMIT = 20;

async function withDraftsImapClient<T>(account: MailAccountRow, fn: (client: ImapFlow, draftsPath: string) => Promise<T>): Promise<T> {
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
    if (!draftsBox) throw new Error("Dossier Brouillons introuvable sur ce compte IMAP.");
    return await fn(client, draftsBox.path);
  } finally {
    try { await client.logout(); } catch { /* connexion déjà fermée, ou coupée par le hard timeout */ }
  }
}

export async function listDraftsViaAccount(supabaseAdmin: any, account: MailAccountRow): Promise<DraftSummary[]> {
  if (account.provider === 'google') {
    const accessToken = await getGmailAccessToken(account);
    const headers = { Authorization: `Bearer ${accessToken}` };
    const listResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=${DRAFT_LIST_LIMIT}`, { headers });
    const list: any = await listResp.json();
    if (!listResp.ok) throw new Error(list.error?.message || 'Échec de la lecture des brouillons Gmail');
    const rows = await Promise.all((list.drafts || []).map(async (d: any) => {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${d.id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;
      const r = await fetch(url, { headers });
      const data: any = await r.json().catch(() => ({}));
      if (!r.ok) return null;
      const h = (n: string) => data.message?.payload?.headers?.find((x: any) => x.name.toLowerCase() === n)?.value || '';
      return { id: d.id, to: h('to'), subject: h('subject'), snippet: data.message?.snippet || '', date: data.message?.internalDate ? new Date(Number(data.message.internalDate)).toISOString() : null } as DraftSummary;
    }));
    return rows.filter((r): r is DraftSummary => !!r);
  }

  if (account.provider === 'microsoft') {
    const accessToken = await getOutlookAccessToken(supabaseAdmin, account);
    const url = new URL('https://graph.microsoft.com/v1.0/me/mailFolders/drafts/messages');
    url.searchParams.set('$top', String(DRAFT_LIST_LIMIT));
    url.searchParams.set('$select', 'id,subject,toRecipients,bodyPreview,lastModifiedDateTime');
    url.searchParams.set('$orderby', 'lastModifiedDateTime desc');
    const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error?.message || 'Échec de la lecture des brouillons Outlook');
    return (data.value || []).map((m: any) => ({
      id: m.id,
      to: (m.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(', '),
      subject: m.subject || '',
      snippet: m.bodyPreview || '',
      date: m.lastModifiedDateTime || null,
    }));
  }

  if (account.provider === 'infomaniak') {
    return withDraftsImapClient(account, async (client, path) => {
      const lock = await client.getMailboxLock(path);
      try {
        const total = (client.mailbox && client.mailbox.exists) || 0;
        if (total === 0) return [];
        const from = Math.max(1, total - DRAFT_LIST_LIMIT + 1);
        const out: DraftSummary[] = [];
        for await (const msg of client.fetch(`${from}:*`, { envelope: true, uid: true })) {
          out.push({
            id: String(msg.uid),
            to: (msg.envelope?.to || []).map(a => a.address).filter(Boolean).join(', '),
            subject: msg.envelope?.subject || '',
            snippet: '',
            date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
          });
        }
        return out.reverse();
      } finally { lock.release(); }
    });
  }

  throw new Error('Fournisseur de messagerie inconnu.');
}

export async function getDraftViaAccount(supabaseAdmin: any, account: MailAccountRow, id: string): Promise<DraftContent> {
  if (account.provider === 'google') {
    const accessToken = await getGmailAccessToken(account);
    const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(id)}?format=minimal`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) throw Object.assign(new Error(data.error?.message || 'Brouillon introuvable'), { status: resp.status });
    return toContent({ ...(await fetchGmailFullMessage(accessToken, data.message.id)), id });
  }
  if (account.provider === 'microsoft') {
    const accessToken = await getOutlookAccessToken(supabaseAdmin, account);
    return toContent(await fetchOutlookFullMessage(accessToken, id));
  }
  if (account.provider === 'infomaniak') {
    const uid = parseInt(id, 10);
    if (!Number.isFinite(uid)) throw new Error('uid invalide');
    const path = await withDraftsImapClient(account, async (_c, p) => p);
    return toContent(await fetchImapFullMessage(account as any, path, uid));
  }
  throw new Error('Fournisseur de messagerie inconnu.');
}

export async function updateDraftViaAccount(supabaseAdmin: any, account: MailAccountRow, id: string, params: CreateDraftParams): Promise<CreateDraftResult> {
  const { to, cc, subject, text } = params;

  if (account.provider === 'google') {
    const composer = new MailComposer({ from: account.external_account_email || undefined, to, cc: cc || undefined, subject, text });
    const message: Buffer = await new Promise((resolve, reject) => {
      composer.compile().build((err: any, msg: Buffer) => (err ? reject(err) : resolve(msg)));
    });
    const accessToken = await getGmailAccessToken(account);
    const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: message.toString('base64url') } }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error?.message || 'Échec de la mise à jour du brouillon Gmail');
    return { id: data.id ?? id };
  }

  if (account.provider === 'microsoft') {
    const accessToken = await getOutlookAccessToken(supabaseAdmin, account);
    const recipients = (v?: string) => String(v || '').split(',').map(a => ({ emailAddress: { address: a.trim() } })).filter(r => r.emailAddress.address);
    const resp = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body: { contentType: 'Text', content: text || '' }, toRecipients: recipients(to), ccRecipients: recipients(cc) }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error?.message || 'Échec de la mise à jour du brouillon Outlook');
    return { id: data.id ?? id };
  }

  if (account.provider === 'infomaniak') {
    const uid = parseInt(id, 10);
    if (!Number.isFinite(uid)) throw new Error('uid invalide');
    const composer = new MailComposer({ from: account.external_account_email || account.imap_username, to, cc: cc || undefined, subject, text });
    const message: Buffer = await new Promise((resolve, reject) => {
      composer.compile().build((err: any, msg: Buffer) => (err ? reject(err) : resolve(msg)));
    });
    await withDraftsImapClient(account, async (client, path) => {
      // Écrire la nouvelle version AVANT de supprimer l'ancienne : un échec
      // entre les deux laisse un doublon, jamais un brouillon perdu.
      await withImapTimeout(client, client.append(path, message, ['\\Draft']));
      const lock = await client.getMailboxLock(path);
      try { await withImapTimeout(client, client.messageDelete(String(uid), { uid: true })); } finally { lock.release(); }
    });
    return { id: null };
  }

  throw new Error('Fournisseur de messagerie inconnu.');
}
