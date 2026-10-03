import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconChevronDown,
  IconChevronRight,
  IconAlertTriangle,
  IconFilePlus,
  IconTrash,
  IconFlag,
  IconPlus,
  IconReceipt,
  IconMail,
  IconFileInvoice,
  IconDots,
  IconEdit,
  IconBuilding,
  IconCalendarEvent,
  IconCheck,
} from '@tabler/icons-react';
import { formatCurrency } from '../../lib/utils';
import { useTasks } from '../../hooks/useTasks';
import { getTaskStatus, taskDeadline } from '../tasks/taskDisplay';
import type { Project, Milestone, Permit, ProjectPhaseHistoryEntry, DocumentPhase } from '../../types';
import type { PhaseNotesApi } from '../../hooks/usePhaseNotes';
import { PhaseJournal } from './PhaseJournal';



/** Libellé d'un type d'autorisation : PC en toutes lettres, les autres sigles tels quels. */
function permitTypeLabel(type: string): string {
  return type === 'PC' ? 'permis de construire' : type;
}

function formatMonthLabel(dateStr: string) {
  const label = new Date(dateStr).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function activityGlyph(action: string) {
  if (/création/i.test(action)) return { Icon: IconFilePlus, bg: 'var(--tblr-primary-lt)', fg: 'var(--tblr-primary)' };
  if (/suppression/i.test(action)) return { Icon: IconTrash, bg: '#fee2e2', fg: '#dc2626' };
  if (/phase/i.test(action)) return { Icon: IconFlag, bg: 'var(--tblr-primary-lt)', fg: 'var(--tblr-primary)' };
  return { Icon: IconFlag, bg: 'var(--tblr-surface-2)', fg: 'var(--tblr-muted)' };
}

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({ title, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="py-2.5 border-t" style={{ borderColor: 'var(--tblr-border)' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between"
      >
        <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{title}</span>
        {open ? <IconChevronDown size={13} style={{ color: 'var(--tblr-muted)' }} /> : <IconChevronRight size={13} style={{ color: 'var(--tblr-muted)' }} />}
      </button>
      {open && <div className="mt-2.5 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

function InfoRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span style={{ color: 'var(--tblr-muted)' }}>{k}</span>
      <span className="font-mono text-right" style={{ color: 'var(--tblr-text)' }}>{v}</span>
    </div>
  );
}

export interface ProjectOverviewProps {
  project: Project;
  setProject: React.Dispatch<React.SetStateAction<Project | null>>;
  phaseHistory: ProjectPhaseHistoryEntry[];
  projectActivity: any[];
  projectMembers: any[];
  permits: Permit[];
  milestones: Milestone[];
  onOpenFullEditor: () => void;
  onAddMilestone: () => void;
  onToggleMilestone: (milestone: Milestone) => void;
  newMilestoneTitle: string;
  setNewMilestoneTitle: (v: string) => void;
  newMilestoneDate: string;
  setNewMilestoneDate: (v: string) => void;
  isAddingMilestone: boolean;
  setIsAddingMilestone: (v: boolean) => void;
  onGoToInvoices: () => void;
  /** Phase whose notes should be shown in Column C — distinct from the
   *  project's actual current phase, set by the topbar phase pills without
   *  mutating the real mission phase. Falls back to the actual current
   *  phase when unset. */
  notePhase?: DocumentPhase;
  /** Journal de l'opération (usePhaseNotes) et phases de la mission, dans l'ordre du stepper. */
  phaseNotes: PhaseNotesApi;
  journalPhases: string[];
}

export function ProjectOverview({
  project, setProject, phaseHistory, projectActivity, projectMembers, permits, milestones,
  onOpenFullEditor, onAddMilestone, onToggleMilestone,
  newMilestoneTitle, setNewMilestoneTitle, newMilestoneDate, setNewMilestoneDate,
  isAddingMilestone, setIsAddingMilestone, onGoToInvoices, notePhase, phaseNotes, journalPhases,
}: ProjectOverviewProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  // The project's actual current phase (Column A badge) — never changed by
  // the topbar pills, only by the real phase picker in the full editor.
  const currentPhase: DocumentPhase = (phaseHistory.find(p => !p.exited_at)?.phase as DocumentPhase) || 'ESQ';
  // The phase whose notes Column C displays/edits — may differ from the
  // above while the user is just browsing phase notes via the topbar pills.
  const viewedPhase: DocumentPhase = notePhase || currentPhase;
  const pendingPermit = useMemo(() => permits.find(p => p.status === 'en_instruction'), [permits]);
  const nextMilestone = useMemo(() => {
    // Un jalon sans date (ou à date illisible) n'est pas une échéance : il
    // afficherait « Invalid Date ».
    const hasDate = (m: Milestone) => !!m.due_date && !Number.isNaN(new Date(m.due_date).getTime());
    const upcoming = milestones.filter(m => !m.completed && hasDate(m)).sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
    return upcoming[0];
  }, [milestones]);
  const sortedMilestones = useMemo(
    () => [...milestones].sort((a, b) => Number(a.completed) - Number(b.completed) || new Date(a.due_date).getTime() - new Date(b.due_date).getTime()),
    [milestones]
  );
  const activityGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const a of projectActivity) {
      const key = formatMonthLabel(a.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return [...map.entries()].map(([label, entries]) => ({ label, entries }));
  }, [projectActivity]);
  // Prochaines tâches : celles de CETTE opération, non terminées, l'échéance
  // la plus proche d'abord (sans échéance en dernier).
  const { tasks } = useTasks({ projectId: project.id });
  const upcomingTasks = useMemo(() => {
    const time = (task: (typeof tasks)[number]) => {
      const d = taskDeadline(task);
      return d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;
    };
    return tasks
      .filter(task => getTaskStatus(task) !== 'done')
      .sort((a, b) => time(a) - time(b))
      .slice(0, 5);
  }, [tasks]);
  const daysToDeadline = project.end_date ? Math.ceil((new Date(project.end_date).getTime() - Date.now()) / 86400000) : null;

  // Observations d'avant le journal, tant que la migration ne les a pas
  // reprises (instance non migrée) : montrées en lecture, jamais perdues.
  const legacyObservations = phaseNotes.loading || phaseNotes.notes.some(n => n.id.startsWith('legacy-'))
    ? []
    : ([['etudes', project.etudes_notes], ['chantier', project.chantier_notes]] as const)
        .filter(([, text]) => text && text.trim());

  return (
    <div className="flex flex-col xl:h-full xl:flex-row overflow-visible xl:overflow-hidden" style={{ background: 'var(--tblr-bg)' }}>

      {/* ── Column A — identity / admin ───────────────────────────── */}
      <div
        className="w-full xl:w-[280px] xl:shrink-0 border-b xl:border-b-0 xl:border-r overflow-visible xl:overflow-y-auto p-4"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
      >
        <div className="flex items-start gap-3 mb-3">
          {project.image_url ? (
            <img
              src={project.image_url}
              alt={project.name}
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-lg object-cover shrink-0"
              style={{ border: '1px solid var(--tblr-border)' }}
            />
          ) : (
            <div
              className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center"
              style={{ background: 'var(--tblr-surface-2)' }}
            >
              <IconBuilding size={20} style={{ color: 'var(--tblr-muted)' }} />
            </div>
          )}
          <div className="min-w-0 pt-0.5">
            <div className="font-bold text-base leading-tight mb-0.5 truncate" style={{ color: 'var(--tblr-text)' }}>{project.name}</div>
            <div className="text-[0.8125rem] mb-0.5 truncate" style={{ color: 'var(--tblr-muted)' }}>{project.client}</div>
            {project.address && <div className="font-mono text-[0.6875rem] truncate" style={{ color: 'var(--tblr-muted)' }}>{project.address}</div>}
          </div>
        </div>

        <div className="flex gap-1.5 flex-wrap mb-3.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[0.6875rem] font-semibold" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
            {t('project_overview_phase_badge', { phase: currentPhase })}
          </span>
          {project.category && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[0.6875rem] font-semibold" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)' }}>
              {project.category}
            </span>
          )}
        </div>

        {pendingPermit && (
          <div
            role="status"
            className="flex gap-2 p-2.5 mb-4 rounded-lg border"
            style={{
              // Teinte d'avertissement tirée du jeton, pour suivre le thème sombre.
              background: 'color-mix(in srgb, var(--tblr-warning) 10%, var(--tblr-surface))',
              borderColor: 'color-mix(in srgb, var(--tblr-warning) 35%, var(--tblr-surface))',
            }}
          >
            <IconAlertTriangle size={16} className="shrink-0" aria-hidden style={{ color: 'var(--tblr-warning)' }} />
            <div className="text-xs leading-snug" style={{ color: 'var(--tblr-text)' }}>
              {pendingPermit.reference
                ? t('project_overview_permit_pending_ref', { type: permitTypeLabel(pendingPermit.type), ref: pendingPermit.reference })
                : t('project_overview_permit_pending', { type: permitTypeLabel(pendingPermit.type) })}{' '}
              <button type="button" className="underline underline-offset-2 font-medium" onClick={() => navigate('/documents')}>{t('project_overview_permit_open_documents')}</button>
            </div>
          </div>
        )}

        <CollapsibleSection title={t('project_overview_section_mission')} defaultOpen>
          <InfoRow k={t('project_overview_mission_type')} v={project.is_complete_mission ? t('project_overview_mission_complete') : t('project_overview_mission_partial')} />
          {project.project_manager && <InfoRow k={t('project_overview_project_manager')} v={project.project_manager} />}
          {nextMilestone && <InfoRow k={t('project_overview_next_deadline')} v={new Date(nextMilestone.due_date).toLocaleDateString('fr-FR')} />}
        </CollapsibleSection>

        <CollapsibleSection title={t('project_overview_section_admin')} defaultOpen>
          {(project.reference || project.project_code) && <InfoRow k={t('project_overview_reference')} v={project.reference || project.project_code} />}
          {!!project.construction_cost && <InfoRow k={t('project_overview_works_budget_ht')} v={formatCurrency(Number(project.construction_cost))} />}
          {!!project.surface && <InfoRow k={t('project_overview_surface')} v={`${project.surface} m²`} />}
          <InfoRow k={t('project_overview_permit')} v={permits.length === 0 ? t('project_overview_permit_none') : t(`project_permit_status_${(pendingPermit ?? permits[permits.length - 1]).status}`)} />
        </CollapsibleSection>

        <CollapsibleSection title={t('project_overview_section_context')} defaultOpen={false}>
          <InfoRow k={t('project_overview_sector')} v={project.secteur_abf || t('project_overview_not_set')} />
          <InfoRow k={t('project_overview_property_type')} v={project.type_projet || project.categorie_projet || t('project_overview_not_set')} />
          <InfoRow k={t('project_overview_programme')} v={project.programme ? (project.programme.length > 28 ? project.programme.slice(0, 28) + '…' : project.programme) : t('project_overview_not_set')} />
        </CollapsibleSection>

        {projectMembers.length > 0 && (
          <CollapsibleSection title={t('project_overview_section_team', { count: projectMembers.length })} defaultOpen={false}>
            {projectMembers.slice(0, 6).map(m => (
              <InfoRow key={m.id || m.user_id} k={m.role || t('project_overview_team_member')} v={m.name || m.email} />
            ))}
          </CollapsibleSection>
        )}

        <button
          type="button"
          onClick={onOpenFullEditor}
          className="w-full mt-3 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border transition-colors hover:bg-[var(--tblr-surface-2)]"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          <IconEdit size={13} /> {t('project_overview_edit_full')}
        </button>
      </div>

      {/* ── Column B — historique ──────────────────────────────────── */}
      <div
        className="w-full xl:w-[320px] xl:shrink-0 border-b xl:border-b-0 xl:border-r overflow-visible xl:overflow-y-auto p-4"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
      >
        <div className="font-bold text-base mb-3" style={{ color: 'var(--tblr-text)' }}>{t('project_overview_history_title')}</div>
        {activityGroups.length === 0 && (
          <p className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_history_empty')}</p>
        )}
        {activityGroups.map(grp => (
          <div key={grp.label} className="mb-4">
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>{grp.label}</div>
            {grp.entries.map(ev => {
              const { Icon, bg, fg } = activityGlyph(ev.action || '');
              return (
                <div key={ev.id} className="flex gap-2.5 py-2 border-t" style={{ borderColor: 'var(--tblr-surface-2)' }}>
                  <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: bg, color: fg }}>
                    <Icon size={12} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[0.8125rem] font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{ev.action}</div>
                    {ev.user_name && <div className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{ev.user_name}</div>}
                  </div>
                  <div className="font-mono text-[0.6875rem] whitespace-nowrap shrink-0" style={{ color: 'var(--tblr-muted)' }}>
                    {new Date(ev.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Column C — note de phase ───────────────────────────────── */}
      <div
        className="w-full xl:flex-1 xl:min-w-[380px] border-b xl:border-b-0 xl:border-r overflow-visible xl:overflow-y-auto p-4 xl:p-6"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
      >
        <PhaseJournal
          api={phaseNotes}
          phases={journalPhases}
          viewedPhase={viewedPhase}
          phaseLabel={phase => t(`mission_phase_${phase}`)}
          defaultBudget={project.construction_cost ?? null}
        />

        {legacyObservations.map(([family, text]) => (
          <div key={family} className="mb-5 p-3 rounded-lg border" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
            <div className="text-[0.6875rem] font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>{t(`phase_journal_legacy_${family}`)}</div>
            <p className="text-[0.8125rem] leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--tblr-text)' }}>{text}</p>
          </div>
        ))}

        <h2 className="font-bold text-base mb-3 pt-4 border-t" style={{ color: 'var(--tblr-text)', borderColor: 'var(--tblr-border)' }}>
          {t('phase_journal_project_section')}
        </h2>

        <div className="mb-4">
          <label htmlFor={`${project.id}-objet`} className="block text-[0.6875rem] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_objet')}</label>
          <textarea
            id={`${project.id}-objet`}
            className="w-full border rounded-lg p-2.5 text-[0.8125rem] outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)' }}
            rows={2}
            value={project.description || ''}
            onChange={e => setProject(prev => prev ? ({ ...prev, description: e.target.value }) : null)}
            placeholder={t('project_overview_objet_placeholder')}
          />
        </div>

        <div className="mb-4">
          <label htmlFor={`${project.id}-programme`} className="block text-[0.6875rem] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_programme_constraints')}</label>
          <textarea
            id={`${project.id}-programme`}
            className="w-full border rounded-lg p-2.5 text-[0.8125rem] leading-relaxed outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)', minHeight: 76 }}
            value={project.programme || ''}
            onChange={e => setProject(prev => prev ? ({ ...prev, programme: e.target.value }) : null)}
            placeholder={t('project_overview_programme_placeholder')}
          />
        </div>

        <h3 className="text-[0.6875rem] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_data')}</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <div className="text-[0.6875rem] mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_surface_sdp')}</div>
            <div className="flex items-baseline gap-1 border-b pb-1" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="font-mono text-base font-semibold" style={{ color: 'var(--tblr-text)' }}>{project.surface || t('project_overview_not_set')}</span>
              <span className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>m²</span>
            </div>
          </div>
          <div>
            <div className="text-[0.6875rem] mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_works_budget')}</div>
            <div className="flex items-baseline gap-1 border-b pb-1" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="font-mono text-base font-semibold" style={{ color: 'var(--tblr-text)' }}>{project.construction_cost ? formatCurrency(Number(project.construction_cost)) : t('project_overview_not_set')}</span>
            </div>
          </div>
          <div>
            <div className="text-[0.6875rem] mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_progress')}</div>
            <div className="flex items-baseline gap-1 border-b pb-1" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="font-mono text-base font-semibold" style={{ color: 'var(--tblr-text)' }}>{project.progression ?? 0}</span>
              <span className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>%</span>
            </div>
          </div>
          <div>
            <div className="text-[0.6875rem] mb-1" style={{ color: 'var(--tblr-muted)' }}>{daysToDeadline !== null && daysToDeadline < 0 ? t('project_overview_delay') : t('project_overview_deadline')}</div>
            <div className="flex items-baseline gap-1 border-b pb-1" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="font-mono text-base font-semibold" style={{ color: 'var(--tblr-text)' }}>{daysToDeadline === null ? t('project_overview_not_set') : Math.abs(daysToDeadline)}</span>
              <span className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_days')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Column D — plan d'actions ──────────────────────────────── */}
      <div className="w-full xl:w-[260px] xl:shrink-0 overflow-visible xl:overflow-y-auto p-4" style={{ background: 'var(--tblr-surface)' }}>
        <div className="font-bold text-base mb-3.5" style={{ color: 'var(--tblr-text)' }}>{t('project_overview_action_plan')}</div>
        <div className="grid grid-cols-2 gap-2 mb-5">
          <button
            type="button"
            onClick={() => navigate('/proposals')}
            className="flex flex-col items-center gap-1.5 py-2.5 px-1.5 rounded-lg border text-center transition-colors hover:bg-[var(--tblr-surface-2)]"
            style={{ borderColor: 'var(--tblr-border)' }}
          >
            <IconReceipt size={17} style={{ color: 'var(--tblr-muted)' }} />
            <span className="text-[0.6875rem] font-medium leading-tight" style={{ color: 'var(--tblr-text)' }}>{t('project_overview_action_proposal')}</span>
          </button>
          <button
            type="button"
            onClick={() => navigate(`/document_templates?project=${encodeURIComponent(project.id)}`)}
            className="flex flex-col items-center gap-1.5 py-2.5 px-1.5 rounded-lg border text-center transition-colors hover:bg-[var(--tblr-surface-2)]"
            style={{ borderColor: 'var(--tblr-border)' }}
          >
            <IconMail size={17} style={{ color: 'var(--tblr-muted)' }} />
            <span className="text-[0.6875rem] font-medium leading-tight" style={{ color: 'var(--tblr-text)' }}>{t('project_overview_action_letter')}</span>
          </button>
          <button
            type="button"
            onClick={() => navigate(`/reunions?parent=project:${encodeURIComponent(project.id)}&new=1`)}
            className="flex flex-col items-center gap-1.5 py-2.5 px-1.5 rounded-lg border text-center transition-colors hover:bg-[var(--tblr-surface-2)]"
            style={{ borderColor: 'var(--tblr-border)' }}
          >
            <IconCalendarEvent size={17} style={{ color: 'var(--tblr-muted)' }} />
            <span className="text-[0.6875rem] font-medium leading-tight" style={{ color: 'var(--tblr-text)' }}>{t('project_overview_action_meeting')}</span>
          </button>
          <button
            type="button"
            onClick={onGoToInvoices}
            title={t('project_overview_action_fees_title')}
            className="flex flex-col items-center gap-1.5 py-2.5 px-1.5 rounded-lg border text-center transition-colors hover:bg-[var(--tblr-surface-2)]"
            style={{ borderColor: 'var(--tblr-border)' }}
          >
            <IconFileInvoice size={17} style={{ color: 'var(--tblr-muted)' }} />
            <span className="text-[0.6875rem] font-medium leading-tight" style={{ color: 'var(--tblr-text)' }}>{t('project_overview_action_fees')}</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/documents')}
            className="flex flex-col items-center gap-1.5 py-2.5 px-1.5 rounded-lg border text-center transition-colors hover:bg-[var(--tblr-surface-2)]"
            style={{ borderColor: 'var(--tblr-border)' }}
          >
            <IconDots size={17} style={{ color: 'var(--tblr-muted)' }} />
            <span className="text-[0.6875rem] font-medium leading-tight" style={{ color: 'var(--tblr-text)' }}>{t('project_overview_action_documents')}</span>
          </button>
        </div>

        <div className="text-[0.6875rem] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_next_tasks')}</div>

        {isAddingMilestone && (
          <div className="mb-3 p-3 rounded-lg border space-y-2" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
            <input
              type="text"
              className="w-full border rounded-lg p-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
              aria-label={t('project_overview_milestone_title')}
              placeholder={t('project_overview_milestone_title')}
              value={newMilestoneTitle}
              onChange={e => setNewMilestoneTitle(e.target.value)}
            />
            <input
              type="date"
              className="w-full border rounded-lg p-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
              aria-label={t('project_overview_milestone_date')}
              value={newMilestoneDate}
              onChange={e => setNewMilestoneDate(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsAddingMilestone(false)} className="px-2.5 py-1.5 text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('projectdetail_dialog_cancel')}</button>
              <button type="button" onClick={onAddMilestone} className="px-3 py-1.5 rounded-lg text-[0.6875rem] font-semibold text-white" style={{ background: 'var(--tblr-primary)' }}>{t('project_overview_milestone_add')}</button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          {sortedMilestones.length === 0 && (
            <p className="text-xs italic py-2" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_no_tasks')}</p>
          )}
          {sortedMilestones.map(m => (
            <button
              type="button"
              key={m.id}
              role="checkbox"
              aria-checked={!!m.completed}
              onClick={() => onToggleMilestone(m)}
              className="w-full flex items-start gap-2 py-1.5 pointer-coarse:py-2.5 border-t text-left rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              style={{ borderColor: 'var(--tblr-surface-2)' }}
            >
              <span
                aria-hidden
                className="w-4 h-4 mt-0.5 shrink-0 flex items-center justify-center text-white rounded-sm border"
                style={{ borderColor: m.completed ? 'var(--tblr-primary)' : 'var(--tblr-border)', background: m.completed ? 'var(--tblr-primary)' : 'transparent' }}
              >
                {m.completed && <IconCheck size={12} stroke={3} />}
              </span>
              <span
                className="text-[0.8125rem] leading-snug"
                style={{ color: m.completed ? 'var(--tblr-muted)' : 'var(--tblr-text)', textDecoration: m.completed ? 'line-through' : 'none' }}
              >
                {m.title}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setIsAddingMilestone(true)}
          className="w-full flex items-center gap-1.5 mt-2.5 pt-2.5 border-t text-xs"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
        >
          <IconPlus size={14} style={{ color: 'var(--tblr-primary)' }} />
          {t('project_overview_add_task')}
        </button>

        <div className="text-[0.6875rem] font-bold uppercase tracking-wider mt-5 mb-2.5" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_upcoming_tasks')}</div>
        <div className="flex flex-col gap-0.5">
          {upcomingTasks.length === 0 && (
            <p className="text-xs italic py-2" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_no_upcoming_tasks')}</p>
          )}
          {upcomingTasks.map(task => {
            const deadline = taskDeadline(task);
            const late = !!deadline && new Date(deadline).getTime() < Date.now();
            return (
              <button
                type="button"
                key={task.id}
                onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}?tab=TACHES`)}
                className="w-full flex items-start justify-between gap-2 py-1.5 border-t text-left rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                style={{ borderColor: 'var(--tblr-surface-2)' }}
              >
                <span className="text-[0.8125rem] leading-snug" style={{ color: 'var(--tblr-text)' }}>{task.title}</span>
                {deadline && (
                  <span className="font-mono text-[0.6875rem] whitespace-nowrap shrink-0 mt-0.5" style={{ color: late ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}>
                    {new Date(deadline).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
