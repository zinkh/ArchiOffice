// Shared Gmail/IMAP connection state — used by both CorrespondenceTab
// (per-record search + attach) and the Mailbox page (full inbox listing),
// so the OAuth/IMAP connect-disconnect wiring isn't duplicated between them.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';

export interface MailStatus {
  connected: boolean;
  email: string | null;
  last_synced_at?: string | null;
}

export function useMailConnections() {
  const { t } = useTranslation();
  const [gmailStatus, setGmailStatus] = useState<MailStatus>({ connected: false, email: null });
  const [imapStatus, setImapStatus] = useState<MailStatus>({ connected: false, email: null });
  const [error, setError] = useState<string | null>(null);
  const [showImapForm, setShowImapForm] = useState(false);
  const [imapForm, setImapForm] = useState({ host: 'mail.infomaniak.com', port: '993', username: '', password: '' });
  const [imapConnecting, setImapConnecting] = useState(false);

  const loadStatuses = useCallback(async () => {
    const [gmail, imap] = await Promise.all([
      apiFetch<MailStatus>('/api/gmail/status').catch(() => ({ connected: false, email: null })),
      apiFetch<MailStatus>('/api/mail/imap/status').catch(() => ({ connected: false, email: null })),
    ]);
    setGmailStatus(gmail);
    setImapStatus(imap);
  }, []);

  useEffect(() => { loadStatuses(); }, [loadStatuses]);

  // Handles the redirect back from Gmail's OAuth consent screen — the
  // callback (server/routes/gmailSync.ts) sends the browser back to the
  // page it started from, with one of these query params.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('gmail_connected')) {
      loadStatuses();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.has('gmail_error')) {
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

  const connectImap = async (e: React.FormEvent) => {
    e.preventDefault();
    setImapConnecting(true);
    setError(null);
    try {
      await apiFetch('/api/mail/imap/connect', { method: 'POST', body: JSON.stringify(imapForm) });
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

  return {
    gmailStatus, imapStatus, error, setError,
    showImapForm, setShowImapForm, imapForm, setImapForm, imapConnecting,
    connectGmail, disconnectGmail, connectImap, disconnectImap,
    anyConnected: gmailStatus.connected || imapStatus.connected,
  };
}
