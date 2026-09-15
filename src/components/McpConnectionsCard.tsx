// Réglage personnel des liaisons MCP (Gemini "Connected Apps → Custom apps
// for Spark", voir packages/archioffice-agents/src/server/mcp/*.ts). Une
// personne peut n'avoir qu'une liaison active à la fois en pratique (un seul
// compte Gemini personnel), mais rien ne l'interdit techniquement — la carte
// liste donc toutes les liaisons actives plutôt que d'en supposer une seule,
// même principe que MailAccountsCard pour les boîtes mail.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlugConnected, IconTrash, IconLoader2 } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

interface McpConnection {
  id: string;
  created_at: string;
  last_used_at: string | null;
  scope: string;
}

export function McpConnectionsCard() {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setConnections(await apiFetch<McpConnection[]>('/api/mcp/connections'));
    } catch (e: any) {
      setError(e.message || t('mcp_connections_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const revoke = async (id: string) => {
    setRevokingId(id);
    try {
      await apiFetch(`/api/mcp/connections/${id}`, { method: 'DELETE' });
      setConnections(prev => prev.filter(c => c.id !== id));
    } catch (e: any) {
      setError(e.message || t('mcp_connections_error'));
    } finally {
      setRevokingId(null);
      setConfirmId(null);
    }
  };

  const formatDate = (iso: string | null) => iso ? new Date(iso).toLocaleString() : t('mcp_connections_never_used');

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('mcp_connections_title')}</h2>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('mcp_connections_explanation')}</p>
      <code className="block text-xs rounded-lg px-2.5 py-1.5 select-all" style={{ background: 'var(--tblr-bg-surface-secondary)', color: 'var(--tblr-text)' }}>
        {typeof window !== 'undefined' ? `${window.location.origin}/mcp` : '/mcp'}
      </code>

      {error && <p className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-4" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 size={16} className="animate-spin" /></div>
      ) : connections.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('mcp_connections_empty')}</p>
      ) : (
        <div className="space-y-2">
          {connections.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
              <div className="flex items-center gap-2 min-w-0">
                <IconPlugConnected size={16} className="shrink-0" style={{ color: 'var(--tblr-muted)' }} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--tblr-text)' }}>Gemini</div>
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
    </div>
  );
}
