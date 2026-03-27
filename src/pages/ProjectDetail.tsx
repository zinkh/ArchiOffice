import React, { useState, useEffect, ChangeEvent, useRef } from 'react';
import Select, { StylesConfig } from 'react-select';
import CreatableSelect from 'react-select/creatable';
import chroma from 'chroma-js';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  IconArrowLeft, 
  IconDeviceFloppy, 
  IconTrash, 
  IconPlus, 
  IconCircleCheck, 
  IconCircle, 
  IconCalendar, 
  IconClock, 
  IconFileInvoice, 
  IconUpload,
  IconExternalLink,
  IconFileCode,
  IconChevronRight,
  IconChevronDown,
  IconFileText,
  IconFileCheck,
  IconFlag,
  IconCalculator,
  IconHammer,
  IconBook,
  IconCheck,
  IconX,
  IconMessageDots,
  IconRefresh
} from '@tabler/icons-react';
import { motion } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import type { Project, Milestone, Invoice, ProjectCategory, Specification, OrdreDeService, Visa, Reception, Tender, Reserve, Plan } from '../types';
import { useUser } from '../UserContext';
import { GeoportailMap, GoogleMap, RNBInfo } from '../components/LocationMaps';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { PlanAnnotator } from '../components/PlanAnnotator';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import { CadastreDownload } from '../components/CadastreDownload';
import SiteReports from '../components/SiteReports';
import MilestoneGantt from '../components/MilestoneGantt';
import Situations from './Situations';

import { useTranslation } from 'react-i18next';

interface CategoryOption {
  value: string;
  label: string;
  color: string;
}

