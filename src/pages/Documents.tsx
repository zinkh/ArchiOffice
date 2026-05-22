import { useState, useEffect, useRef } from 'react';
import { IconFile, IconPlus, IconHistory, IconDownload, IconTrash, IconX, IconUpload, IconCloudOff, IconChevronDown, IconChevronRight, IconFolder, IconFolderOpen } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { Document, DocumentPhase, Project } from '../types';
import { useUser } from '../UserContext';
import { apiFetch } from '../lib/api';
import { supabase } from '../lib/supabase';

const PHASES: DocumentPhase[] = ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR', 'Général'];

const PHASE_COLORS: Record<DocumentPhase, string> = {
  ESQ: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  APS: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  APD: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  PC: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  PRO: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  DCE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  ACT: 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300',
  VISA: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  DET: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  AOR: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  Général: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

export default function Documents() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('General');
  const [selectedPhase, setSelectedPhase] = useState<DocumentPhase>('Général');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { currentUser } = useUser();
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('General');
  const [editPhase, setEditPhase] = useState<DocumentPhase>('Général');
  const [editDescription, setEditDescription] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [docToDelete, setDocToDelete] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Tree navigation state
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<DocumentPhase | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const refreshDocuments = async () => {
    const data = await apiFetch<Document[]>('/api/documents');
    setDocuments(data || []);
  };

  useEffect(() => {
    apiFetch<Project[]>('/api/projects').then(d => setProjects(d || []));
    refreshDocuments();
  }, []);

  const handleDelete = async () => {
    if (!docToDelete) return;
    try {
      await apiFetch<any>(`/api/documents/${docToDelete}`, { method: 'DELETE' });
      refreshDocuments();
      setDocToDelete(null);
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
      formData.append('phase', editPhase);
      formData.append('description', editDescription);
      formData.append('uploaded_by', currentUser?.name || 'Unknown');
      if (editFile) formData.append('file', editFile);

      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/documents/${editingDoc.id}`, {
        method: 'PUT',
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: formData,
      });
      if (response.ok) {
        refreshDocuments();
        setIsUpdateModalOpen(false);
        setEditingDoc(null);
        setEditFile(null);
      } else {
        alert(`Failed to update document: ${response.statusText}`);
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
    setEditPhase(doc.phase || 'Général');
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
    formData.append('phase', selectedPhase);
    formData.append('description', '');
    formData.append('uploaded_by', currentUser?.name || 'Unknown');

    setIsUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
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
      alert('Error uploading document: ' + error);
    } finally {
      setIsUploading(false);
    }
  };

  // Build tree: project → phase → docs
  const projectsWithDocs = projects.filter(p =>
    documents.some(d => d.project_id === p.id)
  );
  const unassignedDocs = documents.filter(d => !d.project_id);

  const getProjectDocs = (projectId: string) =>
    documents.filter(d => d.project_id === projectId);

  const getPhaseDocs = (projectId: string | null, phase: DocumentPhase) =>
    documents.filter(d =>
      d.project_id === projectId &&
      (d.phase || 'Général') === phase
    );

  const getPhasesForProject = (projectId: string | null): DocumentPhase[] => {
    const used = new Set(
      documents
        .filter(d => d.project_id === projectId)
        .map(d => (d.phase || 'Général') as DocumentPhase)
    );
    return PHASES.filter(p => used.has(p));
  };

  // Filtered docs for main view
  const visibleDocs = (() => {
    if (activeProject === 'unassigned') {
      if (activePhase) return getPhaseDocs(null, activePhase);
      return unassignedDocs;
    }
    if (activeProject) {
      if (activePhase) return getPhaseDocs(activeProject, activePhase);
      return getProjectDocs(activeProject);
    }
    if (activePhase) return documents.filter(d => (d.phase || 'Général') === activePhase);
    return documents;
  })();

  const toggleProject = (id: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex gap-4 h-full">
      {/* Sidebar tree */}
      <div className="w-60 shrink-0 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-120px)]">
        <button
          onClick={() => { setActiveProject(null); setActivePhase(null); }}
          className={`w-full text-left px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
            !activeProject && !activePhase
              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
              : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          Tous les documents
        </button>

        <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-3 pt-2 pb-1">Par affaire</div>

        {projectsWithDocs.map(p => {
          const isExpanded = expandedProjects.has(p.id);
          const phases = getPhasesForProject(p.id);
          const isProjectActive = activeProject === p.id && !activePhase;
          return (
            <div key={p.id}>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleProject(p.id)}
                  className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 shrink-0"
                >
                  {isExpanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                </button>
                <button
                  onClick={() => { setActiveProject(p.id); setActivePhase(null); if (!isExpanded) toggleProject(p.id); }}
                  className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-sm transition-colors text-left ${
                    isProjectActive
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-semibold'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {isExpanded ? <IconFolderOpen size={14} className="shrink-0" /> : <IconFolder size={14} className="shrink-0" />}
                  <span className="truncate text-xs">{p.name}</span>
                  <span className="ml-auto text-[10px] text-zinc-400">{getProjectDocs(p.id).length}</span>
                </button>
              </div>
              {isExpanded && phases.length > 0 && (
                <div className="ml-7 mt-0.5 space-y-0.5">
                  {phases.map(phase => (
                    <button
                      key={phase}
                      onClick={() => { setActiveProject(p.id); setActivePhase(phase); }}
                      className={`w-full text-left px-2 py-1 rounded-lg text-xs transition-colors flex items-center justify-between gap-1 ${
                        activeProject === p.id && activePhase === phase
                          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-semibold'
                          : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${PHASE_COLORS[phase]}`}>{phase}</span>
                      <span className="text-[10px] text-zinc-400">{getPhaseDocs(p.id, phase).length}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {unassignedDocs.length > 0 && (
          <div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => toggleProject('unassigned')}
                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 shrink-0"
              >
                {expandedProjects.has('unassigned') ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              </button>
              <button
                onClick={() => { setActiveProject('unassigned'); setActivePhase(null); if (!expandedProjects.has('unassigned')) toggleProject('unassigned'); }}
                className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-sm transition-colors text-left ${
                  activeProject === 'unassigned' && !activePhase
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <IconFolder size={14} className="shrink-0" />
                <span className="text-xs">Sans projet</span>
                <span className="ml-auto text-[10px] text-zinc-400">{unassignedDocs.length}</span>
              </button>
            </div>
            {expandedProjects.has('unassigned') && (
              <div className="ml-7 mt-0.5 space-y-0.5">
                {getPhasesForProject(null).map(phase => (
                  <button
                    key={phase}
                    onClick={() => { setActiveProject('unassigned'); setActivePhase(phase); }}
                    className={`w-full text-left px-2 py-1 rounded-lg text-xs transition-colors flex items-center justify-between gap-1 ${
                      activeProject === 'unassigned' && activePhase === phase
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-semibold'
                        : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${PHASE_COLORS[phase]}`}>{phase}</span>
                    <span className="text-[10px] text-zinc-400">{getPhaseDocs(null, phase).length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 space-y-4 min-w-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
              {activeProject
                ? (activeProject === 'unassigned'
                    ? 'Sans projet'
                    : projects.find(p => p.id === activeProject)?.name || 'Documents')
                : 'Documents'}
              {activePhase && (
                <span className={`ml-2 text-sm font-bold px-2 py-0.5 rounded ${PHASE_COLORS[activePhase]}`}>{activePhase}</span>
              )}
            </h1>
            <p className="text-xs text-zinc-500">{visibleDocs.length} document{visibleDocs.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              {!isOnline && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 rounded-lg text-xs font-medium">
                  <IconCloudOff size={13} />
                  Upload indisponible hors-ligne
                </span>
              )}
              <button
                onClick={() => setIsModalOpen(true)}
                disabled={!isOnline}
                title={!isOnline ? 'Connexion requise pour uploader des documents' : undefined}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <IconPlus size={18} /> Ajouter un document
              </button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {/* Upload modal */}
          {isModalOpen && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white dark:bg-zinc-900 p-6 rounded-3xl w-full max-w-md space-y-4 shadow-2xl"
              >
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-bold">Uploader un document</h2>
                  <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
                    <IconX size={20} />
                  </button>
                </div>

                {!isOnline && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl text-sm text-amber-700 dark:text-amber-400">
                    <IconCloudOff size={16} className="shrink-0" />
                    <span>Upload impossible hors-ligne. Reconnectez-vous pour envoyer des documents.</span>
                  </div>
                )}

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Affaire</label>
                  <select
                    className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    onChange={e => setSelectedProject(e.target.value)}
                    value={selectedProject}
                  >
                    <option value="">Aucune affaire</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Phase</label>
                    <select
                      className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      onChange={e => setSelectedPhase(e.target.value as DocumentPhase)}
                      value={selectedPhase}
                    >
                      {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Catégorie</label>
                    <select
                      className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      onChange={e => setSelectedCategory(e.target.value)}
                      value={selectedCategory}
                    >
                      <option value="General">Général</option>
                      <option value="Contract">Contrat</option>
                      <option value="Plan">Plan</option>
                      <option value="Report">Rapport</option>
                    </select>
                  </div>
                </div>

                <div
                  className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all"
                  onDrop={e => { e.preventDefault(); setSelectedFile(e.dataTransfer.files[0]); }}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <IconUpload className="mx-auto mb-2 text-zinc-400" size={32} />
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {selectedFile ? selectedFile.name : 'Glissez un fichier ou cliquez pour sélectionner'}
                  </p>
                  <input
                    type="file"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                  />
                </div>
                <button
                  onClick={handleFileUpload}
                  disabled={isUploading || !selectedFile || !isOnline}
                  className={`w-full py-3 rounded-xl font-bold text-white transition-all shadow-lg shadow-blue-500/20 ${
                    isUploading || !selectedFile
                      ? 'bg-zinc-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98]'
                  }`}
                >
                  {isUploading ? 'Envoi en cours...' : 'Uploader'}
                </button>
              </motion.div>
            </div>
          )}

          {/* Edit modal */}
          {isUpdateModalOpen && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white dark:bg-zinc-900 p-6 rounded-3xl w-full max-w-md space-y-4 shadow-2xl"
              >
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-bold">Modifier le document</h2>
                  <button onClick={() => setIsUpdateModalOpen(false)} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
                    <IconX size={20} />
                  </button>
                </div>
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Nom</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Phase</label>
                    <select
                      className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      onChange={e => setEditPhase(e.target.value as DocumentPhase)}
                      value={editPhase}
                    >
                      {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Catégorie</label>
                    <select
                      className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      onChange={e => setEditCategory(e.target.value)}
                      value={editCategory}
                    >
                      <option value="General">Général</option>
                      <option value="Contract">Contrat</option>
                      <option value="Plan">Plan</option>
                      <option value="Report">Rapport</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
                  <textarea
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all min-h-[80px]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Nouvelle version (optionnel)</label>
                  <div
                    className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-4 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all"
                    onClick={() => editFileInputRef.current?.click()}
                  >
                    <p className="text-xs text-zinc-500">
                      {editFile ? editFile.name : 'Cliquez pour sélectionner un nouveau fichier'}
                    </p>
                    <input
                      type="file"
                      className="hidden"
                      ref={editFileInputRef}
                      onChange={e => setEditFile(e.target.files?.[0] || null)}
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
                  {isUploading ? 'Enregistrement...' : 'Sauvegarder'}
                </button>
              </motion.div>
            </div>
          )}

          {/* Delete confirm */}
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
                  <h2 className="text-xl font-bold">Supprimer le document ?</h2>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm">Cette action est irréversible.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDocToDelete(null)}
                    className="flex-1 py-3 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl font-bold transition-all"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleDelete}
                    className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-red-500/20"
                  >
                    Supprimer
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Documents table */}
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-800">
                  <th className="px-6 py-4">Aperçu</th>
                  <th className="px-6 py-4">Nom</th>
                  <th className="px-6 py-4">Affaire</th>
                  <th className="px-6 py-4">Phase</th>
                  <th className="px-6 py-4">Version</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {visibleDocs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-zinc-400 text-sm">
                      Aucun document dans cette sélection
                    </td>
                  </tr>
                )}
                {visibleDocs.map(doc => (
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
                      {doc.name.length > 28 ? `${doc.name.substring(0, 28)}…` : doc.name}
                    </td>
                    <td className="px-6 py-4 text-zinc-500 text-sm">{projects.find(p => p.id === doc.project_id)?.name || '—'}</td>
                    <td className="px-6 py-4">
                      {doc.phase ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${PHASE_COLORS[doc.phase as DocumentPhase] || PHASE_COLORS['Général']}`}>
                          {doc.phase}
                        </span>
                      ) : (
                        <span className="text-zinc-400 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-zinc-500 text-sm">v{doc.version}</td>
                    <td className="px-6 py-4 text-zinc-500 text-sm">{new Date(doc.uploaded_at).toLocaleDateString('fr-FR')}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <button className="p-2 text-zinc-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" onClick={() => openUpdateModal(doc)} title="Modifier"><IconHistory size={16} /></button>
                        <button className="p-2 text-zinc-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" onClick={() => window.open(doc.file_url, '_blank')} title="Télécharger"><IconDownload size={16} /></button>
                        <button className="p-2 text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" onClick={() => setDocToDelete(doc.id)} title="Supprimer"><IconTrash size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
