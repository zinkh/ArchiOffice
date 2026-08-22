// Fetches and normalizes a single message's full content (body + attachment
// metadata, never attachment bytes here — those are fetched on demand by
// the attachment-download routes) across the three providers. Every
// bodyHtml returned here has already been through sanitizeMailHtml() —
// callers must never bypass this module to read a body directly from a
// provider API, or an unsanitized body reaches the frontend.
//
// Known limitation, accepted rather than silently missing: inline `cid:`
// images are resolved to data URIs automatically by mailparser for IMAP,
// but NOT resolved for Gmail/Outlook in this pass (would need walking each
// provider's attachment parts and rewriting `cid:` references by hand) —
// signatures/newsletters with embedded logos will show a broken image icon
// for those two providers. Deferred rather than scoped into this lot.
import { simpleParser } from 'mailparser';
import { ImapFlow } from 'imapflow';
import { sanitizeMailHtml } from './mailSanitize';
import { decryptSecret } from './secretsCrypto';

export interface MailAttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface FullMailMessage {
  id: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string | null;
  messageIdHeader: string | null; // pour le threading (In-Reply-To/References) — Gmail seulement, cf. server/routes/gmailSync.ts
  threadId: string | null; // Gmail uniquement — passé tel quel à /api/gmail/send pour rattacher la réponse au bon fil
  bodyHtml: string | null; // déjà assaini
  bodyText: string | null;
  attachments: MailAttachmentMeta[];
}

function gmailHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

interface GmailPart {
  mimeType: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

function walkGmailParts(part: GmailPart, collect: { html: string | null; text: string | null; attachments: MailAttachmentMeta[] }) {
  if (part.parts) {
    for (const p of part.parts) walkGmailParts(p, collect);
    return;
  }
  if (part.mimeType === 'text/html' && collect.html === null && part.body?.data) {
    collect.html = Buffer.from(part.body.data, 'base64url').toString('utf8');
  } else if (part.mimeType === 'text/plain' && collect.text === null && part.body?.data) {
    collect.text = Buffer.from(part.body.data, 'base64url').toString('utf8');
  } else if (part.body?.attachmentId) {
    collect.attachments.push({
      id: part.body.attachmentId,
      filename: part.filename || 'pièce jointe',
      mimeType: part.mimeType,
      size: part.body.size || 0,
    });
  }
}

export async function fetchGmailFullMessage(accessToken: string, messageId: string): Promise<FullMailMessage> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`);
  url.searchParams.set('format', 'full');
  const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const data: any = await resp.json();
  if (!resp.ok) throw Object.assign(new Error(data.error?.message || 'Échec de la récupération du message Gmail'), { status: resp.status, body: data });

  const headers = data.payload?.headers as Array<{ name: string; value: string }> | undefined;
  const collect: { html: string | null; text: string | null; attachments: MailAttachmentMeta[] } = { html: null, text: null, attachments: [] };
  if (data.payload) walkGmailParts(data.payload, collect);

  return {
    id: data.id,
    subject: gmailHeader(headers, 'Subject'),
    from: gmailHeader(headers, 'From'),
    to: gmailHeader(headers, 'To'),
    cc: gmailHeader(headers, 'Cc'),
    date: gmailHeader(headers, 'Date') || null,
    messageIdHeader: gmailHeader(headers, 'Message-ID') || null,
    threadId: data.threadId || null,
    bodyHtml: collect.html !== null ? sanitizeMailHtml(collect.html) : null,
    bodyText: collect.text,
    attachments: collect.attachments,
  };
}

export async function fetchOutlookFullMessage(accessToken: string, messageId: string): Promise<FullMailMessage> {
  const url = new URL(`https://graph.microsoft.com/v1.0/me/messages/${messageId}`);
  url.searchParams.set('$select', 'subject,from,toRecipients,ccRecipients,receivedDateTime,body,internetMessageId');
  url.searchParams.set('$expand', 'attachments');
  const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const data: any = await resp.json();
  if (!resp.ok) throw Object.assign(new Error(data.error?.message || 'Échec de la récupération du message Outlook'), { status: resp.status, body: data });

