// Per-provider folder/label list for the Mailbox page — each connected
// provider keeps its own selected folder (Gmail labels, Outlook folders,
// IMAP mailboxes are three different concepts normalized server-side by
// server/mailFolders.ts into one common {id, name, specialUse} shape).
// Folders are fetched once per provider on mount/connection change and not
// refreshed automatically — consistent with the rest of the mail connectors,
// which never poll in the background.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconBrandGoogle, IconBrandWindows, IconMailbox, IconInbox, IconSend,
  IconFileText, IconArchive, IconTrash, IconAlertTriangle, IconFolder, IconLoader2,
} from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

export type MailProvider = 'google' | 'microsoft' | 'infomaniak';
type MailSpecialUse = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'spam' | null;

interface MailFolder {
  id: string;
  name: string;
  specialUse: MailSpecialUse;
}

interface MailFolderSidebarProps {
  providers: { provider: MailProvider; email: string }[];
  selected: Partial<Record<MailProvider, string>>;
  onSelectFolder: (provider: MailProvider, folderId: string, folderName: string) => void;
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

export default function MailFolderSidebar({ providers, selected, onSelectFolder }: MailFolderSidebarProps) {
  const { t } = useTranslation();
  const [foldersByProvider, setFoldersByProvider] = useState<Partial<Record<MailProvider, MailFolder[]>>>({});
  const [loading, setLoading] = useState<Partial<Record<MailProvider, boolean>>>({});

  useEffect(() => {
    providers.forEach(({ provider }) => {
      setLoading(prev => ({ ...prev, [provider]: true }));
      apiFetch<MailFolder[]>(FOLDER_ENDPOINT[provider])
        .then(folders => setFoldersByProvider(prev => ({ ...prev, [provider]: folders })))
        .catch(() => setFoldersByProvider(prev => ({ ...prev, [provider]: [] })))
        .finally(() => setLoading(prev => ({ ...prev, [provider]: false })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.map(p => p.provider).join(',')]);

  if (providers.length === 0) return null;

  return (
    <div className="w-full sm:w-48 shrink-0 space-y-4">
      {providers.map(({ provider, email }) => {
        const Icon = PROVIDER_ICON[provider];
        const folders = foldersByProvider[provider] || [];
        const activeFolder = selected[provider] || DEFAULT_FOLDER_ID[provider];
        return (
          <div key={provider}>
            <div className="flex items-center gap-1.5 px-1 mb-1 text-xs font-semibold truncate" style={{ color: 'var(--tblr-muted)' }}>
              <Icon size={13} className="shrink-0" /> <span className="truncate">{email}</span>
            </div>
            {loading[provider] && folders.length === 0 ? (
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
                      onClick={() => onSelectFolder(provider, f.id, f.name)}
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
                {!loading[provider] && folders.length === 0 && (
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
