import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { startOfWeek, addDays, format } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { IconChevronLeft, IconChevronRight, IconBeach } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import type { TeamSchedule, TimeEntry, LeaveRequest } from '../types';
import { ErrorState, Skeleton } from './DataState';
import { colorForProject } from '../pages/Calendar';
import { LEAVE_TYPE_LABELS } from '../pages/Leave';

function toISODate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function entryHours(e: TimeEntry): number {
  if (!e.end_time) return 0;
  return (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3_600_000;
}

function formatHours(h: number): string {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  return minutes === 0 ? `${hours}h` : `${hours}h${minutes.toString().padStart(2, '0')}`;
}

export default function TeamWeekSchedule() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('fr') ? fr : enUS;

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [data, setData] = useState<TeamSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekStartStr = toISODate(weekStart);
  const days = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)), [weekStart]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<TeamSchedule>(`/api/time_entries/team-schedule?week_start=${weekStartStr}`)
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [weekStartStr]);

  useEffect(() => { load(); }, [load]);

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    (data?.projects || []).forEach(p => map.set(p.id, p.name));
    return map;
  }, [data]);

  const entriesByUserDay = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    (data?.entries || []).forEach(e => {
      const key = `${e.user_id}::${e.entry_date}`;
      const arr = map.get(key) || [];
      arr.push(e);
      map.set(key, arr);
    });
    for (const arr of map.values()) arr.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return map;
  }, [data]);

  const leavesByUserDay = useMemo(() => {
    const map = new Map<string, LeaveRequest>();
    (data?.leaves || []).forEach(l => {
      let d = new Date(l.start_date + 'T00:00:00Z');
      const end = new Date(l.end_date + 'T00:00:00Z');
      while (d <= end) {
        map.set(`${l.user_id}::${toISODate(d)}`, l);
        d = addDays(d, 1);
      }
    });
    return map;
  }, [data]);

  const totalHoursByUser = useMemo(() => {
    const totals = new Map<string, number>();
    (data?.entries || []).forEach(e => {
      totals.set(e.user_id, (totals.get(e.user_id) || 0) + entryHours(e));
    });
    return totals;
  }, [data]);

  if (loading && !data) {
    return <Skeleton className="h-[420px] w-full rounded-xl" />;
  }

  if (error) {
    return <ErrorState compact message={error} onRetry={load} />;
  }

  const employees = data?.employees || [];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div className="flex items-center justify-between p-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="p-1.5 rounded-lg transition-colors"
            style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
          >
            <IconChevronLeft size={16} />
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          >
            {t('calendar_today_btn')}
          </button>
          <button
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="p-1.5 rounded-lg transition-colors"
            style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
          >
            <IconChevronRight size={16} />
          </button>
        </div>
        <span className="text-sm font-semibold capitalize" style={{ color: 'var(--tblr-text)' }}>
          {format(days[0], 'd MMM', { locale })} – {format(days[6], 'd MMM yyyy', { locale })}
        </span>
      </div>

      {employees.length === 0 ? (
        <p className="text-xs p-6 text-center" style={{ color: 'var(--tblr-muted)' }}>{t('team_schedule_empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[900px]" style={{ gridTemplateColumns: '180px repeat(7, 1fr) 70px' }}>
            {/* Header row */}
            <div className="p-2.5 text-[11px] font-semibold" style={{ borderBottom: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }} />
            {days.map(day => (
              <div
                key={day.toISOString()}
                className="p-2.5 text-center text-[11px] font-semibold capitalize"
                style={{ borderBottom: '1px solid var(--tblr-border)', borderLeft: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              >
                {format(day, 'EEE d', { locale })}
              </div>
            ))}
            <div className="p-2.5 text-center text-[11px] font-semibold" style={{ borderBottom: '1px solid var(--tblr-border)', borderLeft: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
              {t('team_schedule_total')}
            </div>

            {/* One row per employee */}
            {employees.map(emp => (
              <div key={emp.id} style={{ display: 'contents' }}>
                <div className="p-2.5" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                  <p className="text-xs font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{emp.name}</p>
                  {emp.job_title && <p className="text-[10px] truncate" style={{ color: 'var(--tblr-muted)' }}>{emp.job_title}</p>}
                </div>
                {days.map(day => {
                  const dateKey = toISODate(day);
                  const leave = leavesByUserDay.get(`${emp.id}::${dateKey}`);
                  const dayEntries = entriesByUserDay.get(`${emp.id}::${dateKey}`) || [];
                  return (
                    <div
                      key={dateKey}
                      className="p-1.5 flex flex-col gap-1"
                      style={{ borderBottom: '1px solid var(--tblr-border)', borderLeft: '1px solid var(--tblr-border)', minHeight: 56 }}
                    >
                      {leave ? (
                        <div
                          className="rounded-md px-2 py-1 flex items-center gap-1"
                          style={{ background: '#0d6b6b', color: 'white' }}
                        >
                          <IconBeach size={12} className="shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold leading-tight">{t('team_schedule_all_day')}</p>
                            <p className="text-[9px] leading-tight opacity-90 truncate">{LEAVE_TYPE_LABELS[leave.leave_type]}</p>
                          </div>
                        </div>
                      ) : (
                        dayEntries.map(entry => {
                          const color = colorForProject(entry.project_id || undefined);
                          const projectName = entry.project_id ? projectNameById.get(entry.project_id) : undefined;
                          return (
                            <div
                              key={entry.id}
                              className="rounded-md px-2 py-1"
                              style={{ background: color + '22', color }}
                              title={projectName || ''}
                            >
                              <p className="text-[10px] font-semibold leading-tight">
                                {format(new Date(entry.start_time), 'HH:mm')}–{entry.end_time ? format(new Date(entry.end_time), 'HH:mm') : '…'}
                              </p>
                              {projectName && <p className="text-[9px] leading-tight truncate">{projectName}</p>}
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })}
                <div className="p-2.5 flex items-center justify-center" style={{ borderBottom: '1px solid var(--tblr-border)', borderLeft: '1px solid var(--tblr-border)' }}>
                  <span className="text-xs font-semibold" style={{ color: 'var(--tblr-text)' }}>{formatHours(totalHoursByUser.get(emp.id) || 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
