// Compatibilité n8n / IFTTT — deux briques indépendantes (voir CLAUDE.md,
// « Automatisation ») :
// 1. Une clé d'API (auto_at_...) qu'un nœud HTTP Request n8n utilise pour
//    appeler l'API REST d'ArchiOffice avec les droits de la personne qui
//    l'a émise.
// 2. Des webhooks sortants, filtrés par type d'évènement, que le nœud
//    Webhook Trigger de n8n ou le service Webhooks/Maker d'IFTTT reçoivent.
// Même principe que McpConnectionsCard/TelegramConnectionsCard : actions
// immédiates (émettre, révoquer, tester), pas un formulaire à valider via
// saveSection/renderSaveButton.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconKey, IconWebhook, IconCopy, IconCheck, IconLoader2, IconTrash, IconPlus, IconSend, IconChevronDown } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

interface ApiKey { id: string; name: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
interface WebhookEventType { code: string; category: string; label: string }
interface Webhook {
  id: string; name: string; targetUrl: string; eventTypes: string[]; enabled: boolean;
  createdAt: string; lastTriggeredAt: string | null; lastStatus: string | null;
}
interface Delivery {
  id: string; event_type: string; status: string; http_status: number | null;
  last_error: string | null; attempt_count: number; delivered_at: string | null; created_at: string;
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg p-2" style={{ background: 'var(--tblr-bg-surface-secondary)' }}>
      <code className="flex-1 text-xs font-mono select-all break-all">{value}</code>
      <button
        type="button"
        onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* presse-papiers indisponible */ } }}
        className="p-1.5 rounded-lg shrink-0"
        style={{ color: 'var(--tblr-muted)' }}
      >
        {copied ? <IconCheck size={14} style={{ color: 'var(--tblr-success)' }} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}

