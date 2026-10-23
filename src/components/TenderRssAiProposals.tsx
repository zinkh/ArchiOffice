import { useEffect, useMemo, useState } from 'react';
import { IconSparkles, IconLock, IconEye, IconEyeOff, IconExternalLink, IconAdjustments, IconX, IconInbox } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { fetchJson, apiFetch } from '../lib/api';
import { useUser } from '../UserContext';
import { Toast } from './ui/Toast';
import { useToastWithUndo } from '../hooks/useToastWithUndo';
import { MatchDetailContent } from './tenderRss/MatchDetailContent';
import type { TenderRssMatch } from '../types';

interface ScanSummary {
  scanned: number;
  expired: number;
  proposed: number;
  unscored: number;
  more: boolean;
  insufficient_credit: boolean;
  error: string | null;
}

type VerdictFilter = 'all' | 'pertinent' | 'a_etudier';

const VERDICT_COLORS = {
  pertinent: { bg: 'var(--tblr-success-lt)', fg: 'var(--tblr-success)' },
  a_etudier: { bg: 'var(--tblr-warning-lt)', fg: 'var(--tblr-warning)' },
} as const;

function ScoreBadge({ match, label }: { match: TenderRssMatch; label: string }) {
  const colors = VERDICT_COLORS[match.ai_verdict === 'pertinent' ? 'pertinent' : 'a_etudier'];
  return (
    <span className="px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold uppercase whitespace-nowrap" style={{ background: colors.bg, color: colors.fg }}>
      {label} · {match.ai_score}
    </span>
  );
}

/**
 * Annonces de la veille retenues par le pré-tri IA, classées par note. L'IA ne
 * fait que proposer : écarter ou surveiller reste un geste de l'architecte, et
 * « Surveiller » mène à l'onglet des annonces sélectionnées, où la conversion
 * en appel d'offres est proposée.
 */
