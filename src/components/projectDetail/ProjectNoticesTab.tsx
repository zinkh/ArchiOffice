import { useEffect, useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconDownload,
  IconFileDescription,
  IconListDetails,
  IconSparkles,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { DocumentPhase, Project } from '../../types';
import { apiFetch } from '../../lib/api';
import { useUser } from '../../UserContext';
import { useSettings } from '../../hooks/useSettings';
import {
  ARCHITECTURAL_NOTICE_PHASES,
  projectNoticeOutlineText,
  projectNoticeTitle,
  type ProjectNotice,
  type ProjectNoticeKind,
} from '../../lib/projectNotices';
import { exportProjectNoticeDocx, exportProjectNoticePdf } from '../../lib/projectNoticeExport';
import type { AgencySettings } from '../../lib/proposalExport';
import { cn } from '../../lib/utils';

interface ProjectNoticesTabProps {
  project: Project;
  phases: DocumentPhase[];
  currentPhase?: DocumentPhase;
}

const NOTICE_KINDS: ProjectNoticeKind[] = ['architectural', 'accessibility', 'security'];

function noticeKey(kind: ProjectNoticeKind, phase: string) {
  return `${kind}:${phase}`;
}

export function ProjectNoticesTab({ project, phases, currentPhase }: ProjectNoticesTabProps) {
  const { t } = useTranslation();
  const { tenantPlan } = useUser();
  const { settings } = useSettings();
  const isEnterprise = tenantPlan === 'enterprise';

  const architecturalPhases = useMemo(() => {
    const mission = new Set(phases);
    const filtered = ARCHITECTURAL_NOTICE_PHASES.filter(phase => mission.has(phase));
    return filtered.length ? [...filtered] : [...ARCHITECTURAL_NOTICE_PHASES];
  }, [phases]);

  const initialPhase = architecturalPhases.includes(currentPhase as any)
    ? currentPhase as DocumentPhase
    : architecturalPhases[Math.max(0, architecturalPhases.length - 1)];

  const [kind, setKind] = useState<ProjectNoticeKind>('architectural');
  const [phase, setPhase] = useState<DocumentPhase>(initialPhase);
  const [notices, setNotices] = useState<ProjectNotice[]>([]);
  const [content, setContent] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const effectivePhase = kind === 'architectural' ? phase : 'PC';
  const current = useMemo(
    () => notices.find(n => n.kind === kind && n.phase === effectivePhase),
    [notices, kind, effectivePhase],
  );

  useEffect(() => {
    setLoading(true);
    apiFetch<ProjectNotice[]>(`/api/projects/${project.id}/notices`)
      .then(setNotices)
      .catch((error: any) => setMessage({ text: error?.error || error?.message || t('projectnotice_load_error'), tone: 'error' }))
      .finally(() => setLoading(false));
  }, [project.id, t]);

  useEffect(() => {
    setContent(current?.content || '');
    setInstructions(current?.instructions || '');
    setMessage(null);
  }, [current?.id, kind, effectivePhase]);

  useEffect(() => {
    if (kind !== 'architectural') return;
    if (!architecturalPhases.includes(phase)) setPhase(architecturalPhases[0]);
  }, [architecturalPhases, kind, phase]);

  const replaceNotice = (row: ProjectNotice) => {
    setNotices(prev => {
      const key = noticeKey(row.kind, row.phase);
      const next = prev.filter(n => noticeKey(n.kind, n.phase) !== key);
      return [...next, row];
    });
  };

  const save = async (silent = false): Promise<ProjectNotice | null> => {
    setSaving(true);
    if (!silent) setMessage(null);
    try {
      const row = await apiFetch<ProjectNotice>(
        `/api/projects/${project.id}/notices/${kind}/${effectivePhase}`,
        { method: 'PUT', body: JSON.stringify({ content, instructions }) },
      );
      replaceNotice(row);
      if (!silent) setMessage({ text: t('projectnotice_saved'), tone: 'success' });
      return row;
    } catch (error: any) {
      setMessage({ text: error?.error || error?.message || t('projectnotice_save_error'), tone: 'error' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setMessage(null);
    try {
      // Enregistrer d'abord la consigne et le texte courant : le serveur peut
      // ainsi les reprendre comme matière plutôt que les écraser aveuglément.
      await apiFetch<ProjectNotice>(
        `/api/projects/${project.id}/notices/${kind}/${effectivePhase}`,
        { method: 'PUT', body: JSON.stringify({ content, instructions }) },
      );
      const row = await apiFetch<ProjectNotice>(
        `/api/projects/${project.id}/notices/${kind}/${effectivePhase}/generate-ai`,
        { method: 'POST', body: JSON.stringify({ instructions }) },
      );
      replaceNotice(row);
      setContent(row.content || '');
      setInstructions(row.instructions || instructions);
      setMessage({ text: t('projectnotice_generated'), tone: 'success' });
    } catch (error: any) {
      setMessage({ text: error?.error || error?.message || t('projectnotice_generate_error'), tone: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const insertOutline = () => {
    if (content.trim()) return;
    setContent(projectNoticeOutlineText(kind, effectivePhase));
    setMessage({ text: t('projectnotice_outline_inserted'), tone: 'success' });
  };

  const noticeForExport = (): ProjectNotice => current
    ? { ...current, content, instructions }
    : {
        id: 'draft',
        project_id: project.id,
        kind,
        phase: effectivePhase,
        content,
        instructions,
        status: content.trim() ? 'redige' : 'a_rediger',
      };

  const exportNotice = async (format: 'pdf' | 'docx') => {
    if (!content.trim()) return;
    setExporting(format);
    setMessage(null);
    try {
      await save(true);
      const notice = noticeForExport();
      if (format === 'pdf') {
        await exportProjectNoticePdf(project, notice, settings as AgencySettings);
      } else {
        await exportProjectNoticeDocx(project, notice, settings as AgencySettings);
      }
    } catch (error: any) {
      setMessage({ text: error?.message || t('projectnotice_export_error'), tone: 'error' });
    } finally {
      setExporting(null);
    }
  };

  const kindLabel = (value: ProjectNoticeKind) => t(`projectnotice_kind_${value}`);
  const title = projectNoticeTitle(kind, effectivePhase);

  return (
    <div className="space-y-4 mt-4">
      <div
        className="rounded-lg border p-4 md:p-5"
        style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <IconFileDescription size={20} style={{ color: 'var(--tblr-primary)' }} />
              <h2 className="font-bold text-lg" style={{ color: 'var(--tblr-text)' }}>{t('projectnotice_title')}</h2>
            </div>
            <p className="mt-1 text-sm max-w-3xl" style={{ color: 'var(--tblr-muted)' }}>{t('projectnotice_intro')}</p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || generating}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              <IconDeviceFloppy size={15} />
              {saving ? t('projectnotice_saving') : t('projectnotice_save')}
            </button>
            <button
              type="button"
              onClick={() => void exportNotice('pdf')}
              disabled={!content.trim() || !!exporting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              <IconDownload size={15} /> PDF
            </button>
            <button
              type="button"
              onClick={() => void exportNotice('docx')}
              disabled={!content.trim() || !!exporting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              <IconDownload size={15} /> Word
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-4">
        <aside
          className="rounded-lg border p-3 space-y-4"
          style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
        >
          <div>
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>
              {t('projectnotice_document_type')}
            </div>
            <div className="space-y-1">
              {NOTICE_KINDS.map(value => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setKind(value)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors',
                    kind === value ? 'bg-[var(--tblr-primary-lt)]' : 'hover:bg-[var(--tblr-surface-2)]',
                  )}
                  style={{ color: kind === value ? 'var(--tblr-primary)' : 'var(--tblr-text)' }}
                >
                  {kindLabel(value)}
                </button>
              ))}
            </div>
          </div>

          {kind === 'architectural' && (
            <div className="pt-3 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
              <div className="text-[0.6875rem] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>
                {t('projectnotice_phase')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {architecturalPhases.map(value => {
                  const exists = notices.some(n => n.kind === 'architectural' && n.phase === value && !!n.content?.trim());
                  return (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setPhase(value)}
                      className="px-2.5 py-1.5 rounded-lg border text-xs font-bold"
                      style={{
                        borderColor: phase === value ? 'var(--tblr-primary)' : 'var(--tblr-border)',
                        color: phase === value ? 'var(--tblr-primary)' : 'var(--tblr-muted)',
                        background: phase === value ? 'var(--tblr-primary-lt)' : 'transparent',
                      }}
                    >
                      {value}{exists ? ' •' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="pt-3 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>
              {t('projectnotice_tools')}
            </div>
            <button
              type="button"
              onClick={insertOutline}
              disabled={!!content.trim()}
              title={content.trim() ? t('projectnotice_outline_disabled') : undefined}
              className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold disabled:opacity-45"
              style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              <IconListDetails size={15} />
              {t('projectnotice_outline')}
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!isEnterprise || generating || saving}
              className="mt-2 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--tblr-primary)' }}
              title={!isEnterprise ? t('projectnotice_ai_enterprise_only') : undefined}
            >
              <IconSparkles size={15} />
              {generating ? t('projectnotice_generating') : current?.generated_at ? t('projectnotice_regenerate') : t('projectnotice_generate')}
            </button>
            {!isEnterprise && (
              <p className="mt-2 text-[0.6875rem] leading-relaxed" style={{ color: 'var(--tblr-muted)' }}>
                {t('projectnotice_ai_enterprise_only')}
              </p>
            )}
          </div>
        </aside>

        <main
          className="rounded-lg border overflow-hidden"
          style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
        >
          <div className="p-4 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="font-bold text-base" style={{ color: 'var(--tblr-text)' }}>{title}</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{t('projectnotice_source_hint')}</p>
              </div>
              {current?.updated_at && (
                <span className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
                  {t('projectnotice_updated_at', { date: new Date(current.updated_at).toLocaleString('fr-FR') })}
                </span>
              )}
            </div>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <label htmlFor="project-notice-instructions" className="block text-[0.6875rem] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--tblr-muted)' }}>
                {t('projectnotice_instructions')}
              </label>
              <textarea
                id="project-notice-instructions"
                rows={2}
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                placeholder={t('projectnotice_instructions_placeholder')}
                className="w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)' }}
              />
            </div>

            <div>
              <label htmlFor="project-notice-content" className="block text-[0.6875rem] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--tblr-muted)' }}>
                {t('projectnotice_content')}
              </label>
              {loading ? (
                <div className="min-h-[360px] rounded-lg border flex items-center justify-center text-sm" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
                  {t('projectnotice_loading')}
                </div>
              ) : (
                <textarea
                  id="project-notice-content"
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder={t('projectnotice_content_placeholder')}
                  className="w-full min-h-[520px] rounded-lg border p-4 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-blue-500 resize-y font-[inherit]"
                  style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
                />
              )}
            </div>

            {message && (
              <div
                role={message.tone === 'error' ? 'alert' : 'status'}
                className="rounded-lg px-3 py-2 text-xs font-medium"
                style={{
                  background: message.tone === 'error' ? 'var(--tblr-danger-lt)' : 'var(--tblr-success-lt)',
                  color: message.tone === 'error' ? 'var(--tblr-danger)' : 'var(--tblr-success)',
                }}
              >
                {message.text}
              </div>
            )}

            <div className="flex gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
              <IconAlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--tblr-warning)' }} />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--tblr-muted)' }}>{t('projectnotice_caution')}</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
