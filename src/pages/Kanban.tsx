import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconLayoutKanban, IconSearch, IconPlus } from '@tabler/icons-react';
import { useTasks } from '../hooks/useTasks';
import { PillTabs } from '../components/ui/PillTabs';
import { ErrorState, ListSkeleton } from '../components/DataState';
import { TaskCard } from '../components/tasks/TaskCard';
import { TaskListView } from '../components/tasks/TaskListView';
import { TaskFormModal, type TaskFormInitial } from '../components/tasks/TaskFormModal';
import { getTaskStatus } from '../components/tasks/taskDisplay';
import { TASK_PRIORITIES } from '../schemas/task.schema';
import type { Task, TaskStatus } from '../types';

const COLUMNS: { id: TaskStatus; labelKey: string; headerColor: string; headerBg: string }[] = [
  { id: 'todo',        labelKey: 'kanban_col_todo',        headerColor: 'var(--tblr-muted)',   headerBg: 'var(--tblr-surface-2)' },
  { id: 'in_progress', labelKey: 'kanban_col_in_progress', headerColor: 'var(--tblr-primary)', headerBg: 'var(--tblr-primary-lt)' },
  { id: 'review',      labelKey: 'kanban_col_review',      headerColor: '#e67700',             headerBg: '#fff3bf' },
  { id: 'done',        labelKey: 'kanban_col_done',        headerColor: 'var(--tblr-success)', headerBg: '#d3f9d8' },
];

