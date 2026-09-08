// Per-account folder/label list for the Mailbox page — each connected
// account keeps its own selected folder (Gmail labels, Outlook folders,
// IMAP mailboxes are three different concepts normalized server-side by
// server/mailFolders.ts into one common {id, name, specialUse} shape).
// Keyed by accountId, not provider — since the multi-comptes support, two
// accounts of the same provider each need their own folder list and
// selection. Folders are fetched once per account on mount/connection
// change and not refreshed automatically — consistent with the rest of the
// mail connectors, which never poll in the background.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconBrandGoogle, IconBrandWindows, IconMailbox, IconInbox, IconSend,
  IconFileText, IconArchive, IconTrash, IconAlertTriangle, IconFolder, IconLoader2,
} from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import type { MailAccount, MailProvider } from '../hooks/useMailAccounts';

export type { MailProvider };
type MailSpecialUse = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'spam' | null;

interface MailFolder {
  id: string;
  name: string;
  specialUse: MailSpecialUse;
}

interface MailFolderSidebarProps {
  accounts: MailAccount[];
  selected: Partial<Record<string, string>>; // accountId -> folderId
  onSelectFolder: (accountId: string, provider: MailProvider, folderId: string, folderName: string) => void;
}

const FOLDER_ENDPOINT: Record<MailProvider, string> = {
  google: '/api/gmail/folders',
  microsoft: '/api/outlook/folders',
  infomaniak: '/api/mail/imap/folders',
};

const DEFAULT_FOLDER_ID: Record<MailProvider, string> = {
  google: 'INBOX',
  microsoft: 'inbox',
  infomaniak: 'INBOX',
};

const PROVIDER_ICON: Record<MailProvider, typeof IconBrandGoogle> = {
  google: IconBrandGoogle,
  microsoft: IconBrandWindows,
  infomaniak: IconMailbox,
};

const SPECIAL_USE_ICON: Record<Exclude<MailSpecialUse, null>, typeof IconInbox> = {
  inbox: IconInbox,
  sent: IconSend,
  drafts: IconFileText,
  archive: IconArchive,
  trash: IconTrash,
  spam: IconAlertTriangle,
};

export default function MailFolderSidebar({ accounts, selected, onSelectFolder }: MailFolderSidebarProps) {
  const { t } = useTranslation();
  const [foldersByAccount, setFoldersByAccount] = useState<Record<string, MailFolder[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    accounts.forEach(({ id, provider }) => {
      setLoading(prev => ({ ...prev, [id]: true }));
      apiFetch<MailFolder[]>(`${FOLDER_ENDPOINT[provider]}?accountId=${encodeURIComponent(id)}`)
        .then(folders => setFoldersByAccount(prev => ({ ...prev, [id]: folders })))
        .catch(() => setFoldersByAccount(prev => ({ ...prev, [id]: [] })))
        .finally(() => setLoading(prev => ({ ...prev, [id]: false })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.map(a => a.id).join(',')]);

  if (accounts.length === 0) return null;

  return (
    <div className="w-full sm:w-48 shrink-0 space-y-4">
      {accounts.map(({ id, provider, email, displayName }) => {
        const Icon = PROVIDER_ICON[provider];
        const folders = foldersByAccount[id] || [];
        const activeFolder = selected[id] || DEFAULT_FOLDER_ID[provider];
        return (
          <div key={id}>
            <div className="flex items-center gap-1.5 px-1 mb-1 text-xs font-semibold truncate" style={{ color: 'var(--tblr-muted)' }}>
              <Icon size={13} className="shrink-0" /> <span className="truncate">{displayName || email}</span>
            </div>
            {loading[id] && folders.length === 0 ? (
              <div className="flex items-center justify-center py-2" style={{ color: 'var(--tblr-muted)' }}>
                <IconLoader2 size={14} className="animate-spin" />
              </div>
            ) : (
              <div className="space-y-0.5">
                {folders.map(f => {
                  const FolderIcon = (f.specialUse && SPECIAL_USE_ICON[f.specialUse]) || IconFolder;
                  const active = f.id === activeFolder;
                  return (
                    <button
                      key={f.id}
                      onClick={() => onSelectFolder(id, provider, f.id, f.name)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-left truncate transition-colors"
                      style={active
                        ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }
                        : { color: 'var(--tblr-text)' }}
                    >
                      <FolderIcon size={13} className="shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  );
                })}
                {!loading[id] && folders.length === 0 && (
                  <p className="px-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('mail_folders_empty')}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
