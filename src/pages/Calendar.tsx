import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday as dfIsToday,
  format,
  addDays,
} from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { IconChevronLeft, IconChevronRight, IconFlag3, IconChecklist, IconCircleCheck } from '@tabler/icons-react';
import { fetchJson } from '../lib/api';
import type { Project, Milestone, Task } from '../types';
import { ErrorState, Skeleton } from '../components/DataState';
import { cn } from '../lib/utils';

interface CalEvent {
  id: string;
  date: string;
  title: string;
  type: 'milestone' | 'task';
  projectId?: string;
  projectName?: string;
  completed?: boolean;
}

const PROJECT_COLORS = ['#206bc4', '#2fb344', '#f76707', '#ae3ec9', '#d63939', '#0ca678', '#f59f00', '#4263eb'];

function colorForProject(projectId?: string): string {
  if (!projectId) return '#6c7a91';
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language?.startsWith('fr') ? fr : enUS;

  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectsData, milestonesData, tasksData] = await Promise.all([
        fetchJson('/api/projects'),
        fetchJson('/api/milestones'),
        fetchJson('/api/tasks'),
      ]);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setMilestones(Array.isArray(milestonesData) ? milestonesData : []);
      setTasks(Array.isArray(tasksData) ? tasksData : []);
    } catch (err) {
      console.error('Failed to load calendar data:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach(p => map.set(p.id, p.name));
    return map;
  }, [projects]);

  const events = useMemo<CalEvent[]>(() => {
    const fromMilestones: CalEvent[] = milestones
      .filter(m => !!m.due_date)
      .map(m => ({
        id: `m-${m.id}`,
        date: m.due_date,
        title: m.title,
        type: 'milestone',
        projectId: m.project_id,
        projectName: m.project_id ? projectNameById.get(m.project_id) : undefined,
        completed: m.completed,
      }));
    const fromTasks: CalEvent[] = tasks
      .filter(task => !!(task.due_date || task.end_date))
      .map(task => ({
        id: `t-${task.id}`,
        date: (task.due_date || task.end_date) as string,
        title: task.title,
        type: 'task',
        projectId: task.project_id,
        projectName: task.project_id ? projectNameById.get(task.project_id) : undefined,
        completed: task.completed ?? task.status === 'done',
      }));
    return [...fromMilestones, ...fromTasks];
  }, [milestones, tasks, projectNameById]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    events.forEach(ev => {
      const key = ev.date.slice(0, 10);
      const arr = map.get(key) || [];
      arr.push(ev);
      map.set(key, arr);
    });
    return map;
  }, [events]);

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);
  const thisWeekEvents = events
    .filter(ev => {
      const d = new Date(ev.date);
      return d >= weekStart && d <= weekEnd && !ev.completed;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const selectedDayEvents = (eventsByDay.get(format(selectedDay, 'yyyy-MM-dd')) || []).sort((a, b) => a.title.localeCompare(b.title));

  const weekdayLabels = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: 7 }).map((_, i) => format(addDays(start, i), 'EEEEEE', { locale }));
  }, [locale]);

  if (loading && projects.length === 0 && events.length === 0 && !error) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('calendar')}</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{t('calendar_page_subtitle')}</p>
        </div>
        <Skeleton className="h-[520px] w-full rounded-xl" />
      </div>
    );
  }

  if (error && events.length === 0 && projects.length === 0) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('calendar')}</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{t('calendar_page_subtitle')}</p>
        </div>
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('calendar')}</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{t('calendar_page_subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewDate(subMonths(viewDate, 1))}
            className="p-1.5 rounded-lg transition-colors"
            style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
          >
            <IconChevronLeft size={16} />
          </button>
          <button
            onClick={() => { setViewDate(new Date()); setSelectedDay(new Date()); }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          >
            {t('calendar_today_btn')}
          </button>
          <button
            onClick={() => setViewDate(addMonths(viewDate, 1))}
            className="p-1.5 rounded-lg transition-colors"
            style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
          >
            <IconChevronRight size={16} />
          </button>
          <span className="text-sm font-semibold capitalize ml-1" style={{ color: 'var(--tblr-text)' }}>
            {format(viewDate, 'MMMM yyyy', { locale })}
          </span>
        </div>
      </div>

      {error && (
        <ErrorState compact message={error} onRetry={load} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        {/* ── Month grid ── */}
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
          <div className="grid grid-cols-7" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
            {weekdayLabels.map((label, i) => (
              <div key={i} className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const dayEvents = eventsByDay.get(key) || [];
              const inMonth = isSameMonth(day, viewDate);
              const selected = isSameDay(day, selectedDay);
              const today = dfIsToday(day);
              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(day)}
                  className="min-h-[92px] p-1.5 flex flex-col items-start text-left transition-colors"
                  style={{
                    borderRight: '1px solid var(--tblr-border)',
                    borderBottom: '1px solid var(--tblr-border)',
                    background: selected ? 'var(--tblr-primary-lt)' : 'transparent',
                    opacity: inMonth ? 1 : 0.4,
                  }}
                >
                  <span
                    className={cn('text-[11px] font-semibold w-5 h-5 flex items-center justify-center rounded-full mb-1')}
                    style={today ? { background: 'var(--tblr-primary)', color: 'white' } : { color: 'var(--tblr-text)' }}
                  >
                    {format(day, 'd')}
                  </span>
                  <div className="flex flex-col gap-0.5 w-full">
                    {dayEvents.slice(0, 3).map(ev => (
                      <span
                        key={ev.id}
                        className="text-[10px] px-1 py-0.5 rounded truncate w-full"
                        style={{
                          background: colorForProject(ev.projectId) + '22',
                          color: colorForProject(ev.projectId),
                          textDecoration: ev.completed ? 'line-through' : 'none',
                        }}
                        title={ev.title}
                      >
                        {ev.title}
                      </span>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>+{dayEvents.length - 3}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Sidebar: this week + selected day detail ── */}
        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <h2 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--tblr-text)' }}>{t('calendar_this_week')}</h2>
            {thisWeekEvents.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('calendar_no_events_week')}</p>
            ) : (
              <div className="space-y-2">
                {thisWeekEvents.map(ev => (
                  <div key={ev.id} className="flex items-start gap-2">
                    {ev.type === 'milestone' ? (
                      <IconFlag3 size={14} className="mt-0.5 shrink-0" style={{ color: colorForProject(ev.projectId) }} />
                    ) : (
                      <IconChecklist size={14} className="mt-0.5 shrink-0" style={{ color: colorForProject(ev.projectId) }} />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{ev.title}</p>
                      <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>
                        {format(new Date(ev.date), 'EEE d MMM', { locale })}{ev.projectName ? ` · ${ev.projectName}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <h2 className="text-[13px] font-semibold mb-1" style={{ color: 'var(--tblr-text)' }}>
              {format(selectedDay, 'EEEE d MMMM', { locale })}
            </h2>
            {selectedDayEvents.length === 0 ? (
              <p className="text-xs mt-2" style={{ color: 'var(--tblr-muted)' }}>{t('calendar_no_events_day')}</p>
            ) : (
              <div className="space-y-2 mt-2">
                {selectedDayEvents.map(ev => (
                  <div
                    key={ev.id}
                    className="flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors"
                    style={{ background: 'var(--tblr-surface-2)' }}
                    onClick={() => ev.projectId && navigate(`/projects/${ev.projectId}`)}
                  >
                    {ev.completed ? (
                      <IconCircleCheck size={14} className="mt-0.5 shrink-0" style={{ color: '#2fb344' }} />
                    ) : ev.type === 'milestone' ? (
                      <IconFlag3 size={14} className="mt-0.5 shrink-0" style={{ color: colorForProject(ev.projectId) }} />
                    ) : (
                      <IconChecklist size={14} className="mt-0.5 shrink-0" style={{ color: colorForProject(ev.projectId) }} />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium" style={{ color: 'var(--tblr-text)', textDecoration: ev.completed ? 'line-through' : 'none' }}>
                        {ev.title}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>
                        {ev.type === 'milestone' ? t('calendar_milestone') : t('calendar_task')}
                        {ev.projectName ? ` · ${ev.projectName}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
