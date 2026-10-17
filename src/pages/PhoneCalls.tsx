import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence } from 'motion/react';
import {
  IconPhone, IconPhoneIncoming, IconPhoneOutgoing, IconPlus, IconSearch, IconFileTypePdf,
  IconFileSpreadsheet, IconLoader2, IconAlertTriangle, IconChecklist,
} from '@tabler/icons-react';
import { useUser } from '../UserContext';
import { usePhoneCalls } from '../hooks/usePhoneCalls';
import { useToastWithUndo } from '../hooks/useToastWithUndo';
import { apiFetch } from '../lib/api';
import { db } from '../db';
import { PillTabs } from '../components/ui/PillTabs';
import { Toast } from '../components/ui/Toast';
import { ErrorState, ListSkeleton } from '../components/DataState';
import { PhoneCallFormModal } from '../components/phoneCalls/PhoneCallFormModal';
import {
  DEFAULT_PHONE_CALL_FILTERS, emptyPhoneCallDraft, filterPhoneCalls, isCallbackOverdue,
  summarizeForAssignee,
} from '../lib/phoneCalls';
import { PHONE_CALL_STATUSES } from '../schemas/phoneCall.schema';
import type { Contact, PhoneCall, Project } from '../types';

type Scope = 'mine' | 'all';

