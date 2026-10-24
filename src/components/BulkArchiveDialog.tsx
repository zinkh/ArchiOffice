import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconArchive } from '@tabler/icons-react';
import { fetchJson } from '../lib/api';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { ARCHIVE_REASON_MAX_CHARS } from '../lib/projectArchive';

interface Candidate {
  id: string;
  name: string;
  project_code: string | null;
  end_date: string;
  warnings: Array<{ id: string; label: string; detail?: string }>;
}

interface CandidatesResponse {
  candidates: Candidate[];
  truncated: boolean;
  skipped_no_date: number;
}

interface BulkResult {
  id: string;
  name: string | null;
  outcome: 'archivee' | 'deja_archivee' | 'motif_requis' | 'introuvable' | 'echec';
}

/** Même plafond que le serveur (POST /api/archive/bulk). */
const MAX_SELECTION = 25;
const PERIODES_MOIS = [6, 12, 24, 36];

/**
 * Archivage en masse des affaires terminées depuis un certain temps. Les
 * affaires sans alerte sont cochées d'office ; en cocher une en alerte demande
 * un motif, conservé au journal. Voir server/routes/projectArchive.ts.
 */
export function BulkArchiveDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const titleId = useId();
  const reasonId = useId();
  const monthsId = useId();
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<BulkResult[] | null>(null);

  const close = () => { if (!busy) onClose(); };
  useEscapeKey(true, close);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    fetchJson<CandidatesResponse>(`/api/archive/candidates?months=${months}`)
      .then(res => {
        if (cancelled) return;
        setData(res);
        setSelected(new Set(res.candidates.filter(c => c.warnings.length === 0).slice(0, MAX_SELECTION).map(c => c.id)));
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message || t('bulk_archive_failed')); });
    return () => { cancelled = true; };
  }, [months, t]);

  const withWarnings = useMemo(
    () => (data?.candidates ?? []).filter(c => selected.has(c.id) && c.warnings.length > 0),
    [data, selected],
  );
  const reasonRequired = withWarnings.length > 0;
  const canSubmit = !busy && selected.size > 0 && (!reasonRequired || reason.trim().length > 0);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_SELECTION) next.add(id);
    return next;
  });

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetchJson<{ results: BulkResult[] }>('/api/archive/bulk', {
        method: 'POST',
        body: JSON.stringify({ project_ids: [...selected], override_reason: reasonRequired ? reason.trim() : undefined }),
      });
      setResults(res.results);
      await onDone();
    } catch (e: any) {
      setError(e?.message || t('bulk_archive_failed'));
    } finally {
      setBusy(false);
    }
  };

  const button = 'min-h-11 sm:min-h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border text-[0.8125rem] font-semibold whitespace-nowrap transition-colors hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50';
  const archivees = results?.filter(r => r.outcome === 'archivee').length ?? 0;
  const nonArchivees = results?.filter(r => r.outcome !== 'archivee') ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-xl p-5 space-y-4"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
        <h2 id={titleId} className="text-base font-semibold inline-flex items-center gap-2">
          <IconArchive size={18} aria-hidden />
          {t('bulk_archive_title')}
        </h2>

        {results ? (
          <div className="space-y-3" role="status">
            <p className="text-sm">{t('bulk_archive_done', { count: archivees })}</p>
            {nonArchivees.length > 0 && (
              <ul className="text-sm space-y-1">
                {nonArchivees.map(r => (
                  <li key={r.id}>{r.name || r.id} : {t(`bulk_archive_outcome_${r.outcome}`)}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={button} style={{ borderColor: 'var(--tblr-border)' }}>{t('bulk_archive_close')}</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('bulk_archive_intro')}</p>

            <div className="flex items-center gap-2">
              <label htmlFor={monthsId} className="text-sm font-medium">{t('bulk_archive_months')}</label>
              <select id={monthsId} value={months} onChange={e => setMonths(Number(e.target.value))} disabled={busy}
                className="rounded-lg px-2 py-1.5 text-sm"
                style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
                {PERIODES_MOIS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {data === null && !error && <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('bulk_archive_loading')}</p>}
            {data && data.candidates.length === 0 && <p className="text-sm">{t('bulk_archive_empty')}</p>}
            {data && data.candidates.length > 0 && (
              <ul className="divide-y" style={{ borderColor: 'var(--tblr-border)' }}>
                {data.candidates.map(c => (
                  <li key={c.id} className="py-2">
                    <label className="flex items-start gap-3 text-sm cursor-pointer">
                      <input type="checkbox" className="mt-1 w-4 h-4 shrink-0" checked={selected.has(c.id)}
                        disabled={busy || (!selected.has(c.id) && selected.size >= MAX_SELECTION)} onChange={() => toggle(c.id)} />
                      <span className="min-w-0">
                        <span className="font-medium">{[c.project_code, c.name].filter(Boolean).join(' · ')}</span>
                        <span className="block text-xs" style={{ color: 'var(--tblr-muted)' }}>
                          {t('bulk_archive_ended', { date: new Date(c.end_date).toLocaleDateString() })}
                        </span>
                        {c.warnings.map(w => (
                          <span key={w.id} className="flex items-start gap-1 text-xs mt-0.5">
                            <IconAlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" style={{ color: '#f59f00' }} />
                            {w.detail || w.label}
                          </span>
                        ))}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {data?.truncated && <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('bulk_archive_truncated')}</p>}
            {data && data.skipped_no_date > 0 && (
              <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('bulk_archive_no_date', { count: data.skipped_no_date })}</p>
            )}

            {reasonRequired && (
              <div className="space-y-1">
                <label htmlFor={reasonId} className="text-sm font-medium">{t('bulk_archive_reason')}</label>
                <textarea id={reasonId} value={reason} maxLength={ARCHIVE_REASON_MAX_CHARS} rows={3}
                  onChange={e => setReason(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                  style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
              </div>
            )}

            {error && <p role="alert" className="text-sm" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                {t('bulk_archive_selected', { count: selected.size, max: MAX_SELECTION })}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={close} disabled={busy} className={button} style={{ borderColor: 'var(--tblr-border)' }}>{t('project_archive_cancel')}</button>
                <button type="button" onClick={() => { void submit(); }} disabled={!canSubmit} className={button}
                  style={{ borderColor: 'var(--tblr-primary)', background: 'var(--tblr-primary)', color: '#fff' }}>
                  {busy ? t('bulk_archive_running') : t('bulk_archive_confirm')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
