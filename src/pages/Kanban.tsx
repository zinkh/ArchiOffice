import { useState, useEffect } from 'react';
import { IconLayoutKanban, IconSearch, IconCalendar } from '@tabler/icons-react';
import { fetchJson } from '../lib/api';
import { cn } from '../lib/utils';
import type { Task, Project } from '../types';
import { format, parseISO, isPast } from 'date-fns';

type KanbanStatus = 'todo' | 'in_progress' | 'review' | 'done';

const COLUMNS: { id: KanbanStatus; label: string; headerColor: string; headerBg: string }[] = [
  { id: 'todo',        label: 'À faire',   headerColor: 'var(--tblr-muted)',   headerBg: 'var(--tblr-surface-2)' },
  { id: 'in_progress', label: 'En cours',  headerColor: 'var(--tblr-primary)', headerBg: 'var(--tblr-primary-lt)' },
  { id: 'review',      label: 'Révision',  headerColor: '#e67700',             headerBg: '#fff3bf' },
  { id: 'done',        label: 'Terminé',   headerColor: 'var(--tblr-success)', headerBg: '#d3f9d8' },
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
      setTasks(prev => prev.map(t => t.id === task.id ? task : t));
    }
  };

  const getProjectName = (projectId?: string) => {
    const p = projects.find(p => p.id === projectId);
    return p?.name || '';
  };

  const inputStyle = {
    background: 'var(--tblr-surface)',
    border: '1px solid var(--tblr-border)',
    color: 'var(--tblr-text)',
  } as React.CSSProperties;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="p-4"
        style={{
          background: 'var(--tblr-surface)',
          borderBottom: '1px solid var(--tblr-border)',
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <IconLayoutKanban size={22} style={{ color: 'var(--tblr-primary)' }} />
            <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>Kanban — Tâches</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 sm:flex-none">
              <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--tblr-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher..."
                className="w-full sm:w-48 pl-9 pr-3 py-2 text-sm rounded-lg outline-none"
                style={inputStyle}
              />
            </div>
            {/* Project filter */}
            <select
              value={filterProject}
              onChange={e => setFilterProject(e.target.value)}
              className="flex-1 sm:flex-none px-3 py-2 text-sm rounded-lg outline-none"
              style={inputStyle}
            >
              <option value="all">Tous les projets</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-4 pb-2" style={{ background: 'var(--tblr-bg)' }}>
        <div className="flex gap-4 min-w-max h-full">
          {COLUMNS.map(col => {
            const colTasks = getColumnTasks(col.id);
            const isOver = dragOverColumn === col.id;
            return (
              <div
                key={col.id}
                className="flex flex-col w-72 rounded-xl transition-colors duration-150"
                style={{
                  background: col.headerBg,
                  outline: isOver ? `2px solid var(--tblr-primary)` : 'none',
                  outlineOffset: '-2px',
                }}
                onDragOver={e => { e.preventDefault(); setDragOverColumn(col.id); }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={() => handleDrop(col.id)}
              >
                {/* Column header */}
                <div className="flex items-center justify-between p-3" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                  <span className="text-sm font-semibold" style={{ color: col.headerColor }}>{col.label}</span>
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{
                      background: 'var(--tblr-surface)',
                      color: 'var(--tblr-muted)',
                      boxShadow: 'var(--tblr-shadow)',
                    }}
                  >
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
                          "rounded-lg p-3 cursor-grab active:cursor-grabbing select-none transition-all",
                          isDragging ? 'opacity-40 scale-95' : 'hover:-translate-y-0.5'
                        )}
                        style={{
                          background: 'var(--tblr-surface)',
                          border: '1px solid var(--tblr-border)',
                          boxShadow: isDragging ? 'none' : 'var(--tblr-shadow)',
                        }}
                      >
                        <p className="text-sm font-medium leading-snug" style={{ color: 'var(--tblr-text)' }}>{task.title}</p>
                        {task.project_id && (
                          <p className="text-xs mt-1 truncate" style={{ color: 'var(--tblr-primary)' }}>{getProjectName(task.project_id)}</p>
                        )}
                        <div className="flex items-center justify-between mt-2 gap-2">
                          {task.due_date && (
                            <div className="flex items-center gap-1 text-xs" style={{ color: isOverdue ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}>
                              <IconCalendar size={12} />
                              <span>{format(parseISO(task.due_date), 'dd/MM')}</span>
                            </div>
                          )}
                          {task.progress !== undefined && task.progress !== null && (
                            <div className="flex-1">
                              <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--tblr-border)' }}>
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${task.progress}%`,
                                    background: col.id === 'done' ? 'var(--tblr-success)' : 'var(--tblr-primary)',
                                  }}
                                />
                              </div>
                            </div>
                          )}
                          {task.progress !== undefined && task.progress !== null && (
                            <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{task.progress}%</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {colTasks.length === 0 && (
                    <div
                      className="rounded-lg p-4 text-center transition-colors"
                      style={{
                        border: `2px dashed ${isOver ? 'var(--tblr-primary)' : 'var(--tblr-border)'}`,
                        background: isOver ? 'var(--tblr-primary-lt)' : 'transparent',
                      }}
                    >
                      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>Déposer ici</p>
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