const colourStyles: StylesConfig<CategoryOption, true> = {
  control: (styles) => ({ ...styles, backgroundColor: 'white' }),
  option: (styles, { data, isDisabled, isFocused, isSelected }) => {
    const color = chroma(data.color);
    return {
      ...styles,
      backgroundColor: isDisabled
        ? undefined
        : isSelected
        ? data.color
        : isFocused
        ? color.alpha(0.1).css()
        : undefined,
      color: isDisabled
        ? '#ccc'
        : isSelected
        ? chroma.contrast(color, 'white') > 2
          ? 'white'
          : 'black'
        : data.color,
      cursor: isDisabled ? 'not-allowed' : 'default',

      ':active': {
        ...styles[':active'],
        backgroundColor: !isDisabled
          ? isSelected
            ? data.color
            : color.alpha(0.3).css()
          : undefined,
      },
    };
  },
  multiValue: (styles, { data }) => {
    const color = chroma(data.color);
    return {
      ...styles,
      backgroundColor: color.alpha(0.1).css(),
    };
  },
  multiValueLabel: (styles, { data }) => ({
    ...styles,
    color: data.color,
  }),
  multiValueRemove: (styles, { data }) => ({
    ...styles,
    color: data.color,
    ':hover': {
      backgroundColor: data.color,
      color: 'white',
    },
  }),
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser, setHeaderTitle } = useUser();
  const { t } = useTranslation();
  
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    if (project) {
      setHeaderTitle(project.name);
    }
    return () => setHeaderTitle('Dashboard');
  }, [project, setHeaderTitle]);
  const [team, setTeam] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [specifications, setSpecifications] = useState<Specification[]>([]);
  const [visas, setVisas] = useState<Visa[]>([]);
  const [receptions, setReceptions] = useState<Reception[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [projectTenders, setProjectTenders] = useState<Tender[]>([]);
  const [categories, setCategories] = useState<ProjectCategory[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [ordresDeService, setOrdresDeService] = useState<OrdreDeService[]>([]);
  
  const [newOs, setNewOs] = useState({
    title: '',
    os_number: '',
    lot: '',
    entreprise: '',
    maitrise_oeuvre: '',
    montant: ''
  });
  
  const [isAddingOs, setIsAddingOs] = useState(false);
  const [isAddingInvoice, setIsAddingInvoice] = useState(false);
  const [newInvoice, setNewInvoice] = useState({
    invoice_number: '',
    amount: 0,
    description: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingMilestone, setIsAddingMilestone] = useState(false);
  const [isAddingSpec, setIsAddingSpec] = useState(false);
  const [newSpecTitle, setNewSpecTitle] = useState('');
  const [isAddingReserve, setIsAddingReserve] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotationCoords, setAnnotationCoords] = useState<{ x: number, y: number } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [editingReserveId, setEditingReserveId] = useState<string | null>(null);
  const [editReserveData, setEditReserveData] = useState<Reserve | null>(null);
  const [newReserve, setNewReserve] = useState({
    title: '',
    batiment: '',
    local: '',
    status: 'A faire',
    lots: [] as any[],
    entreprises: [] as any[],
    created_at: new Date().toISOString().split('T')[0],
    due_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newMilestoneDate, setNewMilestoneDate] = useState('');
  const [activeTab, setActiveTab] = useState('INFOS');
  const [updatingPlanId, setUpdatingPlanId] = useState<string | null>(null);
  const planInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (project && !project.is_chantier && ['DET', 'RDT', 'VISA', 'AOR'].includes(activeTab)) {
      setActiveTab('INFOS');
    }
  }, [project?.is_chantier, activeTab]);

  useEffect(() => {
    if (id) {
      fetchFullProject();
      fetchCategories();
      fetchContacts();
      fetchTeam();
      fetchProjectTenders();
    }
  }, [id]);

  const fetchFullProject = async () => {
    try {
      const res = await fetch(`/api/projects/${id}/full`);
      if (res.ok) {
        const data = await res.json();
        setProject({ ...data.project, is_complete_mission: !!data.project.is_complete_mission });
        setMilestones(data.milestones.map((m: any) => ({ ...m, completed: !!m.completed })));
        setInvoices(data.invoices);
        setSpecifications(data.specifications);
        setOrdresDeService(data.ordres_de_service);
        setVisas(data.visas);
        setReceptions(data.receptions);
        setReserves(data.reserves);
        setPlans(data.plans);
      } else {
        navigate('/projects');
      }
    } catch (err) {
      console.error('Failed to fetch full project:', err);
    }
  };

  const fetchVisas = async () => {
    try {
      const res = await fetch(`/api/visas?project_id=${id}`);
      if (res.ok) setVisas(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchReceptions = async () => {
    try {
      const res = await fetch(`/api/receptions?project_id=${id}`);
      if (res.ok) setReceptions(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchReserves = async () => {
    try {
      const res = await fetch(`/api/reserves?project_id=${id}`);
      if (res.ok) setReserves(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchPlans = async () => {
    try {
      const res = await fetch(`/api/plans?project_id=${id}`);
      if (res.ok) setPlans(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchProjectTenders = async () => {
    try {
      const res = await fetch('/api/tenders');
      if (res.ok) setProjectTenders(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTeam = async () => {
    try {
      const res = await fetch('/api/team');
      if (res.ok) {
        const data = await res.json();
        setTeam(data);
      }
    } catch (err) {
      console.error('Failed to fetch team:', err);
    }
  };

  const fetchOrdresDeService = async () => {
    try {
      const res = await fetch(`/api/ordres_de_service?project_id=${id}`);
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          setOrdresDeService(data);
        } catch (e) {
          console.error("Failed to parse OS JSON:", text);
        }
      } else {
        console.error("Failed to fetch OS:", res.status, await res.text());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await fetch('/api/contacts');
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          console.log('ProjectDetail fetched contacts:', data);
          setContacts(data);
        } catch (e) {
          console.error("Failed to parse contacts JSON:", text);
        }
      } else {
        console.error("Failed to fetch contacts:", res.status, await res.text());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchProject = fetchFullProject;

  const fetchMilestones = async () => {
    try {
      const res = await fetch(`/api/milestones?project_id=${id}`);
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          setMilestones(data.map((m: any) => ({ ...m, completed: !!m.completed })));
        } catch (e) {
          console.error("Failed to parse milestones JSON:", text);
        }
      } else {
        console.error("Failed to fetch milestones:", res.status, await res.text());
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (project && !newOs.maitrise_oeuvre) {
      setNewOs(prev => ({ ...prev, maitrise_oeuvre: project.project_manager || '' }));
    }
  }, [project]);

  const getNextOsNumber = (entreprise: string) => {
    if (!entreprise) return '';
    const companyOs = ordresDeService.filter(os => os.entreprise === entreprise);
    const nextNum = companyOs.length + 1;
    return nextNum.toString().padStart(2, '0');
  };

  const handleLotChange = (lotNumber: string) => {
    const lot = project?.lots_list?.find(l => l.lot_number === lotNumber);
    const entreprise = lot?.contact_name || '';
    const nextOsNum = getNextOsNumber(entreprise);
    
    setNewOs(prev => ({
      ...prev,
      lot: lotNumber,
      entreprise: entreprise,
      os_number: nextOsNum
    }));
  };

  const handleEntrepriseChange = (entreprise: string) => {
    const nextOsNum = getNextOsNumber(entreprise);
    setNewOs(prev => ({
      ...prev,
      entreprise,
      os_number: nextOsNum
    }));
  };

  const fetchInvoices = async () => {
    try {
      const res = await fetch(`/api/invoices?project_id=${id}`);
      if (res.ok) {
        setInvoices(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch invoices:', err);
    }
  };

  const fetchSpecifications = async () => {
    try {
      const res = await fetch(`/api/specifications?project_id=${id}`);
      if (res.ok) {
        const data = await res.json();
        setSpecifications(data.map((s: any) => ({ ...s, is_template: !!s.is_template })));
      }
    } catch (err) {
      console.error('Failed to fetch specifications:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/project_categories');
      if (res.ok) {
        const text = await res.text();
        try {
          setCategories(JSON.parse(text));
        } catch (e) {
          console.error("Failed to parse categories JSON:", text);
        }
      } else {
        console.error("Failed to fetch categories:", res.status, await res.text());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async () => {
    if (!project || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': currentUser?.system_role || 'user'
        },
        body: JSON.stringify(project)
      });
      if (res.ok) {
        alert('Project saved successfully');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!project || !confirm('Are you sure you want to delete this project?')) return;
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
        headers: { 'x-user-role': currentUser?.system_role || 'user' }
      });
      if (res.ok) {
        navigate('/projects');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddMilestone = async () => {
    if (!id || !newMilestoneTitle || !newMilestoneDate) return;
    try {
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: id,
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
      console.error(err);
    }
  };

  const handleCreateSpec = async () => {
    if (!id || !newSpecTitle) return;
    try {
      const newSpecId = `spec-${Date.now()}`;
      const res = await fetch('/api/specifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newSpecId,
          project_id: id,
          title: newSpecTitle,
          content: JSON.stringify([{ id: `section-${Date.now()}`, title: 'General Provisions', items: [] }]),
          last_updated: new Date().toISOString()
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSpecifications(prev => [...prev, { id: newSpecId, project_id: id, title: newSpecTitle, content: JSON.stringify([{ id: `section-${Date.now()}`, title: 'General Provisions', items: [] }]), last_updated: data.last_updated }]);
        setNewSpecTitle('');
        setIsAddingSpec(false);
      } else {
        const errorText = await res.text();
        console.error('Failed to create specification:', res.status, errorText);
        alert(`Erreur lors de la création du cahier des charges: ${errorText}`);
      }
    } catch (err) {
      console.error('Error creating specification:', err);
      alert('Une erreur est survenue lors de la création du cahier des charges.');
    }
  };

  const handleToggleMilestone = async (milestone: Milestone) => {
    try {
      const res = await fetch(`/api/milestones/${milestone.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...milestone, completed: !milestone.completed })
      });
      if (res.ok) {
        setMilestones(prev => prev.map(m => m.id === milestone.id ? { ...m, completed: !m.completed } : m));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateOs = async () => {
    if (!id || !newOs.title || !newOs.os_number) return;
    try {
      const res = await fetch('/api/ordres_de_service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newOs,
          project_id: id,
          date: new Date().toISOString(),
          status: 'draft'
        })
      });
      if (res.ok) {
        const data = await res.json();
        setOrdresDeService(prev => [...prev, data]);
        setNewOs({
          title: '',
          os_number: '',
          lot: '',
          entreprise: '',
          maitrise_oeuvre: project?.project_manager || '',
          montant: ''
        });
        setIsAddingOs(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteOs = async (osId: string) => {
    if (!confirm('Are you sure you want to delete this OS?')) return;
    try {
      const res = await fetch(`/api/ordres_de_service/${osId}`, { method: 'DELETE' });
      if (res.ok) {
        setOrdresDeService(prev => prev.filter(os => os.id !== osId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateInvoice = async () => {
    if (!id || !newInvoice.invoice_number || !newInvoice.amount) return;
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newInvoice,
          project_id: id,
          issue_date: new Date().toISOString(),
          due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'Draft',
          created_at: new Date().toISOString()
        })
      });
      if (res.ok) {
        const data = await res.json();
        setInvoices(prev => [...prev, data]);
        setNewInvoice({ invoice_number: '', amount: 0, description: '' });
        setIsAddingInvoice(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

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
            if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
          } else {
            if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    try {
      const optimizedBase64 = await optimizeImage(file);
      setProject({ ...project, image_url: optimizedBase64 });
    } catch (err) {
      console.error(err);
    }
  };

  const handlePlanUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      const name = file.name;
      
      if (updatingPlanId) {
        // Create a new version of an existing plan
        const parentPlan = plans.find(p => p.id === updatingPlanId);
        if (!parentPlan) return;
        
        // Calculate new index (A -> B, B -> C...)
        let newIndex = 'A';
        if (parentPlan.index) {
          newIndex = String.fromCharCode(parentPlan.index.charCodeAt(0) + 1);
        }
        
        const newPlan: Plan = {
          id: crypto.randomUUID(),
          project_id: id!,
          name: parentPlan.name,
          file_url: base64,
          uploaded_at: new Date().toISOString(),
          index: newIndex,
          version: (parentPlan.version || 1) + 1,
          parent_id: parentPlan.id,
          category: parentPlan.category || (activeTab === 'PRO' || activeTab === 'AOR' ? activeTab as 'PRO' | 'AOR' : 'AOR')
        };
        
        try {
          const res = await fetch('/api/plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newPlan)
          });
          if (res.ok) {
            const data = await res.json();
            setPlans(prev => [...prev, data]);
            setUpdatingPlanId(null);
          }
        } catch (err) {
          console.error(err);
        }
      } else {
        // Create a new plan
        const newPlan: Plan = {
          id: crypto.randomUUID(),
          project_id: id!,
          name: name,
          file_url: base64,
          uploaded_at: new Date().toISOString(),
          index: 'A',
          version: 1,
          category: activeTab === 'PRO' || activeTab === 'AOR' ? activeTab as 'PRO' | 'AOR' : 'AOR'
        };
        
        try {
          const res = await fetch('/api/plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newPlan)
          });
          if (res.ok) {
            const data = await res.json();
            setPlans(prev => [...prev, data]);
          }
        } catch (err) {
          console.error(err);
        }
      }
      // Reset input
      if (planInputRef.current) planInputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  };

  if (!project) return <div className="p-8 text-center">Loading project...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      {/* Navigation Header */}
      <div className="flex items-center justify-between">
        <button 
          onClick={() => navigate('/projects')}
          className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
        >
          <IconArrowLeft size={20} />
          {t('view_all')} {t('projects')}
        </button>
        <div className="flex items-center gap-3">
          {currentUser?.system_role === 'admin' && (
            <button 
              onClick={handleDelete}
              className="p-2.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
              title={t('delete')}
            >
              <IconTrash size={20} />
            </button>
          )}
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-50"
          >
            {isSaving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <IconDeviceFloppy size={20} />
            )}
            {t('commit_changes')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Main Column */}
        <div className="space-y-8">
          
          {/* Tab Navigation */}
          <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800 mb-6 overflow-x-auto">
            {['INFOS', 'PRO', 'ACT', 'DET', 'RDT', 'VISA', 'AOR'].map(tab => {
              if (['DET', 'RDT', 'VISA', 'AOR'].includes(tab) && !project.is_chantier) return null;
              return (
                <button 
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors whitespace-nowrap",
                    activeTab === tab ? "text-blue-600 border-b-2 border-blue-600" : "text-zinc-500 hover:text-zinc-900"
                  )}
                >
                  {tab}
                </button>
              );
            })}
          </div>
          <div className="tab-content mt-8">
            {activeTab === 'INFOS' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-8">
                    {/* Hero Section - Editable */}
                    <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
                      <div className="aspect-[21/9] relative overflow-hidden bg-zinc-100 dark:bg-zinc-800 group">
                        {project.image_url ? (
                          <img src={project.image_url} alt={project.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-400">
                            <IconUpload size={48} />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <label className="cursor-pointer bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-6 py-3 rounded-xl font-bold border border-white/30 transition-all">
                            <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                            Change Cover Image
                          </label>
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                        <div className="absolute inset-x-0 bottom-0 p-8 space-y-4">
                          <input 
                            type="text"
                            className="w-full bg-transparent border-none text-4xl font-bold text-white placeholder:text-white/40 focus:ring-0 p-0"
                            value={project.name}
                            onChange={e => setProject({...project, name: e.target.value})}
                            placeholder="Project Name"
                          />
                          <div className="flex flex-wrap items-center gap-4">
                            <input 
                              type="text"
                              className="bg-white/10 border border-white/20 rounded-lg px-3 py-1 text-sm font-medium text-white placeholder:text-white/60 focus:ring-2 focus:ring-blue-500 outline-none"
                              value={project.client}
                              onChange={e => setProject({...project, client: e.target.value})}
                              placeholder="Client Name"
                            />
                            <span className="text-white/40">•</span>
                            <input 
                              type="text"
                              className="bg-white/10 border border-white/20 rounded-lg px-3 py-1 text-sm font-medium text-white placeholder:text-white/60 focus:ring-2 focus:ring-blue-500 outline-none"
                              value={project.category || ''}
                              onChange={e => setProject({...project, category: e.target.value})}
                              placeholder="Category"
                            />
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-8 space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                          <div className="md:col-span-2 space-y-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Description</label>
                            <textarea 
                              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white min-h-[120px] resize-none"
                              value={project.description}
                              onChange={e => setProject({...project, description: e.target.value})}
                              placeholder="Project description..."
                            />
                          </div>
                          <div className="space-y-6">
                            <div className="space-y-2">
                              <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Chef de projet</label>
                              <input 
                                type="text"
                                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white font-bold"
                                value={project.project_manager || ''}
                                onChange={e => setProject({...project, project_manager: e.target.value})}
                                placeholder="Manager Name"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 pt-8 border-t border-zinc-100 dark:border-zinc-800">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Surface (m²)</label>
                            <input 
                              type="number"
                              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white font-bold"
                              value={project.surface || 0}
                              onChange={e => setProject({...project, surface: Number(e.target.value)})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Coût Travaux</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 font-bold">€</span>
                              <input 
                                type="number"
                                className="w-full pl-8 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white font-bold"
                                value={project.construction_cost || 0}
                                onChange={e => setProject({...project, construction_cost: Number(e.target.value)})}
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Rémunération</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 font-bold">€</span>
                              <input 
                                type="number"
                                className="w-full pl-8 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white font-bold"
                                value={project.remuneration || 0}
                                onChange={e => setProject({...project, remuneration: Number(e.target.value)})}
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Progression (%)</label>
                            <input 
                              type="number"
                              min="0"
                              max="100"
                              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white font-bold"
                              value={project.progression || 0}
                              onChange={e => setProject({...project, progression: Number(e.target.value)})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Code Projet</label>
                            <input 
                              type="text"
                              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white font-bold"
                              value={project.project_code || ''}
                              onChange={e => setProject({...project, project_code: e.target.value})}
                              placeholder="PRJ-001"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Location & Maps - Editable */}
                    <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                      <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Localisation</h3>
                        <div className="mt-4">
                          <AddressAutocomplete 
                            value={project.address || ''}
                            onChange={addr => setProject({...project, address: addr})}
                          />
                        </div>
                      </div>
                      {project.address && (
                        <div className="space-y-6 p-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <RNBInfo address={project.address} />
                            <CadastreDownload address={project.address} />
                          </div>
                          <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-zinc-200 dark:bg-zinc-800 h-[400px]">
                              <div className="bg-white dark:bg-zinc-900 relative">
                                <GeoportailMap address={project.address} />
                                <div className="absolute top-4 left-4 px-3 py-1.5 bg-white/90 dark:bg-black/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 shadow-sm">Cadastre</div>
                              </div>
                              <div className="bg-white dark:bg-zinc-900 relative">
                                <GoogleMap address={project.address} />
                                <div className="absolute top-4 left-4 px-3 py-1.5 bg-white/90 dark:bg-black/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 shadow-sm">Google Maps</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Milestones section moved into INFOS tab */}
                      <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Milestones</h3>
                          <button 
                            onClick={() => setIsAddingMilestone(!isAddingMilestone)}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl text-xs font-bold transition-all"
                          >
                            <IconPlus size={14} />
                            Ajouter un milestone
                          </button>
                        </div>

                        {isAddingMilestone && (
                          <div className="p-6 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-zinc-700 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-400 uppercase">Titre</label>
                                <input 
                                  type="text"
                                  className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                  value={newMilestoneTitle}
                                  onChange={e => setNewMilestoneTitle(e.target.value)}
                                  placeholder="ex: Permis de construire"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-400 uppercase">Date</label>
                                <input 
                                  type="date"
                                  className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                  value={newMilestoneDate}
                                  onChange={e => setNewMilestoneDate(e.target.value)}
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-3">
                              <button 
                                onClick={() => setIsAddingMilestone(false)}
                                className="px-4 py-2 text-sm font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
                              >
                                Annuler
                              </button>
                              <button 
                                onClick={handleAddMilestone}
                                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all"
                              >
                                Ajouter
                              </button>
                            </div>
                          </div>
                        )}

                        {project && milestones.length > 0 && (
                          <div className="mb-6">
                            <MilestoneGantt 
                              milestones={milestones} 
                              startDate={new Date(project.start_date)} 
                              endDate={new Date(project.end_date)} 
                            />
                          </div>
                        )}

                        <div className="space-y-3">
                          {milestones.length > 0 ? milestones.map((m) => (
                            <div key={m.id} className="flex items-center justify-between group">
                              <div className="flex items-center gap-3">
                                <button 
                                  onClick={() => handleToggleMilestone(m)}
                                  className={cn(
                                    "transition-colors",
                                    m.completed ? "text-green-500" : "text-zinc-300 hover:text-zinc-400"
                                  )}
                                >
                                  {m.completed ? <IconCircleCheck size={20} /> : <IconCircle size={20} />}
                                </button>
                                <div>
                                  <p className={cn("text-sm font-medium", m.completed ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-white")}>
                                    {m.title}
                                  </p>
                                  <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                                    <IconCalendar size={10} />
                                    {new Date(m.due_date).toLocaleDateString()}
                                  </div>
                                </div>
                              </div>
                              <button 
                                onClick={() => {
                                  if(confirm('Delete milestone?')) {
                                    fetch(`/api/milestones/${m.id}`, { method: 'DELETE' })
                                      .then(() => setMilestones(prev => prev.filter(x => x.id !== m.id)));
                                  }
                                }}
                                className="p-1 text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <IconTrash size={14} />
                              </button>
                            </div>
                          )) : (
                            <p className="text-xs text-zinc-500 italic text-center py-4">No milestones defined.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Status & Budget (Moved into INFOS Tab) */}
                  <div className="space-y-8">
                    <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{t('status')} *</label>
                        <select 
                          className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white font-bold"
                          value={project.status}
                          onChange={e => setProject({...project, status: e.target.value as any})}
                        >
                          <option value="Planning">Planning</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                          <option value="On Hold">On Hold</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{t('budget')} *</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 font-bold">€</span>
                          <input 
                            type="number"
                            className="w-full pl-8 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white font-bold"
                            value={project.budget || 0}
                            onChange={e => setProject({...project, budget: Number(e.target.value)})}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Start</label>
                          <input 
                            type="date"
                            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                            value={project.start_date}
                            onChange={e => setProject({...project, start_date: e.target.value})}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{t('deadline')}</label>
                          <input 
                            type="date"
                            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                            value={project.end_date}
                            onChange={e => setProject({...project, end_date: e.target.value})}
                          />
                        </div>
                      </div>
                      <div className="space-y-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                        <div className="flex items-center gap-2">
                          <input 
                            type="checkbox"
                            id="is_complete_mission"
                            className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
                            checked={!!project.is_complete_mission}
                            onChange={e => setProject({...project, is_complete_mission: e.target.checked})}
                          />
                          <label htmlFor="is_complete_mission" className="text-sm font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                            Mission Complète
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <input 
                            type="checkbox"
                            id="is_chantier"
                            className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
                            checked={!!project.is_chantier}
                            onChange={e => setProject({...project, is_chantier: e.target.checked})}
                          />
                          <label htmlFor="is_chantier" className="text-sm font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                            Chantier
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'PRO' && (
              <div className="space-y-8">
                {(() => {
                  const proPlans = plans.filter(p => p.category === 'PRO');
                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      <div className="lg:col-span-2 space-y-8">
                        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                          <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                            <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Plans du projet (PRO)</h3>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => {
                                  setUpdatingPlanId(null);
                                  planInputRef.current?.click();
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl text-xs font-bold transition-all"
                              >
                                <IconUpload size={14} />
                                Importer un plan
                              </button>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                                <tr>
                                  <th className="px-6 py-3 text-left">Nom</th>
                                  <th className="px-6 py-3 text-left w-20">Indice</th>
                                  <th className="px-6 py-3 text-left">Date</th>
                                  <th className="px-6 py-3 text-right w-24">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {proPlans
                                  .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
                                  .map((plan) => (
                                  <tr key={plan.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group">
                                    <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white">{plan.name}</td>
                                    <td className="px-6 py-4">
                                      <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded text-[10px] font-bold">
                                        {plan.index || 'A'}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{new Date(plan.uploaded_at).toLocaleDateString()}</td>
                                    <td className="px-6 py-4 text-right">
                                      <div className="flex items-center justify-end gap-2">
                                        <button 
                                          onClick={() => {
                                            setUpdatingPlanId(plan.id);
                                            planInputRef.current?.click();
                                          }}
                                          title="Nouvel indice"
                                          className="p-2 text-zinc-400 hover:text-blue-600 transition-colors"
                                        >
                                          <IconRefresh size={16} />
                                        </button>
                                        <a href={plan.file_url} target="_blank" rel="noopener noreferrer" className="p-2 text-zinc-400 hover:text-blue-600 transition-colors">
                                          <IconExternalLink size={16} />
                                        </a>
                                        <button 
                                          onClick={async () => {
                                            if (!confirm('Supprimer ce plan ?')) return;
                                            try {
                                              const res = await fetch(`/api/plans/${plan.id}`, { method: 'DELETE' });
                                              if (res.ok) setPlans(prev => prev.filter(p => p.id !== plan.id));
                                            } catch (err) {
                                              console.error(err);
                                            }
                                          }}
                                          title="Supprimer"
                                          className="p-2 text-zinc-400 hover:text-red-600 transition-colors"
                                        >
                                          <IconTrash size={16} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                                {proPlans.length === 0 && (
                                  <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-zinc-500 italic">Aucun plan PRO.</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {activeTab === 'ACT' && (
              <div className="space-y-8">
                {/* Specifications List - Manageable */}
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Cahier des charges</h3>
                    {isAddingSpec ? (
                      <div className="flex items-center gap-2">
                        <input 
                          type="text" 
                          value={newSpecTitle} 
                          onChange={(e) => setNewSpecTitle(e.target.value)}
                          className="px-2 py-1 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                          placeholder="Titre..."
                          autoFocus
                        />
                        <button 
                          onClick={handleCreateSpec}
                          className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700"
                        >
                          OK
                        </button>
                        <button 
                          onClick={() => setIsAddingSpec(false)}
                          className="px-3 py-1 bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white rounded-lg text-xs font-bold hover:bg-zinc-300"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setIsAddingSpec(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl text-xs font-bold transition-all"
                      >
                        <IconPlus size={14} />
                        Ajouter un cahier des charges
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left">Titre</th>
                          <th className="px-6 py-3 text-left">Date</th>
                          <th className="px-6 py-3 text-right w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {specifications.map((spec) => (
                          <tr key={spec.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white">
                              <Link to={`/specifications/${spec.id}`} className="hover:text-blue-600 transition-colors">
                                {spec.title}
                              </Link>
                            </td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{new Date(spec.last_updated).toLocaleDateString()}</td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={async () => {
                                  if (!confirm('Supprimer ce document ?')) return;
                                  try {
                                    const res = await fetch(`/api/specifications/${spec.id}`, { method: 'DELETE' });
                                    if (res.ok) {
                                      setSpecifications(prev => prev.filter(s => s.id !== spec.id));
                                    }
                                  } catch (err) {
                                    console.error(err);
                                  }
                                }}
                                className="p-1 text-zinc-300 hover:text-red-500 transition-colors"
                              >
                                <IconTrash size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {specifications.length === 0 && (
                          <tr>
                            <td colSpan={3} className="px-6 py-8 text-center text-zinc-500 italic">Aucun cahier des charges.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Lots & Entreprises - Editable */}
                {project.is_complete_mission && (
                  <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Lots & Entreprises</h3>
                      <button 
                        onClick={() => {
                          const newLot = { id: crypto.randomUUID(), project_id: project.id, lot_number: `${(project.lots_list?.length || 0) + 1}`, lot_title: '' };
                          setProject({...project, lots_list: [...(project.lots_list || []), newLot]});
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl text-xs font-bold transition-all"
                      >
                        <IconPlus size={14} />
                        Ajouter un lot
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                          <tr>
                            <th className="px-6 py-3 text-left w-20">N°</th>
                            <th className="px-6 py-3 text-left">Lot</th>
                            <th className="px-6 py-3 text-left">Entreprise</th>
                            <th className="px-6 py-3 text-right w-20"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                          {project.lots_list?.map((lot, idx) => (
                            <tr key={lot.id || idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                              <td className="px-6 py-4">
                                <input 
                                  type="text"
                                  className="w-full bg-transparent border-none p-0 text-sm font-bold text-zinc-900 dark:text-white focus:ring-0"
                                  value={lot.lot_number}
                                  onChange={e => {
                                    const newList = [...(project.lots_list || [])];
                                    newList[idx] = { ...lot, lot_number: e.target.value };
                                    setProject({...project, lots_list: newList});
                                  }}
                                />
                              </td>
                              <td className="px-6 py-4">
                                <input 
                                  type="text"
                                  className="w-full bg-transparent border-none p-0 text-sm text-zinc-600 dark:text-zinc-300 focus:ring-0"
                                  value={lot.lot_title}
                                  onChange={e => {
                                    const newList = [...(project.lots_list || [])];
                                    newList[idx] = { ...lot, lot_title: e.target.value };
                                    setProject({...project, lots_list: newList});
                                  }}
                                  placeholder="Titre du lot"
                                />
                              </td>
                              <td className="px-6 py-4">
                                <ContactAutocomplete 
                                  value={lot.contact_name || ''}
                                  contacts={contacts}
                                  onChange={(id) => {
                                    const contact = contacts.find(c => c.id === id);
                                    const newList = [...(project.lots_list || [])];
                                    newList[idx] = { ...lot, contact_name: contact?.name || '', contact_id: id };
                                    setProject({...project, lots_list: newList});
                                  }}
                                />
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button 
                                  onClick={() => {
                                    const newList = project.lots_list?.filter((_, i) => i !== idx);
                                    setProject({...project, lots_list: newList});
                                  }}
                                  className="p-1 text-zinc-300 hover:text-red-500 transition-colors"
                                >
                                  <IconTrash size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {(!project.lots_list || project.lots_list.length === 0) && (
                            <tr>
                              <td colSpan={4} className="px-6 py-8 text-center text-zinc-500 italic">Aucun lot défini.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Appels d'offres</h3>
                    <Link 
                      to="/tenders"
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl text-xs font-bold transition-all"
                    >
                      <IconExternalLink size={14} />
                      Gérer les appels d'offres
                    </Link>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left">Titre</th>
                          <th className="px-6 py-3 text-left">Date limite</th>
                          <th className="px-6 py-3 text-left">Statut</th>
                          <th className="px-6 py-3 text-right">Valeur</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {projectTenders.filter(t => t.title.toLowerCase().includes(project.name.toLowerCase()) || t.notes.toLowerCase().includes(project.name.toLowerCase())).map((tender) => (
                          <tr key={tender.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white">{tender.title}</td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{new Date(tender.submission_deadline).toLocaleDateString()}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                tender.status === 'Won' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                tender.status === 'Lost' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                              )}>
                                {tender.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right font-bold text-zinc-900 dark:text-white">{formatCurrency(tender.value)}</td>
                          </tr>
                        ))}
                        {projectTenders.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-6 py-8 text-center text-zinc-500 italic">Aucun appel d'offres trouvé pour ce projet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'DET' && (
              <div className="space-y-8">
                {/* Ordres de Service List - Manageable */}
                {project?.is_complete_mission && (
                  <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Ordres de Service</h3>
                      <button 
                        onClick={() => setIsAddingOs(!isAddingOs)}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl text-xs font-bold transition-all"
                      >
                        <IconPlus size={14} />
                        Nouvel OS
                      </button>
                    </div>
                    {isAddingOs && (
                      <div className="p-6 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase">Titre</label>
                            <input 
                              type="text"
                              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newOs.title}
                              onChange={e => setNewOs({...newOs, title: e.target.value})}
                              placeholder="ex: Travaux supplémentaires"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase">Lot</label>
                            <select 
                              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newOs.lot}
                              onChange={e => handleLotChange(e.target.value)}
                            >
                              <option value="">Sélectionner un lot</option>
                              {project.lots_list?.map(l => (
                                <option key={l.id} value={l.lot_number}>{l.lot_number} - {l.lot_title}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase">Entreprise</label>
                            <input 
                              type="text"
                              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newOs.entreprise}
                              onChange={e => handleEntrepriseChange(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase">N° OS</label>
                            <input 
                              type="text"
                              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newOs.os_number}
                              onChange={e => setNewOs({...newOs, os_number: e.target.value})}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase">Montant HT</label>
                            <input 
                              type="number"
                              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newOs.montant}
                              onChange={e => setNewOs({...newOs, montant: e.target.value})}
                            />
                          </div>
                          <div className="flex items-end">
                            <button 
                              onClick={handleCreateOs}
                              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all"
                            >
                              Créer l'OS
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                          <tr>
                            <th className="px-6 py-3 text-left">N°</th>
                            <th className="px-6 py-3 text-left">Lot</th>
                            <th className="px-6 py-3 text-left">Entreprise</th>
                            <th className="px-6 py-3 text-right">Montant</th>
                            <th className="px-6 py-3 text-right w-10"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                          {ordresDeService.map((os) => (
                            <tr key={os.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                              <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white">OS {os.os_number}</td>
                              <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{os.lot}</td>
                              <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{os.entreprise}</td>
                              <td className="px-6 py-4 text-right font-bold text-zinc-900 dark:text-white">{formatCurrency(Number(os.montant_marche_ht || 0))}</td>
                              <td className="px-6 py-4 text-right">
                                <button 
                                  onClick={() => handleDeleteOs(os.id)}
                                  className="p-1 text-zinc-300 hover:text-red-500 transition-colors"
                                >
                                  <IconTrash size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {ordresDeService.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-6 py-8 text-center text-zinc-500 italic">Aucun ordre de service.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Site Reports */}
                {project.is_complete_mission && (
                  <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-4 sm:p-6">
                    <SiteReports project={project} lots_list={project.lots_list || []} />
                  </div>
                )}
              </div>
            )}
            {activeTab === 'RDT' && (
              <div className="space-y-8">
                <Situations projectId={id!} />
                {/* Financial Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Total Marchés</p>
                    <p className="text-2xl font-bold text-zinc-900 dark:text-white">
                      {formatCurrency((project.lots_list || []).reduce((acc, lot) => acc + (lot.base_amount || 0) + (lot.options_amount || 0) + (lot.amendments_amount || 0), 0))}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Total Payé</p>
                    <p className="text-2xl font-bold text-green-600">
                      {formatCurrency(invoices.filter(i => i.status === 'Paid').reduce((acc, i) => acc + i.amount, 0))}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Reste à payer</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {formatCurrency((project.lots_list || []).reduce((acc, lot) => acc + (lot.base_amount || 0) + (lot.options_amount || 0) + (lot.amendments_amount || 0), 0) - invoices.filter(i => i.status === 'Paid').reduce((acc, i) => acc + i.amount, 0))}
                    </p>
                  </div>
                </div>

                {/* Invoices List - Manageable */}
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Factures Entreprises</h3>
                    <button 
                      onClick={() => setIsAddingInvoice(!isAddingInvoice)}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl text-xs font-bold transition-all"
                    >
                      <IconPlus size={14} />
                      Ajouter une facture
                    </button>
                  </div>

                  {isAddingInvoice && (
                    <div className="p-6 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">N° Facture</label>
                          <input 
                            type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newInvoice.invoice_number}
                            onChange={e => setNewInvoice({...newInvoice, invoice_number: e.target.value})}
                            placeholder="ex: F-2024-001"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Montant HT</label>
                          <input 
                            type="number"
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newInvoice.amount}
                            onChange={e => setNewInvoice({...newInvoice, amount: Number(e.target.value)})}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Description</label>
                          <input 
                            type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newInvoice.description}
                            onChange={e => setNewInvoice({...newInvoice, description: e.target.value})}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-3">
                        <button 
                          onClick={() => setIsAddingInvoice(false)}
                          className="px-4 py-2 text-sm font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
                        >
                          Annuler
                        </button>
                        <button 
                          onClick={async () => {
                            try {
                              const res = await fetch('/api/invoices', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  ...newInvoice,
                                  project_id: id,
                                  status: 'Draft',
                                  issue_date: new Date().toISOString(),
                                  due_date: new Date(Date.now() + 30*24*60*60*1000).toISOString(),
                                  created_at: new Date().toISOString()
                                })
                              });
                              if (res.ok) {
                                const data = await res.json();
                                setInvoices(prev => [...prev, data]);
                                setIsAddingInvoice(false);
                                setNewInvoice({ invoice_number: '', amount: 0, description: '' });
                              }
                            } catch (err) {
                              console.error(err);
                            }
                          }}
                          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all"
                        >
                          Ajouter
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left">N° Facture</th>
                          <th className="px-6 py-3 text-left">Date</th>
                          <th className="px-6 py-3 text-left">Statut</th>
                          <th className="px-6 py-3 text-right">Montant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {invoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white">{inv.invoice_number}</td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{new Date(inv.issue_date).toLocaleDateString()}</td>
                            <td className="px-6 py-4">
                              <select 
                                className={cn(
                                  "bg-transparent font-bold text-[10px] uppercase tracking-wider outline-none cursor-pointer",
                                  inv.status === 'Paid' ? "text-green-600" :
                                  inv.status === 'Overdue' ? "text-red-600" :
                                  "text-zinc-500"
                                )}
                                value={inv.status}
                                onChange={async (e) => {
                                  try {
                                    const res = await fetch(`/api/invoices/${inv.id}`, {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ status: e.target.value })
                                    });
                                    if (res.ok) {
                                      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: e.target.value as any } : i));
                                    }
                                  } catch (err) {
                                    console.error(err);
                                  }
                                }}
                              >
                                <option value="Draft">Draft</option>
                                <option value="Sent">Sent</option>
                                <option value="Paid">Paid</option>
                                <option value="Overdue">Overdue</option>
                              </select>
                            </td>
                            <td className="px-6 py-4 text-right font-bold text-zinc-900 dark:text-white">{formatCurrency(inv.amount)}</td>
                          </tr>
                        ))}
                        {invoices.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-6 py-8 text-center text-zinc-500 italic">Aucune facture.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'VISA' && (
              <div className="space-y-8">
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Visas</h3>
                    <button 
                      onClick={async () => {
                        const title = prompt('Titre du visa:');
                        if (!title) return;
                        try {
                          const res = await fetch('/api/visas', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              project_id: id,
                              title,
                              date: new Date().toISOString(),
                              status: 'pending'
                            })
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setVisas(prev => [...prev, data]);
                          }
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl text-xs font-bold transition-all"
                    >
                      <IconPlus size={14} />
                      Ajouter un visa
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left">Titre</th>
                          <th className="px-6 py-3 text-left">Date</th>
                          <th className="px-6 py-3 text-left">Statut</th>
                          <th className="px-6 py-3 text-left">Commentaires</th>
                          <th className="px-6 py-3 text-right w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {visas.map((visa) => (
                          <tr key={visa.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white">{visa.title}</td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{new Date(visa.date).toLocaleDateString()}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                visa.status === 'approved' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                visa.status === 'rejected' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                              )}>
                                {visa.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 max-w-xs truncate">{visa.comments}</td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={async () => {
                                  if (!confirm('Supprimer ce visa ?')) return;
                                  try {
                                    const res = await fetch(`/api/visas/${visa.id}`, { method: 'DELETE' });
                                    if (res.ok) setVisas(prev => prev.filter(v => v.id !== visa.id));
                                  } catch (err) {
                                    console.error(err);
                                  }
                                }}
                                className="p-2 text-zinc-400 hover:text-red-600 transition-colors"
                              >
                                <IconTrash size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {visas.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-6 py-8 text-center text-zinc-500 italic">Aucun visa.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'AOR' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-8">
                    <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                      <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Réserves</h3>
                        <div className="flex items-center gap-2">
                          {plans.length > 0 && (
                            <select 
                              className="bg-zinc-100 dark:bg-zinc-800 border-none rounded-xl px-3 py-2 text-xs font-bold outline-none"
                              value={selectedPlanId || ''}
                              onChange={e => setSelectedPlanId(e.target.value || null)}
                            >
                              <option value="">Sélectionner un plan</option>
                              {plans.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          )}
                          <button 
                            onClick={() => {
                              setIsAddingReserve(!isAddingReserve);
                              if (isAddingReserve) {
                                setIsAnnotating(false);
                                setAnnotationCoords(null);
                              }
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl text-xs font-bold transition-all"
                          >
                            <IconPlus size={14} />
                            {isAddingReserve ? 'Annuler' : 'Créer une réserve'}
                          </button>
                        </div>
                      </div>

                      {isAddingReserve && (
                        <div className="p-6 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800 space-y-4">
                          {selectedPlanId && !annotationCoords && (
                            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl text-blue-600 dark:text-blue-400 text-xs font-medium flex items-center gap-3">
                              <IconPlus size={16} />
                              Cliquez sur le plan à droite pour placer la réserve
                            </div>
                          )}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Intitulé</label>
                          <input 
                            type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newReserve.title}
                            onChange={e => setNewReserve(prev => ({ ...prev, title: e.target.value }))}
                            placeholder="ex: Peinture à reprendre"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Bâtiment</label>
                          <input 
                            type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newReserve.batiment}
                            onChange={e => setNewReserve(prev => ({ ...prev, batiment: e.target.value }))}
                            placeholder="ex: Bâtiment A"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Local</label>
                          <input 
                            type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newReserve.local}
                            onChange={e => setNewReserve(prev => ({ ...prev, local: e.target.value }))}
                            placeholder="ex: Salon"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Statut</label>
                          <select 
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newReserve.status}
                            onChange={e => setNewReserve(prev => ({ ...prev, status: e.target.value as any }))}
                          >
                            <option value="A faire">A faire</option>
                            <option value="En cours">En cours</option>
                            <option value="Levée">Levée</option>
                            <option value="Refusée par l'entreprise">Refusée par l'entreprise</option>
                            <option value="Quitus Transmis">Quitus Transmis</option>
                            <option value="Levée refusée par le MOE">Levée refusée par le MOE</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Lots</label>
                          <Select
                            isMulti
                            options={project?.lots_list?.map(l => ({ value: l.id, label: l.lot_title, color: '#3b82f6' })) || []}
                            styles={colourStyles as any}
                            className="text-sm"
                            onChange={(vals: any) => setNewReserve(prev => ({ ...prev, lots: vals }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Entreprises</label>
                          <Select
                            isMulti
                            options={project?.lots_list?.filter(l => l.contact_name).map(l => ({ value: l.contact_id || l.contact_name, label: l.contact_name, color: '#10b981' })) || []}
                            styles={colourStyles as any}
                            className="text-sm"
                            onChange={(vals: any) => setNewReserve(prev => ({ ...prev, entreprises: vals }))}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Date de création</label>
                          <input 
                            type="date"
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newReserve.created_at}
                            onChange={e => {
                              const newDate = e.target.value;
                              const dueDate = new Date(new Date(newDate).getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                              setNewReserve(prev => ({ ...prev, created_at: newDate, due_date: dueDate }));
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Date d'échéance</label>
                          <input 
                            type="date"
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newReserve.due_date}
                            onChange={e => setNewReserve(prev => ({ ...prev, due_date: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-3">
                        <button 
                          onClick={() => setIsAddingReserve(false)}
                          className="px-4 py-2 text-sm font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
                        >
                          Annuler
                        </button>
                        <button 
                          onClick={async () => {
                            if (!newReserve.title) return;
                            try {
                              const res = await fetch('/api/reserves', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  id: window.crypto.randomUUID(),
                                  project_id: id,
                                  title: newReserve.title,
                                  batiment: newReserve.batiment,
                                  local: newReserve.local,
                                  status: newReserve.status,
                                  lots: JSON.stringify(newReserve.lots.map(l => l.label)),
                                  entreprises: JSON.stringify(newReserve.entreprises.map(e => e.label)),
                                  created_at: newReserve.created_at,
                                  due_date: newReserve.due_date,
                                  plan_id: selectedPlanId,
                                  x: annotationCoords?.x,
                                  y: annotationCoords?.y
                                })
                              });
                              if (res.ok) {
                                const data = await res.json();
                                setReserves(prev => [...prev, data]);
                                setIsAddingReserve(false);
                                setNewReserve({
                                  title: '',
                                  batiment: '',
                                  local: '',
                                  status: 'A faire',
                                  lots: [],
                                  entreprises: [],
                                  created_at: new Date().toISOString().split('T')[0],
                                  due_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                                });
                              }
                            } catch (err) {
                              console.error(err);
                            }
                          }}
                          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all"
                        >
                          Ajouter
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left w-16">N°</th>
                          <th className="px-6 py-3 text-left">Lot / Entreprise</th>
                          <th className="px-6 py-3 text-left">Bâtiment / Local</th>
                          <th className="px-6 py-3 text-left">Intitulé</th>
                          <th className="px-6 py-3 text-left">Statut</th>
                          <th className="px-6 py-3 text-left">Echéance</th>
                          <th className="px-6 py-3 text-right w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {Object.entries(reserves.reduce((acc, res) => {
                          const lots = JSON.parse(res.lots || '[]');
                          const entreprises = JSON.parse(res.entreprises || '[]');
                          const groupKey = lots.length > 0 ? `${lots.join(', ')} / ${entreprises.join(', ')}` : 'Sans Lot / Entreprise';
                          if (!acc[groupKey]) acc[groupKey] = [];
                          acc[groupKey].push(res);
                          return acc;
                        }, {} as Record<string, Reserve[]>)).map(([groupKey, groupReserves]) => (
                          <React.Fragment key={groupKey}>
                            <tr 
                              className="bg-zinc-50/50 dark:bg-zinc-800/20 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/40 transition-colors"
                              onClick={() => setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }))}
                            >
                              <td colSpan={6} className="px-6 py-3">
                                <div className="flex items-center gap-2">
                                  {expandedGroups[groupKey] ? <IconChevronDown size={14} className="text-zinc-400" /> : <IconChevronRight size={14} className="text-zinc-400" />}
                                  <span className="font-bold text-zinc-900 dark:text-white uppercase tracking-wider text-[11px]">{groupKey}</span>
                                  <span className="text-[10px] text-zinc-400 font-normal">({groupReserves.length} réserves)</span>
                                </div>
                              </td>
                            </tr>
                            {expandedGroups[groupKey] && groupReserves.map((res) => (
                              <tr key={res.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group">
                                <td className="px-6 py-4 font-mono text-[10px] text-zinc-500">
                                  #{res.number || '-'}
                                </td>
                                <td className="px-6 py-4 pl-4 text-zinc-400 text-[10px] italic">
                                  Détail réserve
                                </td>
                                <td className="px-6 py-4">
                                  {editingReserveId === res.id ? (
                                    <div className="flex gap-2">
                                      <input 
                                        type="text"
                                        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded p-1 text-xs w-20"
                                        value={editReserveData?.batiment}
                                        onChange={e => setEditReserveData(prev => prev ? ({ ...prev, batiment: e.target.value }) : null)}
                                      />
                                      <input 
                                        type="text"
                                        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded p-1 text-xs w-20"
                                        value={editReserveData?.local}
                                        onChange={e => setEditReserveData(prev => prev ? ({ ...prev, local: e.target.value }) : null)}
                                      />
                                    </div>
                                  ) : (
                                    <span className="text-zinc-600 dark:text-zinc-300">{res.batiment} {res.local && `/ ${res.local}`}</span>
                                  )}
                                </td>
                                <td className="px-6 py-4">
                                  {editingReserveId === res.id ? (
                                    <input 
                                      type="text"
                                      className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded p-1 text-xs"
                                      value={editReserveData?.title}
                                      onChange={e => setEditReserveData(prev => prev ? ({ ...prev, title: e.target.value }) : null)}
                                    />
                                  ) : (
                                    <div className="font-medium text-zinc-900 dark:text-white">{res.title}</div>
                                  )}
                                </td>
                                <td className="px-6 py-4">
                                  {editingReserveId === res.id ? (
                                    <select 
                                      className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded p-1 text-xs"
                                      value={editReserveData?.status}
                                      onChange={e => setEditReserveData(prev => prev ? ({ ...prev, status: e.target.value as any }) : null)}
                                    >
                                      <option value="A faire">A faire</option>
                                      <option value="En cours">En cours</option>
                                      <option value="Levée">Levée</option>
                                      <option value="Refusée par l'entreprise">Refusée par l'entreprise</option>
                                      <option value="Quitus Transmis">Quitus Transmis</option>
                                      <option value="Levée refusée par le MOE">Levée refusée par le MOE</option>
                                    </select>
                                  ) : (
                                    <span className={cn(
                                      "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                      res.status === 'Levée' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                      res.status === 'En cours' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                                      res.status === 'Refusée par l\'entreprise' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                    )}>
                                      {res.status}
                                    </span>
                                  )}
                                </td>
                                <td className="px-6 py-4">
                                  {editingReserveId === res.id ? (
                                    <input 
                                      type="date"
                                      className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded p-1 text-xs"
                                      value={editReserveData?.due_date}
                                      onChange={e => setEditReserveData(prev => prev ? ({ ...prev, due_date: e.target.value }) : null)}
                                    />
                                  ) : (
                                    <div className={cn(
                                      "text-xs font-medium",
                                      new Date(res.due_date) < new Date() && res.status !== 'Levée' ? "text-red-500" : "text-zinc-600 dark:text-zinc-300"
                                    )}>
                                      {new Date(res.due_date).toLocaleDateString()}
                                    </div>
                                  )}
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {editingReserveId === res.id ? (
                                      <>
                                        <button 
                                          onClick={async () => {
                                            if (!editReserveData) return;
                                            try {
                                              const response = await fetch(`/api/reserves/${editReserveData.id}`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify(editReserveData)
                                              });
                                              if (response.ok) {
                                                setReserves(prev => prev.map(r => r.id === editReserveData.id ? editReserveData : r));
                                                setEditingReserveId(null);
                                                setEditReserveData(null);
                                              }
                                            } catch (err) {
                                              console.error(err);
                                            }
                                          }}
                                          className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                                        >
                                          <IconCheck size={14} />
                                        </button>
                                        <button 
                                          onClick={() => {
                                            setEditingReserveId(null);
                                            setEditReserveData(null);
                                          }}
                                          className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                        >
                                          <IconX size={14} />
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button 
                                          onClick={() => {
                                            setEditingReserveId(res.id);
                                            setEditReserveData({ ...res });
                                          }}
                                          className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                        >
                                          <IconFileText size={14} />
                                        </button>
                                        <button 
                                          onClick={async () => {
                                            if (!confirm('Supprimer cette réserve ?')) return;
                                            try {
                                              const response = await fetch(`/api/reserves/${res.id}`, { method: 'DELETE' });
                                              if (response.ok) setReserves(prev => prev.filter(r => r.id !== res.id));
                                            } catch (err) {
                                              console.error(err);
                                            }
                                          }}
                                          className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                        >
                                          <IconTrash size={14} />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        ))}
                        {reserves.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-6 py-8 text-center text-zinc-500 italic">Aucune réserve.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Réceptions</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left">Type</th>
                          <th className="px-6 py-3 text-left">Date</th>
                          <th className="px-6 py-3 text-left">Réserves</th>
                          <th className="px-6 py-3 text-left">Nombre de réserves</th>
                          <th className="px-6 py-3 text-right w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {receptions.map((rec) => (
                          <tr key={rec.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white">{rec.type}</td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{new Date(rec.date).toLocaleDateString()}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                rec.has_reserves ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              )}>
                                {rec.has_reserves ? 'Avec réserves' : 'Sans réserves'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{rec.reserves_count}</td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={async () => {
                                  if (!confirm('Supprimer cette réception ?')) return;
                                  try {
                                    const res = await fetch(`/api/receptions/${rec.id}`, { method: 'DELETE' });
                                    if (res.ok) setReceptions(prev => prev.filter(r => r.id !== rec.id));
                                  } catch (err) {
                                    console.error(err);
                                  }
                                }}
                                className="p-2 text-zinc-400 hover:text-red-600 transition-colors"
                              >
                                <IconTrash size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {receptions.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-6 py-8 text-center text-zinc-500 italic">Aucune réception.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Plans de l'opération */}
                {(() => {
                  const aorPlans = plans.filter(p => p.category === 'AOR' || !p.category);
                  return (
                    <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden mt-8">
                      <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Plans de l'opération</h3>
                        <div className="flex items-center gap-2">
                          <input 
                            type="file" 
                            className="hidden" 
                            ref={planInputRef}
                            onChange={handlePlanUpload}
                          />
                          <button 
                            onClick={() => {
                              setUpdatingPlanId(null);
                              planInputRef.current?.click();
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl text-xs font-bold transition-all"
                          >
                            <IconUpload size={14} />
                            Importer un plan
                          </button>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                            <tr>
                              <th className="px-6 py-3 text-left">Nom</th>
                              <th className="px-6 py-3 text-left w-20">Indice</th>
                              <th className="px-6 py-3 text-left">Date</th>
                              <th className="px-6 py-3 text-right w-24">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {aorPlans
                              .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
                              .map((plan) => (
                              <tr key={plan.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group">
                                <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white">{plan.name}</td>
                                <td className="px-6 py-4">
                                  <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded text-[10px] font-bold">
                                    {plan.index || 'A'}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{new Date(plan.uploaded_at).toLocaleDateString()}</td>
                                <td className="px-6 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button 
                                      onClick={() => {
                                        setUpdatingPlanId(plan.id);
                                        planInputRef.current?.click();
                                      }}
                                      title="Nouvel indice"
                                      className="p-2 text-zinc-400 hover:text-blue-600 transition-colors"
                                    >
                                      <IconRefresh size={16} />
                                    </button>
                                    <a href={plan.file_url} target="_blank" rel="noopener noreferrer" className="p-2 text-zinc-400 hover:text-blue-600 transition-colors">
                                      <IconExternalLink size={16} />
                                    </a>
                                    <button 
                                      onClick={async () => {
                                        if (!confirm('Supprimer ce plan ?')) return;
                                        try {
                                          const res = await fetch(`/api/plans/${plan.id}`, { method: 'DELETE' });
                                          if (res.ok) setPlans(prev => prev.filter(p => p.id !== plan.id));
                                        } catch (err) {
                                          console.error(err);
                                        }
                                      }}
                                      title="Supprimer"
                                      className="p-2 text-zinc-400 hover:text-red-600 transition-colors"
                                    >
                                      <IconTrash size={16} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {aorPlans.length === 0 && (
                              <tr>
                                <td colSpan={4} className="px-6 py-8 text-center text-zinc-500 italic">Aucun plan de l'opération.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
              </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
