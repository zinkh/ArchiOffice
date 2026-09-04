import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronUp, IconChevronDown, IconSelector } from '@tabler/icons-react';
import { format, parseISO, isPast } from 'date-fns';
import { TASK_STATUSES } from '../../schemas/task.schema';
import { PRIORITY_COLORS, getTaskStatus, taskDeadline } from './taskDisplay';
import type { Task, Project, TeamMember, TaskStatus } from '../../types';

type SortKey = 'title' | 'project' | 'status' | 'priority' | 'deadline' | 'assignee' | 'progress';

export interface TaskListViewProps {
  tasks: Task[];
  projects: Project[];
  team: TeamMember[];
  onOpen: (task: Task) => void;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  emptyLabel?: string;
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = { todo: 0, in_progress: 1, review: 2, done: 3 };

/**
 * Vue tableau des mêmes tâches que le Kanban : triable et lisible d'un coup
 * d'œil quand il y en a trop pour un tableau de colonnes. Partagée avec
 * l'onglet Tâches d'un projet.
 */
export function TaskListView({ tasks, projects, team, onOpen, onStatusChange, emptyLabel }: TaskListViewProps) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'deadline', dir: 'asc' });

  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const memberNameById = useMemo(() => new Map(team.map(m => [m.id, m.name || m.email])), [team]);

  const sorted = useMemo(() => {
    const valueOf = (task: Task): string | number => {
      switch (sort.key) {
        case 'title': return task.title?.toLowerCase() || '';
        case 'project': return (task.project_id ? projectNameById.get(task.project_id) : '')?.toLowerCase() || '￿';
        case 'status': return STATUS_ORDER[getTaskStatus(task)] ?? 9;
        case 'priority': return PRIORITY_ORDER[task.priority || 'normal'] ?? 9;
        // Une tâche sans échéance passe en dernier plutôt qu'en tête.
        case 'deadline': return taskDeadline(task) || '￿';
        case 'assignee': return (task.assignee_id ? memberNameById.get(task.assignee_id) : '')?.toLowerCase() || '￿';
        case 'progress': return task.progress || 0;
      }
    };
    return [...tasks].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [tasks, sort, projectNameById, memberNameById]);

  const toggleSort = (key: SortKey) =>
    setSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const columns: { key: SortKey; label: string }[] = [
    { key: 'title', label: t('task_list_col_title') },
    { key: 'project', label: t('task_list_col_project') },
    { key: 'status', label: t('task_list_col_status') },
    { key: 'priority', label: t('task_list_col_priority') },
    { key: 'deadline', label: t('task_list_col_due') },
    { key: 'assignee', label: t('task_list_col_assignee') },
    { key: 'progress', label: t('task_list_col_progress') },
  ];

  if (sorted.length === 0) {
    return <p className="text-[13px] text-center py-10" style={{ color: 'var(--tblr-muted)' }}>{emptyLabel || t('kanban_empty')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--tblr-border)' }}>
            {columns.map(col => {
              const active = sort.key === col.key;
              const SortIcon = !active ? IconSelector : sort.dir === 'asc' ? IconChevronUp : IconChevronDown;
              return (
                <th key={col.key} className="text-left px-3 py-2 font-semibold text-xs whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="flex items-center gap-1 hover:underline"
                    style={{ color: active ? 'var(--tblr-text)' : 'var(--tblr-muted)' }}
                  >
                    {col.label}
                    <SortIcon size={12} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(task => {
            const status = getTaskStatus(task);
            const deadline = taskDeadline(task);
            const isOverdue = !!deadline && isPast(parseISO(deadline)) && status !== 'done';
            return (
              <tr
                key={task.id}
                className="cursor-pointer transition-colors"
                style={{ borderBottom: '1px solid var(--tblr-border)' }}
                onClick={() => onOpen(task)}
                onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                onMouseOut={e => (e.currentTarget.style.background = '')}
              >
                <td className="px-3 py-2" style={{ color: 'var(--tblr-text)' }}>{task.title}</td>
                <td className="px-3 py-2 text-xs" style={{ color: task.project_id ? 'var(--tblr-primary)' : 'var(--tblr-muted)' }}>
                  {task.project_id ? (projectNameById.get(task.project_id) || '—') : t('task_no_project')}
                </td>
                <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                  <select
                    value={status}
                    onChange={e => onStatusChange(task, e.target.value as TaskStatus)}
                    className="text-xs rounded border px-2 py-1 outline-none"
                    style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
                  >
                    {TASK_STATUSES.map(s => <option key={s} value={s}>{t(`calendar_task_status_${s}`)}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--tblr-text)' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: PRIORITY_COLORS[task.priority || 'normal'] }} />
                    {t(`task_priority_${task.priority || 'normal'}`)}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: isOverdue ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}>
                  {deadline ? format(parseISO(deadline), 'dd/MM/yyyy') : '—'}
                </td>
                <td className="px-3 py-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                  {task.assignee_id ? (memberNameById.get(task.assignee_id) || '—') : t('task_unassigned')}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--tblr-muted)' }}>{task.progress || 0}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default TaskListView;