export function AutomationIntegrationsCard() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [issuedKey, setIssuedKey] = useState<{ name: string; key: string } | null>(null);
  const [issuingKey, setIssuingKey] = useState(false);

  const [eventTypes, setEventTypes] = useState<WebhookEventType[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [newWebhook, setNewWebhook] = useState({ name: '', targetUrl: '', eventTypes: [] as string[] });
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [expandedWebhook, setExpandedWebhook] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [keysData, eventTypesData, webhooksData] = await Promise.all([
        apiFetch<ApiKey[]>('/api/automation/api-keys'),
        apiFetch<WebhookEventType[]>('/api/webhooks/event-types'),
        apiFetch<Webhook[]>('/api/webhooks'),
      ]);
      setKeys(keysData);
      setEventTypes(eventTypesData);
      setWebhooks(webhooksData);
    } catch (e: any) {
      setError(e.message || t('automation_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const issueKey = async () => {
    const name = newKeyName.trim();
    if (!name) return;
    setIssuingKey(true);
    setError(null);
    try {
      const result = await apiFetch<{ id: string; key: string; name: string }>('/api/automation/api-keys', { method: 'POST', body: JSON.stringify({ name }) });
      setIssuedKey({ name: result.name, key: result.key });
      setNewKeyName('');
      await load();
    } catch (e: any) {
      setError(e.message || t('automation_error'));
    } finally {
      setIssuingKey(false);
    }
  };

  const revokeKey = async (id: string) => {
    try {
      await apiFetch(`/api/automation/api-keys/${id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e.message || t('automation_error'));
    }
  };

  const createWebhook = async () => {
    if (!newWebhook.name.trim() || !newWebhook.targetUrl.trim() || !newWebhook.eventTypes.length) return;
    setCreatingWebhook(true);
    setError(null);
    try {
      const result = await apiFetch<Webhook & { secret: string }>('/api/webhooks', {
        method: 'POST',
        body: JSON.stringify({ name: newWebhook.name.trim(), targetUrl: newWebhook.targetUrl.trim(), eventTypes: newWebhook.eventTypes }),
      });
      setIssuedSecret(result.secret);
      setNewWebhook({ name: '', targetUrl: '', eventTypes: [] });
      await load();
    } catch (e: any) {
      setError(e.message || t('automation_error'));
    } finally {
      setCreatingWebhook(false);
    }
  };

  const toggleWebhookEnabled = async (hook: Webhook) => {
    try {
      await apiFetch(`/api/webhooks/${hook.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !hook.enabled }) });
      await load();
    } catch (e: any) {
      setError(e.message || t('automation_error'));
    }
  };

  const deleteWebhook = async (id: string) => {
    try {
      await apiFetch(`/api/webhooks/${id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e.message || t('automation_error'));
    }
  };

  const testWebhook = async (id: string) => {
    try {
      await apiFetch(`/api/webhooks/${id}/test`, { method: 'POST' });
      await loadDeliveries(id);
    } catch (e: any) {
      setError(e.message || t('automation_error'));
    }
  };

  const loadDeliveries = async (id: string) => {
    try {
      const data = await apiFetch<Delivery[]>(`/api/webhooks/${id}/deliveries`);
      setDeliveries(prev => ({ ...prev, [id]: data }));
    } catch { /* le journal reste vide en cas d'échec, non bloquant */ }
  };

  const toggleExpand = (id: string) => {
    if (expandedWebhook === id) { setExpandedWebhook(null); return; }
    setExpandedWebhook(id);
    if (!deliveries[id]) loadDeliveries(id);
  };

  return (
    <div className="rounded-xl p-5 space-y-5" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('automation_title')}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('automation_explanation')}</p>
      </div>

      {error && <p className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-4" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 size={16} className="animate-spin" /></div>
      ) : (
        <>
          {/* ── Clés d'API (entrant) ─────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <IconKey size={15} style={{ color: 'var(--tblr-muted)' }} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('automation_keys_title')}</h3>
            </div>

            {keys.length > 0 && (
              <div className="space-y-1.5">
                {keys.map(k => (
                  <div key={k.id} className="flex items-center justify-between gap-2 text-sm rounded-lg px-3 py-2" style={{ background: 'var(--tblr-bg-surface-secondary)' }}>
                    <div className="min-w-0">
                      <span className="font-medium" style={{ color: 'var(--tblr-text)' }}>{k.name}</span>
                      <span className="ml-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                        {k.revokedAt ? t('automation_keys_revoked') : k.lastUsedAt ? t('automation_keys_used_on', { date: new Date(k.lastUsedAt).toLocaleDateString('fr-FR') }) : t('automation_keys_never_used')}
                      </span>
                    </div>
                    {!k.revokedAt && (
                      <button type="button" onClick={() => revokeKey(k.id)} className="p-1 rounded shrink-0" style={{ color: 'var(--tblr-danger)' }} title={t('automation_keys_revoke') as string}>
                        <IconTrash size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {issuedKey && (
              <div className="space-y-1.5">
                <p className="text-xs" style={{ color: 'var(--tblr-warning)' }}>{t('automation_keys_issued_warning', { name: issuedKey.name })}</p>
                <CopyField value={issuedKey.key} />
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                placeholder={t('automation_keys_name_placeholder') as string}
                className="flex-1 text-sm rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--tblr-bg-surface-secondary)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
              />
              <button
                type="button"
                onClick={issueKey}
                disabled={issuingKey || !newKeyName.trim()}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-50"
                style={{ background: 'var(--tblr-primary)', color: '#fff' }}
              >
                {issuingKey ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlus size={14} />}
                {t('automation_keys_create')}
              </button>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--tblr-border)' }} />

          {/* ── Webhooks sortants ────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <IconWebhook size={15} style={{ color: 'var(--tblr-muted)' }} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('automation_webhooks_title')}</h3>
            </div>

            {webhooks.length > 0 && (
              <div className="space-y-1.5">
                {webhooks.map(hook => (
                  <div key={hook.id} className="rounded-lg" style={{ background: 'var(--tblr-bg-surface-secondary)' }}>
                    <div className="flex items-center justify-between gap-2 text-sm px-3 py-2">
                      <button type="button" onClick={() => toggleExpand(hook.id)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                        <IconChevronDown size={13} className="shrink-0" style={{ color: 'var(--tblr-muted)', transform: expandedWebhook === hook.id ? 'rotate(180deg)' : undefined }} />
                        <span className="font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{hook.name}</span>
                        <span className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{hook.targetUrl}</span>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        {hook.lastStatus && (
                          <span className="text-[0.6875rem] px-1.5 py-0.5 rounded-full" style={hook.lastStatus === 'success' ? { background: 'var(--tblr-success-lt)', color: 'var(--tblr-success)' } : { background: 'var(--tblr-danger-lt)', color: 'var(--tblr-danger)' }}>
                            {hook.lastStatus === 'success' ? t('automation_webhooks_status_ok') : t('automation_webhooks_status_error')}
                          </span>
                        )}
                        <input type="checkbox" checked={hook.enabled} onChange={() => toggleWebhookEnabled(hook)} title={(hook.enabled ? t('automation_webhooks_active') : t('automation_webhooks_suspended')) as string} />
                        <button type="button" onClick={() => testWebhook(hook.id)} className="p-1 rounded" style={{ color: 'var(--tblr-muted)' }} title={t('automation_webhooks_test') as string}>
                          <IconSend size={14} />
                        </button>
                        <button type="button" onClick={() => deleteWebhook(hook.id)} className="p-1 rounded" style={{ color: 'var(--tblr-danger)' }} title={t('automation_webhooks_delete') as string}>
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </div>

                    {expandedWebhook === hook.id && (
                      <div className="px-3 pb-3 space-y-2 text-xs">
                        <div className="flex flex-wrap gap-1">
                          {hook.eventTypes.map(code => (
                            <span key={code} className="px-1.5 py-0.5 rounded-full" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
                              {eventTypes.find(e => e.code === code)?.label || code}
                            </span>
                          ))}
                        </div>
                        {(deliveries[hook.id] || []).length > 0 && (
                          <div className="space-y-1">
                            <p className="font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('automation_webhooks_deliveries_title')}</p>
                            {(deliveries[hook.id] || []).map(d => (
                              <div key={d.id} className="flex items-center justify-between gap-2 rounded px-2 py-1" style={{ background: 'var(--tblr-surface)' }}>
                                <span style={{ color: 'var(--tblr-text)' }}>{d.event_type}</span>
                                <span style={{ color: d.status === 'success' ? 'var(--tblr-success)' : 'var(--tblr-danger)' }}>
                                  {d.status === 'success' ? `${t('automation_webhooks_status_ok')} (${d.http_status ?? ''})` : d.last_error || t('automation_webhooks_status_error')}
                                </span>
                                <span style={{ color: 'var(--tblr-muted)' }}>{new Date(d.created_at).toLocaleString('fr-FR')}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {issuedSecret && (
              <div className="space-y-1.5">
                <p className="text-xs" style={{ color: 'var(--tblr-warning)' }}>{t('automation_webhooks_secret_warning')}</p>
                <CopyField value={issuedSecret} />
              </div>
            )}

            <div className="space-y-2 rounded-lg p-3" style={{ background: 'var(--tblr-bg-surface-secondary)' }}>
              <input
                type="text"
                value={newWebhook.name}
                onChange={e => setNewWebhook(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('automation_webhooks_name_placeholder') as string}
                className="w-full text-sm rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
              />
              <input
                type="url"
                value={newWebhook.targetUrl}
                onChange={e => setNewWebhook(prev => ({ ...prev, targetUrl: e.target.value }))}
                placeholder={t('automation_webhooks_url_placeholder') as string}
                className="w-full text-sm rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
              />
              <div className="flex flex-wrap gap-1.5">
                {eventTypes.map(ev => {
                  const checked = newWebhook.eventTypes.includes(ev.code);
                  return (
                    <button
                      key={ev.code}
                      type="button"
                      onClick={() => setNewWebhook(prev => ({
                        ...prev,
                        eventTypes: checked ? prev.eventTypes.filter(c => c !== ev.code) : [...prev.eventTypes, ev.code],
                      }))}
                      className="text-xs px-2 py-1 rounded-full"
                      style={checked
                        ? { background: 'var(--tblr-primary)', color: '#fff' }
                        : { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
                    >
                      {ev.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={createWebhook}
                disabled={creatingWebhook || !newWebhook.name.trim() || !newWebhook.targetUrl.trim() || !newWebhook.eventTypes.length}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
                style={{ background: 'var(--tblr-primary)', color: '#fff' }}
              >
                {creatingWebhook ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlus size={14} />}
                {t('automation_webhooks_add')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
