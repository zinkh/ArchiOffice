// Remplace useMailConnections.ts (Gmail/Outlook/IMAP, un état par
// fournisseur) depuis le support multi-comptes : un utilisateur peut avoir
// plusieurs adresses du même fournisseur (cabinet + personnelle, par ex.),
// donc l'état est une LISTE de comptes plutôt que trois statuts fixes.
// GET /api/mail/accounts (server/routes/mailAccounts.ts) remplace les trois
// anciennes routes /status.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';

export type MailProvider = 'google' | 'microsoft' | 'infomaniak';

export interface MailAccount {
  id: string;
  provider: MailProvider;
  authType: 'oauth' | 'imap';
  email: string | null;
  displayName: string | null;
  isDefault: boolean;
  hasSmtp: boolean;
  lastSyncedAt: string | null;
}

export interface ImapConnectForm {
  host: string;
  port: string;
  username: string;
  password: string;
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  smtpPassword: string;
}

const EMPTY_IMAP_FORM: ImapConnectForm = {
  host: 'mail.infomaniak.com', port: '993', username: '', password: '',
  smtpHost: 'mail.infomaniak.com', smtpPort: '465', smtpUsername: '', smtpPassword: '',
};

export function useMailAccounts() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImapForm, setShowImapForm] = useState(false);
  const [imapForm, setImapForm] = useState<ImapConnectForm>(EMPTY_IMAP_FORM);
  const [imapConnecting, setImapConnecting] = useState(false);
  // Set when a mailbox action fails with INSUFFICIENT_SCOPE (the stored
  // token predates a scope this call needs) — consumers show a "reconnect"
  // banner for this account instead of a generic error. IMAP has no OAuth
  // scope to widen, so it never lands here.
  const [insufficientScopeAccountId, setInsufficientScopeAccountId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await apiFetch<MailAccount[]>('/api/mail/accounts'));
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Handles the redirect back from Gmail's/Outlook's OAuth consent screen —
  // the callback (server/routes/gmailSync.ts, server/routes/outlookSync.ts)
  // sends the browser back to the page it started from, with one of these
  // query params.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('gmail_connected') || params.has('outlook_connected')) {
      load();
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

  const connectOutlook = async () => {
    try {
      const returnTo = window.location.pathname + window.location.search;
      const { url } = await apiFetch<{ url: string }>(`/api/outlook/auth?returnTo=${encodeURIComponent(returnTo)}`);
      window.location.href = url;
    } catch (err: any) {
      setError(err?.message || null);
    }
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
      setImapForm(f => ({ ...f, password: '', smtpPassword: '' }));
      await load();
    } catch (err: any) {
      setError(err?.message || t('correspondence_connect_imap_error') as string);
    } finally {
      setImapConnecting(false);
    }
  };

  const disconnect = async (accountId: string) => {
    await apiFetch(`/api/mail/accounts/${accountId}`, { method: 'DELETE' });
    await load();
  };

  const setDefault = async (accountId: string) => {
    await apiFetch(`/api/mail/accounts/${accountId}/default`, { method: 'POST' });
    await load();
  };

  const rename = async (accountId: string, displayName: string) => {
    await apiFetch(`/api/mail/accounts/${accountId}`, { method: 'PUT', body: JSON.stringify({ displayName }) });
    await load();
  };

  const setImapSmtp = async (accountId: string, smtp: { smtpHost: string; smtpPort: string; smtpUsername: string; smtpPassword: string }) => {
    await apiFetch(`/api/mail/accounts/${accountId}`, { method: 'PUT', body: JSON.stringify(smtp) });
    await load();
  };

  // Callers wrap a mailbox action (archive/delete/send) in a try/catch and
  // pass the caught error here instead of duplicating the
  // err.code === 'INSUFFICIENT_SCOPE' check at every call site.
  const noteMailError = useCallback((accountId: string, err: any) => {
    if (err?.code === 'INSUFFICIENT_SCOPE') {
      setInsufficientScopeAccountId(accountId);
    } else {
      setError(err?.message || null);
    }
  }, []);

  const defaultAccount = accounts.find(a => a.isDefault) || accounts[0] || null;

  // Reconnexion pour un compte précis, à partir de son fournisseur — utilisé
  // par la bannière INSUFFICIENT_SCOPE, qui ne connaît que l'id du compte en
  // échec, pas son provider.
  const reconnectAccount = (accountId: string) => {
    const account = accounts.find(a => a.id === accountId);
    if (account?.provider === 'google') connectGmail();
    else if (account?.provider === 'microsoft') connectOutlook();
  };

  return {
    accounts, defaultAccount, loading, error, setError,
    showImapForm, setShowImapForm, imapForm, setImapForm, imapConnecting,
    connectGmail, connectOutlook, connectImap, disconnect, setDefault, rename, setImapSmtp,
    anyConnected: accounts.length > 0,
    insufficientScopeAccountId, setInsufficientScopeAccountId, noteMailError, reconnectAccount,
    reload: load,
  };
}
