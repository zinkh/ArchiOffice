// Affaires partagées avec moi : l'espace d'un confrère invité sur l'affaire d'un
// autre cabinet. Il montre la vraie fiche ArchiOffice (en-tête, familles d'onglets) limitée à ce que le
// cabinet a choisi de partager ; le serveur revérifie chaque droit à chaque requête
// (server/routes/projectShares.ts).
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';
import SharedDocument from '../components/SharedDocument';
import SharedProjectShell from '../components/shared/SharedProjectShell';
import SharedKpis from '../components/shared/SharedKpis';
import { SharedAct, SharedReports, SharedReserves } from '../components/SharedChantier';
import { sharedInitialTab, sharedProSubTabs, sharedVisibleTabs } from '../lib/sharedTabs';
import type { ProjectTabId } from '../lib/projectTabs';

interface Grant { kind: 'lots' | 'tasks' | 'documents' | 'cctp' | 'dpgf' | 'act' | 'reports' | 'reserves' | 'gpa'; access: 'read' | 'comment' | 'write'; /** Le cabinet a coché le détail de cet atelier (issue #688). */ detail?: boolean }
interface Doc { id: string; name: string; category: string | null; phase: string | null; version: number | null; uploaded_at: string | null; description: string | null }
interface Summary { shareId: string; projectId: string; projectName: string; projectCode: string | null; address: string | null; tenantName: string | null; grants: Grant[] }
interface View {
  project: { id: string; name: string; project_code: string | null; address: string | null };
  grants: Grant[]; archived: boolean; tenantName?: string | null;
  lots?: Array<{ id: string; lot_number: string; lot_title: string }>;
}
interface Task { id: string; title: string; start_date: string; end_date: string; progress: number | null; status: string | null; due_date: string | null }

const STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;
const cardStyle = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' };
const fieldClass = 'px-3 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

function SharedList() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Summary[]>('/api/shared/projects').then(setItems).catch(e => setError(e?.message || t('share_error')));
  }, [t]);

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!items) return null;
  if (items.length === 0) return <p className="text-sm text-[var(--tblr-muted)]">{t('shared_page_empty')}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map(item => (
        <li key={item.shareId} className="rounded-lg p-4 space-y-1" style={cardStyle}>
          <div className="text-sm font-bold text-[var(--tblr-text)]">
            {item.projectCode ? `${item.projectCode} · ` : ''}{item.projectName}
          </div>
          {item.address && <div className="text-xs text-[var(--tblr-muted)]">{item.address}</div>}
          {item.tenantName && <div className="text-xs text-[var(--tblr-muted)]">{t('shared_from', { name: item.tenantName })}</div>}
          <Link
            to={`/partages?affaire=${encodeURIComponent(item.projectId)}`}
            className="inline-block mt-2 px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t('shared_open')}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TaskRow({ projectId, task, canWrite, onSaved, onError }: {
  projectId: string; task: Task; canWrite: boolean; onSaved: () => void; onError: (m: string) => void;
}) {
  const { t } = useTranslation();
  const patch = async (fields: Record<string, unknown>) => {
    try {
      await apiFetch(`/api/shared/projects/${projectId}/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(fields) });
      onSaved();
    } catch (e: any) { onError(e?.message || t('share_error')); }
  };
  return (
    <tr style={{ borderTop: '1px solid var(--tblr-border)' }}>
      <td className="px-3 py-2 text-sm font-medium text-[var(--tblr-text)]">{task.title}</td>
      <td className="px-3 py-2 text-xs text-[var(--tblr-muted)] whitespace-nowrap">{task.start_date} → {task.end_date}</td>
      <td className="px-3 py-2">
        {canWrite ? (
          <select
            aria-label={t('shared_progress')} value={task.status ?? 'todo'} onChange={e => patch({ status: e.target.value })}
            className={fieldClass}
          >
            {STATUSES.map(s => <option key={s} value={s}>{t(`shared_task_status_${s}`)}</option>)}
          </select>
        ) : (
          <span className="text-xs">{t(`shared_task_status_${task.status ?? 'todo'}`)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 rounded-full overflow-hidden" style={{ background: 'var(--tblr-surface-2)' }} aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, task.progress ?? 0))}%`, background: 'var(--tblr-primary)' }} />
          </div>
          {canWrite ? (
            <input
              type="number" min={0} max={100} aria-label={t('shared_progress')} defaultValue={task.progress ?? 0}
              onBlur={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 0 && v <= 100 && v !== (task.progress ?? 0)) void patch({ progress: v }); }}
              className={`${fieldClass} w-16`}
            />
          ) : <span className="tabular-nums">{`${task.progress ?? 0} %`}</span>}
        </div>
      </td>
    </tr>
  );
}

