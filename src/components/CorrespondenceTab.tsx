// Correspondence connector for a project/contact/tender/proposal record —
// lets the user connect Gmail and/or IMAP (via useMailConnections, shared
// with the Mailbox page), search either one live for emails involving a
// given address, and explicitly attach results to this record (server/
// mailLinks.ts). On the same read-only, non-storing principle as
// Calendar.tsx's Google Calendar widget: nothing is fetched or kept beyond
// what's attached here.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBrandGoogle, IconBrandWindows, IconMailbox, IconLoader2, IconSearch, IconLink, IconUnlink, IconX, IconArchive, IconTrash, IconFolderPlus, IconFolder, IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { useMailConnections } from '../hooks/useMailConnections';
import MailMessageView, { type MailProvider } from './MailMessageView';
import MailFolderSidebar from './MailFolderSidebar';
import { archiveMailMessage, deleteMailMessage } from '../lib/mailActions';

interface CorrespondenceTabProps {
  localType: 'project' | 'contact' | 'tender' | 'proposal';
  localId: string;
  contactEmail?: string | null;
}

interface SearchResult {
  provider: 'google' | 'microsoft' | 'infomaniak';
  externalMessageId: string;
  externalThreadId?: string | null;
  subject: string;
  from: string;
  to: string;
  date: string | null;
  snippet?: string;
}

interface LinkedEmail {
  id: string;
  provider: string;
  external_message_id: string;
  subject: string | null;
  from_address: string | null;
  to_addresses: string | null;
  message_date: string | null;
  linked_at: string;
}

interface FolderLink {
  id: string;
  provider: MailProvider;
  folder_id: string;
  folder_name: string;
}

interface FolderMessage {
  provider: MailProvider;
  externalMessageId: string;
  subject: string;
  from: string;
  to: string;
  date: string | null;
}

