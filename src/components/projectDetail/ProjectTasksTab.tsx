import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconChecklist, IconProgress, IconAlertTriangle } from '@tabler/icons-react';
import { parseISO, isPast } from 'date-fns';
import { useTasks } from '../../hooks/useTasks';
import { StatTile } from '../ui/StatTile';
import { ErrorState, ListSkeleton } from '../DataState';
import { TaskListView } from '../tasks/TaskListView';
import { TaskFormModal, type TaskFormInitial } from '../tasks/TaskFormModal';
import { getTaskStatus, taskDeadline } from '../tasks/taskDisplay';
import type { Project, Task, TaskStatus } from '../../types';

export interface ProjectTasksTabProps {
  projectId: string;
  /** Le projet courant, pour que le sélecteur de la modale affiche son nom. */
  projects: Project[];
}

/**
 * Onglet TÂCHES d'une fiche projet. Les tâches n'apparaissaient jusqu'ici
 * nulle part dans le projet auquel elles sont pourtant rattachées — le bloc
 * « Prochains jalons » de l'aperçu montre des jalons, pas des tâches.
 */
export default function ProjectTasksTab({ projectId, projects }: ProjectTasksTabProps) {
  const { t } = useTranslation();
  const { tasks, team, loading, error, reload, moveTask } = useTasks({ projectId, withTeam: true });
  const [modal, setModal] = useState<TaskFormInitial | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const stats = useMemo(() => {
    let todo = 0;
    let inProgress = 0;
    let overdue = 0;
    for (const task of tasks) {
      const status = getTaskStatus(task);
      if (status === 'todo') todo++;
      if (status === 'in_progress' || status === 'review') inProgress++;
      const deadline = taskDeadline(task);
      if (status !== 'done' && deadline && isPast(parseISO(deadline))) overdue++;
    }
    return { todo, inProgress, overdue };
  }, [tasks]);

  const today = new Date().toISOString().slice(0, 10);
  const afterWrite = () => { setModal(null); reload(); };

  const handleStatusChange = (task: Task, status: TaskStatus) => {
    setWriteError(null);
    moveTask(task.id, status).catch(err => setWriteError(err?.message || (t('task_move_error') as string)));
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="grid grid-cols-3 gap-3 flex-1 max-w-xl">
          <StatTile label={t('project_tasks_todo')} value={stats.todo} icon={IconChecklist} color="blue" />
          <StatTile label={t('project_tasks_in_progress')} value={stats.inProgress} icon={IconProgress} color="amber" />
          <StatTile label={t('project_tasks_overdue')} value={stats.overdue} icon={IconAlertTriangle} color={stats.overdue > 0 ? 'red' : 'neutral'} />
        </div>
        <button
          type="button"
          onClick={() => setModal({ project_id: projectId, start_date: today, end_date: today })}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors shrink-0"
        >
          <IconPlus size={16} /> {t('kanban_new_task')}
        </button>
      </div>

      {writeError && <p className="text-xs" style={{ color: 'var(--tblr-danger)' }}>{writeError}</p>}

      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <TaskListView
          tasks={tasks}
          projects={projects}
          team={team}
          onOpen={task => setModal({ ...task })}
          onStatusChange={handleStatusChange}
          emptyLabel={t('project_tasks_empty') as string}
        />
      )}

      {modal && (
        <TaskFormModal
          initial={modal}
          projects={projects}
          team={team}
          allTasks={tasks}
          lockProject
          onClose={() => setModal(null)}
          onSaved={afterWrite}
          onDeleted={afterWrite}
        />
      )}
    </div>
  );
}
