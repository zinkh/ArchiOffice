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
  IconChevronUp,
  IconFileText,
  IconFileCheck,
  IconFlag,
  IconCalculator,
  IconHammer,
  IconBook,
  IconCheck,
  IconX,
  IconMessageDots,
  IconRefresh,
  IconSend,
  IconClipboardList,
  IconFileDownload,
  IconAlertCircle,
  IconAlertTriangle,
  IconFilePlus,
  IconCurrencyEuro,
  IconReceipt,
  IconEdit,
  IconInfoCircle,
  IconReceipt2,
  IconFileDescription,
  IconUsersGroup,
  IconRubberStamp,
  IconTools,
  IconReportMoney,
  IconClipboardCheck,
  IconCalendarStats,
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { Table, Header, HeaderRow, Body, Row, HeaderCell, Cell } from '@table-library/react-table-library/table';
import { useTheme } from '@table-library/react-table-library/theme';
import { formatCurrency, cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import type { Project, Milestone, Invoice, ProjectCategory, Specification, OrdreDeService, Visa, Reception, Tender, Reserve, Plan } from '../types';
import { useUser } from '../UserContext';
import { GeoportailMap, GoogleMap, RNBInfo } from '../components/LocationMaps';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { HistoricalMonuments } from '../components/HistoricalMonuments';
import { PlanAnnotator } from '../components/PlanAnnotator';
import ACTModule from '../components/ACTModule';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import { ContactModal } from '../components/ContactModal';
import { CadastreDownload } from '../components/CadastreDownload';
import { CompanyAutocomplete } from '../components/CompanyAutocomplete';
import ConstructionReportModule from '../components/ConstructionReportModule';
import SiteReports from '../components/SiteReports';
import MilestoneGantt from '../components/MilestoneGantt';
import { ProTab } from '../components/pro/ProTab';
import Situations from './Situations';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { StatTile, StatTileColor } from '../components/ui/StatTile';
import { PillTabs, PillTabItem } from '../components/ui/PillTabs';

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

const FormField = ({ label, value, onChange, type = 'text', options = [], required = false, id }: any) => (
  <div className="space-y-1">
    <label className="block text-[10px] font-bold text-[var(--tblr-muted)] uppercase tracking-wider">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    {type === 'select' ? (
      <select 
        className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-medium"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select {label}</option>
        {options.map((opt: string) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    ) : type === 'textarea' ? (
      <textarea 
        className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-medium min-h-[80px] resize-none"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    ) : type === 'checkbox' ? (
      <div className="flex items-center gap-2 h-[42px]">
        <input 
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
        />
        <span className="text-sm text-[var(--tblr-muted)]">Oui</span>
      </div>
    ) : (
      <input 
        id={id}
        type={type}
        className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-medium"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )}
  </div>
);

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
  const [projectMembers, setProjectMembers] = useState<any[]>([]);
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
  const [linkedContratsMoe, setLinkedContratsMoe] = useState<any[]>([]);
  const [notesHonoraires, setNotesHonoraires] = useState<any[]>([]);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [editingNote, setEditingNote] = useState<any | null>(null);
  const [noteForm, setNoteForm] = useState<any>(null);

  const [newOs, setNewOs] = useState({
    title: '',
    os_number: '',
    lot: '',
    entreprise: '',
    maitrise_oeuvre: '',
    montant_devis_presente: '',
    date_emission: new Date().toISOString().slice(0, 10),
    emetteur_os: '',
    destinataire_os: '',
    delai_execution: '',
    delai_unit: 'jours',
    objet: '',
  });

  // AR modal state
  const [arOsTarget, setArOsTarget] = useState<OrdreDeService | null>(null);
  const [arForm, setArForm] = useState({ date_ar: new Date().toISOString().slice(0, 10), date_execution: '', notes_ar: '' });
  const [arSaving, setArSaving] = useState(false);

  const [newOsMoe, setNewOsMoe] = useState({
    title: '',
    os_number: '',
    montant_devis_presente: '',
    objet: 'extension_mission' as string,
    description: '',
    origine_demande: 'maitrise_ouvrage' as string,
    date: new Date().toISOString().split('T')[0],
    date_signature: '',
    incidences_delais_type: 'non' as 'non' | 'oui',
    incidences_delais_details: '',
    delai_execution: '' as string,
  });

  const [isAddingOs, setIsAddingOs] = useState(false);
  const [isAddingOsMoe, setIsAddingOsMoe] = useState(false);

  // VISA modal state
  const [isVisaModalOpen, setIsVisaModalOpen] = useState(false);
  const [editingVisa, setEditingVisa] = useState<Visa | null>(null);
  const [visaForm, setVisaForm] = useState({ title: '', date: new Date().toISOString().split('T')[0], status: 'pending' as Visa['status'], comments: '' });
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
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

  // Reception PV form state
  const [showPvForm, setShowPvForm] = useState(false);
  const [editingReceptionId, setEditingReceptionId] = useState<string | null>(null);
  const [expandedPvId, setExpandedPvId] = useState<string | null>(null);
  const defaultPvForm = () => ({
    reference_pv: '',
    type: 'provisoire' as 'provisoire' | 'definitive',
    date: new Date().toISOString().split('T')[0],
    lieu: '',
    date_limite_levee: '',
    has_reserves: false,
    reserves_count: 0,
    signataires: [] as { nom: string; role: string }[],
    observations: '',
    pv_valide: false,
    reserves_list: [] as { id: string; title: string; batiment: string; local: string; lots: string; entreprises: string; due_date: string; status: string }[],
  });
  const [pvForm, setPvForm] = useState(defaultPvForm());

  // DOE documents state
  const [doeDocuments, setDoeDocuments] = useState<any[]>([]);
  const doeInputRef = useRef<HTMLInputElement>(null);
  const [doeUploading, setDoeUploading] = useState(false);

  useEffect(() => {
    if (project && !project.is_chantier && ['ACT', 'DET', 'RDT', 'VISA', 'AOR'].includes(activeTab)) {
      setActiveTab('INFOS');
    }
  }, [project?.is_chantier, activeTab]);

  useEffect(() => {
    if (activeTab === 'HONOS' && id) {
      fetch('/api/contrats_moe')
        .then(r => r.json())
        .then((all: any[]) => setLinkedContratsMoe((all || []).filter((c: any) => c.project_id === id)))
        .catch(() => {});
      fetch(`/api/notes_honoraires?project_id=${id}`)
        .then(r => r.json())
        .then((data: any[]) => setNotesHonoraires(data || []))
        .catch(() => {});
    }
  }, [activeTab, id]);

  useEffect(() => {
    if (id) {
      fetchFullProject();
      fetchCategories();
      fetchContacts();
      fetchTeam();
      fetchProjectTenders();
      fetchProjectMembers();
    }
  }, [id]);

  useEffect(() => {
    if (activeTab === 'AOR' && id) {
      fetchDoeDocuments();
    }
  }, [activeTab, id]);

  const fetchProjectMembers = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/projects/${id}/members`);
      if (res.ok) { const data = await res.json(); setProjectMembers(Array.isArray(data) ? data : []); }
    } catch (err) { console.error('Failed to fetch project members:', err); }
  };

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

  const fetchDoeDocuments = async () => {
    try {
      const res = await fetch(`/api/documents?project_id=${id}&doc_type=DOE`);
      if (res.ok) {
        const data = await res.json();
        setDoeDocuments(data.filter((d: any) => d.doc_type === 'DOE'));
      }
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
          if (Array.isArray(data)) setMilestones(data.map((m: any) => ({ ...m, completed: !!m.completed })));
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
          project_id: id,
          os_number: newOs.os_number,
          title: newOs.title,
          lot: newOs.lot,
          entreprise: newOs.entreprise || newOs.destinataire_os,
          maitrise_oeuvre_adresse: newOs.maitrise_oeuvre,
          montant_devis_presente: Number(newOs.montant_devis_presente) || null,
          date: newOs.date_emission || new Date().toISOString().slice(0, 10),
          date_emission: newOs.date_emission || new Date().toISOString().slice(0, 10),
          emetteur_os: newOs.emetteur_os || newOs.maitrise_oeuvre,
          destinataire_os: newOs.destinataire_os || newOs.entreprise,
          delai_execution: Number(newOs.delai_execution) || null,
          delai_unit: newOs.delai_unit,
          objet: newOs.objet,
          status: 'draft',
          type: 'travaux'
        })
      });
      if (res.ok) {
        await fetchOrdresDeService();
        setNewOs({ title: '', os_number: '', lot: '', entreprise: '', maitrise_oeuvre: project?.project_manager || '', montant_devis_presente: '', date_emission: new Date().toISOString().slice(0, 10), emetteur_os: '', destinataire_os: '', delai_execution: '', delai_unit: 'jours', objet: '' });
        setIsAddingOs(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateOsMoe = async () => {
    if (!id || !newOsMoe.title || !newOsMoe.os_number) return;
    try {
      const res = await fetch('/api/ordres_de_service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: id,
          os_number: newOsMoe.os_number,
          title: newOsMoe.title,
          objet: newOsMoe.objet || null,
          description: newOsMoe.description || null,
          origine_demande: newOsMoe.origine_demande || null,
          date: newOsMoe.date || new Date().toISOString().split('T')[0],
          date_signature: newOsMoe.date_signature || null,
          incidences_delais_type: newOsMoe.incidences_delais_type,
          incidences_delais_details: newOsMoe.incidences_delais_details || null,
          delai_execution: newOsMoe.delai_execution ? Number(newOsMoe.delai_execution) : null,
          montant_devis_presente: Number(newOsMoe.montant_devis_presente) || null,
          status: 'draft',
          type: 'contrat_moe',
        })
      });
      if (res.ok) {
        await fetchOrdresDeService();
        setNewOsMoe({ title: '', os_number: '', montant_devis_presente: '', objet: 'extension_mission', description: '', origine_demande: 'maitrise_ouvrage', date: new Date().toISOString().split('T')[0], date_signature: '', incidences_delais_type: 'non', incidences_delais_details: '', delai_execution: '' });
        setIsAddingOsMoe(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const generateAvenantPdf = async (os: OrdreDeService, projectName: string, honorairesInitiaux: number, cumulAvenants: number) => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, margin = 20;
    const TYPE_LABELS: Record<string, string> = {
      extension_mission: "Extension de mission",
      modification_programme: "Modification de programme",
      revision_honoraires: "Révision des honoraires",
      imprevus: "Imprévus / Aléas",
      autre: "Autre",
    };
    const ORIGINE_LABELS: Record<string, string> = {
      maitrise_ouvrage: "Maîtrise d'ouvrage", maitrise_oeuvre: "Maîtrise d'œuvre",
      aleas: "Aléas", autres: "Autres",
    };

    // Header
    doc.setFillColor(32, 107, 196);
    doc.rect(0, 0, W, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text("AVENANT AU CONTRAT DE MAÎTRISE D'ŒUVRE", margin, 12);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text(`N° Avenant : ${os.os_number}`, margin, 21);
    doc.text(`Date : ${os.date ? new Date(os.date).toLocaleDateString('fr-FR') : '—'}`, W - margin, 21, { align: 'right' });

    // Sub-header
    doc.setFillColor(245, 247, 251);
    doc.rect(0, 30, W, 12, 'F');
    doc.setTextColor(80, 100, 130); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text(`Projet : ${projectName}`, margin, 38);
    doc.text(TYPE_LABELS[os.objet || ''] || (os.objet || 'Avenant'), W - margin, 38, { align: 'right' });

    let y = 50;
    const section = (title: string) => {
      doc.setFillColor(240, 245, 255);
      doc.rect(margin, y, W - 2 * margin, 7, 'F');
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(32, 107, 196);
      doc.text(title, margin + 3, y + 5); y += 11;
    };
    const row = (label: string, value: string, x = margin, w = W - 2 * margin) => {
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(120, 130, 150);
      doc.text(label.toUpperCase(), x, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 40);
      const lines = doc.splitTextToSize(value || '—', w - 2);
      doc.text(lines, x, y + 5); y += 5 + lines.length * 4 + 3;
    };

    // Identification
    section('1. IDENTIFICATION');
    const col = (W - 2 * margin - 5) / 2;
    const y0 = y; row('Objet', os.title, margin, col); const y1 = y;
    y = y0; row('Type d\'avenant', TYPE_LABELS[os.objet || ''] || '—', margin + col + 5, col); y = Math.max(y, y1);
    const y2 = y; row('Origine de la demande', ORIGINE_LABELS[os.origine_demande || ''] || '—', margin, col); const y3 = y;
    y = y2; row('Date de l\'avenant', os.date ? new Date(os.date).toLocaleDateString('fr-FR') : '—', margin + col + 5, col); y = Math.max(y, y3);

    // Motif
    if (os.description) { section('2. MOTIF ET DESCRIPTION'); row('Motif détaillé', os.description); }

    // Financier
    section('3. IMPACT FINANCIER');
    const montantPres = Number(os.montant_devis_presente) || 0;
    const montantAcc = Number(os.montant_devis_accepte ?? os.montant_devis_presente) || 0;
    autoTable(doc, {
      startY: y, margin: { left: margin, right: margin },
      head: [['', 'Montant HT']],
      body: [
        ['Honoraires initiaux du contrat', honorairesInitiaux > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(honorairesInitiaux) : '—'],
        ['Cumul avenants précédents', cumulAvenants - montantAcc > 0 ? '+ ' + new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cumulAvenants - montantAcc) : '—'],
        ['Montant présenté par le MOE', montantPres > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(montantPres) : '—'],
        ['Montant accepté par le MOA', os.status === 'approved' && montantAcc > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(montantAcc) : (os.status === 'approved' ? '—' : 'En attente')],
        ['Nouveaux honoraires révisés', honorairesInitiaux + cumulAvenants > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(honorairesInitiaux + cumulAvenants) : '—'],
      ],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [32, 107, 196], textColor: 255 },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      bodyStyles: { fillColor: false },
      alternateRowStyles: { fillColor: [248, 250, 255] },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // Délais
    if (os.incidences_delais_type === 'oui') {
      section('4. IMPACT SUR LES DÉLAIS');
      row('Incidence sur les délais', os.incidences_delais_details || 'Oui');
      if (os.delai_execution) row('Prolongation', `${os.delai_execution} jours`);
    }

    // Signatures
    if (y > 240) { doc.addPage(); y = 20; }
    y += 8;
    doc.setFillColor(245, 247, 251);
    doc.rect(margin, y, W - 2 * margin, 40, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(60, 70, 90);
    doc.text('SIGNATURES', W / 2, y + 7, { align: 'center' });
    const sigY = y + 15;
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    ['Le Maître d\'Ouvrage', 'Le Maître d\'Œuvre'].forEach((label, i) => {
      const x = margin + i * (col + 5);
      doc.text(label, x + col / 2, sigY, { align: 'center' });
      doc.text(os.date_signature ? `Signé le : ${new Date(os.date_signature).toLocaleDateString('fr-FR')}` : 'Date et signature :', x + 5, sigY + 12);
    });

    const n = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFontSize(7); doc.setTextColor(160, 170, 185);
      doc.text(`Avenant N° ${os.os_number} — ${projectName} — Page ${i}/${n}`, W / 2, 292, { align: 'center' });
    }
    doc.save(`Avenant_${os.os_number.replace(/\s+/g, '_')}_${projectName.replace(/\s+/g, '_')}.pdf`);
  };

  const handleUpdateOsStatus = async (osId: string, newStatus: OrdreDeService['status'], montantAccepte?: number) => {
    if (newStatus === 'approved') {
      const os = ordresDeService.find(o => o.id === osId);
      if (os) { setArOsTarget(os); setArForm({ date_ar: new Date().toISOString().slice(0, 10), date_execution: '', notes_ar: '' }); }
      return;
    }
    try {
      const os = ordresDeService.find(o => o.id === osId);
      if (!os) return;
      const body: Partial<OrdreDeService> = { ...os, status: newStatus };
      if (montantAccepte !== undefined) body.montant_devis_accepte = montantAccepte;
      const res = await fetch(`/api/ordres_de_service/${osId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        setOrdresDeService(prev => prev.map(o =>
          o.id === osId ? { ...o, status: newStatus } : o
        ));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleArSubmit = async () => {
    if (!arOsTarget || !arForm.date_ar) return;
    setArSaving(true);
    try {
      const res = await fetch(`/api/ordres_de_service/${arOsTarget.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved', date_ar: arForm.date_ar, date_execution: arForm.date_execution || null, notes_ar: arForm.notes_ar || null })
      });
      if (res.ok) {
        setOrdresDeService(prev => prev.map(o =>
          o.id === arOsTarget.id ? { ...o, status: 'approved', date_ar: arForm.date_ar, date_execution: arForm.date_execution, notes_ar: arForm.notes_ar } : o
        ));
        setArOsTarget(null);
      }
    } catch (err) { console.error(err); }
    finally { setArSaving(false); }
  };

  const generateOsPdf = async (os: OrdreDeService) => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setFillColor(30, 64, 175);
    doc.rect(0, 0, 210, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text('ORDRE DE SERVICE', 14, 12);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`N° ${os.os_number}`, 14, 20);
    doc.text(`Projet : ${project?.name ?? ''}`, 80, 14);
    doc.text(`Date : ${os.date_emission ?? os.date ?? ''}`, 80, 20);
    const statusLabels: Record<string, string> = { draft: 'Brouillon', submitted: 'Émis', approved: 'AR reçu', rejected: 'Annulé' };
    doc.text(`Statut : ${statusLabels[os.status] ?? os.status}`, 80, 26);
    doc.setTextColor(30, 30, 30);
    let y = 36;
    autoTable(doc, {
      startY: y,
      head: [['Parties', '']],
      body: [
        ['Émetteur (MOE)', os.emetteur_os ?? project?.project_manager ?? '—'],
        ['Destinataire (Entreprise)', os.destinataire_os ?? os.entreprise ?? '—'],
        ['Lot', os.lot ?? '—'],
      ],
      theme: 'grid',
      headStyles: { fillColor: [30, 64, 175], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70 } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
    if (os.objet ?? os.title) {
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text('OBJET', 14, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      const lines = doc.splitTextToSize(os.objet ?? os.title ?? '', 182);
      doc.text(lines, 14, y); y += lines.length * 5 + 4;
    }
    autoTable(doc, {
      startY: y,
      head: [['Champ', 'Valeur']],
      body: [
        ['Délai d\'exécution', os.delai_execution ? `${os.delai_execution} ${os.delai_unit ?? 'jours'}` : '—'],
        ['N° Marché', os.march_number ?? '—'],
        ['Montant présenté HT', os.montant_devis_presente != null ? `${Number(os.montant_devis_presente).toLocaleString('fr-FR')} €` : '—'],
        ['Montant accepté HT', os.montant_devis_accepte != null ? `${Number(os.montant_devis_accepte).toLocaleString('fr-FR')} €` : '—'],
      ],
      theme: 'striped',
      headStyles: { fillColor: [30, 64, 175], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70 } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
    if (y > 220) { doc.addPage(); y = 20; }
    const sigY = Math.max(y, 230);
    doc.setFillColor(245, 245, 245);
    doc.rect(14, sigY, 82, 30, 'F'); doc.rect(114, sigY, 82, 30, 'F');
    doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text('Maître d\'œuvre (Émetteur)', 55, sigY + 6, { align: 'center' });
    doc.text('Entreprise (Destinataire)', 155, sigY + 6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text('Signature & cachet :', 18, sigY + 14); doc.text('Signature & cachet :', 118, sigY + 14);
    doc.text(`Date : ${os.date_emission ?? ''}`, 18, sigY + 22);
    doc.text(`Date d'AR : ${os.date_ar ?? '_______'}`, 118, sigY + 22);
    if (os.status === 'approved' && os.date_ar) {
      const arY = sigY + 36;
      doc.setFillColor(240, 253, 244); doc.rect(14, arY, 182, 20, 'F');
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(22, 163, 74);
      doc.text('ACCUSÉ DE RÉCEPTION', 14, arY + 7);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
      doc.text(`Reçu le : ${os.date_ar}  |  Exécution prévue le : ${os.date_execution ?? '—'}`, 14, arY + 14);
    }
    const n = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150);
      doc.text(`OS N° ${os.os_number} — ${project?.name ?? ''} — Page ${i}/${n}`, 105, 290, { align: 'center' });
    }
    doc.save(`OS_${os.os_number}_${(project?.name ?? '').replace(/\s+/g, '_')}.pdf`);
  };

  const generatePvPdf = async (rec: Reception, pvReserves: Reserve[], projectName: string, signataires: { nom: string; role: string }[]) => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const blue: [number, number, number] = [30, 64, 175];
    // Header
    doc.setFillColor(...blue);
    doc.rect(0, 0, 210, 32, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text('PROCÈS-VERBAL DE RÉCEPTION', 105, 13, { align: 'center' });
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`${rec.reference_pv ? `Réf. : ${rec.reference_pv}  |  ` : ''}${rec.type === 'definitive' ? 'Réception Définitive' : 'Réception Provisoire'}`, 105, 22, { align: 'center' });
    doc.setTextColor(30, 30, 30);
    let y = 40;
    // Section opération
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('Opération', 14, y); y += 5;
    doc.setDrawColor(200); doc.line(14, y, 196, y); y += 5;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text(`Projet : ${projectName}`, 14, y); y += 5;
    doc.text(`Date de réception : ${new Date(rec.date).toLocaleDateString('fr-FR')}`, 14, y); y += 5;
    if (rec.lieu) { doc.text(`Lieu : ${rec.lieu}`, 14, y); y += 5; }
    // Date limite levée
    if (rec.date_limite_levee) {
      const dlimit = new Date(rec.date_limite_levee);
      const isUrgent = (dlimit.getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000;
      if (isUrgent) { doc.setFillColor(255, 237, 213); doc.rect(14, y - 2, 182, 10, 'F'); doc.setTextColor(194, 65, 12); }
      else { doc.setTextColor(30, 30, 30); }
      doc.setFont('helvetica', 'bold');
      doc.text(`Date limite de levée des réserves : ${dlimit.toLocaleDateString('fr-FR')}${isUrgent ? ' ⚠ Délai proche' : ''}`, 14, y + 5);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
      y += 14;
    }
    y += 3;
    // Signataires
    if (signataires.length > 0) {
      doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.text('Présents / Signataires', 14, y); y += 5;
      doc.setDrawColor(200); doc.line(14, y, 196, y); y += 4;
      autoTable(doc, {
        startY: y,
        head: [['Nom', 'Rôle']],
        body: signataires.map(s => [s.nom, s.role]),
        theme: 'grid',
        headStyles: { fillColor: blue, textColor: 255, fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }
    // Réserves
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('État des réserves', 14, y); y += 5;
    doc.setDrawColor(200); doc.line(14, y, 196, y); y += 4;
    if (pvReserves.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [['N°', 'Bâtiment / Local', 'Intitulé', 'Lots', 'Entreprises', 'Statut', 'Échéance']],
        body: pvReserves.map(r => [
          `#${r.number || '—'}`,
          `${r.batiment}${r.local ? ' / ' + r.local : ''}`,
          r.title,
          JSON.parse(r.lots || '[]').join(', ') || '—',
          JSON.parse(r.entreprises || '[]').join(', ') || '—',
          r.status,
          new Date(r.due_date).toLocaleDateString('fr-FR'),
        ]),
        theme: 'striped',
        headStyles: { fillColor: blue, textColor: 255, fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        columnStyles: { 2: { cellWidth: 40 }, 5: { cellWidth: 28 } },
        margin: { left: 14, right: 14 },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.row.raw[5] === 'Levée') {
            data.cell.styles.textColor = [22, 163, 74];
          } else if (data.section === 'body' && (data.row.raw[5] === 'A faire' || data.row.raw[5] === 'En cours')) {
            data.cell.styles.textColor = [180, 100, 0];
          }
        }
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    } else {
      doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.setTextColor(120);
      doc.text('Aucune réserve enregistrée pour cette réception.', 14, y + 5);
      y += 14; doc.setTextColor(30, 30, 30);
    }
    // Observations
    if (rec.observations) {
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 30);
      doc.text('Observations', 14, y); y += 5;
      doc.setDrawColor(200); doc.line(14, y, 196, y); y += 4;
      doc.setFontSize(9); doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(rec.observations, 182);
      doc.text(lines, 14, y); y += lines.length * 5 + 6;
    }
    // Signatures
    if (y > 230) { doc.addPage(); y = 20; }
    const sigY = Math.max(y + 10, 240);
    doc.setFillColor(245, 245, 245);
    doc.rect(14, sigY, 82, 30, 'F'); doc.rect(114, sigY, 82, 30, 'F');
    doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text('Maître d\'œuvre (MOE)', 55, sigY + 7, { align: 'center' });
    doc.text('Maître d\'ouvrage (MOA)', 155, sigY + 7, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text('Signature & cachet :', 18, sigY + 17);
    doc.text('Signature & cachet :', 118, sigY + 17);
    doc.text(`Date : ${new Date(rec.date).toLocaleDateString('fr-FR')}`, 18, sigY + 25);
    doc.text(`Date : ${new Date(rec.date).toLocaleDateString('fr-FR')}`, 118, sigY + 25);
    // Footer
    const n = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150);
      doc.text(`${rec.reference_pv || 'PV'} — ${projectName} — Page ${i}/${n}`, 105, 290, { align: 'center' });
    }
    doc.save(`PV_${(rec.reference_pv || rec.id).replace(/\s+/g, '_')}_${projectName.replace(/\s+/g, '_')}.pdf`);
  };

  const handleDeleteOs = async (osId: string) => {
    if (!confirm('Supprimer cet ordre de service ?')) return;
    try {
      const res = await fetch(`/api/ordres_de_service/${osId}`, { method: 'DELETE' });
      if (res.ok) {
        setOrdresDeService(prev => prev.filter(os => os.id !== osId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const osStatusBadge = (status: OrdreDeService['status']) => {
    const map: Record<OrdreDeService['status'], { label: string; cls: string }> = {
      draft:     { label: 'Brouillon', cls: 'bg-zinc-100 text-[var(--tblr-muted)] dark:bg-zinc-800 dark:text-[var(--tblr-muted)]' },
      submitted: { label: 'Émis',      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
      approved:  { label: 'AR reçu',   cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
      rejected:  { label: 'Annulé',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
    };
    const { label, cls } = map[status] ?? map.draft;
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${cls}`}>{label}</span>;
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
          className="flex items-center gap-2 text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors"
        >
          <IconArrowLeft size={20} />
          {t('view_all')} {t('projects')}
        </button>
        <div className="flex items-center gap-3">
          {currentUser?.system_role === 'admin' && (
            <button 
              onClick={handleDelete}
              className="p-2.5 text-[var(--tblr-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
              title={t('delete')}
            >
              <IconTrash size={20} />
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-3 sm:px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-50"
          >
            {isSaving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <IconDeviceFloppy size={20} />
            )}
            <span className="hidden sm:inline">{t('commit_changes')}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Main Column */}
        <div className="space-y-8">
          
          {/* Tab Navigation */}
          <PillTabs
            className="mb-6"
            activeId={activeTab}
            onChange={setActiveTab}
            tabs={([
              { id: 'INFOS', label: 'INFOS', icon: IconInfoCircle },
              { id: 'HONOS', label: 'HONOS', icon: IconReceipt2 },
              { id: 'PRO', label: 'PRO', icon: IconFileDescription },
              { id: 'ACT', label: 'ACT', icon: IconUsersGroup },
              { id: 'VISA', label: 'VISA', icon: IconRubberStamp },
              { id: 'DET', label: 'DET', icon: IconTools },
              { id: 'RDT', label: 'RDT', icon: IconReportMoney },
              { id: 'AOR', label: 'AOR', icon: IconClipboardCheck },
              { id: 'SIT', label: 'SIT', icon: IconCalendarStats },
            ] as PillTabItem[]).filter(tab =>
              !(['ACT', 'VISA', 'DET', 'RDT', 'AOR', 'SIT'].includes(tab.id) && !project.is_chantier)
            )}
          />
          <div className="tab-content mt-8">
            {activeTab === 'HONOS' && (
              <div className="space-y-8">

                {/* ── Contrat MOE lié ────────────────────────────────────── */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconFileText}
                    title="Contrat de Maîtrise d'Œuvre"
                    description="Contrat(s) associés à ce projet depuis la boîte à outils MOE"
                    action={
                      <a href="/contrats" className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all">
                        <IconPlus size={14} />
                        Gérer les contrats
                      </a>
                    }
                  />
                  {linkedContratsMoe.length === 0 ? (
                    <div className="p-8 text-center text-[var(--tblr-muted)] italic text-sm">
                      Aucun contrat MOE lié à ce projet.{' '}
                      <a href="/contrats" className="text-blue-500 hover:underline">Créer un contrat</a> et associez-le à ce projet.
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--tblr-border)]">
                      {linkedContratsMoe.map((c: any) => {
                        const TYPE_LABELS: Record<string, string> = {
                          construction_neuve: 'Construction neuve', rehabilitation: 'Réhabilitation',
                          concours: "Concours d'architecture", amo: 'Mission AMO', diagnostic: 'Diagnostic', urbanisme: 'Urbanisme',
                        };
                        const STATUS_COLORS: Record<string, string> = {
                          Brouillon: 'bg-zinc-100 text-[var(--tblr-muted)]', Envoyé: 'bg-blue-100 text-blue-700',
                          Signé: 'bg-green-100 text-green-700', Résilié: 'bg-red-100 text-red-700',
                        };
                        const missionsIncluses = (c.missions_list || []).filter((m: any) => m.incluse);
                        return (
                          <div key={c.id} className="p-5 flex items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                {c.numero && <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)]">{c.numero}</span>}
                                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider", STATUS_COLORS[c.status] || 'bg-zinc-100 text-[var(--tblr-muted)]')}>{c.status}</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600">{TYPE_LABELS[c.type_contrat] || c.type_contrat}</span>
                              </div>
                              <p className="font-semibold text-[var(--tblr-text)] text-sm">{c.intitule_projet || c.project_name || '—'}</p>
                              <div className="flex flex-wrap gap-4 mt-1 text-xs text-[var(--tblr-muted)]">
                                {c.mode_honoraires === 'forfait' && c.montant_honoraires && <span className="text-blue-600 font-bold">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(c.montant_honoraires)} HT</span>}
                                {c.mode_honoraires === 'pourcentage' && c.taux_honoraires && <span className="text-blue-600 font-bold">{c.taux_honoraires} % des travaux</span>}
                                {c.indice_revision && <span>Indice : {c.indice_revision}</span>}
                                {c.date_debut && <span>Du {new Date(c.date_debut).toLocaleDateString('fr-FR')}</span>}
                                {c.date_fin && <span>au {new Date(c.date_fin).toLocaleDateString('fr-FR')}</span>}
                              </div>
                              {missionsIncluses.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {missionsIncluses.map((m: any) => (
                                    <span key={m.id} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 font-medium">
                                      {m.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()}{m.pct ? ` ${m.pct}%` : ''}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── Honoraires MOE ─────────────────────────────────────── */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader icon={IconCurrencyEuro} title="Honoraires de Maîtrise d'Œuvre" />
                  <div className="p-6 space-y-6">
                    {/* KPIs */}
                    {(() => {
                      const honInit = Number(project.remuneration) || 0;
                      const moeAvenants = ordresDeService.filter(o => o.type === 'contrat_moe');
                      const cumul = moeAvenants.filter(o => o.status === 'approved').reduce((s, o) => s + (Number(o.montant_devis_accepte ?? o.montant_devis_presente) || 0), 0);
                      const honRevises = honInit + cumul;
                      const encaisses = invoices.filter(i => i.status === 'Paid').reduce((s, i) => s + i.amount, 0);
                      const restant = honRevises - encaisses;
                      return (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                          {[
                            { label: 'Honoraires initiaux', value: honInit, color: 'blue', sub: 'Contrat MOE signé' },
                            { label: 'Cumul avenants', value: cumul, color: cumul >= 0 ? 'green' : 'red', sub: `${moeAvenants.filter(o => o.status === 'approved').length} avenant(s) approuvé(s)` },
                            { label: 'Honoraires révisés', value: honRevises, color: 'indigo', sub: 'Total contractuel' },
                            { label: 'Restant à percevoir', value: restant, color: restant > 0 ? 'amber' : 'green', sub: `${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(encaisses)} encaissés` },
                          ].map(kpi => (
                            <StatTile
                              key={kpi.label}
                              label={kpi.label}
                              color={kpi.color as StatTileColor}
                              value={new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(kpi.value)}
                              sub={kpi.sub}
                            />
                          ))}
                        </div>
                      );
                    })()}

                    {/* Champ rémunération éditable */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[var(--tblr-border)]">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">Honoraires initiaux HT (€)</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">€</span>
                          <input type="number"
                            className="w-full pl-8 pr-4 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                            value={project.remuneration || 0}
                            onChange={e => setProject({...project, remuneration: Number(e.target.value)})} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">Coût travaux prévisionnel HT (€)</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">€</span>
                          <input type="number"
                            className="w-full pl-8 pr-4 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                            value={project.construction_cost || 0}
                            onChange={e => setProject({...project, construction_cost: Number(e.target.value)})} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">Taux honoraires (%)</label>
                        <div className="relative">
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">%</span>
                          <input type="number" readOnly
                            className="w-full pl-4 pr-8 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none text-[var(--tblr-text)] font-bold opacity-70 cursor-default"
                            value={project.construction_cost && project.remuneration
                              ? ((project.remuneration / project.construction_cost) * 100).toFixed(2)
                              : '—'} />
                        </div>
                      </div>
                    </div>

                    {/* Répartition par phases */}
                    {(() => {
                      const DEFAULT_PHASES = [
                        { id: 'esquisse', name: 'ESQ', pct: 10 }, { id: 'aps', name: 'APS', pct: 12 },
                        { id: 'apd', name: 'APD', pct: 14 }, { id: 'pro', name: 'PRO', pct: 18 },
                        { id: 'act', name: 'ACT', pct: 7 },  { id: 'visa', name: 'VISA', pct: 7 },
                        { id: 'det', name: 'DET', pct: 25 }, { id: 'aor', name: 'AOR', pct: 7 },
                      ];
                      const honRevises = (Number(project.remuneration) || 0) +
                        ordresDeService.filter(o => o.type === 'contrat_moe' && o.status === 'approved').reduce((s, o) => s + (Number(o.montant_devis_accepte ?? o.montant_devis_presente) || 0), 0);
                      if (honRevises <= 0) return null;
                      return (
                        <div className="pt-2 border-t border-[var(--tblr-border)]">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-3">Répartition indicative par phase (base mission complète)</p>
                          <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
                            {DEFAULT_PHASES.map(phase => (
                              <div key={phase.id} className="text-center p-3 rounded-lg bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)]">
                                <p className="text-[10px] font-black uppercase text-[var(--tblr-muted)]">{phase.name}</p>
                                <p className="text-xs font-bold text-blue-600 dark:text-blue-400 mt-1">{phase.pct} %</p>
                                <p className="text-[10px] text-[var(--tblr-muted)] mt-0.5">{new Intl.NumberFormat('fr-FR', { notation: 'compact', currency: 'EUR', style: 'currency' }).format(honRevises * phase.pct / 100)}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* ── Avenants Contrat MOE ───────────────────────────────── */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconClipboardList}
                    title="Avenants Contrat MOE"
                    description={(() => {
                      const moeApprouves = ordresDeService
                        .filter(o => o.type === 'contrat_moe' && o.status === 'approved')
                        .reduce((acc, o) => acc + (Number(o.montant_devis_accepte) || Number(o.montant_devis_presente) || 0), 0);
                      const honorairesInitiaux = Number(project.remuneration) || 0;
                      if (moeApprouves !== 0 || honorairesInitiaux !== 0) return (
                        <span className="font-semibold" style={{ color: 'var(--tblr-primary)' }}>
                          Honoraires révisés : {formatCurrency(honorairesInitiaux + moeApprouves)}
                          {moeApprouves !== 0 && <span className="text-green-600 dark:text-green-400"> ({moeApprouves >= 0 ? '+' : ''}{formatCurrency(moeApprouves)})</span>}
                        </span>
                      );
                      return undefined;
                    })()}
                    action={linkedContratsMoe.length === 0 ? (
                      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-lg text-xs font-bold">
                        <IconAlertCircle size={14} />
                        Contrat requis pour créer un avenant
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsAddingOsMoe(!isAddingOsMoe)}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all"
                      >
                        <IconPlus size={14} />
                        Nouvel avenant
                      </button>
                    )}
                  />
                  {isAddingOsMoe && (
                    <div className="p-6 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-5">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">N° Avenant *</label>
                          <input type="text" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.os_number} onChange={e => setNewOsMoe({...newOsMoe, os_number: e.target.value})}
                            placeholder={`A${String((ordresDeService.filter(o => o.type === 'contrat_moe').length + 1)).padStart(2, '0')}`} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Type d'avenant</label>
                          <select className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.objet} onChange={e => setNewOsMoe({...newOsMoe, objet: e.target.value})}>
                            <option value="extension_mission">Extension de mission</option>
                            <option value="modification_programme">Modification de programme</option>
                            <option value="revision_honoraires">Révision des honoraires</option>
                            <option value="imprevus">Imprévus / Aléas</option>
                            <option value="autre">Autre</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Date</label>
                          <input type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.date} onChange={e => setNewOsMoe({...newOsMoe, date: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Origine</label>
                          <select className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.origine_demande} onChange={e => setNewOsMoe({...newOsMoe, origine_demande: e.target.value})}>
                            <option value="maitrise_ouvrage">Maîtrise d'ouvrage</option>
                            <option value="maitrise_oeuvre">Maîtrise d'œuvre</option>
                            <option value="aleas">Aléas</option>
                            <option value="autres">Autres</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Intitulé de l'avenant *</label>
                          <input type="text" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.title} onChange={e => setNewOsMoe({...newOsMoe, title: e.target.value})}
                            placeholder="ex: Extension de mission OPC + coordination sécurité" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Motif détaillé</label>
                          <textarea rows={2} className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            value={newOsMoe.description} onChange={e => setNewOsMoe({...newOsMoe, description: e.target.value})}
                            placeholder="Contexte, raisons justifiant l'avenant…" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Impact honoraires HT (€)</label>
                          <input type="number" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.montant_devis_presente} onChange={e => setNewOsMoe({...newOsMoe, montant_devis_presente: e.target.value})}
                            placeholder="ex: 3 500 (négatif si réduction)" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Date signature MOA</label>
                          <input type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.date_signature} onChange={e => setNewOsMoe({...newOsMoe, date_signature: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Impact sur délais</label>
                          <select className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.incidences_delais_type} onChange={e => setNewOsMoe({...newOsMoe, incidences_delais_type: e.target.value as 'non' | 'oui'})}>
                            <option value="non">Sans incidence</option>
                            <option value="oui">Avec incidence</option>
                          </select>
                        </div>
                        {newOsMoe.incidences_delais_type === 'oui' && (
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Prolongation (jours)</label>
                            <input type="number" min={0} className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newOsMoe.delai_execution} onChange={e => setNewOsMoe({...newOsMoe, delai_execution: e.target.value})} placeholder="nb de jours" />
                          </div>
                        )}
                      </div>
                      {newOsMoe.incidences_delais_type === 'oui' && (
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Justification de l'incidence sur les délais</label>
                          <input type="text" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.incidences_delais_details} onChange={e => setNewOsMoe({...newOsMoe, incidences_delais_details: e.target.value})}
                            placeholder="ex: Complexification du programme nécessitant une phase PRO étendue" />
                        </div>
                      )}
                      <div className="flex justify-end gap-3">
                        <button onClick={() => setIsAddingOsMoe(false)} className="px-4 py-2 text-sm font-bold text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors">Annuler</button>
                        <button onClick={handleCreateOsMoe} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all">Créer l'avenant</button>
                      </div>
                    </div>
                  )}
                  {/* Barre récap cumulée */}
                  {(() => {
                    const moeAvenants = ordresDeService.filter(o => o.type === 'contrat_moe');
                    const approuves = moeAvenants.filter(o => o.status === 'approved');
                    const cumul = approuves.reduce((s, o) => s + (Number(o.montant_devis_accepte ?? o.montant_devis_presente) || 0), 0);
                    const honInit = Number(project.remuneration) || 0;
                    if (moeAvenants.length === 0) return null;
                    return (
                      <div className="mx-6 mb-4 mt-2 flex items-center gap-6 text-xs px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40">
                        <div><span className="text-blue-400 font-bold uppercase tracking-wider text-[9px]">Honoraires initiaux</span><br/><span className="font-black text-blue-700 dark:text-blue-300 text-sm">{formatCurrency(honInit)}</span></div>
                        <div className="text-blue-300">+</div>
                        <div><span className="text-blue-400 font-bold uppercase tracking-wider text-[9px]">Cumul avenants approuvés</span><br/><span className={cn("font-black text-sm", cumul >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>{cumul >= 0 ? '+' : ''}{formatCurrency(cumul)}</span></div>
                        <div className="text-blue-300">=</div>
                        <div><span className="text-blue-400 font-bold uppercase tracking-wider text-[9px]">Honoraires révisés</span><br/><span className="font-black text-blue-700 dark:text-blue-300 text-sm">{formatCurrency(honInit + cumul)}</span></div>
                        <div className="ml-auto text-blue-400 text-[10px]">{approuves.length}/{moeAvenants.length} approuvé{approuves.length > 1 ? 's' : ''}</div>
                      </div>
                    );
                  })()}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-4 py-3 text-left">N°</th>
                          <th className="px-4 py-3 text-left">Type</th>
                          <th className="px-4 py-3 text-left">Intitulé</th>
                          <th className="px-4 py-3 text-left">Date</th>
                          <th className="px-4 py-3 text-right">Présenté HT</th>
                          <th className="px-4 py-3 text-right">Accepté HT</th>
                          <th className="px-4 py-3 text-center">Délais</th>
                          <th className="px-4 py-3 text-center">Statut</th>
                          <th className="px-4 py-3 text-center">Actions</th>
                          <th className="px-4 py-3 w-16"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--tblr-border)]">
                        {(() => {
                          const TYPE_SHORT: Record<string, string> = {
                            extension_mission: 'Extension mission', modification_programme: 'Modif. programme',
                            revision_honoraires: 'Révision hon.', imprevus: 'Imprévus', autre: 'Autre',
                          };
                          const honorairesInitiaux = Number(project.remuneration) || 0;
                          const moeAvenants = ordresDeService.filter(o => o.type === 'contrat_moe');
                          const cumulTotal = moeAvenants.filter(o => o.status === 'approved').reduce((s, o) => s + (Number(o.montant_devis_accepte ?? o.montant_devis_presente) || 0), 0);
                          return moeAvenants.map((os) => (
                            <tr key={os.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors group">
                              <td className="px-4 py-3 font-mono font-black text-[var(--tblr-text)] whitespace-nowrap text-xs">Av.{os.os_number}</td>
                              <td className="px-4 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400">{TYPE_SHORT[os.objet || ''] || os.objet || '—'}</span></td>
                              <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200 max-w-[180px]">
                                <p className="truncate font-medium">{os.title}</p>
                                {os.description && <p className="text-[10px] text-[var(--tblr-muted)] truncate mt-0.5">{os.description}</p>}
                              </td>
                              <td className="px-4 py-3 text-[var(--tblr-muted)] text-xs whitespace-nowrap">
                                {os.date ? new Date(os.date).toLocaleDateString('fr-FR') : '—'}
                                {os.date_signature && <div className="text-[10px] text-green-600">Signé le {new Date(os.date_signature).toLocaleDateString('fr-FR')}</div>}
                              </td>
                              <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{os.montant_devis_presente != null ? formatCurrency(Number(os.montant_devis_presente)) : '—'}</td>
                              <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                                {os.status === 'approved'
                                  ? <span className={cn(Number(os.montant_devis_accepte ?? os.montant_devis_presente) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600')}>{formatCurrency(Number(os.montant_devis_accepte ?? os.montant_devis_presente ?? 0))}</span>
                                  : <span className="text-zinc-300">—</span>}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {os.incidences_delais_type === 'oui'
                                  ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">{os.delai_execution ? `+${os.delai_execution}j` : 'Oui'}</span>
                                  : <span className="text-zinc-300 text-[10px]">—</span>}
                              </td>
                              <td className="px-4 py-3 text-center">{osStatusBadge(os.status)}</td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {os.status === 'draft' && <button onClick={() => handleUpdateOsStatus(os.id, 'submitted')} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 text-[10px] font-bold transition-all"><IconSend size={11} /> Soumettre</button>}
                                  {os.status === 'submitted' && (<>
                                    <button onClick={() => handleUpdateOsStatus(os.id, 'approved', os.montant_devis_presente ?? undefined)} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 text-[10px] font-bold transition-all"><IconCheck size={11} /> Approuver</button>
                                    <button onClick={() => handleUpdateOsStatus(os.id, 'rejected')} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 text-[10px] font-bold transition-all"><IconX size={11} /> Rejeter</button>
                                  </>)}
                                  {os.status === 'rejected' && <button onClick={() => handleUpdateOsStatus(os.id, 'draft')} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-[10px] font-bold transition-all"><IconRefresh size={11} /> Rouvrir</button>}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button title="Exporter PDF avenant" onClick={() => generateAvenantPdf(os, project.name, honorairesInitiaux, cumulTotal)} className="p-1 text-zinc-300 hover:text-blue-500 transition-colors"><IconFileDownload size={14} /></button>
                                  <button onClick={() => handleDeleteOs(os.id)} className="p-1 text-zinc-300 hover:text-red-500 transition-colors"><IconTrash size={14} /></button>
                                </div>
                              </td>
                            </tr>
                          ));
                        })()}
                        {ordresDeService.filter(o => o.type === 'contrat_moe').length === 0 && (
                          <tr><td colSpan={10} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucun avenant. Cliquez sur "Nouvel avenant" pour commencer.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Notes d'honoraires ──────────────────────────────────── */}
                {(() => {
                  const DEFAULT_PHASES = [
                    { id: 'esquisse', name: 'ESQ — Esquisse' },
                    { id: 'aps', name: 'APS — Avant-Projet Sommaire' },
                    { id: 'apd', name: 'APD — Avant-Projet Détaillé' },
                    { id: 'pro', name: 'PRO — Projet' },
                    { id: 'act', name: 'ACT — Assistance Contrats de Travaux' },
                    { id: 'visa', name: 'VISA' },
                    { id: 'det', name: 'DET — Direction de l\'Exécution des Travaux' },
                    { id: 'aor', name: 'AOR — Assistance à la Réception' },
                  ];
                  const honRevises = (Number(project.remuneration) || 0) +
                    ordresDeService.filter(o => o.type === 'contrat_moe' && o.status === 'approved').reduce((s: number, o: any) => s + (Number(o.montant_devis_accepte ?? o.montant_devis_presente) || 0), 0);
                  const contrat = linkedContratsMoe.find((c: any) => c.status === 'Signé') || linkedContratsMoe[0];
                  const cotraitants: any[] = contrat?.cotraitants || [];
                  const sousTraitants: any[] = contrat?.sous_traitants || [];

                  const initNoteForm = () => ({
                    numero: `NH-${String(notesHonoraires.length + 1).padStart(2, '0')}`,
                    date: new Date().toISOString().split('T')[0],
                    objet: '',
                    status: 'Brouillon',
                    tva_rate: 20,
                    phases: DEFAULT_PHASES.map(p => ({ phase_id: p.id, phase_name: p.name, avancement_pct: 0, montant_phase: 0 })),
                    cotraitants_facturation: cotraitants.map((ct: any) => ({ contact_id: ct.contact_id, nom: ct.contact_name || ct.specialty || '', montant_ht: 0, tva_rate: 20, montant_ttc: 0 })),
                    sous_traitants_facturation: sousTraitants.map((st: any) => ({ contact_id: st.contact_id, nom: st.contact_name || st.specialty || '', montant_ht: 0, tva_rate: 20, montant_ttc: 0, paiement_direct_moa: !!st.paiement_direct_moa })),
                    notes: '',
                  });

                  const totalNotesHT = notesHonoraires.reduce((s: number, n: any) => s + (n.montant_ht || 0), 0);
                  const totalNotesTTC = notesHonoraires.reduce((s: number, n: any) => s + (n.montant_ttc || 0), 0);

                  const saveNote = async () => {
                    if (!noteForm || !id) return;
                    const montant_ht = (noteForm.phases || []).reduce((s: number, p: any) => s + (Number(p.montant_phase) || 0), 0);
                    const montant_tva = montant_ht * (noteForm.tva_rate || 20) / 100;
                    const montant_ttc = montant_ht + montant_tva;
                    const payload = { ...noteForm, project_id: id, contrat_id: contrat?.id || null, montant_ht, montant_tva, montant_ttc };
                    if (editingNote?.id) {
                      await fetch(`/api/notes_honoraires/${editingNote.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    } else {
                      await fetch('/api/notes_honoraires', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    }
                    const data = await (await fetch(`/api/notes_honoraires?project_id=${id}`)).json();
                    setNotesHonoraires(data || []);
                    setIsAddingNote(false);
                    setEditingNote(null);
                    setNoteForm(null);
                  };

                  const deleteNote = async (noteId: string) => {
                    if (!confirm('Supprimer cette note d\'honoraires ?')) return;
                    await fetch(`/api/notes_honoraires/${noteId}`, { method: 'DELETE' });
                    setNotesHonoraires(notesHonoraires.filter((n: any) => n.id !== noteId));
                  };

                  const STATUS_NOTE_COLORS: Record<string, string> = {
                    Brouillon: 'bg-zinc-100 text-[var(--tblr-muted)]',
                    Envoyée: 'bg-blue-100 text-blue-700',
                    Payée: 'bg-green-100 text-green-700',
                  };

                  return (
                    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <CardHeader
                        icon={IconReceipt}
                        title="Notes d'Honoraires"
                        description="Acomptes sur honoraires de maîtrise d'œuvre avec avancement par phase"
                        action={
                          <button
                            onClick={() => {
                              setNoteForm(initNoteForm());
                              setEditingNote(null);
                              setIsAddingNote(true);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all"
                          >
                            <IconPlus size={14} />
                            Nouvelle note
                          </button>
                        }
                      />

                      {/* KPIs notes */}
                      {notesHonoraires.length > 0 && (
                        <div className="px-6 pt-4 pb-2 grid grid-cols-3 gap-3">
                          {[
                            { label: 'Montant HT facturé', value: totalNotesHT, color: 'blue' },
                            { label: 'Montant TTC facturé', value: totalNotesTTC, color: 'indigo' },
                            { label: 'Restant à facturer', value: Math.max(0, honRevises - totalNotesHT), color: 'amber' },
                          ].map(kpi => (
                            <StatTile
                              key={kpi.label}
                              label={kpi.label}
                              color={kpi.color as StatTileColor}
                              value={new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(kpi.value)}
                            />
                          ))}
                        </div>
                      )}

                      {/* Formulaire nouvelle note */}
                      {isAddingNote && noteForm && (
                        <div className="p-6 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-5">
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">N° Note</label>
                              <input type="text" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                value={noteForm.numero} onChange={e => setNoteForm({ ...noteForm, numero: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Date</label>
                              <input type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                value={noteForm.date} onChange={e => setNoteForm({ ...noteForm, date: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">TVA (%)</label>
                              <input type="number" min={0} max={30} className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                value={noteForm.tva_rate} onChange={e => setNoteForm({ ...noteForm, tva_rate: parseFloat(e.target.value) || 20 })} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Statut</label>
                              <select className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                value={noteForm.status} onChange={e => setNoteForm({ ...noteForm, status: e.target.value })}>
                                {['Brouillon', 'Envoyée', 'Payée'].map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Objet</label>
                            <input type="text" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={noteForm.objet} onChange={e => setNoteForm({ ...noteForm, objet: e.target.value })}
                              placeholder="ex : Acompte sur honoraires ESQ + APS" />
                          </div>

                          {/* Avancement par phase */}
                          <div>
                            <p className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase mb-3">Avancement par phase — Agence</p>
                            <div className="space-y-2">
                              {(noteForm.phases || []).map((phase: any, idx: number) => {
                                const basePhase = DEFAULT_PHASES.find((p: any) => p.id === phase.phase_id);
                                const phasePct = (contrat?.missions_list || []).find((m: any) => m.id === phase.phase_id)?.pct || 0;
                                const montantPhaseBase = honRevises * phasePct / 100;
                                const montantAvancement = montantPhaseBase * (phase.avancement_pct || 0) / 100;
                                return (
                                  <div key={phase.phase_id} className="flex items-center gap-3 p-2 rounded-lg bg-white dark:bg-zinc-900 border border-[var(--tblr-border)]">
                                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 w-48 flex-shrink-0">{basePhase?.name || phase.phase_name}</span>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      <input type="number" min={0} max={100} step={5}
                                        className="w-16 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded p-1 text-sm text-center outline-none focus:ring-2 focus:ring-blue-500"
                                        value={phase.avancement_pct}
                                        onChange={e => {
                                          const pct = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                                          const newPhases = [...noteForm.phases];
                                          const mp = montantPhaseBase * pct / 100;
                                          newPhases[idx] = { ...phase, avancement_pct: pct, montant_phase: parseFloat(mp.toFixed(2)) };
                                          setNoteForm({ ...noteForm, phases: newPhases });
                                        }} />
                                      <span className="text-xs text-[var(--tblr-muted)]">%</span>
                                    </div>
                                    <div className="flex items-center gap-1 text-xs text-[var(--tblr-muted)] flex-shrink-0">
                                      <span>→</span>
                                      <input type="number" min={0}
                                        className="w-28 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded p-1 text-sm text-right outline-none focus:ring-2 focus:ring-blue-500"
                                        value={phase.montant_phase}
                                        onChange={e => {
                                          const newPhases = [...noteForm.phases];
                                          newPhases[idx] = { ...phase, montant_phase: parseFloat(e.target.value) || 0 };
                                          setNoteForm({ ...noteForm, phases: newPhases });
                                        }} />
                                      <span>€ HT</span>
                                    </div>
                                    {montantAvancement > 0 && phase.montant_phase === 0 && (
                                      <button type="button" className="text-[10px] text-blue-500 hover:text-blue-700 flex-shrink-0" onClick={() => {
                                        const newPhases = [...noteForm.phases];
                                        newPhases[idx] = { ...phase, montant_phase: parseFloat(montantAvancement.toFixed(2)) };
                                        setNoteForm({ ...noteForm, phases: newPhases });
                                      }}>Auto</button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="mt-2 flex items-center justify-between text-xs font-bold text-zinc-700 dark:text-zinc-300 px-2">
                              <span>Total agence HT</span>
                              <span className="text-blue-600">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((noteForm.phases || []).reduce((s: number, p: any) => s + (Number(p.montant_phase) || 0), 0))}</span>
                            </div>
                          </div>

                          {/* Cotraitants */}
                          {(noteForm.cotraitants_facturation || []).length > 0 && (
                            <div>
                              <p className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase mb-3">Cotraitants (hors comptabilité agence)</p>
                              <div className="space-y-2">
                                {(noteForm.cotraitants_facturation || []).map((ct: any, idx: number) => (
                                  <div key={idx} className="flex items-center gap-3 p-2 rounded-lg bg-white dark:bg-zinc-900 border border-[var(--tblr-border)]">
                                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex-1">{ct.nom || 'Cotraitant'}</span>
                                    <input type="number" min={0}
                                      className="w-28 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded p-1 text-sm text-right outline-none focus:ring-2 focus:ring-blue-500"
                                      value={ct.montant_ht}
                                      onChange={e => {
                                        const ht = parseFloat(e.target.value) || 0;
                                        const newCts = [...noteForm.cotraitants_facturation];
                                        newCts[idx] = { ...ct, montant_ht: ht, montant_ttc: ht * (1 + ct.tva_rate / 100) };
                                        setNoteForm({ ...noteForm, cotraitants_facturation: newCts });
                                      }} />
                                    <span className="text-xs text-[var(--tblr-muted)]">€ HT</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Sous-traitants */}
                          {(noteForm.sous_traitants_facturation || []).length > 0 && (
                            <div>
                              <p className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase mb-3">Sous-traitants</p>
                              <div className="space-y-2">
                                {(noteForm.sous_traitants_facturation || []).map((st: any, idx: number) => (
                                  <div key={idx} className="flex items-center gap-3 p-2 rounded-lg bg-white dark:bg-zinc-900 border border-[var(--tblr-border)]">
                                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex-1">{st.nom || 'Sous-traitant'}</span>
                                    <input type="number" min={0}
                                      className="w-28 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded p-1 text-sm text-right outline-none focus:ring-2 focus:ring-blue-500"
                                      value={st.montant_ht}
                                      onChange={e => {
                                        const ht = parseFloat(e.target.value) || 0;
                                        const newSts = [...noteForm.sous_traitants_facturation];
                                        newSts[idx] = { ...st, montant_ht: ht, montant_ttc: ht * (1 + st.tva_rate / 100) };
                                        setNoteForm({ ...noteForm, sous_traitants_facturation: newSts });
                                      }} />
                                    <span className="text-xs text-[var(--tblr-muted)]">€ HT</span>
                                    {st.paiement_direct_moa && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold flex-shrink-0">Paiement direct MOA</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex gap-2 justify-end pt-2 border-t border-[var(--tblr-border)]">
                            <button onClick={() => { setIsAddingNote(false); setNoteForm(null); setEditingNote(null); }} className="px-4 py-2 text-sm font-bold text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors">Annuler</button>
                            <button onClick={saveNote} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all">
                              {editingNote ? 'Mettre à jour' : 'Créer la note'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Liste des notes */}
                      {notesHonoraires.length === 0 && !isAddingNote ? (
                        <div className="p-8 text-center text-[var(--tblr-muted)] italic text-sm">
                          Aucune note d'honoraires. Cliquez sur "Nouvelle note" pour créer un acompte.
                        </div>
                      ) : (
                        <div className="divide-y divide-[var(--tblr-border)]">
                          {notesHonoraires.map((note: any) => {
                            const phases = (note.phases || []).filter((p: any) => p.montant_phase > 0);
                            return (
                              <div key={note.id} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      {note.numero && <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)]">{note.numero}</span>}
                                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider', STATUS_NOTE_COLORS[note.status] || 'bg-zinc-100 text-[var(--tblr-muted)]')}>{note.status}</span>
                                      {note.date && <span className="text-[10px] text-[var(--tblr-muted)]">{new Date(note.date).toLocaleDateString('fr-FR')}</span>}
                                    </div>
                                    {note.objet && <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium">{note.objet}</p>}
                                    {phases.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {phases.map((p: any) => (
                                          <span key={p.phase_id} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 font-medium">
                                            {p.phase_name.split('—')[0].trim()} {p.avancement_pct}%
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    <div className="flex gap-4 mt-1 text-xs text-[var(--tblr-muted)]">
                                      <span className="font-bold text-blue-600">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(note.montant_ht)} HT</span>
                                      <span>{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(note.montant_ttc)} TTC</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button onClick={() => {
                                      setEditingNote(note);
                                      setNoteForm({ ...note });
                                      setIsAddingNote(true);
                                    }} className="p-1 text-zinc-300 hover:text-blue-500 transition-colors"><IconEdit size={14} /></button>
                                    <button onClick={() => deleteNote(note.id)} className="p-1 text-zinc-300 hover:text-red-500 transition-colors"><IconTrash size={14} /></button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

              </div>
            )}
            {activeTab === 'PRO' && <div className="mt-4"><ProTab projectId={id!} projectName={project?.name} /></div>}
            {activeTab === 'INFOS' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-8">
                    {/* Hero Section - Editable */}
                    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <div className="aspect-[21/9] relative overflow-hidden bg-zinc-100 dark:bg-zinc-800 group">
                        {project.image_url ? (
                          <img src={project.image_url} alt={project.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[var(--tblr-muted)]">
                            <IconUpload size={48} />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <label className="cursor-pointer bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-6 py-3 rounded-lg font-bold border border-white/30 transition-all">
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
                            <ContactAutocomplete 
                              contacts={contacts.filter(c => c.category === 'Client' || c.category === 'Maitre d\'ouvrage')}
                              value={contacts.find(c => (c.company_name || `${c.first_name} ${c.last_name}`) === project.client)?.id || ''}
                              onChange={id => {
                                const contact = contacts.find(c => c.id === id);
                                if (contact) {
                                  setProject({...project, client: contact.company_name || `${contact.first_name} ${contact.last_name}`});
                                }
                              }}
                              onAddNew={() => setIsContactModalOpen(true)}
                              placeholder="Client Name"
                              inputClassName="bg-white/10 border border-white/20 text-white placeholder:text-white/60"
                              addNewLabel="Add New Client"
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
                            <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">Description</label>
                            <textarea 
                              className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] min-h-[120px] resize-none"
                              value={project.description}
                              onChange={e => setProject({...project, description: e.target.value})}
                              placeholder="Project description..."
                            />
                          </div>
                          <div className="space-y-6">
                            <div className="space-y-2">
                              <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">Chef de projet</label>
                              <input 
                                type="text"
                                className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                                value={project.project_manager || ''}
                                onChange={e => setProject({...project, project_manager: e.target.value})}
                                placeholder="Manager Name"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 pt-8 border-t border-[var(--tblr-border)]">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">Surface (m²)</label>
                            <input 
                              type="number"
                              className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                              value={project.surface || 0}
                              onChange={e => setProject({...project, surface: Number(e.target.value)})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">Coût Travaux</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">€</span>
                              <input 
                                type="number"
                                className="w-full pl-8 pr-4 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                                value={project.construction_cost || 0}
                                onChange={e => setProject({...project, construction_cost: Number(e.target.value)})}
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">Rémunération</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">€</span>
                              <input 
                                type="number"
                                className="w-full pl-8 pr-4 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                                value={project.remuneration || 0}
                                onChange={e => setProject({...project, remuneration: Number(e.target.value)})}
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">Progression (%)</label>
                            <input 
                              type="number"
                              min="0"
                              max="100"
                              className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                              value={project.progression || 0}
                              onChange={e => setProject({...project, progression: Number(e.target.value)})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">Code Projet</label>
                            <input 
                              type="text"
                              className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                              value={project.project_code || ''}
                              onChange={e => setProject({...project, project_code: e.target.value})}
                              placeholder="PRJ-001"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Location & Maps - Editable */}
                    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <div className="p-6 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--tblr-surface-2)' }}>
                            <IconExternalLink size={20} style={{ color: 'var(--tblr-primary)' }} />
                          </div>
                          <h3 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>Localisation</h3>
                        </div>
                        <div className="mt-4">
                          <AddressAutocomplete 
                            value={project.address || ''}
                            onChange={addr => setProject(prev => prev ? ({...prev, address: addr}) : null)}
                          />
                        </div>
                      </div>
                      {project.address && (
                        <div className="space-y-6 p-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <RNBInfo address={project.address} />
                            <CadastreDownload address={project.address} />
                            <HistoricalMonuments address={project.address} />
                          </div>
                          <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-hidden border border-[var(--tblr-border)]">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-zinc-200 dark:bg-zinc-800 h-[400px]">
                              <div className="bg-white dark:bg-zinc-900 relative">
                                <GeoportailMap address={project.address} />
                                <div className="absolute top-4 left-4 px-3 py-1.5 bg-white/90 dark:bg-black/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-wider border border-[var(--tblr-border)] shadow-sm">Cadastre</div>
                              </div>
                              <div className="bg-white dark:bg-zinc-900 relative">
                                <GoogleMap address={project.address} />
                                <div className="absolute top-4 left-4 px-3 py-1.5 bg-white/90 dark:bg-black/90 backdrop-blur-sm rounded-lg text-[10px] font-bold uppercase tracking-wider border border-[var(--tblr-border)] shadow-sm">OpenStreetMap</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Milestones section moved into INFOS tab */}
                      <div className="p-6 rounded-lg space-y-6" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-text)' }}>Milestones</h3>
                          <button 
                            onClick={() => setIsAddingMilestone(!isAddingMilestone)}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all"
                          >
                            <IconPlus size={14} />
                            Ajouter un milestone
                          </button>
                        </div>

                        {isAddingMilestone && (
                          <div className="p-6 bg-[var(--tblr-surface-2)] rounded-lg border border-[var(--tblr-border)] space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Titre</label>
                                <input 
                                  type="text"
                                  className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                  value={newMilestoneTitle}
                                  onChange={e => setNewMilestoneTitle(e.target.value)}
                                  placeholder="ex: Permis de construire"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Date</label>
                                <input 
                                  type="date"
                                  className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                  value={newMilestoneDate}
                                  onChange={e => setNewMilestoneDate(e.target.value)}
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-3">
                              <button 
                                onClick={() => setIsAddingMilestone(false)}
                                className="px-4 py-2 text-sm font-bold text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors"
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
                                    m.completed ? "text-green-500" : "text-zinc-300 hover:text-[var(--tblr-muted)]"
                                  )}
                                >
                                  {m.completed ? <IconCircleCheck size={20} /> : <IconCircle size={20} />}
                                </button>
                                <div>
                                  <p className={cn("text-sm font-medium", m.completed ? "text-[var(--tblr-muted)] line-through" : "text-[var(--tblr-text)]")}>
                                    {m.title}
                                  </p>
                                  <div className="flex items-center gap-1 text-[10px] text-[var(--tblr-muted)]">
                                    <IconCalendar size={10} />
                                    {new Date(m.due_date).toLocaleDateString()}
                                  </div>
                                </div>
                              </div>
                              <button 
                                onClick={() => {
                                  if(confirm('Supprimer ce jalon ?')) {
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
                            <p className="text-xs text-[var(--tblr-muted)] italic text-center py-4">Aucun jalon défini.</p>
                          )}
                        </div>
                      </div>

                      {/* Additional Details from Proposal */}
                      <div className="p-6 rounded-lg space-y-8" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                        <div className="space-y-4">
                          <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2 uppercase tracking-wider">
                            <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">01</span>
                            Détails Client
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField label="Entreprise?" type="checkbox" value={project.is_entreprise} onChange={(v: any) => setProject(prev => prev ? ({...prev, is_entreprise: v}) : null)} />
                            <CompanyAutocomplete 
                              label="Nom Société" 
                              value={project.nom_societe || ''} 
                              onChange={(val, details) => {
                                if (details) {
                                  setProject(prev => prev ? ({
                                    ...prev,
                                    nom_societe: val,
                                    rcs: details.siren || details.siret || '',
                                    adresse_client: details.address || '',
                                    cp_client: details.zipcode || '',
                                    ville_client: details.city || '',
                                    is_entreprise: true
                                  }) : null);
                                } else {
                                  setProject(prev => prev ? ({...prev, nom_societe: val}) : null);
                                }
                              }} 
                            />
                            <FormField label="RCS / SIRET" value={project.rcs} onChange={(v: any) => setProject(prev => prev ? ({...prev, rcs: v}) : null)} />
                            <FormField label="Représentant" value={project.representant} onChange={(v: any) => setProject(prev => prev ? ({...prev, representant: v}) : null)} />
                            <FormField label="Qualité" value={project.qualite} onChange={(v: any) => setProject(prev => prev ? ({...prev, qualite: v}) : null)} />
                          </div>
                          {/* Facturation électronique (Factur-X, Chorus Pro, Super PDP) */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                            <FormField label="SIRET client (Factur-X)" value={project.client_siret} onChange={(v: any) => setProject(prev => prev ? ({...prev, client_siret: v}) : null)} />
                            <FormField label="N° TVA client" value={project.client_vat_number} onChange={(v: any) => setProject(prev => prev ? ({...prev, client_vat_number: v}) : null)} />
                            <FormField label="Maîtrise d'ouvrage publique" type="checkbox" value={project.is_public_client} onChange={(v: any) => setProject(prev => prev ? ({...prev, is_public_client: v}) : null)} />
                          </div>
                          <p className="text-[11px] text-[var(--tblr-muted)] -mt-4">
                            La maîtrise d'ouvrage publique détermine si les factures et situations de ce projet passent par Chorus Pro (marchés publics) ou par Super PDP (marchés privés).
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
                              <FormField 
                                label="Adresse Client" 
                                value={project.adresse_client || ''} 
                                onChange={(v: any) => setProject(prev => prev ? ({...prev, adresse_client: v}) : null)} 
                              />
                              <FormField 
                                label="Code Postal Client" 
                                value={project.cp_client || ''} 
                                onChange={(v: any) => setProject(prev => prev ? ({...prev, cp_client: v}) : null)} 
                              />
                              <FormField 
                                label="Ville Client" 
                                value={project.ville_client || ''} 
                                onChange={(v: any) => setProject(prev => prev ? ({...prev, ville_client: v}) : null)} 
                              />
                            </div>
                            <FormField label="Téléphone" value={project.telephone} onChange={(v: any) => setProject(prev => prev ? ({...prev, telephone: v}) : null)} />
                            <FormField label="Portable" value={project.portable} onChange={(v: any) => setProject(prev => prev ? ({...prev, portable: v}) : null)} />
                            <FormField label="Adresse Mail" type="email" value={project.email_client} onChange={(v: any) => setProject(prev => prev ? ({...prev, email_client: v}) : null)} />
                          </div>
                        </div>

                        <div className="space-y-4 pt-8 border-t border-[var(--tblr-border)]">
                          <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2 uppercase tracking-wider">
                            <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">02</span>
                            Spécificités du Projet & Terrain
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField label="Référence" value={project.reference} onChange={(v: any) => setProject(prev => prev ? ({...prev, reference: v}) : null)} />
                            <FormField label="Ind" value={project.ind} onChange={(v: any) => setProject(prev => prev ? ({...prev, ind: v}) : null)} />
                            <FormField label="Détail du Projet" type="textarea" value={project.projet_detail} onChange={(v: any) => setProject(prev => prev ? ({...prev, projet_detail: v}) : null)} />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="md:col-span-3 space-y-4">
                              <AddressAutocomplete 
                                label="Adresse Complète Terrain" 
                                value={project.adresse_terrain || ''} 
                                onChange={(val: string) => {
                                  setProject(prev => {
                                    if (!prev) return null;
                                    const updates: any = { adresse_terrain: val };
                                    if (!val) {
                                      updates.cp_ville_terrain = '';
                                      updates.site_postcode = '';
                                      updates.site_city = '';
                                      updates.ban_id_terrain = '';
                                      updates.city_code_terrain = '';
                                    }
                                    return { ...prev, ...updates };
                                  });
                                }}
                                onSelect={(details) => {
                                  setProject(prev => prev ? ({
                                    ...prev, 
                                    adresse_terrain: details.fullAddress,
                                    cp_ville_terrain: `${details.zipcode || ''} ${details.city || ''}`.trim(),
                                    site_postcode: details.zipcode || '',
                                    site_city: details.city || '',
                                    ban_id_terrain: details.banId || '',
                                    city_code_terrain: details.cityCode || ''
                                  }) : null);
                                }} 
                              />
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField label="Code Postal Terrain" value={project.site_postcode} onChange={(v: any) => setProject(prev => prev ? ({...prev, site_postcode: v}) : null)} />
                                <FormField label="Ville Terrain" value={project.site_city} onChange={(v: any) => setProject(prev => prev ? ({...prev, site_city: v}) : null)} />
                              </div>
                            </div>
                            <FormField label="Référence Cadastrale" value={project.ref_cadastrale} onChange={(v: any) => setProject(prev => prev ? ({...prev, ref_cadastrale: v}) : null)} />
                            <FormField label="Zone PLU" value={project.zone_plu} onChange={(v: any) => setProject(prev => prev ? ({...prev, zone_plu: v}) : null)} />
                            <FormField label="Surface Parcelle" value={project.surface_parcelle} onChange={(v: any) => setProject(prev => prev ? ({...prev, surface_parcelle: v}) : null)} />
                            <FormField label="Nom Etablissement" value={project.nom_etablissement} onChange={(v: any) => setProject(prev => prev ? ({...prev, nom_etablissement: v}) : null)} />
                            <FormField label="Avant Travaux" value={project.avant_trav} onChange={(v: any) => setProject(prev => prev ? ({...prev, avant_trav: v}) : null)} />
                            <FormField label="Après Travaux" value={project.apres_trav} onChange={(v: any) => setProject(prev => prev ? ({...prev, apres_trav: v}) : null)} />
                            <FormField label="Type Et Cat" value={project.type_et_cat} onChange={(v: any) => setProject(prev => prev ? ({...prev, type_et_cat: v}) : null)} />
                            <FormField label="Type" value={project.type_projet} onChange={(v: any) => setProject(prev => prev ? ({...prev, type_projet: v}) : null)} />
                            <FormField label="Catégorie" value={project.categorie_projet} onChange={(v: any) => setProject(prev => prev ? ({...prev, categorie_projet: v}) : null)} />
                          </div>
                        </div>

                        <div className="space-y-4 pt-8 border-t border-[var(--tblr-border)]">
                          <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2 uppercase tracking-wider">
                            <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">03</span>
                            Surfaces & Capacités
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField label="Surface Plancher" value={project.surface_plancher} onChange={(v: any) => setProject(prev => prev ? ({...prev, surface_plancher: v}) : null)} />
                            <FormField label="Surface Plancher Ext" value={project.surface_plancher_ext} onChange={(v: any) => setProject(prev => prev ? ({...prev, surface_plancher_ext: v}) : null)} />
                            <FormField label="Surface ERP" value={project.surface_erp} onChange={(v: any) => setProject(prev => prev ? ({...prev, surface_erp: v}) : null)} />
                            <FormField label="Surface ERT" value={project.surface_ert} onChange={(v: any) => setProject(prev => prev ? ({...prev, surface_ert: v}) : null)} />
                            <FormField label="Effectif Public" value={project.effectif_public} onChange={(v: any) => setProject(prev => prev ? ({...prev, effectif_public: v}) : null)} />
                            <FormField label="Effectif Personnel" value={project.effectif_personnel} onChange={(v: any) => setProject(prev => prev ? ({...prev, effectif_personnel: v}) : null)} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Status & Budget (Moved into INFOS Tab) */}
                  <div className="space-y-8">
                    <div className="p-6 rounded-lg space-y-6" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('status')} *</label>
                        <select 
                          className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
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
                        <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('budget')} *</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">€</span>
                          <input 
                            type="number"
                            className="w-full pl-8 pr-4 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                            value={project.budget || 0}
                            onChange={e => setProject({...project, budget: Number(e.target.value)})}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">Start</label>
                          <input 
                            type="date"
                            className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)]"
                            value={project.start_date}
                            onChange={e => setProject({...project, start_date: e.target.value})}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('deadline')}</label>
                          <input 
                            type="date"
                            className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)]"
                            value={project.end_date}
                            onChange={e => setProject({...project, end_date: e.target.value})}
                          />
                        </div>
                      </div>
                      <div className="space-y-4 pt-4 border-t border-[var(--tblr-border)]">
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

                {/* Project Members Section */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconUsersGroup}
                    title={
                      <span className="flex items-center gap-2">
                        Équipe du projet
                        <span className="text-xs font-medium bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] px-2 py-0.5 rounded-full">{projectMembers.length}</span>
                      </span>
                    }
                    action={
                    <div className="flex items-center gap-2">
                      <select
                        className="px-3 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 focus:outline-none"
                        defaultValue=""
                        onChange={async e => {
                          const userId = e.target.value;
                          if (!userId) return;
                          e.target.value = '';
                          try {
                            const res = await fetch(`/api/projects/${id}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, role: 'member' }) });
                            if (res.ok) fetchProjectMembers();
                          } catch (err) { console.error(err); }
                        }}
                      >
                        <option value="">+ Ajouter un membre</option>
                        {team.filter(m => !projectMembers.find(pm => pm.user_id === m.id || pm.id === m.id)).map(m => (
                          <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                        ))}
                      </select>
                    </div>
                    }
                  />
                  <div className="p-4">
                    {projectMembers.length === 0 ? (
                      <p className="text-sm text-[var(--tblr-muted)] italic text-center py-4">Aucun membre assigné à ce projet. Utilisez le menu ci-dessus pour en ajouter.</p>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        {projectMembers.map(m => (
                          <div key={m.id || m.user_id} className="flex items-center gap-2 px-3 py-2 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg group">
                            <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-xs font-bold text-violet-700 dark:text-violet-400 flex-shrink-0">
                              {(m.name || m.email || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">{m.name || m.email}</p>
                              <p className="text-[10px] text-[var(--tblr-muted)]">{m.role || 'member'}</p>
                            </div>
                            <button
                              onClick={async () => {
                                try {
                                  const userId = m.user_id || m.id;
                                  const res = await fetch(`/api/projects/${id}/members/${userId}`, { method: 'DELETE' });
                                  if (res.ok) setProjectMembers(prev => prev.filter(pm => (pm.user_id || pm.id) !== userId));
                                } catch (err) { console.error(err); }
                              }}
                              className="ml-1 p-1 text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded"
                              title="Retirer du projet"
                            >✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}


            {/* Tab content for PRO, VISA, AOR ... */}
            {activeTab === 'DET' && (
              <div className="space-y-8">
                {/* Construction Report Module */}
                <ConstructionReportModule 
                  project={project} 
                  lots_list={project.lots_list || []} 
                />

                {/* Ordres de Service Travaux */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconTools}
                    title="Ordres de Service Travaux"
                    description={(() => {
                      const travauxApprouves = ordresDeService
                        .filter(o => (o.type === 'travaux' || !o.type) && o.status === 'approved')
                        .reduce((acc, o) => acc + (Number(o.montant_devis_accepte) || Number(o.montant_devis_presente) || 0), 0);
                      if (travauxApprouves !== 0) return (
                        <span className="text-green-600 dark:text-green-400 font-semibold">
                          +{formatCurrency(travauxApprouves)} approuvés sur marchés
                        </span>
                      );
                      return undefined;
                    })()}
                    action={
                      <button
                        onClick={() => setIsAddingOs(!isAddingOs)}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all"
                      >
                        <IconPlus size={14} />
                        Nouvel OS
                      </button>
                    }
                  />
                  {isAddingOs && (
                    <div className="p-6 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">N° OS</label>
                          <input type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.os_number} onChange={e => setNewOs({...newOs, os_number: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Date d'émission</label>
                          <input type="date"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.date_emission} onChange={e => setNewOs({...newOs, date_emission: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Lot</label>
                          <select
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.lot} onChange={e => handleLotChange(e.target.value)}>
                            <option value="">Sélectionner un lot</option>
                            {project.lots_list?.map(l => (
                              <option key={l.id} value={l.lot_number}>{l.lot_number} - {l.lot_title}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Titre *</label>
                        <input type="text"
                          className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          value={newOs.title} onChange={e => setNewOs({...newOs, title: e.target.value})}
                          placeholder="ex: Travaux supplémentaires fondations" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Objet</label>
                        <input type="text"
                          className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          value={newOs.objet} onChange={e => setNewOs({...newOs, objet: e.target.value})}
                          placeholder="Description succincte de l'objet de l'OS" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Émetteur (MOE)</label>
                          <input type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.emetteur_os} onChange={e => setNewOs({...newOs, emetteur_os: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Entreprise destinataire</label>
                          <input type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.destinataire_os || newOs.entreprise}
                            onChange={e => { handleEntrepriseChange(e.target.value); setNewOs(prev => ({...prev, destinataire_os: e.target.value})); }} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Montant présenté HT</label>
                          <input type="number"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.montant_devis_presente} onChange={e => setNewOs({...newOs, montant_devis_presente: e.target.value})} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Délai d'exécution</label>
                          <div className="flex gap-2">
                            <input type="number" placeholder="ex: 30"
                              className="w-20 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newOs.delai_execution} onChange={e => setNewOs({...newOs, delai_execution: e.target.value})} />
                            <select
                              className="flex-1 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newOs.delai_unit} onChange={e => setNewOs({...newOs, delai_unit: e.target.value})}>
                              <option value="jours">Jours</option>
                              <option value="semaines">Semaines</option>
                              <option value="mois">Mois</option>
                            </select>
                          </div>
                        </div>
                        <div className="md:col-span-2 flex items-end">
                          <button onClick={handleCreateOs}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all">
                            Créer l'OS
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-4 py-3 text-left">N°</th>
                          <th className="px-4 py-3 text-left">Titre</th>
                          <th className="px-4 py-3 text-left">Lot / Entreprise</th>
                          <th className="px-4 py-3 text-left">Date émission</th>
                          <th className="px-4 py-3 text-left">Délai</th>
                          <th className="px-4 py-3 text-right">Présenté HT</th>
                          <th className="px-4 py-3 text-right">Accepté HT</th>
                          <th className="px-4 py-3 text-center">Statut</th>
                          <th className="px-4 py-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--tblr-border)]">
                        {ordresDeService.filter(o => o.type === 'travaux' || !o.type).map((os) => (
                          <tr key={os.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors">
                            <td className="px-4 py-3 font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap font-mono text-xs">
                              OS {os.os_number}
                            </td>
                            <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200 max-w-[160px] truncate">{os.title}</td>
                            <td className="px-4 py-3 text-[var(--tblr-muted)] text-xs">
                              {os.lot && <span className="font-semibold">{os.lot}</span>}
                              {os.lot && (os.destinataire_os || os.entreprise) && ' · '}
                              {os.destinataire_os || os.entreprise}
                            </td>
                            <td className="px-4 py-3 text-xs text-[var(--tblr-muted)]">{os.date_emission ?? os.date?.slice(0,10) ?? '—'}</td>
                            <td className="px-4 py-3 text-xs text-[var(--tblr-muted)]">
                              {os.delai_execution ? `${os.delai_execution} ${os.delai_unit ?? 'j'}` : '—'}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-300">
                              {os.montant_devis_presente ? formatCurrency(Number(os.montant_devis_presente)) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-[var(--tblr-text)]">
                              {os.status === 'approved'
                                ? formatCurrency(Number(os.montant_devis_accepte ?? os.montant_devis_presente ?? 0))
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-center">{osStatusBadge(os.status)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                {os.status === 'draft' && (
                                  <button onClick={() => handleUpdateOsStatus(os.id, 'submitted')}
                                    title="Émettre l'OS"
                                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 text-[10px] font-bold transition-all">
                                    <IconSend size={11} /> Émettre
                                  </button>
                                )}
                                {os.status === 'submitted' && (
                                  <button onClick={() => handleUpdateOsStatus(os.id, 'approved')}
                                    title="Enregistrer AR"
                                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 text-[10px] font-bold transition-all">
                                    <IconCheck size={11} /> AR reçu
                                  </button>
                                )}
                                {(os.status === 'draft' || os.status === 'submitted') && (
                                  <button onClick={() => handleUpdateOsStatus(os.id, 'rejected')}
                                    title="Annuler"
                                    className="p-1 text-red-400 hover:text-red-600 transition-colors">
                                    <IconX size={13} />
                                  </button>
                                )}
                                <button onClick={() => generateOsPdf(os)} title="Exporter PDF"
                                  className="p-1 text-zinc-300 hover:text-blue-500 transition-colors">
                                  <IconFileDownload size={13} />
                                </button>
                                <button onClick={() => handleDeleteOs(os.id)}
                                  className="p-1 text-zinc-300 hover:text-red-500 transition-colors">
                                  <IconTrash size={13} />
                                </button>
                              </div>
                              {os.status === 'approved' && os.date_ar && (
                                <p className="text-[10px] text-green-600 mt-0.5">AR : {os.date_ar}</p>
                              )}
                            </td>
                          </tr>
                        ))}
                        {ordresDeService.filter(o => o.type === 'travaux' || !o.type).length === 0 && (
                          <tr>
                            <td colSpan={9} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucun ordre de service travaux.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Comptes Rendus de Chantier */}
                <SiteReports project={project} lots_list={project.lots_list || []} />
              </div>
            )}
            {activeTab === 'RDT' && (
              <div className="space-y-8">
                {/* Financial Summary */}
                {(() => {
                  const marchesInitiaux = (project.lots_list || []).reduce((acc, lot) => acc + (lot.base_amount || 0) + (lot.options_amount || 0) + (lot.amendments_amount || 0), 0);
                  const avenantsTravauxApprouves = ordresDeService
                    .filter(o => (o.type === 'travaux' || !o.type) && o.status === 'approved')
                    .reduce((acc, o) => acc + (Number(o.montant_devis_accepte) || Number(o.montant_devis_presente) || 0), 0);
                  const marchesRevises = marchesInitiaux + avenantsTravauxApprouves;
                  const honorairesInitiaux = Number(project.remuneration) || 0;
                  const avenantsHonorairesApprouves = ordresDeService
                    .filter(o => o.type === 'contrat_moe' && o.status === 'approved')
                    .reduce((acc, o) => acc + (Number(o.montant_devis_accepte) || Number(o.montant_devis_presente) || 0), 0);
                  const honorairesRevises = honorairesInitiaux + avenantsHonorairesApprouves;
                  return (
                    <>
                      {(avenantsTravauxApprouves !== 0 || avenantsHonorairesApprouves !== 0) && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded-lg p-4 flex flex-wrap gap-6 items-center">
                          <div>
                            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Marchés révisés</p>
                            <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatCurrency(marchesRevises)}</p>
                            {avenantsTravauxApprouves !== 0 && (
                              <p className="text-xs text-blue-500">{formatCurrency(marchesInitiaux)} initial {avenantsTravauxApprouves >= 0 ? '+' : ''}{formatCurrency(avenantsTravauxApprouves)} avenants</p>
                            )}
                          </div>
                          {honorairesRevises !== 0 && (
                            <div>
                              <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Honoraires MOE révisés</p>
                              <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatCurrency(honorairesRevises)}</p>
                              {avenantsHonorairesApprouves !== 0 && (
                                <p className="text-xs text-blue-500">{formatCurrency(honorairesInitiaux)} initial {avenantsHonorairesApprouves >= 0 ? '+' : ''}{formatCurrency(avenantsHonorairesApprouves)} avenants</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatTile
                    label="Total Marchés"
                    value={formatCurrency((project.lots_list || []).reduce((acc, lot) => acc + (lot.base_amount || 0) + (lot.options_amount || 0) + (lot.amendments_amount || 0), 0))}
                  />
                  <StatTile
                    label="Total Payé"
                    value={<span className="text-green-600">{formatCurrency(invoices.filter(i => i.status === 'Paid').reduce((acc, i) => acc + i.amount, 0))}</span>}
                  />
                  <StatTile
                    label="Reste à payer"
                    value={<span className="text-blue-600">{formatCurrency((project.lots_list || []).reduce((acc, lot) => acc + (lot.base_amount || 0) + (lot.options_amount || 0) + (lot.amendments_amount || 0), 0) - invoices.filter(i => i.status === 'Paid').reduce((acc, i) => acc + i.amount, 0))}</span>}
                  />
                </div>

                {/* Invoices List - Manageable */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconReportMoney}
                    title="Factures Entreprises"
                    action={
                      <button
                        onClick={() => setIsAddingInvoice(!isAddingInvoice)}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all"
                      >
                        <IconPlus size={14} />
                        Ajouter une facture
                      </button>
                    }
                  />

                  {isAddingInvoice && (
                    <div className="p-6 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">N° Facture</label>
                          <input 
                            type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newInvoice.invoice_number}
                            onChange={e => setNewInvoice({...newInvoice, invoice_number: e.target.value})}
                            placeholder="ex: F-2024-001"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Montant HT</label>
                          <input 
                            type="number"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newInvoice.amount}
                            onChange={e => setNewInvoice({...newInvoice, amount: Number(e.target.value)})}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Description</label>
                          <input 
                            type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newInvoice.description}
                            onChange={e => setNewInvoice({...newInvoice, description: e.target.value})}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-3">
                        <button 
                          onClick={() => setIsAddingInvoice(false)}
                          className="px-4 py-2 text-sm font-bold text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors"
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
                      <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left">N° Facture</th>
                          <th className="px-6 py-3 text-left">Date</th>
                          <th className="px-6 py-3 text-left">Statut</th>
                          <th className="px-6 py-3 text-right">Montant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--tblr-border)]">
                        {invoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors">
                            <td className="px-6 py-4 font-bold text-[var(--tblr-text)]">{inv.invoice_number}</td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{new Date(inv.issue_date).toLocaleDateString()}</td>
                            <td className="px-6 py-4">
                              <select 
                                className={cn(
                                  "bg-transparent font-bold text-[10px] uppercase tracking-wider outline-none cursor-pointer",
                                  inv.status === 'Paid' ? "text-green-600" :
                                  inv.status === 'Overdue' ? "text-red-600" :
                                  "text-[var(--tblr-muted)]"
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
                            <td className="px-6 py-4 text-right font-bold text-[var(--tblr-text)]">{formatCurrency(inv.amount)}</td>
                          </tr>
                        ))}
                        {invoices.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucune facture.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'ACT' && (
              <div className="mt-4">
                <ACTModule
                  projectId={id!}
                  projectName={project.name}
                  lots={project.lots_list || []}
                  contacts={contacts}
                  onLotsChange={updatedLots => {
                    setProject({ ...project, lots_list: updatedLots });
                    apiFetch(`/api/projects/${id}`, {
                      method: 'PUT',
                      body: JSON.stringify({ ...project, lots_list: updatedLots }),
                    }).catch(console.error);
                  }}
                />
              </div>
            )}

            {activeTab === 'VISA' && (
              <div className="space-y-8">
                {/* VISA Modal */}
                {isVisaModalOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIsVisaModalOpen(false)}>
                    <div className="rounded-lg shadow-2xl w-full max-w-md mx-4 p-6" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }} onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-base font-bold text-[var(--tblr-text)]">{editingVisa ? 'Modifier le visa' : 'Nouveau visa'}</h4>
                        <button onClick={() => setIsVisaModalOpen(false)} className="p-1 text-[var(--tblr-muted)] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
                          <IconX size={18} />
                        </button>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-semibold text-[var(--tblr-muted)] mb-1">Titre *</label>
                          <input
                            type="text"
                            value={visaForm.title}
                            onChange={e => setVisaForm(f => ({ ...f, title: e.target.value }))}
                            className="w-full px-3 py-2 text-sm border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]"
                            placeholder="Ex: Visa plans d'exécution façade"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[var(--tblr-muted)] mb-1">Date</label>
                          <input
                            type="date"
                            value={visaForm.date}
                            onChange={e => setVisaForm(f => ({ ...f, date: e.target.value }))}
                            className="w-full px-3 py-2 text-sm border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[var(--tblr-muted)] mb-2">Statut</label>
                          <div className="flex gap-2">
                            {(['pending', 'approved', 'rejected', 'commented'] as const).map(s => (
                              <button
                                key={s}
                                onClick={() => setVisaForm(f => ({ ...f, status: s }))}
                                className={cn(
                                  "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold uppercase transition-all border",
                                  visaForm.status === s
                                    ? s === 'approved' ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:border-green-700 dark:text-green-400'
                                      : s === 'rejected' ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:border-red-700 dark:text-red-400'
                                      : s === 'commented' ? 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-400'
                                      : 'bg-zinc-200 text-zinc-700 border-zinc-300 dark:bg-zinc-700 dark:border-zinc-600 dark:text-zinc-200'
                                    : 'bg-white text-[var(--tblr-muted)] border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-[var(--tblr-muted)]'
                                )}
                              >
                                {s === 'pending' ? 'Attente' : s === 'approved' ? 'Validé' : s === 'rejected' ? 'Rejeté' : 'Commenté'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[var(--tblr-muted)] mb-1">Commentaires</label>
                          <textarea
                            rows={3}
                            value={visaForm.comments}
                            onChange={e => setVisaForm(f => ({ ...f, comments: e.target.value }))}
                            className="w-full px-3 py-2 text-sm border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)] resize-none"
                            placeholder="Observations, réserves, demandes de modifications..."
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-5">
                        <button onClick={() => setIsVisaModalOpen(false)} className="flex-1 py-2 px-4 text-sm font-medium text-[var(--tblr-muted)] border border-[var(--tblr-border)] rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                          Annuler
                        </button>
                        <button
                          disabled={!visaForm.title.trim()}
                          onClick={async () => {
                            if (!visaForm.title.trim()) return;
                            try {
                              if (editingVisa) {
                                const res = await fetch(`/api/visas/${editingVisa.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ ...editingVisa, ...visaForm })
                                });
                                if (res.ok) {
                                  const updated = await res.json();
                                  setVisas(prev => prev.map(v => v.id === editingVisa.id ? updated : v));
                                }
                              } else {
                                const res = await fetch('/api/visas', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ project_id: id, ...visaForm, date: visaForm.date || new Date().toISOString() })
                                });
                                if (res.ok) {
                                  const data = await res.json();
                                  setVisas(prev => [...prev, data]);
                                }
                              }
                              setIsVisaModalOpen(false);
                              setEditingVisa(null);
                              setVisaForm({ title: '', date: new Date().toISOString().split('T')[0], status: 'pending', comments: '' });
                            } catch (err) { console.error(err); }
                          }}
                          className="flex-1 py-2 px-4 text-sm font-bold text-white bg-[var(--tblr-primary)] hover:opacity-90 disabled:opacity-50 rounded-lg transition-colors"
                        >
                          {editingVisa ? 'Enregistrer' : 'Créer'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconRubberStamp}
                    title={
                      <span className="flex items-center gap-2">
                        Visas
                        <span className="text-xs font-medium bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] px-2 py-0.5 rounded-full">{visas.length}</span>
                      </span>
                    }
                    action={
                      <button
                        onClick={() => {
                          setEditingVisa(null);
                          setVisaForm({ title: '', date: new Date().toISOString().split('T')[0], status: 'pending', comments: '' });
                          setIsVisaModalOpen(true);
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all"
                      >
                        <IconPlus size={14} />
                        Ajouter un visa
                      </button>
                    }
                  />
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left">Titre</th>
                          <th className="px-6 py-3 text-left">Date</th>
                          <th className="px-6 py-3 text-left">Statut</th>
                          <th className="px-6 py-3 text-left">Commentaires</th>
                          <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--tblr-border)]">
                        {visas.map((visa) => (
                          <tr key={visa.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors group">
                            <td className="px-6 py-4 font-bold text-[var(--tblr-text)]">{visa.title}</td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{new Date(visa.date).toLocaleDateString('fr-FR')}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                visa.status === 'approved' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                visa.status === 'rejected' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                visa.status === 'commented' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                                "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-[var(--tblr-muted)]"
                              )}>
                                {visa.status === 'pending' ? 'En attente' : visa.status === 'approved' ? 'Validé' : visa.status === 'rejected' ? 'Rejeté' : 'Commenté'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 max-w-xs">
                              <span className="truncate block max-w-48" title={visa.comments}>{visa.comments || <span className="italic text-[var(--tblr-muted)]">—</span>}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {/* Quick validate */}
                                {visa.status !== 'approved' && (
                                  <button
                                    title="Valider"
                                    onClick={async () => {
                                      try {
                                        const res = await fetch(`/api/visas/${visa.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...visa, status: 'approved' }) });
                                        if (res.ok) setVisas(prev => prev.map(v => v.id === visa.id ? { ...v, status: 'approved' } : v));
                                      } catch (err) { console.error(err); }
                                    }}
                                    className="p-1.5 text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                                  >
                                    <IconCheck size={15} />
                                  </button>
                                )}
                                {/* Quick reject */}
                                {visa.status !== 'rejected' && (
                                  <button
                                    title="Rejeter"
                                    onClick={async () => {
                                      try {
                                        const res = await fetch(`/api/visas/${visa.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...visa, status: 'rejected' }) });
                                        if (res.ok) setVisas(prev => prev.map(v => v.id === visa.id ? { ...v, status: 'rejected' } : v));
                                      } catch (err) { console.error(err); }
                                    }}
                                    className="p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                  >
                                    <IconX size={15} />
                                  </button>
                                )}
                                {/* Edit */}
                                <button
                                  title="Modifier"
                                  onClick={() => {
                                    setEditingVisa(visa);
                                    setVisaForm({ title: visa.title, date: visa.date.split('T')[0], status: visa.status, comments: visa.comments || '' });
                                    setIsVisaModalOpen(true);
                                  }}
                                  className="p-1.5 text-[var(--tblr-muted)] hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                                >
                                  <IconMessageDots size={15} />
                                </button>
                                {/* Delete */}
                                <button
                                  title="Supprimer"
                                  onClick={async () => {
                                    if (!confirm('Supprimer ce visa ?')) return;
                                    try {
                                      const res = await fetch(`/api/visas/${visa.id}`, { method: 'DELETE' });
                                      if (res.ok) setVisas(prev => prev.filter(v => v.id !== visa.id));
                                    } catch (err) { console.error(err); }
                                  }}
                                  className="p-1.5 text-[var(--tblr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                >
                                  <IconTrash size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {visas.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucun visa. Cliquez sur "Ajouter un visa" pour commencer.</td>
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
                {/* Cartes d'alertes réserves */}
                {(() => {
                  const today = new Date(); today.setHours(0,0,0,0);
                  const in7 = new Date(today.getTime() + 7*24*60*60*1000);
                  const ouvertes = reserves.filter(r => r.status === 'A faire' || r.status === 'En cours');
                  const retard = reserves.filter(r => r.status !== 'Levée' && r.status !== 'Quitus Transmis' && new Date(r.due_date) < today);
                  const urgentes = reserves.filter(r => r.status !== 'Levée' && r.status !== 'Quitus Transmis' && new Date(r.due_date) >= today && new Date(r.due_date) <= in7);
                  const levees = reserves.filter(r => r.status === 'Levée' || r.status === 'Quitus Transmis');
                  return (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatTile label="Réserves ouvertes" color="blue" icon={IconAlertTriangle} value={ouvertes.length} sub="A faire + En cours" />
                      <StatTile label="En retard" color="red" icon={IconAlertCircle} value={retard.length} sub="Échéance dépassée" />
                      <StatTile label="Urgentes" color="orange" icon={IconClock} value={urgentes.length} sub="Dans les 7 jours" />
                      <StatTile label="Levées" color="green" icon={IconCheck} value={levees.length} sub="Levée + Quitus" />
                    </div>
                  );
                })()}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-8">
                    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <CardHeader
                        icon={IconClipboardCheck}
                        title="Réserves"
                        action={
                        <div className="flex items-center gap-2">
                          {plans.length > 0 && (
                            <select
                              className="bg-zinc-100 dark:bg-zinc-800 border-none rounded-lg px-3 py-2 text-xs font-bold outline-none"
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
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all"
                          >
                            <IconPlus size={14} />
                            {isAddingReserve ? 'Annuler' : 'Créer une réserve'}
                          </button>
                        </div>
                        }
                      />

                      {isAddingReserve && (
                        <div className="p-6 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-4">
                          {selectedPlanId && !annotationCoords && (
                            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg text-blue-600 dark:text-blue-400 text-xs font-medium flex items-center gap-3">
                              <IconPlus size={16} />
                              Cliquez sur le plan à droite pour placer la réserve
                            </div>
                          )}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Intitulé</label>
                          <input 
                            type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newReserve.title}
                            onChange={e => setNewReserve(prev => ({ ...prev, title: e.target.value }))}
                            placeholder="ex: Peinture à reprendre"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Bâtiment</label>
                          <input 
                            type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newReserve.batiment}
                            onChange={e => setNewReserve(prev => ({ ...prev, batiment: e.target.value }))}
                            placeholder="ex: Bâtiment A"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Local</label>
                          <input 
                            type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newReserve.local}
                            onChange={e => setNewReserve(prev => ({ ...prev, local: e.target.value }))}
                            placeholder="ex: Salon"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Statut</label>
                          <select 
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
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
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Lots</label>
                          <Select
                            isMulti
                            options={project?.lots_list?.map(l => ({ value: l.id, label: l.lot_title, color: '#3b82f6' })) || []}
                            styles={colourStyles as any}
                            className="text-sm"
                            onChange={(vals: any) => setNewReserve(prev => ({ ...prev, lots: vals }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Entreprises</label>
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
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Date de création</label>
                          <input 
                            type="date"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newReserve.created_at}
                            onChange={e => {
                              const newDate = e.target.value;
                              const dueDate = new Date(new Date(newDate).getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                              setNewReserve(prev => ({ ...prev, created_at: newDate, due_date: dueDate }));
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Date d'échéance</label>
                          <input 
                            type="date"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newReserve.due_date}
                            onChange={e => setNewReserve(prev => ({ ...prev, due_date: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-3">
                        <button 
                          onClick={() => setIsAddingReserve(false)}
                          className="px-4 py-2 text-sm font-bold text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors"
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
                      <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-4 py-3 text-left w-12">N°</th>
                          <th className="px-4 py-3 text-left">Bâtiment / Local</th>
                          <th className="px-4 py-3 text-left">Intitulé</th>
                          <th className="px-4 py-3 text-left">Statut</th>
                          <th className="px-4 py-3 text-left">Créé le</th>
                          <th className="px-4 py-3 text-left">Echéance / Retard</th>
                          <th className="px-4 py-3 text-right w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--tblr-border)]">
                        {(Object.entries(reserves.reduce((acc, res) => {
                          const lots = JSON.parse(res.lots || '[]');
                          const entreprises = JSON.parse(res.entreprises || '[]');
                          const groupKey = lots.length > 0 ? `${lots.join(', ')} / ${entreprises.join(', ')}` : 'Sans Lot / Entreprise';
                          if (!acc[groupKey]) acc[groupKey] = [];
                          acc[groupKey].push(res);
                          return acc;
                        }, {} as Record<string, Reserve[]>)) as [string, Reserve[]][]).map(([groupKey, groupReserves]) => (
                          <React.Fragment key={groupKey}>
                            <tr
                              className="bg-zinc-50/50 dark:bg-zinc-800/20 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/40 transition-colors"
                              onClick={() => setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }))}
                            >
                              <td colSpan={7} className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  {expandedGroups[groupKey] ? <IconChevronDown size={14} className="text-[var(--tblr-muted)]" /> : <IconChevronRight size={14} className="text-[var(--tblr-muted)]" />}
                                  <span className="font-bold text-[var(--tblr-text)] uppercase tracking-wider text-[11px]">{groupKey}</span>
                                  <span className="text-[10px] text-[var(--tblr-muted)] font-normal">({groupReserves.length} réserves)</span>
                                </div>
                              </td>
                            </tr>
                            {expandedGroups[groupKey] && groupReserves.map((res) => {
                              const todayD = new Date(); todayD.setHours(0,0,0,0);
                              const dueD = new Date(res.due_date); dueD.setHours(0,0,0,0);
                              const isOverdue = dueD < todayD && res.status !== 'Levée' && res.status !== 'Quitus Transmis';
                              const retardJours = isOverdue ? Math.floor((todayD.getTime() - dueD.getTime()) / 86400000) : 0;
                              return (
                                <tr key={res.id} className={cn("transition-colors group", isOverdue ? "bg-red-50/30 dark:bg-red-950/10 hover:bg-red-50/50" : "hover:bg-[var(--tblr-surface-2)]")}>
                                  <td className="px-4 py-4 font-mono text-[10px] text-[var(--tblr-muted)]">
                                    #{res.number || '-'}
                                  </td>
                                  <td className="px-4 py-4">
                                    {editingReserveId === res.id ? (
                                      <div className="flex gap-2">
                                        <input
                                          type="text"
                                          className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded p-1 text-xs w-20"
                                          value={editReserveData?.batiment}
                                          onChange={e => setEditReserveData(prev => prev ? ({ ...prev, batiment: e.target.value }) : null)}
                                        />
                                        <input
                                          type="text"
                                          className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded p-1 text-xs w-20"
                                          value={editReserveData?.local}
                                          onChange={e => setEditReserveData(prev => prev ? ({ ...prev, local: e.target.value }) : null)}
                                        />
                                      </div>
                                    ) : (
                                      <span className="text-zinc-600 dark:text-zinc-300">{res.batiment} {res.local && `/ ${res.local}`}</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-4">
                                    {editingReserveId === res.id ? (
                                      <input
                                        type="text"
                                        className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded p-1 text-xs"
                                        value={editReserveData?.title}
                                        onChange={e => setEditReserveData(prev => prev ? ({ ...prev, title: e.target.value }) : null)}
                                      />
                                    ) : (
                                      <div className="font-medium text-[var(--tblr-text)]">{res.title}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-4">
                                    {/* Inline status select — saves immediately */}
                                    <select
                                      className={cn(
                                        "border-none rounded-full text-[10px] font-bold uppercase tracking-wider px-2 py-1 outline-none cursor-pointer",
                                        res.status === 'Levée' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                        res.status === 'Quitus Transmis' ? "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400" :
                                        res.status === 'En cours' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                                        res.status === 'Refusée par l\'entreprise' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                        res.status === 'Levée refusée par le MOE' ? "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400" :
                                        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                      )}
                                      value={res.status}
                                      onChange={async (e) => {
                                        const newStatus = e.target.value as Reserve['status'];
                                        try {
                                          const updated = { ...res, status: newStatus };
                                          const response = await fetch(`/api/reserves/${res.id}`, {
                                            method: 'PUT',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(updated)
                                          });
                                          if (response.ok) {
                                            setReserves(prev => prev.map(r => r.id === res.id ? updated : r));
                                          }
                                        } catch (err) { console.error(err); }
                                      }}
                                    >
                                      <option value="A faire">A faire</option>
                                      <option value="En cours">En cours</option>
                                      <option value="Levée">Levée</option>
                                      <option value="Refusée par l'entreprise">Refusée par l'entreprise</option>
                                      <option value="Quitus Transmis">Quitus Transmis</option>
                                      <option value="Levée refusée par le MOE">Levée refusée par le MOE</option>
                                    </select>
                                  </td>
                                  <td className="px-4 py-4 text-[10px] text-[var(--tblr-muted)]">
                                    {new Date(res.created_at).toLocaleDateString('fr-FR')}
                                  </td>
                                  <td className="px-4 py-4">
                                    {editingReserveId === res.id ? (
                                      <input
                                        type="date"
                                        className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded p-1 text-xs"
                                        value={editReserveData?.due_date}
                                        onChange={e => setEditReserveData(prev => prev ? ({ ...prev, due_date: e.target.value }) : null)}
                                      />
                                    ) : (
                                      <div className="space-y-0.5">
                                        <div className={cn("text-xs font-medium", isOverdue ? "text-red-500" : "text-zinc-600 dark:text-zinc-300")}>
                                          {new Date(res.due_date).toLocaleDateString('fr-FR')}
                                        </div>
                                        {isOverdue && (
                                          <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded text-[9px] font-bold">
                                            +{retardJours}j
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-4 text-right">
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
                                              } catch (err) { console.error(err); }
                                            }}
                                            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                                          >
                                            <IconCheck size={14} />
                                          </button>
                                          <button
                                            onClick={() => { setEditingReserveId(null); setEditReserveData(null); }}
                                            className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                          >
                                            <IconX size={14} />
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          <button
                                            onClick={() => { setEditingReserveId(res.id); setEditReserveData({ ...res }); }}
                                            className="p-1.5 text-[var(--tblr-muted)] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                            title="Modifier"
                                          >
                                            <IconFileText size={14} />
                                          </button>
                                          <button
                                            onClick={async () => {
                                              if (!confirm('Supprimer cette réserve ?')) return;
                                              try {
                                                const response = await fetch(`/api/reserves/${res.id}`, { method: 'DELETE' });
                                                if (response.ok) setReserves(prev => prev.filter(r => r.id !== res.id));
                                              } catch (err) { console.error(err); }
                                            }}
                                            className="p-1.5 text-[var(--tblr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                            title="Supprimer"
                                          >
                                            <IconTrash size={14} />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        ))}
                        {reserves.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucune réserve.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* PV de réception */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconClipboardCheck}
                    title="Procès-verbaux de réception"
                    action={
                      <button
                        onClick={() => { setShowPvForm(true); setEditingReceptionId(null); setPvForm(defaultPvForm()); }}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all"
                      >
                        <IconPlus size={14} />
                        Créer PV de réception
                      </button>
                    }
                  />

                  {/* Formulaire PV */}
                  {showPvForm && (
                    <div className="p-6 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-5">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Référence PV</label>
                          <input type="text" placeholder="ex: PV-2024-001" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={pvForm.reference_pv} onChange={e => setPvForm(prev => ({ ...prev, reference_pv: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Type</label>
                          <select className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={pvForm.type} onChange={e => setPvForm(prev => ({ ...prev, type: e.target.value as 'provisoire' | 'definitive' }))}>
                            <option value="provisoire">Réception provisoire</option>
                            <option value="definitive">Réception définitive</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Date</label>
                          <input type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={pvForm.date} onChange={e => setPvForm(prev => ({ ...prev, date: e.target.value }))} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Lieu</label>
                          <input type="text" placeholder="ex: Site du projet" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={pvForm.lieu} onChange={e => setPvForm(prev => ({ ...prev, lieu: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Date limite levée des réserves</label>
                          <input type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={pvForm.date_limite_levee} onChange={e => setPvForm(prev => ({ ...prev, date_limite_levee: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                        </div>
                      </div>

                      {/* Liste des réserves */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">
                            Réserves
                            {pvForm.reserves_list.length > 0 && (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px]">{pvForm.reserves_list.length}</span>
                            )}
                          </label>
                          <button
                            type="button"
                            onClick={() => setPvForm(prev => ({
                              ...prev,
                              has_reserves: true,
                              reserves_list: [...prev.reserves_list, { id: crypto.randomUUID(), title: '', batiment: '', local: '', lots: '', entreprises: '', due_date: prev.date_limite_levee || '', status: 'A faire' }]
                            }))}
                            className="flex items-center gap-1 text-[10px] font-bold text-amber-600 hover:text-amber-700 transition-colors"
                          >
                            <IconPlus size={12} /> Ajouter une réserve
                          </button>
                        </div>
                        {pvForm.reserves_list.length === 0 && (
                          <p className="text-xs text-[var(--tblr-muted)] italic py-1">Aucune réserve. Cliquez sur "Ajouter une réserve" pour saisir la liste.</p>
                        )}
                        {pvForm.reserves_list.map((r, idx) => (
                          <div key={r.id} className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10 p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-amber-600 w-5 shrink-0">#{idx + 1}</span>
                              <input
                                type="text"
                                placeholder="Intitulé de la réserve *"
                                className="flex-1 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                                value={r.title}
                                onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, title: e.target.value } : x) }))}
                              />
                              <button
                                type="button"
                                onClick={() => setPvForm(prev => ({
                                  ...prev,
                                  reserves_list: prev.reserves_list.filter((_, i) => i !== idx),
                                  has_reserves: prev.reserves_list.length > 1,
                                }))}
                                className="p-1.5 text-red-400 hover:text-red-600 transition-colors shrink-0"
                              >
                                <IconX size={14} />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pl-7">
                              <input type="text" placeholder="Bâtiment" className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none" value={r.batiment} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, batiment: e.target.value } : x) }))} />
                              <input type="text" placeholder="Local / Zone" className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none" value={r.local} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, local: e.target.value } : x) }))} />
                              <input type="text" placeholder="Lot(s) concerné(s)" className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none" value={r.lots} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, lots: e.target.value } : x) }))} />
                              <input type="text" placeholder="Entreprise(s)" className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none" value={r.entreprises} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, entreprises: e.target.value } : x) }))} />
                              <div className="space-y-0.5">
                                <label className="text-[9px] font-bold text-[var(--tblr-muted)] uppercase">Date limite</label>
                                <input type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none" value={r.due_date} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, due_date: e.target.value } : x) }))} />
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-[9px] font-bold text-[var(--tblr-muted)] uppercase">Statut</label>
                                <select className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none" value={r.status} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, status: e.target.value } : x) }))}>
                                  <option value="A faire">À faire</option>
                                  <option value="En cours">En cours</option>
                                  <option value="Levée">Levée</option>
                                  <option value="Refusée par l'entreprise">Refusée par l'entreprise</option>
                                  <option value="Levée refusée par le MOE">Levée refusée par le MOE</option>
                                  <option value="Quitus Transmis">Quitus Transmis</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Signataires */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Signataires</label>
                          <button type="button" onClick={() => setPvForm(prev => ({ ...prev, signataires: [...prev.signataires, { nom: '', role: '' }] }))} className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors">
                            <IconPlus size={12} /> Ajouter signataire
                          </button>
                        </div>
                        {pvForm.signataires.map((sig, idx) => (
                          <div key={idx} className="flex gap-2 items-center">
                            <input type="text" placeholder="Nom" className="flex-1 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={sig.nom} onChange={e => setPvForm(prev => ({ ...prev, signataires: prev.signataires.map((s, i) => i === idx ? { ...s, nom: e.target.value } : s) }))} />
                            <input type="text" placeholder="Rôle (ex: MOE, MOA)" className="flex-1 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={sig.role} onChange={e => setPvForm(prev => ({ ...prev, signataires: prev.signataires.map((s, i) => i === idx ? { ...s, role: e.target.value } : s) }))} />
                            <button type="button" onClick={() => setPvForm(prev => ({ ...prev, signataires: prev.signataires.filter((_, i) => i !== idx) }))} className="p-2 text-red-400 hover:text-red-600 transition-colors"><IconX size={14} /></button>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Observations</label>
                        <textarea rows={3} className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none" value={pvForm.observations} onChange={e => setPvForm(prev => ({ ...prev, observations: e.target.value }))} />
                      </div>

                      <div className="flex justify-end gap-3">
                        <button onClick={() => { setShowPvForm(false); setEditingReceptionId(null); }} className="px-4 py-2 text-sm font-bold text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors">Annuler</button>
                        <button
                          onClick={async () => {
                            try {
                              const rl = pvForm.reserves_list;
                              const body = {
                                project_id: id,
                                date: pvForm.date,
                                type: pvForm.type,
                                has_reserves: rl.length > 0,
                                reserves_count: rl.length,
                                reference_pv: pvForm.reference_pv,
                                lieu: pvForm.lieu,
                                date_limite_levee: pvForm.date_limite_levee,
                                signataires: JSON.stringify(pvForm.signataires),
                                observations: pvForm.observations,
                                pv_valide: pvForm.pv_valide,
                              };
                              let receptionId = editingReceptionId;
                              if (editingReceptionId) {
                                const res = await fetch(`/api/receptions/${editingReceptionId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                                if (res.ok) { const data = await res.json(); setReceptions(prev => prev.map(r => r.id === editingReceptionId ? data : r)); }
                                // Remove old reserves for this PV then re-create
                                const existingForPv = reserves.filter(r => r.reception_id === editingReceptionId);
                                await Promise.all(existingForPv.map(r => fetch(`/api/reserves/${r.id}`, { method: 'DELETE' })));
                              } else {
                                const res = await fetch('/api/receptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                                if (res.ok) { const data = await res.json(); receptionId = data.id; setReceptions(prev => [...prev, data]); }
                              }
                              // Save inline reserves
                              if (receptionId && rl.length > 0) {
                                const today = new Date().toISOString().split('T')[0];
                                const saved = await Promise.all(rl.map(r => fetch('/api/reserves', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    id: r.id, project_id: id, reception_id: receptionId,
                                    title: r.title || '(sans titre)', batiment: r.batiment, local: r.local,
                                    lots: JSON.stringify(r.lots ? r.lots.split(',').map((s: string) => s.trim()) : []),
                                    entreprises: JSON.stringify(r.entreprises ? r.entreprises.split(',').map((s: string) => s.trim()) : []),
                                    status: r.status || 'A faire', due_date: r.due_date || today, created_at: today,
                                  }),
                                }).then(res => res.json())));
                                setReserves(prev => [...prev.filter(r => r.reception_id !== receptionId), ...saved]);
                              }
                              setShowPvForm(false);
                              setEditingReceptionId(null);
                              setPvForm(defaultPvForm());
                            } catch (err) { console.error(err); }
                          }}
                          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all"
                        >
                          {editingReceptionId ? 'Enregistrer' : 'Créer le PV'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left">Référence</th>
                          <th className="px-6 py-3 text-left">Type</th>
                          <th className="px-6 py-3 text-left">Date</th>
                          <th className="px-6 py-3 text-left">Lieu</th>
                          <th className="px-6 py-3 text-left">Réserves</th>
                          <th className="px-6 py-3 text-left">Délai levée</th>
                          <th className="px-6 py-3 text-left">Statut</th>
                          <th className="px-6 py-3 text-right w-28"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--tblr-border)]">
                        {receptions.map((rec) => {
                          const dlimit = rec.date_limite_levee ? new Date(rec.date_limite_levee) : null;
                          const isUrgent = dlimit && (dlimit.getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000;
                          const pvReserves = reserves.filter(r => r.reception_id === rec.id);
                          const isExpanded = expandedPvId === rec.id;
                          const reservesLevees = pvReserves.filter(r => r.status === 'Levée' || r.status === 'Quitus Transmis').length;
                          return (
                            <React.Fragment key={rec.id}>
                            <tr className="hover:bg-[var(--tblr-surface-2)] transition-colors group">
                              <td className="px-6 py-4 font-mono text-xs font-bold text-[var(--tblr-text)]">{rec.reference_pv || '—'}</td>
                              <td className="px-6 py-4">
                                <span className={cn("px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", rec.type === 'definitive' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400")}>
                                  {rec.type === 'provisoire' ? 'Provisoire' : 'Définitive'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 text-xs">{new Date(rec.date).toLocaleDateString('fr-FR')}</td>
                              <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 text-xs">{rec.lieu || '—'}</td>
                              <td className="px-6 py-4">
                                {pvReserves.length > 0 ? (
                                  <button
                                    onClick={() => setExpandedPvId(isExpanded ? null : rec.id)}
                                    className={cn("flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors", "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-200")}
                                  >
                                    {isExpanded ? <IconChevronUp size={10} /> : <IconChevronDown size={10} />}
                                    {pvReserves.length} réserve{pvReserves.length > 1 ? 's' : ''} · {reservesLevees} levée{reservesLevees > 1 ? 's' : ''}
                                  </button>
                                ) : (
                                  <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                    Sans réserves
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                {dlimit ? (
                                  <span className={cn("text-xs font-medium", isUrgent ? "text-orange-600 dark:text-orange-400 font-bold" : "text-zinc-600 dark:text-zinc-300")}>
                                    {dlimit.toLocaleDateString('fr-FR')}
                                    {isUrgent && ' ⚠'}
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-6 py-4">
                                <span className={cn("px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", rec.pv_valide ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-100 text-[var(--tblr-muted)] dark:bg-zinc-800 dark:text-[var(--tblr-muted)]")}>
                                  {rec.pv_valide ? 'Validé' : 'Brouillon'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {/* PDF export */}
                                  <button
                                    title="Exporter PDF"
                                    onClick={() => {
                                      const signataires: { nom: string; role: string }[] = rec.signataires ? JSON.parse(rec.signataires) : [];
                                      generatePvPdf(rec, pvReserves, project?.name || 'Projet', signataires);
                                    }}
                                    className="p-1.5 text-[var(--tblr-muted)] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                                  >
                                    <IconFileDownload size={15} />
                                  </button>
                                  {/* Edit */}
                                  <button
                                    title="Modifier"
                                    onClick={() => {
                                      setEditingReceptionId(rec.id);
                                      const existingReserves = reserves.filter(r => r.reception_id === rec.id);
                                      setPvForm({
                                        reference_pv: rec.reference_pv || '',
                                        type: rec.type,
                                        date: rec.date,
                                        lieu: rec.lieu || '',
                                        date_limite_levee: rec.date_limite_levee || '',
                                        has_reserves: rec.has_reserves,
                                        reserves_count: rec.reserves_count || 0,
                                        signataires: rec.signataires ? JSON.parse(rec.signataires) : [],
                                        observations: rec.observations || '',
                                        pv_valide: rec.pv_valide || false,
                                        reserves_list: existingReserves.map(r => ({
                                          id: r.id,
                                          title: r.title,
                                          batiment: r.batiment || '',
                                          local: r.local || '',
                                          lots: (() => { try { const p = JSON.parse(r.lots); return Array.isArray(p) ? p.join(', ') : r.lots; } catch { return r.lots || ''; } })(),
                                          entreprises: (() => { try { const p = JSON.parse(r.entreprises); return Array.isArray(p) ? p.join(', ') : r.entreprises; } catch { return r.entreprises || ''; } })(),
                                          due_date: r.due_date || '',
                                          status: r.status,
                                        })),
                                      });
                                      setShowPvForm(true);
                                    }}
                                    className="p-1.5 text-[var(--tblr-muted)] hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
                                  >
                                    <IconFileText size={15} />
                                  </button>
                                  {/* Delete */}
                                  <button
                                    title="Supprimer"
                                    onClick={async () => {
                                      if (!confirm('Supprimer ce PV de réception ?')) return;
                                      try {
                                        const res = await fetch(`/api/receptions/${rec.id}`, { method: 'DELETE' });
                                        if (res.ok) setReceptions(prev => prev.filter(r => r.id !== rec.id));
                                      } catch (err) { console.error(err); }
                                    }}
                                    className="p-1.5 text-[var(--tblr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                  >
                                    <IconTrash size={15} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {/* Panneau dépliable — liste des réserves */}
                            {isExpanded && pvReserves.length > 0 && (
                              <tr>
                                <td colSpan={8} className="px-0 pb-0 pt-0">
                                  <div className="mx-6 mb-4 rounded-lg border border-amber-200 dark:border-amber-800/40 overflow-hidden">
                                    <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40 flex items-center justify-between">
                                      <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">
                                        Liste des réserves — {rec.reference_pv}
                                      </span>
                                      <span className="text-[10px] text-amber-600 dark:text-amber-500">
                                        {reservesLevees}/{pvReserves.length} levées
                                      </span>
                                    </div>
                                    <table className="w-full text-xs">
                                      <thead className="bg-amber-50/50 dark:bg-amber-900/10 text-amber-600 dark:text-amber-500 font-bold uppercase text-[9px] tracking-wider">
                                        <tr>
                                          <th className="px-4 py-2 text-left w-8">#</th>
                                          <th className="px-4 py-2 text-left">Intitulé</th>
                                          <th className="px-4 py-2 text-left">Bâtiment / Local</th>
                                          <th className="px-4 py-2 text-left">Lot / Entreprise</th>
                                          <th className="px-4 py-2 text-left">Délai</th>
                                          <th className="px-4 py-2 text-left">Statut</th>
                                          <th className="px-4 py-2 text-right w-16"></th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-amber-100 dark:divide-amber-900/20">
                                        {pvReserves.map((r, idx) => {
                                          const isLevee = r.status === 'Levée' || r.status === 'Quitus Transmis';
                                          const isEnRetard = r.due_date && new Date(r.due_date) < new Date() && !isLevee;
                                          const statusColors: Record<string, string> = {
                                            'A faire': 'bg-red-100 text-red-700',
                                            'En cours': 'bg-blue-100 text-blue-700',
                                            'Levée': 'bg-green-100 text-green-700',
                                            'Quitus Transmis': 'bg-green-200 text-green-800',
                                            "Refusée par l'entreprise": 'bg-orange-100 text-orange-700',
                                            'Levée refusée par le MOE': 'bg-purple-100 text-purple-700',
                                          };
                                          return (
                                            <tr key={r.id} className={cn("transition-colors", isLevee ? "opacity-60" : "hover:bg-amber-50/60 dark:hover:bg-amber-900/10")}>
                                              <td className="px-4 py-2 font-black text-amber-500">{r.number ?? idx + 1}</td>
                                              <td className="px-4 py-2 font-medium text-zinc-800 dark:text-zinc-200">{r.title}</td>
                                              <td className="px-4 py-2 text-[var(--tblr-muted)]">
                                                {[r.batiment, r.local].filter(Boolean).join(' / ') || '—'}
                                              </td>
                                              <td className="px-4 py-2 text-[var(--tblr-muted)]">
                                                {(() => {
                                                  const lots = (() => { try { return JSON.parse(r.lots); } catch { return [r.lots]; } })();
                                                  const ents = (() => { try { return JSON.parse(r.entreprises); } catch { return [r.entreprises]; } })();
                                                  return [...(Array.isArray(lots) ? lots : []), ...(Array.isArray(ents) ? ents : [])].filter(Boolean).join(', ') || '—';
                                                })()}
                                              </td>
                                              <td className={cn("px-4 py-2 font-medium", isEnRetard ? "text-red-600 font-bold" : "text-[var(--tblr-muted)]")}>
                                                {r.due_date ? new Date(r.due_date).toLocaleDateString('fr-FR') : '—'}
                                                {isEnRetard && ' ⚠'}
                                              </td>
                                              <td className="px-4 py-2">
                                                <select
                                                  value={r.status}
                                                  onChange={async (e) => {
                                                    const newStatus = e.target.value;
                                                    await fetch(`/api/reserves/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...r, status: newStatus }) });
                                                    setReserves(prev => prev.map(rv => rv.id === r.id ? { ...rv, status: newStatus as Reserve['status'] } : rv));
                                                  }}
                                                  className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border-0 outline-none cursor-pointer", statusColors[r.status] || 'bg-zinc-100 text-zinc-600')}
                                                >
                                                  <option value="A faire">À faire</option>
                                                  <option value="En cours">En cours</option>
                                                  <option value="Levée">Levée</option>
                                                  <option value="Quitus Transmis">Quitus Transmis</option>
                                                  <option value="Refusée par l'entreprise">Refusée entreprise</option>
                                                  <option value="Levée refusée par le MOE">Refusée MOE</option>
                                                </select>
                                              </td>
                                              <td className="px-4 py-2 text-right">
                                                <button
                                                  onClick={async () => {
                                                    if (!confirm('Supprimer cette réserve ?')) return;
                                                    await fetch(`/api/reserves/${r.id}`, { method: 'DELETE' });
                                                    setReserves(prev => prev.filter(rv => rv.id !== r.id));
                                                  }}
                                                  className="p-1 text-zinc-300 hover:text-red-500 transition-colors"
                                                >
                                                  <IconTrash size={12} />
                                                </button>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                            </React.Fragment>
                          );
                        })}
                        {receptions.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucun PV de réception. Cliquez sur "Créer PV de réception" pour commencer.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* DOE — Dossier des Ouvrages Exécutés */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconClipboardCheck}
                    title="DOE — Dossier des Ouvrages Exécutés"
                    description="Le DOE regroupe les plans conformes à exécution, notices de fonctionnement et documents remis en fin de chantier."
                    action={
                    <div>
                      <input type="file" className="hidden" ref={doeInputRef} onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !id) return;
                        setDoeUploading(true);
                        try {
                          const form = new FormData();
                          form.append('file', file);
                          form.append('name', file.name);
                          form.append('project_id', id);
                          form.append('doc_type', 'DOE');
                          form.append('category', 'DOE');
                          const res = await fetch('/api/documents', { method: 'POST', body: form });
                          if (res.ok) {
                            await fetchDoeDocuments();
                          }
                        } catch (err) { console.error(err); } finally {
                          setDoeUploading(false);
                          if (doeInputRef.current) doeInputRef.current.value = '';
                        }
                      }} />
                      <button
                        onClick={() => doeInputRef.current?.click()}
                        disabled={doeUploading}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                      >
                        <IconFilePlus size={14} />
                        {doeUploading ? 'Upload...' : 'Ajouter document DOE'}
                      </button>
                    </div>
                    }
                  />
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left">Nom</th>
                          <th className="px-6 py-3 text-left">Type</th>
                          <th className="px-6 py-3 text-left">Date</th>
                          <th className="px-6 py-3 text-right w-24">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--tblr-border)]">
                        {doeDocuments.map((doc) => (
                          <tr key={doc.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors group">
                            <td className="px-6 py-4 font-medium text-[var(--tblr-text)]">{doc.name}</td>
                            <td className="px-6 py-4">
                              <span className="px-2 py-0.5 bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] rounded text-[10px] font-bold">
                                {doc.category || 'DOE'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 text-xs">{new Date(doc.uploaded_at).toLocaleDateString('fr-FR')}</td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="p-1.5 text-[var(--tblr-muted)] hover:text-blue-600 transition-colors" title="Télécharger">
                                  <IconExternalLink size={15} />
                                </a>
                                <button
                                  onClick={async () => {
                                    if (!confirm('Supprimer ce document DOE ?')) return;
                                    try {
                                      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
                                      if (res.ok) setDoeDocuments(prev => prev.filter(d => d.id !== doc.id));
                                    } catch (err) { console.error(err); }
                                  }}
                                  className="p-1.5 text-[var(--tblr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                  title="Supprimer"
                                >
                                  <IconTrash size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {doeDocuments.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucun document DOE. Ajoutez les plans conformes à exécution.</td>
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
                    <div className="rounded-lg overflow-hidden mt-8" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <CardHeader
                        className="p-4 sm:p-6"
                        icon={IconClipboardCheck}
                        title="Plans de l'opération"
                        action={
                        <div className="flex items-center gap-2 shrink-0">
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
                            className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all whitespace-nowrap"
                          >
                            <IconUpload size={14} />
                            <span className="hidden sm:inline">Importer un plan</span>
                            <span className="sm:hidden">Importer</span>
                          </button>
                        </div>
                        }
                      />
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[10px] tracking-wider">
                            <tr>
                              <th className="px-6 py-3 text-left">Nom</th>
                              <th className="px-6 py-3 text-left w-20">Indice</th>
                              <th className="px-6 py-3 text-left">Date</th>
                              <th className="px-6 py-3 text-right w-24">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--tblr-border)]">
                            {aorPlans
                              .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
                              .map((plan) => (
                              <tr key={plan.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors group">
                                <td className="px-6 py-4 font-bold text-[var(--tblr-text)]">{plan.name}</td>
                                <td className="px-6 py-4">
                                  <span className="px-2 py-0.5 bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] rounded text-[10px] font-bold">
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
                                      className="p-2 text-[var(--tblr-muted)] hover:text-blue-600 transition-colors"
                                    >
                                      <IconRefresh size={16} />
                                    </button>
                                    <a href={plan.file_url} target="_blank" rel="noopener noreferrer" className="p-2 text-[var(--tblr-muted)] hover:text-blue-600 transition-colors">
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
                                      className="p-2 text-[var(--tblr-muted)] hover:text-red-600 transition-colors"
                                    >
                                      <IconTrash size={16} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {aorPlans.length === 0 && (
                              <tr>
                                <td colSpan={4} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucun plan de l'opération.</td>
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
            {activeTab === 'SIT' && project.is_chantier && (
              <div className="mt-2">
                <Situations projectId={id!} />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* AR Modal */}
      <AnimatePresence>
        {arOsTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-lg shadow-2xl p-6"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
            >
              <h3 className="text-sm font-bold text-[var(--tblr-text)] mb-4">
                Accusé de réception — OS N° {arOsTarget.os_number}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase block mb-1">Date d'AR *</label>
                  <input type="date" value={arForm.date_ar} onChange={e => setArForm(f => ({...f, date_ar: e.target.value}))}
                    className="w-full bg-white dark:bg-zinc-800 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase block mb-1">Date d'exécution prévue</label>
                  <input type="date" value={arForm.date_execution} onChange={e => setArForm(f => ({...f, date_execution: e.target.value}))}
                    className="w-full bg-white dark:bg-zinc-800 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase block mb-1">Notes</label>
                  <textarea rows={3} value={arForm.notes_ar} onChange={e => setArForm(f => ({...f, notes_ar: e.target.value}))}
                    className="w-full bg-white dark:bg-zinc-800 border border-[var(--tblr-border)] rounded-lg p-2 text-sm resize-none outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div className="flex gap-2 mt-5 justify-end">
                <button onClick={() => setArOsTarget(null)}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                  Annuler
                </button>
                <button onClick={handleArSubmit} disabled={arSaving || !arForm.date_ar}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-all">
                  {arSaving ? 'Enregistrement…' : 'Confirmer AR'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ContactModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
        onSuccess={(newContact) => {
          setContacts(prev => [...prev, newContact]);
          setProject(prev => prev ? ({
            ...prev,
            client: newContact.company_name || `${newContact.first_name} ${newContact.last_name}`
          }) : prev);
          fetchContacts();
        }}
      />
    </div>
  );
}