export function TenderRssAiProposals() {
  const { t } = useTranslation();
  const { tenantPlan } = useUser();
  const isEnterprise = tenantPlan === 'enterprise';
  const { toast, showToast } = useToastWithUndo();

  const [matches, setMatches] = useState<TenderRssMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<VerdictFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [criteria, setCriteria] = useState('');
  const [criteriaDraft, setCriteriaDraft] = useState('');
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [savingCriteria, setSavingCriteria] = useState(false);

  const load = () => fetchJson<TenderRssMatch[]>('/api/tender-rss-matches').then(setMatches);

  useEffect(() => {
    Promise.all([load(), fetchJson<{ criteria: string }>('/api/tender-ai-criteria').then(r => setCriteria(r.criteria || ''))])
      .catch(() => showToast(t('tender_rss_load_error'), 'error'))
      .finally(() => setLoading(false));
  }, []);

  // Seules les annonces encore à traiter sont proposées ; une annonce surveillée
  // ou écartée quitte la liste, son identifiant lui restant attaché.
  const proposals = useMemo(
    () => matches
      .filter(m => (m.status === 'new' || m.status === 'read') && m.ai_ref && (m.ai_verdict === 'pertinent' || m.ai_verdict === 'a_etudier'))
      .filter(m => filter === 'all' || m.ai_verdict === filter)
      .sort((a, b) => (b.ai_score ?? 0) - (a.ai_score ?? 0)),
    [matches, filter],
  );
  const toScoreCount = matches.filter(m => (m.status === 'new' || m.status === 'read') && !m.ai_scored_at).length;
  const selected = matches.find(m => m.id === selectedId) || null;

  const handleScan = async (rescore: boolean) => {
    setScanning(true);
    try {
      const summary = await apiFetch<ScanSummary>('/api/tender-rss-matches/ai-scan', { method: 'POST', body: JSON.stringify({ rescore }) });
      await load();
      if (summary.insufficient_credit) showToast(t('tender_ai_scan_no_credit'), 'error');
      else if (summary.error) showToast(t('tender_ai_scan_partial_error', { error: summary.error }), 'error');
      else if (summary.scanned === 0 && summary.unscored === 0) showToast(t('tender_ai_scan_nothing'));
      else if (summary.more) showToast(`${t('tender_ai_scan_done', { scanned: summary.scanned, proposed: summary.proposed, expired: summary.expired })} ${t('tender_ai_scan_more')}`);
      else showToast(t('tender_ai_scan_done', { scanned: summary.scanned, proposed: summary.proposed, expired: summary.expired }));
    } catch (err: any) {
      showToast(err?.message || t('tender_ai_scan_error'), 'error');
    } finally {
      setScanning(false);
    }
  };

  const setStatus = async (match: TenderRssMatch, status: 'watched' | 'dismissed') => {
    const previous = match.status;
    try {
      await apiFetch(`/api/tender-rss-matches/${match.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status } : m));
      setSelectedId(prev => prev === match.id ? null : prev);
      showToast(t(status === 'watched' ? 'tender_rss_watched_toast' : 'tender_rss_dismissed_toast', { title: match.title }), 'success', {
        duration: 6000,
        action: {
          label: t('tender_rss_undo'),
          onClick: async () => {
            try {
              await apiFetch(`/api/tender-rss-matches/${match.id}`, { method: 'PUT', body: JSON.stringify({ status: previous }) });
              setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status: previous } : m));
            } catch (err: any) { showToast(err?.message || t('tender_rss_save_error'), 'error'); }
          },
        },
      });
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_save_error'), 'error');
    }
  };

  const saveCriteria = async () => {
    setSavingCriteria(true);
    try {
      const saved = await apiFetch<{ criteria: string }>('/api/tender-ai-criteria', { method: 'PUT', body: JSON.stringify({ criteria: criteriaDraft }) });
      setCriteria(saved.criteria);
      setCriteriaOpen(false);
      showToast(t('tender_ai_criteria_saved'));
    } catch (err: any) {
      showToast(err?.message || t('tender_rss_save_error'), 'error');
    } finally {
      setSavingCriteria(false);
    }
  };

  const verdictLabel = (m: TenderRssMatch) => t(m.ai_verdict === 'pertinent' ? 'tender_ai_verdict_pertinent' : 'tender_ai_verdict_a_etudier');

  if (loading) {
    return <div className="py-10 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('tender_rss_loading')}</div>;
  }

  const actions = (m: TenderRssMatch) => (
    <>
      <button
        onClick={() => setStatus(m, 'dismissed')}
        aria-label={t('tender_rss_dismiss')}
        title={t('tender_rss_dismiss')}
        className="p-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        style={{ color: 'var(--tblr-muted)' }}
      >
        <IconEyeOff size={16} />
      </button>
      <button
        onClick={() => setStatus(m, 'watched')}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium pointer-coarse:min-h-11"
        style={{ background: 'var(--tblr-primary)', color: '#fff' }}
      >
        <IconEye size={14} />
        {t('tender_rss_watch')}
      </button>
    </>
  );

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg p-4 flex flex-wrap items-center justify-between gap-3"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        <div className="min-w-0">
          <h3 className="text-base font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('tender_ai_title')}</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
            {isEnterprise ? t('tender_ai_subtitle', { count: toScoreCount }) : t('tender_ai_enterprise_only')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setCriteriaDraft(criteria); setCriteriaOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors hover:bg-[var(--tblr-surface-2)] pointer-coarse:min-h-11"
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
          >
            <IconAdjustments size={14} /> {t('tender_ai_criteria_button')}
          </button>
          {isEnterprise ? (
            <>
              <button
                onClick={() => handleScan(true)}
                disabled={scanning}
                className="px-3 py-1.5 text-xs rounded border transition-colors hover:bg-[var(--tblr-surface-2)] disabled:opacity-60 pointer-coarse:min-h-11"
                style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
                title={t('tender_ai_rescore_hint')}
              >
                {t('tender_ai_rescore')}
              </button>
              <button
                onClick={() => handleScan(false)}
                disabled={scanning}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded font-medium disabled:opacity-60 pointer-coarse:min-h-11"
                style={{ background: 'var(--tblr-primary)', color: '#fff' }}
              >
                <IconSparkles size={14} /> {scanning ? t('tender_ai_scanning') : t('tender_ai_scan')}
              </button>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--tblr-muted)' }}><IconLock size={14} /> Enterprise</span>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row items-start gap-6">
        <div
          className="min-w-0 flex-1 w-full rounded-lg overflow-hidden"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
        >
          <div className="flex items-center gap-2 p-3" style={{ borderBottom: '1px solid var(--tblr-border)' }} role="group" aria-label={t('tender_ai_filter_label')}>
            {(['all', 'pertinent', 'a_etudier'] as VerdictFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className="px-3 py-1 rounded-full text-xs font-medium pointer-coarse:min-h-11"
                style={{
                  background: filter === f ? 'var(--tblr-primary-lt)' : 'var(--tblr-surface-2)',
                  color: filter === f ? 'var(--tblr-primary)' : 'var(--tblr-muted)',
                }}
              >
                {t(`tender_ai_filter_${f}`)}
              </button>
            ))}
          </div>

          {proposals.length === 0 ? (
            <div className="py-10 px-4 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('tender_ai_empty')}</div>
          ) : (
            proposals.map(m => (
              <div
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 cursor-pointer transition-colors"
                style={{ borderBottom: '1px solid var(--tblr-border)', background: selectedId === m.id ? 'var(--tblr-surface-2)' : undefined }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[0.6875rem] font-mono font-semibold" style={{ color: 'var(--tblr-muted)' }}>{m.ai_ref}</span>
                    <ScoreBadge match={m} label={verdictLabel(m)} />
                  </div>
                  <p className="font-medium text-sm mt-1" style={{ color: 'var(--tblr-text)' }}>{m.title}</p>
                  {m.ai_reason && <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{m.ai_reason}</p>}
                  <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
                    {m.source_name || '---'}
                    {m.ville_execution ? ` · ${m.ville_execution}` : ''}
                    {m.date_limite_reponse ? ` · ${t('tender_rss_field_date_limite')} ${new Date(m.date_limite_reponse).toLocaleDateString('fr-FR')}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                  {m.link && (
                    <a href={m.link} target="_blank" rel="noopener noreferrer" aria-label={t('tender_rss_open_source')} title={t('tender_rss_open_source')} className="p-2" style={{ color: 'var(--tblr-muted)' }}>
                      <IconExternalLink size={16} />
                    </a>
                  )}
                  {actions(m)}
                </div>
              </div>
            ))
          )}
        </div>

        <div
          className="hidden lg:flex lg:flex-col w-[380px] shrink-0 self-start sticky top-4 max-h-[calc(100dvh-2rem)] rounded-lg overflow-hidden"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
        >
          {selected ? (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>
                <h3 className="font-semibold text-sm truncate pr-2" style={{ color: 'var(--tblr-text)' }}>{selected.title}</h3>
                <button onClick={() => setSelectedId(null)} aria-label={t('tender_ai_close')} className="rounded p-1 shrink-0"><IconX size={16} style={{ color: 'var(--tblr-muted)' }} /></button>
              </div>
              <div className="overflow-y-auto p-4 flex-1 space-y-4">
                <AiAssessment match={selected} verdict={verdictLabel(selected)} t={t} />
                <MatchDetailContent match={selected} t={t} />
              </div>
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>{actions(selected)}</div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 p-10 text-center flex-1" style={{ color: 'var(--tblr-muted)' }}>
              <IconInbox size={28} className="opacity-40" />
              <p className="text-sm">{t('tender_rss_select_hint')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Détail sur petit écran */}
      {selected && (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div role="dialog" aria-modal="true" aria-label={selected.title} className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden max-h-[88dvh] flex flex-col" style={{ background: 'var(--tblr-surface)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>
              <h3 className="font-semibold text-base truncate pr-2" style={{ color: 'var(--tblr-text)' }}>{selected.title}</h3>
              <button onClick={() => setSelectedId(null)} aria-label={t('tender_ai_close')} className="rounded p-2 shrink-0"><IconX size={18} style={{ color: 'var(--tblr-muted)' }} /></button>
            </div>
            <div className="overflow-y-auto p-5 flex-1 space-y-4">
              <AiAssessment match={selected} verdict={verdictLabel(selected)} t={t} />
              <MatchDetailContent match={selected} t={t} />
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>{actions(selected)}</div>
          </div>
        </div>
      )}

      {criteriaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div role="dialog" aria-modal="true" aria-labelledby="tender-ai-criteria-title" className="rounded-lg shadow-xl w-full max-w-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <div className="p-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
              <h3 id="tender-ai-criteria-title" className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>{t('tender_ai_criteria_title')}</h3>
              <button onClick={() => setCriteriaOpen(false)} aria-label={t('tender_ai_close')} className="p-1" style={{ color: 'var(--tblr-muted)' }}><IconX size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <label htmlFor="tender-ai-criteria" className="block text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{t('tender_ai_criteria_label')}</label>
              <textarea
                id="tender-ai-criteria"
                rows={7}
                maxLength={2000}
                value={criteriaDraft}
                onChange={e => setCriteriaDraft(e.target.value)}
                placeholder={t('tender_ai_criteria_placeholder')}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              />
              <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('tender_ai_criteria_help')}</p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--tblr-border)' }}>
              <button onClick={() => setCriteriaOpen(false)} className="px-3 py-1.5 text-sm rounded border" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>{t('tender_ai_cancel')}</button>
              <button onClick={saveCriteria} disabled={savingCriteria} className="px-3 py-1.5 text-sm rounded font-medium disabled:opacity-60" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>{t('tender_ai_save')}</button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}

function AiAssessment({ match, verdict, t }: { match: TenderRssMatch; verdict: string; t: (key: string, opts?: Record<string, any>) => string }) {
  return (
    <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--tblr-primary-lt)' }}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: 'var(--tblr-primary)' }}>
        <IconSparkles size={13} /> {t('tender_ai_assessment')} · {match.ai_ref}
      </p>
      <p className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{verdict} · {match.ai_score}/100</p>
      {match.ai_reason && <p className="text-sm" style={{ color: 'var(--tblr-text)' }}>{match.ai_reason}</p>}
      {match.ai_flags && match.ai_flags.length > 0 && (
        <ul className="text-xs list-disc pl-4 space-y-0.5" style={{ color: 'var(--tblr-text)' }}>
          {match.ai_flags.map((flag, i) => <li key={i}>{flag}</li>)}
        </ul>
      )}
      <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('tender_ai_disclaimer')}</p>
    </div>
  );
}
