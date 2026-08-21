// Correspondence connector for a project/contact/tender/proposal record —
// lets the user connect Gmail and/or IMAP (via useMailConnections, shared
// with the Mailbox page), search either one live for emails involving a
// given address, and explicitly attach results to this record (server/
// mailLinks.ts). On the same read-only, non-storing principle as
// Calendar.tsx's Google Calendar widget: nothing is fetched or kept beyond
// what's attached here.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBrandGoogle, IconMailbox, IconLoader2, IconSearch, IconLink, IconUnlink, IconX } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { useMailConnections } from '../hooks/useMailConnections';

interface CorrespondenceTabProps {
  localType: 'project' | 'contact' | 'tender' | 'proposal';
  localId: string;
  contactEmail?: string | null;
}

interface SearchResult {
  provider: 'google' | 'infomaniak';
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

export default function CorrespondenceTab({ localType, localId, contactEmail }: CorrespondenceTabProps) {
  const { t } = useTranslation();
  const {
    gmailStatus, imapStatus, error, setError,
    showImapForm, setShowImapForm, imapForm, setImapForm, imapConnecting,
    connectGmail, disconnectGmail, connectImap, disconnectImap, anyConnected,
  } = useMailConnections();
  const [linked, setLinked] = useState<LinkedEmail[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const loadLinked = useCallback(async () => {
    try {
      const data = await apiFetch<LinkedEmail[]>(`/api/mail/links?local_type=${localType}&local_id=${localId}`);
      setLinked(Array.isArray(data) ? data : []);
    } catch {
      setLinked([]);
    }
  }, [localType, localId]);

  useEffect(() => { loadLinked(); }, [loadLinked]);

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

      {!anyConnected && (
        <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('correspondence_none_connected')}</p>
      )}

      {results.length > 0 && (
        <div className="space-y-1.5">
          {results.map(r => (
            <div key={`${r.provider}-${r.externalMessageId}`} className="flex items-center justify-between gap-3 p-2 rounded-lg text-xs" style={{ border: '1px solid var(--tblr-border)' }}>
              <div className="min-w-0">
                <div className="font-medium truncate">{r.subject || '(Sans objet)'}</div>
                <div className="truncate" style={{ color: 'var(--tblr-muted)' }}>{r.from} → {r.to} · {r.date ? new Date(r.date).toLocaleString() : ''}</div>
              </div>
              <button
                disabled={isLinked(r)}
                onClick={() => linkResult(r)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg shrink-0 disabled:opacity-50"
                style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)' }}
              >
                <IconLink size={12} /> {isLinked(r) ? t('correspondence_linked') : t('correspondence_link')}
              </button>
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
              <div key={l.id} className="flex items-center justify-between gap-3 p-2 rounded-lg text-xs" style={{ border: '1px solid var(--tblr-border)' }}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{l.subject || '(Sans objet)'}</div>
                  <div className="truncate" style={{ color: 'var(--tblr-muted)' }}>{l.from_address} → {l.to_addresses} · {l.message_date ? new Date(l.message_date).toLocaleString() : ''}</div>
                </div>
                <button onClick={() => unlink(l.id)} className="flex items-center gap-1 px-2 py-1 rounded-lg shrink-0 hover:bg-red-50 dark:hover:bg-red-900/20" style={{ color: 'var(--tblr-danger)' }}>
                  <IconUnlink size={12} /> {t('correspondence_unlink')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
