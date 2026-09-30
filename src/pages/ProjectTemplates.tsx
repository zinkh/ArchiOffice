import { useState, useEffect } from 'react';
import { IconPlus, IconTrash, IconEdit, IconX, IconDownload, IconCheck, IconCopy } from '@tabler/icons-react';
import { db } from '../db';
import { apiFetch } from '../lib/api';
import type {
  Project, ProjectTemplate, ProjectTemplateCatalogEntry, TemplateLot, TemplateMilestone, TemplateTask,
  TemplateMarcheType, TemplateOperationType,
} from '../types';
import { MARCHE_LABELS, OPERATION_LABELS, summarizeTemplate } from '../lib/projectTemplates';
import { useTranslation } from 'react-i18next';

type Tab = 'general' | 'lots' | 'milestones' | 'tasks';

const STATUSES: ProjectTemplate['default_status'][] = ['Planning', 'In Progress', 'Completed', 'On Hold'];
const STATUS_KEYS: Record<ProjectTemplate['default_status'], string> = {
  Planning: 'ptpl_status_planning',
  'In Progress': 'ptpl_status_in_progress',
  Completed: 'ptpl_status_completed',
  'On Hold': 'ptpl_status_on_hold',
};
const PRIORITIES: NonNullable<TemplateTask['priority']>[] = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_KEYS: Record<NonNullable<TemplateTask['priority']>, string> = {
  low: 'ptpl_priority_low', normal: 'ptpl_priority_normal', high: 'ptpl_priority_high', urgent: 'ptpl_priority_urgent',
};

const inputCls = 'w-full p-2 border rounded bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700';
const labelCls = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1';

