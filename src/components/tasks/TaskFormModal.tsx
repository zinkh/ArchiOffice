import { useState, FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { IconX, IconAlertTriangle, IconLoader2, IconTrash, IconExternalLink } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { TASK_STATUSES, TASK_PRIORITIES } from '../../schemas/task.schema';
import type { Project, TeamMember, Task, TaskStatus, TaskPriority } from '../../types';

// Les valeurs déjà connues au moment de l'ouverture. Sans `id`, le modal
// crée ; avec, il modifie.
export interface TaskFormInitial {
  id?: string;
  project_id?: string | null;
  title?: string;
  description?: string | null;
  start_date?: string;
  end_date?: string;
  due_date?: string | null;
  progress?: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_id?: string | null;
  dependencies?: string[];
}

export interface TaskFormModalProps {
  initial: TaskFormInitial;
  projects: Project[];
  team: TeamMember[];
  /** Candidates au sélecteur de dépendances (filtrées sur le même projet). */
  allTasks?: Task[];
  /** Onglet Tâches d'un projet : le projet est imposé, le champ reste visible mais figé. */
  lockProject?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onOpenProject?: (projectId: string) => void;
}

/**
 * Le formulaire de tâche unique de l'application — Kanban, onglet projet,
 * tableau de bord, Gantt et Calendrier ouvrent tous celui-ci. Il remplace
 * l'ancien src/components/TaskModal.tsx, en lecture seule sur le statut,
 * l'échéance et l'assignation, et dont les libellés étaient en dur en
 * anglais.
 */
export function TaskFormModal({ initial, projects, team, allTasks = [], lockProject, onClose, onSaved, onDeleted, onOpenProject }: TaskFormModalProps) {
  const { t } = useTranslation();
  const isEdit = !!initial.id;
  const today = new Date().toISOString().slice(0, 10);

  const [projectId, setProjectId] = useState(initial.project_id || '');
  const [title, setTitle] = useState(initial.title || '');
  const [description, setDescription] = useState(initial.description || '');
  const [startDate, setStartDate] = useState(initial.start_date || today);
  const [endDate, setEndDate] = useState(initial.end_date || today);
  const [dueDate, setDueDate] = useState(initial.due_date || '');
  const [progress, setProgress] = useState<string>(initial.progress != null ? String(initial.progress) : '0');
  const [status, setStatus] = useState<TaskStatus>(initial.status || 'todo');
  const [priority, setPriority] = useState<TaskPriority>(initial.priority || 'normal');
  const [assigneeId, setAssigneeId] = useState(initial.assignee_id || '');
  const [dependencies, setDependencies] = useState<string[]>(initial.dependencies || []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputCls = "w-full text-sm rounded border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const inputStyle = { background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' };
  const labelCls = "block text-xs font-medium mb-1";
  const labelStyle = { color: 'var(--tblr-muted)' };

  // Une dépendance entre deux projets différents n'a pas de sens sur le
  // Gantt, qui trace ses flèches à l'intérieur d'un projet.
  const dependencyCandidates = allTasks.filter(task => task.id !== initial.id && (task.project_id || '') === (projectId || ''));

  const toggleDependency = (id: string) =>
    setDependencies(prev => (prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        project_id: projectId || null,
        title,
        description: description || null,
        start_date: startDate,
        end_date: endDate,
        due_date: dueDate || null,
        progress: progress ? Number(progress) : 0,
        status,
        priority,
        assignee_id: assigneeId || null,
        dependencies,
      };
      if (isEdit) await apiFetch(`/api/tasks/${initial.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
      onSaved();
    } catch (err: any) {
      setError(err?.message || (t('task_save_error') as string));
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial.id || !confirm(t('task_delete_confirm') as string)) return;
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/api/tasks/${initial.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (err: any) {
      setError(err?.message || (t('task_delete_error') as string));
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        style={{ background: 'var(--tblr-surface)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-semibold text-base truncate" style={{ color: 'var(--tblr-text)' }}>
              {isEdit ? t('task_edit_title') : t('task_new_title')}
            </h2>
            {isEdit && initial.project_id && onOpenProject && (
              <button
                type="button"
                onClick={() => onOpenProject(initial.project_id as string)}
                className="flex items-center gap-1 text-[11px] font-medium shrink-0 hover:underline"
                style={{ color: 'var(--tblr-primary)' }}
              >
                <IconExternalLink size={12} /> {t('calendar_view_project')}
              </button>
            )}
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--tblr-surface-2)] transition-colors shrink-0">
            <IconX size={18} style={{ color: 'var(--tblr-muted)' }} />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-4 px-3 py-2 rounded-lg border text-xs flex items-center gap-2" style={{ background: '#fff5f5', borderColor: '#ffc9c9', color: '#c92a2a' }}>
            <IconAlertTriangle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-4">
          <div>
            <label className={labelCls} style={labelStyle}>{t('calendar_field_title')} *</label>
            <input required value={title} onChange={e => setTitle(e.target.value)} className={inputCls} style={inputStyle} />
          </div>

          <div>
            <label className={labelCls} style={labelStyle}>{t('calendar_field_project')}</label>
            <select disabled={lockProject} value={projectId} onChange={e => setProjectId(e.target.value)} className={inputCls} style={{ ...inputStyle, opacity: lockProject ? 0.6 : 1 }}>
              <option value="">{t('task_no_project')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls} style={labelStyle}>{t('task_field_description')}</label>
            <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} className={inputCls} style={inputStyle} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={labelStyle}>{t('calendar_field_status')}</label>
              <select value={status} onChange={e => setStatus(e.target.value as TaskStatus)} className={inputCls} style={inputStyle}>
                {TASK_STATUSES.map(s => <option key={s} value={s}>{t(`calendar_task_status_${s}`)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('task_field_priority')}</label>
              <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} className={inputCls} style={inputStyle}>
                {TASK_PRIORITIES.map(p => <option key={p} value={p}>{t(`task_priority_${p}`)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls} style={labelStyle}>{t('task_field_assignee')}</label>
            <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={inputCls} style={inputStyle}>
              <option value="">{t('task_unassigned')}</option>
              {team.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={labelStyle}>{t('calendar_field_start_date')} *</label>
              <input required type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} style={{ ...inputStyle, colorScheme: 'light dark' }} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('calendar_field_end_date')} *</label>
              <input required type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} style={{ ...inputStyle, colorScheme: 'light dark' }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={labelStyle}>{t('calendar_field_due_date')}</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} style={{ ...inputStyle, colorScheme: 'light dark' }} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('calendar_field_progress')}</label>
              <input type="number" min="0" max="100" value={progress} onChange={e => setProgress(e.target.value)} className={inputCls} style={inputStyle} />
            </div>
          </div>

          {dependencyCandidates.length > 0 && (
            <div>
              <label className={labelCls} style={labelStyle}>{t('task_field_dependencies')}</label>
              <div className="max-h-32 overflow-y-auto rounded border p-2 space-y-1" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                {dependencyCandidates.map(candidate => (
                  <label key={candidate.id} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--tblr-text)' }}>
                    <input type="checkbox" checked={dependencies.includes(candidate.id)} onChange={() => toggleDependency(candidate.id)} />
                    <span className="truncate">{candidate.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            {isEdit ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || saving}
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded border transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60"
                style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-danger)' }}
              >
                {deleting ? <IconLoader2 size={13} className="animate-spin" /> : <IconTrash size={13} />}
                {t('calendar_event_delete')}
              </button>
            ) : <span />}
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded border transition-colors hover:bg-[var(--tblr-surface-2)]" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
                {t('btn_cancel')}
              </button>
              <button type="submit" disabled={saving || deleting} className="flex items-center gap-2 px-4 py-2 text-sm rounded font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
                {saving && <IconLoader2 size={14} className="animate-spin" />}
                {isEdit ? t('save') : t('calendar_event_create')}
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export default TaskFormModal;
