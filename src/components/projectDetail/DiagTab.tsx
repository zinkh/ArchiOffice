// Onglet DIAG de la fiche affaire : les rapports de diagnostic d'une opération de
// rénovation (éditeur de texte riche, rédaction assistée par l'IA qui lit la
// fiche, les pièces et le rapport) et, à côté, la demande d'étude de sol au
// géotechnicien qui occupait déjà cet onglet.
//
// Un projet en construction neuve n'a pas de rapport de diagnostic : l'onglet
// reste alors celui de l'étude de sol.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFileTypeDocx, IconFileTypePdf, IconPlus, IconTrash } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { useUser } from '../../UserContext';
import { useSettings } from '../../hooks/useSettings';
import { diagAiAccess } from '../../lib/diagAiAccess';
import type { AgencySettings } from '../../lib/proposalExport';
import { operationNature } from '../../lib/proposalSurfaces';
import type { DiagReport } from '../../lib/diagReports';
import type { Project } from '../../types';
import { RichTextEditor, type AiWriteRequest } from '../RichTextEditor';
import { StudyRequestTab } from './StudyRequestTab';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';

type SubTab = 'report' | 'soil';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
interface PendingSave { id: string; title?: string; content?: string }

const SAVE_DELAY_MS = 800;

export function DiagTab({ project }: { project: Project }) {
  const { t } = useTranslation();
  const isRenovation = operationNature(project as any) === 'rehabilitation';
  const [sub, setSub] = useState<SubTab>(isRenovation ? 'report' : 'soil');

  return (
    <div className="space-y-4">
      {isRenovation ? (
        <div role="tablist" aria-label={t('project_tab_title_diag') as string} className="flex gap-1 border-b" style={{ borderColor: 'var(--tblr-border-color)' }}>
          {(['report', 'soil'] as const).map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={sub === id}
              onClick={() => setSub(id)}
              className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-semibold', sub === id ? 'border-current' : 'border-transparent')}
              style={{ color: sub === id ? 'var(--tblr-body-color)' : 'var(--tblr-muted)' }}
            >
              {t(id === 'report' ? 'diag_tab_report' : 'diag_tab_soil')}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('diag_renovation_only')}</p>
      )}

      {isRenovation && sub === 'report'
        ? <DiagReports project={project} />
        : <StudyRequestTab kind="geotechnique" project={project} />}
    </div>
  );
}

