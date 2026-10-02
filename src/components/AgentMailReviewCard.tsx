// Revue matinale des mails (voir server/agentMailReview.ts) : l'agent choisi
// relit la boîte de la personne chaque matin et lui envoie une notification
// par mail qui attend une réponse, avec une proposition de réponse. Réglage
// personnel (une boîte mail l'est), action immédiate comme AgentMailInboxCard.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLoader2, IconPlayerPlay } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

interface Agent { id: string; name: string; is_active: boolean; mail_enabled?: boolean }
interface ReviewItem { id: string; from: string; subject: string; urgency: string; proposal: string }
interface Review {
  agent_id: string; enabled: boolean; hour_local: number; weekdays_only: boolean; max_mails: number;
  last_run_at: string | null; last_status: 'ok' | 'error' | 'skipped' | null; last_error: string | null;
  last_count: number | null; last_result: ReviewItem[] | null;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const fieldStyle = { background: 'var(--tblr-bg-surface-secondary)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' };

export function AgentMailReviewCard() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [agentList, current] = await Promise.all([
          apiFetch<Agent[]>('/api/agents'),
          apiFetch<Review | null>('/api/agent-mail-review'),
        ]);
        setAgents(agentList.filter(a => a.is_active && a.mail_enabled));
        setReview(current);
      } catch (e: any) {
        setError(e.message || t('agent_mail_review_error'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Enregistre l'état complet à chaque changement : quatre réglages, pas de formulaire.
  const save = async (patch: Partial<Review>) => {
    const next = { enabled: true, hour_local: 8, weekdays_only: true, max_mails: 8, ...review, ...patch };
    if (!next.agent_id) return;
    setBusy(true);
    setError(null);
    try {
      setReview(await apiFetch<Review>('/api/agent-mail-review', { method: 'PUT', body: JSON.stringify(next) }));
    } catch (e: any) {
      setError(e.message || t('agent_mail_review_error'));
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    setError(null);
    try {
      await apiFetch('/api/agent-mail-review/run', { method: 'POST' });
      setReview(await apiFetch<Review | null>('/api/agent-mail-review'));
    } catch (e: any) {
      setError(e.message || t('agent_mail_review_error'));
    } finally {
      setRunning(false);
    }
  };

  const enabled = !!review?.enabled;

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('agent_mail_review_title')}</h2>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('agent_mail_review_explanation')}</p>
      {error && <p className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-4" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 size={16} className="animate-spin" /></div>
      ) : agents.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('agent_mail_review_no_agent')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">{t('agent_mail_review_agent_label')}</label>
            <select
              value={review?.agent_id || ''}
              onChange={e => save({ agent_id: e.target.value, enabled: true })}
              disabled={busy}
              className="text-sm rounded-lg px-2.5 py-1.5"
              style={fieldStyle}
            >
              <option value="" disabled>{t('agent_mail_review_agent_choose')}</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {busy && <IconLoader2 size={14} className="animate-spin" style={{ color: 'var(--tblr-muted)' }} />}
          </div>

          {review && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enabled} disabled={busy} onChange={e => save({ enabled: e.target.checked })} />
                {t('agent_mail_review_enabled')}
              </label>

              {enabled && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    {t('agent_mail_review_hour')}
                    <select value={review.hour_local} disabled={busy} onChange={e => save({ hour_local: Number(e.target.value) })} className="text-sm rounded-lg px-2 py-1" style={fieldStyle}>
                      {HOURS.map(h => <option key={h} value={h}>{`${h} h`}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={review.weekdays_only} disabled={busy} onChange={e => save({ weekdays_only: e.target.checked })} />
                    {t('agent_mail_review_weekdays')}
                  </label>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button onClick={runNow} disabled={running || busy} className="btn btn-sm inline-flex items-center gap-1.5">
                  {running ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlayerPlay size={14} />}
                  {t('agent_mail_review_run_now')}
                </button>
                {review.last_run_at && (
                  <span className="text-xs" style={{ color: review.last_status === 'error' ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}>
                    {t('agent_mail_review_last_run', { date: new Date(review.last_run_at).toLocaleString('fr-FR'), count: review.last_count ?? 0 })}
                    {review.last_error ? ` — ${review.last_error}` : ''}
                  </span>
                )}
              </div>

              {!!review.last_result?.length && (
                <ul className="space-y-2">
                  {review.last_result.map(item => (
                    <li key={item.id} className="rounded-lg p-3 text-sm" style={{ background: 'var(--tblr-bg-surface-secondary)' }}>
                      <p className="font-semibold truncate">{item.subject}</p>
                      <p className="text-xs mb-1" style={{ color: 'var(--tblr-muted)' }}>{item.from}</p>
                      <p className="whitespace-pre-wrap">{item.proposal}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
