import { describe, expect, it } from 'vitest';
import { normalizeGmailLabels, normalizeOutlookFolders, normalizeImapMailboxes } from '../server/mailFolders';

describe('normalizeGmailLabels', () => {
  it('maps system labels to specialUse and keeps user labels with null specialUse', () => {
    const labels = [
      { id: 'INBOX', name: 'INBOX', type: 'system' },
      { id: 'SENT', name: 'SENT', type: 'system' },
      { id: 'DRAFT', name: 'DRAFT', type: 'system' },
      { id: 'TRASH', name: 'TRASH', type: 'system' },
      { id: 'SPAM', name: 'SPAM', type: 'system' },
      { id: 'Label_123', name: 'Client Dupont', type: 'user' },
    ];
    const out = normalizeGmailLabels(labels);
    expect(out.find(f => f.id === 'INBOX')?.specialUse).toBe('inbox');
    expect(out.find(f => f.id === 'SENT')?.specialUse).toBe('sent');
    expect(out.find(f => f.id === 'Label_123')).toEqual({ id: 'Label_123', name: 'Client Dupont', specialUse: null });
  });

  it('excludes Gmail state/category pseudo-labels', () => {
    const labels = [
      { id: 'INBOX', name: 'INBOX' },
      { id: 'STARRED', name: 'STARRED' },
      { id: 'IMPORTANT', name: 'IMPORTANT' },
      { id: 'UNREAD', name: 'UNREAD' },
      { id: 'CATEGORY_PROMOTIONS', name: 'CATEGORY_PROMOTIONS' },
    ];
    const out = normalizeGmailLabels(labels);
    expect(out.map(f => f.id)).toEqual(['INBOX']);
  });
});

describe('normalizeOutlookFolders', () => {
  it('maps well-known folder names to specialUse', () => {
    const folders = [
      { id: 'abc1', displayName: 'Boîte de réception', wellKnownName: 'inbox' },
      { id: 'abc2', displayName: 'Éléments envoyés', wellKnownName: 'sentitems' },
      { id: 'abc3', displayName: 'Éléments supprimés', wellKnownName: 'deleteditems' },
      { id: 'abc4', displayName: 'Projet Dupont' },
    ];
    const out = normalizeOutlookFolders(folders);
    expect(out.find(f => f.id === 'abc1')?.specialUse).toBe('inbox');
    expect(out.find(f => f.id === 'abc2')?.specialUse).toBe('sent');
    expect(out.find(f => f.id === 'abc3')?.specialUse).toBe('trash');
    expect(out.find(f => f.id === 'abc4')?.specialUse).toBeNull();
  });
});

describe('normalizeImapMailboxes', () => {
  it('maps IMAP specialUse flags to normalized values', () => {
    const mailboxes = [
      { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox' },
      { path: 'Sent', name: 'Sent', specialUse: '\\Sent' },
      { path: 'Archive', name: 'Archive', specialUse: '\\Archive' },
      { path: 'Projet Dupont', name: 'Projet Dupont' },
    ];
    const out = normalizeImapMailboxes(mailboxes);
    expect(out.find(f => f.id === 'INBOX')?.specialUse).toBe('inbox');
    expect(out.find(f => f.id === 'Sent')?.specialUse).toBe('sent');
    expect(out.find(f => f.id === 'Projet Dupont')?.specialUse).toBeNull();
  });

  it('falls back to detecting INBOX by path when no specialUse flag is reported', () => {
    const out = normalizeImapMailboxes([{ path: 'INBOX', name: 'INBOX' }]);
    expect(out[0].specialUse).toBe('inbox');
  });
});