function SharedDetail({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const loadTasks = useCallback(async (grants: Grant[]) => {
    if (!grants.some(g => g.kind === 'tasks')) { setTasks(null); return; }
    setTasks(await apiFetch<Task[]>(`/api/shared/projects/${projectId}/tasks`));
  }, [projectId]);

  useEffect(() => {
    setView(null); setTasks(null); setError(null);
    apiFetch<View>(`/api/shared/projects/${projectId}`)
      .then(async v => { setView(v); await loadTasks(v.grants); })
      .catch(e => setError(e?.message || t('share_error')));
  }, [projectId, loadTasks, t]);

  useEffect(() => {
    if (!view || !view.grants.some(g => g.kind === 'documents')) { setDocs(null); return; }
    apiFetch<Doc[]>(`/api/shared/projects/${projectId}/documents`).then(setDocs).catch(e => setError(e?.message || t('share_error')));
  }, [view, projectId, t]);

  if (error && !view) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!view) return null;

  const tasksGrant = view.grants.find(g => g.kind === 'tasks');
  const canWrite = tasksGrant?.access === 'write' && !view.archived;
  // Suivi de chantier : l'écriture est un droit par type, et jamais sur une affaire archivée.
  const chantier = (kind: 'reports' | 'reserves' | 'gpa') => {
    const grant = view.grants.find(g => g.kind === kind);
    return grant ? { canWrite: grant.access === 'write' && !view.archived, detail: grant.detail === true } : null;
  };
  const reportsRight = chantier('reports');
  const reservesRight = chantier('reserves');
  const gpaRight = chantier('gpa');
  const canWriteAnything = !view.archived && view.grants.some(g => g.access === 'write');
  const reload = () => loadTasks(view.grants).catch(e => setError(e?.message || t('share_error')));

  const visible = sharedVisibleTabs(view.grants);
  const activeTab = sharedInitialTab(params.get('tab'), visible);
  const changeTab = (tab: ProjectTabId) => {
    const next = new URLSearchParams(params);
    if (tab === 'INFOS') next.delete('tab'); else next.set('tab', tab);
    setParams(next, { replace: true });
  };
  const proModes = sharedProSubTabs(view.grants);

  // Le lien est demandé au serveur à chaque ouverture (il expire) : le fichier n'est jamais
  // une adresse stockée côté page.
  const download = async (docId: string) => {
    try {
      const { url } = await apiFetch<{ url: string }>(`/api/shared/projects/${projectId}/documents/${docId}/download`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { setError(e?.message || t('share_error')); }
  };

  const addTask = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiFetch(`/api/shared/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify({ title, start_date: start, end_date: end }) });
      setTitle(''); setStart(''); setEnd(''); setError(null);
      await reload();
    } catch (e: any) { setError(e?.message || t('share_error')); }
  };

  return (
    <SharedProjectShell
      project={view.project} tenantName={view.tenantName ?? null} grants={view.grants}
      archived={view.archived} canWriteAnything={canWriteAnything} activeTab={activeTab} onTabChange={changeTab}
    >
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {view.archived && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_archived')}</p>}

      {activeTab === 'INFOS' && (
        <>
          {view.lots && (
            <section className="rounded-lg p-4" style={cardStyle}>
              <h2 className="text-sm font-bold mb-2 text-[var(--tblr-text)]">{t('shared_lots_title')}</h2>
              <ul className="text-sm space-y-1">
                {view.lots.map(lot => <li key={lot.id}><span className="font-medium">{lot.lot_number}</span> {lot.lot_title}</li>)}
              </ul>
            </section>
          )}
          {docs && (
            <section className="rounded-lg p-4" style={cardStyle}>
              <h2 className="text-sm font-bold mb-2 text-[var(--tblr-text)]">{t('shared_documents_title')}</h2>
              {docs.length === 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_documents_empty')}</p>}
              <ul className="space-y-2">
                {docs.map(doc => (
                  <li key={doc.id} className="flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--tblr-border)', paddingTop: '0.5rem' }}>
                    <div className="min-w-0">
                      <div className="text-sm text-[var(--tblr-text)] truncate">{doc.name}</div>
                      <div className="text-xs text-[var(--tblr-muted)] truncate">
                        {[doc.category, doc.phase, doc.version ? `v${doc.version}` : null, doc.uploaded_at].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <button
                      type="button" onClick={() => download(doc.id)} aria-label={`${t('shared_download')} ${doc.name}`}
                      className="shrink-0 px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)]"
                    >
                      {t('shared_download')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!view.lots && !docs && <p className="text-sm text-[var(--tblr-muted)]">{t('shared_infos_empty')}</p>}
        </>
      )}

      {/* Un seul écran pour le CCTP et le DPGF (relecture d'abord, retours envoyés en lot) : ses onglets remplacent les sous-onglets. */}
      {activeTab === 'PRO' && proModes.length > 0 && (
        <SharedDocument projectId={projectId} modes={proModes} grants={view.grants} archived={view.archived} />
      )}

      {activeTab === 'ACT' && <SharedAct projectId={projectId} canPropose={view.grants.some(g => g.kind === 'act' && g.access === 'write') && !view.archived} detail={view.grants.some(g => g.kind === 'act' && g.detail === true)} />}
      {activeTab === 'RDT' && reportsRight && <SharedReports projectId={projectId} canWrite={reportsRight.canWrite} detail={reportsRight.detail} />}
      {activeTab === 'AOR' && reservesRight && <SharedReserves projectId={projectId} kind="reserves" canWrite={reservesRight.canWrite} detail={reservesRight.detail} />}
      {activeTab === 'GPA' && gpaRight && <SharedReserves projectId={projectId} kind="gpa" canWrite={gpaRight.canWrite} detail={gpaRight.detail} />}

      {activeTab === 'TACHES' && tasksGrant && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-[var(--tblr-text)]">{t('shared_tasks_title')}</h2>
          {tasks && tasks.length === 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_tasks_empty')}</p>}
          {tasks && tasks.length > 0 && (
            <>
              <SharedKpis items={[
                { label: t('shared_kpi_tasks'), value: tasks.length },
                { label: t('shared_kpi_tasks_open'), value: tasks.filter(x => x.status === 'in_progress' || x.status === 'review').length },
                { label: t('shared_kpi_tasks_done'), value: tasks.filter(x => x.status === 'done').length, tone: tasks.some(x => x.status === 'done') ? 'ok' : 'neutral' },
              ]} />
              <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)' }}>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                      <th scope="col" className="px-3 py-2 text-xs font-semibold">{t('shared_col_task')}</th>
                      <th scope="col" className="px-3 py-2 text-xs font-semibold">{t('shared_col_period')}</th>
                      <th scope="col" className="px-3 py-2 text-xs font-semibold">{t('shared_col_status')}</th>
                      <th scope="col" className="px-3 py-2 text-xs font-semibold">{t('shared_col_progress')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map(task => (
                      <TaskRow key={`${task.id}-${task.status}-${task.progress}`} projectId={projectId} task={task} canWrite={canWrite} onSaved={reload} onError={setError} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {canWrite && (
            <form onSubmit={addTask} className="flex flex-wrap items-end gap-2 rounded-lg p-3" style={cardStyle}>
              <input required value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder={t('shared_task_title')} aria-label={t('shared_task_title')} className={`${fieldClass} flex-1 min-w-40`} />
              <input required type="date" value={start} onChange={e => setStart(e.target.value)} aria-label={t('shared_task_start')} className={fieldClass} />
              <input required type="date" value={end} onChange={e => setEnd(e.target.value)} aria-label={t('shared_task_end')} className={fieldClass} />
              <button type="submit" className="px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">{t('shared_task_add')}</button>
            </form>
          )}
        </section>
      )}
    </SharedProjectShell>
  );
}

export default function SharedProjects() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const projectId = params.get('affaire');
  if (projectId) return <SharedDetail projectId={projectId} />;
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-[var(--tblr-text)]">{t('shared_page_title')}</h1>
      <SharedList />
    </div>
  );
}
