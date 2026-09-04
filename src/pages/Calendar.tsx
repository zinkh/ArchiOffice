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
  parseISO,
  differenceInCalendarDays,
} from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { IconChevronLeft, IconChevronRight, IconFlag3, IconChecklist, IconCircleCheck, IconCalendar, IconPlus, IconBrandGoogle, IconRefresh, IconLoader2 } from '@tabler/icons-react';
import { fetchJson, apiFetch } from '../lib/api';
import type { Project, Milestone, Task, TeamMember } from '../types';
import { ErrorState, Skeleton } from '../components/DataState';
import { cn } from '../lib/utils';
import TeamWeekSchedule from '../components/TeamWeekSchedule';
import { CalendarEventModal, type CalendarEventInitial } from '../components/CalendarEventModal';
import { TaskFormModal, type TaskFormInitial } from '../components/tasks/TaskFormModal';

interface CalEvent {
  id: string;
  date: string;
  title: string;
  // 'google' isn't populated yet (no external-calendar sync exists today)
  // but is reserved here so a future addition doesn't need to touch every
  // switch/condition on `ev.type` written for the milestone/task cases.
  type: 'milestone' | 'task' | 'google';
  projectId?: string | null;
  projectName?: string;
  completed?: boolean;
  overdue?: boolean;
}

const PROJECT_COLORS = ['#206bc4', '#2fb344', '#f76707', '#ae3ec9', '#d63939', '#0ca678', '#f59f00', '#4263eb'];

