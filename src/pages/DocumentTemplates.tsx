import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconPlus, IconTrash, IconEdit, IconCopy, IconFileText, IconDownload,
} from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { getAccessToken } from '../lib/authToken';
import { useSettings } from '../hooks/useSettings';
import type { DocumentTemplate, DocumentTemplateVariable, Project } from '../types';
import { fillTemplate, missingRequiredVariables, exportTemplatePdf, exportTemplateDocx, downloadPdfBlob, downloadDocxBlob } from '../lib/templateExport';

const CATEGORIES: DocumentTemplate['category'][] = ['Contrat MOE', 'CCTP', 'DPGF', 'Candidature', 'Courrier', 'Autre'];

const emptyForm = (): Partial<DocumentTemplate> => ({
  name: '', category: 'Autre', description: '', content: '', variables: [],
});

export default function DocumentTemplates() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<DocumentTemplate>>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);

  const [generateFor, setGenerateFor] = useState<DocumentTemplate | null>(null);
  const [genValues, setGenValues] = useState<Record<string, string>>({});
  const [genProjectId, setGenProjectId] = useState('');
  const [genSaveToProject, setGenSaveToProject] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const fetchTemplates = () => {
    setLoading(true);
    apiFetch<DocumentTemplate[]>('/api/document_templates')
      .then(data => { setTemplates(data); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTemplates();
    apiFetch<Project[]>('/api/projects').then(setProjects).catch(() => {});
  }, []);

  const visibleTemplates = useMemo(
    () => activeCategory === 'all' ? templates : templates.filter(tpl => tpl.category === activeCategory),
    [templates, activeCategory],
  );

  const openNew = () => { setEditingId(null); setEditForm(emptyForm()); setEditorOpen(true); };
  const openEdit = (tpl: DocumentTemplate) => { setEditingId(tpl.id); setEditForm(tpl); setEditorOpen(true); };

  const saveTemplate = async () => {
    if (!editForm.name?.trim() || !editForm.content?.trim()) return;
    const payload = {
      name: editForm.name, category: editForm.category, description: editForm.description,
      content: editForm.content, variables: editForm.variables || [],
    };
    try {
      if (editingId) await apiFetch(`/api/document_templates/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await apiFetch('/api/document_templates', { method: 'POST', body: JSON.stringify(payload) });
      setEditorOpen(false);
      fetchTemplates();
    } catch (e: any) {
      alert(e.message || t('document_templates_save_error'));
    }
  };

  const deleteTemplate = async (tpl: DocumentTemplate) => {
    if (!confirm(t('document_templates_delete_confirm', { name: tpl.name }))) return;
    try {
      await apiFetch(`/api/document_templates/${tpl.id}`, { method: 'DELETE' });
      fetchTemplates();
    } catch (e: any) {
      alert(e.message || t('document_templates_delete_error'));
    }
  };

  const duplicateTemplate = async (tpl: DocumentTemplate) => {
    try {
      await apiFetch(`/api/document_templates/${tpl.id}/duplicate`, { method: 'POST' });
      fetchTemplates();
    } catch (e: any) {
      alert(e.message || t('document_templates_duplicate_error'));
    }
  };

  const openGenerate = (tpl: DocumentTemplate) => {
    setGenerateFor(tpl);
    const defaults: Record<string, string> = {};
    for (const v of tpl.variables) if (v.default_value) defaults[v.key] = v.default_value;
    setGenValues(defaults);
    setGenProjectId('');
    setGenSaveToProject(false);
    setGenError(null);
  };

  useEffect(() => {
    if (!generateFor || !genProjectId) return;
    const project = projects.find(p => p.id === genProjectId);
    if (!project) return;
    setGenValues(prev => ({
      ...prev,
      client_nom: prev.client_nom || project.client || '',
      nom_operation: prev.nom_operation || project.name || '',
      adresse_operation: prev.adresse_operation || project.address || '',
    }));
  }, [genProjectId, generateFor, projects]);

  const filledPreview = generateFor ? fillTemplate(generateFor.content, genValues) : '';

  const handleGenerate = async (format: 'pdf' | 'docx') => {
    if (!generateFor) return;
    const missing = missingRequiredVariables(generateFor.variables, genValues);
    if (missing.length > 0) { setGenError(t('document_templates_missing_fields', { fields: missing.join(', ') })); return; }
    setGenBusy(true);
    setGenError(null);
    try {
      const { filled_content } = await apiFetch<{ filled_content: string }>(`/api/document_templates/${generateFor.id}/generate`, {
        method: 'POST', body: JSON.stringify({ variable_values: genValues }),
      });
      const agency = { agencyName: settings?.agencyName, logoUrl: settings?.logoUrl, address: settings?.address, phone: settings?.phone, email: settings?.email };
      const blob = format === 'pdf'
        ? await exportTemplatePdf(generateFor.name, filled_content, agency)
        : await exportTemplateDocx(generateFor.name, filled_content, agency);

      if (genSaveToProject && genProjectId) {
        const formData = new FormData();
        const filename = `${generateFor.name}.${format}`;
        formData.append('file', blob, filename);
        formData.append('project_id', genProjectId);
        formData.append('name', generateFor.name);
        formData.append('category', 'Template');
        formData.append('description', t('document_templates_generated_from', { name: generateFor.name }));
        const token = await getAccessToken();
        const res = await fetch('/api/documents', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData });
        if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || 'Failed to save document'); }
      } else {
        if (format === 'pdf') downloadPdfBlob(blob, generateFor.name);
        else downloadDocxBlob(blob, generateFor.name);
      }
      if (!genSaveToProject) { /* keep modal open after download */ } else { setGenerateFor(null); }
    } catch (e: any) {
      setGenError(e.message || t('document_templates_generate_error'));
    } finally {
      setGenBusy(false);
    }
  };

  const updateVariable = (idx: number, patch: Partial<DocumentTemplateVariable>) => {
    const vars = [...(editForm.variables || [])];
    vars[idx] = { ...vars[idx], ...patch };
    setEditForm({ ...editForm, variables: vars });
  };
  const addVariable = () => setEditForm({ ...editForm, variables: [...(editForm.variables || []), { key: '', label: '', type: 'text' }] });
  const removeVariable = (idx: number) => setEditForm({ ...editForm, variables: (editForm.variables || []).filter((_, i) => i !== idx) });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('document_templates_title')}</h2>
        <button onClick={openNew} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md font-medium hover:bg-blue-700 transition-colors shadow-sm">
          <IconPlus size={18} />
          {t('document_templates_new_btn')}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setActiveCategory('all')} className={`px-3 py-1.5 rounded-full text-sm font-medium ${activeCategory === 'all' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}`}>
          {t('document_templates_category_all')}
        </button>
        {CATEGORIES.map(cat => (
          <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-3 py-1.5 rounded-full text-sm font-medium ${activeCategory === cat ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}`}>
            {cat}
          </button>
        ))}
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {loading ? (
        <p className="text-zinc-500 text-sm">{t('loading')}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleTemplates.map(tpl => (
            <div key={tpl.id} className="bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm flex flex-col">
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                  <IconFileText size={18} className="text-blue-600 shrink-0" />
                  {tpl.name}
                </h3>
              </div>
              <span className="inline-block w-fit text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 mb-2">{tpl.category}</span>
              {tpl.is_seeded && (
                <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1 mb-2">
                  {t('document_templates_seeded_badge')}
                </p>
              )}
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 flex-1">{tpl.description}</p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => openGenerate(tpl)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">
                  <IconDownload size={15} /> {t('document_templates_generate_btn')}
                </button>
                <button onClick={() => duplicateTemplate(tpl)} title={t('document_templates_duplicate_btn')} className="p-1.5 rounded text-zinc-500 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-700">
                  <IconCopy size={16} />
                </button>
                {tpl.editable && (
                  <>
                    <button onClick={() => openEdit(tpl)} title={t('btn_edit')} className="p-1.5 rounded text-zinc-500 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-700">
                      <IconEdit size={16} />
                    </button>
                    <button onClick={() => deleteTemplate(tpl)} title={t('btn_delete')} className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-700">
                      <IconTrash size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">{editingId ? t('document_templates_edit_title') : t('document_templates_new_title')}</h3>
            <div className="space-y-3">
              <input className="w-full p-2 border rounded dark:bg-zinc-800 dark:border-zinc-700" placeholder={t('document_templates_name_placeholder')}
                value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              <select className="w-full p-2 border rounded dark:bg-zinc-800 dark:border-zinc-700" value={editForm.category || 'Autre'}
                onChange={e => setEditForm({ ...editForm, category: e.target.value as DocumentTemplate['category'] })}>
                {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <input className="w-full p-2 border rounded dark:bg-zinc-800 dark:border-zinc-700" placeholder={t('document_templates_description_placeholder')}
                value={editForm.description || ''} onChange={e => setEditForm({ ...editForm, description: e.target.value })} />
              <textarea className="w-full p-2 border rounded font-mono text-sm dark:bg-zinc-800 dark:border-zinc-700" rows={10}
                placeholder={t('document_templates_content_placeholder')} value={editForm.content || ''}
                onChange={e => setEditForm({ ...editForm, content: e.target.value })} />

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-sm font-semibold">{t('document_templates_variables_label')}</label>
                  <button onClick={addVariable} className="text-xs text-blue-600 hover:underline">{t('document_templates_add_variable')}</button>
                </div>
                <div className="space-y-2">
                  {(editForm.variables || []).map((v, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input className="flex-1 p-1.5 border rounded text-sm dark:bg-zinc-800 dark:border-zinc-700" placeholder="cle_variable"
                        value={v.key} onChange={e => updateVariable(idx, { key: e.target.value })} />
                      <input className="flex-1 p-1.5 border rounded text-sm dark:bg-zinc-800 dark:border-zinc-700" placeholder={t('document_templates_variable_label_placeholder')}
                        value={v.label} onChange={e => updateVariable(idx, { label: e.target.value })} />
                      <select className="p-1.5 border rounded text-sm dark:bg-zinc-800 dark:border-zinc-700" value={v.type}
                        onChange={e => updateVariable(idx, { type: e.target.value as DocumentTemplateVariable['type'] })}>
                        <option value="text">Texte</option>
                        <option value="textarea">Texte long</option>
                        <option value="date">Date</option>
                        <option value="number">Nombre</option>
                      </select>
                      <label className="text-xs flex items-center gap-1">
                        <input type="checkbox" checked={!!v.required} onChange={e => updateVariable(idx, { required: e.target.checked })} />
                        {t('document_templates_variable_required')}
                      </label>
                      <button onClick={() => removeVariable(idx)} className="text-zinc-400 hover:text-red-600"><IconTrash size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditorOpen(false)} className="px-4 py-2 rounded bg-zinc-200 dark:bg-zinc-700">{t('btn_cancel')}</button>
                <button onClick={saveTemplate} className="px-4 py-2 rounded bg-blue-600 text-white">{t('btn_save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Generate modal */}
      {generateFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl w-full max-w-4xl shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">{t('document_templates_generate_title', { name: generateFor.name })}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium block mb-1">{t('document_templates_project_picker')}</label>
                  <select className="w-full p-2 border rounded dark:bg-zinc-800 dark:border-zinc-700" value={genProjectId} onChange={e => setGenProjectId(e.target.value)}>
                    <option value="">{t('document_templates_project_none')}</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {generateFor.variables.map(v => (
                  <div key={v.key}>
                    <label className="text-sm font-medium block mb-1">{v.label}{v.required && ' *'}</label>
                    {v.type === 'textarea' ? (
                      <textarea className="w-full p-2 border rounded text-sm dark:bg-zinc-800 dark:border-zinc-700" rows={3}
                        value={genValues[v.key] || ''} onChange={e => setGenValues({ ...genValues, [v.key]: e.target.value })} />
                    ) : (
                      <input type={v.type === 'number' ? 'number' : v.type === 'date' ? 'date' : 'text'}
                        className="w-full p-2 border rounded text-sm dark:bg-zinc-800 dark:border-zinc-700"
                        value={genValues[v.key] || ''} onChange={e => setGenValues({ ...genValues, [v.key]: e.target.value })} />
                    )}
                  </div>
                ))}
                <label className="flex items-center gap-2 text-sm pt-2">
                  <input type="checkbox" disabled={!genProjectId} checked={genSaveToProject} onChange={e => setGenSaveToProject(e.target.checked)} />
                  {t('document_templates_save_to_project')}
                </label>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">{t('document_templates_preview')}</label>
                <div className="border rounded p-3 text-xs whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 max-h-[420px] overflow-y-auto">
                  {filledPreview}
                </div>
              </div>
            </div>
            {genError && <p className="text-red-600 text-sm mt-3">{genError}</p>}
            <div className="flex justify-end gap-2 pt-4">
              <button onClick={() => setGenerateFor(null)} className="px-4 py-2 rounded bg-zinc-200 dark:bg-zinc-700">{t('btn_cancel')}</button>
              <button disabled={genBusy} onClick={() => handleGenerate('pdf')} className="px-4 py-2 rounded bg-zinc-700 text-white disabled:opacity-50">{t('document_templates_download_pdf')}</button>
              <button disabled={genBusy} onClick={() => handleGenerate('docx')} className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50">{t('document_templates_download_docx')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
