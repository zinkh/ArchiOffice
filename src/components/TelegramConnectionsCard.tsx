// Réglage personnel de la liaison Telegram (voir server/telegramBot.ts) —
// même principe que McpConnectionsCard, mais la liaison se fait par un code
// à coller dans Telegram plutôt que par redirection OAuth : Telegram n'a
// aucune notion de session utilisateur navigateur.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBrandTelegram, IconTrash, IconLoader2 } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

interface Agent { id: string; name: string; is_active: boolean }
interface TelegramConnection {
  id: string;
  agent_id: string;
  created_at: string;
  last_used_at: string | null;
}

export function TelegramConnectionsCard() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [connections, setConnections] = useState<TelegramConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [linkCode, setLinkCode] = useState<{ code: string; botUsername: string | null } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentList, conns] = await Promise.all([
        apiFetch<Agent[]>('/api/agents'),
        apiFetch<TelegramConnection[]>('/api/telegram/connections'),
      ]);
      const active = agentList.filter(a => a.is_active);
      setAgents(active);
      setSelectedAgentId(prev => prev || active[0]?.id || '');
      setConnections(conns);
    } catch (e: any) {
      setError(e.message || t('telegram_connections_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const generateCode = async () => {
    if (!selectedAgentId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await apiFetch<{ code: string; bot_username: string | null }>('/api/telegram/link-code', {
        method: 'POST',
        body: JSON.stringify({ agent_id: selectedAgentId }),
      });
      setLinkCode({ code: res.code, botUsername: res.bot_username });
    } catch (e: any) {
      setError(e.message || t('telegram_connections_error'));
    } finally {
      setGenerating(false);
    }
  };

  const revoke = async (id: string) => {
    setRevokingId(id);
    try {
      await apiFetch(`/api/telegram/connections/${id}`, { method: 'DELETE' });
      setConnections(prev => prev.filter(c => c.id !== id));
    } catch (e: any) {
      setError(e.message || t('telegram_connections_error'));
    } finally {
      setRevokingId(null);
      setConfirmId(null);
    }
  };

  const agentName = (id: string) => agents.find(a => a.id === id)?.name || id;
  const formatDate = (iso: string | null) => iso ? new Date(iso).toLocaleString() : t('mcp_connections_never_used');

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('telegram_connections_title')}</h2>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('telegram_connections_explanation')}</p>

      {error && <p className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-4" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 size={16} className="animate-spin" /></div>
      ) : (
        <>
          {agents.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('telegram_connections_no_agent')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedAgentId}
                onChange={e => setSelectedAgentId(e.target.value)}
                className="text-sm rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--tblr-bg-surface-secondary)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
              >
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button
                onClick={generateCode}
                disabled={generating}
                className="text-sm px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                style={{ background: 'var(--tblr-primary)', color: 'white' }}
              >
                {generating ? <IconLoader2 size={14} className="animate-spin" /> : t('telegram_connections_generate')}
              </button>
            </div>
          )}

          {linkCode && (
            <div className="rounded-lg p-3 space-y-1.5" style={{ background: 'var(--tblr-bg-surface-secondary)' }}>
              <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                {linkCode.botUsername
                  ? t('telegram_connections_instructions_named', { bot: linkCode.botUsername })
                  : t('telegram_connections_instructions_generic')}
              </p>
              <code className="block text-sm font-mono select-all">/start {linkCode.code}</code>
            </div>
          )}

          {connections.length > 0 && (
            <div className="space-y-2">
              {connections.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <IconBrandTelegram size={16} className="shrink-0" style={{ color: 'var(--tblr-muted)' }} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{agentName(c.agent_id)}</div>
                      <div className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>
                        {t('mcp_connections_last_used')} {formatDate(c.last_used_at)}
                      </div>
                    </div>
                  </div>
                  {confirmId === c.id ? (
                    <div className="flex items-center gap-1 text-xs shrink-0">
                      <button
                        onClick={() => revoke(c.id)}
                        disabled={revokingId === c.id}
                        className="px-2 py-1 rounded-lg font-medium"
                        style={{ background: 'var(--tblr-danger)', color: 'white' }}
                      >
                        {revokingId === c.id ? <IconLoader2 size={13} className="animate-spin" /> : t('mcp_connections_revoke_confirm')}
                      </button>
                      <button onClick={() => setConfirmId(null)} style={{ color: 'var(--tblr-muted)' }}>{t('btn_close') as string}</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(c.id)}
                      title={t('mcp_connections_revoke') as string}
                      className="p-1.5 rounded-lg shrink-0"
                      style={{ color: 'var(--tblr-muted)' }}
                    >
                      <IconTrash size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
