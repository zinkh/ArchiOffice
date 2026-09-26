import * as React from 'react';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IconPlus, IconFileSpreadsheet, IconCircleCheck, IconClock, IconX, IconTrash, IconDeviceFloppy, IconSearch, IconFilter, IconEdit, IconFileText, IconFileTypePdf, IconContract } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { launchOriginRef } from '../lib/launchOrigin';
import { formatCurrency, cn } from '../lib/utils';
import { fetchJson } from '../lib/api';
import type { Proposal, Contact, Milestone, MiqcpAssessment } from '../types';
import { useTranslation } from 'react-i18next';
import { GeoportailMap, GeorisquesMap, GeorisquesInfo, RNBInfo, BDNBInfo } from '../components/LocationMaps';
import type { CadastreParcel } from '../components/MapLibreCadastre';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import { ContactModal } from '../components/ContactModal';
import { CONTACT_CATEGORY_CLIENT, CONTACT_CATEGORY_COTRAITANT } from '../lib/contactCategories';
import { CompanyAutocomplete } from '../components/CompanyAutocomplete';
import { CadastreDownload } from '../components/CadastreDownload';
import { UrbanPlanningInfo } from '../components/UrbanPlanningInfo';
import { HistoricalMonuments } from '../components/HistoricalMonuments';
import { InfoPanelBoundary } from '../components/InfoPanelBoundary';
import MilestoneGantt from '../components/MilestoneGantt';
import { MobileAccordionTable } from '../components/MobileAccordionTable';
import CorrespondenceTab from '../components/CorrespondenceTab';
import { Pagination } from '../components/ui/Pagination';
import { usePagination } from '../hooks/usePagination';
import { ProposalExportModal } from '../components/ProposalExportModal';
import { MAF_INTERCALAIRE_OPTIONS, TAUX_MISSION_OPTIONS } from '../lib/mafUtils';
import { useMafCost } from '../hooks/useMafCost';
import { useSettings } from '../hooks/useSettings';
import { MafCostBadge } from '../components/MafCostBadge';
import { MiqcpComplexityWizardModal } from '../components/MiqcpComplexityWizardModal';
import { MIQCP_PHASE_REPARTITION_GUIDE } from '../lib/miqcpGuide';
import { DEFAULT_MISSIONS, calculateFeeRatios, defaultFeeDistribution, exportFeeDistributionToXlsx } from '../lib/feeDistribution';
import { FeeDistributionGrid } from '../components/FeeDistributionGrid';

const fieldStyle = { background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };

const FormField = ({ label, value, onChange, type = "text", required = false, options = [], id }: any) => (
  <div>
    <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    {type === "select" ? (
      <select
        id={id}
        required={required}
        className="w-full px-3 py-2 rounded-lg outline-none text-sm"
        style={fieldStyle}
        value={(typeof value === 'number' && isNaN(value)) ? '' : (value ?? '')}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">Select...</option>
        {options.map((opt: any) => (
          <option key={opt.id || opt} value={opt.id || opt}>{opt.name || opt}</option>
        ))}
      </select>
    ) : type === "textarea" ? (
      <textarea
        id={id}
        className="w-full px-3 py-2 rounded-lg outline-none text-sm resize-none h-20"
        style={fieldStyle}
        value={(typeof value === 'number' && isNaN(value)) ? '' : (value ?? '')}
        onChange={e => onChange(e.target.value)}
      />
    ) : type === "checkbox" ? (
      <div className="flex items-center h-9">
        <input
          id={id}
          type="checkbox"
          className="w-4 h-4 rounded"
          checked={!!value}
          onChange={e => onChange(e.target.checked)}
        />
      </div>
    ) : (
      <input
        id={id}
        type={type}
        required={required}
        className="w-full px-3 py-2 rounded-lg outline-none text-sm"
        style={fieldStyle}
        value={(typeof value === 'number' && isNaN(value)) ? '' : (value ?? '')}
        onChange={e => onChange(e.target.value)}
      />
    )}
  </div>
);

