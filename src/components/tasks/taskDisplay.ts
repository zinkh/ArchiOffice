import type { Task, TaskPriority, TaskStatus } from '../../types';

// Palette des priorités, partagée par la carte Kanban et la vue liste pour
// qu'une tâche « urgente » ait la même couleur partout.
export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'var(--tblr-muted)',
  normal: 'var(--tblr-primary)',
  high: '#e67700',
  urgent: 'var(--tblr-danger)',
};

/**
 * Colonne d'affichage d'une tâche. `status` est la source de vérité depuis
 * migrate_add_task_status.sql, mais les lignes créées avant cette migration
 * n'ont qu'un `progress` — d'où le repli.
 */
export function getTaskStatus(task: Task): TaskStatus {
  if (task.status === 'done' || task.progress === 100) return 'done';
  if (task.status === 'review') return 'review';
  if (task.status === 'in_progress' || (task.progress && task.progress > 0 && task.progress < 100)) return 'in_progress';
  return 'todo';
}

/** Initiales d'un nom, pour la pastille d'assignation. */
export function initialsOf(name?: string): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || '?';
}

/** L'échéance retenue pour l'affichage : due_date si elle existe, sinon la fin. */
export function taskDeadline(task: Task): string | null {
  return task.due_date || task.end_date || null;
}