export function colorForProject(projectId?: string | null): string {
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
  const [view, setView] = useState<'month' | 'team' | 'agenda'>('month');
  const [filterProjectId, setFilterProjectId] = useState<string>('all');
  const [showMilestones, setShowMilestones] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  const [eventModal, setEventModal] = useState<CalendarEventInitial | null>(null);
  const [taskModal, setTaskModal] = useState<TaskFormInitial | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [draggingEvent, setDraggingEvent] = useState<{ calId: string; type: 'milestone' | 'task'; originalDate: string } | null>(null);
  const [dragOverDayKey, setDragOverDayKey] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; email: string | null; last_synced_at: string | null } | null>(null);
  const [googleEvents, setGoogleEvents] = useState<{ id: string; title: string; date: string }[]>([]);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googleNotice, setGoogleNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectsData, milestonesData, tasksData, teamData] = await Promise.all([
        fetchJson('/api/projects'),
        fetchJson('/api/milestones'),
        fetchJson('/api/tasks'),
        fetchJson('/api/team'),
      ]);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setMilestones(Array.isArray(milestonesData) ? milestonesData : []);
      setTasks(Array.isArray(tasksData) ? tasksData : []);
      setTeam(Array.isArray(teamData) ? teamData : []);
    } catch (err) {
      console.error('Failed to load calendar data:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Parsed as local-time components (not `new Date(value)`, which reads an
  // <input type="date"> value as UTC midnight and can land on the wrong day
  // once shifted to the browser's local timezone).
  const jumpToDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!value) return;
    const [y, m, d] = value.split('-').map(Number);
    const picked = new Date(y, m - 1, d);
    setViewDate(picked);
    setSelectedDay(picked);
  };

  const openCreateMilestone = (prefillDate?: Date) => {
    const dateStr = prefillDate ? format(prefillDate, 'yyyy-MM-dd') : undefined;
    setEventModal({ eventType: 'milestone', due_date: dateStr, start_date: dateStr, end_date: dateStr });
  };

  const openCreateTask = (prefillDate?: Date) => {
    const dateStr = prefillDate ? format(prefillDate, 'yyyy-MM-dd') : new Date().toISOString().slice(0, 10);
    setTaskModal({ start_date: dateStr, end_date: dateStr, due_date: dateStr });
  };

  const openEditEvent = (ev: CalEvent) => {
    if (ev.type === 'google') return; // pulled external events aren't editable — see Étape 4
    if (ev.type === 'milestone') {
      const m = milestones.find(x => `m-${x.id}` === ev.id);
      if (!m) return;
      setEventModal({ eventType: 'milestone', id: m.id, project_id: m.project_id, title: m.title, due_date: m.due_date, completed: m.completed, duration_days: m.duration_days ?? null, dependencies: m.dependencies });
    } else {
      // Les tâches passent par le formulaire de tâche partagé avec le Kanban,
      // seul endroit qui expose description, priorité et assignation.
      const tsk = tasks.find(x => `t-${x.id}` === ev.id);
      if (!tsk) return;
      setTaskModal({ ...tsk });
    }
  };

  const closeEventModal = () => setEventModal(null);
  const handleEventSaved = () => { setEventModal(null); load(); };
  const handleEventDeleted = () => { setEventModal(null); load(); };
  const afterTaskWrite = () => { setTaskModal(null); load(); };

  const handleDragStart = (ev: CalEvent) => {
    if (ev.type === 'google') return; // pulled external events aren't draggable — see Étape 4
    setDraggingEvent({ calId: ev.id, type: ev.type, originalDate: ev.date });
  };
  const handleDragEnd = () => { setDraggingEvent(null); setDragOverDayKey(null); };

  // Always sends the full record with only the date field(s) overridden —
  // never a bare { due_date } / { start_date, end_date } patch. Both PUT
  // routes default an omitted `dependencies` (and milestones also
  // `completed`/`duration_days`) to empty/false/null rather than leaving
  // it untouched, so a partial patch would silently wipe that data (the
  // same reason CalendarEventModal always round-trips `dependencies`).
  const handleDrop = async (day: Date) => {
    const dragging = draggingEvent;
    setDraggingEvent(null);
    setDragOverDayKey(null);
    if (!dragging) return;
    const newDateStr = format(day, 'yyyy-MM-dd');
    if (newDateStr === dragging.originalDate.slice(0, 10)) return;

    if (dragging.type === 'milestone') {
      const id = dragging.calId.slice(2);
      const original = milestones.find(m => m.id === id);
      if (!original) return;
      const updated: Milestone = { ...original, due_date: newDateStr };
      setMilestones(prev => prev.map(m => m.id === id ? updated : m));
      try {
        await apiFetch(`/api/milestones/${id}`, { method: 'PUT', body: JSON.stringify(updated) });
      } catch (err: any) {
        setMilestones(prev => prev.map(m => m.id === id ? original : m));
        setDragError(err?.message || t('calendar_reschedule_error') as string);
      }
    } else {
      const id = dragging.calId.slice(2);
      const original = tasks.find(x => x.id === id);
      if (!original) return;
      const deltaDays = differenceInCalendarDays(day, parseISO(dragging.originalDate.slice(0, 10)));
      const updated: Task = {
        ...original,
        start_date: format(addDays(parseISO(original.start_date), deltaDays), 'yyyy-MM-dd'),
        end_date: format(addDays(parseISO(original.end_date), deltaDays), 'yyyy-MM-dd'),
      };
      setTasks(prev => prev.map(x => x.id === id ? updated : x));
      try {
        await apiFetch(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(updated) });
      } catch (err: any) {
        setTasks(prev => prev.map(x => x.id === id ? original : x));
        setDragError(err?.message || t('calendar_reschedule_error') as string);
      }
    }
  };

  const GOOGLE_PULL_THROTTLE_MS = 5 * 60 * 1000;

  const loadGoogleStatus = useCallback(async () => {
    try {
      const status = await apiFetch<{ connected: boolean; email: string | null; last_synced_at: string | null }>('/api/google-calendar/status');
      setGoogleStatus(status);
    } catch {
      setGoogleStatus({ connected: false, email: null, last_synced_at: null });
    }
  }, []);

  useEffect(() => { loadGoogleStatus(); }, [loadGoogleStatus]);

  // Handles the redirect back from Google's consent screen (or Zoho's,
  // already-established pattern in Settings.tsx) — surfaces a toast and
  // strips the query param so it doesn't reappear on refresh/back.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('google_calendar_connected')) {
      setGoogleNotice(t('calendar_google_connected_toast') as string);
      loadGoogleStatus();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.has('google_calendar_error')) {
      setGoogleNotice(t('calendar_google_connect_error') as string);
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pullGoogleEvents = useCallback(async (force = false) => {
    if (!googleStatus?.connected) return;
    const throttleKey = 'calendar_google_last_pull';
    if (!force) {
      const last = Number(localStorage.getItem(throttleKey) || 0);
      if (Date.now() - last < GOOGLE_PULL_THROTTLE_MS) return;
    }
    const gStart = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 1 });
    const gEnd = endOfWeek(endOfMonth(viewDate), { weekStartsOn: 1 });
    try {
      const data = await apiFetch<{ id: string; title: string; date: string }[]>(
        `/api/google-calendar/events?start=${format(gStart, 'yyyy-MM-dd')}&end=${format(gEnd, 'yyyy-MM-dd')}`
      );
      setGoogleEvents(Array.isArray(data) ? data : []);
      localStorage.setItem(throttleKey, String(Date.now()));
    } catch (err) {
      console.error('Failed to pull Google Calendar events:', err);
    }
  }, [googleStatus?.connected, viewDate]);

  useEffect(() => { pullGoogleEvents(); }, [pullGoogleEvents]);

  const connectGoogleCalendar = async () => {
    try {
      const { url } = await apiFetch<{ url: string }>('/api/google-calendar/auth');
      window.location.href = url;
    } catch (err: any) {
      setGoogleNotice(err?.message || t('calendar_google_connect_error') as string);
    }
  };

  const syncGoogleCalendar = async () => {
    setGoogleSyncing(true);
    setGoogleNotice(null);
    try {
      await apiFetch('/api/google-calendar/sync', { method: 'POST' });
      await Promise.all([loadGoogleStatus(), pullGoogleEvents(true)]);
      setGoogleNotice(t('calendar_google_sync_done') as string);
    } catch (err: any) {
      setGoogleNotice(err?.message || t('calendar_google_sync_error') as string);
    } finally {
      setGoogleSyncing(false);
    }
  };

  const disconnectGoogleCalendar = async () => {
    try {
      await apiFetch('/api/google-calendar/disconnect', { method: 'DELETE' });
      setGoogleStatus({ connected: false, email: null, last_synced_at: null });
      setGoogleEvents([]);
    } catch (err: any) {
      setGoogleNotice(err?.message || t('calendar_google_disconnect_error') as string);
    }
  };

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach(p => map.set(p.id, p.name));
    return map;
  }, [projects]);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const events = useMemo<CalEvent[]>(() => {
    const fromMilestones: CalEvent[] = milestones
      .filter(m => !!m.due_date)
      .map(m => {
        const completed = !!m.completed;
        return {
          id: `m-${m.id}`,
          date: m.due_date,
          title: m.title,
          type: 'milestone' as const,
          projectId: m.project_id,
          projectName: m.project_id ? projectNameById.get(m.project_id) : undefined,
          completed,
          overdue: !completed && m.due_date.slice(0, 10) < todayStr,
        };
      });
    const fromTasks: CalEvent[] = tasks
      .filter(task => !!(task.due_date || task.end_date))
      .map(task => {
        const date = (task.due_date || task.end_date) as string;
        const completed = task.status === 'done';
        return {
          id: `t-${task.id}`,
          date,
          title: task.title,
          type: 'task' as const,
          projectId: task.project_id,
          projectName: task.project_id ? projectNameById.get(task.project_id) : undefined,
          completed,
          overdue: !completed && date.slice(0, 10) < todayStr,
        };
      });
    // Pulled Google events are never editable/draggable here (see
    // handleDragStart/openEditEvent, which both bail on type === 'google')
    // — that's what keeps the pull side of the sync read-only end-to-end,
    // not just at the API layer.
    const fromGoogle: CalEvent[] = googleEvents.map(g => ({
      id: g.id,
      date: g.date,
      title: g.title,
      type: 'google' as const,
    }));
    return [...fromMilestones, ...fromTasks, ...fromGoogle];
  }, [milestones, tasks, projectNameById, todayStr, googleEvents]);

  // Filters apply once, upstream of every consumer below (day grid, "this
  // week" sidebar, selected-day panel, Agenda view) so they all stay in sync.
  const filteredEvents = useMemo(() => events.filter(ev => {
    if (filterProjectId !== 'all' && ev.projectId !== filterProjectId) return false;
    if (ev.type === 'milestone' && !showMilestones) return false;
    if (ev.type === 'task' && !showTasks) return false;
    return true;
  }), [events, filterProjectId, showMilestones, showTasks]);

  const overdueCount = useMemo(() => filteredEvents.filter(ev => ev.overdue).length, [filteredEvents]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    filteredEvents.forEach(ev => {
      const key = ev.date.slice(0, 10);
      const arr = map.get(key) || [];
      arr.push(ev);
      map.set(key, arr);
    });
    return map;
  }, [filteredEvents]);

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);
  const thisWeekEvents = filteredEvents
    .filter(ev => {
      const d = new Date(ev.date);
      return d >= weekStart && d <= weekEnd && !ev.completed;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const selectedDayEvents = (eventsByDay.get(format(selectedDay, 'yyyy-MM-dd')) || []).sort((a, b) => a.title.localeCompare(b.title));

  // Agenda view: overdue items surfaced first (a plain chronological list
  // would bury old overdue items among more recent future ones), then
  // upcoming (today onward) grouped by day.
  const overdueEvents = useMemo(
    () => filteredEvents.filter(ev => ev.overdue).sort((a, b) => a.date.localeCompare(b.date)),
    [filteredEvents]
  );
  const upcomingByDay = useMemo(() => {
    const upcoming = filteredEvents
      .filter(ev => !ev.overdue && ev.date.slice(0, 10) >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date));
    const map = new Map<string, CalEvent[]>();
    upcoming.forEach(ev => {
      const key = ev.date.slice(0, 10);
      const arr = map.get(key) || [];
      arr.push(ev);
      map.set(key, arr);
    });
    return map;
  }, [filteredEvents, todayStr]);

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
        {view === 'month' && (
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
            <div className="relative flex items-center ml-1">
              <IconCalendar size={14} className="absolute left-2 pointer-events-none" style={{ color: 'var(--tblr-muted)' }} />
              <input
                type="date"
                value={format(viewDate, 'yyyy-MM-dd')}
                onChange={jumpToDate}
                aria-label={t('calendar_jump_to_date') as string}
                title={t('calendar_jump_to_date') as string}
                className="pl-7 pr-2 py-1.5 rounded-lg text-xs outline-none"
                style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)', colorScheme: 'light dark' }}
              />
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => openCreateMilestone(view === 'month' ? selectedDay : undefined)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
            style={{ background: 'var(--tblr-primary)' }}
          >
            <IconPlus size={14} /> {t('calendar_type_milestone')}
          </button>
          <button
            onClick={() => openCreateTask(view === 'month' ? selectedDay : undefined)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)' }}
          >
            <IconPlus size={14} /> {t('calendar_type_task')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg w-fit" style={{ background: 'var(--tblr-surface-2)' }}>
          <button
            onClick={() => setView('month')}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={view === 'month' ? { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', boxShadow: 'var(--tblr-shadow)' } : { color: 'var(--tblr-muted)' }}
          >
            {t('calendar_view_month')}
          </button>
          <button
            onClick={() => setView('agenda')}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={view === 'agenda' ? { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', boxShadow: 'var(--tblr-shadow)' } : { color: 'var(--tblr-muted)' }}
          >
            {t('calendar_view_agenda')}
          </button>
          <button
            onClick={() => setView('team')}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={view === 'team' ? { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', boxShadow: 'var(--tblr-shadow)' } : { color: 'var(--tblr-muted)' }}
          >
            {t('calendar_view_team')}
          </button>
        </div>

        {overdueCount > 0 && (view === 'month' || view === 'agenda') && (
          <button
            onClick={() => setView('agenda')}
            className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors"
            style={{ background: '#fff5f5', color: '#c92a2a', border: '1px solid #ffc9c9' }}
          >
            {t('calendar_overdue_count', { count: overdueCount })}
          </button>
        )}

        {(view === 'month' || view === 'agenda') && (
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <select
              value={filterProjectId}
              onChange={e => setFilterProjectId(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg text-xs outline-none"
              style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)' }}
            >
              <option value="all">{t('calendar_filter_all_projects')}</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={() => setShowMilestones(v => !v)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={showMilestones
                ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary)' }
                : { border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
            >
              {t('calendar_filter_milestones')}
            </button>
            <button
              onClick={() => setShowTasks(v => !v)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={showTasks
                ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary)' }
                : { border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
            >
              {t('calendar_filter_tasks')}
            </button>
          </div>
        )}

        <div className={cn('flex items-center gap-2', view !== 'month' && view !== 'agenda' && 'ml-auto')}>
          {googleStatus?.connected ? (
            <>
              <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }} title={googleStatus.email || ''}>
                <IconBrandGoogle size={13} /> {googleStatus.email || t('calendar_google_connected')}
              </span>
              <button
                onClick={syncGoogleCalendar}
                disabled={googleSyncing}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-60"
                style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                title={t('calendar_google_sync') as string}
              >
                {googleSyncing ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />}
                {t('calendar_google_sync')}
              </button>
              <button
                onClick={disconnectGoogleCalendar}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                style={{ color: 'var(--tblr-danger)' }}
              >
                {t('calendar_google_disconnect')}
              </button>
            </>
          ) : (
            <button
              onClick={connectGoogleCalendar}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              <IconBrandGoogle size={13} /> {t('calendar_google_connect')}
            </button>
          )}
        </div>
      </div>

      {googleNotice && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
          {googleNotice}
          <button onClick={() => setGoogleNotice(null)} className="font-semibold shrink-0 hover:underline">{t('btn_close')}</button>
        </div>
      )}

      {error && view === 'month' && (
        <ErrorState compact message={error} onRetry={load} />
      )}

      {dragError && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs" style={{ background: '#fff5f5', border: '1px solid #ffc9c9', color: '#c92a2a' }}>
          {dragError}
          <button onClick={() => setDragError(null)} className="font-semibold shrink-0 hover:underline">{t('btn_close')}</button>
        </div>
      )}

      {view === 'team' && <TeamWeekSchedule />}

      {view === 'agenda' && (
        <div className="rounded-xl p-4 space-y-5" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
          {overdueEvents.length > 0 && (
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: '#c92a2a' }}>
                {t('calendar_overdue')}
              </h2>
              <div className="space-y-1.5">
                {overdueEvents.map(ev => (
                  <div
                    key={ev.id}
                    className="flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors"
                    style={{ background: '#fff5f5', borderLeft: '2px solid #c92a2a' }}
                    onClick={() => openEditEvent(ev)}
                  >
                    {ev.type === 'milestone' ? (
                      <IconFlag3 size={14} className="mt-0.5 shrink-0" style={{ color: '#c92a2a' }} />
                    ) : (
                      <IconChecklist size={14} className="mt-0.5 shrink-0" style={{ color: '#c92a2a' }} />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium" style={{ color: 'var(--tblr-text)' }}>{ev.title}</p>
                      <p className="text-[10px]" style={{ color: '#c92a2a' }}>
                        {format(new Date(ev.date), 'EEE d MMM', { locale })}{ev.projectName ? ` · ${ev.projectName}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {upcomingByDay.size === 0 && overdueEvents.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('calendar_no_events_agenda')}</p>
          ) : (
            Array.from(upcomingByDay.entries()).map(([dayKey, dayEvents]) => (
              <div key={dayKey}>
                <h2 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--tblr-muted)' }}>
                  {format(new Date(dayKey), 'EEEE d MMMM', { locale })}
                </h2>
                <div className="space-y-1.5">
                  {dayEvents.map(ev => (
                    <div
                      key={ev.id}
                      className="flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors"
                      style={{ background: 'var(--tblr-surface-2)' }}
                      onClick={() => openEditEvent(ev)}
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
              </div>
            ))
          )}
        </div>
      )}

      {view === 'month' && (
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
                // A <div> here (not a <button>) so the hover "+" below can be
                // a real nested <button> — a <button> can't legally contain
                // another interactive element.
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedDay(day)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDay(day); } }}
                  onDragOver={e => { if (draggingEvent) e.preventDefault(); }}
                  onDragEnter={() => { if (draggingEvent) setDragOverDayKey(key); }}
                  onDragLeave={() => setDragOverDayKey(prev => (prev === key ? null : prev))}
                  onDrop={() => handleDrop(day)}
                  className="group relative min-h-[92px] p-1.5 flex flex-col items-start text-left transition-colors cursor-pointer"
                  style={{
                    borderRight: '1px solid var(--tblr-border)',
                    borderBottom: '1px solid var(--tblr-border)',
                    background: dragOverDayKey === key ? 'var(--tblr-primary-lt)' : selected ? 'var(--tblr-primary-lt)' : 'transparent',
                    opacity: inMonth ? 1 : 0.4,
                    outline: dragOverDayKey === key ? '2px dashed var(--tblr-primary)' : 'none',
                    outlineOffset: '-2px',
                  }}
                >
                  <button
                    onClick={e => { e.stopPropagation(); openCreateMilestone(day); }}
                    className="absolute top-1 right-1 w-4 h-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-primary)' }}
                    title={t('calendar_add_event') as string}
                  >
                    <IconPlus size={11} />
                  </button>
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
                        draggable={ev.type !== 'google'}
                        onDragStart={e => { e.stopPropagation(); handleDragStart(ev); }}
                        onDragEnd={e => { e.stopPropagation(); handleDragEnd(); }}
                        onClick={e => { e.stopPropagation(); openEditEvent(ev); }}
                        className="text-[10px] px-1 py-0.5 rounded truncate w-full cursor-pointer"
                        style={{
                          background: colorForProject(ev.projectId) + '22',
                          color: colorForProject(ev.projectId),
                          textDecoration: ev.completed ? 'line-through' : 'none',
                          borderLeft: ev.overdue ? '2px solid #c92a2a' : 'none',
                          opacity: draggingEvent?.calId === ev.id ? 0.4 : 1,
                        }}
                        title={ev.overdue ? `${ev.title} — ${t('calendar_overdue')}` : ev.title}
                      >
                        {ev.title}
                      </span>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>+{dayEvents.length - 3}</span>
                    )}
                  </div>
                </div>
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
                  <div
                    key={ev.id}
                    onClick={() => openEditEvent(ev)}
                    className="flex items-start gap-2 cursor-pointer"
                    style={{ borderLeft: ev.overdue ? '2px solid #c92a2a' : 'none', paddingLeft: ev.overdue ? 6 : 0 }}
                  >
                    {ev.type === 'milestone' ? (
                      <IconFlag3 size={14} className="mt-0.5 shrink-0" style={{ color: ev.overdue ? '#c92a2a' : colorForProject(ev.projectId) }} />
                    ) : (
                      <IconChecklist size={14} className="mt-0.5 shrink-0" style={{ color: ev.overdue ? '#c92a2a' : colorForProject(ev.projectId) }} />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{ev.title}</p>
                      <p className="text-[10px]" style={{ color: ev.overdue ? '#c92a2a' : 'var(--tblr-muted)' }}>
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
                    style={{ background: ev.overdue ? '#fff5f5' : 'var(--tblr-surface-2)', borderLeft: ev.overdue ? '2px solid #c92a2a' : 'none' }}
                    onClick={() => openEditEvent(ev)}
                  >
                    {ev.completed ? (
                      <IconCircleCheck size={14} className="mt-0.5 shrink-0" style={{ color: '#2fb344' }} />
                    ) : ev.type === 'milestone' ? (
                      <IconFlag3 size={14} className="mt-0.5 shrink-0" style={{ color: ev.overdue ? '#c92a2a' : colorForProject(ev.projectId) }} />
                    ) : (
                      <IconChecklist size={14} className="mt-0.5 shrink-0" style={{ color: ev.overdue ? '#c92a2a' : colorForProject(ev.projectId) }} />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium" style={{ color: 'var(--tblr-text)', textDecoration: ev.completed ? 'line-through' : 'none' }}>
                        {ev.title}
                      </p>
                      <p className="text-[10px]" style={{ color: ev.overdue ? '#c92a2a' : 'var(--tblr-muted)' }}>
                        {ev.type === 'milestone' ? t('calendar_milestone') : t('calendar_task')}
                        {ev.overdue ? ` · ${t('calendar_overdue')}` : ''}
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
      )}

      {eventModal && (
        <CalendarEventModal
          initial={eventModal}
          projects={projects}
          onClose={closeEventModal}
          onSaved={handleEventSaved}
          onDeleted={handleEventDeleted}
          onOpenProject={projectId => { setEventModal(null); navigate(`/projects/${projectId}`); }}
        />
      )}

      {taskModal && (
        <TaskFormModal
          initial={taskModal}
          projects={projects}
          team={team}
          allTasks={tasks}
          onClose={() => setTaskModal(null)}
          onSaved={afterTaskWrite}
          onDeleted={afterTaskWrite}
          onOpenProject={projectId => { setTaskModal(null); navigate(`/projects/${projectId}`); }}
        />
      )}
    </div>
  );
}