const blankTemplate = (): ProjectTemplate => ({
  id: `pt${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
  name: '',
  description: '',
  operation_type: 'autre',
  marche_type: 'prive',
  default_status: 'Planning',
  default_budget: 0,
  default_description: '',
  default_lots: [],
  default_milestones: [],
  default_tasks: [],
});

function Badge({ children }: { children: string }) {
  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
      {children}
    </span>
  );
}

export default function ProjectTemplates() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editForm, setEditForm] = useState<ProjectTemplate | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [tab, setTab] = useState<Tab>('general');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalog, setCatalog] = useState<ProjectTemplateCatalogEntry[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);

  const [fromProjectOpen, setFromProjectOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [fromProjectId, setFromProjectId] = useState('');
  const [fromProjectName, setFromProjectName] = useState('');

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    // 1. Cache local (hors ligne)
    const local = await db.projectTemplates.toArray();
    if (local.length > 0) setTemplates(local);
    // 2. Synchronisation depuis l'API
    if (navigator.onLine) {
      try {
        const data = await apiFetch<ProjectTemplate[]>('/api/project-templates');
        await db.projectTemplates.clear();
        await db.projectTemplates.bulkPut(data);
        setTemplates(data);
        setPageError('');
      } catch (err) {
        console.error('Failed to sync templates:', err);
        setPageError(t('ptpl_load_error'));
      }
    }
    setLoaded(true);
  };

  const openEditor = (template: ProjectTemplate, creating: boolean) => {
    setEditForm({
      ...template,
      default_lots: template.default_lots ?? [],
      default_milestones: template.default_milestones ?? [],
      default_tasks: template.default_tasks ?? [],
    });
    setIsNew(creating);
    setTab('general');
    setError('');
  };

  const closeEditor = () => { setEditForm(null); setError(''); };

  const handleSave = async () => {
    if (!editForm || saving) return;
    if (!editForm.name.trim()) { setError(t('ptpl_name_required')); setTab('general'); return; }
    if (!navigator.onLine) { setError(t('ptpl_offline')); return; }
    setSaving(true);
    try {
      if (isNew) {
        await apiFetch('/api/project-templates', { method: 'POST', body: JSON.stringify(editForm) });
      } else {
        await apiFetch(`/api/project-templates/${editForm.id}`, { method: 'PUT', body: JSON.stringify(editForm) });
      }
      closeEditor();
      await fetchTemplates();
    } catch (err) {
      console.error('Failed to save template:', err);
      setError(t('ptpl_save_error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('project_templates_confirm_delete'))) return;
    try {
      await apiFetch(`/api/project-templates/${id}`, { method: 'DELETE' });
      await db.projectTemplates.delete(id);
      await fetchTemplates();
    } catch (err) {
      console.error('Failed to delete template:', err);
      setPageError(t('ptpl_delete_error'));
    }
  };

  const openCatalog = async () => {
    setCatalogOpen(true);
    try {
      setCatalog(await apiFetch<ProjectTemplateCatalogEntry[]>('/api/project-templates/catalog'));
    } catch (err) {
      console.error('Failed to load catalog:', err);
      setPageError(t('ptpl_load_error'));
    }
  };

  const install = async (keys: string[]) => {
    setInstalling(keys.length === 1 ? keys[0] : '*');
    try {
      await apiFetch('/api/project-templates/catalog/install', { method: 'POST', body: JSON.stringify({ keys }) });
      setCatalog(prev => prev.map(e => keys.includes(e.catalog_key) ? { ...e, installed: true } : e));
      await fetchTemplates();
    } catch (err) {
      console.error('Failed to install catalog templates:', err);
      setPageError(t('ptpl_save_error'));
    } finally {
      setInstalling(null);
    }
  };

  const openFromProject = async () => {
    setFromProjectOpen(true);
    setFromProjectId('');
    setFromProjectName('');
    try {
      setProjects(await apiFetch<Project[]>('/api/projects'));
    } catch (err) {
      console.error('Failed to load projects:', err);
      setPageError(t('ptpl_load_error'));
    }
  };

  const createFromProject = async () => {
    if (!fromProjectId) return;
    setSaving(true);
    try {
      await apiFetch(`/api/project-templates/from-project/${fromProjectId}`, {
        method: 'POST',
        body: JSON.stringify({ name: fromProjectName.trim() || undefined }),
      });
      setFromProjectOpen(false);
      await fetchTemplates();
    } catch (err) {
      console.error('Failed to create template from project:', err);
      setPageError(t('ptpl_save_error'));
    } finally {
      setSaving(false);
    }
  };

  // --- Listes éditables du modèle ---
  const patch = (p: Partial<ProjectTemplate>) => setEditForm(prev => prev ? { ...prev, ...p } : prev);
  const updateAt = <T,>(list: T[] | undefined, i: number, change: Partial<T>): T[] =>
    (list ?? []).map((item, idx) => idx === i ? { ...item, ...change } : item);
  const removeAt = <T,>(list: T[] | undefined, i: number): T[] => (list ?? []).filter((_, idx) => idx !== i);

  const addLot = () => {
    const lots = editForm?.default_lots ?? [];
    patch({ default_lots: [...lots, { lot_number: String(lots.length + 1).padStart(2, '0'), lot_title: '' }] });
  };
  const addMilestone = () => {
    const ms = editForm?.default_milestones ?? [];
    const last = ms.length ? ms[ms.length - 1].due_date_offset_days : 0;
    patch({ default_milestones: [...ms, { title: '', due_date_offset_days: last }] });
  };
  const addTask = () => patch({
    default_tasks: [...(editForm?.default_tasks ?? []), { title: '', start_offset_days: 0, duration_days: 7, priority: 'normal' }],
  });

  const numberInput = (value: number, onChange: (n: number) => void, min = 0) => (
    <input
      type="number" min={min} inputMode="numeric" className={inputCls} value={Number.isFinite(value) ? value : 0}
      onChange={e => onChange(Math.max(parseInt(e.target.value, 10) || 0, min))}
    />
  );

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'general', label: t('ptpl_tab_general') },
    { id: 'lots', label: t('ptpl_tab_lots'), count: editForm?.default_lots?.length },
    { id: 'milestones', label: t('ptpl_tab_milestones'), count: editForm?.default_milestones?.length },
    { id: 'tasks', label: t('ptpl_tab_tasks'), count: editForm?.default_tasks?.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('templates')}</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={openCatalog} className="flex items-center gap-2 px-4 py-2 rounded-md font-medium border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            <IconDownload size={18} />
            {t('ptpl_catalog_btn')}
          </button>
          <button onClick={openFromProject} className="flex items-center gap-2 px-4 py-2 rounded-md font-medium border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            <IconCopy size={18} />
            {t('ptpl_from_project_btn')}
          </button>
          <button
            onClick={() => openEditor(blankTemplate(), true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md font-medium hover:bg-blue-700 transition-colors shadow-sm"
          >
            <IconPlus size={18} />
            {t('templates_add_btn')}
          </button>
        </div>
      </div>

      {pageError && (
        <div role="alert" className="flex items-center justify-between gap-3 p-3 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          <span>{pageError}</span>
          <button onClick={() => setPageError('')} aria-label={t('btn_cancel')}><IconX size={16} /></button>
        </div>
      )}

      {loaded && templates.length === 0 && (
        <div className="bg-white dark:bg-zinc-800 p-8 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-600 text-center space-y-3">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white">{t('ptpl_empty_title')}</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto">{t('ptpl_empty_text')}</p>
          <button onClick={openCatalog} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md font-medium hover:bg-blue-700 transition-colors">
            <IconDownload size={18} />
            {t('ptpl_catalog_btn')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map(template => (
          <div key={template.id} className="bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm flex flex-col">
            <div className="flex justify-between items-start mb-3 gap-2">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-white">{template.name}</h3>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => openEditor(template, false)} aria-label={t('templates_edit_title')} className="text-zinc-500 hover:text-blue-500"><IconEdit size={18} /></button>
                <button onClick={() => handleDelete(template.id)} aria-label={t('btn_delete')} className="text-zinc-500 hover:text-red-500"><IconTrash size={18} /></button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {template.operation_type && template.operation_type !== 'autre' && <Badge>{OPERATION_LABELS[template.operation_type]}</Badge>}
              {template.marche_type && <Badge>{MARCHE_LABELS[template.marche_type]}</Badge>}
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 flex-1">{template.description}</p>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{summarizeTemplate(template) || t('ptpl_no_structure')}</p>
          </div>
        ))}
      </div>

      {/* Catalogue de démarrage */}
      {catalogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-xl w-full max-w-2xl max-h-[90dvh] flex flex-col shadow-xl">
            <div className="flex items-start justify-between gap-3 p-6 pb-3">
              <div>
                <h3 className="text-xl font-bold">{t('ptpl_catalog_title')}</h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{t('ptpl_catalog_text')}</p>
              </div>
              <button onClick={() => setCatalogOpen(false)} aria-label={t('btn_cancel')}><IconX size={20} /></button>
            </div>
            <div className="px-6 overflow-y-auto space-y-3 flex-1">
              {catalog.map(entry => (
                <div key={entry.catalog_key} className="flex items-start justify-between gap-3 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <div className="space-y-1 min-w-0">
                    <div className="font-semibold text-zinc-900 dark:text-white">{entry.name}</div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{entry.description}</p>
                    <p className="text-xs font-medium text-zinc-500">{summarizeTemplate(entry)}</p>
                  </div>
                  {entry.installed ? (
                    <span className="flex items-center gap-1 text-sm text-zinc-500 shrink-0"><IconCheck size={16} />{t('ptpl_installed')}</span>
                  ) : (
                    <button
                      onClick={() => install([entry.catalog_key])}
                      disabled={installing !== null}
                      className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50 shrink-0"
                    >
                      {t('ptpl_install')}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 p-6 pt-3">
              {catalog.some(e => !e.installed) && (
                <button
                  onClick={() => install(catalog.filter(e => !e.installed).map(e => e.catalog_key))}
                  disabled={installing !== null}
                  className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                >
                  {t('ptpl_install_all')}
                </button>
              )}
              <button onClick={() => setCatalogOpen(false)} className="px-4 py-2 rounded bg-zinc-200 dark:bg-zinc-700">{t('ptpl_close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Créer un modèle depuis une affaire */}
      {fromProjectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl w-full max-w-lg shadow-xl space-y-4">
            <div>
              <h3 className="text-xl font-bold">{t('ptpl_from_project_title')}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{t('ptpl_from_project_text')}</p>
            </div>
            <select className={inputCls} value={fromProjectId} onChange={e => setFromProjectId(e.target.value)}>
              <option value="">{t('ptpl_select_project')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.project_code ? `${p.project_code} ${p.name}` : p.name}</option>)}
            </select>
            <input className={inputCls} placeholder={t('ptpl_from_project_name')} value={fromProjectName} onChange={e => setFromProjectName(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setFromProjectOpen(false)} className="px-4 py-2 rounded bg-zinc-200 dark:bg-zinc-700">{t('btn_cancel')}</button>
              <button onClick={createFromProject} disabled={!fromProjectId || saving} className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50">{t('ptpl_create')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Éditeur de modèle */}
      {editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-xl w-full max-w-2xl max-h-[90dvh] flex flex-col shadow-xl">
            <div className="p-6 pb-0">
              <h3 className="text-xl font-bold mb-4">{isNew ? t('templates_new_title') : t('templates_edit_title')}</h3>
              <div role="tablist" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700 overflow-x-auto">
                {tabs.map(tb => (
                  <button
                    key={tb.id} role="tab" aria-selected={tab === tb.id} onClick={() => setTab(tb.id)}
                    className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${tab === tb.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                  >
                    {tb.label}{tb.count ? ` (${tb.count})` : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {tab === 'general' && (
                <>
                  <div>
                    <label className={labelCls}>{t('ptpl_name')}</label>
                    <input className={inputCls} placeholder={t('templates_name_placeholder')} value={editForm.name} onChange={e => patch({ name: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>{t('ptpl_description')}</label>
                    <textarea className={inputCls} rows={2} placeholder={t('templates_description_placeholder')} value={editForm.description} onChange={e => patch({ description: e.target.value })} />
                    <p className="text-xs text-zinc-500 mt-1">{t('ptpl_description_hint')}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>{t('ptpl_operation_type')}</label>
                      <select className={inputCls} value={editForm.operation_type ?? 'autre'} onChange={e => patch({ operation_type: e.target.value as TemplateOperationType })}>
                        {(Object.keys(OPERATION_LABELS) as TemplateOperationType[]).map(k => <option key={k} value={k}>{OPERATION_LABELS[k]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{t('ptpl_marche_type')}</label>
                      <select className={inputCls} value={editForm.marche_type ?? 'prive'} onChange={e => patch({ marche_type: e.target.value as TemplateMarcheType })}>
                        {(Object.keys(MARCHE_LABELS) as TemplateMarcheType[]).map(k => <option key={k} value={k}>{MARCHE_LABELS[k]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{t('ptpl_status')}</label>
                      <select className={inputCls} value={editForm.default_status} onChange={e => patch({ default_status: e.target.value as ProjectTemplate['default_status'] })}>
                        {STATUSES.map(s => <option key={s} value={s}>{t(STATUS_KEYS[s])}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{t('ptpl_budget')}</label>
                      <input type="number" min={0} inputMode="decimal" className={inputCls} placeholder={t('templates_default_budget_placeholder')} value={editForm.default_budget || ''} onChange={e => patch({ default_budget: Math.max(parseFloat(e.target.value) || 0, 0) })} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>{t('ptpl_project_description')}</label>
                    <textarea className={inputCls} rows={3} value={editForm.default_description} onChange={e => patch({ default_description: e.target.value })} />
                  </div>
                </>
              )}

              {tab === 'lots' && (
                <>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('ptpl_lots_hint')}</p>
                  {(editForm.default_lots ?? []).map((lot: TemplateLot, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input className={`${inputCls} !w-20 shrink-0`} aria-label={t('ptpl_lot_number')} value={lot.lot_number} onChange={e => patch({ default_lots: updateAt(editForm.default_lots, i, { lot_number: e.target.value }) })} />
                      <input className={inputCls} aria-label={t('ptpl_lot_title')} placeholder={t('ptpl_lot_title')} value={lot.lot_title} onChange={e => patch({ default_lots: updateAt(editForm.default_lots, i, { lot_title: e.target.value }) })} />
                      <button onClick={() => patch({ default_lots: removeAt(editForm.default_lots, i) })} aria-label={t('btn_delete')} className="text-zinc-500 hover:text-red-500 shrink-0"><IconTrash size={18} /></button>
                    </div>
                  ))}
                  <button onClick={addLot} className="flex items-center gap-2 text-sm text-blue-600 font-medium"><IconPlus size={16} />{t('ptpl_add_lot')}</button>
                </>
              )}

              {tab === 'milestones' && (
                <>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('ptpl_milestones_hint')}</p>
                  {(editForm.default_milestones ?? []).map((m: TemplateMilestone, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <div className="flex-1 min-w-0">
                        {i === 0 && <label className={labelCls}>{t('ptpl_milestone_title')}</label>}
                        <input className={inputCls} value={m.title} onChange={e => patch({ default_milestones: updateAt(editForm.default_milestones, i, { title: e.target.value }) })} />
                      </div>
                      <div className="w-28 shrink-0">
                        {i === 0 && <label className={labelCls}>{t('ptpl_milestone_offset')}</label>}
                        {numberInput(m.due_date_offset_days, n => patch({ default_milestones: updateAt(editForm.default_milestones, i, { due_date_offset_days: n }) }))}
                      </div>
                      <button onClick={() => patch({ default_milestones: removeAt(editForm.default_milestones, i) })} aria-label={t('btn_delete')} className="text-zinc-500 hover:text-red-500 shrink-0 pb-2"><IconTrash size={18} /></button>
                    </div>
                  ))}
                  <button onClick={addMilestone} className="flex items-center gap-2 text-sm text-blue-600 font-medium"><IconPlus size={16} />{t('ptpl_add_milestone')}</button>
                </>
              )}

              {tab === 'tasks' && (
                <>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('ptpl_tasks_hint')}</p>
                  {(editForm.default_tasks ?? []).map((task: TemplateTask, i) => (
                    <div key={i} className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-2">
                      <div className="flex gap-2 items-center">
                        <input className={inputCls} placeholder={t('ptpl_task_title')} aria-label={t('ptpl_task_title')} value={task.title} onChange={e => patch({ default_tasks: updateAt(editForm.default_tasks, i, { title: e.target.value }) })} />
                        <button onClick={() => patch({ default_tasks: removeAt(editForm.default_tasks, i) })} aria-label={t('btn_delete')} className="text-zinc-500 hover:text-red-500 shrink-0"><IconTrash size={18} /></button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">{t('ptpl_task_start')}</label>
                          {numberInput(task.start_offset_days, n => patch({ default_tasks: updateAt(editForm.default_tasks, i, { start_offset_days: n }) }))}
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">{t('ptpl_task_duration')}</label>
                          {numberInput(task.duration_days, n => patch({ default_tasks: updateAt(editForm.default_tasks, i, { duration_days: n }) }), 1)}
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">{t('ptpl_priority')}</label>
                          <select className={inputCls} value={task.priority ?? 'normal'} onChange={e => patch({ default_tasks: updateAt(editForm.default_tasks, i, { priority: e.target.value as TemplateTask['priority'] }) })}>
                            {PRIORITIES.map(p => <option key={p} value={p}>{t(PRIORITY_KEYS[p])}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button onClick={addTask} className="flex items-center gap-2 text-sm text-blue-600 font-medium"><IconPlus size={16} />{t('ptpl_add_task')}</button>
                </>
              )}
            </div>

            <div className="p-6 pt-3 border-t border-zinc-200 dark:border-zinc-700">
              {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={closeEditor} className="px-4 py-2 rounded bg-zinc-200 dark:bg-zinc-700">{t('btn_cancel')}</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50">{t('btn_save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
