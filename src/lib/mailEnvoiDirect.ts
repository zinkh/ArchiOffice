// ── Envoi d'un message neuf, sans fenêtre de rédaction ──────────────────────
// Sert aux envois en série (DCE à plusieurs entreprises) où chaque message est composé par le
// programme. Mêmes routes et mêmes formats que MailComposeModal pour un NOUVEAU message (pas de
// réponse, pas de transfert) : Gmail et Outlook par leur API, une boîte IMAP avec SMTP propre ou
// le SMTP du cabinet par POST /api/send-email.
import { apiFetch } from './api';
import { getAccessToken } from './authToken';
import { fileToEmailAttachment } from './emailAttachments';
import type { MailAccount } from '../hooks/useMailAccounts';

/** Un compte peut envoyer par lui-même (API du fournisseur ou SMTP propre). */
export function peutEnvoyer(a: MailAccount): boolean {
  return a.provider === 'google' || a.provider === 'microsoft' || a.hasSmtp;
}

async function postForm(url: string, form: FormData): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(url, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Échec de l'envoi (${res.status})`), { code: data.code });
}

const enHtml = (texte: string) => `<p>${texte.replace(/\n/g, '<br/>')}</p>`;

export interface MessageDirect {
  /** Compte expéditeur ; absent : SMTP du cabinet. */
  account: MailAccount | null;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  files: File[];
}

export async function envoyerMessageDirect({ account, to, cc, subject, body, files }: MessageDirect): Promise<void> {
  const copie = cc?.trim() || undefined;
  if (account && (account.provider === 'google' || account.provider === 'microsoft')) {
    const fd = new FormData();
    fd.set('to', to);
    if (copie) fd.set('cc', copie);
    fd.set('subject', subject);
    fd.set('text', body);
    fd.set('accountId', account.id);
    files.forEach(f => fd.append('attachments', f));
    await postForm(account.provider === 'google' ? '/api/gmail/send' : '/api/outlook/send', fd);
    return;
  }
  const attachments = files.length ? await Promise.all(files.map(fileToEmailAttachment)) : undefined;
  await apiFetch('/api/send-email', {
    method: 'POST',
    body: JSON.stringify({ to, cc: copie, subject, text: body, html: enHtml(body), accountId: account?.id, attachments }),
  });
}
