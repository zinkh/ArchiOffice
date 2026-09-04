import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconChevronRight, IconCalendar } from '@tabler/icons-react';
import { format, parseISO, isPast } from 'date-fns';
import { useUser } from '../../UserContext';
import { useTasks } from '../../hooks/useTasks';
import { SectionCard } from './DashboardWidgets';
import { ListSkeleton } from '../DataState';
import { TaskFormModal, type TaskFormInitial } from '../tasks/TaskFormModal';
import { PRIORITY_COLORS, getTaskStatus, taskDeadline } from '../tasks/taskDisplay';

/**
 * Les tâches n'apparaissaient nulle part sur le tableau de bord : une tâche
 * assignée n'existait que dans le Kanban. Ce bloc montre les six prochaines
 * échéances de l'utilisateur courant, et ouvre la même modale que le Kanban.
 */
export default function MyTasksWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentUser } = useUser();
  const { tasks, projects, team, loading, reload } = useTasks({
    assigneeId: currentUser?.id,
    withProjects: true,
    withTeam: true,
    enabled: !!currentUser?.id,
  });
  const [modal, setModal] = useState<TaskFormInitial | null>(null);

  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);

  const upcoming = useMemo(() => tasks
    .filter(task => getTaskStatus(task) !== 'done')
    // Une tâche sans échéance passe après celles qui en ont une.
    .sort((a, b) => (taskDeadline(a) || '￿').localeCompare(taskDeadline(b) || '￿'))
    .slice(0, 6), [tasks]);

  const afterWrite = () => { setModal(null); reload(); };

  return (
    <>
      <SectionCard
        title={t('dashboard_my_tasks')}
        action={
          <Link to="/kanban" className="flex items-center gap-1 text-[12px] font-medium" style={{ color: 'var(--tblr-primary)' }}>
            {t('view_all')} <IconChevronRight size={14} />
          </Link>
        }
      >
        {loading ? (
          <ListSkeleton rows={3} />
        ) : upcoming.length === 0 ? (
          <p className="text-[13px] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>{t('dashboard_my_tasks_empty')}</p>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--tblr-border)' }}>
            {upcoming.map(task => {
              const deadline = taskDeadline(task);
              const overdue = !!deadline && isPast(parseISO(deadline));
              return (
                <div
                  key={task.id}
                  className="flex items-center gap-3 py-3 cursor-pointer transition-colors"
                  style={{ borderColor: 'var(--tblr-border)' }}
                  onClick={() => setModal({ ...task })}
                  onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                  onMouseOut={e => (e.currentTarget.style.background = '')}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY_COLORS[task.priority || 'normal'] }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>{task.title}</p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--tblr-muted)' }}>
                      {task.project_id ? (projectNameById.get(task.project_id) || '—') : t('task_no_project')}
                    </p>
                  </div>
                  {deadline && (
                    <span className="flex items-center gap-1 text-[11px] shrink-0" style={{ color: overdue ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}>
                      <IconCalendar size={12} />
                      {format(parseISO(deadline), 'dd/MM')}
                    </span>
                  )}
                  <IconChevronRight size={14} style={{ color: 'var(--tblr-muted)' }} className="shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {modal && (
        <TaskFormModal
          initial={modal}
          projects={projects}
          team={team}
          allTasks={tasks}
          onClose={() => setModal(null)}
          onSaved={afterWrite}
          onDeleted={afterWrite}
          onOpenProject={id => { setModal(null); navigate(`/projects/${id}`); }}
        />
      )}
    </>
  );
}
