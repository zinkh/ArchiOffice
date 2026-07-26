import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlayerPlay, IconPlayerStop, IconPlus, IconTrash, IconEdit, IconDownload, IconFileSpreadsheet } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { useUser } from '../UserContext';
import { useSettings } from '../hooks/useSettings';
import { exportWeeklyTimesheetPdf, exportAdminMatrixExcel, exportMonthlySummaryExcel } from '../lib/hrExport';
import type { TimeEntry, TimeWeeklySummary, TimeTeamSummaryEntry, TimeAdminMatrix, TimeMonthlySummaryEntry, Project } from '../types';

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function mondayOf(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

function formatHours(h: number): string {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  return `${hours}h${minutes.toString().padStart(2, '0')}`;
}

const DAY_LABELS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export default function TimeTracking() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const { settings } = useSettings();
  const isAdmin = currentUser?.system_role === 'admin';
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [current, setCurrent] = useState<TimeEntry | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [summary, setSummary] = useState<TimeWeeklySummary | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tab, setTab] = useState<'me' | 'team' | 'admin'>('me');
  const [teamData, setTeamData] = useState<TimeTeamSummaryEntry[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [clockProjectId, setClockProjectId] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<{ id?: string; entry_date: string; start: string; end: string; project_id: string; description: string }>(
    { entry_date: toISODate(new Date()), start: '09:00', end: '17:00', project_id: '', description: '' },
  );
  const [matrix, setMatrix] = useState<TimeAdminMatrix | null>(null);
  const [monthValue, setMonthValue] = useState(() => toISODate(new Date()).slice(0, 7));
  const [monthlyRows, setMonthlyRows] = useState<TimeMonthlySummaryEntry[] | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekStartStr = toISODate(weekStart);
  const weekEndStr = toISODate(weekEnd);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const refreshCurrent = () => apiFetch<TimeEntry | null>('/api/time_entries/current').then(setCurrent).catch(() => {});

  const refreshWeek = () => {
    apiFetch<TimeEntry[]>(`/api/time_entries?start_date=${weekStartStr}&end_date=${weekEndStr}`).then(setEntries).catch(() => {});
    apiFetch<TimeWeeklySummary>(`/api/time_entries/weekly-summary?week_start=${weekStartStr}`).then(setSummary).catch(() => {});
  };

  useEffect(() => { refreshCurrent(); apiFetch<Project[]>('/api/projects').then(setProjects).catch(() => {}); }, []);
  useEffect(() => { refreshWeek(); }, [weekStartStr]);
  useEffect(() => {
    apiFetch<TimeTeamSummaryEntry[]>(`/api/time_entries/team-summary?week_start=${weekStartStr}`)
      .then(setTeamData)
      .catch(() => setTeamData(null));
  }, [weekStartStr]);
  useEffect(() => {
    if (!isAdmin || tab !== 'admin') return;
    apiFetch<TimeAdminMatrix>(`/api/time_entries/admin-matrix?start_date=${weekStartStr}&end_date=${weekEndStr}`)
      .then(setMatrix).catch(() => setMatrix(null));
  }, [isAdmin, tab, weekStartStr, weekEndStr]);

  const fetchMonthly = () => {
    setMonthlyLoading(true);
    apiFetch<TimeMonthlySummaryEntry[]>(`/api/time_entries/monthly-summary?month=${monthValue}`)
      .then(setMonthlyRows).catch(() => setMonthlyRows(null))
      .finally(() => setMonthlyLoading(false));
  };
  useEffect(() => { if (isAdmin && tab === 'admin') fetchMonthly(); }, [isAdmin, tab, monthValue]);

  const elapsedLabel = useMemo(() => {
    if (!current) return null;
    const ms = now - new Date(current.start_time).getTime();
    const totalMinutes = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h${m.toString().padStart(2, '0')}`;
  }, [current, now]);

  const handleClockIn = async () => {
    try {
      await apiFetch('/api/time_entries/clock-in', { method: 'POST', body: JSON.stringify({ project_id: clockProjectId || undefined }) });
      refreshCurrent(); refreshWeek();
    } catch (e: any) { alert(e.message || t('time_tracking_clockin_error')); }
  };

  const handleClockOut = async () => {
    try {
      await apiFetch('/api/time_entries/clock-out', { method: 'POST' });
      refreshCurrent(); refreshWeek();
    } catch (e: any) { alert(e.message || t('time_tracking_clockout_error')); }
  };

  const openManual = (entry?: TimeEntry) => {
    if (entry) {
      setManualForm({
        id: entry.id, entry_date: entry.entry_date,
        start: new Date(entry.start_time).toTimeString().slice(0, 5),
        end: entry.end_time ? new Date(entry.end_time).toTimeString().slice(0, 5) : '17:00',
        project_id: entry.project_id || '', description: entry.description || '',
      });
    } else {
      setManualForm({ entry_date: toISODate(new Date()), start: '09:00', end: '17:00', project_id: '', description: '' });
    }
    setManualOpen(true);
  };

  const saveManual = async () => {
    const start_time = `${manualForm.entry_date}T${manualForm.start}:00`;
    const end_time = `${manualForm.entry_date}T${manualForm.end}:00`;
    const payload = { entry_date: manualForm.entry_date, start_time, end_time, project_id: manualForm.project_id || undefined, description: manualForm.description || undefined };
    try {
      if (manualForm.id) await apiFetch(`/api/time_entries/${manualForm.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await apiFetch('/api/time_entries', { method: 'POST', body: JSON.stringify(payload) });
      setManualOpen(false);
      refreshWeek();
    } catch (e: any) { alert(e.message || t('time_tracking_save_error')); }
  };

  const deleteEntry = async (id: string) => {
    if (!confirm(t('time_tracking_delete_confirm'))) return;
    try { await apiFetch(`/api/time_entries/${id}`, { method: 'DELETE' }); refreshWeek(); }
    catch (e: any) { alert(e.message || t('time_tracking_delete_error')); }
  };

  const projectName = (id?: string | null) => projects.find(p => p.id === id)?.name || t('time_tracking_no_project');

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const entriesByDay = (dayStr: string) => entries.filter(e => e.entry_date === dayStr).sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('time_tracking_title')}</h2>
        <div className="flex items-center gap-3">
          <select className="p-2 border rounded text-sm dark:bg-zinc-800 dark:border-zinc-700" value={clockProjectId} onChange={e => setClockProjectId(e.target.value)} disabled={!!current}>
            <option value="">{t('time_tracking_no_project')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {current ? (
            <button onClick={handleClockOut} className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-md font-medium hover:bg-red-700 shadow-sm">
              <IconPlayerStop size={18} /> {t('time_tracking_clock_out')} ({elapsedLabel})
            </button>
          ) : (
            <button onClick={handleClockIn} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-md font-medium hover:bg-green-700 shadow-sm">
              <IconPlayerPlay size={18} /> {t('time_tracking_clock_in')}
            </button>
          )}
        </div>
      </div>

      {(teamData && teamData.length > 0 || isAdmin) && (
        <div className="flex gap-2">
          <button onClick={() => setTab('me')} className={`px-3 py-1.5 rounded-full text-sm font-medium ${tab === 'me' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}`}>{t('time_tracking_tab_me')}</button>
          {teamData && teamData.length > 0 && (
            <button onClick={() => setTab('team')} className={`px-3 py-1.5 rounded-full text-sm font-medium ${tab === 'team' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}`}>{t('time_tracking_tab_team')}</button>
          )}
          {isAdmin && (
            <button onClick={() => setTab('admin')} className={`px-3 py-1.5 rounded-full text-sm font-medium ${tab === 'admin' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}`}>{t('time_tracking_tab_admin')}</button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="px-3 py-1.5 rounded bg-zinc-100 dark:bg-zinc-800 text-sm">←</button>
          <span className="text-sm font-medium">{weekStartStr} → {weekEndStr}</span>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="px-3 py-1.5 rounded bg-zinc-100 dark:bg-zinc-800 text-sm">→</button>
        </div>
        {tab === 'me' && summary && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t('time_tracking_week_total')}: {formatHours(summary.total_hours)}</span>
            <button
              onClick={() => exportWeeklyTimesheetPdf({
                userName: currentUser?.name || 'Utilisateur',
                weekStartStr, weekEndStr, entries, projectName,
                totalHours: summary.total_hours,
                agencySettings: { agencyName: settings?.agencyName, address: settings?.address, phone: settings?.phone, email: settings?.email },
              })}
              className="flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              <IconDownload size={15} /> {t('time_tracking_export_week_pdf')}
            </button>
          </div>
        )}
      </div>

      {tab === 'me' ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => openManual()} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700">
              <IconPlus size={15} /> {t('time_tracking_add_manual')}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {days.map((day, i) => {
              const dayStr = toISODate(day);
              const dayEntries = entriesByDay(dayStr);
              return (
                <div key={dayStr} className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                  <h4 className="font-semibold text-sm mb-2 capitalize">{DAY_LABELS[i]} <span className="text-zinc-400 font-normal">{dayStr}</span></h4>
                  {dayEntries.length === 0 ? (
                    <p className="text-xs text-zinc-400">{t('time_tracking_no_entries')}</p>
                  ) : (
                    <div className="space-y-2">
                      {dayEntries.map(e => (
                        <div key={e.id} className="text-xs bg-zinc-50 dark:bg-zinc-900 rounded p-2 flex justify-between items-start gap-1">
                          <div>
                            <div className="font-medium">{new Date(e.start_time).toTimeString().slice(0, 5)} – {e.end_time ? new Date(e.end_time).toTimeString().slice(0, 5) : '…'}</div>
                            <div className="text-zinc-500">{projectName(e.project_id)}</div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => openManual(e)} className="text-zinc-400 hover:text-blue-600"><IconEdit size={13} /></button>
                            <button onClick={() => deleteEntry(e.id)} className="text-zinc-400 hover:text-red-600"><IconTrash size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : tab === 'team' ? (
        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr><th className="text-left p-3">{t('time_tracking_team_name')}</th><th className="text-left p-3">{t('time_tracking_team_hours')}</th></tr>
            </thead>
            <tbody>
              {(teamData || []).map(row => (
                <tr key={row.user_id} className="border-t border-zinc-100 dark:border-zinc-700">
                  <td className="p-3">{row.name}</td>
                  <td className="p-3">{formatHours(row.total_hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <h3 className="font-bold">{t('time_tracking_matrix_title')}</h3>
              {matrix && (
                <button onClick={() => exportAdminMatrixExcel(matrix, `${weekStartStr}_${weekEndStr}`)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">
                  <IconFileSpreadsheet size={15} /> {t('time_tracking_export_excel')}
                </button>
              )}
            </div>
            {matrix ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-900">
                    <tr>
                      <th className="text-left p-2">{t('time_tracking_team_name')}</th>
                      {matrix.projects.map(p => <th key={p.id} className="text-right p-2">{p.name}</th>)}
                      <th className="text-right p-2">{t('time_tracking_no_project')}</th>
                      <th className="text-right p-2 font-bold">{t('time_tracking_week_total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.employees.map(emp => {
                      const cellFor = (projectId: string | null) => matrix.cells.find(c => c.user_id === emp.id && c.project_id === projectId)?.hours || 0;
                      const projectHours = matrix.projects.map(p => cellFor(p.id));
                      const noneHours = cellFor(null);
                      const total = projectHours.reduce((s, v) => s + v, 0) + noneHours;
                      return (
                        <tr key={emp.id} className="border-t border-zinc-100 dark:border-zinc-700">
                          <td className="p-2">{emp.name}</td>
                          {projectHours.map((h, i) => <td key={i} className="text-right p-2">{h > 0 ? formatHours(h) : '—'}</td>)}
                          <td className="text-right p-2">{noneHours > 0 ? formatHours(noneHours) : '—'}</td>
                          <td className="text-right p-2 font-bold">{formatHours(total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-zinc-400">{t('loading')}</p>}
          </div>

          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
            <h3 className="font-bold">{t('time_tracking_monthly_export_title')}</h3>
            <p className="text-xs text-zinc-500">{t('time_tracking_monthly_export_hint')}</p>
            <div className="flex items-center gap-3 flex-wrap">
              <input type="month" className="p-2 border rounded text-sm dark:bg-zinc-900 dark:border-zinc-700" value={monthValue} onChange={e => setMonthValue(e.target.value)} />
              <button
                disabled={!monthlyRows || monthlyLoading}
                onClick={() => monthlyRows && exportMonthlySummaryExcel(monthValue, monthlyRows)}
                className="flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <IconFileSpreadsheet size={15} /> {t('time_tracking_export_excel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl w-full max-w-md shadow-xl">
            <h3 className="text-xl font-bold mb-4">{manualForm.id ? t('time_tracking_edit_entry') : t('time_tracking_add_manual')}</h3>
            <div className="space-y-3">
              <input type="date" className="w-full p-2 border rounded dark:bg-zinc-800 dark:border-zinc-700" value={manualForm.entry_date} onChange={e => setManualForm({ ...manualForm, entry_date: e.target.value })} />
              <div className="flex gap-2">
                <input type="time" className="w-1/2 p-2 border rounded dark:bg-zinc-800 dark:border-zinc-700" value={manualForm.start} onChange={e => setManualForm({ ...manualForm, start: e.target.value })} />
                <input type="time" className="w-1/2 p-2 border rounded dark:bg-zinc-800 dark:border-zinc-700" value={manualForm.end} onChange={e => setManualForm({ ...manualForm, end: e.target.value })} />
              </div>
              <select className="w-full p-2 border rounded dark:bg-zinc-800 dark:border-zinc-700" value={manualForm.project_id} onChange={e => setManualForm({ ...manualForm, project_id: e.target.value })}>
                <option value="">{t('time_tracking_no_project')}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input className="w-full p-2 border rounded dark:bg-zinc-800 dark:border-zinc-700" placeholder={t('time_tracking_description_placeholder')} value={manualForm.description} onChange={e => setManualForm({ ...manualForm, description: e.target.value })} />
              <div className="flex justify-end gap-2">
                <button onClick={() => setManualOpen(false)} className="px-4 py-2 rounded bg-zinc-200 dark:bg-zinc-700">{t('btn_cancel')}</button>
                <button onClick={saveManual} className="px-4 py-2 rounded bg-blue-600 text-white">{t('btn_save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
