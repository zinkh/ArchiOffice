import { useState, useEffect, useRef } from 'react';
import {
  IconFile, IconPlus, IconHistory, IconDownload, IconTrash, IconX,
  IconUpload, IconCloudOff, IconChevronDown, IconChevronRight, IconFolder,
  IconFolderOpen, IconLayoutSidebar, IconCircleCheck, IconClock,
  IconAlertTriangle, IconSend, IconCheck, IconUsers, IconEye,
  IconPencil,
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { Document, DocumentPhase, DocumentDiffusion, Project } from '../types';
import { useUser } from '../UserContext';
import { apiFetch } from '../lib/api';
import { supabase } from '../lib/supabase';

const PHASES: DocumentPhase[] = ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR', 'Général'];

const PHASE_COLORS: Record<DocumentPhase, string> = {
  ESQ: 'bg-violet-100 text-violet-700',
  APS: 'bg-blue-100 text-blue-700',
  APD: 'bg-sky-100 text-sky-700',
  PC: 'bg-cyan-100 text-cyan-700',
  PRO: 'bg-teal-100 text-teal-700',
  DCE: 'bg-green-100 text-green-700',
  ACT: 'bg-lime-100 text-lime-700',
  VISA: 'bg-yellow-100 text-yellow-700',
  DET: 'bg-orange-100 text-orange-700',
  AOR: 'bg-red-100 text-red-700',
  Général: '',
};

const DOC_STATUT_CONFIG = {
  en_cours: { label: 'En cours', bg: '#e8f0fb', color: '#206bc4', icon: IconClock },
  approuve: { label: 'Approuvé', bg: '#d3f9d8', color: '#2f9e44', icon: IconCircleCheck },
  perime:   { label: 'Périmé',   bg: '#ffe3e3', color: '#d63939', icon: IconAlertTriangle },
} as const;

const DOC_TYPES = ['Plan', 'Note technique', 'CCTP', 'DPGF', 'Rapport', 'Contrat', 'OS', 'CR réunion', 'Devis', 'Autre'];

function StatutBadge({ statut }: { statut?: string }) {
  const s = DOC_STATUT_CONFIG[(statut as keyof typeof DOC_STATUT_CONFIG) || 'en_cours'];
  const Icon = s.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: s.bg, color: s.color }}>
      <Icon size={10} />
      {s.label}
    </span>
  );
}

function IndiceBadge({ indice }: { indice?: string }) {
  if (!indice) return null;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', border: '1px solid var(--tblr-border)' }}>
      Ind.{indice}
    </span>
  );
}

const inputCls = "w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm";
const inputStyle = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };

export default function Documents() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const { currentUser } = useUser();

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [docToDelete, setDocToDelete] = useState<string | null>(null);
  const [diffusionDoc, setDiffusionDoc] = useState<Document | null>(null);
  const [historyDoc, setHistoryDoc] = useState<Document | null>(null);
  const [versions, setVersions] = useState<any[]>([]);

  // Upload form
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('General');
  const [selectedPhase, setSelectedPhase] = useState<DocumentPhase>('Général');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadIndice, setUploadIndice] = useState('A');
  const [uploadEmetteur, setUploadEmetteur] = useState('');
  const [uploadDocType, setUploadDocType] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit form
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('General');
  const [editPhase, setEditPhase] = useState<DocumentPhase>('Général');
  const [editDescription, setEditDescription] = useState('');
  const [editIndice, setEditIndice] = useState('A');
  const [editEmetteur, setEditEmetteur] = useState('');
  const [editDocType, setEditDocType] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  // Diffusion form
  const [diffusions, setDiffusions] = useState<DocumentDiffusion[]>([]);
  const [newDiffName, setNewDiffName] = useState('');
  const [newDiffEmail, setNewDiffEmail] = useState('');
  const [isDiffSending, setIsDiffSending] = useState(false);

  // Navigation
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<DocumentPhase | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Status filter
  const [filterStatut, setFilterStatut] = useState<string>('all');

  const [isOnline, setIsOnline] = useState(navigator.onLine);
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

  // Tree helpers
  const projectsWithDocs = projects.filter(p => documents.some(d => d.project_id === p.id));
  const unassignedDocs = documents.filter(d => !d.project_id);
  const getProjectDocs = (projectId: string) => documents.filter(d => d.project_id === projectId);
  const getPhaseDocs = (projectId: string | null, phase: DocumentPhase) =>
    documents.filter(d => d.project_id === projectId && (d.phase || 'Général') === phase);
  const getPhasesForProject = (projectId: string | null): DocumentPhase[] => {
    const used = new Set(documents.filter(d => d.project_id === projectId).map(d => (d.phase || 'Général') as DocumentPhase));
    return PHASES.filter(p => used.has(p));
  };
  const toggleProject = (id: string) => {
    setExpandedProjects(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  // Filtered docs
  const visibleDocs = (() => {
    let docs: Document[];
    if (activeProject === 'unassigned') {
      docs = activePhase ? getPhaseDocs(null, activePhase) : unassignedDocs;
    } else if (activeProject) {
      docs = activePhase ? getPhaseDocs(activeProject, activePhase) : getProjectDocs(activeProject);
    } else if (activePhase) {
      docs = documents.filter(d => (d.phase || 'Général') === activePhase);
    } else {
      docs = documents;
    }
    if (filterStatut !== 'all') docs = docs.filter(d => (d.doc_statut || 'en_cours') === filterStatut);
    return docs;
  })();

  // Upload
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
    formData.append('indice', uploadIndice || 'A');
    formData.append('emetteur', uploadEmetteur);
    formData.append('doc_type', uploadDocType);
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
        setUploadIndice('A');
        setUploadEmetteur('');
        setUploadDocType('');
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        alert(`Échec de l'upload: ${errorData.error || response.statusText}`);
      }
    } catch (error) {
      alert('Erreur: ' + error);
    } finally {
      setIsUploading(false);
    }
  };

  // Edit
  const openUpdateModal = (doc: Document) => {
    setEditingDoc(doc);
    setEditName(doc.name);
    setEditCategory(doc.category);
    setEditPhase(doc.phase || 'Général');
    setEditDescription(doc.description || '');
    setEditIndice(doc.indice || 'A');
    setEditEmetteur(doc.emetteur || '');
    setEditDocType(doc.doc_type || '');
    setIsUpdateModalOpen(true);
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
      formData.append('indice', editIndice);
      formData.append('emetteur', editEmetteur);
      formData.append('doc_type', editDocType);
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
        alert(`Échec: ${response.statusText}`);
      }
    } catch (error) {
      alert('Erreur: ' + error);
    } finally {
      setIsUploading(false);
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!docToDelete) return;
    try {
      await apiFetch<any>(`/api/documents/${docToDelete}`, { method: 'DELETE' });
      refreshDocuments();
      setDocToDelete(null);
    } catch (error) {
      alert('Erreur: ' + error);
    }
  };

  // Statut change
  const handleStatutChange = async (doc: Document, newStatut: 'en_cours' | 'approuve' | 'perime') => {
    try {
      await apiFetch(`/api/documents/${doc.id}/statut`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_statut: newStatut, approbateur: currentUser?.name }),
      });
      refreshDocuments();
    } catch (e) {
      alert('Erreur changement statut: ' + e);
    }
  };

  // Diffusion
  const openDiffusion = async (doc: Document) => {
    setDiffusionDoc(doc);
    const data = await apiFetch<DocumentDiffusion[]>(`/api/documents/${doc.id}/diffusions`);
    setDiffusions(data || []);
  };

  const handleSendDiffusion = async () => {
    if (!diffusionDoc || !newDiffName.trim()) return;
    setIsDiffSending(true);
    try {
      await apiFetch(`/api/documents/${diffusionDoc.id}/diffusions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_name: newDiffName, contact_email: newDiffEmail || null }),
      });
      const data = await apiFetch<DocumentDiffusion[]>(`/api/documents/${diffusionDoc.id}/diffusions`);
      setDiffusions(data || []);
      setNewDiffName('');
      setNewDiffEmail('');
    } catch (e) {
      alert('Erreur diffusion: ' + e);
    } finally {
      setIsDiffSending(false);
    }
  };

  const handleAcknowledge = async (diffId: string) => {
    if (!diffusionDoc) return;
    try {
      await apiFetch(`/api/documents/${diffusionDoc.id}/diffusions/${diffId}/acknowledge`, { method: 'PATCH' });
      const data = await apiFetch<DocumentDiffusion[]>(`/api/documents/${diffusionDoc.id}/diffusions`);
      setDiffusions(data || []);
    } catch (e) {
      alert('Erreur: ' + e);
    }
  };

  // History
  const openHistory = async (doc: Document) => {
    setHistoryDoc(doc);
    const data = await apiFetch<any[]>(`/api/documents/${doc.id}/versions`);
    setVersions(data || []);
  };

  const handleDownload = (doc: Document) => {
    if (doc.doc_statut === 'perime') {
      if (!window.confirm('⚠️ Ce document est PÉRIMÉ. Son utilisation peut entraîner des erreurs. Voulez-vous tout de même le télécharger ?')) return;
    }
    window.open(doc.file_url, '_blank');
  };

  return (
    <div className="flex gap-4 h-full">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar tree */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 p-3 space-y-1 overflow-y-auto transition-transform duration-300 md:static md:w-60 md:shrink-0 md:rounded-3xl md:max-h-[calc(100vh-120px)] md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        <button
          onClick={() => { setActiveProject(null); setActivePhase(null); setSidebarOpen(false); }}
          className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
          style={!activeProject && !activePhase ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' } : { color: 'var(--tblr-text)' }}
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
                <button onClick={() => toggleProject(p.id)} className="p-1 shrink-0" style={{ color: 'var(--tblr-muted)' }}>
                  {isExpanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                </button>
                <button
                  onClick={() => { setActiveProject(p.id); setActivePhase(null); setSidebarOpen(false); if (!isExpanded) toggleProject(p.id); }}
                  className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm transition-colors text-left font-semibold"
                  style={isProjectActive ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' } : { color: 'var(--tblr-text)' }}
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
                      onClick={() => { setActiveProject(p.id); setActivePhase(phase); setSidebarOpen(false); }}
                      className="w-full text-left px-2 py-1 rounded-lg text-xs transition-colors flex items-center justify-between gap-1"
                      style={activeProject === p.id && activePhase === phase ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', fontWeight: 600 } : { color: 'var(--tblr-muted)' }}
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
              <button onClick={() => toggleProject('unassigned')} className="p-1 shrink-0" style={{ color: 'var(--tblr-muted)' }}>
                {expandedProjects.has('unassigned') ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              </button>
              <button
                onClick={() => { setActiveProject('unassigned'); setActivePhase(null); setSidebarOpen(false); if (!expandedProjects.has('unassigned')) toggleProject('unassigned'); }}
                className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm transition-colors text-left"
                style={activeProject === 'unassigned' && !activePhase ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', fontWeight: 600 } : { color: 'var(--tblr-text)' }}
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
                    onClick={() => { setActiveProject('unassigned'); setActivePhase(phase); setSidebarOpen(false); }}
                    className="w-full text-left px-2 py-1 rounded-lg text-xs transition-colors flex items-center justify-between gap-1"
                    style={activeProject === 'unassigned' && activePhase === phase ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', fontWeight: 600 } : { color: 'var(--tblr-muted)' }}
                  >
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${PHASE_COLORS[phase]}`}>{phase}</span>
                    <span className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{getPhaseDocs(null, phase).length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Status summary */}
        <div className="px-3 pt-3 pb-1 uppercase tracking-widest text-[10px] font-bold border-t mt-2 pt-3" style={{ color: 'var(--tblr-muted)', borderColor: 'var(--tblr-border)' }}>Statut qualité</div>
        {(['all', 'en_cours', 'approuve', 'perime'] as const).map(s => {
          const count = s === 'all' ? documents.length : documents.filter(d => (d.doc_statut || 'en_cours') === s).length;
          const cfg = s === 'all' ? null : DOC_STATUT_CONFIG[s];
          return (
            <button
              key={s}
              onClick={() => setFilterStatut(s)}
              className="w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-between"
              style={filterStatut === s ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', fontWeight: 600 } : { color: 'var(--tblr-muted)' }}
            >
              <span className="flex items-center gap-1.5">
                {cfg && <span className="w-2 h-2 rounded-full inline-block" style={{ background: cfg.color }} />}
                {s === 'all' ? 'Tous' : cfg!.label}
              </span>
              <span className="text-[10px]">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Main content */}
      <div className="flex-1 space-y-4 min-w-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              className="md:hidden p-2 rounded-lg transition-colors shrink-0"
              style={{ color: 'var(--tblr-muted)', border: '1px solid var(--tblr-border)' }}
              onClick={() => setSidebarOpen(true)}
            >
              <IconLayoutSidebar size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>
                {activeProject ? (activeProject === 'unassigned' ? 'Sans projet' : projects.find(p => p.id === activeProject)?.name || 'Documents') : 'Documents'}
                {activePhase && <span className={`ml-2 text-sm font-bold px-2 py-0.5 rounded ${PHASE_COLORS[activePhase]}`}>{activePhase}</span>}
                {filterStatut !== 'all' && <span className="ml-2 text-xs px-2 py-0.5 rounded" style={{ background: DOC_STATUT_CONFIG[filterStatut as keyof typeof DOC_STATUT_CONFIG].bg, color: DOC_STATUT_CONFIG[filterStatut as keyof typeof DOC_STATUT_CONFIG].color }}>{DOC_STATUT_CONFIG[filterStatut as keyof typeof DOC_STATUT_CONFIG].label}</span>}
              </h1>
              <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{visibleDocs.length} document{visibleDocs.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isOnline && (
              <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium" style={{ background: '#fff3bf', color: '#e67700', border: '1px solid #ffe066' }}>
                <IconCloudOff size={13} />
                Hors-ligne
              </span>
            )}
            <button
              onClick={() => setIsModalOpen(true)}
              disabled={!isOnline}
              title={!isOnline ? 'Connexion requise pour uploader des documents' : 'Ajouter un document'}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--tblr-primary)', color: '#fff' }}
            >
              <IconPlus size={16} />
              <span className="hidden sm:inline">Ajouter</span>
            </button>
          </div>
        </div>

        {/* Documents table */}
        <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-widest" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', borderBottom: '1px solid var(--tblr-border)' }}>
                  <th className="px-4 py-3">Document</th>
                  <th className="px-4 py-3">Phase / Type</th>
                  <th className="px-4 py-3">Indice / Version</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Émetteur</th>
                  <th className="px-4 py-3">Approbateur</th>
                  <th className="px-4 py-3">Diffusion</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {visibleDocs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>
                      Aucun document dans cette sélection
                    </td>
                  </tr>
                )}
                {visibleDocs.map(doc => {
                  const isPerime = (doc.doc_statut || 'en_cours') === 'perime';
                  return (
                    <tr
                      key={doc.id}
                      className="transition-colors"
                      style={{ borderTop: '1px solid var(--tblr-border)', opacity: isPerime ? 0.6 : 1 }}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 flex items-center justify-center rounded-lg shrink-0" style={{ background: isPerime ? '#ffe3e3' : 'var(--tblr-surface-2)', color: isPerime ? '#d63939' : 'var(--tblr-muted)' }}>
                            <IconFile size={18} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate max-w-[180px]" style={{ color: 'var(--tblr-text)', textDecoration: isPerime ? 'line-through' : 'none' }} title={doc.name}>
                              {doc.name}
                            </p>
                            <p className="text-[11px] truncate" style={{ color: 'var(--tblr-muted)' }}>
                              {projects.find(p => p.id === doc.project_id)?.name || '—'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {doc.phase && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold w-fit ${PHASE_COLORS[doc.phase as DocumentPhase] || PHASE_COLORS['Général']}`}>{doc.phase}</span>
                          )}
                          {doc.doc_type && (
                            <span className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{doc.doc_type}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <IndiceBadge indice={doc.indice} />
                          <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>v{doc.version}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="relative group">
                          <StatutBadge statut={doc.doc_statut} />
                          {/* Statut quick-change dropdown */}
                          <div className="absolute left-0 top-full mt-1 z-20 hidden group-hover:flex flex-col rounded-lg overflow-hidden shadow-lg" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', minWidth: 120 }}>
                            {(['en_cours', 'approuve', 'perime'] as const).map(s => (
                              <button
                                key={s}
                                onClick={() => handleStatutChange(doc, s)}
                                className="px-3 py-1.5 text-xs text-left transition-colors hover:opacity-80"
                                style={{ background: DOC_STATUT_CONFIG[s].bg, color: DOC_STATUT_CONFIG[s].color, fontWeight: 600 }}
                              >
                                {DOC_STATUT_CONFIG[s].label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--tblr-muted)' }}>{doc.emetteur || '—'}</td>
                      <td className="px-4 py-3">
                        {doc.approbateur ? (
                          <div>
                            <p className="text-xs font-medium" style={{ color: 'var(--tblr-text)' }}>{doc.approbateur}</p>
                            {doc.date_approbation && (
                              <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{new Date(doc.date_approbation).toLocaleDateString('fr-FR')}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openDiffusion(doc)}
                          className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors"
                          style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}
                          title="Gérer la diffusion"
                        >
                          <IconUsers size={12} />
                          Diffusion
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-0.5">
                          <button className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => openHistory(doc)} title="Historique des versions">
                            <IconHistory size={15} />
                          </button>
                          <button className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => openUpdateModal(doc)} title="Modifier">
                            <IconPencil size={15} />
                          </button>
                          <button className="p-1.5 rounded-lg transition-colors" style={{ color: isPerime ? '#d63939' : 'var(--tblr-muted)' }} onClick={() => handleDownload(doc)} title="Télécharger">
                            <IconDownload size={15} />
                          </button>
                          <button className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => setDocToDelete(doc.id)} title="Supprimer">
                            <IconTrash size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>

        {/* Upload modal */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="p-6 rounded-3xl w-full max-w-lg space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
              style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
            >
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold">Nouveau document</h2>
                <button onClick={() => setIsModalOpen(false)} className="p-2 rounded-full" style={{ color: 'var(--tblr-muted)' }}><IconX size={20} /></button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Affaire</label>
                  <select className={inputCls} style={inputStyle} value={selectedProject} onChange={e => setSelectedProject(e.target.value)}>
                    <option value="">Sans affaire</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Phase</label>
                  <select className={inputCls} style={inputStyle} value={selectedPhase} onChange={e => setSelectedPhase(e.target.value as DocumentPhase)}>
                    {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Type de document</label>
                  <select className={inputCls} style={inputStyle} value={uploadDocType} onChange={e => setUploadDocType(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Catégorie</label>
                  <select className={inputCls} style={inputStyle} value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
                    <option value="General">Général</option>
                    <option value="Contract">Contrat</option>
                    <option value="Plan">Plan</option>
                    <option value="Report">Rapport</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Indice de révision</label>
                  <input className={inputCls} style={inputStyle} value={uploadIndice} onChange={e => setUploadIndice(e.target.value.toUpperCase())} placeholder="A" maxLength={3} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Émetteur</label>
                  <input className={inputCls} style={inputStyle} value={uploadEmetteur} onChange={e => setUploadEmetteur(e.target.value)} placeholder="Nom de l'émetteur" />
                </div>
              </div>

              <div
                className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all"
                style={{ borderColor: 'var(--tblr-border)' }}
                onDrop={e => { e.preventDefault(); setSelectedFile(e.dataTransfer.files[0]); }}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
              >
                <IconUpload className="mx-auto mb-2" size={28} style={{ color: 'var(--tblr-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
                  {selectedFile ? selectedFile.name : 'Glissez un fichier ou cliquez'}
                </p>
                <input type="file" className="hidden" ref={fileInputRef} onChange={e => setSelectedFile(e.target.files?.[0] || null)} />
              </div>

              <button
                onClick={handleFileUpload}
                disabled={isUploading || !selectedFile || !isOnline}
                className="w-full py-2.5 rounded-xl font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--tblr-primary)', color: '#fff' }}
              >
                {isUploading ? 'Envoi...' : 'Ajouter le document'}
              </button>
            </motion.div>
          </div>
        )}

        {/* Edit modal */}
        {isUpdateModalOpen && editingDoc && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="p-6 rounded-3xl w-full max-w-lg space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
              style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
            >
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-bold">Modifier le document</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <IndiceBadge indice={editingDoc.indice} />
                    <StatutBadge statut={editingDoc.doc_statut} />
                  </div>
                </div>
                <button onClick={() => setIsUpdateModalOpen(false)} className="p-2 rounded-full" style={{ color: 'var(--tblr-muted)' }}><IconX size={20} /></button>
              </div>

              {/* Statut quick-change */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Changer le statut</label>
                <div className="flex gap-2">
                  {(['en_cours', 'approuve', 'perime'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => handleStatutChange(editingDoc, s)}
                      className="flex-1 py-2 rounded-lg text-xs font-bold transition-all"
                      style={{
                        background: (editingDoc.doc_statut || 'en_cours') === s ? DOC_STATUT_CONFIG[s].color : DOC_STATUT_CONFIG[s].bg,
                        color: (editingDoc.doc_statut || 'en_cours') === s ? '#fff' : DOC_STATUT_CONFIG[s].color,
                        border: `1px solid ${DOC_STATUT_CONFIG[s].color}33`,
                      }}
                    >
                      {DOC_STATUT_CONFIG[s].label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Nom</label>
                <input className={inputCls} style={inputStyle} value={editName} onChange={e => setEditName(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Phase</label>
                  <select className={inputCls} style={inputStyle} value={editPhase} onChange={e => setEditPhase(e.target.value as DocumentPhase)}>
                    {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Type</label>
                  <select className={inputCls} style={inputStyle} value={editDocType} onChange={e => setEditDocType(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Indice</label>
                  <input className={inputCls} style={inputStyle} value={editIndice} onChange={e => setEditIndice(e.target.value.toUpperCase())} maxLength={3} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Émetteur</label>
                  <input className={inputCls} style={inputStyle} value={editEmetteur} onChange={e => setEditEmetteur(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Description</label>
                <textarea className={inputCls} style={inputStyle} value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={2} />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--tblr-muted)' }}>Nouvelle version de fichier (optionnel — incrémente l'indice)</label>
                <div
                  className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer"
                  style={{ borderColor: 'var(--tblr-border)' }}
                  onClick={() => editFileInputRef.current?.click()}
                >
                  <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{editFile ? editFile.name : 'Cliquez pour sélectionner'}</p>
                  <input type="file" className="hidden" ref={editFileInputRef} onChange={e => setEditFile(e.target.files?.[0] || null)} />
                </div>
              </div>

              <button onClick={handleUpdate} disabled={isUploading} className="w-full py-2.5 rounded-xl font-bold transition-all disabled:opacity-40" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
                {isUploading ? 'Enregistrement...' : 'Sauvegarder'}
              </button>
            </motion.div>
          </div>
        )}

        {/* Diffusion modal */}
        {diffusionDoc && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="p-6 rounded-3xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
              style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
            >
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-lg font-bold">Diffusion maîtrisée</h2>
                  <p className="text-xs mt-0.5 truncate max-w-[300px]" style={{ color: 'var(--tblr-muted)' }}>{diffusionDoc.name} — Ind.{diffusionDoc.indice || 'A'}</p>
                </div>
                <button onClick={() => setDiffusionDoc(null)} className="p-2 rounded-full" style={{ color: 'var(--tblr-muted)' }}><IconX size={20} /></button>
              </div>

              {/* Add recipient */}
              <div className="p-3 rounded-xl mb-4" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                <p className="text-xs font-bold mb-2" style={{ color: 'var(--tblr-muted)' }}>AJOUTER UN DESTINATAIRE</p>
                <div className="flex gap-2 mb-2">
                  <input className={inputCls + ' flex-1'} style={inputStyle} value={newDiffName} onChange={e => setNewDiffName(e.target.value)} placeholder="Nom / Entreprise *" />
                  <input className={inputCls + ' flex-1'} style={inputStyle} value={newDiffEmail} onChange={e => setNewDiffEmail(e.target.value)} placeholder="Email (optionnel)" type="email" />
                </div>
                <button
                  onClick={handleSendDiffusion}
                  disabled={!newDiffName.trim() || isDiffSending}
                  className="w-full py-2 rounded-lg font-bold text-sm transition-all disabled:opacity-40"
                  style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                >
                  <IconSend size={14} className="inline mr-1.5" />
                  {isDiffSending ? 'Envoi...' : 'Enregistrer la diffusion'}
                </button>
              </div>

              {/* Diffusion list */}
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>Historique des diffusions ({diffusions.length})</p>
              {diffusions.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: 'var(--tblr-muted)' }}>Aucune diffusion enregistrée</p>
              ) : (
                <div className="space-y-2">
                  {diffusions.map(d => (
                    <div key={d.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: d.acknowledged_at ? '#d3f9d8' : '#fff4e6', color: d.acknowledged_at ? '#2f9e44' : '#f76707' }}
                      >
                        {d.acknowledged_at ? <IconCheck size={16} /> : <IconEye size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>{d.contact_name}</p>
                        <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>
                          Envoyé le {new Date(d.sent_at).toLocaleDateString('fr-FR')}
                          {d.acknowledged_at && ` · AR le ${new Date(d.acknowledged_at).toLocaleDateString('fr-FR')}`}
                        </p>
                      </div>
                      {!d.acknowledged_at && (
                        <button
                          onClick={() => handleAcknowledge(d.id)}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg shrink-0"
                          style={{ background: '#d3f9d8', color: '#2f9e44' }}
                        >
                          Marquer AR
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}

        {/* Version history modal */}
        {historyDoc && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="p-6 rounded-3xl w-full max-w-md shadow-2xl max-h-[80vh] overflow-y-auto"
              style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
            >
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-lg font-bold">Historique des versions</h2>
                  <p className="text-xs mt-0.5 truncate max-w-[280px]" style={{ color: 'var(--tblr-muted)' }}>{historyDoc.name}</p>
                </div>
                <button onClick={() => setHistoryDoc(null)} className="p-2 rounded-full" style={{ color: 'var(--tblr-muted)' }}><IconX size={20} /></button>
              </div>
              {versions.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: 'var(--tblr-muted)' }}>Aucune version antérieure</p>
              ) : (
                <div className="space-y-2">
                  {versions.map((v, i) => (
                    <div key={v.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: i === 0 ? 'var(--tblr-primary-lt)' : 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0" style={{ background: i === 0 ? 'var(--tblr-primary)' : 'var(--tblr-surface)', color: i === 0 ? '#fff' : 'var(--tblr-muted)', border: i === 0 ? 'none' : '1px solid var(--tblr-border)' }}>
                        v{v.version}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-semibold" style={{ color: 'var(--tblr-text)' }}>{i === 0 ? 'Version actuelle' : `Version ${v.version}`}</p>
                        <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{new Date(v.uploaded_at).toLocaleDateString('fr-FR')} · {v.uploaded_by || '—'}</p>
                        {v.description && <p className="text-[11px] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{v.description}</p>}
                      </div>
                      <button onClick={() => window.open(v.file_url, '_blank')} className="p-1.5 rounded-lg" style={{ color: 'var(--tblr-muted)' }} title="Télécharger">
                        <IconDownload size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}

        {/* Delete confirm */}
        {docToDelete && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="p-6 rounded-3xl w-full max-w-sm space-y-6 shadow-2xl text-center"
              style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
            >
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto" style={{ background: '#ffe3e3', color: 'var(--tblr-danger)' }}>
                <IconTrash size={32} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Supprimer le document ?</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--tblr-muted)' }}>Cette action est irréversible.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setDocToDelete(null)} className="flex-1 py-3 rounded-xl font-bold" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>Annuler</button>
                <button onClick={handleDelete} className="flex-1 py-3 rounded-xl font-bold" style={{ background: 'var(--tblr-danger)', color: '#fff' }}>Supprimer</button>
              </div>
            </motion.div>
          </div>
        )}

      </AnimatePresence>
    </div>
  );
}
