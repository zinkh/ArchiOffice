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

  const days = useMemo(() => {
    const start = startOfMonth(viewDate);
    const end = endOfMonth(viewDate);
    return eachDayOfInterval({ start, end });
  }, [viewDate]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('temporal_analysis')}</h2>
          <p className="text-zinc-500 dark:text-zinc-400">{t('timeline')}</p>
        </div>
        <div className="flex items-center gap-2 bg-white dark:bg-zinc-800 p-1 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
          <button 
            onClick={() => setViewDate(subMonths(viewDate, 1))}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400"
          >
            <IconChevronLeft size={18} />
          </button>
          <span className="px-4 font-medium text-sm text-zinc-900 dark:text-white min-w-[140px] text-center">
            {format(viewDate, 'MMMM yyyy')}
          </span>
          <button 
            onClick={() => setViewDate(addMonths(viewDate, 1))}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400"
          >
            <IconChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-6 text-xs font-medium text-zinc-500 dark:text-zinc-400">
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
          <div className="ml-auto flex items-center gap-1.5 text-zinc-400">
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
              <div className="py-4 font-bold text-sm text-zinc-900 dark:text-white border-b border-zinc-200 dark:border-zinc-700">
                {t('project_task')}
              </div>
              <div className="flex border-b border-zinc-200 dark:border-zinc-700">
                {days.map(day => (
                  <div 
                    key={day.toISOString()} 
                    className={cn(
                      "flex-1 min-w-[30px] text-center text-[10px] py-4 border-l border-zinc-100 dark:border-zinc-800/50",
                      isSameDay(day, new Date()) ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-bold" : "text-zinc-500 dark:text-zinc-400"
                    )}
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
                    <div className="py-4 pr-4 border-b border-zinc-100 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/50">
                      <div className="font-medium text-sm text-zinc-900 dark:text-white truncate">{project.name}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">{project.client}</div>
                    </div>
                    <div className="flex border-b border-zinc-100 dark:border-zinc-800/50 relative py-4 bg-zinc-50 dark:bg-zinc-900/50">
                      {days.map(day => (
                        <div 
                          key={day.toISOString()} 
                          className={cn(
                            "flex-1 min-w-[30px] border-l border-zinc-100 dark:border-zinc-800/50",
                            isSameDay(day, new Date()) && "bg-blue-50/50 dark:bg-blue-900/10"
                          )}
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
                          <div className="py-2 pr-4 border-b border-zinc-100 dark:border-zinc-800/50 pl-6">
                            <div className="text-xs text-zinc-700 dark:text-zinc-300 truncate">{task.title}</div>
                          </div>
                          <div className="flex border-b border-zinc-100 dark:border-zinc-800/50 relative py-2">
                            {days.map(day => (
                              <div 
                                key={day.toISOString()} 
                                className={cn(
                                  "flex-1 min-w-[30px] border-l border-zinc-100 dark:border-zinc-800/50",
                                  isSameDay(day, new Date()) && "bg-blue-50/50 dark:bg-blue-900/10"
                                )}
                              />
                            ))}
                            
                            {/* Task Bar */}
                            {isWithinInterval(taskStart, { start: startOfMonth(viewDate), end: endOfMonth(viewDate) }) || 
                             isWithinInterval(taskEnd, { start: startOfMonth(viewDate), end: endOfMonth(viewDate) }) ||
                             (taskStart < startOfMonth(viewDate) && taskEnd > endOfMonth(viewDate)) ? (
                              <div 
                                data-task-id={task.id}
                                className="absolute top-1/2 -translate-y-1/2 h-5 rounded-full bg-purple-200 dark:bg-purple-900/40 shadow-sm flex items-center overflow-hidden cursor-pointer group"
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
                                  <span className="text-[9px] font-bold text-white drop-shadow-sm">{task.progress}%</span>
                                  
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
