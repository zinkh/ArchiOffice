import { useState, FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { IconX, IconAlertTriangle, IconLoader2, IconTrash, IconExternalLink } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import type { Project } from '../types';

export type CalendarEventType = 'milestone' | 'task';

// What the caller already knows when opening the modal — a fresh milestone
// (undefined id) or an existing milestone/task being edited (id present,
// eventType fixed since a milestone and a task are different tables, not
// interchangeable once created).
export interface CalendarEventInitial {
  eventType: CalendarEventType;
  id?: string;
  project_id?: string;
  title?: string;
  due_date?: string;
  completed?: boolean;
  duration_days?: number | null;
  start_date?: string;
  end_date?: string;
  progress?: number;
  status?: string;
  // Not editable from this modal (no dependency picker here yet — see
  // Étape 2 scope notes), but PUT /api/milestones|tasks/:id defaults an
  // omitted `dependencies` to [] rather than leaving it untouched, so it
  // must always be round-tripped verbatim to avoid silently wiping it.
  dependencies?: string[];
}

interface CalendarEventModalProps {
  initial: CalendarEventInitial;
  projects: Project[];
  onClose: () => void;
  // Saving/deleting only needs to tell the caller "refresh your data" —
  // the two write endpoints don't consistently return the full updated
  // row (milestone PUT and both task endpoints return { success: true }/
  // { id }, not the record), so reconstructing it client-side would just
  // duplicate the server's own defaulting logic. A refetch is simpler and
  // just as correct for a form save (unlike the drag-and-drop reschedule,
  // which needs true optimistic UI and handles that separately).
  onSaved: () => void;
  onDeleted: () => void;
  // Editing used to be a side effect of navigating to the project; that
  // behavior is kept as a secondary action here rather than dropped.
  onOpenProject: (projectId: string) => void;
}

const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;

export function CalendarEventModal({ initial, projects, onClose, onSaved, onDeleted, onOpenProject }: CalendarEventModalProps) {
  const { t } = useTranslation();
  const isEdit = !!initial.id;
  const [eventType, setEventType] = useState<CalendarEventType>(initial.eventType);
  const [projectId, setProjectId] = useState(initial.project_id || '');
  const [title, setTitle] = useState(initial.title || '');
  const [dueDate, setDueDate] = useState(initial.due_date || '');
  const [completed, setCompleted] = useState(!!initial.completed);
  const [durationDays, setDurationDays] = useState<string>(initial.duration_days != null ? String(initial.duration_days) : '');
  const [startDate, setStartDate] = useState(initial.start_date || '');
  const [endDate, setEndDate] = useState(initial.end_date || '');
  const [progress, setProgress] = useState<string>(initial.progress != null ? String(initial.progress) : '0');
  const [status, setStatus] = useState(initial.status || 'todo');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputCls = "w-full text-sm rounded border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const inputStyle = { background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' };
  const labelCls = "block text-xs font-medium mb-1";
  const labelStyle = { color: 'var(--tblr-muted)' };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (eventType === 'milestone') {
        const body = {
          project_id: projectId || null,
          title,
          due_date: dueDate,
          completed,
          duration_days: durationDays ? Number(durationDays) : null,
          dependencies: initial.dependencies || [],
        };
        if (isEdit) {
          await apiFetch(`/api/milestones/${initial.id}`, { method: 'PUT', body: JSON.stringify(body) });
        } else {
          await apiFetch('/api/milestones', { method: 'POST', body: JSON.stringify(body) });
        }
      } else {
        const body = {
          project_id: projectId,
          title,
          start_date: startDate,
          end_date: endDate,
          progress: progress ? Number(progress) : 0,
          status,
          dependencies: initial.dependencies || [],
        };
        if (isEdit) {
          await apiFetch(`/api/tasks/${initial.id}`, { method: 'PUT', body: JSON.stringify(body) });
        } else {
          await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
        }
      }
      onSaved();
    } catch (err: any) {
      setError(err?.message || t('calendar_event_save_error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial.id || !confirm(t('calendar_event_delete_confirm') as string)) return;
    setDeleting(true);
    setError(null);
    try {
      const path = eventType === 'milestone' ? `/api/milestones/${initial.id}` : `/api/tasks/${initial.id}`;
      await apiFetch(path, { method: 'DELETE' });
      onDeleted();
    } catch (err: any) {
      setError(err?.message || t('calendar_event_delete_error'));
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
              {isEdit
                ? (eventType === 'milestone' ? t('calendar_edit_milestone') : t('calendar_edit_task'))
                : t('calendar_new_event')}
            </h2>
            {isEdit && initial.project_id && (
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
          {!isEdit && (
            <div className="flex items-center gap-1 p-1 rounded-lg w-fit" style={{ background: 'var(--tblr-surface-2)' }}>
              <button
                type="button"
                onClick={() => setEventType('milestone')}
                className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={eventType === 'milestone' ? { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', boxShadow: 'var(--tblr-shadow)' } : { color: 'var(--tblr-muted)' }}
              >
                {t('calendar_type_milestone')}
              </button>
              <button
                type="button"
                onClick={() => setEventType('task')}
                className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={eventType === 'task' ? { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', boxShadow: 'var(--tblr-shadow)' } : { color: 'var(--tblr-muted)' }}
              >
                {t('calendar_type_task')}
              </button>
            </div>
          )}

          <div>
            <label className={labelCls} style={labelStyle}>{t('calendar_field_title')} *</label>
            <input required value={title} onChange={e => setTitle(e.target.value)} className={inputCls} style={inputStyle} />
          </div>

          <div>
            <label className={labelCls} style={labelStyle}>{t('calendar_field_project')} {eventType === 'task' && '*'}</label>
            <select required={eventType === 'task'} value={projectId} onChange={e => setProjectId(e.target.value)} className={inputCls} style={inputStyle}>
              <option value="">{t('calendar_field_project_none')}</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {eventType === 'milestone' ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls} style={labelStyle}>{t('calendar_field_due_date')} *</label>
                  <input required type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} style={{ ...inputStyle, colorScheme: 'light dark' }} />
                </div>
                <div>
                  <label className={labelCls} style={labelStyle}>{t('calendar_field_duration_days')}</label>
                  <input type="number" min="0" value={durationDays} onChange={e => setDurationDays(e.target.value)} className={inputCls} style={inputStyle} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--tblr-text)' }}>
                <input type="checkbox" checked={completed} onChange={e => setCompleted(e.target.checked)} />
                {t('calendar_field_completed')}
              </label>
            </>
          ) : (
            <>
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
                  <label className={labelCls} style={labelStyle}>{t('calendar_field_status')}</label>
                  <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls} style={inputStyle}>
                    {TASK_STATUSES.map(s => (
                      <option key={s} value={s}>{t(`calendar_task_status_${s}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls} style={labelStyle}>{t('calendar_field_progress')}</label>
                  <input type="number" min="0" max="100" value={progress} onChange={e => setProgress(e.target.value)} className={inputCls} style={inputStyle} />
                </div>
              </div>
            </>
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