const STATUS_STYLE: Record<PhoneCall['status'], { color: string; bg: string }> = {
  a_traiter: { color: '#c92a2a', bg: '#fff5f5' },
  en_cours: { color: 'var(--tblr-primary)', bg: 'var(--tblr-primary-lt)' },
  traite: { color: 'var(--tblr-success)', bg: '#ebfbee' },
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function PhoneCalls() {
  const { t, i18n } = useTranslation();
  const { currentUser, allUsers } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const { calls, loading, loadFailed, reload, createCall, updateCall, deleteCall, createTaskFromCall } = usePhoneCalls();
  const { toast, showToast } = useToastWithUndo();

  const [projects, setProjects] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [scope, setScope] = useState<Scope>('mine');
  const [filters, setFilters] = useState(DEFAULT_PHONE_CALL_FILTERS);
  const [modal, setModal] = useState<Partial<PhoneCall> | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);

  const myId = currentUser?.id || '';
  const today = todayIso();

  // Affaires et contacts : réseau d'abord, cache de l'appareil sinon (saisie sur un chantier sans réseau).
  useEffect(() => {
    let alive = true;
    (async () => {
      const [p, c] = await Promise.all([
        apiFetch<Project[]>('/api/projects').catch(() => db.projects.toArray()),
        apiFetch<Contact[]>('/api/contacts').catch(() => db.contacts.toArray()),
      ]);
      if (!alive) return;
      setProjects(Array.isArray(p) ? p : []);
      setContacts(Array.isArray(c) ? c : []);
    })();
    return () => { alive = false; };
  }, []);

  // Liens venus d'ailleurs : `?open=<id>` (notification), `?new=1&project=<id>` (fiche affaire).
  // Les paramètres sont consommés une seule fois, à la fin du chargement.
  const openParam = searchParams.get('open');
  const newParam = searchParams.get('new');
  const projectParam = searchParams.get('project');
  useEffect(() => {
    if (loading) return;
    if (openParam) {
      const target = calls.find(c => c.id === openParam);
      if (target) { setScope('all'); setFilters(f => ({ ...f, status: 'all' })); setModal(target); }
    } else if (newParam) {
      setModal(emptyPhoneCallDraft(new Date(), { project_id: projectParam || null, assignee_id: myId || null }));
    } else {
      return;
    }
    const next = new URLSearchParams(searchParams);
    ['open', 'new', 'project'].forEach(key => next.delete(key));
    setSearchParams(next, { replace: true });
  }, [loading, openParam, newParam]);

  const effectiveFilters = useMemo(
    () => ({ ...filters, assignee: scope === 'mine' ? myId || 'none' : filters.assignee }),
    [filters, scope, myId],
  );
  const visible = useMemo(() => filterPhoneCalls(calls, effectiveFilters), [calls, effectiveFilters]);
  const summary = useMemo(() => summarizeForAssignee(calls, myId, today), [calls, myId, today]);

  const memberName = useMemo(() => new Map(allUsers.map(m => [m.id, m.name || m.email])), [allUsers]);
  const projectName = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  };
  const formatDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(i18n.language);

  async function handleSave(body: Partial<PhoneCall>) {
    const result = modal?.id ? await updateCall(modal.id, body) : await createCall(body);
    setModal(null);
    if (result.queued) showToast(t('phonecalls_queued') as string, 'success', { duration: 6000 });
  }

  async function handleDelete() {
    if (!modal?.id) return;
    const result = await deleteCall(modal.id);
    setModal(null);
    if (result.queued) showToast(t('phonecalls_queued') as string, 'success', { duration: 6000 });
  }

  async function handleCreateTask() {
    if (!modal?.id) return;
    const result = await createTaskFromCall(modal.id);
    if (result.queued) showToast(t('phonecalls_task_queued') as string, 'success', { duration: 6000 });
    else showToast(t('phonecalls_task_created') as string);
  }

  // Changement rapide depuis la ligne (statut, collaborateur) : écriture partielle, retour arrière en cas de refus.
  async function quickUpdate(call: PhoneCall, patch: Partial<PhoneCall>) {
    try {
      const result = await updateCall(call.id, patch);
      if (result.queued) showToast(t('phonecalls_queued') as string, 'success', { duration: 6000 });
    } catch (err: any) {
      showToast(err?.message || (t('phonecalls_save_error') as string), 'error');
    }
  }

  function activeFilterLabels(): string[] {
    const assignee = scope === 'mine' ? myId : filters.assignee;
    const labels = [
      assignee === 'all' ? '' : `${t('phonecalls_field_assignee')} : ${assignee === 'none' ? t('phonecalls_unassigned') : memberName.get(assignee) || ''}`,
      filters.status === 'all' ? '' : `${t('phonecalls_field_status')} : ${filters.status === 'open' ? t('phonecalls_filter_open_only') : t(`phonecalls_status_${filters.status}`)}`,
      filters.project === 'all' ? '' : `${t('phonecalls_field_project')} : ${projectName.get(filters.project) || ''}`,
      filters.search.trim() ? `« ${filters.search.trim()} »` : '',
    ];
    return labels.filter(Boolean);
  }

  async function handleExport(kind: 'pdf' | 'xlsx') {
    if (visible.length === 0) { showToast(t('phonecalls_export_empty') as string, 'error'); return; }
    setExporting(kind);
    try {
      const ctx = { team: allUsers, projects, filtres: activeFilterLabels(), today };
      if (kind === 'pdf') {
        const [{ exportPhoneCallsToPDF }, { telechargerPdf }] = await Promise.all([import('../lib/phoneCallsExport'), import('../lib/observationsExport')]);
        telechargerPdf(await exportPhoneCallsToPDF(visible, ctx));
      } else {
        const { exportPhoneCallsToExcel } = await import('../lib/phoneCallsExport');
        await exportPhoneCallsToExcel(visible, ctx);
      }
    } catch (err) {
      console.error('Export des appels impossible :', err);
      showToast(t('phonecalls_export_error') as string, 'error');
    } finally {
      setExporting(null);
    }
  }

  const controlStyle = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' } as React.CSSProperties;
  const controlCls = 'px-3 py-2 text-sm rounded-lg outline-none min-w-0';
  const editing = modal?.id ? calls.find(c => c.id === modal.id) ?? modal : modal;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-3" style={{ background: 'var(--tblr-surface)', borderBottom: '1px solid var(--tblr-border)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <IconPhone size={22} style={{ color: 'var(--tblr-primary)' }} />
            <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('phonecalls_title')}</h1>
            <PillTabs
              activeId={scope}
              onChange={id => setScope(id as Scope)}
              tabs={[
                { id: 'mine', label: t('phonecalls_filter_mine') as string },
                { id: 'all', label: t('phonecalls_filter_all') as string },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => handleExport('pdf')} disabled={exporting !== null} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors hover:bg-[var(--tblr-surface-2)] disabled:opacity-60" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>
              {exporting === 'pdf' ? <IconLoader2 size={16} className="animate-spin" /> : <IconFileTypePdf size={16} />} {t('phonecalls_export_pdf')}
            </button>
            <button type="button" onClick={() => handleExport('xlsx')} disabled={exporting !== null} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors hover:bg-[var(--tblr-surface-2)] disabled:opacity-60" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>
              {exporting === 'xlsx' ? <IconLoader2 size={16} className="animate-spin" /> : <IconFileSpreadsheet size={16} />} {t('phonecalls_export_xlsx')}
            </button>
            <button
              type="button"
              onClick={() => setModal(emptyPhoneCallDraft(new Date(), { assignee_id: scope === 'mine' ? myId : null }))}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <IconPlus size={16} /> {t('phonecalls_new')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[10rem] sm:flex-none">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--tblr-muted)' }} />
            <input
              type="search"
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder={t('phonecalls_search_placeholder') as string}
              aria-label={t('phonecalls_search_placeholder') as string}
              className={`${controlCls} w-full sm:w-52 pl-9`}
              style={controlStyle}
            />
          </div>
          {scope === 'all' && (
            <select value={filters.assignee} onChange={e => setFilters(f => ({ ...f, assignee: e.target.value }))} aria-label={t('phonecalls_field_assignee') as string} className={controlCls} style={controlStyle}>
              <option value="all">{t('phonecalls_filter_all_assignees')}</option>
              <option value="none">{t('phonecalls_filter_unassigned')}</option>
              {allUsers.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
            </select>
          )}
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} aria-label={t('phonecalls_field_status') as string} className={controlCls} style={controlStyle}>
            <option value="open">{t('phonecalls_filter_open_only')}</option>
            <option value="all">{t('phonecalls_filter_all_statuses')}</option>
            {PHONE_CALL_STATUSES.map(s => <option key={s} value={s}>{t(`phonecalls_status_${s}`)}</option>)}
          </select>
          <select value={filters.project} onChange={e => setFilters(f => ({ ...f, project: e.target.value }))} aria-label={t('phonecalls_field_project') as string} className={controlCls} style={controlStyle}>
            <option value="all">{t('kanban_all_projects')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {summary.open > 0 && (
          <p className="text-xs flex items-center gap-2" style={{ color: 'var(--tblr-muted)' }}>
            <IconChecklist size={14} />
            {t('phonecalls_card_title')} : {summary.open}
            {summary.overdue > 0 && (
              <span className="font-medium" style={{ color: '#c92a2a' }}>· {t('phonecalls_card_overdue', { count: summary.overdue })}</span>
            )}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4" style={{ background: 'var(--tblr-bg)' }}>
        {loading ? (
          <ListSkeleton rows={5} />
        ) : loadFailed ? (
          <ErrorState message={t('phonecalls_load_error') as string} onRetry={reload} />
        ) : visible.length === 0 ? (
          <p className="text-sm text-center py-12" style={{ color: 'var(--tblr-muted)' }}>
            {calls.length === 0 ? t('phonecalls_empty') : t('phonecalls_empty_filtered')}
          </p>
        ) : (
          <ul className="space-y-2 max-w-6xl mx-auto">
            {visible.map(call => {
              const overdue = isCallbackOverdue(call, today);
              const style = STATUS_STYLE[call.status];
              const who = [call.caller_name, call.caller_company].filter(Boolean).join(' · ');
              const DirectionIcon = call.direction === 'sortant' ? IconPhoneOutgoing : IconPhoneIncoming;
              return (
                <li key={call.id} className="rounded-lg border flex flex-col md:flex-row md:items-center gap-2 md:gap-4 p-3" style={{ background: 'var(--tblr-surface)', borderColor: overdue ? '#ffa8a8' : 'var(--tblr-border)' }}>
                  <button type="button" onClick={() => setModal(call)} className="flex items-start gap-3 text-left flex-1 min-w-0 rounded focus-visible:outline focus-visible:outline-2" style={{ color: 'var(--tblr-text)' }}>
                    <DirectionIcon size={20} className="shrink-0 mt-0.5" style={{ color: 'var(--tblr-muted)' }} aria-label={t(`phonecalls_direction_${call.direction}`) as string} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold truncate">{call.subject}</span>
                      <span className="block text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>
                        {[who, call.caller_phone, call.project_id ? projectName.get(call.project_id) : ''].filter(Boolean).join(' · ')}
                      </span>
                      <span className="block text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
                        {formatDate(call.called_at)}
                        {call.pendingSync && <span className="ml-2 font-medium" style={{ color: '#e67700' }}>{t('phonecalls_pending')}</span>}
                      </span>
                    </span>
                  </button>

                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    {call.callback_due && (
                      <span className="flex items-center gap-1 text-[0.6875rem] font-medium px-2 py-1 rounded" style={{ color: overdue ? '#c92a2a' : 'var(--tblr-muted)', background: overdue ? '#fff5f5' : 'var(--tblr-surface-2)' }}>
                        {overdue && <IconAlertTriangle size={12} />}
                        {overdue ? t('phonecalls_overdue') : t('phonecalls_callback_on', { date: formatDay(call.callback_due) })}
                      </span>
                    )}
                    {call.task_id && <span title={t('phonecalls_task_created') as string}><IconChecklist size={16} style={{ color: 'var(--tblr-primary)' }} /></span>}
                    <select
                      value={call.assignee_id || ''}
                      onChange={e => quickUpdate(call, { assignee_id: e.target.value || null })}
                      aria-label={`${t('phonecalls_assign_to')} : ${call.subject}`}
                      className="px-2 py-2 text-xs rounded-lg outline-none max-w-[11rem] min-h-[2.75rem] md:min-h-0"
                      style={controlStyle}
                    >
                      <option value="">{t('phonecalls_unassigned')}</option>
                      {allUsers.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
                    </select>
                    <select
                      value={call.status}
                      onChange={e => quickUpdate(call, { status: e.target.value as PhoneCall['status'] })}
                      aria-label={`${t('phonecalls_field_status')} : ${call.subject}`}
                      className="px-2 py-2 text-xs font-semibold rounded-lg outline-none min-h-[2.75rem] md:min-h-0"
                      style={{ color: style.color, background: style.bg, border: '1px solid var(--tblr-border)' }}
                    >
                      {PHONE_CALL_STATUSES.map(s => <option key={s} value={s}>{t(`phonecalls_status_${s}`)}</option>)}
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <PhoneCallFormModal
            key={modal?.id || 'new'}
            initial={editing}
            projects={projects}
            team={allUsers}
            contacts={contacts}
            onClose={() => setModal(null)}
            onSave={handleSave}
            onDelete={modal?.id ? handleDelete : undefined}
            onCreateTask={modal?.id ? handleCreateTask : undefined}
          />
        )}
      </AnimatePresence>
      <Toast toast={toast} />
    </div>
  );
}
