import { useState, useEffect } from 'react';
import { IconLayoutKanban, IconSearch, IconCalendar } from '@tabler/icons-react';
import { fetchJson } from '../lib/api';
import { cn } from '../lib/utils';
import type { Task, Project } from '../types';
import { format, parseISO, isPast } from 'date-fns';

type KanbanStatus = 'todo' | 'in_progress' | 'review' | 'done';

const COLUMNS: { id: KanbanStatus; label: string; color: string; bg: string }[] = [
  { id: 'todo', label: 'À faire', color: 'text-zinc-600 dark:text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800' },
  { id: 'in_progress', label: 'En cours', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  { id: 'review', label: 'Révision', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  { id: 'done', label: 'Terminé', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
];

export default function Kanban() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filterProject, setFilterProject] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<KanbanStatus | null>(null);

  useEffect(() => {
    Promise.all([
      fetchJson<Task[]>('/api/tasks'),
      fetchJson<Project[]>('/api/projects'),
    ]).then(([t, p]) => {
      setTasks(t);
      setProjects(p);
    }).catch(console.error);
  }, []);

  const getTaskStatus = (task: Task): KanbanStatus => {
    if (task.status === 'done' || task.completed || task.progress === 100) return 'done';
    if (task.status === 'review') return 'review';
    if (task.status === 'in_progress' || (task.progress && task.progress > 0 && task.progress < 100)) return 'in_progress';
    return 'todo';
  };

  const filteredTasks = tasks.filter(task => {
    const matchProject = filterProject === 'all' || task.project_id === filterProject;
    const matchSearch = !searchQuery || task.title?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchProject && matchSearch;
  });

  const getColumnTasks = (col: KanbanStatus) => filteredTasks.filter(t => getTaskStatus(t) === col);

  const handleDragStart = (taskId: string) => setDraggingId(taskId);
  const handleDragEnd = () => { setDraggingId(null); setDragOverColumn(null); };

  const handleDrop = async (col: KanbanStatus) => {
    if (!draggingId) return;
    const task = tasks.find(t => t.id === draggingId);
    if (!task) return;

    const newProgress = col === 'done' ? 100 : col === 'review' ? 75 : col === 'in_progress' ? 25 : 0;
    const updated = { ...task, status: col, progress: newProgress, completed: col === 'done' };

    setTasks(prev => prev.map(t => t.id === draggingId ? updated : t));
    setDraggingId(null);
    setDragOverColumn(null);

    try {
      await fetch(`/api/tasks/${draggingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch (err) {
      console.error('Failed to update task:', err);
      // Revert on error
      setTasks(prev => prev.map(t => t.id === task.id ? task : t));
    }
  };

  const getProjectName = (projectId?: string) => {
    const p = projects.find(p => p.id === projectId);
    return p?.name || '';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <IconLayoutKanban size={22} className="text-violet-500" />
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Kanban — Tâches</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher..."
                className="pl-9 pr-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            {/* Project filter */}
            <select
              value={filterProject}
              onChange={e => setFilterProject(e.target.value)}
              className="px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="all">Tous les projets</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 min-w-max h-full">
          {COLUMNS.map(col => {
            const colTasks = getColumnTasks(col.id);
            const isOver = dragOverColumn === col.id;
            return (
              <div
                key={col.id}
                className={cn(
                  "flex flex-col w-72 rounded-xl transition-colors duration-150",
                  col.bg,
                  isOver ? 'ring-2 ring-violet-400 ring-inset' : ''
                )}
                onDragOver={e => { e.preventDefault(); setDragOverColumn(col.id); }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={() => handleDrop(col.id)}
              >
                {/* Column header */}
                <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
                  <span className={cn("text-sm font-semibold", col.color)}>{col.label}</span>
                  <span className="text-xs font-medium bg-white dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full shadow-sm">
                    {colTasks.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-24">
                  {colTasks.map(task => {
                    const isDragging = draggingId === task.id;
                    const isOverdue = task.due_date && isPast(parseISO(task.due_date)) && col.id !== 'done';
                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={() => handleDragStart(task.id)}
                        onDragEnd={handleDragEnd}
                        className={cn(
                          "bg-white dark:bg-zinc-800 rounded-lg p-3 shadow-sm border border-zinc-200 dark:border-zinc-700 cursor-grab active:cursor-grabbing select-none transition-all",
                          isDragging ? 'opacity-40 scale-95' : 'hover:shadow-md hover:-translate-y-0.5'
                        )}
                      >
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-snug">{task.title}</p>
                        {task.project_id && (
                          <p className="text-xs text-violet-600 dark:text-violet-400 mt-1 truncate">{getProjectName(task.project_id)}</p>
                        )}
                        <div className="flex items-center justify-between mt-2 gap-2">
                          {task.due_date && (
                            <div className={cn("flex items-center gap-1 text-xs", isOverdue ? 'text-red-500' : 'text-zinc-400')}>
                              <IconCalendar size={12} />
                              <span>{format(parseISO(task.due_date), 'dd/MM')}</span>
                            </div>
                          )}
                          {task.progress !== undefined && task.progress !== null && (
                            <div className="flex-1">
                              <div className="h-1 bg-zinc-200 dark:bg-zinc-600 rounded-full overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full transition-all", col.id === 'done' ? 'bg-green-500' : 'bg-violet-500')}
                                  style={{ width: `${task.progress}%` }}
                                />
                              </div>
                            </div>
                          )}
                          {task.progress !== undefined && task.progress !== null && (
                            <span className="text-xs text-zinc-400">{task.progress}%</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {colTasks.length === 0 && (
                    <div className={cn("border-2 border-dashed rounded-lg p-4 text-center transition-colors", isOver ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/10' : 'border-zinc-200 dark:border-zinc-700')}>
                      <p className="text-xs text-zinc-400">Déposer ici</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
