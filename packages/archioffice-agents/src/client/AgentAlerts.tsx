import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconArrowLeft, IconBell, IconRefresh, IconCheck, IconX, IconClock,
  IconPlayerPlay, IconTrash, IconPlus, IconAlertTriangle,
} from '@tabler/icons-react';
import { apiFetch } from '@/src/lib/api';
import type { Agent } from '../types.js';

interface AlertRow {
  id: string;
  rule_code: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved';
  detected_at: string;
  target_type: string | null;
  target_id: string | null;
}

interface RuleRow {
  code: string;
  label: string;
  description: string;
  enabled: boolean;
  threshold_days: number | null;
  default_threshold_days: number | null;
  severity: 'info' | 'warning' | 'critical';
  notify_email: boolean;
}

interface ScheduleRow {
  id: string;
  agent_id: string;
  name: string;
  prompt: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  hour_utc: number;
  weekday: number | null;
  day_of_month: number | null;
  enabled: boolean;
  notify_email: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

interface RunRow {
  id: string;
  status: 'ok' | 'error' | 'skipped';
  reply: string | null;
  error: string | null;
  started_at: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: '#5c7cfa',
  warning: '#f59f00',
  critical: '#c92a2a',
};

const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

const cardStyle = { background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' };
const inputCls = 'w-full px-3 py-2 rounded-lg border text-[13px] outline-none';
const inputStyle = { background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' };

function emptySchedule(agentId: string): Omit<ScheduleRow, 'id' | 'last_run_at' | 'next_run_at'> {
  return {
    agent_id: agentId, name: '', prompt: '',
    frequency: 'weekly', hour_utc: 6, weekday: 1, day_of_month: 1,
    enabled: true, notify_email: false,
  };
}

export default function AgentAlerts() {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<Record<string, RunRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof emptySchedule> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [a, r, s, ag] = await Promise.all([
      apiFetch('/api/agent-alerts?status=open').catch(() => []),
      apiFetch('/api/agent-alert-rules').catch(() => []),
      apiFetch('/api/agent-schedules').catch(() => []),
      apiFetch('/api/agents').catch(() => []),
    ]);
    setAlerts(a as AlertRow[]);
    setRules(r as RuleRow[]);
    setSchedules(s as ScheduleRow[]);
    setAgents((ag as Agent[]).filter(x => x.is_active));
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const refreshAnalysis = async () => {
    setRefreshing(true);
    try {
      await apiFetch('/api/agent-alerts/refresh', { method: 'POST' });
      await load();
    } catch (e: any) {
      setError(e?.message || "L'analyse n'a pas pu être relancée.");
    }
    setRefreshing(false);
  };

  const setAlertStatus = async (id: string, status: 'acknowledged' | 'resolved') => {
    await apiFetch(`/api/agent-alerts/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    // Une alerte prise en compte reste affichée (elle est toujours ouverte
    // au sens métier) ; une alerte clôturée disparaît de cette liste.
    setAlerts(prev => status === 'resolved' ? prev.filter(a => a.id !== id) : prev.map(a => (a.id === id ? { ...a, status } : a)));
  };

  const saveRule = async (rule: RuleRow, patch: Partial<RuleRow>) => {
    const next = { ...rule, ...patch };
    setRules(prev => prev.map(r => (r.code === rule.code ? next : r)));
    await apiFetch(`/api/agent-alert-rules/${rule.code}`, {
      method: 'PUT',
      body: JSON.stringify({
        enabled: next.enabled,
        threshold_days: next.threshold_days,
        severity: next.severity,
        notify_email: next.notify_email,
      }),
    }).catch((e: any) => setError(e?.message || 'Enregistrement impossible.'));
  };

  const saveSchedule = async () => {
    if (!draft) return;
    setError('');
    try {
      if (editingId) {
        await apiFetch(`/api/agent-schedules/${editingId}`, { method: 'PUT', body: JSON.stringify(draft) });
      } else {
        await apiFetch('/api/agent-schedules', { method: 'POST', body: JSON.stringify(draft) });
      }
      setDraft(null);
      setEditingId(null);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Enregistrement impossible.');
    }
  };

  const deleteSchedule = async (id: string) => {
    if (!confirm('Supprimer cette tâche planifiée ?')) return;
    await apiFetch(`/api/agent-schedules/${id}`, { method: 'DELETE' });
    await load();
  };

  const runNow = async (id: string) => {
    setError('');
    try {
      await apiFetch(`/api/agent-schedules/${id}/run`, { method: 'POST' });
      const history = await apiFetch(`/api/agent-schedules/${id}/runs`);
      setRuns(prev => ({ ...prev, [id]: history as RunRow[] }));
      await load();
    } catch (e: any) {
      setError(e?.message || "L'exécution a échoué.");
    }
  };

  const toggleRuns = async (id: string) => {
    if (runs[id]) { setRuns(prev => { const next = { ...prev }; delete next[id]; return next; }); return; }
    const history = await apiFetch(`/api/agent-schedules/${id}/runs`).catch(() => []);
    setRuns(prev => ({ ...prev, [id]: history as RunRow[] }));
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/agents" className="p-2 rounded-lg border" style={cardStyle} aria-label="Retour">
          <IconArrowLeft size={16} style={{ color: 'var(--tblr-text)' }} />
        </Link>
        <div className="flex-1">
          <h1 className="font-semibold text-[18px] flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
            <IconBell size={18} /> {t('agent_alerts_title')}
          </h1>
          <p className="text-[12px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_alerts_subtitle')}</p>
        </div>
        <button
          onClick={refreshAnalysis}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[13px]"
          style={{ ...cardStyle, color: 'var(--tblr-text)', opacity: refreshing ? 0.6 : 1 }}
        >
          <IconRefresh size={15} className={refreshing ? 'animate-spin' : ''} /> {t('agent_alerts_refresh')}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg text-[12px]" style={{ background: 'rgba(201,42,42,0.06)', border: '1px solid #ffc9c9', color: '#c92a2a' }}>
          <IconAlertTriangle size={16} style={{ flexShrink: 0 }} /> {error}
        </div>
      )}

      {/* Alertes ouvertes */}
      <section className="p-5 rounded-xl border space-y-3" style={cardStyle}>
        <h2 className="font-semibold text-[14px]" style={{ color: 'var(--tblr-text)' }}>
          {t('agent_alerts_open')} ({alerts.length})
        </h2>
        {alerts.length === 0 && <p className="text-[13px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_alerts_none')}</p>}
        <div className="space-y-2">
          {alerts.map(alert => (
            <div key={alert.id} className="p-3 rounded-lg border" style={{ ...cardStyle, borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity]}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium" style={{ color: 'var(--tblr-text)' }}>{alert.title}</div>
                  <p className="text-[12px] mt-1" style={{ color: 'var(--tblr-muted)' }}>{alert.message}</p>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--tblr-muted)' }}>
                    {formatDate(alert.detected_at)}
                    {alert.status === 'acknowledged' && ' · prise en compte'}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {alert.status === 'open' && (
                    <button onClick={() => setAlertStatus(alert.id, 'acknowledged')} title={t('agent_alerts_acknowledge')} className="p-1.5 rounded border" style={cardStyle}>
                      <IconClock size={14} style={{ color: 'var(--tblr-muted)' }} />
                    </button>
                  )}
                  <button onClick={() => setAlertStatus(alert.id, 'resolved')} title={t('agent_alerts_resolve')} className="p-1.5 rounded border" style={cardStyle}>
                    <IconCheck size={14} style={{ color: 'var(--tblr-muted)' }} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Règles */}
      <section className="p-5 rounded-xl border space-y-3" style={cardStyle}>
        <h2 className="font-semibold text-[14px]" style={{ color: 'var(--tblr-text)' }}>{t('agent_alerts_rules')}</h2>
        <div className="space-y-3">
          {rules.map(rule => (
            <div key={rule.code} className="p-3 rounded-lg border space-y-2" style={cardStyle}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => saveRule(rule, { enabled: !rule.enabled })}
                  className="w-4 h-4 rounded mt-0.5"
                  style={{ accentColor: 'var(--tblr-primary)' }}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium" style={{ color: 'var(--tblr-text)' }}>{rule.label}</span>
                  <span className="block text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{rule.description}</span>
                </span>
              </label>
              {rule.enabled && (
                <div className="flex flex-wrap items-center gap-3 pl-7">
                  {rule.default_threshold_days !== null && (
                    <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--tblr-muted)' }}>
                      {t('agent_alerts_threshold')}
                      <input
                        type="number"
                        min={0}
                        value={rule.threshold_days ?? ''}
                        onChange={e => saveRule(rule, { threshold_days: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
                        className="w-20 px-2 py-1 rounded border text-[12px] outline-none"
                        style={inputStyle}
                      />
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--tblr-muted)' }}>
                    {t('agent_alerts_severity')}
                    <select
                      value={rule.severity}
                      onChange={e => saveRule(rule, { severity: e.target.value as RuleRow['severity'] })}
                      className="px-2 py-1 rounded border text-[12px] outline-none"
                      style={inputStyle}
                    >
                      <option value="info">{t('agent_alerts_severity_info')}</option>
                      <option value="warning">{t('agent_alerts_severity_warning')}</option>
                      <option value="critical">{t('agent_alerts_severity_critical')}</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: 'var(--tblr-muted)' }}>
                    <input
                      type="checkbox"
                      checked={rule.notify_email}
                      onChange={() => saveRule(rule, { notify_email: !rule.notify_email })}
                      className="w-3.5 h-3.5 rounded"
                      style={{ accentColor: 'var(--tblr-primary)' }}
                    />
                    {t('agent_alerts_notify_email')}
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Tâches planifiées */}
      <section className="p-5 rounded-xl border space-y-3" style={cardStyle}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-[14px]" style={{ color: 'var(--tblr-text)' }}>{t('agent_schedules_title')}</h2>
          {!draft && agents.length > 0 && (
            <button
              onClick={() => { setDraft(emptySchedule(agents[0].id)); setEditingId(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
              style={{ background: 'var(--tblr-primary)', color: 'white' }}
            >
              <IconPlus size={14} /> {t('agent_schedules_new')}
            </button>
          )}
        </div>
        <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_schedules_hint')}</p>

        {draft && (
          <div className="p-4 rounded-lg border space-y-3" style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)' }}>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[12px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_schedules_name')}</span>
                <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={inputCls} style={inputStyle} />
              </label>
              <label className="space-y-1">
                <span className="text-[12px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_schedules_agent')}</span>
                <select value={draft.agent_id} onChange={e => setDraft({ ...draft, agent_id: e.target.value })} className={inputCls} style={inputStyle}>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name} — {a.role_title}</option>)}
                </select>
              </label>
            </div>
            <label className="space-y-1 block">
              <span className="text-[12px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_schedules_prompt')}</span>
              <textarea
                value={draft.prompt}
                onChange={e => setDraft({ ...draft, prompt: e.target.value })}
                rows={3}
                placeholder="Ex : Fais le point sur les projets dont les études ont démarré et signale ceux qui n'ont pas de contrat signé."
                className={`${inputCls} resize-none`}
                style={inputStyle}
              />
            </label>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-[12px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_schedules_frequency')}</span>
                <select value={draft.frequency} onChange={e => setDraft({ ...draft, frequency: e.target.value as ScheduleRow['frequency'] })} className={inputCls} style={inputStyle}>
                  <option value="daily">{t('agent_schedules_daily')}</option>
                  <option value="weekly">{t('agent_schedules_weekly')}</option>
                  <option value="monthly">{t('agent_schedules_monthly')}</option>
                </select>
              </label>
              {draft.frequency === 'weekly' && (
                <label className="space-y-1">
                  <span className="text-[12px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_schedules_weekday')}</span>
                  <select value={draft.weekday ?? 1} onChange={e => setDraft({ ...draft, weekday: parseInt(e.target.value, 10) })} className={inputCls} style={inputStyle}>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </label>
              )}
              {draft.frequency === 'monthly' && (
                <label className="space-y-1">
                  <span className="text-[12px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_schedules_day_of_month')}</span>
                  <input type="number" min={1} max={28} value={draft.day_of_month ?? 1} onChange={e => setDraft({ ...draft, day_of_month: parseInt(e.target.value, 10) })} className={inputCls} style={inputStyle} />
                </label>
              )}
              <label className="space-y-1">
                <span className="text-[12px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_schedules_hour')}</span>
                <input type="number" min={0} max={23} value={draft.hour_utc} onChange={e => setDraft({ ...draft, hour_utc: parseInt(e.target.value, 10) })} className={inputCls} style={inputStyle} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: 'var(--tblr-text)' }}>
              <input type="checkbox" checked={draft.notify_email} onChange={() => setDraft({ ...draft, notify_email: !draft.notify_email })} className="w-4 h-4 rounded" style={{ accentColor: 'var(--tblr-primary)' }} />
              {t('agent_schedules_notify')}
            </label>
            <div className="flex gap-2">
              <button onClick={saveSchedule} className="px-4 py-2 rounded-lg text-[13px] font-medium" style={{ background: 'var(--tblr-primary)', color: 'white' }}>
                {t('agent_schedules_save')}
              </button>
              <button onClick={() => { setDraft(null); setEditingId(null); }} className="px-4 py-2 rounded-lg border text-[13px]" style={{ ...cardStyle, color: 'var(--tblr-text)' }}>
                {t('agent_schedules_cancel')}
              </button>
            </div>
          </div>
        )}

        {schedules.length === 0 && !draft && (
          <p className="text-[13px]" style={{ color: 'var(--tblr-muted)' }}>{t('agent_schedules_none')}</p>
        )}

        <div className="space-y-2">
          {schedules.map(schedule => {
            const agent = agents.find(a => a.id === schedule.agent_id);
            return (
              <div key={schedule.id} className="p-3 rounded-lg border space-y-2" style={cardStyle}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium" style={{ color: 'var(--tblr-text)' }}>{schedule.name}</div>
                    <div className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>
                      {agent ? `${agent.name} · ` : ''}
                      {schedule.frequency === 'daily' ? t('agent_schedules_daily')
                        : schedule.frequency === 'weekly' ? `${t('agent_schedules_weekly')} (${WEEKDAYS[schedule.weekday ?? 1]})`
                        : `${t('agent_schedules_monthly')} (${schedule.day_of_month})`} · {String(schedule.hour_utc).padStart(2, '0')}:00 UTC
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>
                      {t('agent_schedules_next_run')} : {formatDate(schedule.next_run_at)} · {t('agent_schedules_last_run')} : {formatDate(schedule.last_run_at)}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => runNow(schedule.id)} title={t('agent_schedules_run_now')} className="p-1.5 rounded border" style={cardStyle}>
                      <IconPlayerPlay size={14} style={{ color: 'var(--tblr-muted)' }} />
                    </button>
                    <button onClick={() => toggleRuns(schedule.id)} title={t('agent_schedules_runs')} className="p-1.5 rounded border" style={cardStyle}>
                      <IconClock size={14} style={{ color: 'var(--tblr-muted)' }} />
                    </button>
                    <button
                      onClick={() => {
                        const { id, last_run_at, next_run_at, ...rest } = schedule;
                        setDraft(rest);
                        setEditingId(schedule.id);
                      }}
                      title={t('agent_schedules_save')}
                      className="p-1.5 rounded border"
                      style={cardStyle}
                    >
                      <IconCheck size={14} style={{ color: 'var(--tblr-muted)' }} />
                    </button>
                    <button onClick={() => deleteSchedule(schedule.id)} title={t('agent_schedules_delete')} className="p-1.5 rounded border" style={cardStyle}>
                      <IconTrash size={14} style={{ color: '#c92a2a' }} />
                    </button>
                  </div>
                </div>
                {runs[schedule.id] && (
                  <div className="space-y-1 pt-2 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
                    {runs[schedule.id].length === 0 && (
                      <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>Aucune exécution enregistrée.</p>
                    )}
                    {runs[schedule.id].map(run => (
                      <div key={run.id} className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>
                        <span className="inline-flex items-center gap-1">
                          {run.status === 'ok' ? <IconCheck size={12} /> : <IconX size={12} />}
                          {formatDate(run.started_at)}
                        </span>
                        <div className="whitespace-pre-wrap mt-0.5" style={{ color: 'var(--tblr-text)' }}>
                          {run.reply || run.error}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
