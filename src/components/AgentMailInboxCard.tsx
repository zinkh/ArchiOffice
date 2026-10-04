// Réglage du courrier entrant (voir server/agentMailInbox.ts) — un cabinet
// désigne UN agent de triage, qui traite tout email transféré à l'alias
// affiché ci-dessous. Même principe que TelegramConnectionsCard/
// McpConnectionsCard : action immédiate (choisir l'agent), pas de formulaire
// via saveSection/renderSaveButton.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconMailForward, IconCopy, IconCheck, IconLoader2 } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

interface Agent { id: string; name: string; is_active: boolean }

export function AgentMailInboxCard() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [triageAgentId, setTriageAgentId] = useState('');
  const [alias, setAlias] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [agentList, settings] = await Promise.all([
          apiFetch<Agent[]>('/api/agents'),
          apiFetch<{ mailTriageAgentId?: string | null; mailInboxAlias?: string | null }>('/api/settings'),
        ]);
        setAgents(agentList.filter(a => a.is_active));
        setTriageAgentId(settings.mailTriageAgentId || '');
        setAlias(settings.mailInboxAlias || null);
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

  const copyAlias = async () => {
    if (!alias) return;
    try {
      await navigator.clipboard.writeText(alias);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* presse-papiers indisponible — le champ reste sélectionnable à la main */ }
  };

  // Domaine de réception non configuré côté serveur : rien à afficher, la
  // fonctionnalité n'est simplement pas active sur cette instance.
  if (!loading && !alias) return null;

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('agent_mail_inbox_title')}</h2>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('agent_mail_inbox_explanation')}</p>

      {error && <p className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-4" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 size={16} className="animate-spin" /></div>
      ) : (
        <>
          {alias && (
            <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: 'var(--tblr-bg-surface-secondary)' }}>
              <IconMailForward size={16} className="shrink-0" style={{ color: 'var(--tblr-muted)' }} />
              <code className="flex-1 text-sm font-mono select-all truncate">{alias}</code>
              <button onClick={copyAlias} title={t('agent_mail_inbox_copy') as string} className="p-1.5 rounded-lg shrink-0" style={{ color: 'var(--tblr-muted)' }}>
                {copied ? <IconCheck size={15} style={{ color: 'var(--tblr-success)' }} /> : <IconCopy size={15} />}
              </button>
            </div>
          )}

          {agents.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('agent_mail_inbox_no_agent')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm" style={{ color: 'var(--tblr-text)' }}>{t('agent_mail_inbox_triage_label')}</label>
              <select
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