export default function Proposals() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [contactModalContext, setContactModalContext] = useState<{ type: 'client' } | { type: 'specialty'; idx: number } | null>(null);
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [selectedParcelGeometry, setSelectedParcelGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [exportProposal, setExportProposal] = useState<Proposal | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const initialProposalState: Partial<Proposal> = {
    title: '',
    client_id: '',
    amount: 0,
    description: '',
    status: 'Draft',
    reference: '',
    projet_detail: '',
    is_entreprise: false,
    nom_societe: '',
    rcs: '',
    representant: '',
    qualite: '',
    adresse_client: '',
    cp_client: '',
    ville_client: '',
    telephone: '',
    portable: '',
    email_client: '',
    adresse_terrain: '',
    cp_ville_terrain: '',
    site_postcode: '',
    site_city: '',
    ref_cadastrale: '',
    zone_plu: '',
    surface_parcelle: '',
    nom_etablissement: '',
    avant_trav: '',
    apres_trav: '',
    type_et_cat: '',
    type_projet: '',
    categorie_projet: '',
    surface_plancher: '',
    surface_plancher_ext: '',
    surface_erp: '',
    surface_ert: '',
    effectif_public: '',
    effectif_personnel: '',
    ind: 'A',
    date_modification: new Date().toLocaleDateString('fr-FR'),
    maf_intercalaire: undefined,
    taux_mission: undefined,
    specialties_list: [],
    fee_distribution: JSON.stringify({ 
      missions: DEFAULT_MISSIONS.map(m => ({ 
        ...m, 
        amount: m.default_pct ? (0 * (m.default_pct / 100)) : 0,
        percentages: {} 
      })) 
    }),
    construction_cost: 0,
    ratio_rehab: 0,
    ratio_extension: 0,
    complexity_rate: 1,
    base_fee_percent: 0,
    vat_rate: 20,
    decimal_precision: 2
  };
  const [newProposal, setNewProposal] = useState<Partial<Proposal>>(initialProposalState);
  const [costMode, setCostMode] = useState<'manual' | 'ratio'>('manual');
  const [isMiqcpWizardOpen, setIsMiqcpWizardOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { settings } = useSettings();
  const mafCost = useMafCost({
    project: newProposal,
    proposal: newProposal,
    mafEnabled: !!(settings as any)?.maf_enabled,
    tauxContratPermil: parseFloat((settings as any)?.maf_taux_contrat_permil ?? 0),
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        const [proposalsData, contactsData, milestonesData] = await Promise.all([
          fetchJson<Proposal[]>('/api/proposals'),
          fetchJson<Contact[]>('/api/contacts'),
          fetchJson<Milestone[]>('/api/milestones')
        ]);
        setProposals(proposalsData);
        setContacts(contactsData);
        setMilestones(milestonesData);
      } catch (err) {
        console.error('Proposals data fetch failed:', err);
      }
    };
    loadData();
  }, []);

  // Lien direct depuis un agent (?open=<id>, voir recordLinks.ts côté
  // serveur) : ouvre la même modale qu'un clic sur la ligne.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId || proposals.length === 0) return;
    const proposal = proposals.find(p => p.id === openId);
    if (proposal) handleEditClick(proposal);
    setSearchParams(prev => { prev.delete('open'); return prev; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals, searchParams]);

  const fetchMilestones = async () => {
    try {
      const data = await fetchJson<Milestone[]>('/api/milestones');
      setMilestones(data);
    } catch (err) {
      console.error('Milestones fetch failed:', err);
    }
  };

  const fetchProposals = async () => {
    try {
      const data = await fetchJson<Proposal[]>('/api/proposals');
      setProposals(data);
    } catch (err) {
      console.error('Proposals fetch failed:', err);
    }
  };

  const fetchContacts = async () => {
    try {
      const data = await fetchJson<Contact[]>('/api/contacts');
      setContacts(data);
    } catch (err) {
      console.error('Contacts fetch failed:', err);
    }
  };

  const handleSubmitProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    try {
      const url = editingProposal ? `/api/proposals/${editingProposal.id}` : '/api/proposals';
      const method = editingProposal ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProposal)
      });
      if (res.ok) {
        const saved = await res.json();
        if (editingProposal) {
          setProposals(proposals.map(p => p.id === saved.id ? saved : p));
        } else {
          setProposals([saved, ...proposals]);
        }
        setIsModalOpen(false);
        setEditingProposal(null);
        setNewProposal(initialProposalState);
        setCostMode('manual');
      } else {
        const errBody = await res.json().catch(() => ({ error: `Erreur HTTP ${res.status}` }));
        setSubmitError(errBody.error || `Erreur HTTP ${res.status}`);
      }
    } catch (err: any) {
      console.error(err);
      setSubmitError(err.message || 'Erreur réseau');
    }
  };

  const handleEditClick = (proposal: Proposal) => {
    setEditingProposal(proposal);
    setNewProposal(proposal);
    setCostMode((proposal.ratio_rehab || proposal.ratio_extension) ? 'ratio' : 'manual');
    setSubmitError(null);
    setIsModalOpen(true);
  };

  const handleOpenCreateModal = () => {
    setEditingProposal(null);
    setNewProposal(initialProposalState);
    setCostMode('manual');
    setSubmitError(null);
    setIsModalOpen(true);
  };

  const handleUpdateStatus = async (proposal: Proposal, newStatus: Proposal['status']) => {
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...proposal, status: newStatus })
      });
      if (res.ok) {
        const updated = await res.json();
        setProposals(proposals.map(p => p.id === updated.id ? updated : p));
        if (newStatus === 'Accepted') {
          alert(t('proposals_accepted_project_created'));
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // A draft was never sent to the client, so there's nothing to "reject" —
  // deleting it outright makes more sense than marking it Rejected. Once a
  // proposal has actually been sent, delete no longer applies (server also
  // enforces this): the cross instead rejects it, keeping a record of it.
  const handleCrossClick = async (proposal: Proposal) => {
    if (proposal.status !== 'Draft') {
      return handleUpdateStatus(proposal, 'Rejected');
    }
    if (!confirm(t('proposals_confirm_delete_draft', { title: proposal.title }))) return;
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, { method: 'DELETE' });
      if (res.ok) {
        setProposals(proposals.filter(p => p.id !== proposal.id));
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(t('proposals_delete_failed', { error: errorData.error || t('proposals_unknown_error') }));
      }
    } catch (err) {
      console.error(err);
      alert(t('proposals_delete_failed_generic'));
    }
  };

  const addSpecialtyRow = () => {
    const newList = [...(newProposal.specialties_list || []), { id: `new-${Date.now()}`, proposal_id: '', specialty_name: '', contact_id: '' }];
    setNewProposal({ ...newProposal, specialties_list: newList });
  };

  const removeSpecialtyRow = (index: number) => {
    const newList = (newProposal.specialties_list || []).filter((_, i) => i !== index);
    setNewProposal({ ...newProposal, specialties_list: newList });
  };

  const updateSpecialty = (index: number, field: string, value: string | number) => {
    const newList = [...(newProposal.specialties_list || [])];
    newList[index] = { ...newList[index], [field]: value } as any;
    setNewProposal({ ...newProposal, specialties_list: newList });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/proposals/import', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        fetchProposals();
        alert(t('proposals_import_success'));
      } else {
        alert(t('proposals_import_failed'));
      }
    } catch (err) {
      console.error(err);
      alert(t('proposals_import_error'));
    }
  };

  const handleExport = (id: string) => {
    window.location.href = `/api/proposals/${id}/export`;
  };

  const filteredProposals = proposals.filter(p =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.client_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.reference?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const proposalsPagination = usePagination(filteredProposals);


  const feeRatios = React.useMemo(() => calculateFeeRatios(newProposal.fee_distribution), [newProposal.fee_distribution]);
  const calculatedExePercent = (newProposal.base_fee_percent || 0) * feeRatios.exeRatio;
  const calculatedTotalPercent = (newProposal.base_fee_percent || 0) * feeRatios.totalRatio;

  const miqcpAssessment: MiqcpAssessment | null = React.useMemo(() => {
    if (!newProposal.miqcp_assessment) return null;
    try { return JSON.parse(newProposal.miqcp_assessment); } catch { return null; }
  }, [newProposal.miqcp_assessment]);

  const handleApplyMiqcpAssessment = (result: { complexityRate: number; baseFeePercent: number; assessment: MiqcpAssessment }) => {
    setNewProposal(prev => ({
      ...prev,
      complexity_rate: result.complexityRate,
      base_fee_percent: result.baseFeePercent,
      miqcp_assessment: JSON.stringify(result.assessment),
      construction_cost: result.assessment.montantTravauxHT,
    }));
    setIsMiqcpWizardOpen(false);
  };

  const handleLoadMiqcpPhaseRepartition = () => {
    const currentData = newProposal.fee_distribution ? JSON.parse(newProposal.fee_distribution) : { missions: DEFAULT_MISSIONS.map(m => ({ ...m, percentages: {} })) };
    const baseTotal = newProposal.amount || 0;
    const precision = newProposal.decimal_precision ?? 2;
    const missions = (currentData.missions || []).map((m: any) => {
      const guidePct = MIQCP_PHASE_REPARTITION_GUIDE.find(p => p.id === m.id)?.pct;
      if (guidePct === undefined) return m;
      return { ...m, default_pct: guidePct, amount: Number((baseTotal * (guidePct / 100)).toFixed(precision)) };
    });
    setNewProposal(prev => ({ ...prev, fee_distribution: JSON.stringify({ ...currentData, missions }) }));
  };

  const vatAmount = (newProposal.amount || 0) * ((newProposal.vat_rate || 0) / 100);
  const totalTTC = (newProposal.amount || 0) + vatAmount;

  // Auto-calculate construction_cost from ratio fields when in ratio mode
  useEffect(() => {
    if (costMode !== 'ratio') return;
    const surfExist = parseFloat(newProposal.surface_plancher as string) || 0;
    const surfExt = parseFloat(newProposal.surface_plancher_ext as string) || 0;
    const ratioRehab = newProposal.ratio_rehab || 0;
    const ratioExt = newProposal.ratio_extension || 0;
    const computed = surfExist * ratioRehab + surfExt * ratioExt;
    if (Math.abs(computed - (newProposal.construction_cost || 0)) > 0.01) {
      setNewProposal(prev => ({ ...prev, construction_cost: Number(computed.toFixed(2)) }));
    }
  }, [costMode, newProposal.surface_plancher, newProposal.surface_plancher_ext, newProposal.ratio_rehab, newProposal.ratio_extension]);

  // Auto-calculate amount if factors change
  useEffect(() => {
    if (newProposal.construction_cost && newProposal.complexity_rate && newProposal.base_fee_percent) {
      const calculatedAmount = newProposal.construction_cost * (newProposal.base_fee_percent / 100) * newProposal.complexity_rate;
      if (Math.abs(calculatedAmount - (newProposal.amount || 0)) > 0.01) {
        setNewProposal(prev => ({ ...prev, amount: Number(calculatedAmount.toFixed(2)) }));
      }
    }
  }, [newProposal.construction_cost, newProposal.complexity_rate, newProposal.base_fee_percent]);

  // Sync base missions with global amount
  useEffect(() => {
    if (!newProposal.fee_distribution) return;
    try {
      const data = JSON.parse(newProposal.fee_distribution);
      const missions = data.missions || [];
      const baseMissions = missions.filter((m: any) => m.category === 'Mission base');
      
      if (baseMissions.length === 0) return;

      const currentBaseTotal = baseMissions.reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
      const targetBaseTotal = newProposal.amount || 0;

      if (Math.abs(currentBaseTotal - targetBaseTotal) > 0.01) {
        const updatedMissions = missions.map((m: any) => {
          if (m.category === 'Mission base') {
            // If there's only one mission, it gets the full amount
            if (baseMissions.length === 1) {
              return { ...m, amount: targetBaseTotal };
            }
            // If current total is 0, use default percentages
            if (currentBaseTotal === 0) {
              const defaultPct = DEFAULT_MISSIONS.find(dm => dm.id === m.id)?.default_pct || (100 / baseMissions.length);
              return { ...m, amount: Number((targetBaseTotal * (defaultPct / 100)).toFixed(newProposal.decimal_precision || 2)) };
            }
            // Otherwise distribute based on relative percentage
            const relPct = (m.amount || 0) / currentBaseTotal;
            return { ...m, amount: Number((targetBaseTotal * relPct).toFixed(newProposal.decimal_precision || 2)) };
          }
          return m;
        });
        setNewProposal(prev => ({ ...prev, fee_distribution: JSON.stringify({ ...data, missions: updatedMissions }) }));
      }
    } catch (e) {}
  }, [newProposal.amount, newProposal.decimal_precision]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('proposals')}</h1>
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('proposals_subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => document.getElementById('xml-file-upload')?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold transition-all"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
          >
            <IconFileText size={18} />
            {t('proposals_import_xml')}
          </button>
          <input id="xml-file-upload" type="file" className="hidden" accept=".xml" onChange={handleImport} />
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold transition-all active:scale-95"
            style={{ background: 'var(--tblr-primary)', color: '#fff' }}
          >
            <IconPlus size={20} />
            {t('proposals_create_btn')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 p-4 rounded-lg" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2" size={18} style={{ color: 'var(--tblr-muted)' }} />
          <input
            type="text"
            placeholder={t('proposals_search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
        </div>
      </div>

      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        {/* Mobile accordion */}
        <div className="md:hidden">
          <MobileAccordionTable
            data={proposalsPagination.pageItems}
            keyField="id"
            emptyText={t('proposals_no_proposals')}
            columns={[
              { label: t('proposals_col_proposal'), primary: true, render: p => (
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--tblr-text)' }}>{p.title}</p>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{p.reference}</p>
                </div>
              )},
              { label: t('proposals_col_client'), render: p => p.client_name || 'Unknown' },
              { label: t('proposals_col_amount'), render: p => <span className="font-mono font-bold">{formatCurrency(p.amount)}</span> },
              { label: t('proposals_col_status'), render: p => (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{
                  background: p.status === 'Accepted' ? 'rgba(47,179,135,0.1)' : p.status === 'Rejected' ? 'rgba(214,57,57,0.1)' : p.status === 'Sent' ? 'var(--tblr-primary-lt)' : 'var(--tblr-surface-2)',
                  color: p.status === 'Accepted' ? 'var(--tblr-success)' : p.status === 'Rejected' ? 'var(--tblr-danger)' : p.status === 'Sent' ? 'var(--tblr-primary)' : 'var(--tblr-muted)',
                  border: '1px solid currentColor',
                }}>{p.status}</span>
              )},
            ]}
            actions={p => (
              <div className="flex gap-2">
                <button onClick={() => handleEditClick(p)} className="p-1.5 rounded-lg" style={{ color: 'var(--tblr-muted)', background: 'var(--tblr-surface)' }}><IconEdit size={15} /></button>
                <button onClick={() => setExportProposal(p)} title="Export PDF" className="p-1.5 rounded-lg" style={{ color: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)' }}><IconFileTypePdf size={15} /></button>
                {p.status !== 'Accepted' && <button onClick={() => handleUpdateStatus(p, 'Accepted')} className="p-1.5 rounded-lg" style={{ color: 'var(--tblr-success)', background: 'rgba(47,179,135,0.1)' }}><IconCircleCheck size={15} /></button>}
              </div>
            )}
          />
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('proposals_col_proposal')}</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('proposals_col_client')}</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('proposals_col_amount')}</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('proposals_col_status')}</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-right" style={{ color: 'var(--tblr-muted)' }}>{t('proposals_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {proposalsPagination.pageItems.map((proposal) => (
                <tr
                  key={proposal.id}
                  style={{ borderBottom: '1px solid var(--tblr-border)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
                        <IconFileSpreadsheet size={20} />
                      </div>
                      <div>
                        <p className="font-semibold text-sm" style={{ color: 'var(--tblr-text)' }}>{proposal.title}</p>
                        <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{proposal.reference}</p>
                        <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>Created {new Date(proposal.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-medium text-sm" style={{ color: 'var(--tblr-muted)' }}>
                    {proposal.client_name || 'Unknown Client'}
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-sm" style={{ color: 'var(--tblr-text)' }}>
                    {formatCurrency(proposal.amount)}
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{
                      background: proposal.status === 'Accepted' ? 'rgba(47,179,135,0.1)' : proposal.status === 'Rejected' ? 'rgba(var(--tblr-danger-rgb,214,57,57),0.1)' : proposal.status === 'Sent' ? 'var(--tblr-primary-lt)' : 'var(--tblr-surface-2)',
                      color: proposal.status === 'Accepted' ? 'var(--tblr-success)' : proposal.status === 'Rejected' ? 'var(--tblr-danger)' : proposal.status === 'Sent' ? 'var(--tblr-primary)' : 'var(--tblr-muted)',
                      border: '1px solid currentColor',
                    }}>
                      {proposal.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleEditClick(proposal)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--tblr-muted)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                        title="Edit Proposal"
                      >
                        <IconEdit size={20} />
                      </button>
                      <button
                        onClick={() => handleExport(proposal.id)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--tblr-muted)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                        title="Export XML"
                      >
                        <IconFileText size={20} />
                      </button>
                      <button
                        onClick={() => setExportProposal(proposal)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        title={t('pdf_generator')}
                      >
                        <IconFileTypePdf size={20} />
                      </button>
                      <button
                        onClick={() => navigate('/contrats', { state: { fromProposal: proposal } })}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                        title="Convertir en contrat MOE"
                      >
                        <IconContract size={20} />
                      </button>
                      {proposal.status !== 'Accepted' && (
                        <>
                          <button 
                            onClick={() => handleUpdateStatus(proposal, 'Accepted')}
                            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                            title="Accept & Create Project"
                          >
                            <IconCircleCheck size={20} />
                          </button>
                          <button
                            onClick={() => handleCrossClick(proposal)}
                            className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            title={proposal.status === 'Draft' ? 'Supprimer le brouillon' : 'Rejeter'}
                          >
                            <IconX size={20} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredProposals.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center" style={{ color: 'var(--tblr-muted)' }}>
                    {t('proposals_no_proposals')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={proposalsPagination.currentPage}
          totalPages={proposalsPagination.totalPages}
          totalItems={proposalsPagination.totalItems}
          pageSize={proposalsPagination.pageSize}
          onPageChange={proposalsPagination.setPage}
          className="border-t"
          style={{ borderColor: 'var(--tblr-border)' }}
        />
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              ref={launchOriginRef}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="rounded-lg shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
            >
              <div className="p-6 flex items-center justify-between" style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                <div>
                  <h2 className="text-base font-semibold" style={{ color: 'var(--tblr-text)' }}>
                    {editingProposal ? t('proposals_edit_title') : t('proposals_new_title')}
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                    {editingProposal ? t('proposals_edit_subtitle') : t('proposals_new_subtitle')}
                  </p>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 rounded-full transition-colors" style={{ color: 'var(--tblr-muted)' }}>
                  <IconX size={24} />
                </button>
              </div>
              
              <form id="proposal-form" onSubmit={handleSubmitProposal} className="flex-1 overflow-y-auto p-6 pb-64 space-y-8 no-scrollbar">
                {/* Section 1: General Info */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">01</span>
                    {t('proposals_section_general')}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField label="Référence" value={newProposal.reference} onChange={(v: any) => setNewProposal(prev => ({...prev, reference: v}))} />
                    <div className="md:col-span-2">
                      <FormField label="Projet (Titre)" required value={newProposal.title} onChange={(v: any) => setNewProposal(prev => ({...prev, title: v}))} />
                    </div>
                    <FormField label="Status" type="select" options={['Draft', 'Sent', 'Accepted', 'Rejected']} value={newProposal.status} onChange={(v: any) => setNewProposal(prev => ({...prev, status: v}))} />
                    <FormField label="Ind" value={newProposal.ind} onChange={(v: any) => setNewProposal(prev => ({...prev, ind: v}))} />
                  </div>
                </div>

                {/* Section 2: Client Details */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">02</span>
                    {t('proposals_section_client')}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30">
                      <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
                        Client Database <span className="text-red-500">*</span>
                      </label>
                      <ContactAutocomplete 
                        contacts={contacts}
                        value={newProposal.client_id || ''}
                        onChange={(v: any) => {
                          const contact = contacts.find(c => c.id === v);
                          if (contact) {
                            setNewProposal(prev => ({
                              ...prev,
                              client_id: v,
                              adresse_client: contact.address || contact.address_work_street || '',
                              cp_client: contact.zip || contact.address_work_zip || '',
                              ville_client: contact.city || contact.address_work_city || '',
                              telephone: contact.phone || contact.phone_work || '',
                              portable: contact.phone_mobile || '',
                              email_client: contact.email || contact.email_work || ''
                            }));
                          } else {
                            setNewProposal(prev => ({...prev, client_id: v}));
                          }
                        }}
                        onAddNew={() => { setContactModalContext({ type: 'client' }); setIsContactModalOpen(true); }}
                        addNewLabel="Add New Client"
                      />
                    </div>
                    <FormField label="Entreprise?" type="checkbox" value={newProposal.is_entreprise} onChange={(v: any) => setNewProposal(prev => ({...prev, is_entreprise: v}))} />
                    <CompanyAutocomplete 
                      label="Nom Société" 
                      value={newProposal.nom_societe || ''} 
                      onChange={(val, details) => {
                        if (details) {
                          setNewProposal(prev => ({
                            ...prev,
                            nom_societe: val,
                            rcs: details.siren || details.siret || '',
                            adresse_client: details.address || '',
                            cp_client: details.zipcode || '',
                            ville_client: details.city || '',
                            is_entreprise: true
                          }));
                        } else {
                          setNewProposal(prev => ({...prev, nom_societe: val}));
                        }
                      }} 
                    />
                    <FormField label="RCS / SIRET" value={newProposal.rcs} onChange={(v: any) => setNewProposal(prev => ({...prev, rcs: v}))} />
                    <FormField label="Représentant" value={newProposal.representant} onChange={(v: any) => setNewProposal(prev => ({...prev, representant: v}))} />
                    <FormField label="Qualité" value={newProposal.qualite} onChange={(v: any) => setNewProposal(prev => ({...prev, qualite: v}))} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField 
                        id="client-address"
                        label="Adresse Client" 
                        value={newProposal.adresse_client || ''} 
                        onChange={(v: any) => setNewProposal(prev => ({...prev, adresse_client: v}))} 
                      />
                      <FormField 
                        label="Code Postal Client" 
                        value={newProposal.cp_client || ''} 
                        onChange={(v: any) => setNewProposal(prev => ({...prev, cp_client: v}))} 
                      />
                      <FormField 
                        label="Ville Client" 
                        value={newProposal.ville_client || ''} 
                        onChange={(v: any) => setNewProposal(prev => ({...prev, ville_client: v}))} 
                      />
                    </div>
                    <FormField label="Téléphone" value={newProposal.telephone} onChange={(v: any) => setNewProposal(prev => ({...prev, telephone: v}))} />
                    <FormField label="Portable" value={newProposal.portable} onChange={(v: any) => setNewProposal(prev => ({...prev, portable: v}))} />
                    <FormField label="Adresse Mail" type="email" value={newProposal.email_client} onChange={(v: any) => setNewProposal(prev => ({...prev, email_client: v}))} />
                  </div>
                </div>

                {/* Section 3: Project Specifics */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">03</span>
                    {t('proposals_section_project')}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label="Détail du Projet" type="textarea" value={newProposal.projet_detail} onChange={(v: any) => setNewProposal(prev => ({...prev, projet_detail: v}))} />
                    <FormField label="Description Générale" type="textarea" value={newProposal.description} onChange={(v: any) => setNewProposal(prev => ({...prev, description: v}))} />
                  </div>
                </div>

                {/* Section 4: Terrain & Technical */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">04</span>
                    {t('proposals_section_terrain')}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-3 space-y-4">
                      <AddressAutocomplete 
                        id="terrain-address"
                        label="Adresse Complète Terrain" 
                        value={newProposal.adresse_terrain || ''} 
                        onChange={(val: string) => {
                          setNewProposal(prev => {
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
                          setNewProposal(prev => ({
                            ...prev, 
                            adresse_terrain: details.fullAddress,
                            cp_ville_terrain: `${details.zipcode || ''} ${details.city || ''}`.trim(),
                            site_postcode: details.zipcode || '',
                            site_city: details.city || '',
                            ban_id_terrain: details.banId || '',
                            city_code_terrain: details.cityCode || ''
                          }));
                        }} 
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField label="Code Postal Terrain" value={newProposal.site_postcode} onChange={(v: any) => setNewProposal(prev => ({...prev, site_postcode: v}))} />
                        <FormField label="Ville Terrain" value={newProposal.site_city} onChange={(v: any) => setNewProposal(prev => ({...prev, site_city: v}))} />
                      </div>
                    </div>
                    <FormField label="Référence Cadastrale" value={newProposal.ref_cadastrale} onChange={(v: any) => setNewProposal(prev => ({...prev, ref_cadastrale: v}))} />
                    <FormField label="Zone PLU" value={newProposal.zone_plu} onChange={(v: any) => setNewProposal(prev => ({...prev, zone_plu: v}))} />
                    <FormField label="Surface Parcelle" value={newProposal.surface_parcelle} onChange={(v: any) => setNewProposal(prev => ({...prev, surface_parcelle: v}))} />
                    <FormField label="Nom Etablissement" value={newProposal.nom_etablissement} onChange={(v: any) => setNewProposal(prev => ({...prev, nom_etablissement: v}))} />
                    <FormField label="Avant Travaux" value={newProposal.avant_trav} onChange={(v: any) => setNewProposal(prev => ({...prev, avant_trav: v}))} />
                    <FormField label="Après Travaux" value={newProposal.apres_trav} onChange={(v: any) => setNewProposal(prev => ({...prev, apres_trav: v}))} />
                    <FormField label="Type Et Cat" value={newProposal.type_et_cat} onChange={(v: any) => setNewProposal(prev => ({...prev, type_et_cat: v}))} />
                    <FormField label="Type" value={newProposal.type_projet} onChange={(v: any) => setNewProposal(prev => ({...prev, type_projet: v}))} />
                    <FormField label="Catégorie" value={newProposal.categorie_projet} onChange={(v: any) => setNewProposal(prev => ({...prev, categorie_projet: v}))} />
                    <FormField
                      label="Type de mission (circulaire MAF)"
                      type="select"
                      options={MAF_INTERCALAIRE_OPTIONS}
                      value={newProposal.maf_intercalaire}
                      onChange={(v: any) => setNewProposal(prev => ({ ...prev, maf_intercalaire: v || undefined, taux_mission: v === 'jaune' ? prev.taux_mission : undefined }))}
                    />
                    {newProposal.maf_intercalaire === 'jaune' && (
                      <FormField
                        label="Taux de la mission (T)"
                        type="select"
                        options={TAUX_MISSION_OPTIONS.map(o => ({ id: o.value, name: o.label }))}
                        value={newProposal.taux_mission}
                        onChange={(v: any) => setNewProposal(prev => ({ ...prev, taux_mission: v ? Number(v) : undefined }))}
                      />
                    )}
                  </div>
                  {mafCost && (
                    <div className="mt-2">
                      <MafCostBadge result={mafCost} showDetails />
                    </div>
                  )}
                </div>

                {/* Section 5: Surfaces & Capacity */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">05</span>
                    {t('proposals_section_surfaces')}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <FormField label="Surf. Plancher" value={newProposal.surface_plancher} onChange={(v: any) => setNewProposal(prev => ({...prev, surface_plancher: v}))} />
                    <FormField label="Surf. Extension" value={newProposal.surface_plancher_ext} onChange={(v: any) => setNewProposal(prev => ({...prev, surface_plancher_ext: v}))} />
                    <FormField label="Surf. ERP" value={newProposal.surface_erp} onChange={(v: any) => setNewProposal(prev => ({...prev, surface_erp: v}))} />
                    <FormField label="Surf. ERT" value={newProposal.surface_ert} onChange={(v: any) => setNewProposal(prev => ({...prev, surface_ert: v}))} />
                    <FormField label="Effectif Public" value={newProposal.effectif_public} onChange={(v: any) => setNewProposal(prev => ({...prev, effectif_public: v}))} />
                    <FormField label="Effectif Personnel" value={newProposal.effectif_personnel} onChange={(v: any) => setNewProposal(prev => ({...prev, effectif_personnel: v}))} />
                    <FormField label="Date Modif." value={newProposal.date_modification} onChange={(v: any) => setNewProposal(prev => ({...prev, date_modification: v}))} />
                  </div>
                </div>

                {/* Section 06: Risques */}
                {newProposal.adresse_terrain && (
                  <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-6">
                    <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">06</span>
                      {t('proposals_section_urban_risks')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <InfoPanelBoundary label="RNB"><RNBInfo address={newProposal.adresse_terrain || ''} /></InfoPanelBoundary>
                      <InfoPanelBoundary label="BDNB">
                        <BDNBInfo
                          address={newProposal.adresse_terrain || ''}
                          banId={newProposal.ban_id_terrain}
                          cityCode={newProposal.city_code_terrain}
                        />
                      </InfoPanelBoundary>
                      <InfoPanelBoundary label="Cadastre"><CadastreDownload address={newProposal.adresse_terrain || ''} /></InfoPanelBoundary>
                      <InfoPanelBoundary label="Urbanisme"><UrbanPlanningInfo address={newProposal.adresse_terrain || ''} geometry={selectedParcelGeometry} /></InfoPanelBoundary>
                      <InfoPanelBoundary label="Géorisques"><GeorisquesInfo address={newProposal.adresse_terrain || ''} banId={newProposal.ban_id_terrain} /></InfoPanelBoundary>
                      <InfoPanelBoundary label="Monuments historiques"><HistoricalMonuments address={newProposal.adresse_terrain || ''} /></InfoPanelBoundary>
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2 block">{t('proposals_maps_title')}</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-64">
                        <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative shadow-sm hover:shadow-md transition-shadow duration-300 group">
                          <InfoPanelBoundary label="Cadastre">
                            <GeoportailMap
                              address={newProposal.adresse_terrain || ''}
                              banId={newProposal.ban_id_terrain}
                              onParcelSelect={(parcel: CadastreParcel) => {
                                setSelectedParcelGeometry(parcel.geometry || null);
                                const reference = [
                                  parcel.prefixe && parcel.prefixe !== '000' ? parcel.prefixe : '',
                                  parcel.section,
                                  parcel.numero,
                                ].filter(Boolean).join(' ');
                                setNewProposal(prev => ({
                                  ...prev,
                                  ref_cadastrale: reference || prev.ref_cadastrale,
                                  surface_parcelle: parcel.contenance != null ? String(parcel.contenance) : prev.surface_parcelle,
                                }));
                              }}
                            />
                          </InfoPanelBoundary>
                          <div className="absolute top-2 left-2 px-2 py-1 bg-white/90 dark:bg-black/90 backdrop-blur-md rounded text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 shadow-sm z-10">
                            Vue aérienne · Cadastre
                          </div>
                        </div>
                        <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative shadow-sm hover:shadow-md transition-shadow duration-300 group">
                          <InfoPanelBoundary label="Géorisques"><GeorisquesMap address={newProposal.adresse_terrain || ''} banId={newProposal.ban_id_terrain} /></InfoPanelBoundary>
                          <div className="absolute top-2 left-2 px-2 py-1 bg-white/90 dark:bg-black/90 backdrop-blur-md rounded text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 shadow-sm z-10">Géorisques</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Section 07: Honoraires */}
                <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-6">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">07</span>
                    Honoraires
                  </h3>
                  {/* Mode selector for Montant des travaux */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Montant des travaux :</span>
                    <button
                      type="button"
                      onClick={() => setCostMode('manual')}
                      className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${costMode === 'manual' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
                    >
                      Saisie manuelle
                    </button>
                    <button
                      type="button"
                      onClick={() => setCostMode('ratio')}
                      className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${costMode === 'ratio' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
                    >
                      Calcul par ratio
                    </button>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setIsMiqcpWizardOpen(true)}
                      className="text-[10px] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded"
                    >
                      {t('miqcp_wizard_open_btn')}
                    </button>
                    {miqcpAssessment && (
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {t('miqcp_wizard_summary', {
                          cc: miqcpAssessment.coefficientComplexite.toFixed(2),
                          taux: miqcpAssessment.tauxReference.toFixed(2),
                        })}
                      </span>
                    )}
                  </div>
                  {costMode === 'manual' ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField label="Montant des travaux (€)" type="number" value={newProposal.construction_cost} onChange={(v: any) => setNewProposal(prev => ({...prev, construction_cost: Number(v)}))} />
                      <FormField label="Taux de complexité" type="number" value={newProposal.complexity_rate} onChange={(v: any) => setNewProposal(prev => ({...prev, complexity_rate: Number(v)}))} />
                      <FormField label="% Honoraires Base" type="number" value={newProposal.base_fee_percent} onChange={(v: any) => setNewProposal(prev => ({...prev, base_fee_percent: Number(v)}))} />
                    </div>
                  ) : (
                    <div className="space-y-3 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30">
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                        Montant des travaux = Surface existante × Ratio réhabilitation + Surface extension/neuf × Ratio extension
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Surface existante (m²)</label>
                          <div className="px-2 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs font-mono text-zinc-700 dark:text-zinc-300">
                            {newProposal.surface_plancher || '0'} m²
                            <span className="text-[9px] text-zinc-400 ml-1">(section 05)</span>
                          </div>
                        </div>
                        <FormField
                          label="Ratio réhab (€/m²)"
                          type="number"
                          value={newProposal.ratio_rehab}
                          onChange={(v: any) => setNewProposal(prev => ({...prev, ratio_rehab: Number(v)}))}
                        />
                        <div className="space-y-1">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Surface extension/neuf (m²)</label>
                          <div className="px-2 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs font-mono text-zinc-700 dark:text-zinc-300">
                            {newProposal.surface_plancher_ext || '0'} m²
                            <span className="text-[9px] text-zinc-400 ml-1">(section 05)</span>
                          </div>
                        </div>
                        <FormField
                          label="Ratio extension (€/m²)"
                          type="number"
                          value={newProposal.ratio_extension}
                          onChange={(v: any) => setNewProposal(prev => ({...prev, ratio_extension: Number(v)}))}
                        />
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Montant des travaux calculé :</span>
                        <span className="text-sm font-bold text-blue-700 dark:text-blue-400">
                          {(newProposal.construction_cost || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 border-t border-blue-100 dark:border-blue-900/30">
                        <FormField label="Taux de complexité" type="number" value={newProposal.complexity_rate} onChange={(v: any) => setNewProposal(prev => ({...prev, complexity_rate: Number(v)}))} />
                        <FormField label="% Honoraires Base" type="number" value={newProposal.base_fee_percent} onChange={(v: any) => setNewProposal(prev => ({...prev, base_fee_percent: Number(v)}))} />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField label="Montant Honoraires HT (€)" type="number" value={newProposal.amount} onChange={(v: any) => setNewProposal(prev => ({...prev, amount: Number(v)}))} />
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('proposals_pct_with_execution')}</label>
                      <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-medium text-zinc-900 dark:text-white">
                        {calculatedExePercent.toFixed(2)} %
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('proposals_pct_with_complementary')}</label>
                      <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-medium text-zinc-900 dark:text-white">
                        {calculatedTotalPercent.toFixed(2)} %
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField label="Taux de TVA (%)" type="number" value={newProposal.vat_rate} onChange={(v: any) => setNewProposal(prev => ({...prev, vat_rate: Number(v)}))} />
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Montant TVA (€)</label>
                      <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-medium text-zinc-900 dark:text-white">
                        {formatCurrency(vatAmount)}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Montant TTC (€)</label>
                      <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm font-bold text-blue-700 dark:text-blue-400">
                        {formatCurrency(totalTTC)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 08: Cotraitants / Spécialités */}
                <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">08</span>
                      {t('proposals_section_cotraitants')}
                    </h3>
                    <button
                      type="button"
                      onClick={addSpecialtyRow}
                      className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold uppercase tracking-wider"
                    >
                      <IconPlus size={14} /> {t('proposals_add_specialty')}
                    </button>
                  </div>
                  
                  <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-visible bg-white dark:bg-zinc-900/50">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                        <tr>
                          <th className="px-4 py-3 text-left font-bold text-zinc-500 uppercase tracking-wider">{t('proposals_specialty_col')}</th>
                          <th className="px-4 py-3 text-left font-bold text-zinc-500 uppercase tracking-wider">{t('proposals_contact_col')}</th>
                          <th className="px-4 py-3 text-right font-bold text-zinc-500 uppercase tracking-wider w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                        {newProposal.specialties_list?.map((spec, idx) => {
                          return (
                          <tr key={spec.id || idx}>
                            <td className="px-4 py-3">
                              <input 
                                placeholder="Ex: BET Structure"
                                className="w-full bg-transparent outline-none focus:ring-2 focus:ring-blue-500/20 rounded-lg px-2 py-1 text-zinc-900 dark:text-white"
                                value={spec.specialty_name || ''}
                                onChange={e => updateSpecialty(idx, 'specialty_name', e.target.value)}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <ContactAutocomplete 
                                contacts={contacts}
                                value={spec.contact_id || ''}
                                onChange={val => updateSpecialty(idx, 'contact_id', val)}
                                onAddNew={() => { setContactModalContext({ type: 'specialty', idx }); setIsContactModalOpen(true); }}
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button 
                                type="button"
                                onClick={() => removeSpecialtyRow(idx)}
                                className="text-red-500 hover:text-red-700 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              >
                                <IconTrash size={16} />
                              </button>
                            </td>
                          </tr>
                          );
                        })}
                        {(!newProposal.specialties_list || newProposal.specialties_list.length === 0) && (
                          <tr>
                            <td colSpan={3} className="px-4 py-8 text-center text-zinc-400 italic">
                              {t('proposals_no_cotraitants')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Section 10: Répartition des Honoraires */}
                <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">10</span>
                      {t('proposals_section_fee_distribution')}
                    </h3>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700">
                        <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Décimales</label>
                        <input 
                          type="number" 
                          min="0" 
                          max="4" 
                          value={(typeof newProposal.decimal_precision === 'number' && isNaN(newProposal.decimal_precision)) ? '' : (newProposal.decimal_precision ?? '')} 
                          onChange={(e) => setNewProposal(prev => ({ ...prev, decimal_precision: Number(e.target.value) }))}
                          className="w-10 bg-transparent text-xs font-bold text-zinc-900 dark:text-white outline-none"
                        />
                      </div>
                      <button 
                        type="button"
                        onClick={() => exportFeeDistributionToXlsx(newProposal.fee_distribution, newProposal.specialties_list, contacts, newProposal.vat_rate, newProposal.reference || 'Projet')}
                        className="text-[10px] flex items-center gap-1 text-green-700 hover:text-green-800 font-bold uppercase tracking-wider bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded"
                      >
                        <IconFileSpreadsheet size={12} /> {t('proposals_export_xlsx')}
                      </button>
                      <button
                        type="button"
                        onClick={handleLoadMiqcpPhaseRepartition}
                        className="text-[10px] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded"
                      >
                        {t('miqcp_wizard_load_phase_repartition_btn')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const currentData = JSON.parse(newProposal.fee_distribution || '{}');
                          const newMission = { id: `mission-${Date.now()}`, name: 'Nouvelle Mission Base', category: 'Mission base', percentages: { architect: 100 } };
                          const newData = { ...currentData, missions: [...(currentData.missions || []), newMission] };
                          setNewProposal(prev => ({ ...prev, fee_distribution: JSON.stringify(newData) }));
                        }}
                        className="text-[10px] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded"
                      >
                        <IconPlus size={12} /> {t('proposals_mission_base')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const currentData = JSON.parse(newProposal.fee_distribution || '{}');
                          const newMission = { id: `mission-${Date.now()}`, name: 'Nouvelle Mission Exé', category: 'Mission Exécution', percentages: { architect: 100 } };
                          const newData = { ...currentData, missions: [...(currentData.missions || []), newMission] };
                          setNewProposal(prev => ({ ...prev, fee_distribution: JSON.stringify(newData) }));
                        }}
                        className="text-[10px] flex items-center gap-1 text-green-600 hover:text-green-700 font-bold uppercase tracking-wider bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded"
                      >
                        <IconPlus size={12} /> {t('proposals_mission_execution')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const currentData = JSON.parse(newProposal.fee_distribution || '{}');
                          const newMission = { id: `mission-${Date.now()}`, name: 'Nouvelle Mission Comp', category: 'Missions complémentaires', percentages: { architect: 100 } };
                          const newData = { ...currentData, missions: [...(currentData.missions || []), newMission] };
                          setNewProposal(prev => ({ ...prev, fee_distribution: JSON.stringify(newData) }));
                        }}
                        className="text-[10px] flex items-center gap-1 text-purple-600 hover:text-purple-700 font-bold uppercase tracking-wider bg-purple-50 dark:bg-purple-900/20 px-2 py-1 rounded"
                      >
                        <IconPlus size={12} /> {t('proposals_mission_complementary')}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-white dark:bg-zinc-900/50 min-h-[400px]">
                    <FeeDistributionGrid
                      doc={newProposal}
                      milestoneEntityField="proposal_id"
                      contacts={contacts}
                      milestones={milestones}
                      onMilestonesChange={(updated) => {
                        if (editingProposal) {
                          setMilestones(prev => {
                            const other = prev.filter(m => m.proposal_id !== editingProposal.id);
                            return [...other, ...updated];
                          });
                        }
                      }}
                      onChange={(data) => setNewProposal(prev => ({ ...prev, fee_distribution: JSON.stringify(data) }))}
                    />
                  </div>
                </div>

                {/* Section 09: Milestones */}
                {editingProposal && (
                  <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-6">
                    <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">09</span>
                      {t('proposals_section_schedule')}
                    </h3>
                    <MilestoneGantt 
                      milestones={milestones.filter(m => m.proposal_id === editingProposal.id)} 
                      startDate={new Date(editingProposal.created_at)} 
                      endDate={new Date(new Date(editingProposal.created_at).getTime() + 365 * 24 * 60 * 60 * 1000)} 
                      onUpdate={(updatedMilestones) => {
                        // In a real app, we would call an API to update milestones
                        // For now, we update the local state
                        setMilestones(prev => {
                          const other = prev.filter(m => m.proposal_id !== editingProposal.id);
                          return [...other, ...updatedMilestones];
                        });
                      }}
                    />
                  </div>
                )}
              </form>

              {editingProposal && (
                <div className="px-6 pb-6">
                  <h4 className="text-sm font-bold uppercase tracking-widest pb-2 mb-4" style={{ color: 'var(--tblr-primary)', borderBottom: '1px solid var(--tblr-border)' }}>{t('correspondence_title')}</h4>
                  <CorrespondenceTab localType="proposal" localId={editingProposal.id} contactEmail={editingProposal.email_client} />
                </div>
              )}

              {submitError && (
                <div className="px-6 py-3 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800">
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium">⚠ {submitError}</p>
                </div>
              )}
              <div className="p-6 flex gap-3" style={{ borderTop: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2.5 rounded-lg font-semibold transition-all active:scale-95"
                  style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
                >
                  {t('btn_cancel')}
                </button>
                <button
                  type="submit"
                  form="proposal-form"
                  className="flex-1 px-4 py-2.5 rounded-lg font-semibold transition-all active:scale-95"
                  style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                >
                  {editingProposal ? t('proposals_update_btn') : t('proposals_create_btn')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {isMiqcpWizardOpen && (
        <MiqcpComplexityWizardModal
          montantTravaux={newProposal.construction_cost || 0}
          initialAssessment={miqcpAssessment}
          onApply={handleApplyMiqcpAssessment}
          onClose={() => setIsMiqcpWizardOpen(false)}
        />
      )}

      <ContactModal
        isOpen={isContactModalOpen}
        initialCategory={contactModalContext?.type === 'specialty' ? CONTACT_CATEGORY_COTRAITANT : CONTACT_CATEGORY_CLIENT}
        onClose={() => setIsContactModalOpen(false)}
        onSuccess={(newContact) => {
          setContacts(prev => [...prev, newContact]);
          if (contactModalContext?.type === 'client') {
            setNewProposal(prev => ({
              ...prev,
              client_id: newContact.id,
              adresse_client: newContact.address || newContact.address_work_street || '',
              cp_client: newContact.zip || newContact.address_work_zip || '',
              ville_client: newContact.city || newContact.address_work_city || '',
              telephone: newContact.phone || newContact.phone_work || '',
              portable: newContact.phone_mobile || '',
              email_client: newContact.email || newContact.email_work || ''
            }));
          } else if (contactModalContext?.type === 'specialty') {
            updateSpecialty(contactModalContext.idx, 'contact_id', newContact.id);
          }
          setContactModalContext(null);
          fetchContacts();
        }}
      />

      {exportProposal && (
        <ProposalExportModal
          proposal={exportProposal}
          onClose={() => setExportProposal(null)}
        />
      )}
    </div>
  );
}
