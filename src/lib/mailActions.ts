// Real archive/delete actions on the connected mailbox itself (Gmail
// messages.modify/trash, Outlook move/delete, IMAP messageMove) — shared by
// Mailbox.tsx and CorrespondenceTab.tsx so the three-providers dispatch
// isn't duplicated. See server/routes/{gmailSync,outlookSync,imapMailSync}.ts
// for what each of these calls actually does server-side.
import { apiFetch } from './api';

export type MailProvider = 'google' | 'microsoft' | 'infomaniak';

export async function archiveMailMessage(provider: MailProvider, messageId: string, folder?: string): Promise<void> {
  if (provider === 'google') {
    await apiFetch(`/api/gmail/messages/${encodeURIComponent(messageId)}/archive`, { method: 'POST' });
  } else if (provider === 'microsoft') {
    await apiFetch(`/api/outlook/messages/${encodeURIComponent(messageId)}/move`, {
      method: 'POST',
      body: JSON.stringify({ destinationId: 'archive' }),
    });
  } else {
    await apiFetch(`/api/mail/imap/messages/${encodeURIComponent(folder || 'INBOX')}/${encodeURIComponent(messageId)}/move`, {
      method: 'POST',
      body: JSON.stringify({ destination: 'archive' }),
    });
  }
}

export async function deleteMailMessage(provider: MailProvider, messageId: string, folder?: string): Promise<void> {
  if (provider === 'google') {
    await apiFetch(`/api/gmail/messages/${encodeURIComponent(messageId)}/trash`, { method: 'POST' });
  } else if (provider === 'microsoft') {
    await apiFetch(`/api/outlook/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
  } else {
    await apiFetch(`/api/mail/imap/messages/${encodeURIComponent(folder || 'INBOX')}/${encodeURIComponent(messageId)}/move`, {
      method: 'POST',
      body: JSON.stringify({ destination: 'trash' }),
    });
  }
}