export default function CorrespondenceTab({ localType, localId, contactEmail }: CorrespondenceTabProps) {
  const { t } = useTranslation();
  const {
    gmailStatus, outlookStatus, imapStatus, error, setError,
    showImapForm, setShowImapForm, imapForm, setImapForm, imapConnecting,
    connectGmail, disconnectGmail, connectOutlook, disconnectOutlook, connectImap, disconnectImap, anyConnected,
    insufficientScopeProvider, setInsufficientScopeProvider, noteMailError,
  } = useMailConnections();
  const [linked, setLinked] = useState<LinkedEmail[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [readTarget, setReadTarget] = useState<{ provider: MailProvider; messageId: string; folder?: string } | null>(null);
  const [actioningKey, setActioningKey] = useState<string | null>(null);
  const [folderLinks, setFolderLinks] = useState<FolderLink[]>([]);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [openFolderLinkId, setOpenFolderLinkId] = useState<string | null>(null);
  const [folderMessages, setFolderMessages] = useState<FolderMessage[]>([]);
  const [folderMessagesLoading, setFolderMessagesLoading] = useState(false);

  // IMAP encodes its provider-agnostic external_message_id as "folder:uid"
  // (see search()/loadLinked() below) since IMAP has no message id
  // independent of a mailbox — Gmail/Outlook ids are already global.
  function splitImapKey(externalMessageId: string): { folder: string; messageId: string } {
    const [folder, ...rest] = externalMessageId.split(':');
    return { folder, messageId: rest.join(':') };
  }

  const openReader = (provider: string, externalMessageId: string) => {
    if (provider === 'infomaniak') {
      setReadTarget({ provider: 'infomaniak', ...splitImapKey(externalMessageId) });
    } else {
      setReadTarget({ provider: provider as MailProvider, messageId: externalMessageId });
    }
  };

  const runMailAction = async (r: SearchResult, action: (provider: MailProvider, messageId: string, folder?: string) => Promise<void>) => {
    const key = `${r.provider}-${r.externalMessageId}`;
    setActioningKey(key);
    try {
      if (r.provider === 'infomaniak') {
        const { folder, messageId } = splitImapKey(r.externalMessageId);
        await action(r.provider, messageId, folder);
      } else {
        await action(r.provider, r.externalMessageId);
      }
      setResults(prev => prev.filter(x => `${x.provider}-${x.externalMessageId}` !== key));
    } catch (err: any) {
      noteMailError(r.provider, err);
    } finally {
      setActioningKey(null);
    }
  };

  const connectedProviders: { provider: MailProvider; email: string }[] = [
    ...(gmailStatus.connected ? [{ provider: 'google' as const, email: gmailStatus.email || '' }] : []),
    ...(outlookStatus.connected ? [{ provider: 'microsoft' as const, email: outlookStatus.email || '' }] : []),
    ...(imapStatus.connected ? [{ provider: 'infomaniak' as const, email: imapStatus.email || '' }] : []),
  ];

  const loadLinked = useCallback(async () => {
    try {
      const data = await apiFetch<LinkedEmail[]>(`/api/mail/links?local_type=${localType}&local_id=${localId}`);
      setLinked(Array.isArray(data) ? data : []);
    } catch {
      setLinked([]);
    }
  }, [localType, localId]);

  useEffect(() => { loadLinked(); }, [loadLinked]);

  const loadFolderLinks = useCallback(async () => {
    try {
      const data = await apiFetch<FolderLink[]>(`/api/mail/folder-links?local_type=${localType}&local_id=${localId}`);
      setFolderLinks(Array.isArray(data) ? data : []);
    } catch {
      setFolderLinks([]);
    }
  }, [localType, localId]);

  useEffect(() => { loadFolderLinks(); }, [loadFolderLinks]);

  const linkFolder = async (provider: MailProvider, folderId: string, folderName: string) => {
    const status = provider === 'google' ? gmailStatus : provider === 'microsoft' ? outlookStatus : imapStatus;
    if (!status.id) return;
    try {
      await apiFetch('/api/mail/folder-links', {
        method: 'POST',
        body: JSON.stringify({
          connection_id: status.id,
          provider,
          folder_id: folderId,
          folder_name: folderName,
          local_type: localType,
          local_id: localId,
        }),
      });
      setShowFolderPicker(false);
      await loadFolderLinks();
    } catch (err: any) {
      setError(err?.message || t('mail_action_error') as string);
    }
  };

  const unlinkFolder = async (id: string) => {
    await apiFetch(`/api/mail/folder-links/${id}`, { method: 'DELETE' });
    setFolderLinks(l => l.filter(x => x.id !== id));
    if (openFolderLinkId === id) { setOpenFolderLinkId(null); setFolderMessages([]); }
  };

  const toggleFolderView = async (link: FolderLink) => {
    if (openFolderLinkId === link.id) { setOpenFolderLinkId(null); setFolderMessages([]); return; }
    setOpenFolderLinkId(link.id);
    setFolderMessagesLoading(true);
    setFolderMessages([]);
    try {
      const res = await apiFetch<{ messages: any[] } | any[]>(`/api/mail/folder-links/${link.id}/messages`);
      const rows = Array.isArray(res) ? res : res.messages || [];
      setFolderMessages(rows.map((r: any) => ({
        provider: link.provider,
        externalMessageId: link.provider === 'infomaniak' ? `${r.folder}:${r.uid}` : r.id,
        subject: r.subject, from: r.from, to: r.to, date: r.date,
      })));
    } catch (err: any) {
      setError(err?.message || t('mail_action_error') as string);
    } finally {
      setFolderMessagesLoading(false);
    }
  };

  const search = async () => {
    if (!contactEmail) return;
    setSearching(true);
    setError(null);
    setResults([]);
    try {
      const queries: Promise<SearchResult[]>[] = [];
      if (gmailStatus.connected) {
        queries.push(
          apiFetch<any[]>(`/api/gmail/search?email=${encodeURIComponent(contactEmail)}`)
            .then(rows => rows.map(r => ({
              provider: 'google' as const,
              externalMessageId: r.id,
              externalThreadId: r.threadId,
              subject: r.subject,
              from: r.from,
              to: r.to,
              date: r.date,
              snippet: r.snippet,
            })))
        );
      }
      if (outlookStatus.connected) {
        queries.push(
          apiFetch<any[]>(`/api/outlook/search?email=${encodeURIComponent(contactEmail)}`)
            .then(rows => rows.map(r => ({
              provider: 'microsoft' as const,
              externalMessageId: r.id,
              subject: r.subject,
              from: r.from,
              to: r.to,
              date: r.date,
              snippet: r.snippet,
            })))
        );
      }
      if (imapStatus.connected) {
        queries.push(
          apiFetch<any[]>(`/api/mail/imap/search?email=${encodeURIComponent(contactEmail)}`)
            .then(rows => rows.map(r => ({
              provider: 'infomaniak' as const,
              externalMessageId: `${r.folder}:${r.uid}`,
              subject: r.subject,
              from: r.from,
              to: r.to,
              date: r.date,
            })))
        );
      }
      const settled = await Promise.all(queries);
      setResults(settled.flat());
    } catch (err: any) {
      setError(err?.message || t('correspondence_search_error') as string);
    } finally {
      setSearching(false);
    }
  };

  const linkResult = async (result: SearchResult) => {
    await apiFetch('/api/mail/links', {
      method: 'POST',
      body: JSON.stringify({
        provider: result.provider,
        local_type: localType,
        local_id: localId,
        external_message_id: result.externalMessageId,
        external_thread_id: result.externalThreadId,
        subject: result.subject,
        snippet: result.snippet,
        from_address: result.from,
        to_addresses: result.to,
        message_date: result.date ? new Date(result.date).toISOString() : null,
      }),
    });
    await loadLinked();
  };

  const unlink = async (id: string) => {
    await apiFetch(`/api/mail/links/${id}`, { method: 'DELETE' });
    setLinked(l => l.filter(x => x.id !== id));
  };

  const isLinked = (result: SearchResult) =>
    linked.some(l => l.provider === result.provider && l.external_message_id === result.externalMessageId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {gmailStatus.connected ? (
          <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
            <IconBrandGoogle size={13} /> {gmailStatus.email}
            <button onClick={disconnectGmail} className="ml-1 hover:underline" style={{ color: 'var(--tblr-danger)' }}>{t('correspondence_disconnect')}</button>
          </span>
        ) : (
          <button onClick={connectGmail} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
            <IconBrandGoogle size={13} /> {t('correspondence_connect_gmail')}
          </button>
        )}

        {outlookStatus.connected ? (
          <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
            <IconBrandWindows size={13} /> {outlookStatus.email}
            <button onClick={disconnectOutlook} className="ml-1 hover:underline" style={{ color: 'var(--tblr-danger)' }}>{t('correspondence_disconnect')}</button>
          </span>
        ) : (
          <button onClick={connectOutlook} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
            <IconBrandWindows size={13} /> {t('correspondence_connect_outlook')}
          </button>
        )}

        {imapStatus.connected ? (
          <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
            <IconMailbox size={13} /> {imapStatus.email}
            <button onClick={disconnectImap} className="ml-1 hover:underline" style={{ color: 'var(--tblr-danger)' }}>{t('correspondence_disconnect')}</button>
          </span>
        ) : (
          <button onClick={() => setShowImapForm(v => !v)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
            <IconMailbox size={13} /> {t('correspondence_connect_imap')}
          </button>
        )}

        {anyConnected && contactEmail && (
          <button onClick={search} disabled={searching} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-60 ml-auto" style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)' }}>
            {searching ? <IconLoader2 size={13} className="animate-spin" /> : <IconSearch size={13} />} {t('correspondence_search')}
          </button>
        )}
      </div>

      {showImapForm && !imapStatus.connected && (
        <form onSubmit={connectImap} className="grid grid-cols-2 gap-2 p-3 rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
          <input required placeholder={t('correspondence_connect_imap_host') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.host} onChange={e => setImapForm({ ...imapForm, host: e.target.value })} />
          <input required placeholder={t('correspondence_connect_imap_port') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.port} onChange={e => setImapForm({ ...imapForm, port: e.target.value })} />
          <input required type="email" placeholder={t('correspondence_connect_imap_username') as string} className="p-2 rounded-lg text-sm col-span-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.username} onChange={e => setImapForm({ ...imapForm, username: e.target.value })} />
          <input required type="password" placeholder={t('correspondence_connect_imap_password') as string} className="p-2 rounded-lg text-sm col-span-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.password} onChange={e => setImapForm({ ...imapForm, password: e.target.value })} />
          <p className="col-span-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('correspondence_connect_imap_password_hint')}</p>
          <div className="col-span-2 flex items-center gap-2">
            <button type="submit" disabled={imapConnecting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-60" style={{ background: 'var(--tblr-primary)', color: 'white' }}>
              {imapConnecting && <IconLoader2 size={13} className="animate-spin" />} {t('correspondence_connect_imap_submit')}
            </button>
            <button type="button" onClick={() => setShowImapForm(false)} className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('btn_close') as string}</button>
          </div>
        </form>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          {error}
          <button onClick={() => setError(null)} className="shrink-0"><IconX size={14} /></button>
        </div>
      )}

      {insufficientScopeProvider && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <span>{t('mail_reconnect_banner')}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={insufficientScopeProvider === 'google' ? connectGmail : connectOutlook}
              className="px-2.5 py-1 rounded-lg font-medium"
              style={{ background: 'var(--tblr-primary)', color: 'white' }}
            >
              {t('mail_reconnect_button')}
            </button>
            <button onClick={() => setInsufficientScopeProvider(null)} className="hover:underline">{t('mail_reconnect_dismiss')}</button>
          </div>
        </div>
      )}

      {!anyConnected && (
        <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('correspondence_none_connected')}</p>
      )}

      {results.length > 0 && (
        <div className="space-y-1.5">
          {results.map(r => (
            <div
              key={`${r.provider}-${r.externalMessageId}`}
              onClick={() => openReader(r.provider, r.externalMessageId)}
              className="flex items-center justify-between gap-3 p-2 rounded-lg text-xs cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              style={{ border: '1px solid var(--tblr-border)' }}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{r.subject || '(Sans objet)'}</div>
                <div className="truncate" style={{ color: 'var(--tblr-muted)' }}>{r.from} → {r.to} · {r.date ? new Date(r.date).toLocaleString() : ''}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  disabled={isLinked(r)}
                  onClick={e => { e.stopPropagation(); linkResult(r); }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg disabled:opacity-50"
                  style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)' }}
                >
                  <IconLink size={12} /> {isLinked(r) ? t('correspondence_linked') : t('correspondence_link')}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); runMailAction(r, archiveMailMessage); }}
                  disabled={actioningKey === `${r.provider}-${r.externalMessageId}`}
                  title={t('mail_archive') as string}
                  className="p-1.5 rounded-lg disabled:opacity-50"
                  style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                >
                  <IconArchive size={12} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); runMailAction(r, deleteMailMessage); }}
                  disabled={actioningKey === `${r.provider}-${r.externalMessageId}`}
                  title={t('mail_delete') as string}
                  className="p-1.5 rounded-lg disabled:opacity-50"
                  style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-danger)' }}
                >
                  <IconTrash size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {results.length === 0 && searching === false && anyConnected && contactEmail && linked.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('correspondence_search_empty')}</p>
      )}

      <div>
        <h4 className="text-sm font-semibold mb-1.5">{t('correspondence_title')}</h4>
        {linked.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('correspondence_linked_empty')}</p>
        ) : (
          <div className="space-y-1.5">
            {linked.map(l => (
              <div
                key={l.id}
                onClick={() => openReader(l.provider, l.external_message_id)}
                className="flex items-center justify-between gap-3 p-2 rounded-lg text-xs cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                style={{ border: '1px solid var(--tblr-border)' }}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{l.subject || '(Sans objet)'}</div>
                  <div className="truncate" style={{ color: 'var(--tblr-muted)' }}>{l.from_address} → {l.to_addresses} · {l.message_date ? new Date(l.message_date).toLocaleString() : ''}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); unlink(l.id); }} className="flex items-center gap-1 px-2 py-1 rounded-lg shrink-0 hover:bg-red-50 dark:hover:bg-red-900/20" style={{ color: 'var(--tblr-danger)' }}>
                  <IconUnlink size={12} /> {t('correspondence_unlink')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {anyConnected && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-sm font-semibold">{t('mail_folder_links_title')}</h4>
            <button
              onClick={() => setShowFolderPicker(v => !v)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
              style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              <IconFolderPlus size={13} /> {t('mail_folder_links_add')}
            </button>
          </div>

          {showFolderPicker && (
            <div className="mb-2 p-2 rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
              <MailFolderSidebar providers={connectedProviders} selected={{}} onSelectFolder={linkFolder} />
            </div>
          )}

          {folderLinks.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('mail_folder_links_empty')}</p>
          ) : (
            <div className="space-y-1.5">
              {folderLinks.map(fl => (
                <div key={fl.id} className="rounded-lg text-xs" style={{ border: '1px solid var(--tblr-border)' }}>
                  <div className="flex items-center justify-between gap-3 p-2 cursor-pointer" onClick={() => toggleFolderView(fl)}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {openFolderLinkId === fl.id ? <IconChevronDown size={13} className="shrink-0" /> : <IconChevronRight size={13} className="shrink-0" />}
                      <IconFolder size={13} className="shrink-0" />
                      <span className="truncate font-medium">{fl.folder_name}</span>
                    </div>
                    <button onClick={e => { e.stopPropagation(); unlinkFolder(fl.id); }} className="flex items-center gap-1 px-2 py-1 rounded-lg shrink-0 hover:bg-red-50 dark:hover:bg-red-900/20" style={{ color: 'var(--tblr-danger)' }}>
                      <IconUnlink size={12} /> {t('correspondence_unlink')}
                    </button>
                  </div>
                  {openFolderLinkId === fl.id && (
                    <div className="px-2 pb-2 space-y-1">
                      {folderMessagesLoading && (
                        <div className="flex items-center justify-center py-3" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 size={14} className="animate-spin" /></div>
                      )}
                      {!folderMessagesLoading && folderMessages.length === 0 && (
                        <p style={{ color: 'var(--tblr-muted)' }}>{t('mail_folder_links_folder_empty')}</p>
                      )}
                      {!folderMessagesLoading && folderMessages.map(m => (
                        <div
                          key={`${m.provider}-${m.externalMessageId}`}
                          onClick={() => openReader(m.provider, m.externalMessageId)}
                          className="p-2 rounded-lg cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          style={{ border: '1px solid var(--tblr-border)' }}
                        >
                          <div className="font-medium truncate">{m.subject || '(Sans objet)'}</div>
                          <div className="truncate" style={{ color: 'var(--tblr-muted)' }}>{m.from} → {m.to} · {m.date ? new Date(m.date).toLocaleString() : ''}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {readTarget && (
        <MailMessageView
          provider={readTarget.provider}
          messageId={readTarget.messageId}
          folder={readTarget.folder}
          connectedProviders={connectedProviders}
          onClose={() => setReadTarget(null)}
        />
      )}
    </div>
  );
}
