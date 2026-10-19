// Réglage du courrier entrant (voir server/agentMailInbox.ts) — un cabinet
// désigne UN agent de triage, qui traite tout email transféré à l'alias
// affiché ci-dessous. Le domaine de l'alias est propre au cabinet
// (settings.mail_inbox_domain) ; celui de l'instance ne sert que de repli.
// Même principe que TelegramConnectionsCard/McpConnectionsCard : action
// immédiate (choisir l'agent, enregistrer le domaine), pas de formulaire via
// saveSection/renderSaveButton.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconMailForward, IconCopy, IconCheck, IconLoader2 } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

interface Agent { id: string; name: string; is_active: boolean }

interface InboxSettings {
  mailTriageAgentId?: string | null;
  mailInboxAlias?: string | null;
  mailInboxDomain?: string | null;
  mailInboxAvailable?: boolean;
}

export function AgentMailInboxCard() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [triageAgentId, setTriageAgentId] = useState('');
  const [alias, setAlias] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [savedDomain, setSavedDomain] = useState('');
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDomain, setSavingDomain] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applySettings = (settings: InboxSettings) => {
    setTriageAgentId(settings.mailTriageAgentId || '');
    setAlias(settings.mailInboxAlias || null);
    setDomain(settings.mailInboxDomain || '');
    setSavedDomain(settings.mailInboxDomain || '');
    setAvailable(settings.mailInboxAvailable !== false);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [agentList, settings] = await Promise.all([
          apiFetch<Agent[]>('/api/agents'),
          apiFetch<InboxSettings>('/api/settings'),
        ]);
        setAgents(agentList.filter(a => a.is_active));
        applySettings(settings);
      } catch (e: any) {
        setError(e.message || t('agent_mail_inbox_error'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async (agentId: string) => {
    setTriageAgentId(agentId);
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ mailTriageAgentId: agentId || null }) });
    } catch (e: any) {
      setError(e.message || t('agent_mail_inbox_error'));
    } finally {
      setSaving(false);
    }
  };

  // Le serveur normalise et valide le domaine ; on relit les réglages ensuite
  // pour afficher l'alias et la valeur réellement enregistrés.
  const saveDomain = async () => {
    setSavingDomain(true);
    setError(null);
    try {
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ mailInboxDomain: domain.trim() }) });
      applySettings(await apiFetch<InboxSettings>('/api/settings'));
    } catch (e: any) {
      setError(e.message || t('agent_mail_inbox_domain_invalid'));
    } finally {
      setSavingDomain(false);
    }
  };

  const copyAlias = async () => {
    if (!alias) return;
    try {
      await navigator.clipboard.writeText(alias);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* presse-papiers indisponible — le champ reste sélectionnable à la main */ }
  };

  const domainChanged = domain.trim() !== savedDomain;

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('agent_mail_inbox_title')}</h2>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('agent_mail_inbox_explanation')}</p>

      {error && <p className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-4" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 size={16} className="animate-spin" /></div>
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="mail-inbox-domain" className="text-sm" style={{ color: 'var(--tblr-text)' }}>{t('agent_mail_inbox_domain_label')}</label>
              <input
                id="mail-inbox-domain"
                type="text"
                value={domain}
                onChange={e => setDomain(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && domainChanged && !savingDomain) saveDomain(); }}
                placeholder={t('agent_mail_inbox_domain_placeholder') as string}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="text-sm rounded-lg px-2.5 py-1.5 min-w-0 flex-1 sm:flex-none sm:w-64"
                style={{ background: 'var(--tblr-bg-surface-secondary)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
              />
              <button
                type="button"
                onClick={saveDomain}
                disabled={!domainChanged || savingDomain}
                className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
              >
                {savingDomain ? <IconLoader2 size={13} className="animate-spin" /> : t('agent_mail_inbox_domain_save')}
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('agent_mail_inbox_domain_help')}</p>
          </div>

          {alias ? (
            <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: 'var(--tblr-bg-surface-secondary)' }}>
              <IconMailForward size={16} className="shrink-0" style={{ color: 'var(--tblr-muted)' }} />
              <code className="flex-1 text-sm font-mono select-all truncate">{alias}</code>
              <button onClick={copyAlias} aria-label={t('agent_mail_inbox_copy') as string} title={t('agent_mail_inbox_copy') as string} className="p-1.5 rounded-lg shrink-0" style={{ color: 'var(--tblr-muted)' }}>
                {copied ? <IconCheck size={15} style={{ color: 'var(--tblr-success)' }} /> : <IconCopy size={15} />}
              </button>
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('agent_mail_inbox_no_alias')}</p>
          )}

          {!available && <p className="text-xs" style={{ color: 'var(--tblr-warning)' }}>{t('agent_mail_inbox_unavailable')}</p>}

          {agents.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('agent_mail_inbox_no_agent')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="mail-inbox-triage" className="text-sm" style={{ color: 'var(--tblr-text)' }}>{t('agent_mail_inbox_triage_label')}</label>
              <select
                id="mail-inbox-triage"
                value={triageAgentId}
                onChange={e => save(e.target.value)}
                disabled={saving}
                className="text-sm rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--tblr-bg-surface-secondary)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
              >
                <option value="">{t('agent_mail_inbox_triage_none')}</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {saving && <IconLoader2 size={14} className="animate-spin" style={{ color: 'var(--tblr-muted)' }} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
