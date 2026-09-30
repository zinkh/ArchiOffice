// Classement d'un email rattaché à une opération, DANS la boîte d'origine :
// un libellé Gmail, un dossier Outlook ou un dossier IMAP nommé d'après
// l'affaire (« ArchiOffice/<code> - <nom> »), créé à la volée s'il n'existe pas.
// Le message est DÉPLACÉ (Gmail : libellé posé et INBOX retiré ; Outlook et
// IMAP : déplacement de dossier), comme le ferait l'architecte à la main.
//
// Deux conséquences que l'appelant (server/mailLinks.ts) doit gérer :
// 1. Outlook et IMAP donnent un NOUVEL identifiant au message déplacé
//    (id Graph, uid) : `newExternalMessageId` est ce qu'il faut enregistrer
//    dans email_links, sinon le lien ne rouvrirait plus rien. Gmail garde le
//    même id (un libellé n'est pas un déplacement).
// 2. C'est une écriture dans la boîte de la personne, qui peut échouer
//    (jeton OAuth connecté avant l'ajout du droit de modification, dossier
//    refusé) : le rattachement, lui, ne doit jamais en dépendre.
import { ImapFlow } from 'imapflow';
import { getGmailAccessToken, getOutlookAccessToken } from './mailOAuthTokens';
import { decryptSecret } from './secretsCrypto';
import type { MailAccountRow } from './mailAccounts';

export const MAIL_FILING_ROOT = 'ArchiOffice';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const IMAP_TIMEOUT_MS = 20000;

export interface FilingResult {
  folder: string;
  newExternalMessageId: string;
}

/** Nom de dossier sûr sur les trois fournisseurs : ni séparateur, ni caractère réservé. */
export function projectFolderName(project: { name?: string | null; project_code?: string | null }): string {
  const raw = [project.project_code, project.name].filter(Boolean).join(' - ') || 'Sans nom';
  const clean = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|.\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return clean || 'Sans nom';
}

async function json(resp: Response): Promise<any> {
  return resp.status === 204 ? {} : resp.json().catch(() => ({}));
}

async function fileGmail(account: MailAccountRow, messageId: string, name: string): Promise<FilingResult> {
  const accessToken = await getGmailAccessToken(account);
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const fullName = `${MAIL_FILING_ROOT}/${name}`;

  const listResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers });
  const list = await json(listResp);
  if (!listResp.ok) throw new Error(list.error?.message || 'Lecture des libellés Gmail impossible');
  let labelId: string | undefined = (list.labels || []).find((l: any) => l.name === fullName)?.id;

  if (!labelId) {
    const createResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      method: 'POST', headers,
      body: JSON.stringify({ name: fullName, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    });
    const created = await json(createResp);
    if (!createResp.ok) throw new Error(created.error?.message || 'Création du libellé Gmail impossible');
    labelId = created.id;
  }

  const modResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`, {
    method: 'POST', headers,
    body: JSON.stringify({ addLabelIds: [labelId], removeLabelIds: ['INBOX'] }),
  });
  const mod = await json(modResp);
  if (!modResp.ok) throw new Error(mod.error?.message || 'Pose du libellé Gmail impossible');
  return { folder: fullName, newExternalMessageId: messageId };
}

async function findOrCreateOutlookFolder(headers: Record<string, string>, parentUrl: string, displayName: string): Promise<string> {
  const q = new URL(parentUrl);
  q.searchParams.set('$filter', `displayName eq '${displayName.replace(/'/g, "''")}'`);
  q.searchParams.set('$top', '1');
  const found = await json(await fetch(q.toString(), { headers }));
  if (found.value?.[0]?.id) return found.value[0].id;
  const resp = await fetch(parentUrl, { method: 'POST', headers, body: JSON.stringify({ displayName }) });
  const created = await json(resp);
  if (!resp.ok) throw new Error(created.error?.message || 'Création du dossier Outlook impossible');
  return created.id;
}

