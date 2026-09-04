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
} from '@tabler/icons-react';
import { formatCurrency } from '../../lib/utils';
import type { Project, Milestone, Permit, ProjectPhaseHistoryEntry, DocumentPhase } from '../../types';

const PHASE_LABELS: Record<string, string> = {
  ESQ: 'Esquisse', APS: 'Avant-projet sommaire', APD: 'Avant-projet détaillé', PC: 'Permis de construire',
  PRO: 'Projet', DCE: 'Consultation entreprises', ACT: 'Assistance contrats travaux', VISA: 'Visa',
  DET: 'Direction exécution travaux', AOR: 'Assistance réception',
};
const CHANTIER_PHASES = new Set(['ACT', 'VISA', 'DET', 'AOR']);

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
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{title}</span>
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
}

export function ProjectOverview({
  project, setProject, phaseHistory, projectActivity, projectMembers, permits, milestones,
  onOpenFullEditor, onAddMilestone, onToggleMilestone,
  newMilestoneTitle, setNewMilestoneTitle, newMilestoneDate, setNewMilestoneDate,
  isAddingMilestone, setIsAddingMilestone, onGoToInvoices, notePhase,
}: ProjectOverviewProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  // The project's actual current phase (Column A badge) — never changed by
  // the topbar pills, only by the real phase picker in the full editor.
  const currentPhase: DocumentPhase = (phaseHistory.find(p => !p.exited_at)?.phase as DocumentPhase) || 'ESQ';
  // The phase whose notes Column C displays/edits — may differ from the
  // above while the user is just browsing phase notes via the topbar pills.
  const viewedPhase: DocumentPhase = notePhase || currentPhase;
  const isChantierPhase = CHANTIER_PHASES.has(viewedPhase);
  const pendingPermit = useMemo(() => permits.find(p => p.status === 'en_instruction'), [permits]);
  const nextMilestone = useMemo(() => {
    const upcoming = milestones.filter(m => !m.completed).sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
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
  const daysToDeadline = project.end_date ? Math.ceil((new Date(project.end_date).getTime() - Date.now()) / 86400000) : null;

  const observationsField: 'etudes_notes' | 'chantier_notes' = isChantierPhase ? 'chantier_notes' : 'etudes_notes';

  return (
    <div className="flex flex-col lg:h-full lg:flex-row overflow-visible lg:overflow-hidden" style={{ background: 'var(--tblr-bg)' }}>

      {/* ── Column A — identity / admin ───────────────────────────── */}
      <div
        className="w-full lg:w-[280px] lg:shrink-0 border-b lg:border-b-0 lg:border-r overflow-visible lg:overflow-y-auto p-4"
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
            <div className="font-bold text-[15px] leading-tight mb-0.5 truncate" style={{ color: 'var(--tblr-text)' }}>{project.name}</div>
            <div className="text-[13px] mb-0.5 truncate" style={{ color: 'var(--tblr-muted)' }}>{project.client}</div>
            {project.address && <div className="font-mono text-[11px] truncate" style={{ color: 'var(--tblr-muted)' }}>{project.address}</div>}
          </div>
        </div>

        <div className="flex gap-1.5 flex-wrap mb-3.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
            Phase {currentPhase}
          </span>
          {project.category && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)' }}>
              {project.category}
            </span>
          )}
        </div>

        {pendingPermit && (
          <div className="flex gap-2 p-2.5 mb-4 rounded-lg border" style={{ background: '#fef3c7', borderColor: '#fde68a' }}>
            <IconAlertTriangle size={16} className="shrink-0" style={{ color: '#92400e' }} />
            <div className="text-xs leading-snug" style={{ color: '#92400e' }}>
              {pendingPermit.type === 'PC' ? 'Permis de construire' : pendingPermit.type} en instruction
              {pendingPermit.reference ? ` (${pendingPermit.reference})` : ''}.{' '}
              <span className="underline cursor-pointer" onClick={() => navigate('/documents')}>Voir dans Documents</span>.
            </div>
          </div>
        )}

        <CollapsibleSection title="Mission en cours" defaultOpen>
          <InfoRow k="Type de mission" v={project.is_complete_mission ? 'Mission complète' : 'Mission partielle'} />
          {project.project_manager && <InfoRow k="Chef de projet" v={project.project_manager} />}
          {nextMilestone && <InfoRow k="Prochaine échéance" v={new Date(nextMilestone.due_date).toLocaleDateString('fr-FR')} />}
        </CollapsibleSection>

        <CollapsibleSection title="Infos administratives" defaultOpen>
          {(project.reference || project.project_code) && <InfoRow k="Référence" v={project.reference || project.project_code} />}
          {!!project.construction_cost && <InfoRow k="Budget travaux HT" v={formatCurrency(Number(project.construction_cost))} />}
          {!!project.surface && <InfoRow k="Surface" v={`${project.surface} m²`} />}
          <InfoRow k="Permis" v={permits.length === 0 ? 'Aucun' : (pendingPermit ? 'En instruction' : permits[permits.length - 1].status)} />
        </CollapsibleSection>

        <CollapsibleSection title="Contexte & programme" defaultOpen={false}>
          <InfoRow k="Secteur" v={project.secteur_abf || '—'} />
          <InfoRow k="Type de bien" v={project.type_projet || project.categorie_projet || '—'} />
          <InfoRow k="Programme" v={project.programme ? (project.programme.length > 28 ? project.programme.slice(0, 28) + '…' : project.programme) : '—'} />
        </CollapsibleSection>

        {projectMembers.length > 0 && (
          <CollapsibleSection title={`Équipe (${projectMembers.length})`} defaultOpen={false}>
            {projectMembers.slice(0, 6).map(m => (
              <InfoRow key={m.id || m.user_id} k={m.role || 'member'} v={m.name || m.email} />
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
        className="w-full lg:w-[320px] lg:shrink-0 border-b lg:border-b-0 lg:border-r overflow-visible lg:overflow-y-auto p-4"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
      >
        <div className="font-bold text-[15px] mb-3" style={{ color: 'var(--tblr-text)' }}>{t('project_overview_history_title')}</div>
        {activityGroups.length === 0 && (
          <p className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_history_empty')}</p>
        )}
        {activityGroups.map(grp => (
          <div key={grp.label} className="mb-4">
            <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>{grp.label}</div>
            {grp.entries.map(ev => {
              const { Icon, bg, fg } = activityGlyph(ev.action || '');
              return (
                <div key={ev.id} className="flex gap-2.5 py-2 border-t" style={{ borderColor: 'var(--tblr-surface-2)' }}>
                  <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: bg, color: fg }}>
                    <Icon size={12} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{ev.action}</div>
                    {ev.user_name && <div className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{ev.user_name}</div>}
                  </div>
                  <div className="font-mono text-[10.5px] whitespace-nowrap shrink-0" style={{ color: 'var(--tblr-muted)' }}>
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
        className="w-full lg:flex-1 lg:min-w-[380px] border-b lg:border-b-0 lg:border-r overflow-visible lg:overflow-y-auto p-4 lg:p-6"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
      >
        <div className="font-bold text-base mb-4" style={{ color: 'var(--tblr-text)' }}>
          Note de phase — {PHASE_LABELS[viewedPhase] || viewedPhase}
        </div>

        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Objet</label>
          <textarea
            className="w-full border rounded-lg p-2.5 text-[13px] outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)' }}
            rows={2}
            value={project.description || ''}
            onChange={e => setProject(prev => prev ? ({ ...prev, description: e.target.value }) : null)}
            placeholder="Objet de la mission…"
          />
        </div>

        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Programme &amp; contraintes</label>
          <textarea
            className="w-full border rounded-lg p-2.5 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)', minHeight: 76 }}
            value={project.programme || ''}
            onChange={e => setProject(prev => prev ? ({ ...prev, programme: e.target.value }) : null)}
            placeholder="Contraintes du programme, secteur, servitudes…"
          />
        </div>

        <div className="mb-5">
          <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--tblr-muted)' }}>
            Observations {isChantierPhase ? 'de chantier' : 'de visite'}
          </label>
          <textarea
            className="w-full border rounded-lg p-2.5 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)', minHeight: 60 }}
            value={project[observationsField] || ''}
            onChange={e => setProject(prev => prev ? ({ ...prev, [observationsField]: e.target.value }) : null)}
            placeholder="Observations…"
          />
        </div>

        <label className="block text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>Données du projet</label>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--tblr-muted)' }}>Surface SDP</div>
            <div className="flex items-baseline gap-1 border-b pb-1" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="font-mono text-[15px] font-semibold" style={{ color: 'var(--tblr-text)' }}>{project.surface || '—'}</span>
              <span className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>m²</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--tblr-muted)' }}>Budget travaux</div>
            <div className="flex items-baseline gap-1 border-b pb-1" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="font-mono text-[15px] font-semibold" style={{ color: 'var(--tblr-text)' }}>{project.construction_cost ? formatCurrency(Number(project.construction_cost)) : '—'}</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--tblr-muted)' }}>Avancement</div>
            <div className="flex items-baseline gap-1 border-b pb-1" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="font-mono text-[15px] font-semibold" style={{ color: 'var(--tblr-text)' }}>{project.progression ?? 0}</span>
              <span className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>%</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--tblr-muted)' }}>{daysToDeadline !== null && daysToDeadline < 0 ? 'Retard' : 'Échéance'}</div>
            <div className="flex items-baseline gap-1 border-b pb-1" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="font-mono text-[15px] font-semibold" style={{ color: 'var(--tblr-text)' }}>{daysToDeadline === null ? '—' : Math.abs(daysToDeadline)}</span>
              <span className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>jours</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Column D — plan d'actions ──────────────────────────────── */}
      <div className="w-full lg:w-[260px] lg:shrink-0 overflow-visible lg:overflow-y-auto p-4" style={{ background: 'var(--tblr-surface)' }}>
        <div className="font-bold text-[15px] mb-3.5" style={{ color: 'var(--tblr-text)' }}>{t('project_overview_action_plan')}</div>
        <div className="grid grid-cols-2 gap-2 mb-5">
          <button
            type="button"
            onClick={() => navigate('/proposals')}
            className="flex flex-col items-center gap-1.5 py-2.5 px-1.5 rounded-lg border text-center transition-colors hover:bg-[var(--tblr-surface-2)]"
            style={{ borderColor: 'var(--tblr-border)' }}
          >
            <IconReceipt size={17} style={{ color: 'var(--tblr-muted)' }} />
            <span className="text-[10.5px] font-medium leading-tight" style={{ color: 'var(--tblr-text)' }}>Devis</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/document_templates')}
            className="flex flex-col items-center gap-1.5 py-2.5 px-1.5 rounded-lg border text-center transition-colors hover:bg-[var(--tblr-surface-2)]"
            style={{ borderColor: 'var(--tblr-border)' }}
          >
            <IconMail size={17} style={{ color: 'var(--tblr-muted)' }} />
            <span className="text-[10.5px] font-medium leading-tight" style={{ color: 'var(--tblr-text)' }}>Courrier</span>
          </button>
          <button
            type="button"
            disabled={!project.is_chantier}
            onClick={onGoToInvoices}
            title={project.is_chantier ? undefined : 'Activez le suivi chantier pour facturer'}
            className="flex flex-col items-center gap-1.5 py-2.5 px-1.5 rounded-lg border text-center transition-colors hover:bg-[var(--tblr-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderColor: 'var(--tblr-border)' }}
          >
            <IconFileInvoice size={17} style={{ color: 'var(--tblr-muted)' }} />
            <span className="text-[10.5px] font-medium leading-tight" style={{ color: 'var(--tblr-text)' }}>Facture</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/documents')}
            className="flex flex-col items-center gap-1.5 py-2.5 px-1.5 rounded-lg border text-center transition-colors hover:bg-[var(--tblr-surface-2)]"
            style={{ borderColor: 'var(--tblr-border)' }}
          >
            <IconDots size={17} style={{ color: 'var(--tblr-muted)' }} />
            <span className="text-[10.5px] font-medium leading-tight" style={{ color: 'var(--tblr-text)' }}>Autres</span>
          </button>
        </div>

        <div className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_next_tasks')}</div>

        {isAddingMilestone && (
          <div className="mb-3 p-3 rounded-lg border space-y-2" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
            <input
              type="text"
              className="w-full border rounded-lg p-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
              placeholder="Titre du jalon"
              value={newMilestoneTitle}
              onChange={e => setNewMilestoneTitle(e.target.value)}
            />
            <input
              type="date"
              className="w-full border rounded-lg p-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
              value={newMilestoneDate}
              onChange={e => setNewMilestoneDate(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsAddingMilestone(false)} className="px-2.5 py-1.5 text-[11px] font-semibold" style={{ color: 'var(--tblr-muted)' }}>Annuler</button>
              <button type="button" onClick={onAddMilestone} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white" style={{ background: 'var(--tblr-primary)' }}>Ajouter</button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          {sortedMilestones.length === 0 && (
            <p className="text-xs italic py-2" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_no_tasks')}</p>
          )}
          {sortedMilestones.map(m => (
            <div
              key={m.id}
              onClick={() => onToggleMilestone(m)}
              className="flex items-start gap-2 py-1.5 border-t cursor-pointer"
              style={{ borderColor: 'var(--tblr-surface-2)' }}
            >
              <span
                className="w-3.5 h-3.5 mt-0.5 shrink-0 flex items-center justify-center text-[9px] text-white rounded-sm border"
                style={{ borderColor: m.completed ? 'var(--tblr-primary)' : 'var(--tblr-border)', background: m.completed ? 'var(--tblr-primary)' : 'transparent' }}
              >
                {m.completed ? '✓' : ''}
              </span>
              <span
                className="text-[12.5px] leading-snug"
                style={{ color: m.completed ? 'var(--tblr-muted)' : 'var(--tblr-text)', textDecoration: m.completed ? 'line-through' : 'none' }}
              >
                {m.title}
              </span>
            </div>
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
      </div>
    </div>
  );
}
