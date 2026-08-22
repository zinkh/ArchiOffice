// Normalizes each provider's very different "folder" concept into one
// common shape the frontend (src/components/MailFolderSidebar.tsx) can
// render without knowing which provider it's looking at. Gmail has no real
// folders — only labels, some of which happen to represent folder-like
// system states; Outlook and IMAP have real folders/mailboxes.
export type MailSpecialUse = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'spam' | null;

export interface MailFolder {
  id: string;
  name: string;
  specialUse: MailSpecialUse;
}

// Gmail's own state/category pseudo-labels aren't folders a user would
// expect to "browse" (STARRED, IMPORTANT, UNREAD, CHAT, CATEGORY_*) — only
// its handful of real system labels and any user-created label are surfaced.
const GMAIL_SYSTEM_SPECIAL_USE: Record<string, MailSpecialUse> = {
  INBOX: 'inbox',
  SENT: 'sent',
  DRAFT: 'drafts',
  TRASH: 'trash',
  SPAM: 'spam',
};
const GMAIL_EXCLUDED_LABELS = new Set([
  'STARRED', 'IMPORTANT', 'UNREAD', 'CHAT', 'ALL_MAIL',
  'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS',
]);

export function normalizeGmailLabels(labels: Array<{ id: string; name: string; type?: string }>): MailFolder[] {
  return labels
    .filter(l => !GMAIL_EXCLUDED_LABELS.has(l.id))
    .map(l => ({
      id: l.id,
      name: l.name,
      specialUse: GMAIL_SYSTEM_SPECIAL_USE[l.id] || null,
    }));
}

const OUTLOOK_WELL_KNOWN_SPECIAL_USE: Record<string, MailSpecialUse> = {
  inbox: 'inbox',
  sentitems: 'sent',
  drafts: 'drafts',
  archive: 'archive',
  deleteditems: 'trash',
  junkemail: 'spam',
};

export function normalizeOutlookFolders(folders: Array<{ id: string; displayName: string; wellKnownName?: string }>): MailFolder[] {
  return folders.map(f => ({
    id: f.id,
    name: f.displayName,
    specialUse: (f.wellKnownName && OUTLOOK_WELL_KNOWN_SPECIAL_USE[f.wellKnownName.toLowerCase()]) || null,
  }));
}

const IMAP_SPECIAL_USE: Record<string, MailSpecialUse> = {
  '\\inbox': 'inbox',
  '\\sent': 'sent',
  '\\drafts': 'drafts',
  '\\archive': 'archive',
  '\\trash': 'trash',
  '\\junk': 'spam',
};

export function normalizeImapMailboxes(mailboxes: Array<{ path: string; name: string; specialUse?: string }>): MailFolder[] {
  return mailboxes.map(m => ({
    id: m.path,
    name: m.name,
    specialUse: (m.specialUse && IMAP_SPECIAL_USE[m.specialUse.toLowerCase()]) || (m.path.toUpperCase() === 'INBOX' ? 'inbox' : null),
  }));
}
