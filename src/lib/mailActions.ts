// Real archive/delete actions on the connected mailbox itself (Gmail
// messages.modify/trash, Outlook move/delete, IMAP messageMove) — shared by
// Mailbox.tsx and CorrespondenceTab.tsx so the three-providers dispatch
// isn't duplicated. See server/routes/{gmailSync,outlookSync,imapMailSync}.ts
// for what each of these calls actually does server-side.
//
// accountId is required since the multi-comptes support: without it these
// calls would silently fall back to the user's default account, which isn't
// necessarily the account the message being archived/deleted belongs to.
import { apiFetch } from './api';

export type MailProvider = 'google' | 'microsoft' | 'infomaniak';

export async function archiveMailMessage(provider: MailProvider, messageId: string, folder: string | undefined, accountId: string): Promise<void> {
  const accountParam = `accountId=${encodeURIComponent(accountId)}`;
  if (provider === 'google') {
    await apiFetch(`/api/gmail/messages/${encodeURIComponent(messageId)}/archive?${accountParam}`, { method: 'POST' });
  } else if (provider === 'microsoft') {
    await apiFetch(`/api/outlook/messages/${encodeURIComponent(messageId)}/move?${accountParam}`, {
      method: 'POST',
      body: JSON.stringify({ destinationId: 'archive' }),
    });
  } else {
    await apiFetch(`/api/mail/imap/messages/${encodeURIComponent(folder || 'INBOX')}/${encodeURIComponent(messageId)}/move?${accountParam}`, {
      method: 'POST',
      body: JSON.stringify({ destination: 'archive' }),
    });
  }
}

export async function deleteMailMessage(provider: MailProvider, messageId: string, folder: string | undefined, accountId: string): Promise<void> {
  const accountParam = `accountId=${encodeURIComponent(accountId)}`;
  if (provider === 'google') {
    await apiFetch(`/api/gmail/messages/${encodeURIComponent(messageId)}/trash?${accountParam}`, { method: 'POST' });
  } else if (provider === 'microsoft') {
    await apiFetch(`/api/outlook/messages/${encodeURIComponent(messageId)}?${accountParam}`, { method: 'DELETE' });
  } else {
    await apiFetch(`/api/mail/imap/messages/${encodeURIComponent(folder || 'INBOX')}/${encodeURIComponent(messageId)}/move?${accountParam}`, {
      method: 'POST',
      body: JSON.stringify({ destination: 'trash' }),
    });
  }
}
