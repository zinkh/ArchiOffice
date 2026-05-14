import { useState, useEffect, useRef } from 'react';
import { IconFile, IconPlus, IconHistory, IconDownload, IconTrash, IconX, IconUpload } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { Document, Project } from '../types';
import { useUser } from '../UserContext';
import { useTranslation } from 'react-i18next';

export default function Documents() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('General');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { currentUser } = useUser();
  const { t } = useTranslation();
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('General');
  const [editDescription, setEditDescription] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [docToDelete, setDocToDelete] = useState<string | null>(null);

  const refreshDocuments = () => {
    fetch('/api/documents').then(res => res.json()).then(setDocuments);
  };

  const handleDelete = async () => {
    if (!docToDelete) return;
    try {
      const response = await fetch(`/api/documents/${docToDelete}`, { method: 'DELETE' });
      if (response.ok) {
        refreshDocuments();
        setDocToDelete(null);
      } else {
        const errorText = await response.text();
        alert(`Failed to delete document: ${response.status} ${errorText}`);
      }
    } catch (error) {
      alert('Error deleting document: ' + error);
    }
  };

  const handleUpdate = async () => {
    if (!editingDoc) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('name', editName);
      formData.append('category', editCategory);
      formData.append('description', editDescription);
      formData.append('uploaded_by', currentUser?.name || 'Unknown');
      if (editFile) {
        formData.append('file', editFile);
      }

      const response = await fetch(`/api/documents/${editingDoc.id}`, {
        method: 'PUT',
        body: formData,
      });
      if (response.ok) {
        refreshDocuments();
        setIsUpdateModalOpen(false);
        setEditingDoc(null);
        setEditFile(null);
      } else {
        const errorText = await response.text();
        alert(`Failed to update document: ${response.status} ${errorText}`);
      }
    } catch (error) {
      alert('Error updating document: ' + error);
    } finally {
      setIsUploading(false);
    }
  };

  const openUpdateModal = (doc: Document) => {
    setEditingDoc(doc);
    setEditName(doc.name);
    setEditCategory(doc.category);
    setEditDescription(doc.description || '');
    setIsUpdateModalOpen(true);
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('project_id', selectedProject);
    formData.append('name', selectedFile.name);
    formData.append('category', selectedCategory);
    formData.append('description', '');
    formData.append('uploaded_by', currentUser?.name || 'Unknown');

    setIsUploading(true);
    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      });
      if (response.ok) {
        refreshDocuments();
        setIsModalOpen(false);
        setSelectedFile(null);
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        alert(`Failed to upload document: ${errorData.error || response.statusText}`);
      }
    } catch (error) {
      console.error('Error uploading document:', error);
      alert('Error uploading document');
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    fetch('/api/projects').then(res => res.json()).then(setProjects);
    fetch('/api/documents').then(res => res.json()).then(setDocuments);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('documents')}</h1>
        <div className="flex flex-col items-end gap-1">
          <p className="text-xs text-zinc-500">{t('documents_subtitle')}</p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700"
          >
            <IconPlus size={18} /> {t('documents_upload_btn')}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-zinc-900 p-6 rounded-3xl w-full max-w-md space-y-4 shadow-2xl"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold">{t('documents_upload_title')}</h2>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
                  <IconX size={20} />
                </button>
              </div>
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('documents_project_label')}</label>
                <select className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" onChange={(e) => setSelectedProject(e.target.value)} value={selectedProject}>
                  <option value="">{t('documents_select_project')}</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('documents_category_label')}</label>
                <select className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" onChange={(e) => setSelectedCategory(e.target.value)} value={selectedCategory}>
                  <option value="General">{t('documents_category_general')}</option>
                  <option value="Contract">{t('documents_category_contract')}</option>
                  <option value="Plan">{t('documents_category_plan')}</option>
                </select>
              </div>
              <div
                className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all"
                onDrop={(e) => { e.preventDefault(); setSelectedFile(e.dataTransfer.files[0]); }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
              >
                <IconUpload className="mx-auto mb-2 text-zinc-400" size={32} />
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {selectedFile ? selectedFile.name : t('documents_drop_file')}
                </p>
                <input 
                  type="file" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} 
                />
              </div>
              <button 
                onClick={handleFileUpload} 
                disabled={isUploading || !selectedFile}
                className={`w-full py-3 rounded-xl font-bold text-white transition-all shadow-lg shadow-blue-500/20 ${
                  isUploading || !selectedFile 
                    ? 'bg-zinc-400 cursor-not-allowed' 
                    : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98]'
                }`}
              >
                {isUploading ? t('documents_uploading') : t('documents_upload_btn')}
              </button>
            </motion.div>
          </div>
        )}

        {isUpdateModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-zinc-900 p-6 rounded-3xl w-full max-w-md space-y-4 shadow-2xl"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold">{t('documents_edit_title')}</h2>
                <button onClick={() => setIsUpdateModalOpen(false)} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
                  <IconX size={20} />
                </button>
              </div>
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('documents_name_label')}</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  placeholder={t('documents_name_placeholder')}
                />
              </div>
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('documents_category_label')}</label>
                <select className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" onChange={(e) => setEditCategory(e.target.value)} value={editCategory}>
                  <option value="General">{t('documents_category_general')}</option>
                  <option value="Contract">{t('documents_category_contract')}</option>
                  <option value="Plan">{t('documents_category_plan')}</option>
                </select>
              </div>
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('documents_description_label')}</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all min-h-[100px]"
                  placeholder={t('documents_description_placeholder')}
                />
              </div>
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('documents_replace_file_label')}</label>
                <div
                  className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-4 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all"
                  onClick={() => editFileInputRef.current?.click()}
                >
                  <p className="text-xs text-zinc-500">
                    {editFile ? editFile.name : t('documents_select_new_version')}
                  </p>
                  <input 
                    type="file" 
                    className="hidden" 
                    ref={editFileInputRef}
                    onChange={(e) => setEditFile(e.target.files?.[0] || null)} 
                  />
                </div>
              </div>
              <button 
                onClick={handleUpdate} 
                disabled={isUploading}
                className={`w-full py-3 rounded-xl font-bold text-white transition-all active:scale-[0.98] shadow-lg shadow-blue-500/20 ${
                  isUploading ? 'bg-zinc-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isUploading ? t('documents_updating') : t('documents_save_changes')}
              </button>
            </motion.div>
          </div>
        )}

        {docToDelete && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-zinc-900 p-6 rounded-3xl w-full max-w-sm space-y-6 shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto">
                <IconTrash size={32} />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold">{t('documents_confirm_delete_title')}</h2>
                <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                  {t('documents_confirm_delete_msg')}
                </p>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setDocToDelete(null)}
                  className="flex-1 py-3 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl font-bold transition-all"
                >
                  {t('btn_cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-red-500/20"
                >
                  {t('btn_delete')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-6 py-4">{t('documents_col_preview')}</th>
                <th className="px-6 py-4">{t('documents_col_name')}</th>
                <th className="px-6 py-4">{t('documents_col_project')}</th>
                <th className="px-6 py-4">{t('documents_col_category')}</th>
                <th className="px-6 py-4">{t('documents_col_version')}</th>
                <th className="px-6 py-4">{t('documents_col_uploaded_at')}</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4">
                    {doc.file_url.match(/\.(jpg|jpeg|png|gif)$/i) ? (
                      <img src={doc.file_url} alt={doc.name} className="w-10 h-10 object-cover rounded-lg" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 rounded-lg text-zinc-500">
                        <IconFile size={20} />
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white" title={doc.name}>
                    {doc.name.length > 10 ? `${doc.name.substring(0, 10)}...` : doc.name}
                  </td>
                  <td className="px-6 py-4 text-zinc-500">{projects.find(p => p.id === doc.project_id)?.name || t('documents_na')}</td>
                  <td className="px-6 py-4 text-zinc-500">{doc.category}</td>
                  <td className="px-6 py-4 text-zinc-500">v{doc.version}</td>
                  <td className="px-6 py-4 text-zinc-500">{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 flex items-center gap-2">
                    <button className="p-2 text-zinc-400 hover:text-blue-500" onClick={() => openUpdateModal(doc)}><IconHistory size={16} /></button>
                    <button className="p-2 text-zinc-400 hover:text-blue-500" onClick={() => window.open(doc.file_url, '_blank')}><IconDownload size={16} /></button>
                    <button className="p-2 text-zinc-400 hover:text-red-500" onClick={() => setDocToDelete(doc.id)}><IconTrash size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
