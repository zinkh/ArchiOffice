import { useState, useEffect } from 'react';
import { IconPlus, IconTrash, IconEdit, IconFileText } from '@tabler/icons-react';
import { db } from '../db';
import { apiFetch } from '../lib/api';
import { ProjectTemplate } from '../types';
import { useTranslation } from 'react-i18next';

export default function ProjectTemplates() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<ProjectTemplate | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    // 1. Load from Dexie (offline support)
    const local = await db.projectTemplates.toArray();
    if (local.length > 0) setTemplates(local);
    // 2. Sync from API
    if (navigator.onLine) {
      try {
        const data = await apiFetch<ProjectTemplate[]>('/api/project-templates');
        await db.projectTemplates.clear();
        await db.projectTemplates.bulkPut(data);
        setTemplates(data);
      } catch (err) {
        console.error('Failed to sync templates:', err);
      }
    }
  };

  const handleSave = async () => {
    if (!editForm) return;
    const isNew = !templates.some(t => t.id === editForm.id);
    // 1. Save locally
    await db.projectTemplates.put(editForm);
    // 2. Sync to API
    if (navigator.onLine) {
      try {
        if (isNew) {
          await apiFetch('/api/project-templates', { method: 'POST', body: JSON.stringify(editForm) });
        } else {
          await apiFetch(`/api/project-templates/${editForm.id}`, { method: 'PUT', body: JSON.stringify(editForm) });
        }
      } catch (err) {
        console.error('Failed to sync template:', err);
      }
    }
    setIsModalOpen(false);
    setEditForm(null);
    fetchTemplates();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    // 1. Delete locally
    await db.projectTemplates.delete(id);
    // 2. Sync to API
    if (navigator.onLine) {
      try {
        await apiFetch(`/api/project-templates/${id}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to delete template from API:', err);
      }
    }
    fetchTemplates();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('templates')}</h2>
        <button 
          onClick={() => {
            setEditForm({
              id: `pt${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
              name: '',
              description: '',
              default_status: 'Planning',
              default_budget: 0,
              default_description: ''
            });
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md font-medium hover:bg-blue-700 transition-colors shadow-sm"
        >
          <IconPlus size={18} />
          {t('templates_add_btn')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map(template => (
          <div key={template.id} className="bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-white">{template.name}</h3>
              <div className="flex gap-2">
                <button onClick={() => { setEditForm(template); setIsModalOpen(true); }} className="text-zinc-500 hover:text-blue-500"><IconEdit size={18} /></button>
                <button onClick={() => handleDelete(template.id)} className="text-zinc-500 hover:text-red-500"><IconTrash size={18} /></button>
              </div>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">{template.description}</p>
          </div>
        ))}
      </div>

      {isModalOpen && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl w-full max-w-lg shadow-xl">
            <h3 className="text-xl font-bold mb-4">{editForm.id ? t('templates_edit_title') : t('templates_new_title')}</h3>
            <div className="space-y-4">
              <input className="w-full p-2 border rounded" placeholder={t('templates_name_placeholder')} value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} />
              <textarea className="w-full p-2 border rounded" placeholder={t('templates_description_placeholder')} value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} />
              <input type="number" className="w-full p-2 border rounded" placeholder={t('templates_default_budget_placeholder')} value={editForm.default_budget} onChange={e => setEditForm({...editForm, default_budget: parseFloat(e.target.value)})} />
              <div className="flex justify-end gap-2">
                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded bg-zinc-200 dark:bg-zinc-700">{t('btn_cancel')}</button>
                <button onClick={handleSave} className="px-4 py-2 rounded bg-blue-600 text-white">{t('btn_save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