async function fileOutlook(supabaseAdmin: any, account: MailAccountRow, messageId: string, name: string): Promise<FilingResult> {
  const accessToken = await getOutlookAccessToken(supabaseAdmin, account);
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const rootId = await findOrCreateOutlookFolder(headers, `${GRAPH_BASE}/me/mailFolders`, MAIL_FILING_ROOT);
  const folderId = await findOrCreateOutlookFolder(headers, `${GRAPH_BASE}/me/mailFolders/${rootId}/childFolders`, name);
  const resp = await fetch(`${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/move`, {
    method: 'POST', headers, body: JSON.stringify({ destinationId: folderId }),
  });
  const moved = await json(resp);
  if (!resp.ok) throw new Error(moved.error?.message || 'Déplacement du message Outlook impossible');
  return { folder: `${MAIL_FILING_ROOT}/${name}`, newExternalMessageId: moved.id || messageId };
}

/** `externalMessageId` IMAP = « dossier:uid » (voir CorrespondenceTab). */
async function fileImap(account: MailAccountRow, externalMessageId: string, name: string): Promise<FilingResult> {
  const sep = externalMessageId.lastIndexOf(':');
  const sourceFolder = externalMessageId.slice(0, sep);
  const uid = parseInt(externalMessageId.slice(sep + 1), 10);
  if (sep < 1 || !Number.isFinite(uid)) throw new Error('Identifiant de message IMAP invalide');

  const client = new ImapFlow({
    host: account.imap_host, port: account.imap_port, secure: true,
    auth: { user: account.imap_username, pass: decryptSecret(account.imap_password_encrypted) },
    logger: false, connectionTimeout: 10000,
  });
  const work = (async (): Promise<FilingResult> => {
    await client.connect();
    const boxes = await client.list();
    const delim = boxes.find(b => b.delimiter)?.delimiter || '/';
    // Certains serveurs (Dovecot « INBOX. ») n'admettent de dossiers qu'SOUS
    // INBOX : on reprend alors le même préfixe que les dossiers existants.
    const prefix = boxes.some(b => b.path.startsWith(`INBOX${delim}`)) ? `INBOX${delim}` : '';
    const root = `${prefix}${MAIL_FILING_ROOT}`;
    const target = `${root}${delim}${name.split(delim).join(' ')}`;
    const exists = (p: string) => boxes.some(b => b.path === p);
    if (!exists(root)) { try { await client.mailboxCreate(root); } catch { /* déjà là, ou créé implicitement */ } }
    if (!exists(target)) await client.mailboxCreate(target);
    try { await client.mailboxSubscribe(target); } catch { /* facultatif */ }

    await client.mailboxOpen(sourceFolder);
    const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
    const messageIdHeader = msg ? msg.envelope?.messageId : undefined;
    const moved = await client.messageMove(uid, target, { uid: true });
    if (!moved) throw new Error('Déplacement du message IMAP impossible');
    let newUid = moved.uidMap?.get(uid);
    if (!newUid && messageIdHeader) {
      // Serveur sans UIDPLUS : on retrouve le message par son Message-ID.
      await client.mailboxOpen(target);
      const hits = await client.search({ header: { 'message-id': messageIdHeader } }, { uid: true });
      newUid = Array.isArray(hits) && hits.length > 0 ? hits[hits.length - 1] : undefined;
    }
    if (!newUid) throw new Error('Message déplacé, mais son nouvel identifiant est introuvable');
    return { folder: target, newExternalMessageId: `${target}:${newUid}` };
  })();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => {
    try { client.close(); } catch { /* déjà fermé */ }
    reject(new Error('Délai dépassé : le serveur IMAP ne répond pas.'));
  }, IMAP_TIMEOUT_MS));
  try {
    return await Promise.race([work, timeout]);
  } finally {
    try { await client.logout(); } catch { /* connexion déjà fermée, ou coupée */ }
  }
}

export async function fileMessageInProjectFolder(
  supabaseAdmin: any,
  account: MailAccountRow,
  project: { name?: string | null; project_code?: string | null },
  externalMessageId: string,
): Promise<FilingResult> {
  const name = projectFolderName(project);
  if (account.provider === 'google') return fileGmail(account, externalMessageId, name);
  if (account.provider === 'microsoft') return fileOutlook(supabaseAdmin, account, externalMessageId, name);
  if (account.provider === 'infomaniak') return fileImap(account, externalMessageId, name);
  throw new Error('Fournisseur de messagerie inconnu.');
}
