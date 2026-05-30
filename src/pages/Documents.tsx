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
  Général: '',
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
      <div
        className="w-60 shrink-0 rounded-3xl p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-120px)]"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        <button
          onClick={() => { setActiveProject(null); setActivePhase(null); }}
          className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
          style={
            !activeProject && !activePhase
              ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }
              : { color: 'var(--tblr-text)' }
          }
        >
          Tous les documents
        </button>

        <div className="px-3 pt-2 pb-1 uppercase tracking-widest text-[10px] font-bold" style={{ color: 'var(--tblr-muted)' }}>Par affaire</div>

        {projectsWithDocs.map(p => {
          const isExpanded = expandedProjects.has(p.id);
          const phases = getPhasesForProject(p.id);
          const isProjectActive = activeProject === p.id && !activePhase;
          return (
            <div key={p.id}>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleProject(p.id)}
                  className="p-1 shrink-0"
                  style={{ color: 'var(--tblr-muted)' }}
                >
                  {isExpanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                </button>
                <button
                  onClick={() => { setActiveProject(p.id); setActivePhase(null); if (!isExpanded) toggleProject(p.id); }}
                  className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm transition-colors text-left font-semibold"
                  style={
                    isProjectActive
                      ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }
                      : { color: 'var(--tblr-text)' }
                  }
                >
                  {isExpanded ? <IconFolderOpen size={14} className="shrink-0" /> : <IconFolder size={14} className="shrink-0" />}
                  <span className="truncate text-xs">{p.name}</span>
                  <span className="ml-auto text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{getProjectDocs(p.id).length}</span>
                </button>
              </div>
              {isExpanded && phases.length > 0 && (
                <div className="ml-7 mt-0.5 space-y-0.5">
                  {phases.map(phase => (
                    <button
                      key={phase}
                      onClick={() => { setActiveProject(p.id); setActivePhase(phase); }}
                      className="w-full text-left px-2 py-1 rounded-lg text-xs transition-colors flex items-center justify-between gap-1"
                      style={
                        activeProject === p.id && activePhase === phase
                          ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', fontWeight: 600 }
                          : { color: 'var(--tblr-muted)' }
                      }
                    >
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${PHASE_COLORS[phase]}`}>{phase}</span>
                      <span className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{getPhaseDocs(p.id, phase).length}</span>
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
                className="p-1 shrink-0"
                style={{ color: 'var(--tblr-muted)' }}
              >
                {expandedProjects.has('unassigned') ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              </button>
              <button
                onClick={() => { setActiveProject('unassigned'); setActivePhase(null); if (!expandedProjects.has('unassigned')) toggleProject('unassigned'); }}
                className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm transition-colors text-left"
                style={
                  activeProject === 'unassigned' && !activePhase
                    ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', fontWeight: 600 }
                    : { color: 'var(--tblr-text)' }
                }
              >
                <IconFolder size={14} className="shrink-0" />
                <span className="text-xs">Sans projet</span>
                <span className="ml-auto text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{unassignedDocs.length}</span>
              </button>
            </div>
            {expandedProjects.has('unassigned') && (
              <div className="ml-7 mt-0.5 space-y-0.5">
                {getPhasesForProject(null).map(phase => (
                  <button
                    key={phase}
                    onClick={() => { setActiveProject('unassigned'); setActivePhase(phase); }}
                    className="w-full text-left px-2 py-1 rounded-lg text-xs transition-colors flex items-center justify-between gap-1"
                    style={
                      activeProject === 'unassigned' && activePhase === phase
                        ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', fontWeight: 600 }
                        : { color: 'var(--tblr-muted)' }
                    }
                  >
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${PHASE_COLORS[phase]}`}>{phase}</span>
                    <span className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{getPhaseDocs(null, phase).length}</span>
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
            <h1 className="text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>
              {activeProject
                ? (activeProject === 'unassigned'
                    ? 'Sans projet'
                    : projects.find(p => p.id === activeProject)?.name || 'Documents')
                : 'Documents'}
              {activePhase && (
                <span className={`ml-2 text-sm font-bold px-2 py-0.5 rounded ${PHASE_COLORS[activePhase]}`}>{activePhase}</span>
              )}
            </h1>
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{visibleDocs.length} document{visibleDocs.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              {!isOnline && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium" style={{ background: '#fff3bf', color: '#e67700', border: '1px solid #ffe066' }}>
                  <IconCloudOff size={13} />
                  Upload indisponible hors-ligne
                </span>
              )}
              <button
                onClick={() => setIsModalOpen(true)}
                disabled={!isOnline}
                title={!isOnline ? 'Connexion requise pour uploader des documents' : undefined}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--tblr-primary)', color: '#fff' }}
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
                className="p-6 rounded-3xl w-full max-w-md space-y-4 shadow-2xl"
                style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
              >
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-bold">Uploader un document</h2>
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="p-2 rounded-full transition-colors"
                    style={{ color: 'var(--tblr-muted)' }}
                  >
                    <IconX size={20} />
                  </button>
                </div>

                {!isOnline && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm" style={{ background: '#fff3bf', color: '#e67700', border: '1px solid #ffe066' }}>
                    <IconCloudOff size={16} className="shrink-0" />
                    <span>Upload impossible hors-ligne. Reconnectez-vous pour envoyer des documents.</span>
                  </div>
                )}

                <div className="space-y-3">
                  <label className="block text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>Affaire</label>
                  <select
                    className="w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    onChange={e => setSelectedProject(e.target.value)}
                    value={selectedProject}
                  >
                    <option value="">Aucune affaire</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>Phase</label>
                    <select
                      className="w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      onChange={e => setSelectedPhase(e.target.value as DocumentPhase)}
                      value={selectedPhase}
                    >
                      {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>Catégorie</label>
                    <select
                      className="w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
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
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all"
                  style={{ borderColor: 'var(--tblr-border)' }}
                  onDrop={e => { e.preventDefault(); setSelectedFile(e.dataTransfer.files[0]); }}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <IconUpload className="mx-auto mb-2" size={32} style={{ color: 'var(--tblr-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
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
                  className="w-full py-3 rounded-lg font-bold transition-all shadow-lg shadow-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'var(--tblr-primary)', color: '#fff' }}
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
                className="p-6 rounded-3xl w-full max-w-md space-y-4 shadow-2xl"
                style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
              >
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-bold">Modifier le document</h2>
                  <button
                    onClick={() => setIsUpdateModalOpen(false)}
                    className="p-2 rounded-full transition-colors"
                    style={{ color: 'var(--tblr-muted)' }}
                  >
                    <IconX size={20} />
                  </button>
                </div>
                <div className="space-y-3">
                  <label className="block text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>Nom</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>Phase</label>
                    <select
                      className="w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      onChange={e => setEditPhase(e.target.value as DocumentPhase)}
                      value={editPhase}
                    >
                      {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>Catégorie</label>
                    <select
                      className="w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
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
                  <label className="block text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>Description</label>
                  <textarea
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    className="w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all min-h-[80px]"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>Nouvelle version (optionnel)</label>
                  <div
                    className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all"
                    style={{ borderColor: 'var(--tblr-border)' }}
                    onClick={() => editFileInputRef.current?.click()}
                  >
                    <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
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
                  className="w-full py-3 rounded-lg font-bold transition-all active:scale-[0.98] shadow-lg shadow-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'var(--tblr-primary)', color: '#fff' }}
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
                className="p-6 rounded-3xl w-full max-w-sm space-y-6 shadow-2xl text-center"
                style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                  style={{ background: '#ffe3e3', color: 'var(--tblr-danger)' }}
                >
                  <IconTrash size={32} />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold">Supprimer le document ?</h2>
                  <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>Cette action est irréversible.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDocToDelete(null)}
                    className="flex-1 py-3 rounded-lg font-bold transition-all"
                    style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleDelete}
                    className="flex-1 py-3 rounded-lg font-bold transition-all shadow-lg shadow-red-500/20"
                    style={{ background: 'var(--tblr-danger)', color: '#fff' }}
                  >
                    Supprimer
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Documents table */}
        <div
          className="rounded-3xl overflow-hidden"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', borderBottom: '1px solid var(--tblr-border)' }}
                >
                  <th className="px-6 py-4">Aperçu</th>
                  <th className="px-6 py-4">Nom</th>
                  <th className="px-6 py-4">Affaire</th>
                  <th className="px-6 py-4">Phase</th>
                  <th className="px-6 py-4">Version</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody>
                {visibleDocs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>
                      Aucun document dans cette sélection
                    </td>
                  </tr>
                )}
                {visibleDocs.map(doc => (
                  <tr
                    key={doc.id}
                    className="transition-colors"
                    style={{ borderTop: '1px solid var(--tblr-border)' }}
                  >
                    <td className="px-6 py-4">
                      {doc.file_url.match(/\.(jpg|jpeg|png|gif)$/i) ? (
                        <img src={doc.file_url} alt={doc.name} className="w-10 h-10 object-cover rounded-lg" referrerPolicy="no-referrer" />
                      ) : (
                        <div
                          className="w-10 h-10 flex items-center justify-center rounded-lg"
                          style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}
                        >
                          <IconFile size={20} />
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 font-bold" style={{ color: 'var(--tblr-text)' }} title={doc.name}>
                      {doc.name.length > 28 ? `${doc.name.substring(0, 28)}…` : doc.name}
                    </td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--tblr-muted)' }}>{projects.find(p => p.id === doc.project_id)?.name || '—'}</td>
                    <td className="px-6 py-4">
                      {doc.phase ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${PHASE_COLORS[doc.phase as DocumentPhase] || PHASE_COLORS['Général']}`}>
                          {doc.phase}
                        </span>
                      ) : (
                        <span className="text-sm" style={{ color: 'var(--tblr-muted)' }}>—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--tblr-muted)' }}>v{doc.version}</td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--tblr-muted)' }}>{new Date(doc.uploaded_at).toLocaleDateString('fr-FR')}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <button
                          className="p-2 rounded-lg transition-colors"
                          style={{ color: 'var(--tblr-muted)' }}
                          onClick={() => openUpdateModal(doc)}
                          title="Modifier"
                        >
                          <IconHistory size={16} />
                        </button>
                        <button
                          className="p-2 rounded-lg transition-colors"
                          style={{ color: 'var(--tblr-muted)' }}
                          onClick={() => window.open(doc.file_url, '_blank')}
                          title="Télécharger"
                        >
                          <IconDownload size={16} />
                        </button>
                        <button
                          className="p-2 rounded-lg transition-colors"
                          style={{ color: 'var(--tblr-muted)' }}
                          onClick={() => setDocToDelete(doc.id)}
                          title="Supprimer"
                        >
                          <IconTrash size={16} />
                        </button>
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
