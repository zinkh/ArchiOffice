// Real inbox page: lists messages from every mailbox the user has connected
// (Gmail, Outlook and/or IMAP/Infomaniak — possibly several of the same
// provider, via useMailAccounts) and lets the user attach any message to a
// project, proposal, or tender (server/mailLinks.ts). Same read-only,
// non-storing principle as the rest of the mail connectors: messages are
// listed live on demand, never stored beyond an explicit attach.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBrandGoogle, IconBrandWindows, IconMailbox, IconLoader2, IconLink, IconX, IconRefresh, IconArchive, IconTrash, IconPencil, IconSearch, IconStar, IconStarFilled } from '@tabler/icons-react';
import { apiFetch, fetchJson } from '../lib/api';
import type { Project, Proposal, Tender } from '../types';
import { useMailAccounts, type MailAccount, type MailProvider } from '../hooks/useMailAccounts';
import MailMessageView from '../components/MailMessageView';
import MailFolderSidebar from '../components/MailFolderSidebar';
import MailComposeModal from '../components/MailComposeModal';
import { archiveMailMessage, deleteMailMessage } from '../lib/mailActions';

type LocalType = 'project' | 'proposal' | 'tender';

interface Message {
  accountId: string;
  provider: MailProvider;
  externalMessageId: string;
  externalThreadId?: string | null;
  subject: string;
  from: string;
  to: string;
  date: string | null;
  snippet?: string;
}

const PAGE_SIZE = 25;

const PROVIDER_ICON: Record<MailProvider, typeof IconBrandGoogle> = {
  google: IconBrandGoogle,
  microsoft: IconBrandWindows,
  infomaniak: IconMailbox,
};

// Pagination state par compte — Gmail/Outlook paginent par pageToken, IMAP
// par une fenêtre croissante (limit) puisque son /messages n'est pas
// curseur-paginé (cf. server/routes/imapMailSync.ts).
interface AccountPagination { pageToken: string | null; limit: number; hasMore: boolean }