  const addr = (r?: { emailAddress?: { address?: string } }) => r?.emailAddress?.address || '';
  const html = data.body?.contentType === 'html' ? data.body.content : null;
  const text = data.body?.contentType !== 'html' ? data.body?.content || null : null;
  // Les pièces jointes "inline" (isInline: true) sont les images de
  // signature/logo déjà référencées dans le corps — les exposer aussi comme
  // pièces jointes téléchargeables serait redondant pour l'utilisateur.
  const attachments: MailAttachmentMeta[] = (data.attachments || [])
    .filter((a: any) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && !a.isInline)
    .map((a: any) => ({ id: a.id, filename: a.name, mimeType: a.contentType, size: a.size || 0 }));

  return {
    id: data.id,
    subject: data.subject || '',
    from: addr(data.from),
    to: (data.toRecipients || []).map(addr).filter(Boolean).join(', '),
    cc: (data.ccRecipients || []).map(addr).filter(Boolean).join(', '),
    date: data.receivedDateTime || null,
    // Non requis : la réponse Outlook passe par l'endpoint natif Graph
    // (POST /me/messages/{id}/reply), qui gère le threading lui-même sans
    // qu'on ait besoin du Message-ID d'origine — voir server/routes/outlookSync.ts.
    messageIdHeader: null,
    threadId: null,
    bodyHtml: html !== null ? sanitizeMailHtml(html) : null,
    bodyText: text,
    attachments,
  };
}

const IMAP_FETCH_TIMEOUT_MS = 15000;

export interface ImapConnectionRow {
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password_encrypted: string;
}

// Shared by fetchImapFullMessage and fetchImapAttachment — both need the
// same "connect, open folder, fetch raw RFC822 source, parse" sequence, and
// per-attachment downloads are deliberately re-fetched from scratch rather
// than cached (see the module comment above) so this is the one place that
// logic lives.
async function withParsedImapMessage<T>(connection: ImapConnectionRow, folder: string, uid: number, handler: (parsed: import('mailparser').ParsedMail) => T): Promise<T> {
  const password = decryptSecret(connection.imap_password_encrypted);
  const client = new ImapFlow({
    host: connection.imap_host,
    port: connection.imap_port,
    secure: true,
    auth: { user: connection.imap_username, pass: password },
    logger: false,
    connectionTimeout: 10000,
  });

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { client.close(); } catch { /* already closed / never opened */ }
      reject(new Error('Délai dépassé : le serveur IMAP ne répond pas.'));
    }, IMAP_FETCH_TIMEOUT_MS);

    (async () => {
      await client.connect();
      await client.mailboxOpen(folder);
      const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
      if (!msg || !msg.source) throw new Error('Message introuvable');
      const parsed = await simpleParser(msg.source);
      resolve(handler(parsed));
    })()
      .catch(reject)
      .finally(async () => {
        clearTimeout(timer);
        try { await client.logout(); } catch { /* connexion déjà fermée */ }
      });
  });
}

// to/cc can come back as a single AddressObject or an array of them
// (grouped recipients) — normalize both to one display string.
function imapAddr(a?: { text: string } | { text: string }[]): string {
  return !a ? '' : Array.isArray(a) ? a.map(x => x.text).join(', ') : a.text;
}

export async function fetchImapFullMessage(connection: ImapConnectionRow, folder: string, uid: number): Promise<FullMailMessage> {
  return withParsedImapMessage(connection, folder, uid, parsed => {
    const attachments: MailAttachmentMeta[] = (parsed.attachments || [])
      .filter(a => !a.related) // déjà intégrées dans le HTML en data: URI par mailparser
      .map(a => ({ id: a.cid || a.checksum, filename: a.filename || 'pièce jointe', mimeType: a.contentType, size: a.size || 0 }));

    return {
      id: String(uid),
      subject: parsed.subject || '',
      from: imapAddr(parsed.from),
      to: imapAddr(parsed.to),
      cc: imapAddr(parsed.cc),
      date: parsed.date ? parsed.date.toISOString() : null,
      messageIdHeader: parsed.messageId || null,
      threadId: null,
      bodyHtml: parsed.html ? sanitizeMailHtml(parsed.html) : null,
      bodyText: parsed.text || null,
      attachments,
    };
  });
}

export async function fetchImapAttachment(connection: ImapConnectionRow, folder: string, uid: number, attachmentId: string): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
  return withParsedImapMessage(connection, folder, uid, parsed => {
    const match = (parsed.attachments || []).find(a => !a.related && (a.cid === attachmentId || a.checksum === attachmentId));
    if (!match) return null;
    return { buffer: match.content, filename: match.filename || 'pièce jointe', mimeType: match.contentType };
  });
}
