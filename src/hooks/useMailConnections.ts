// Shared Gmail/Outlook/IMAP connection state — used by both
// CorrespondenceTab (per-record search + attach) and the Mailbox page (full
// inbox listing), so the OAuth/IMAP connect-disconnect wiring isn't
// duplicated between them.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';

export interface MailStatus {
  connected: boolean;
  id?: string | null;
  email: string | null;
  last_synced_at?: string | null;
}

export function useMailConnections() {
  const { t } = useTranslation();
  const [gmailStatus, setGmailStatus] = useState<MailStatus>({ connected: false, email: null });
  const [outlookStatus, setOutlookStatus] = useState<MailStatus>({ connected: false, email: null });
  const [imapStatus, setImapStatus] = useState<MailStatus>({ connected: false, email: null });
  const [error, setError] = useState<string | null>(null);
  const [showImapForm, setShowImapForm] = useState(false);
  const [imapForm, setImapForm] = useState({ host: 'mail.infomaniak.com', port: '993', username: '', password: '' });
  const [imapConnecting, setImapConnecting] = useState(false);
  // Set when a Gmail/Outlook API call fails with INSUFFICIENT_SCOPE (the
  // stored token predates the gmail.modify+gmail.send / Mail.ReadWrite+
  // Mail.Send scopes added for archive/delete/send) — consumers show a
  // "reconnect" banner instead of a generic error for this case. IMAP has no
  // OAuth scopes to widen, so it's never a valid value here.
  const [insufficientScopeProvider, setInsufficientScopeProvider] = useState<'google' | 'microsoft' | null>(null);

  const loadStatuses = useCallback(async () => {
    const [gmail, outlook, imap] = await Promise.all([
      apiFetch<MailStatus>('/api/gmail/status').catch(() => ({ connected: false, email: null })),
      apiFetch<MailStatus>('/api/outlook/status').catch(() => ({ connected: false, email: null })),
      apiFetch<MailStatus>('/api/mail/imap/status').catch(() => ({ connected: false, email: null })),
    ]);
    setGmailStatus(gmail);
    setOutlookStatus(outlook);
    setImapStatus(imap);
  }, []);

  useEffect(() => { loadStatuses(); }, [loadStatuses]);

  // Handles the redirect back from Gmail's/Outlook's OAuth consent screen —
  // the callback (server/routes/gmailSync.ts, server/routes/outlookSync.ts)
  // sends the browser back to the page it started from, with one of these
  // query params.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('gmail_connected') || params.has('outlook_connected')) {
      loadStatuses();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.has('gmail_error') || params.has('outlook_error')) {
      setError(t('correspondence_connect_imap_error') as string);
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectGmail = async () => {
    try {
      const returnTo = window.location.pathname + window.location.search;
      const { url } = await apiFetch<{ url: string }>(`/api/gmail/auth?returnTo=${encodeURIComponent(returnTo)}`);
      window.location.href = url;
    } catch (err: any) {
      setError(err?.message || null);
    }
  };

  const disconnectGmail = async () => {
    await apiFetch('/api/gmail/disconnect', { method: 'DELETE' });
    setGmailStatus({ connected: false, email: null });
  };

  const connectOutlook = async () => {
    try {
      const returnTo = window.location.pathname + window.location.search;
      const { url } = await apiFetch<{ url: string }>(`/api/outlook/auth?returnTo=${encodeURIComponent(returnTo)}`);
      window.location.href = url;
    } catch (err: any) {
      setError(err?.message || null);
    }
  };

  const disconnectOutlook = async () => {
    await apiFetch('/api/outlook/disconnect', { method: 'DELETE' });
    setOutlookStatus({ connected: false, email: null });
  };

  const connectImap = async (e: React.FormEvent) => {
    e.preventDefault();
    setImapConnecting(true);
    setError(null);
    try {
      // Belt-and-suspenders against the server hanging indefinitely on a
      // stalled IMAP handshake (the server has its own hard timeout too,
      // server/routes/imapMailSync.ts) — this bounds the button's spinner
      // even if something between here and there swallows that response.
      await apiFetch('/api/mail/imap/connect', { method: 'POST', body: JSON.stringify(imapForm), signal: AbortSignal.timeout(20000) });
      setShowImapForm(false);
      setImapForm(f => ({ ...f, password: '' }));
      await loadStatuses();
    } catch (err: any) {
      setError(err?.message || t('correspondence_connect_imap_error') as string);
    } finally {
      setImapConnecting(false);
    }
  };

  const disconnectImap = async () => {
    await apiFetch('/api/mail/imap/disconnect', { method: 'DELETE' });
    setImapStatus({ connected: false, email: null });
  };

  // Callers wrap a Gmail/Outlook mailbox action (archive/delete/send) in a
  // try/catch and pass the caught error here instead of duplicating the
  // err.code === 'INSUFFICIENT_SCOPE' check at every call site.
  const noteMailError = useCallback((provider: 'google' | 'microsoft' | 'infomaniak', err: any) => {
    if (err?.code === 'INSUFFICIENT_SCOPE' && provider !== 'infomaniak') {
      setInsufficientScopeProvider(provider);
    } else {
      setError(err?.message || null);
    }
  }, []);

  return {
    gmailStatus, outlookStatus, imapStatus, error, setError,
    showImapForm, setShowImapForm, imapForm, setImapForm, imapConnecting,
    connectGmail, disconnectGmail, connectOutlook, disconnectOutlook, connectImap, disconnectImap,
    anyConnected: gmailStatus.connected || outlookStatus.connected || imapStatus.connected,
    insufficientScopeProvider, setInsufficientScopeProvider, noteMailError,
  };
}