export default function Mailbox() {
  const { t } = useTranslation();
  const {
    accounts, error, setError,
    showImapForm, setShowImapForm, imapForm, setImapForm, imapConnecting,
    connectGmail, connectOutlook, connectImap, disconnect, setDefault, anyConnected,
    insufficientScopeAccountId, setInsufficientScopeAccountId, noteMailError, reconnectAccount,
  } = useMailAccounts();
  const [actioningKey, setActioningKey] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<Record<string, AccountPagination>>({});
  const [attachTarget, setAttachTarget] = useState<Message | null>(null);
  const [attachedKeys, setAttachedKeys] = useState<Set<string>>(new Set());
  const [readTarget, setReadTarget] = useState<Message | null>(null);
  const [selectedFolders, setSelectedFolders] = useState<Record<string, string>>({});
  const [composing, setComposing] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchForm, setSearchForm] = useState({ q: '', from: '', to: '', subject: '', dateFrom: '', dateTo: '', hasAttachment: false });
  const [searching, setSearching] = useState(false);
  // true once a search has actually run — the message list then shows its
  // results instead of the current folder, and pagination ("load more")
  // is hidden since the search endpoints return a single capped batch.
  const [isSearchActive, setIsSearchActive] = useState(false);
  const hasSearchCriteria = Object.entries(searchForm).some(([k, v]) => (k === 'hasAttachment' ? v === true : String(v).trim() !== ''));

  const [projects, setProjects] = useState<Project[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [tenders, setTenders] = useState<Tender[]>([]);

  useEffect(() => {
    fetchJson<Project[]>('/api/projects').then(setProjects).catch(() => {});
    fetchJson<Proposal[]>('/api/proposals').then(setProposals).catch(() => {});
    fetchJson<Tender[]>('/api/tenders').then(setTenders).catch(() => {});
  }, []);

  const paginationFor = useCallback((accountId: string): AccountPagination =>
    pagination[accountId] || { pageToken: null, limit: PAGE_SIZE, hasMore: true }, [pagination]);

  const listEndpoint = (account: MailAccount, opts: { append: boolean }): string => {
    const p = paginationFor(account.id);
    const folder = selectedFolders[account.id];
    const params = new URLSearchParams({ accountId: account.id });
    if (account.provider === 'google') {
      if (opts.append && p.pageToken) params.set('pageToken', p.pageToken);
      if (folder) params.set('labelId', folder);
      params.set('maxResults', String(PAGE_SIZE));
      return `/api/gmail/messages?${params}`;
    }
    if (account.provider === 'microsoft') {
      if (opts.append && p.pageToken) params.set('pageToken', p.pageToken);
      if (folder) params.set('folderId', folder);
      params.set('maxResults', String(PAGE_SIZE));
      return `/api/outlook/messages?${params}`;
    }
    const nextLimit = opts.append ? p.limit + PAGE_SIZE : PAGE_SIZE;
    params.set('limit', String(nextLimit));
    if (folder) params.set('folder', folder);
    return `/api/mail/imap/messages?${params}`;
  };

  const loadMessages = useCallback(async (opts: { append: boolean } = { append: false }) => {
    if (accounts.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const jobs = accounts
        .filter(a => opts.append ? paginationFor(a.id).hasMore : true)
        .map(async (a): Promise<Message[]> => {
          if (a.provider === 'infomaniak') {
            const nextLimit = opts.append ? paginationFor(a.id).limit + PAGE_SIZE : PAGE_SIZE;
            const rows = await apiFetch<any[]>(listEndpoint(a, opts));
            setPagination(prev => ({ ...prev, [a.id]: { pageToken: null, limit: nextLimit, hasMore: rows.length >= nextLimit } }));
            return rows.map(r => ({
              accountId: a.id, provider: a.provider,
              externalMessageId: `${r.folder}:${r.uid}`,
              subject: r.subject, from: r.from, to: r.to, date: r.date,
            }));
          }
          const res = await apiFetch<{ messages: any[]; nextPageToken: string | null }>(listEndpoint(a, opts));
          setPagination(prev => ({ ...prev, [a.id]: { pageToken: res.nextPageToken, limit: PAGE_SIZE, hasMore: !!res.nextPageToken } }));
          return res.messages.map(r => ({
            accountId: a.id, provider: a.provider,
            externalMessageId: r.id, externalThreadId: r.threadId,
            subject: r.subject, from: r.from, to: r.to, date: r.date, snippet: r.snippet,
          }));
        });
      const settled = await Promise.all(jobs);
      setMessages(prev => {
        // Gmail/Outlook pages append via their own token; IMAP re-fetches
        // its whole growing window each call — so merge everything fresh
        // and de-dupe rather than trying to patch prev in place per-account.
        const combined = opts.append ? [...prev, ...settled.flat()] : settled.flat();
        const seen = new Set<string>();
        const deduped = combined.filter(m => {
          const key = `${m.accountId}-${m.externalMessageId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        deduped.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
        return deduped;
      });
    } catch (err: any) {
      setError(err?.message || t('correspondence_search_error') as string);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, selectedFolders, setError, t]);

  const selectFolder = (accountId: string, _provider: MailProvider, folderId: string) => {
    setSelectedFolders(prev => ({ ...prev, [accountId]: folderId }));
    setIsSearchActive(false);
    setPagination(prev => ({ ...prev, [accountId]: { pageToken: null, limit: PAGE_SIZE, hasMore: true } }));
  };

  // Advanced search — unlike loadMessages() above, each provider's /search
  // endpoint returns one capped batch (no pageToken/nextPageToken), so
  // results replace `messages` outright rather than appending, and "load
  // more" is hidden for the duration (see the `hasMore` computation below).
  const runSearch = useCallback(async () => {
    if (!hasSearchCriteria) return;
    setSearching(true);
    setError(null);
    try {
      const base = new URLSearchParams();
      if (searchForm.q.trim()) base.set('q', searchForm.q.trim());
      if (searchForm.from.trim()) base.set('from', searchForm.from.trim());
      if (searchForm.to.trim()) base.set('to', searchForm.to.trim());
      if (searchForm.subject.trim()) base.set('subject', searchForm.subject.trim());
      if (searchForm.dateFrom) base.set('dateFrom', searchForm.dateFrom);
      if (searchForm.dateTo) base.set('dateTo', searchForm.dateTo);
      if (searchForm.hasAttachment) base.set('hasAttachment', 'true');

      const jobs = accounts.map(async (a): Promise<Message[]> => {
        const params = new URLSearchParams(base);
        params.set('accountId', a.id);
        const folder = selectedFolders[a.id];
        if (a.provider === 'infomaniak') {
          if (folder) params.set('folder', folder);
          const rows = await apiFetch<any[]>(`/api/mail/imap/search?${params}`);
          return rows.map(r => ({ accountId: a.id, provider: a.provider, externalMessageId: `${r.folder}:${r.uid}`, subject: r.subject, from: r.from, to: r.to, date: r.date }));
        }
        if (folder) params.set('folderId', folder);
        const path = a.provider === 'google' ? `/api/gmail/search?${params}` : `/api/outlook/search?${params}`;
        const rows = await apiFetch<any[]>(path);
        return rows.map(r => ({ accountId: a.id, provider: a.provider, externalMessageId: r.id, externalThreadId: r.threadId, subject: r.subject, from: r.from, to: r.to, date: r.date, snippet: r.snippet }));
      });

      const settled = await Promise.all(jobs);
      const combined = settled.flat();
      const seen = new Set<string>();
      const deduped = combined.filter(m => {
        const key = `${m.accountId}-${m.externalMessageId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      deduped.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
      setMessages(deduped);
      setIsSearchActive(true);
    } catch (err: any) {
      setError(err?.message || t('mailbox_search_error') as string);
    } finally {
      setSearching(false);
    }
  }, [searchForm, hasSearchCriteria, accounts, selectedFolders, setError, t]);

  const clearSearch = () => {
    setIsSearchActive(false);
    setSearchForm({ q: '', from: '', to: '', subject: '', dateFrom: '', dateTo: '', hasAttachment: false });
    loadMessages({ append: false });
  };

  useEffect(() => {
    if (anyConnected) {
      setPagination({});
      loadMessages({ append: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.map(a => a.id).join(',')]);

  // Re-fetch when the user picks a different folder for any account —
  // separate from the connection-list effect above so switching folders
  // doesn't reset every other account's pagination too.
  useEffect(() => {
    if (anyConnected) loadMessages({ append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolders]);

  const hasMore = !isSearchActive && accounts.some(a => paginationFor(a.id).hasMore);

  const attach = async (localType: LocalType, localId: string) => {
    if (!attachTarget) return;
    await apiFetch('/api/mail/links', {
      method: 'POST',
      body: JSON.stringify({
        provider: attachTarget.provider,
        connection_id: attachTarget.accountId,
        local_type: localType,
        local_id: localId,
        external_message_id: attachTarget.externalMessageId,
        external_thread_id: attachTarget.externalThreadId,
        subject: attachTarget.subject,
        snippet: attachTarget.snippet,
        from_address: attachTarget.from,
        to_addresses: attachTarget.to,
        message_date: attachTarget.date ? new Date(attachTarget.date).toISOString() : null,
      }),
    });
    setAttachedKeys(prev => new Set(prev).add(`${attachTarget.accountId}-${attachTarget.externalMessageId}`));
    setAttachTarget(null);
  };

  // IMAP encodes its provider-agnostic externalMessageId as "folder:uid"
  // (see loadMessages above) since IMAP has no message id independent of a
  // mailbox — Gmail/Outlook ids are already globally addressable.
  function splitImapKey(externalMessageId: string): { folder: string; messageId: string } {
    const [folder, ...rest] = externalMessageId.split(':');
    return { folder, messageId: rest.join(':') };
  }

  const readTargetProps = readTarget
    ? readTarget.provider === 'infomaniak'
      ? { accountId: readTarget.accountId, provider: readTarget.provider, ...splitImapKey(readTarget.externalMessageId) }
      : { accountId: readTarget.accountId, provider: readTarget.provider, messageId: readTarget.externalMessageId }
    : null;

  const runMailAction = async (m: Message, action: (provider: MailProvider, messageId: string, folder: string | undefined, accountId: string) => Promise<void>) => {
    const key = `${m.accountId}-${m.externalMessageId}`;
    setActioningKey(key);
    try {
      if (m.provider === 'infomaniak') {
        const { folder, messageId } = splitImapKey(m.externalMessageId);
        await action(m.provider, messageId, folder, m.accountId);
      } else {
        await action(m.provider, m.externalMessageId, undefined, m.accountId);
      }
      setMessages(prev => prev.filter(x => `${x.accountId}-${x.externalMessageId}` !== key));
    } catch (err: any) {
      noteMailError(m.accountId, err);
    } finally {
      setActioningKey(null);
    }
  };

  const handleArchive = (m: Message) => runMailAction(m, archiveMailMessage);
  const handleDelete = (m: Message) => runMailAction(m, deleteMailMessage);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('mailbox_title')}</h1>
        {anyConnected && (
          <div className="flex items-center gap-2">
            <button onClick={() => setComposing(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--tblr-primary)', color: 'white' }}>
              <IconPencil size={13} /> {t('mailbox_compose_new')}
            </button>
            <button onClick={() => loadMessages({ append: false })} disabled={loading} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-60" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
              {loading ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />} {t('correspondence_search')}
            </button>
            <button
              onClick={() => setSearchOpen(v => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
              style={searchOpen
                ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary)' }
                : { border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              <IconSearch size={13} /> {t('mailbox_search_toggle')}
            </button>
          </div>
        )}
      </div>

      {anyConnected && searchOpen && (
        <form
          onSubmit={e => { e.preventDefault(); runSearch(); }}
          className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 rounded-lg"
          style={{ border: '1px solid var(--tblr-border)' }}
        >
          <input
            placeholder={t('mailbox_search_query_placeholder') as string}
            className="p-2 rounded-lg text-sm col-span-2 sm:col-span-3"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            value={searchForm.q}
            onChange={e => setSearchForm(f => ({ ...f, q: e.target.value }))}
          />
          <input
            placeholder={t('mailbox_search_from') as string}
            className="p-2 rounded-lg text-sm"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            value={searchForm.from}
            onChange={e => setSearchForm(f => ({ ...f, from: e.target.value }))}
          />
          <input
            placeholder={t('mailbox_search_to') as string}
            className="p-2 rounded-lg text-sm"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            value={searchForm.to}
            onChange={e => setSearchForm(f => ({ ...f, to: e.target.value }))}
          />
          <input
            placeholder={t('mailbox_search_subject') as string}
            className="p-2 rounded-lg text-sm"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            value={searchForm.subject}
            onChange={e => setSearchForm(f => ({ ...f, subject: e.target.value }))}
          />
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--tblr-muted)' }}>
            {t('mailbox_search_date_from')}
            <input
              type="date"
              className="p-2 rounded-lg text-sm"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              value={searchForm.dateFrom}
              onChange={e => setSearchForm(f => ({ ...f, dateFrom: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--tblr-muted)' }}>
            {t('mailbox_search_date_to')}
            <input
              type="date"
              className="p-2 rounded-lg text-sm"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              value={searchForm.dateTo}
              onChange={e => setSearchForm(f => ({ ...f, dateTo: e.target.value }))}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--tblr-text)' }}>
            <input
              type="checkbox"
              checked={searchForm.hasAttachment}
              onChange={e => setSearchForm(f => ({ ...f, hasAttachment: e.target.checked }))}
            />
            {t('mailbox_search_has_attachment')}
          </label>
          <div className="col-span-2 sm:col-span-3 flex items-center gap-2">
            <button
              type="submit"
              disabled={searching || !hasSearchCriteria}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-60"
              style={{ background: 'var(--tblr-primary)', color: 'white' }}
            >
              {searching && <IconLoader2 size={13} className="animate-spin" />} {t('mailbox_search_submit')}
            </button>
            {isSearchActive && (
              <button type="button" onClick={clearSearch} className="text-xs hover:underline" style={{ color: 'var(--tblr-muted)' }}>
                {t('mailbox_search_clear')}
              </button>
            )}
          </div>
          {!hasSearchCriteria && (
            <p className="col-span-2 sm:col-span-3 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('mailbox_search_empty_criteria')}</p>
          )}
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {accounts.map(a => {
          const Icon = PROVIDER_ICON[a.provider];
          return (
            <span key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
              <Icon size={13} />
              {a.displayName || a.email}
              <button
                onClick={() => setDefault(a.id)}
                disabled={a.isDefault}
                title={a.isDefault ? (t('mail_accounts_default') as string) : (t('mail_accounts_set_default') as string)}
                className="disabled:opacity-100"
                style={{ color: a.isDefault ? 'var(--tblr-warning)' : 'var(--tblr-muted)' }}
              >
                {a.isDefault ? <IconStarFilled size={13} /> : <IconStar size={13} />}
              </button>
              <button onClick={() => disconnect(a.id)} className="ml-1 hover:underline" style={{ color: 'var(--tblr-danger)' }}>{t('correspondence_disconnect')}</button>
            </span>
          );
        })}
        <button onClick={connectGmail} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
          <IconBrandGoogle size={13} /> {t('correspondence_connect_gmail')}
        </button>
        <button onClick={connectOutlook} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
          <IconBrandWindows size={13} /> {t('correspondence_connect_outlook')}
        </button>
        <button onClick={() => setShowImapForm(v => !v)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
          <IconMailbox size={13} /> {t('correspondence_connect_imap')}
        </button>
      </div>

      {showImapForm && (
        <form onSubmit={connectImap} className="grid grid-cols-2 gap-2 p-3 rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
          <input required placeholder={t('correspondence_connect_imap_host') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.host} onChange={e => setImapForm({ ...imapForm, host: e.target.value })} />
          <input required placeholder={t('correspondence_connect_imap_port') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.port} onChange={e => setImapForm({ ...imapForm, port: e.target.value })} />
          <input required type="email" placeholder={t('correspondence_connect_imap_username') as string} className="p-2 rounded-lg text-sm col-span-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.username} onChange={e => setImapForm({ ...imapForm, username: e.target.value })} />
          <input required type="password" placeholder={t('correspondence_connect_imap_password') as string} className="p-2 rounded-lg text-sm col-span-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.password} onChange={e => setImapForm({ ...imapForm, password: e.target.value })} />
          <p className="col-span-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('correspondence_connect_imap_password_hint')}</p>
          <p className="col-span-2 text-xs font-semibold uppercase tracking-wide mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('mail_accounts_smtp_section')}</p>
          <input placeholder={t('correspondence_connect_imap_host') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.smtpHost} onChange={e => setImapForm({ ...imapForm, smtpHost: e.target.value })} />
          <input placeholder={t('correspondence_connect_imap_port') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.smtpPort} onChange={e => setImapForm({ ...imapForm, smtpPort: e.target.value })} />
          <input type="email" placeholder={t('correspondence_connect_imap_username') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.smtpUsername} onChange={e => setImapForm({ ...imapForm, smtpUsername: e.target.value })} />
          <input type="password" placeholder={t('correspondence_connect_imap_password') as string} className="p-2 rounded-lg text-sm col-span-1" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} value={imapForm.smtpPassword} onChange={e => setImapForm({ ...imapForm, smtpPassword: e.target.value })} />
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

      {insufficientScopeAccountId && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <span>{t('mail_reconnect_banner')}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => reconnectAccount(insufficientScopeAccountId)}
              className="px-2.5 py-1 rounded-lg font-medium"
              style={{ background: 'var(--tblr-primary)', color: 'white' }}
            >
              {t('mail_reconnect_button')}
            </button>
            <button onClick={() => setInsufficientScopeAccountId(null)} className="hover:underline">{t('mail_reconnect_dismiss')}</button>
          </div>
        </div>
      )}

      {!anyConnected && (
        <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('correspondence_none_connected')}</p>
      )}

      {anyConnected && (
        <div className="flex flex-col sm:flex-row gap-4">
          <MailFolderSidebar accounts={accounts} selected={selectedFolders} onSelectFolder={selectFolder} />
          <div className="flex-1 min-w-0 space-y-1.5">
          {messages.map(m => {
            const key = `${m.accountId}-${m.externalMessageId}`;
            return (
              <div
                key={key}
                onClick={() => setReadTarget(m)}
                className="flex items-center justify-between gap-3 p-3 rounded-lg text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                style={{ border: '1px solid var(--tblr-border)' }}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{m.subject || '(Sans objet)'}</div>
                  <div className="truncate text-xs" style={{ color: 'var(--tblr-muted)' }}>{m.from} → {m.to} · {m.date ? new Date(m.date).toLocaleString() : ''}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); setAttachTarget(m); }}
                    disabled={attachedKeys.has(key)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs disabled:opacity-50"
                    style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)' }}
                  >
                    <IconLink size={12} /> {attachedKeys.has(key) ? t('correspondence_linked') : t('correspondence_link')}
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleArchive(m); }}
                    disabled={actioningKey === key}
                    title={t('mail_archive') as string}
                    className="p-1.5 rounded-lg disabled:opacity-50"
                    style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  >
                    <IconArchive size={13} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(m); }}
                    disabled={actioningKey === key}
                    title={t('mail_delete') as string}
                    className="p-1.5 rounded-lg disabled:opacity-50"
                    style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-danger)' }}
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
              </div>
            );
          })}
          {messages.length === 0 && !loading && !searching && (
            <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
              {isSearchActive ? t('mailbox_search_results_empty') : t('correspondence_linked_empty')}
            </p>
          )}
          {hasMore && messages.length > 0 && (
            <div className="flex justify-center pt-2">
              <button onClick={() => loadMessages({ append: true })} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-60" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
                {loading && <IconLoader2 size={13} className="animate-spin" />} {t('mailbox_load_more')}
              </button>
            </div>
          )}
          </div>
        </div>
      )}

      {attachTarget && (
        <AttachPicker
          message={attachTarget}
          projects={projects}
          proposals={proposals}
          tenders={tenders}
          onAttach={attach}
          onClose={() => setAttachTarget(null)}
        />
      )}

      {readTargetProps && (
        <MailMessageView
          provider={readTargetProps.provider}
          accountId={readTargetProps.accountId}
          messageId={readTargetProps.messageId}
          folder={'folder' in readTargetProps ? readTargetProps.folder : undefined}
          accounts={accounts}
          onClose={() => setReadTarget(null)}
        />
      )}

      {composing && (
        <MailComposeModal
          accounts={accounts}
          onClose={() => setComposing(false)}
          onSent={() => loadMessages({ append: false })}
        />
      )}
    </div>
  );
}

function AttachPicker({ message, projects, proposals, tenders, onAttach, onClose }: {
  message: Message;
  projects: Project[];
  proposals: Proposal[];
  tenders: Tender[];
  onAttach: (localType: LocalType, localId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<LocalType>('project');
  const [query, setQuery] = useState('');

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = type === 'project'
      ? projects.map(p => ({ id: p.id, label: p.name }))
      : type === 'proposal'
      ? proposals.map(p => ({ id: p.id, label: p.title }))
      : tenders.map(tn => ({ id: tn.id, label: tn.title }));
    return (q ? list.filter(o => o.label?.toLowerCase().includes(q)) : list).slice(0, 20);
  }, [type, query, projects, proposals, tenders]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }} onClick={e => e.stopPropagation()}>
        <div className="p-4 flex justify-between items-center" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <div className="min-w-0">
            <h3 className="text-sm font-bold truncate" style={{ color: 'var(--tblr-text)' }}>{t('correspondence_link')}</h3>
            <p className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{message.subject || '(Sans objet)'}</p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>
        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          <div className="flex gap-2">
            {(['project', 'proposal', 'tender'] as LocalType[]).map(opt => (
              <button
                key={opt}
                onClick={() => setType(opt)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={opt === type
                  ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary)' }
                  : { border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
              >
                {t(`mailbox_attach_type_${opt}`)}
              </button>
            ))}
          </div>
          <input
            autoFocus
            placeholder={t('mailbox_attach_search_placeholder') as string}
            className="w-full p-2 rounded-lg text-sm"
            style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="space-y-1">
            {options.map(o => (
              <button
                key={o.id}
                onClick={() => onAttach(type, o.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-black/5 dark:hover:bg-white/5 transition-colors truncate"
                style={{ border: '1px solid var(--tblr-border)' }}
              >
                {o.label || t('mailbox_attach_untitled')}
              </button>
            ))}
            {options.length === 0 && (
              <p className="text-sm text-center py-4" style={{ color: 'var(--tblr-muted)' }}>{t('correspondence_search_empty')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
