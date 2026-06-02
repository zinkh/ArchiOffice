import { useState, useEffect, FormEvent, ChangeEvent } from 'react';
import { IconPlus, IconFilter, IconSearch, IconArrowUpRight, IconX, IconDeviceFloppy, IconSettings, IconTrash, IconTag, IconUpload, IconCircleCheck, IconCircle, IconCalendar, IconExternalLink, IconLayoutGrid, IconList, IconChevronUp, IconChevronDown, IconUser, IconDownload } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import { fetchJson, apiFetch } from '../lib/api';
import type { Project, ProjectCategory, Milestone, ProjectTemplate } from '../types';
import { useTranslation } from 'react-i18next';
import { useUser } from '../UserContext';
import { db } from '../db';
import { GeoportailMap, GoogleMap, RNBInfo } from '../components/LocationMaps';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import { ContactModal } from '../components/ContactModal';
import { CadastreDownload } from '../components/CadastreDownload';
import { Link } from 'react-router-dom';

export default function Projects() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const [projects, setProjects] = useState<Project[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [categories, setCategories] = useState<ProjectCategory[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Project; direction: 'asc' | 'desc' } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterProjectManager, setFilterProjectManager] = useState<string>('All');
  const [newCategoryName, setNewCategoryName] = useState('');

  const [editForm, setEditForm] = useState<Project | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newMilestoneDate, setNewMilestoneDate] = useState('');
  const [isAddingMilestone, setIsAddingMilestone] = useState(false);

  const optimizeImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          // Compress to JPEG with 0.6 quality for significant optimization
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const optimizedBase64 = await optimizeImage(file);
      setEditForm(prev => prev ? ({ ...prev, image_url: optimizedBase64 }) : null);
    } catch (err) {
      console.error('Failed to optimize image:', err);
      alert('Failed to process image. Please try another one.');
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchCategories();
    fetchContacts();
    fetchTemplates();
    fetchTeam();
  }, []);

  const fetchTeam = async () => {
    try {
      const data = await fetchJson('/api/team');
      setTeam(data);
    } catch (err) {
      console.error('Failed to fetch team:', err);
    }
  };

  const fetchTemplates = async () => {
    // Load from Dexie first
    const local = await db.projectTemplates.toArray();
    if (local.length > 0) setTemplates(local);
    // Sync from API
    if (navigator.onLine) {
      try {
        const data = await fetchJson('/api/project-templates');
        await db.projectTemplates.clear();
        await db.projectTemplates.bulkPut(data);
        setTemplates(data);
      } catch (err) {
        console.error('Failed to sync templates:', err);
      }
    }
  };

  const fetchContacts = async () => {
    // 1. Load from IndexedDB
    const localData = await db.contacts.toArray();
    if (localData.length > 0) {
      setContacts(localData);
    }

    // 2. Fetch from API
    if (navigator.onLine) {
      try {
        const data = await fetchJson('/api/contacts');
        
        // 3. Update IndexedDB
        await db.contacts.clear();
        await db.contacts.bulkPut(data);
        
        // 4. Update UI
        setContacts(data);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const filteredProjects = projects.filter(project => {
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          project.client.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'All' || project.status === filterStatus;
    const matchesCategory = filterCategory === 'All' || project.category === filterCategory;
    const matchesProjectManager = filterProjectManager === 'All' || project.project_manager === filterProjectManager;
    return matchesSearch && matchesStatus && matchesCategory && matchesProjectManager;
  }).sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;
    const aValue = a[key];
    const bValue = b[key];

    if (aValue === undefined || bValue === undefined) return 0;

    if (aValue < bValue) {
      return direction === 'asc' ? -1 : 1;
    }
    if (aValue > bValue) {
      return direction === 'asc' ? 1 : -1;
    }
    return 0;
  });

  const requestSort = (key: keyof Project) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: keyof Project) => {
    if (!sortConfig || sortConfig.key !== key) return null;
    return sortConfig.direction === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />;
  };

  const cycleFilter = () => {
    const statuses = ['All', 'Planning', 'In Progress', 'Completed', 'On Hold'];
    const currentIndex = statuses.indexOf(filterStatus);
    const nextIndex = (currentIndex + 1) % statuses.length;
    setFilterStatus(statuses[nextIndex]);
  };

  const cycleCategoryFilter = () => {
    const catNames = ['All', ...categories.map(c => c.name)];
    const currentIndex = catNames.indexOf(filterCategory);
    const nextIndex = (currentIndex + 1) % catNames.length;
    setFilterCategory(catNames[nextIndex]);
  };

  const cycleProjectManagerFilter = () => {
    const managers = ['All', ...Array.from(new Set(projects.map(p => p.project_manager).filter(Boolean)))];
    const currentIndex = managers.indexOf(filterProjectManager);
    const nextIndex = (currentIndex + 1) % managers.length;
    setFilterProjectManager(managers[nextIndex]);
  };

  const fetchProjects = async () => {
    // 1. Load from IndexedDB
    const localData = await db.projects.toArray();
    if (localData.length > 0) {
      setProjects(localData);
    }

    // 2. Fetch from API
    if (navigator.onLine) {
      try {
        const data = await fetchJson('/api/projects');
        
        // 3. Update IndexedDB
        await db.projects.clear();
        await db.projects.bulkPut(data);
        
        // 4. Update UI
        if (Array.isArray(data)) setProjects(data.map((p: any) => ({ ...p, is_complete_mission: !!p.is_complete_mission })));
      } catch (err) {
        console.error(err);
      }
    }
  };

  const fetchCategories = async () => {
    // 1. Load from IndexedDB
    const localData = await db.projectCategories.toArray();
    if (localData.length > 0) {
      setCategories(localData);
    }

    // 2. Fetch from API
    if (navigator.onLine) {
      try {
        const res = await fetch('/api/project_categories');
        const contentType = res.headers.get('content-type');
        if (!res.ok || !contentType || !contentType.includes('application/json')) {
          const text = await res.text();
          if (text.includes('Please wait while your application starts')) {
            console.log('Server is still starting...');
            return;
          }
          throw new Error('Failed to fetch categories');
        }
        const data = await res.json();
        
        // 3. Update IndexedDB
        await db.projectCategories.clear();
        await db.projectCategories.bulkPut(data);
        
        // 4. Update UI
        setCategories(data);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleProjectClick = (project: Project) => {
    setSelectedProject(project);
    setEditForm(project);
    setIsEditing(false);
    setIsModalOpen(true);
    fetchMilestones(project.id);
  };

  const fetchMilestones = async (projectId: string) => {
    try {
      const res = await fetch(`/api/milestones?project_id=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setMilestones(data.map((m: any) => ({ ...m, completed: !!m.completed })));
      }
    } catch (err) {
      console.error('Failed to fetch milestones:', err);
    }
  };

  const handleAddMilestone = async () => {
    if (!selectedProject || !newMilestoneTitle || !newMilestoneDate) return;

    try {
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: selectedProject.id,
          title: newMilestoneTitle,
          due_date: newMilestoneDate,
          completed: false
        })
      });

      if (res.ok) {
        const newM = await res.json();
        setMilestones(prev => [...prev, { ...newM, completed: !!newM.completed }].sort((a, b) => a.due_date.localeCompare(b.due_date)));
        setNewMilestoneTitle('');
        setNewMilestoneDate('');
        setIsAddingMilestone(false);
      }
    } catch (err) {
      console.error('Failed to add milestone:', err);
    }
  };

  const handleToggleMilestone = async (milestone: Milestone) => {
    try {
      const res = await fetch(`/api/milestones/${milestone.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...milestone,
          completed: !milestone.completed
        })
      });

      if (res.ok) {
        setMilestones(prev => prev.map(m => 
          m.id === milestone.id ? { ...m, completed: !m.completed } : m
        ));
      }
    } catch (err) {
      console.error('Failed to toggle milestone:', err);
    }
  };

  const handleDeleteMilestone = async (id: string) => {
    if (!confirm('Delete this milestone?')) return;
    try {
      const res = await fetch(`/api/milestones/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setMilestones(prev => prev.filter(m => m.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete milestone:', err);
    }
  };

  const handleAddProject = () => {
    const newId = `p${Date.now()}`;
    const newProject: Project = {
      id: newId,
      name: '',
      client: '',
      status: 'Planning',
      budget: 0,
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date().toISOString().split('T')[0],
      description: '',
      image_url: '',
      address: '',
      is_complete_mission: false,
      etudes_notes: '',
      chantier_notes: '',
      surface: 0,
      construction_cost: 0,
      remuneration: 0,
      progression: 0,
      project_manager: '',
      cotraitants: '',
      cotraitants_list: [],
      external_intervenants: '',
      entreprises: ''
    };
    setSelectedProject(newProject);
    setEditForm(newProject);
    setIsEditing(true);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!editForm || isSaving) return;

    // Basic validation
    if (!editForm.name.trim() || !editForm.client.trim()) {
      alert('Project name and client are required');
      return;
    }

    setIsSaving(true);
    const isNew = !projects.some(p => p.id === editForm.id);
    const method = isNew ? 'POST' : 'PUT';
    const url = isNew ? '/api/projects' : `/api/projects/${editForm.id}`;

    // 1. Save to IndexedDB
    await db.projects.put(editForm);
    
    // Update UI
    if (isNew) {
      setProjects(prev => [...prev, editForm]);
    } else {
      setProjects(prev => prev.map(p => p.id === editForm.id ? editForm : p));
    }
    setSelectedProject(editForm);

    // 2. If online, send to API
    if (navigator.onLine) {
      try {
        const res = await fetch(url, {
          method,
          headers: { 
            'Content-Type': 'application/json',
            'x-user-role': currentUser?.system_role || 'user'
          },
          body: JSON.stringify(editForm)
        });

        if (res.ok) {
          const data = await res.json();
          const savedProject = { ...editForm };
          if (data.project_code) savedProject.project_code = data.project_code;
          if (data.id) savedProject.id = data.id;
          
          // Update IndexedDB with server response
          await db.projects.put(savedProject);
          setProjects(prev => prev.map(p => p.id === savedProject.id ? savedProject : p));
          setSelectedProject(savedProject);
          
          setIsEditing(false);
          if (isNew) setIsModalOpen(false);
        } else {
          throw new Error(`Server returned ${res.status}`);
        }
      } catch (err) {
        console.error('Failed to save project:', err);
        alert('Failed to save project to server. It has been saved locally and will sync when online.');
      }
    } else {
      // 3. Queue for sync
      await db.syncQueue.add({ table: 'projects', method, data: editForm });
      alert('You are offline. Project saved locally and will sync when online.');
      setIsEditing(false);
      if (isNew) setIsModalOpen(false);
    }
    setIsSaving(false);
  };

  const handleAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      await apiFetch('/api/project_categories', {
        method: 'POST',
        body: JSON.stringify({ id: `pcat${Date.now()}`, name: newCategoryName }),
      });
      setNewCategoryName('');
      fetchCategories();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Are you sure you want to delete this category?')) return;
    try {
      await apiFetch(`/api/project_categories/${id}`, { method: 'DELETE' });
      fetchCategories();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProject = async (id: string) => {
    console.log('handleDeleteProject called for id:', id);
    if (!confirm('Are you sure you want to delete this project? This action cannot be undone.')) return;

    try {
      console.log('Sending DELETE request for project:', id);
      const res = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
        headers: {
          'x-user-role': currentUser?.system_role || 'user'
        }
      });

      if (res.ok) {
        console.log('Delete successful, updating state');
        setProjects(prev => prev.filter(p => p.id !== id));
        setIsModalOpen(false);
        setSelectedProject(null);
      } else {
        const errorData = await res.json();
        console.error('Delete failed:', errorData.error);
        alert(`Failed to delete project: ${errorData.error}`);
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
      alert('Failed to delete project. Please try again.');
    }
  };

  const handleExportXLSX = async () => {
    let agencyName = '';
    try { const s = await fetch('/api/settings').then(r => r.ok ? r.json() : null); agencyName = s?.agencyName || ''; } catch { /* */ }
    const XLSX = await import('xlsx');
    const rows = filteredProjects.map(p => ({
      'Nom': p.name,
      'Client': p.client || '',
      'Statut': p.status || '',
      'Catégorie': (p as any).category_name || '',
      'Chef de projet': (p as any).project_manager_name || p.project_manager || '',
      'Date début': p.start_date || '',
      'Date fin': p.end_date || '',
      'Budget': p.budget || 0,
      'Surface': p.surface || 0,
      'Adresse': p.address || '',
    }));
    const worksheet = XLSX.utils.json_to_sheet([]);
    if (agencyName) {
      XLSX.utils.sheet_add_aoa(worksheet, [[agencyName], ['Liste des projets']], { origin: 'A1' });
      XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A4' });
    } else {
      XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A1' });
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Projets');
    XLSX.writeFile(workbook, 'projets.xlsx');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('projects')}</h2>
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('projects_subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg mr-2">
            <button 
              onClick={() => setViewMode('grid')}
              className={cn(
                "p-1.5 rounded-md transition-all",
                viewMode === 'grid' ? "bg-white dark:bg-zinc-700 shadow-sm text-blue-600" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              <IconLayoutGrid size={18} />
            </button>
            <button 
              onClick={() => setViewMode('table')}
              className={cn(
                "p-1.5 rounded-md transition-all",
                viewMode === 'table' ? "bg-white dark:bg-zinc-700 shadow-sm text-blue-600" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              <IconList size={18} />
            </button>
          </div>
          <button
            onClick={handleExportXLSX}
            className="flex items-center justify-center gap-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white px-4 py-2 rounded-md font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shadow-sm"
          >
            <IconDownload size={18} />
            Export XLSX
          </button>
          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white px-4 py-2 rounded-md font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shadow-sm"
          >
            <IconSettings size={18} />
            {t('projects_domains_btn')}
          </button>
          <button 
            onClick={handleAddProject}
            className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md font-medium hover:bg-blue-700 transition-colors shadow-sm"
          >
            <IconPlus size={18} />
            {t('add_project')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 p-4 rounded-lg" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        <div className="relative flex-1 min-w-[200px]">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: 'var(--tblr-muted)' }} />
          <input
            type="text"
            placeholder={t('search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
            style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={cycleFilter}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            style={filterStatus === 'All'
              ? { border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)', background: 'var(--tblr-surface)' }
              : { border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)' }}
          >
            <IconFilter size={16} />
            {filterStatus === 'All' ? t('projects_filter_status') : filterStatus}
          </button>
          <button
            onClick={cycleCategoryFilter}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            style={filterCategory === 'All'
              ? { border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)', background: 'var(--tblr-surface)' }
              : { border: '1px solid #2fb344', color: '#2fb344', background: '#d3f9d8' }}
          >
            <IconTag size={16} />
            {filterCategory === 'All' ? t('projects_filter_domain') : filterCategory}
          </button>
          <button
            onClick={cycleProjectManagerFilter}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            style={filterProjectManager === 'All'
              ? { border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)', background: 'var(--tblr-surface)' }
              : { border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)' }}
          >
            <IconUser size={16} />
            {filterProjectManager === 'All' ? t('projects_filter_manager') : filterProjectManager}
          </button>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredProjects.map((project, i) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => handleProjectClick(project)}
              className="rounded-lg overflow-hidden group flex flex-col cursor-pointer transition-shadow hover:shadow-md"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
            >
              <div className="h-44 relative overflow-hidden" style={{ background: 'var(--tblr-surface-2)' }}>
                <img
                  src={project.image_url || `https://picsum.photos/seed/${project.id}/600/400`}
                  alt={project.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute top-3 left-3">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-black/50 text-white backdrop-blur-md border border-white/10">
                    #{project.project_code || '---'}
                  </span>
                </div>
                <div className="absolute top-3 right-3 flex flex-col gap-1.5 items-end">
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold backdrop-blur-md" style={
                    project.status === 'In Progress' ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary)' } :
                    project.status === 'Completed' ? { background: '#d3f9d8', color: '#2f9e44', border: '1px solid #b2f2bb' } :
                    { background: 'rgba(255,255,255,0.85)', color: 'var(--tblr-muted)', border: '1px solid var(--tblr-border)' }
                  }>
                    {project.status}
                  </span>
                  {project.category && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold backdrop-blur-md" style={{ background: '#d3f9d8', color: '#2f9e44', border: '1px solid #b2f2bb' }}>
                      {project.category}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[15px] font-semibold truncate transition-colors" style={{ color: 'var(--tblr-text)' }}>{project.name}</h3>
                    <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{project.client}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <Link
                      to={`/projects/${project.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded-lg transition-all"
                      style={{ color: 'var(--tblr-muted)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-primary)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
                    >
                      <IconExternalLink size={16} />
                    </Link>
                    <IconArrowUpRight size={18} style={{ color: 'var(--tblr-muted)' }} />
                  </div>
                </div>
                <p className="text-xs line-clamp-2 mb-4 flex-1" style={{ color: 'var(--tblr-muted)' }}>
                  {project.description || t('projects_no_description')}
                </p>
                <div className="flex items-center justify-between pt-3 mt-auto" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                  <div className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                    <p className="font-semibold text-[13px]" style={{ color: 'var(--tblr-text)' }}>{formatCurrency(project.budget)}</p>
                    <p>{t('budget')}</p>
                  </div>
                  <div className="text-xs text-right" style={{ color: 'var(--tblr-muted)' }}>
                    <p className="font-semibold text-[13px]" style={{ color: 'var(--tblr-text)' }}>{new Date(project.end_date).toLocaleDateString()}</p>
                    <p>{t('deadline')}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1200px]">
              <thead>
                <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                  <th
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors"
                    style={{ color: 'var(--tblr-muted)' }}
                    onClick={() => requestSort('project_code')}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <div className="flex items-center gap-1">{t('projects_col_code')} {getSortIcon('project_code')}</div>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('name')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <div className="flex items-center gap-1">{t('projects_col_name')} {getSortIcon('name')}</div>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('client')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <div className="flex items-center gap-1">{t('projects_col_client')} {getSortIcon('client')}</div>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('projects_col_description')}</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('surface')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <div className="flex items-center gap-1">{t('projects_col_surface')} {getSortIcon('surface')}</div>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('construction_cost')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <div className="flex items-center gap-1">{t('projects_col_construction_cost')} {getSortIcon('construction_cost')}</div>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('remuneration')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <div className="flex items-center gap-1">{t('projects_col_remuneration')} {getSortIcon('remuneration')}</div>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('progression')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <div className="flex items-center gap-1">{t('projects_col_progression')} {getSortIcon('progression')}</div>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('project_manager')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <div className="flex items-center gap-1">{t('projects_col_manager')} {getSortIcon('project_manager')}</div>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('projects_col_cotraitants')}</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('projects_col_intervenants')}</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('projects_col_entreprises')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((project) => (
                  <tr
                    key={project.id}
                    onClick={() => handleProjectClick(project)}
                    className="cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--tblr-border)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--tblr-muted)' }}>{project.project_code || '---'}</td>
                    <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--tblr-text)' }}>{project.name}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{project.client}</td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{project.description}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{project.surface ? `${project.surface} m²` : '---'}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{project.construction_cost ? formatCurrency(project.construction_cost) : '---'}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{project.remuneration ? formatCurrency(project.remuneration) : '---'}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{project.progression ? `${project.progression}%` : '0%'}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{project.project_manager || '---'}</td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{project.cotraitants || '---'}</td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{project.external_intervenants || '---'}</td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{project.entreprises || '---'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {isModalOpen && selectedProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              <div className="relative h-48 bg-zinc-100 dark:bg-zinc-800 shrink-0">
                <img 
                  src={selectedProject.image_url || `https://picsum.photos/seed/${selectedProject.id}/800/400`} 
                  alt={selectedProject.name} 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute top-4 left-4">
                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-black/50 text-white backdrop-blur-md border border-white/10">
                    {t('projects_code_label')} {selectedProject.project_code || '---'}
                  </span>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/40 text-white rounded-full transition-colors backdrop-blur-md"
                >
                  <IconX size={20} />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1">
                {isEditing && !projects.some(p => p.id === editForm?.id) && (
                  <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800">
                    <label className="block text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">{t('projects_use_template')}</label>
                    <select
                      className="w-full p-2 border rounded bg-white dark:bg-zinc-800"
                      onChange={e => {
                        const template = templates.find(t => t.id === e.target.value);
                        if (template) {
                          setEditForm(prev => prev ? ({
                            ...prev,
                            name: template.name,
                            description: template.default_description,
                            budget: template.default_budget,
                            status: template.default_status
                          }) : null);
                        }
                      }}
                    >
                      <option value="">{t('projects_select_template')}</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex items-center justify-between mb-6">
                  <div>
                    {isEditing ? (
                      <input 
                        className="text-2xl font-bold text-zinc-900 dark:text-white bg-transparent border-b border-zinc-300 dark:border-zinc-700 focus:border-blue-500 outline-none w-full"
                        value={editForm?.name ?? ''}
                        placeholder={t('projects_name_placeholder')}
                        onChange={e => setEditForm(prev => prev ? ({...prev, name: e.target.value}) : null)}
                      />
                    ) : (
                      <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{selectedProject.name}</h2>
                    )}
                    {isEditing ? (
                      <ContactAutocomplete 
                        contacts={contacts}
                        value={contacts.find(c => (c.company_name || `${c.first_name} ${c.last_name}`) === editForm?.client)?.id || ''}
                        onChange={id => {
                          const contact = contacts.find(c => c.id === id);
                          if (contact) {
                            setEditForm(prev => prev ? ({...prev, client: contact.company_name || `${contact.first_name} ${contact.last_name}`}) : null);
                          }
                        }}
                        onAddNew={() => setIsContactModalOpen(true)}
                        addNewLabel="Add New Client"
                      />
                    ) : (
                      <p className="text-zinc-500 dark:text-zinc-400">{selectedProject.client}</p>
                    )}
                    {isEditing ? (
                      <div className="mt-1">
                        <AddressAutocomplete 
                          value={editForm?.address || ''} 
                          onChange={(val: string) => setEditForm(prev => prev ? ({...prev, address: val}) : null)}
                          placeholder={t('projects_address_placeholder')}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-400 mt-1">{selectedProject.address}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {currentUser?.system_role === 'admin' && !isEditing && (
                      <button 
                        onClick={() => handleDeleteProject(selectedProject.id)}
                        className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        title="Delete Project"
                      >
                        <IconTrash size={20} />
                      </button>
                    )}
                    <button 
                      disabled={isSaving}
                      onClick={() => isEditing ? handleSave() : setIsEditing(true)}
                      className={cn(
                        "px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2",
                        isEditing 
                          ? "bg-blue-600 text-white hover:bg-blue-700" 
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700",
                        isSaving && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {isSaving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          {t('saving')}
                        </>
                      ) : isEditing ? (
                        <>
                          <IconDeviceFloppy size={18} />
                          {t('btn_save')}
                        </>
                      ) : (
                        t('btn_edit')
                      )}
                    </button>
                    {!isEditing && (
                      <Link 
                        to={`/projects/${selectedProject.id}`}
                        className="p-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        title="Open Full Page"
                      >
                        <IconExternalLink size={20} />
                      </Link>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
                  {isEditing && (
                    <div className="col-span-2 space-y-2">
                      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_image_label')}</label>
                      <div className="flex items-center gap-4">
                        <div className="w-24 h-24 rounded-lg bg-zinc-100 dark:bg-zinc-800 border-2 border-dashed border-zinc-200 dark:border-zinc-700 overflow-hidden flex items-center justify-center shrink-0">
                          {editForm?.image_url ? (
                            <img src={editForm.image_url} alt="Preview" className="w-full h-full object-cover" />
                          ) : (
                            <IconUpload className="text-zinc-400" size={24} />
                          )}
                        </div>
                        <div className="flex-1">
                          <label className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-lg cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-zinc-700 text-sm font-medium">
                            <IconUpload size={18} />
                            {t('projects_upload_image')}
                            <input 
                              type="file" 
                              className="hidden" 
                              accept="image/*"
                              onChange={handleImageUpload}
                            />
                          </label>
                          <p className="text-[10px] text-zinc-500 mt-2">{t('projects_image_hint')}</p>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('status')}</label>
                    {isEditing ? (
                      <select 
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.status || 'Planning'}
                        onChange={e => setEditForm(prev => prev ? ({...prev, status: e.target.value as any}) : null)}
                      >
                        <option value="Planning">{t('projects_status_planning')}</option>
                        <option value="In Progress">{t('projects_status_in_progress')}</option>
                        <option value="Completed">{t('projects_status_completed')}</option>
                        <option value="On Hold">{t('projects_status_on_hold')}</option>
                      </select>
                    ) : (
                      <div className={cn(
                        "inline-flex px-2.5 py-1 rounded-md text-sm font-medium border",
                        selectedProject.status === 'In Progress' ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800" :
                        selectedProject.status === 'Completed' ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800" :
                        "bg-zinc-50 dark:bg-zinc-900/30 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800"
                      )}>
                        {selectedProject.status}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_domain_label')}</label>
                    {isEditing ? (
                      <select
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.category || ''}
                        onChange={e => setEditForm(prev => prev ? ({...prev, category: e.target.value}) : null)}
                      >
                        <option value="">{t('projects_select_domain')}</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.name}>{cat.name}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{selectedProject.category || t('projects_uncategorized')}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('budget')}</label>
                    {isEditing ? (
                      <input 
                        type="number"
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.budget || 0}
                        onChange={e => setEditForm(prev => prev ? ({...prev, budget: Number(e.target.value)}) : null)}
                      />
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{formatCurrency(selectedProject.budget)}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_start_date')}</label>
                    {isEditing ? (
                      <input 
                        type="date"
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.start_date || ''}
                        onChange={e => setEditForm(prev => prev ? ({...prev, start_date: e.target.value}) : null)}
                      />
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{new Date(selectedProject.start_date).toLocaleDateString()}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('deadline')}</label>
                    {isEditing ? (
                      <input 
                        type="date"
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.end_date || ''}
                        onChange={e => setEditForm(prev => prev ? ({...prev, end_date: e.target.value}) : null)}
                      />
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{new Date(selectedProject.end_date).toLocaleDateString()}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_surface_m2')}</label>
                    {isEditing ? (
                      <input 
                        type="number"
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.surface || 0}
                        onChange={e => setEditForm(prev => prev ? ({...prev, surface: Number(e.target.value)}) : null)}
                      />
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{selectedProject.surface || 0} m²</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_construction_cost_eur')}</label>
                    {isEditing ? (
                      <input 
                        type="number"
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.construction_cost || 0}
                        onChange={e => setEditForm(prev => prev ? ({...prev, construction_cost: Number(e.target.value)}) : null)}
                      />
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{formatCurrency(selectedProject.construction_cost || 0)}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_remuneration_eur')}</label>
                    {isEditing ? (
                      <input 
                        type="number"
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.remuneration || 0}
                        onChange={e => setEditForm(prev => prev ? ({...prev, remuneration: Number(e.target.value)}) : null)}
                      />
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{formatCurrency(selectedProject.remuneration || 0)}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_progression_pct')}</label>
                    {isEditing ? (
                      <input 
                        type="number"
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.progression || 0}
                        onChange={e => setEditForm(prev => prev ? ({...prev, progression: Number(e.target.value)}) : null)}
                      />
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{selectedProject.progression || 0}%</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_manager_label')}</label>
                    {isEditing ? (
                      <select
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.project_manager || ''}
                        onChange={e => setEditForm(prev => prev ? ({...prev, project_manager: e.target.value}) : null)}
                      >
                        <option value="">{t('projects_select_manager')}</option>
                        {team.map(member => (
                          <option key={member.id} value={member.name}>{member.name}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{selectedProject.project_manager || '---'}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 mb-8">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_cotraitants_table')}</label>
                    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-zinc-500">{t('projects_specialty_label')}</th>
                            <th className="px-3 py-2 text-left font-medium text-zinc-500">{t('projects_cotraitant_label')}</th>
                            {isEditing && <th className="px-3 py-2 text-right font-medium text-zinc-500 w-10"></th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                          {(isEditing ? editForm?.cotraitants_list : selectedProject.cotraitants_list)?.map((cot, idx) => (
                            <tr key={cot.id || idx}>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <input 
                                    className="w-full bg-transparent outline-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                                    value={cot.specialty || ''}
                                    onChange={e => {
                                      const newList = [...(editForm?.cotraitants_list || [])];
                                      newList[idx] = { ...newList[idx], specialty: e.target.value };
                                      setEditForm(prev => prev ? ({ ...prev, cotraitants_list: newList }) : null);
                                    }}
                                  />
                                ) : (
                                  cot.specialty
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <ContactAutocomplete 
                                    contacts={contacts}
                                    value={cot.contact_id || ''}
                                    onChange={val => {
                                      const newList = [...(editForm?.cotraitants_list || [])];
                                      const contact = contacts.find(c => c.id === val);
                                      newList[idx] = { 
                                        ...newList[idx], 
                                        contact_id: val,
                                        contact_name: contact ? `${contact.first_name} ${contact.last_name}` : ''
                                      };
                                      setEditForm(prev => prev ? ({ ...prev, cotraitants_list: newList }) : null);
                                    }}
                                    onAddNew={() => setIsContactModalOpen(true)}
                                  />
                                ) : (
                                  cot.contact_name || '---'
                                )}
                              </td>
                              {isEditing && (
                                <td className="px-3 py-2 text-right">
                                  <button 
                                    onClick={() => {
                                      const newList = (editForm?.cotraitants_list || []).filter((_, i) => i !== idx);
                                      setEditForm(prev => prev ? ({ ...prev, cotraitants_list: newList }) : null);
                                    }}
                                    className="text-red-500 hover:text-red-700"
                                  >
                                    <IconTrash size={14} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                          {isEditing && (
                            <tr>
                              <td colSpan={3} className="px-3 py-2">
                                <button 
                                  onClick={() => {
                                    const newList = [...(editForm?.cotraitants_list || []), { id: `new-${Date.now()}`, project_id: selectedProject.id, specialty: '', contact_id: '' }];
                                    setEditForm(prev => prev ? ({ ...prev, cotraitants_list: newList }) : null);
                                  }}
                                  className="text-blue-500 hover:text-blue-700 flex items-center gap-1 text-xs font-medium"
                                >
                                  <IconPlus size={14} /> {t('projects_add_cotraitant')}
                                </button>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_cotraitants_freetext')}</label>
                    {isEditing ? (
                      <input 
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.cotraitants || ''}
                        onChange={e => setEditForm(prev => prev ? ({...prev, cotraitants: e.target.value}) : null)}
                      />
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{selectedProject.cotraitants || '---'}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_intervenants')}</label>
                    {isEditing ? (
                      <input 
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.external_intervenants || ''}
                        onChange={e => setEditForm(prev => prev ? ({...prev, external_intervenants: e.target.value}) : null)}
                      />
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{selectedProject.external_intervenants || '---'}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_entreprises')}</label>
                    {isEditing ? (
                      <input
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={editForm?.entreprises || ''}
                        onChange={e => setEditForm(prev => prev ? ({...prev, entreprises: e.target.value}) : null)}
                      />
                    ) : (
                      <p className="text-zinc-900 dark:text-white font-medium">{selectedProject.entreprises || '---'}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('description')}</label>
                  {isEditing ? (
                    <textarea 
                      className="w-full h-32 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none text-zinc-900 dark:text-white"
                      value={editForm?.description || ''}
                      onChange={e => setEditForm(prev => prev ? ({...prev, description: e.target.value}) : null)}
                    />
                  ) : (
                    <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
                      {selectedProject.description || t('projects_no_description')}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-6">
                  <input 
                    type="checkbox"
                    id="is_complete_mission"
                    className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
                    checked={isEditing ? !!editForm?.is_complete_mission : !!selectedProject.is_complete_mission}
                    disabled={!isEditing}
                    onChange={e => setEditForm(prev => prev ? ({...prev, is_complete_mission: e.target.checked}) : null)}
                  />
                  <label htmlFor="is_complete_mission" className="text-sm font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                    {t('projects_complete_mission')}
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-6 mt-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_studies_label')}</label>
                    {isEditing ? (
                      <textarea 
                        className="w-full h-24 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none text-zinc-900 dark:text-white"
                        value={editForm?.etudes_notes || ''}
                        onChange={e => setEditForm(prev => prev ? ({...prev, etudes_notes: e.target.value}) : null)}
                      />
                    ) : (
                      <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
                        {selectedProject.etudes_notes || t('projects_no_studies_notes')}
                      </p>
                    )}
                  </div>

                  {(isEditing ? editForm?.is_complete_mission : selectedProject.is_complete_mission) && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_construction_label')}</label>
                      {isEditing ? (
                        <textarea 
                          className="w-full h-24 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none text-zinc-900 dark:text-white"
                          value={editForm?.chantier_notes || ''}
                          onChange={e => setEditForm(prev => prev ? ({...prev, chantier_notes: e.target.value}) : null)}
                        />
                      ) : (
                        <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
                          {selectedProject.chantier_notes || t('projects_no_construction_notes')}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {(isEditing ? editForm?.is_complete_mission : selectedProject.is_complete_mission) && (
                  <div className="space-y-2 mt-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t('projects_lots_enterprises')}</label>
                      {isEditing && (
                        <button
                          type="button"
                          onClick={() => {
                            const newList = [...(editForm?.lots_list || []), { id: `lot-${Date.now()}`, project_id: selectedProject.id, lot_number: '', lot_title: '', contact_id: '' }];
                            setEditForm(prev => prev ? ({ ...prev, lots_list: newList }) : null);
                          }}
                          className="text-blue-500 hover:text-blue-700 flex items-center gap-1 text-xs font-medium"
                        >
                          <IconPlus size={14} /> {t('projects_add_lot')}
                        </button>
                      )}
                    </div>
                    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-zinc-500 w-16">{t('projects_num_short')}</th>
                            <th className="px-3 py-2 text-left font-medium text-zinc-500">{t('projects_lot_label')}</th>
                            <th className="px-3 py-2 text-left font-medium text-zinc-500">{t('projects_enterprise_label')}</th>
                            {isEditing && <th className="px-3 py-2 text-right font-medium text-zinc-500 w-10"></th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                          {(isEditing ? editForm?.lots_list : selectedProject.lots_list)?.map((lot, idx) => (
                            <tr key={lot.id || idx}>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <input 
                                    className="w-full bg-transparent outline-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                                    value={lot.lot_number || ''}
                                    onChange={e => {
                                      const newList = [...(editForm?.lots_list || [])];
                                      newList[idx] = { ...newList[idx], lot_number: e.target.value };
                                      setEditForm(prev => prev ? ({ ...prev, lots_list: newList }) : null);
                                    }}
                                  />
                                ) : (
                                  lot.lot_number
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <input 
                                    className="w-full bg-transparent outline-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                                    value={lot.lot_title || ''}
                                    onChange={e => {
                                      const newList = [...(editForm?.lots_list || [])];
                                      newList[idx] = { ...newList[idx], lot_title: e.target.value };
                                      setEditForm(prev => prev ? ({ ...prev, lots_list: newList }) : null);
                                    }}
                                  />
                                ) : (
                                  lot.lot_title
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <ContactAutocomplete 
                                    contacts={contacts.filter(c => c.category?.toLowerCase().includes('entreprise'))}
                                    value={lot.contact_id || ''}
                                    onChange={val => {
                                      const newList = [...(editForm?.lots_list || [])];
                                      const contact = contacts.find(c => c.id === val);
                                      newList[idx] = { 
                                        ...newList[idx], 
                                        contact_id: val,
                                        contact_name: contact ? `${contact.first_name} ${contact.last_name}` : ''
                                      };
                                      setEditForm(prev => prev ? ({ ...prev, lots_list: newList }) : null);
                                    }}
                                    onAddNew={() => setIsContactModalOpen(true)}
                                  />
                                ) : (
                                  lot.contact_name || '---'
                                )}
                              </td>
                              {isEditing && (
                                <td className="px-3 py-2 text-right">
                                  <button 
                                    onClick={() => {
                                      const newList = (editForm?.lots_list || []).filter((_, i) => i !== idx);
                                      setEditForm(prev => prev ? ({ ...prev, lots_list: newList }) : null);
                                    }}
                                    className="text-red-500 hover:text-red-700"
                                  >
                                    <IconTrash size={14} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                          {((isEditing ? editForm?.lots_list : selectedProject.lots_list) || []).length === 0 && (
                            <tr>
                              <td colSpan={isEditing ? 4 : 3} className="px-3 py-4 text-center text-zinc-500 italic">
                                {t('projects_no_lots')}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {(selectedProject.address || (isEditing && editForm?.address)) && (
                  <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <RNBInfo address={isEditing ? editForm?.address || '' : selectedProject.address || ''} />
                    <CadastreDownload address={isEditing ? editForm?.address || '' : selectedProject.address || ''} />
                  </div>
                )}

                {(selectedProject.address || (isEditing && editForm?.address)) && (
                  <div className="mt-6">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 block">{t('projects_location_label')}</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-64">
                      <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative h-full">
                        <GeoportailMap address={isEditing ? editForm?.address || '' : selectedProject.address || ''} />
                        <div className="absolute top-2 left-2 px-2 py-1 bg-white/80 dark:bg-black/80 backdrop-blur-sm rounded text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700">{t('projects_cadastre_label')}</div>
                      </div>
                      <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative h-full">
                        <GoogleMap address={isEditing ? editForm?.address || '' : selectedProject.address || ''} />
                        <div className="absolute top-2 left-2 px-2 py-1 bg-white/80 dark:bg-black/80 backdrop-blur-sm rounded text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700">{t('projects_google_maps_label')}</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-8 pt-8 border-t border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">{t('projects_milestones_title')}</h3>
                    <button
                      onClick={() => setIsAddingMilestone(!isAddingMilestone)}
                      className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
                    >
                      <IconPlus size={14} /> {t('projects_add_milestone')}
                    </button>
                  </div>

                  {isAddingMilestone && (
                    <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-100 dark:border-zinc-800 mb-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1 block">{t('projects_milestone_title_label')}</label>
                          <input
                            className="w-full px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                            placeholder={t('projects_milestone_example')}
                            value={newMilestoneTitle}
                            onChange={e => setNewMilestoneTitle(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1 block">{t('projects_due_date_label')}</label>
                          <input 
                            type="date"
                            className="w-full px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                            value={newMilestoneDate}
                            onChange={e => setNewMilestoneDate(e.target.value)}
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <button
                            onClick={handleAddMilestone}
                            className="flex-1 bg-blue-600 text-white py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                          >
                            {t('btn_save')}
                          </button>
                          <button
                            onClick={() => setIsAddingMilestone(false)}
                            className="px-3 py-1.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                          >
                            {t('btn_cancel')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    {milestones.length > 0 ? (
                      milestones.map((milestone) => (
                        <div 
                          key={milestone.id}
                          className={cn(
                            "flex items-center justify-between p-3 rounded-xl border transition-all",
                            milestone.completed 
                              ? "bg-green-50/30 dark:bg-green-900/10 border-green-100 dark:border-green-900/30 opacity-75" 
                              : "bg-white dark:bg-zinc-800 border-zinc-100 dark:border-zinc-700"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <button 
                              onClick={() => handleToggleMilestone(milestone)}
                              className={cn(
                                "p-1 rounded-full transition-colors",
                                milestone.completed ? "text-green-600" : "text-zinc-300 hover:text-blue-500"
                              )}
                            >
                              {milestone.completed ? <IconCircleCheck size={20} /> : <IconCircle size={20} />}
                            </button>
                            <div>
                              <p className={cn(
                                "text-sm font-medium",
                                milestone.completed ? "text-zinc-500 line-through" : "text-zinc-900 dark:text-white"
                              )}>
                                {milestone.title}
                              </p>
                              <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                                <IconCalendar size={10} />
                                <span>{t('due')} {new Date(milestone.due_date).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>
                          <button 
                            onClick={() => handleDeleteMilestone(milestone.id)}
                            className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                          >
                            <IconTrash size={16} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 bg-zinc-50 dark:bg-zinc-900/30 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
                        <IconCalendar className="mx-auto text-zinc-300 mb-2" size={24} />
                        <p className="text-xs text-zinc-500">{t('projects_no_milestones_defined')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Category Management Modal */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white">{t('projects_manage_domains_title')}</h3>
              <button onClick={() => setIsCategoryModalOpen(false)} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                ✕
              </button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              <form onSubmit={handleAddCategory} className="flex gap-2 mb-6">
                <input 
                  className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-zinc-900 dark:text-white"
                  placeholder={t('projects_new_domain_placeholder')}
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                />
                <button 
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {t('btn_add')}
                </button>
              </form>
              <div className="space-y-2">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-100 dark:border-zinc-700/50">
                    <span className="text-zinc-700 dark:text-zinc-300">{cat.name}</span>
                    <button 
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="text-zinc-400 hover:text-red-500 transition-colors"
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <ContactModal 
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
        onSuccess={(newContact) => {
          fetchContacts();
        }}
      />
    </div>
  );
}