function DiagReports({ project }: { project: Project }) {
  const { t, i18n } = useTranslation();
  const { tenantPlan, trialEndsAt } = useUser();
  const { settings } = useSettings();
  const access = diagAiAccess(tenantPlan, trialEndsAt);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [reports, setReports] = useState<DiagReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [save, setSave] = useState<SaveState>('idle');
  const { confirm, dialog } = useConfirmDialog();

  const pending = useRef<PendingSave | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const base = `/api/projects/${project.id}/diag-reports`;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch<DiagReport[]>(base)
      .then(rows => { if (alive) { setReports(rows); setSelectedId(rows[0]?.id ?? null); } })
      .catch((e: any) => { if (alive) setLoadError(e?.error || e?.message || (t('diag_load_error') as string)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [base, t]);

  // Enregistre tout de suite ce qui attend (changement de rapport, rédaction IA, fermeture de l'onglet).
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    setSave('saving');
    try {
      const { id, ...patch } = job;
      await apiFetch<DiagReport>(`${base}/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
      setSave(pending.current ? 'saving' : 'saved');
    } catch {
      // Le texte reste en attente : le prochain enregistrement le reprend.
      pending.current = pending.current ?? job;
      setSave('error');
    }
  }, [base]);

  useEffect(() => () => { void flush(); }, [flush]);

  const schedule = (id: string, patch: Omit<PendingSave, 'id'>) => {
    pending.current = { ...(pending.current?.id === id ? pending.current : {}), ...patch, id };
    setSave('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
  };

  const selected = useMemo(() => reports.find(r => r.id === selectedId) ?? null, [reports, selectedId]);

  const patchLocal = (id: string, patch: Partial<DiagReport>) =>
    setReports(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const select = async (id: string) => {
    await flush();
    setSelectedId(id);
  };

  const create = async () => {
    await flush();
    try {
      const row = await apiFetch<DiagReport>(base, { method: 'POST', body: JSON.stringify({ title: t('diag_report_default_title') }) });
      setReports(prev => [...prev, row]);
      setSelectedId(row.id);
    } catch (e: any) {
      setLoadError(e?.error || e?.message || (t('diag_save_error') as string));
    }
  };

  const remove = async (id: string) => {
    const ok = await confirm({
      title: t('diag_report_delete_confirm') as string,
      tone: 'danger',
      confirmLabel: t('diag_report_delete') as string,
      cancelLabel: t('richtext_ai_cancel') as string,
    });
    if (!ok) return;
    if (pending.current?.id === id) { pending.current = null; if (timer.current) clearTimeout(timer.current); }
    try {
      await apiFetch(`${base}/${id}`, { method: 'DELETE' });
      setReports(prev => {
        const next = prev.filter(r => r.id !== id);
        if (selectedId === id) setSelectedId(next[0]?.id ?? null);
        return next;
      });
    } catch (e: any) {
      setLoadError(e?.error || e?.message || (t('diag_save_error') as string));
    }
  };

  const ai = useCallback(async (req: AiWriteRequest): Promise<string> => {
    // Le serveur relit les autres rapports de l'affaire : on enregistre d'abord ce qui est en attente.
    await flush();
    const res = await apiFetch<{ text: string }>(`${base}/ai-write`, {
      method: 'POST',
      body: JSON.stringify({ ...req, reportId: selectedId }),
    });
    return res.text;
  }, [base, flush, selectedId]);

  const exportReport = async (format: 'pdf' | 'docx') => {
    if (!selected) return;
    setExporting(format);
    setLoadError('');
    try {
      await flush();
      const { exportDiagReportPdf, exportDiagReportDocx } = await import('../../lib/diagReportExport');
      await (format === 'pdf' ? exportDiagReportPdf : exportDiagReportDocx)(project, selected, settings as AgencySettings);
    } catch {
      setLoadError(t('diag_export_error') as string);
    } finally {
      setExporting(null);
    }
  };

  const aiHint = access === 'full'
    ? t('diag_ai_hint')
    : access === 'preview'
      ? t('diag_ai_trial_preview', { date: trialEndsAt ? new Date(trialEndsAt).toLocaleDateString(i18n.language) : '' })
      : t('diag_ai_enterprise_only');

  if (loading) return <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>…</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {dialog}
      <aside aria-label={t('diag_reports_title') as string} className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('diag_reports_title')}</h2>
          <button
            type="button"
            onClick={() => void create()}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold"
            style={{ borderColor: 'var(--tblr-border-color)', color: 'var(--tblr-body-color)' }}
          >
            <IconPlus size={14} />{t('diag_report_new')}
          </button>
        </div>
        <ul className="space-y-1">
          {reports.map(r => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => void select(r.id)}
                aria-current={r.id === selectedId}
                className={cn('w-full truncate rounded-md border px-3 py-2 text-left text-sm', r.id === selectedId ? 'font-semibold' : '')}
                style={{ borderColor: r.id === selectedId ? 'var(--tblr-body-color)' : 'var(--tblr-border-color)', color: 'var(--tblr-body-color)' }}
              >
                {r.title || t('diag_report_default_title')}
              </button>
            </li>
          ))}
        </ul>
        {reports.length === 0 && <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('diag_reports_empty')}</p>}
      </aside>

      <section className="min-w-0 space-y-3">
        {loadError && <p role="alert" className="text-sm" style={{ color: 'var(--tblr-danger, #b42318)' }}>{loadError}</p>}
        {selected && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`diag-title-${selected.id}`}>{t('diag_report_title_label')}</label>
              <input
                id={`diag-title-${selected.id}`}
                value={selected.title}
                maxLength={200}
                onChange={e => { patchLocal(selected.id, { title: e.target.value }); schedule(selected.id, { title: e.target.value }); }}
                className="min-w-0 flex-1 rounded-md border px-3 py-2 text-base font-semibold"
                style={{ borderColor: 'var(--tblr-border-color)', background: 'transparent', color: 'var(--tblr-body-color)' }}
              />
              <span aria-live="polite" className="text-xs" style={{ color: save === 'error' ? 'var(--tblr-danger, #b42318)' : 'var(--tblr-muted)' }}>
                {save === 'saving' ? t('diag_saving') : save === 'saved' ? t('diag_saved') : save === 'error' ? t('diag_save_error') : ''}
              </span>
              {(['pdf', 'docx'] as const).map(format => (
                <button
                  key={format}
                  type="button"
                  onClick={() => void exportReport(format)}
                  disabled={exporting !== null || !selected.content.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-semibold disabled:opacity-40"
                  style={{ borderColor: 'var(--tblr-border-color)', color: 'var(--tblr-body-color)' }}
                >
                  {format === 'pdf' ? <IconFileTypePdf size={16} /> : <IconFileTypeDocx size={16} />}
                  {exporting === format ? t('diag_exporting') : t(format === 'pdf' ? 'diag_export_pdf' : 'diag_export_docx')}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void remove(selected.id)}
                aria-label={t('diag_report_delete') as string}
                title={t('diag_report_delete') as string}
                className="rounded-md border p-2"
                style={{ borderColor: 'var(--tblr-border-color)', color: 'var(--tblr-muted)' }}
              >
                <IconTrash size={16} />
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{aiHint}</p>
            {/* key : changer de rapport remonte l'éditeur avec le contenu du nouveau. */}
            <RichTextEditor
              key={selected.id}
              value={selected.content}
              onChange={html => { patchLocal(selected.id, { content: html }); schedule(selected.id, { content: html }); }}
              placeholder={t('diag_report_placeholder') as string}
              ai={access === 'locked' ? undefined : ai}
              aiLocked={access === 'locked' ? (t('diag_ai_enterprise_only') as string) : undefined}
              minHeight={420}
              ariaLabel={selected.title}
            />
          </>
        )}
      </section>
    </div>
  );
}