export default function Kanban() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tasks, projects, team, loading, error, reload, moveTask } = useTasks({ withProjects: true, withTeam: true });

  const [view, setView] = useState<'board' | 'list'>('board');
  const [filterProject, setFilterProject] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [modal, setModal] = useState<TaskFormInitial | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const memberNameById = useMemo(() => new Map(team.map(m => [m.id, m.name || m.email])), [team]);

  const filteredTasks = useMemo(() => tasks.filter(task => {
    if (filterProject === 'none' ? !!task.project_id : filterProject !== 'all' && task.project_id !== filterProject) return false;
    if (filterAssignee === 'none' ? !!task.assignee_id : filterAssignee !== 'all' && task.assignee_id !== filterAssignee) return false;
    if (filterPriority !== 'all' && (task.priority || 'normal') !== filterPriority) return false;
    if (searchQuery && !task.title?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  }), [tasks, filterProject, filterAssignee, filterPriority, searchQuery]);

  const handleDrop = async (col: TaskStatus) => {
    const id = draggingId;
    setDraggingId(null);
    setDragOverColumn(null);
    if (!id) return;
    setMoveError(null);
    try {
      await moveTask(id, col);
    } catch (err: any) {
      // moveTask a déjà remis la carte dans sa colonne d'origine — reste à
      // le dire, l'ancienne version échouait en silence.
      setMoveError(err?.message || (t('task_move_error') as string));
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const openCreate = (status: TaskStatus) => setModal({
    status,
    start_date: today,
    end_date: today,
    project_id: filterProject !== 'all' && filterProject !== 'none' ? filterProject : null,
    assignee_id: filterAssignee !== 'all' && filterAssignee !== 'none' ? filterAssignee : null,
  });

  const openEdit = (task: Task) => setModal({ ...task });
  const closeModal = () => setModal(null);
  const afterWrite = () => { setModal(null); reload(); };

  const inputStyle = {
    background: 'var(--tblr-surface)',
    border: '1px solid var(--tblr-border)',
    color: 'var(--tblr-text)',
  } as React.CSSProperties;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4" style={{ background: 'var(--tblr-surface)', borderBottom: '1px solid var(--tblr-border)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconLayoutKanban size={22} style={{ color: 'var(--tblr-primary)' }} />
            <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('kanban_title')}</h1>
            <PillTabs
              activeId={view}
              onChange={id => setView(id as 'board' | 'list')}
              tabs={[
                { id: 'board', label: t('kanban_view_board') },
                { id: 'list', label: t('kanban_view_list') },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--tblr-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('kanban_search_placeholder') as string}
                className="w-full sm:w-44 pl-9 pr-3 py-2 text-sm rounded-lg outline-none"
                style={inputStyle}
              />
            </div>
            <select value={filterProject} onChange={e => setFilterProject(e.target.value)} className="px-3 py-2 text-sm rounded-lg outline-none" style={inputStyle}>
              <option value="all">{t('kanban_all_projects')}</option>
              <option value="none">{t('task_no_project')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} className="px-3 py-2 text-sm rounded-lg outline-none" style={inputStyle}>
              <option value="all">{t('kanban_all_assignees')}</option>
              <option value="none">{t('task_unassigned')}</option>
              {team.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
            </select>
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="px-3 py-2 text-sm rounded-lg outline-none" style={inputStyle}>
              <option value="all">{t('kanban_all_priorities')}</option>
              {TASK_PRIORITIES.map(p => <option key={p} value={p}>{t(`task_priority_${p}`)}</option>)}
            </select>
            <button
              type="button"
              onClick={() => openCreate('todo')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <IconPlus size={16} /> {t('kanban_new_task')}
            </button>
          </div>
        </div>
        {moveError && (
          <p className="mt-2 text-xs" style={{ color: 'var(--tblr-danger)' }}>{moveError}</p>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 pb-2" style={{ background: 'var(--tblr-bg)' }}>
        {loading ? (
          <ListSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : view === 'list' ? (
          <TaskListView
            tasks={filteredTasks}
            projects={projects}
            team={team}
            onOpen={openEdit}
            onStatusChange={(task, status) => { moveTask(task.id, status).catch(err => setMoveError(err?.message || (t('task_move_error') as string))); }}
          />
        ) : (
          <div className="flex gap-4 min-w-max h-full">
            {COLUMNS.map(col => {
              const colTasks = filteredTasks.filter(task => getTaskStatus(task) === col.id);
              const isOver = dragOverColumn === col.id;
              return (
                <div
                  key={col.id}
                  className="flex flex-col w-72 rounded-xl transition-colors duration-150"
                  style={{
                    background: col.headerBg,
                    outline: isOver ? '2px solid var(--tblr-primary)' : 'none',
                    outlineOffset: '-2px',
                  }}
                  onDragOver={e => { e.preventDefault(); setDragOverColumn(col.id); }}
                  onDragLeave={() => setDragOverColumn(null)}
                  onDrop={() => handleDrop(col.id)}
                >
                  <div className="flex items-center justify-between p-3" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <span className="text-sm font-semibold" style={{ color: col.headerColor }}>{t(col.labelKey)}</span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-muted)', boxShadow: 'var(--tblr-shadow)' }}
                      >
                        {colTasks.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => openCreate(col.id)}
                        title={t('kanban_add_to_column') as string}
                        aria-label={t('kanban_add_to_column') as string}
                        className="rounded p-1 transition-colors hover:bg-[var(--tblr-surface)]"
                        style={{ color: col.headerColor }}
                      >
                        <IconPlus size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-24">
                    {colTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        projectName={task.project_id ? projectNameById.get(task.project_id) : undefined}
                        assigneeName={task.assignee_id ? memberNameById.get(task.assignee_id) : undefined}
                        isDragging={draggingId === task.id}
                        isDone={col.id === 'done'}
                        onClick={() => openEdit(task)}
                        onDragStart={() => setDraggingId(task.id)}
                        onDragEnd={() => { setDraggingId(null); setDragOverColumn(null); }}
                      />
                    ))}
                    {colTasks.length === 0 && (
                      <div
                        className="rounded-lg p-4 text-center transition-colors"
                        style={{
                          border: `2px dashed ${isOver ? 'var(--tblr-primary)' : 'var(--tblr-border)'}`,
                          background: isOver ? 'var(--tblr-primary-lt)' : 'transparent',
                        }}
                      >
                        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('kanban_drop_here')}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modal && (
        <TaskFormModal
          initial={modal}
          projects={projects}
          team={team}
          allTasks={tasks}
          onClose={closeModal}
          onSaved={afterWrite}
          onDeleted={afterWrite}
          onOpenProject={id => navigate(`/projects/${id}`)}
        />
      )}
    </div>
  );
}
