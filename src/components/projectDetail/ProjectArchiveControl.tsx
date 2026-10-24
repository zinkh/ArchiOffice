import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconArchive, IconArchiveOff, IconCircleCheck, IconDownload, IconHelpCircle } from '@tabler/icons-react';
import { fetchJson } from '../../lib/api';
import { getAccessToken } from '../../lib/authToken';
import { downloadBlob } from '../../lib/panneaux';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { ARCHIVE_REASON_MAX_CHARS, type ArchiveCheckItem } from '../../lib/projectArchive';

interface Props {
  projectId: string;
  archivedAt?: string | null;
  retentionUntil?: string | null;
  /** Administrateurs et managers archivent. */
  canArchive: boolean;
  /** Seuls les administrateurs rouvrent. */
  canReopen: boolean;
  /** Relit la fiche après un archivage ou une réouverture. */
  onChanged: () => void | Promise<void>;
}

type Mode = 'archive' | 'reopen';

const STATE_ICON = {
  ok: <IconCircleCheck size={16} aria-hidden style={{ color: '#2fb344' }} />,
  warning: <IconAlertTriangle size={16} aria-hidden style={{ color: '#f59f00' }} />,
  unknown: <IconHelpCircle size={16} aria-hidden style={{ color: 'var(--tblr-muted)' }} />,
} as const;

/**
 * Archivage d'une affaire. La clôture est indicative : des contrôles en alerte
 * n'empêchent pas d'archiver, ils demandent un motif, conservé au journal.
 * Voir server/routes/projectArchive.ts.
 */
export function ProjectArchiveControl({ projectId, archivedAt, retentionUntil, canArchive, canReopen, onChanged }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const reasonId = useId();
  const [mode, setMode] = useState<Mode | null>(null);
  const [checklist, setChecklist] = useState<ArchiveCheckItem[] | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [downloading, setDownloading] = useState(false);
  const archived = !!archivedAt;

  // Message court après un archivage ou un téléchargement, effacé seul.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  const downloadDossier = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/projects/${projectId}/closure-dossier`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || t('project_archive_dossier_failed'));
      }
      downloadBlob(await res.blob(), t('project_archive_dossier_filename'));
    } catch (e: any) {
      setNotice(e?.message || t('project_archive_dossier_failed'));
    } finally {
      setDownloading(false);
    }
  };

  const close = () => { if (!busy) setMode(null); };
  useEscapeKey(mode !== null, close);

  useEffect(() => {
    if (mode !== 'archive') return;
    let cancelled = false;
    setChecklist(null);
    fetchJson<{ checklist: ArchiveCheckItem[] }>(`/api/projects/${projectId}/archive-check`)
      .then(data => { if (!cancelled) setChecklist(data.checklist); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || t('project_archive_failed')); });
    return () => { cancelled = true; };
  }, [mode, projectId, t]);

  const open = (next: Mode) => { setReason(''); setError(''); setMode(next); };
  const warnings = (checklist || []).filter(i => i.state === 'warning');
  const reasonRequired = mode === 'reopen' || warnings.length > 0;
  const canSubmit = !busy && (mode === 'archive' ? checklist !== null : true) && (!reasonRequired || reason.trim().length > 0);

  const submit = async () => {
    if (!mode || !canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const result = await fetchJson<{ dossier?: { deposited: boolean; reason?: string } }>(
        `/api/projects/${projectId}/${mode === 'archive' ? 'archive' : 'unarchive'}`,
        {
          method: 'POST',
          body: JSON.stringify(mode === 'archive' ? { override_reason: reason.trim() } : { reason: reason.trim() }),
        },
      );
      if (mode === 'archive') {
        if (result?.dossier?.deposited) setNotice(t('project_archive_deposited'));
        else if (result?.dossier?.reason === 'deposit_failed') setNotice(t('project_archive_not_deposited'));
      }
      setMode(null);
      await onChanged();
    } catch (e: any) {
      setError(e?.message || t('project_archive_failed'));
    } finally {
      setBusy(false);
    }
  };

  const buttonClass = 'min-h-11 sm:min-h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg border text-[0.8125rem] font-semibold whitespace-nowrap transition-colors hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

  return (
    <>
      {notice && (
        <span role="status" className="max-w-[16rem] text-xs leading-tight" style={{ color: 'var(--tblr-muted)' }}>{notice}</span>
      )}
      {archived && canArchive && (
        <button type="button" onClick={() => { void downloadDossier(); }} disabled={downloading}
          className="p-2 text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface-2)] rounded-lg transition disabled:opacity-50"
          title={t('project_archive_dossier_download')} aria-label={t('project_archive_dossier_download')}>
          <IconDownload size={18} aria-hidden />
        </button>
      )}
      {archived ? (
        canReopen ? (
          <button type="button" onClick={() => open('reopen')} className={buttonClass}
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
            title={retentionUntil ? t('project_archive_retention', { date: new Date(retentionUntil).toLocaleDateString() }) : undefined}>
            <IconArchiveOff size={16} aria-hidden />
            {t('project_archive_reopen')}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold" style={{ color: 'var(--tblr-muted)' }}>
            <IconArchive size={16} aria-hidden />
            {t('projects_archived_badge')}
          </span>
        )
      ) : canArchive && (
        <button type="button" onClick={() => open('archive')}
          className="p-2 text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface-2)] rounded-lg transition"
          title={t('project_archive_button')} aria-label={t('project_archive_button')}>
          <IconArchive size={18} aria-hidden />
        </button>
      )}

      {mode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby={titleId}
            className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-xl p-5 space-y-4"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
            <h2 id={titleId} className="text-base font-semibold">
              {mode === 'archive' ? t('project_archive_title') : t('project_archive_reopen_title')}
            </h2>

            {mode === 'archive' && (
              <>
                <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('project_archive_intro')}</p>
                {checklist === null && !error ? (
                  <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('project_archive_checking')}</p>
                ) : (
                  <ul className="space-y-2">
                    {(checklist || []).map(item => (
                      <li key={item.id} className="flex items-start gap-2 text-sm">
                        <span className="mt-0.5 shrink-0">{STATE_ICON[item.state]}</span>
                        <span>
                          {item.label}
                          {item.detail && <span className="block text-xs" style={{ color: 'var(--tblr-muted)' }}>{item.detail}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {reasonRequired && (
              <div className="space-y-1">
                <label htmlFor={reasonId} className="text-sm font-medium">
                  {mode === 'reopen' ? t('project_archive_reopen_reason') : t('project_archive_override_label')}
                </label>
                <textarea id={reasonId} value={reason} maxLength={ARCHIVE_REASON_MAX_CHARS} rows={3}
                  onChange={e => setReason(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                  style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
              </div>
            )}

            {error && <p role="alert" className="text-sm" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={busy} className={buttonClass}
                style={{ borderColor: 'var(--tblr-border)' }}>
                {t('project_archive_cancel')}
              </button>
              <button type="button" onClick={() => { void submit(); }} disabled={!canSubmit}
                className={`${buttonClass} disabled:opacity-50`}
                style={{ borderColor: 'var(--tblr-primary)', background: 'var(--tblr-primary)', color: '#fff' }}>
                {mode === 'archive'
                  ? (warnings.length ? t('project_archive_confirm_anyway') : t('project_archive_confirm'))
                  : t('project_archive_reopen')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
