import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import * as d3 from 'd3';
import { IconChevronLeft, IconChevronRight, IconZoomIn, IconZoomOut, IconCalendar, IconInfoCircle } from '@tabler/icons-react';
import { addMonths, subMonths, format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWithinInterval } from 'date-fns';
import { cn } from '../lib/utils';
import type { Project, Milestone, Task } from '../types';
import { useTranslation } from 'react-i18next';
import TaskModal from '../components/TaskModal';

export default function Gantt() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [taskCoords, setTaskCoords] = useState<Record<string, { x: number, y: number, w: number, h: number }>>({});
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateCoords = () => {
      if (!gridRef.current) return;
      const coords: Record<string, { x: number, y: number, w: number, h: number }> = {};
      const gridRect = gridRef.current.getBoundingClientRect();
      
      tasks.forEach(task => {
        const el = gridRef.current?.querySelector(`[data-task-id="${task.id}"]`);
        if (el) {
          const rect = el.getBoundingClientRect();
          coords[task.id] = {
            x: rect.left - gridRect.left,
            y: rect.top - gridRect.top,
            w: rect.width,
            h: rect.height
          };
        }
      });
      setTaskCoords(coords);
    };

    // Small delay to ensure DOM is rendered
    const timer = setTimeout(updateCoords, 100);
    window.addEventListener('resize', updateCoords);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateCoords);
    };
  }, [tasks, projects, viewDate, isModalOpen]);

  useEffect(() => {
    fetch('/api/projects')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => { if (Array.isArray(data)) setProjects(data); })
      .catch(err => console.error(err));

    fetch('/api/milestones')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => { if (Array.isArray(data)) setMilestones(data); })
      .catch(err => console.error(err));

    fetch('/api/tasks')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => { if (Array.isArray(data)) setTasks(data); })
      .catch(err => console.error(err));
  }, []);

  const handleSaveTask = async (task: Task) => {
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task)
    });
    setTasks(prev => prev.map(t => t.id === task.id ? task : t));
    setIsModalOpen(false);
  };

  const handleProgressChange = async (task: Task, newProgress: number) => {
    const updatedTask = { ...task, progress: newProgress };
    setTasks(prev => prev.map(t => t.id === task.id ? updatedTask : t));
    
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedTask)
      });
    } catch (err) {
      console.error(err);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleTaskDragStart = (e: any, task: Task) => {
    setDraggingTask(task);
    setDragStartX(e.clientX);
    e.dataTransfer.effectAllowed = 'move';
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleTaskDragEnd = async (e: any) => {
    if (!draggingTask) return;
    const deltaX = e.clientX - dragStartX;
    const gridEl = gridRef.current;
    if (!gridEl) { setDraggingTask(null); return; }
    const gridWidth = gridEl.clientWidth;

    const daysInView = days.length;
    const pixelsPerDay = gridWidth / daysInView;
    const deltaDays = Math.round(deltaX / pixelsPerDay);

    if (deltaDays === 0) { setDraggingTask(null); return; }

    const addDays = (dateStr: string, d: number) => {
      const result = new Date(dateStr);
      result.setDate(result.getDate() + d);
      return result.toISOString().split('T')[0];
    };

    const updatedTask: Task = {
      ...draggingTask,
      start_date: draggingTask.start_date ? addDays(draggingTask.start_date, deltaDays) : draggingTask.start_date,
      end_date: draggingTask.end_date ? addDays(draggingTask.end_date, deltaDays) : draggingTask.end_date,
    };

    setTasks(prev => prev.map(t => t.id === draggingTask.id ? updatedTask : t));
    setDraggingTask(null);

    try {
      await fetch(`/api/tasks/${draggingTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedTask),
      });
    } catch (err) {
      console.error('Failed to update task dates:', err);
      setTasks(prev => prev.map(t => t.id === draggingTask.id ? draggingTask : t));
    }
  };

  const getConflictingTaskIds = useMemo(() => {
    const conflictIds = new Set<string>();
    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i];
        const b = tasks[j];
        if (!a.project_id || !b.project_id || a.project_id !== b.project_id) continue;
        const aStart = a.start_date ? new Date(a.start_date) : null;
        const aEnd = a.end_date ? new Date(a.end_date) : null;
        const bStart = b.start_date ? new Date(b.start_date) : null;
        const bEnd = b.end_date ? new Date(b.end_date) : null;
        if (!aStart || !aEnd || !bStart || !bEnd) continue;
        if (aStart <= bEnd && aEnd >= bStart) {
          conflictIds.add(a.id);
          conflictIds.add(b.id);
        }
      }
    }
    return conflictIds;
  }, [tasks]);

  const days = useMemo(() => {
    const start = startOfMonth(viewDate);
    const end = endOfMonth(viewDate);
    return eachDayOfInterval({ start, end });
  }, [viewDate]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('temporal_analysis')}</h2>
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('timeline')}</p>
        </div>
        <div className="flex items-center gap-2 p-1 rounded-lg" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <button
            onClick={() => setViewDate(subMonths(viewDate, 1))}
            className="p-2 rounded"
            style={{ color: 'var(--tblr-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >
            <IconChevronLeft size={18} />
          </button>
          <span className="px-4 font-medium text-sm min-w-[140px] text-center" style={{ color: 'var(--tblr-text)' }}>
            {format(viewDate, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => setViewDate(addMonths(viewDate, 1))}
            className="p-2 rounded"
            style={{ color: 'var(--tblr-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >
            <IconChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        <div className="p-4 flex items-center gap-6 text-xs font-medium" style={{ borderBottom: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-sm" />
            <span>{t('project_span')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-purple-500 rounded-sm" />
            <span>{t('task')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-amber-500 rounded-full" />
            <span>{t('pending_event')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span>{t('completed_event')}</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5" style={{ color: 'var(--tblr-muted)' }}>
            <IconInfoCircle size={14} />
            <span>{t('scroll_active')}</span>
          </div>
        </div>
        <div className="overflow-x-auto" ref={containerRef}>
          <div className="min-w-[1000px] p-6 relative" ref={gridRef}>
            {/* Dependency Lines SVG Overlay */}
            <svg className="absolute inset-0 pointer-events-none z-0 w-full h-full">
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#a855f7" opacity="0.5" />
                </marker>
              </defs>
              {tasks.map(task => {
                const toCoord = taskCoords[task.id];
                if (!toCoord) return null;

                return (task.dependencies || []).map(depId => {
                  const fromCoord = taskCoords[depId];
                  if (!fromCoord) return null;

                  // Calculate path
                  const startX = fromCoord.x + fromCoord.w;
                  const startY = fromCoord.y + fromCoord.h / 2;
                  const endX = toCoord.x;
                  const endY = toCoord.y + toCoord.h / 2;

                  // Simple elbow connector
                  const midX = startX + (endX - startX) / 2;

                  return (
                    <path
                      key={`${depId}-${task.id}`}
                      d={`M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`}
                      fill="none"
                      stroke="#a855f7"
                      strokeWidth="1.5"
                      strokeOpacity="0.3"
                      markerEnd="url(#arrowhead)"
                    />
                  );
                });
              })}
            </svg>

            <div className="grid grid-cols-[200px_1fr] gap-0 relative z-10">
              {/* Header */}
              <div className="py-4 font-semibold text-sm" style={{ borderBottom: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
                {t('project_task')}
              </div>
              <div className="flex" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                {days.map(day => (
                  <div
                    key={day.toISOString()}
                    className="flex-1 min-w-[30px] text-center text-[10px] py-4"
                    style={{
                      borderLeft: '1px solid var(--tblr-border)',
                      background: isSameDay(day, new Date()) ? 'var(--tblr-primary-lt)' : undefined,
                      color: isSameDay(day, new Date()) ? 'var(--tblr-primary)' : 'var(--tblr-muted)',
                      fontWeight: isSameDay(day, new Date()) ? 'bold' : undefined,
                    }}
                  >
                    {format(day, 'd')}
                  </div>
                ))}
              </div>

              {/* Projects and Tasks */}
              {projects.map(project => {
                const projectStart = new Date(project.start_date);
                const projectEnd = new Date(project.end_date);
                const projectTasks = tasks.filter(t => t.project_id === project.id);
                
                return (
                  <Fragment key={project.id}>
                    <div className="py-4 pr-4" style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                      <div className="font-medium text-sm truncate" style={{ color: 'var(--tblr-text)' }}>{project.name}</div>
                      <div className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{project.client}</div>
                    </div>
                    <div className="flex relative py-4" style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                      {days.map(day => (
                        <div
                          key={day.toISOString()}
                          className="flex-1 min-w-[30px]"
                          style={{
                            borderLeft: '1px solid var(--tblr-border)',
                            background: isSameDay(day, new Date()) ? 'var(--tblr-primary-lt)' : undefined,
                            opacity: isSameDay(day, new Date()) ? 0.4 : undefined,
                          }}
                        />
                      ))}
                      
                      {/* Project Bar */}
                      {isWithinInterval(projectStart, { start: startOfMonth(viewDate), end: endOfMonth(viewDate) }) || 
                       isWithinInterval(projectEnd, { start: startOfMonth(viewDate), end: endOfMonth(viewDate) }) ||
                       (projectStart < startOfMonth(viewDate) && projectEnd > endOfMonth(viewDate)) ? (
                        <div 
                          className="absolute top-1/2 -translate-y-1/2 h-6 rounded-full bg-blue-500 dark:bg-blue-600 shadow-sm flex items-center px-3 overflow-hidden"
                          style={{
                            left: `${Math.max(0, (projectStart.getTime() - startOfMonth(viewDate).getTime()) / (endOfMonth(viewDate).getTime() - startOfMonth(viewDate).getTime()) * 100)}%`,
                            width: `${Math.min(100, (projectEnd.getTime() - projectStart.getTime()) / (endOfMonth(viewDate).getTime() - startOfMonth(viewDate).getTime()) * 100)}%`
                          }}
                        >
                          <span className="text-[10px] font-medium text-white whitespace-nowrap">{project.status}</span>
                        </div>
                      ) : null}
                    </div>

                    {/* Tasks */}
                    {projectTasks.map(task => {
                      const taskStart = new Date(task.start_date);
                      const taskEnd = new Date(task.end_date);
                      return (
                        <Fragment key={task.id}>
                          <div className="py-2 pr-4 pl-6" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                            <div className="text-xs truncate" style={{ color: 'var(--tblr-text)' }}>{task.title}</div>
                          </div>
                          <div className="flex relative py-2" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                            {days.map(day => (
                              <div
                                key={day.toISOString()}
                                className="flex-1 min-w-[30px]"
                                style={{
                                  borderLeft: '1px solid var(--tblr-border)',
                                  background: isSameDay(day, new Date()) ? 'var(--tblr-primary-lt)' : undefined,
                                  opacity: isSameDay(day, new Date()) ? 0.3 : undefined,
                                }}
                              />
                            ))}
                            
                            {/* Task Bar */}
                            {isWithinInterval(taskStart, { start: startOfMonth(viewDate), end: endOfMonth(viewDate) }) || 
                             isWithinInterval(taskEnd, { start: startOfMonth(viewDate), end: endOfMonth(viewDate) }) ||
                             (taskStart < startOfMonth(viewDate) && taskEnd > endOfMonth(viewDate)) ? (
                              <div
                                data-task-id={task.id}
                                draggable={true}
                                onDragStart={(e) => handleTaskDragStart(e, task)}
                                onDragEnd={handleTaskDragEnd}
                                className={cn(
                                  "absolute top-1/2 -translate-y-1/2 h-5 rounded-full bg-purple-200 dark:bg-purple-900/40 shadow-sm flex items-center overflow-hidden cursor-grab active:cursor-grabbing group",
                                  getConflictingTaskIds.has(task.id) && "ring-2 ring-orange-400 ring-offset-1"
                                )}
                                onClick={() => { setSelectedTask(task); setIsModalOpen(true); }}
                                style={{
                                  left: `${Math.max(0, (taskStart.getTime() - startOfMonth(viewDate).getTime()) / (endOfMonth(viewDate).getTime() - startOfMonth(viewDate).getTime()) * 100)}%`,
                                  width: `${Math.min(100, (taskEnd.getTime() - taskStart.getTime()) / (endOfMonth(viewDate).getTime() - startOfMonth(viewDate).getTime()) * 100)}%`
                                }}
                              >
                                {/* Progress Fill */}
                                <div 
                                  className="absolute left-0 top-0 bottom-0 bg-purple-500 dark:bg-purple-600 transition-all duration-300"
                                  style={{ width: `${task.progress}%` }}
                                />
                                
                                {/* Content Overlay */}
                                <div className="relative z-10 w-full flex items-center justify-between px-2">
                                  <span className="text-[9px] font-bold text-white drop-shadow-sm flex items-center gap-0.5">
                                    {getConflictingTaskIds.has(task.id) && <span title="Date conflict">⚠️</span>}
                                    {task.progress}%
                                  </span>

                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={task.progress}
                                    onChange={(e) => handleProgressChange(task, parseInt(e.target.value))}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-10 h-1 opacity-0 group-hover:opacity-100 transition-opacity accent-white cursor-ew-resize"
                                    title={t('update_progress')}
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {selectedTask && (
        <TaskModal 
          task={selectedTask} 
          allTasks={tasks}
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
          onSave={handleSaveTask} 
        />
      )}
    </div>
  );
}
