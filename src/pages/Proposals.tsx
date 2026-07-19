import * as React from 'react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconPlus, IconFileSpreadsheet, IconCircleCheck, IconClock, IconX, IconTrash, IconDeviceFloppy, IconSearch, IconFilter, IconEdit, IconFileText, IconFileTypePdf, IconContract, IconFileInvoice } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import { fetchJson } from '../lib/api';
import type { Proposal, Contact, Milestone } from '../types';
import { useTranslation } from 'react-i18next';
import { GeoportailMap, GoogleMap, GeorisquesMap, GeorisquesInfo, RNBInfo, BDNBInfo } from '../components/LocationMaps';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import { ContactModal } from '../components/ContactModal';
import { CompanyAutocomplete } from '../components/CompanyAutocomplete';
import { CadastreDownload } from '../components/CadastreDownload';
import { UrbanPlanningInfo } from '../components/UrbanPlanningInfo';
import { HistoricalMonuments } from '../components/HistoricalMonuments';
import { InfoPanelBoundary } from '../components/InfoPanelBoundary';
import MilestoneGantt from '../components/MilestoneGantt';
import { MobileAccordionTable } from '../components/MobileAccordionTable';
import { ProposalGenerator } from '../components/ProposalGenerator';
import { MAF_INTERCALAIRE_OPTIONS, TAUX_MISSION_OPTIONS } from '../lib/mafUtils';

import { saveAs } from 'file-saver';

const DEFAULT_MISSIONS = [
  { id: 'esquisse', name: 'Esquisse', category: 'Mission base', default_pct: 10 },
  { id: 'aps', name: 'A.P.S.', category: 'Mission base', default_pct: 12 },
  { id: 'apd', name: 'A.P.D.', category: 'Mission base', default_pct: 14 },
  { id: 'projet', name: 'Projet', category: 'Mission base', default_pct: 18 },
  { id: 'act', name: 'A.C.T.', category: 'Mission base', default_pct: 7 },
  { id: 'visa', name: 'VISA', category: 'Mission base', default_pct: 7 },
  { id: 'det', name: 'D.E.T.', category: 'Mission base', default_pct: 25 },
  { id: 'aor', name: 'A.O.R.', category: 'Mission base', default_pct: 7 },
  { id: 'opc', name: 'OPC', category: 'Mission Exécution' },
];

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

const mapProposalToFeeGeneratorData = (p: Proposal) => ({
  client: {
    name: p.is_entreprise ? (p.nom_societe || p.client_name || '') : (p.client_name || ''),
    address: [p.adresse_client, p.cp_client, p.ville_client].filter(Boolean).join(' ') || '',
    rcs: p.rcs || 'Non',
    phone: p.telephone || p.portable || '',
    mail: p.email_client || '',
  },
  project: {
    title: p.title || '',
    cadastralRef: p.ref_cadastrale || '',
    siteAddress: [p.adresse_terrain, p.cp_ville_terrain].filter(Boolean).join(' ') || '',
    siteSurface: p.surface_parcelle || '',
    existingSurface: '',
    existingFootprint: '',
    projectedFootprint: '',
    projectedFloorArea: p.surface_plancher || '',
    provisionalEnvelope: p.construction_cost ? String(p.construction_cost) : '',
    estimatedWorksCost: p.construction_cost ? String(p.construction_cost) : '0.00',
  },
  programShort: {
    description: p.projet_detail || p.description || '',
  },
  financials: {
    preliminaryStudies: 0,
    urbanPlanningMission: p.amount || 0,
    commercialDiscountPercent: 0,
    tvaPercent: p.vat_rate ?? 20,
  },
  proposalType: 'court' as const,
});

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
  const [feeGeneratorProposal, setFeeGeneratorProposal] = useState<Proposal | null>(null);
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
  const [submitError, setSubmitError] = useState<string | null>(null);

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
          alert('Proposal accepted! A new project has been created.');
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
    if (!confirm(`Supprimer définitivement le brouillon "${proposal.title}" ?`)) return;
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, { method: 'DELETE' });
      if (res.ok) {
        setProposals(proposals.filter(p => p.id !== proposal.id));
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(`Échec de la suppression : ${errorData.error || 'Erreur inconnue'}`);
      }
    } catch (err) {
      console.error(err);
      alert('Échec de la suppression du devis.');
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
        alert('Proposal imported successfully');
      } else {
        alert('Failed to import proposal');
      }
    } catch (err) {
      console.error(err);
      alert('Error importing proposal');
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

  const calculateFeeRatios = (feeDistribution: string | undefined) => {
    if (!feeDistribution) return { exeRatio: 1, totalRatio: 1 };
    try {
      const data = JSON.parse(feeDistribution);
      const missions = data.missions || [];
      const baseAmt = missions
        .filter((m: any) => m.category === 'Mission base')
        .reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
      
      if (baseAmt === 0) return { exeRatio: 1, totalRatio: 1 };

      const exeAmt = missions
        .filter((m: any) => m.category === 'Mission base' || m.category === 'Mission Exécution')
        .reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
      
      const totalAmt = missions
        .reduce((acc: number, m: any) => acc + (m.amount || 0), 0);

      return {
        exeRatio: exeAmt / baseAmt,
        totalRatio: totalAmt / baseAmt
      };
    } catch (e) {
      return { exeRatio: 1, totalRatio: 1 };
    }
  };

  const feeRatios = React.useMemo(() => calculateFeeRatios(newProposal.fee_distribution), [newProposal.fee_distribution]);
  const calculatedExePercent = (newProposal.base_fee_percent || 0) * feeRatios.exeRatio;
  const calculatedTotalPercent = (newProposal.base_fee_percent || 0) * feeRatios.totalRatio;

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
            data={filteredProposals}
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
                <button onClick={() => navigate('/proposal-generator', { state: { proposal: p } })} className="p-1.5 rounded-lg" style={{ color: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)' }}><IconFileTypePdf size={15} /></button>
                <button onClick={() => setFeeGeneratorProposal(p)} title="Proposition d'honoraires (courte / détaillée)" className="p-1.5 rounded-lg" style={{ color: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)' }}><IconFileInvoice size={15} /></button>
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
              {filteredProposals.map((proposal) => (
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
                        onClick={() => navigate('/proposal-generator', { state: { proposal } })}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        title={t('pdf_generator')}
                      >
                        <IconFileTypePdf size={20} />
                      </button>
                      <button
                        onClick={() => setFeeGeneratorProposal(proposal)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        title="Proposition d'honoraires (courte / détaillée)"
                      >
                        <IconFileInvoice size={20} />
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
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
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
                      <InfoPanelBoundary label="Urbanisme"><UrbanPlanningInfo address={newProposal.adresse_terrain || ''} /></InfoPanelBoundary>
                      <InfoPanelBoundary label="Géorisques"><GeorisquesInfo address={newProposal.adresse_terrain || ''} banId={newProposal.ban_id_terrain} /></InfoPanelBoundary>
                      <InfoPanelBoundary label="Monuments historiques"><HistoricalMonuments address={newProposal.adresse_terrain || ''} /></InfoPanelBoundary>
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2 block">{t('proposals_maps_title')}</label>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-64">
                        <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative shadow-sm hover:shadow-md transition-shadow duration-300 group">
                          <InfoPanelBoundary label="Cadastre"><GeoportailMap address={newProposal.adresse_terrain || ''} banId={newProposal.ban_id_terrain} /></InfoPanelBoundary>
                          <div className="absolute top-2 left-2 px-2 py-1 bg-white/90 dark:bg-black/90 backdrop-blur-md rounded text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 shadow-sm z-10">Cadastre</div>
                        </div>
                        <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative shadow-sm hover:shadow-md transition-shadow duration-300 group">
                          <InfoPanelBoundary label="OpenStreetMap"><GoogleMap address={newProposal.adresse_terrain || ''} /></InfoPanelBoundary>
                          <div className="absolute top-2 left-2 px-2 py-1 bg-white/90 dark:bg-black/90 backdrop-blur-md rounded text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 shadow-sm z-10">OpenStreetMap</div>
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
                        onClick={() => exportToXlsx(newProposal, contacts)}
                        className="text-[10px] flex items-center gap-1 text-green-700 hover:text-green-800 font-bold uppercase tracking-wider bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded"
                      >
                        <IconFileSpreadsheet size={12} /> {t('proposals_export_xlsx')}
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
                      proposal={newProposal} 
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

      <ContactModal 
        isOpen={isContactModalOpen}
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

      {feeGeneratorProposal && (
        <ProposalGenerator
          initialData={mapProposalToFeeGeneratorData(feeGeneratorProposal)}
          onClose={() => setFeeGeneratorProposal(null)}
        />
      )}
    </div>
  );
}

const FeeDistributionGrid = ({ proposal, contacts, onChange, milestones, onMilestonesChange }: {
  proposal: Partial<Proposal>,
  contacts: Contact[],
  onChange: (data: any) => void,
  milestones: Milestone[],
  onMilestonesChange: (milestones: Milestone[]) => void
}) => {
  const data = React.useMemo(() => {
    if (proposal.fee_distribution) {
      try {
        return JSON.parse(proposal.fee_distribution);
      } catch (e) {}
    }
    return { missions: DEFAULT_MISSIONS.map(m => ({ ...m, percentages: {} })) };
  }, [proposal.fee_distribution]);

  React.useEffect(() => {
    if (!proposal.id) return;
    const currentMissions = data.missions;
    const currentMilestones = milestones.filter(m => m.proposal_id === proposal.id);
    let hasChanges = false;
    const updatedMilestones = [...currentMilestones];
    currentMissions.forEach((mission: any) => {
      if (!currentMilestones.find(m => m.title === mission.name)) {
        updatedMilestones.push({
          id: `ms-${Date.now()}-${Math.random()}`,
          proposal_id: proposal.id,
          title: mission.name,
          due_date: new Date().toISOString(),
          completed: false,
          duration_days: 30
        });
        hasChanges = true;
      }
    });
    const finalMilestones = updatedMilestones.filter(m =>
      currentMissions.find((mission: any) => mission.name === m.title)
    );
    if (finalMilestones.length !== currentMilestones.length || hasChanges) {
      onMilestonesChange(finalMilestones);
    }
  }, [data.missions, proposal.id]);

  const selectedContacts = React.useMemo(() => {
    const list = proposal.specialties_list || [];
    return list.map((s: any) => {
      const contact = contacts.find(c => c.id === s.contact_id);
      return {
        id: s.contact_id || s.id,
        name: contact ? `${contact.first_name} ${contact.last_name}` : s.specialty_name,
        role: s.specialty_name
      };
    }).filter((c: any) => c.id);
  }, [proposal.specialties_list, contacts]);

  const precision = (typeof proposal.decimal_precision === 'number' && !isNaN(proposal.decimal_precision)) ? proposal.decimal_precision : 2;
  const safeNum = (val: number) => isNaN(val) ? 0 : Number(val.toFixed(precision));

  const totalBaseAmount = React.useMemo(() => {
    return data.missions
      .filter((m: any) => m.category === 'Mission base')
      .reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
  }, [data.missions]);

  const updateMission = (missionId: string, field: string, value: any) => {
    const newData = { ...data, missions: data.missions.map((m: any) => m.id === missionId ? { ...m, [field]: value } : m) };
    onChange(newData);
  };

  const updateMissionPct = (missionId: string, key: string, value: number) => {
    const newData = {
      ...data,
      missions: data.missions.map((m: any) =>
        m.id === missionId ? { ...m, percentages: { ...m.percentages, [key]: value } } : m
      )
    };
    onChange(newData);
  };

  const handleRelPct = (missionId: string, newRelPct: number) => {
    const newData = { ...data, missions: [...data.missions] };
    const missionIndex = newData.missions.findIndex((m: any) => m.id === missionId);
    if (missionIndex === -1) return;
    const isBaseMission = newData.missions[missionIndex].category === 'Mission base';
    if (isBaseMission) {
      const baseMissions = newData.missions.filter((m: any) => m.category === 'Mission base');
      const idx = baseMissions.findIndex((m: any) => m.id === missionId);
      const targetTotal = proposal.amount || 0;
      let sumAbove = 0;
      for (let i = 0; i < idx; i++) {
        sumAbove += (baseMissions[i].amount / targetTotal) * 100;
      }
      const remaining = 100 - sumAbove - newRelPct;
      newData.missions[missionIndex] = { ...newData.missions[missionIndex], amount: (newRelPct * targetTotal) / 100 };
      const missionsBelow = baseMissions.slice(idx + 1);
      const sumBelow = missionsBelow.reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
      if (missionsBelow.length > 0) {
        missionsBelow.forEach((mb: any) => {
          const mbIdx = newData.missions.findIndex((m: any) => m.id === mb.id);
          newData.missions[mbIdx] = {
            ...newData.missions[mbIdx],
            amount: sumBelow > 0
              ? (mb.amount / sumBelow) * remaining * targetTotal / 100
              : (remaining / missionsBelow.length * targetTotal) / 100
          };
        });
      }
    } else {
      newData.missions[missionIndex] = { ...newData.missions[missionIndex], amount: (newRelPct * totalBaseAmount) / 100 };
    }
    onChange(newData);
  };

  const deleteMission = (missionId: string) => {
    const newData = { ...data, missions: data.missions.filter((m: any) => m.id !== missionId) };
    onChange(newData);
  };

  const thStyle: React.CSSProperties = { padding: '4px 6px', border: '1px solid #e2e8f0', background: '#f1f5f9', fontSize: 12, fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' };
  const tdStyle: React.CSSProperties = { padding: '2px 4px', border: '1px solid #e2e8f0', fontSize: 12 };
  const inputStyle: React.CSSProperties = { width: '100%', border: 'none', background: 'transparent', fontSize: 12, padding: '2px', outline: 'none', textAlign: 'right' };
  const catStyle: React.CSSProperties = { padding: '3px 6px', border: '1px solid #e2e8f0', background: '#e2e8f0', fontWeight: 700, fontSize: 12 };
  const totalStyle: React.CSSProperties = { padding: '3px 6px', border: '1px solid #e2e8f0', background: '#f8fafc', fontWeight: 700, fontSize: 12, textAlign: 'right' };

  const colCount = 6 + selectedContacts.length * 2 + 1;

  const renderMissionRow = (m: any) => {
    const isBase = m.category === 'Mission base';
    const amt = m.amount || 0;
    const relPct = totalBaseAmount > 0 ? (amt / totalBaseAmount) * 100 : 0;
    const archPct = m.percentages['architect'] || 0;
    const archAmt = amt * (archPct / 100);
    let sumPct = archPct;
    selectedContacts.forEach((c: any) => { sumPct += (m.percentages[c.id] || 0); });
    const soldeAmt = amt * ((100 - sumPct) / 100);
    return (
      <tr key={m.id}>
        <td style={tdStyle}>
          <input style={{ ...inputStyle, textAlign: 'left' }} defaultValue={m.name}
            onBlur={e => updateMission(m.id, 'name', e.target.value)} />
        </td>
        <td style={tdStyle}>
          <input style={inputStyle} type="number" step="any" defaultValue={safeNum(amt)}
            onBlur={e => updateMission(m.id, 'amount', parseFloat(e.target.value) || 0)} />
        </td>
        <td style={tdStyle}>
          <input style={inputStyle} type="number" step="any" defaultValue={safeNum(relPct)}
            onBlur={e => handleRelPct(m.id, parseFloat(e.target.value) || 0)} />
        </td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>{safeNum(soldeAmt).toLocaleString('fr-FR')}</td>
        <td style={tdStyle}>
          <input style={inputStyle} type="number" step="any" defaultValue={safeNum(archPct)}
            onBlur={e => updateMissionPct(m.id, 'architect', parseFloat(e.target.value) || 0)} />
        </td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>{safeNum(archAmt).toLocaleString('fr-FR')}</td>
        {selectedContacts.map((c: any) => {
          const pct = m.percentages[c.id] || 0;
          const cAmt = amt * (pct / 100);
          return (
            <React.Fragment key={c.id}>
              <td style={tdStyle}>
                <input style={inputStyle} type="number" step="any" defaultValue={safeNum(pct)}
                  onBlur={e => updateMissionPct(m.id, c.id, parseFloat(e.target.value) || 0)} />
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{safeNum(cAmt).toLocaleString('fr-FR')}</td>
            </React.Fragment>
          );
        })}
        <td style={{ ...tdStyle, textAlign: 'center' }}>
          {!isBase && (
            <button onClick={() => deleteMission(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 14 }} title="Supprimer">🗑️</button>
          )}
        </td>
      </tr>
    );
  };

  const renderTotalRow = (label: string, missions: any[]) => {
    const totalAmt = missions.reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
    const relPct = totalBaseAmount > 0 ? (totalAmt / totalBaseAmount) * 100 : 0;
    const totalSolde = missions.reduce((acc: number, m: any) => {
      const mAmt = m.amount || 0;
      const archPct = m.percentages['architect'] || 0;
      let sumPct = archPct;
      selectedContacts.forEach((c: any) => { sumPct += (m.percentages[c.id] || 0); });
      return acc + mAmt * ((100 - sumPct) / 100);
    }, 0);
    const totalArchAmt = missions.reduce((acc: number, m: any) => acc + (m.amount || 0) * ((m.percentages['architect'] || 0) / 100), 0);
    return (
      <tr key={label}>
        <td style={totalStyle}>{label}</td>
        <td style={totalStyle}>{safeNum(totalAmt).toLocaleString('fr-FR')}</td>
        <td style={totalStyle}>{safeNum(relPct).toLocaleString('fr-FR')}</td>
        <td style={totalStyle}>{safeNum(totalSolde).toLocaleString('fr-FR')}</td>
        <td style={totalStyle}>—</td>
        <td style={totalStyle}>{safeNum(totalArchAmt).toLocaleString('fr-FR')}</td>
        {selectedContacts.map((c: any) => {
          const cAmt = missions.reduce((acc: number, m: any) => acc + (m.amount || 0) * ((m.percentages[c.id] || 0) / 100), 0);
          return (
            <React.Fragment key={c.id}>
              <td style={totalStyle}>—</td>
              <td style={totalStyle}>{safeNum(cAmt).toLocaleString('fr-FR')}</td>
            </React.Fragment>
          );
        })}
        <td style={totalStyle} />
      </tr>
    );
  };

  const baseMissions = data.missions.filter((m: any) => m.category === 'Mission base');
  const exeMissions = data.missions.filter((m: any) => m.category === 'Mission Exécution');
  const compMissions = data.missions.filter((m: any) => m.category === 'Missions complémentaires');
  const allMissions = [...baseMissions, ...exeMissions, ...compMissions];

  const totalHT = allMissions.reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
  const vatRate = proposal.vat_rate || 20;
  const vatAmt = totalHT * (vatRate / 100);
  const totalTTC = totalHT + vatAmt;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
        <thead>
          <tr>
            <th style={thStyle} rowSpan={2}>Désignation</th>
            <th style={thStyle} rowSpan={2}>Montant HT</th>
            <th style={thStyle} rowSpan={2}>Rel %</th>
            <th style={thStyle} rowSpan={2}>Solde</th>
            <th style={{ ...thStyle, textAlign: 'center' }} colSpan={2}>Architecte</th>
            {selectedContacts.map((c: any) => (
              <th key={c.id} style={{ ...thStyle, textAlign: 'center' }} colSpan={2}>{c.name}</th>
            ))}
            <th style={thStyle} rowSpan={2} />
          </tr>
          <tr>
            <th style={thStyle}>%</th>
            <th style={thStyle}>€</th>
            {selectedContacts.map((c: any) => (
              <React.Fragment key={c.id}>
                <th style={thStyle}>%</th>
                <th style={thStyle}>€</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr><td style={catStyle} colSpan={colCount}>Mission base</td></tr>
          {baseMissions.map(renderMissionRow)}
          {renderTotalRow('Sous-total Base', baseMissions)}

          <tr><td style={catStyle} colSpan={colCount}>Mission Exécution</td></tr>
          {exeMissions.map(renderMissionRow)}
          {renderTotalRow('Sous-total Exécution', exeMissions)}
          {renderTotalRow('Total Base + Exé', [...baseMissions, ...exeMissions])}

          <tr><td style={catStyle} colSpan={colCount}>Missions complémentaires</td></tr>
          {compMissions.map(renderMissionRow)}
          {renderTotalRow('Sous-total Complémentaire', compMissions)}
          {renderTotalRow('TOTAL GENERAL HT', allMissions)}

          <tr>
            <td style={{ ...tdStyle, fontStyle: 'italic', color: '#64748b' }}>TVA ({vatRate}%)</td>
            <td style={{ ...tdStyle, fontStyle: 'italic', color: '#64748b', textAlign: 'right' }}>{safeNum(vatAmt).toLocaleString('fr-FR')}</td>
            {Array.from({ length: colCount - 2 }).map((_, i) => <td key={i} style={tdStyle} />)}
          </tr>
          <tr>
            <td style={{ ...tdStyle, fontWeight: 700, color: '#1e40af' }}>TOTAL TTC</td>
            <td style={{ ...tdStyle, fontWeight: 700, color: '#1e40af', textAlign: 'right' }}>{safeNum(totalTTC).toLocaleString('fr-FR')}</td>
            {Array.from({ length: colCount - 2 }).map((_, i) => <td key={i} style={tdStyle} />)}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

const exportToXlsx = async (proposal: Partial<Proposal>, contacts: Contact[]) => {
  if (!proposal.fee_distribution) return;
  try {
    const XLSX = await import('xlsx');
    const data = JSON.parse(proposal.fee_distribution);
    const specialties = proposal.specialties_list || [];
    const selectedContacts = specialties.map(s => {
      const contact = contacts.find(c => c.id === s.contact_id);
      return {
        id: s.contact_id || s.id,
        name: contact ? `${contact.first_name} ${contact.last_name}` : s.specialty_name
      };
    }).filter(c => c.id);

    const aoa: any[][] = [];
    
    // Header Level 1
    const h1 = ["Désignation", "Montant HT", "Rel %", "Solde", "Architecte", ""];
    selectedContacts.forEach(c => h1.push(c.name, ""));
    aoa.push(h1);

    // Header Level 2
    const h2 = ["", "", "", "", "%", "€"];
    selectedContacts.forEach(() => h2.push("%", "€"));
    aoa.push(h2);

    const getCol = (idx: number) => {
      let letter = '';
      idx++;
      while (idx > 0) {
        let mod = (idx - 1) % 26;
        letter = String.fromCharCode(65 + mod) + letter;
        idx = Math.floor((idx - mod) / 26);
      }
      return letter;
    };

    const categories = [
      { label: "Mission base", category: "Mission base" },
      { label: "Mission Exécution", category: "Mission Exécution" },
      { label: "Missions complémentaires", category: "Missions complémentaires" }
    ];

    let currentRow = 2; // Rows already in aoa
    const baseSubtotalRowRef = { row: 0 };

    categories.forEach((cat) => {
      aoa.push([cat.label]);
      currentRow++;
      
      const missions = data.missions.filter((m: any) => m.category === cat.category);
      const startRow = currentRow + 1;
      
      missions.forEach((m: any) => {
        currentRow++;
        const r = currentRow;
        const rowData: any[] = [m.name];
        
        // Montant HT (Col B)
        rowData.push(m.amount || 0);
        
        // Rel % (Col C) - Placeholder, filled later
        rowData.push(0); 

        // Solde (Col D)
        let soldeFormula = `B${r}*(100-(${getCol(4)}${r}`;
        selectedContacts.forEach((_, i) => {
          soldeFormula += `+${getCol(6 + i * 2)}${r}`;
        });
        soldeFormula += "))/100";
        rowData.push({ f: soldeFormula });

        // Architecte % (Col E)
        rowData.push(m.percentages['architect'] || 0);

        // Architecte € (Col F)
        rowData.push({ f: `B${r}*E${r}/100` });

        // Contacts
        selectedContacts.forEach((c, i) => {
          const pct = m.percentages[c.id] || 0;
          rowData.push(pct); // % (Col G, I...)
          rowData.push({ f: `B${r}*${getCol(6 + i * 2)}${r}/100` }); // € (Col H, J...)
        });
        
        aoa.push(rowData);
      });

      // Subtotal Row
      currentRow++;
      const subRowIdx = currentRow;
      if (cat.category === "Mission base") baseSubtotalRowRef.row = subRowIdx;
      
      const subRow: any[] = [`Sous-total ${cat.label}`];
      // Montant HT (Col B)
      subRow.push({ f: `SUM(B${startRow}:B${subRowIdx - 1})` });
      // Rel % (Col C)
      subRow.push({ f: `SUM(C${startRow}:C${subRowIdx - 1})` });
      // Solde (Col D)
      subRow.push({ f: `SUM(D${startRow}:D${subRowIdx - 1})` });
      // Architecte % (Col E)
      subRow.push("");
      // Architecte € (Col F)
      subRow.push({ f: `SUM(F${startRow}:F${subRowIdx - 1})` });
      
      selectedContacts.forEach((_, i) => {
        subRow.push("");
        subRow.push({ f: `SUM(${getCol(7 + i * 2)}${startRow}:${getCol(7 + i * 2)}${subRowIdx - 1})` });
      });
      
      aoa.push(subRow);
      aoa.push([]);
      currentRow++;
    });

    // Fix Rel % formulas for all missions
    const baseSubtotalRow = baseSubtotalRowRef.row;
    let rowPtr = 2;
    categories.forEach(cat => {
      rowPtr++; // Category label
      const missions = data.missions.filter((m: any) => m.category === cat.category);
      missions.forEach(() => {
        rowPtr++;
        aoa[rowPtr - 1][2] = { f: `B${rowPtr}/$B$${baseSubtotalRow}*100` };
      });
      rowPtr++; // Subtotal
      rowPtr++; // Empty
    });

    // Totals
    const subtotalRows: number[] = [];
    aoa.forEach((row, i) => {
      if (row[0] && typeof row[0] === 'string' && row[0].startsWith("Sous-total")) {
        subtotalRows.push(i + 1);
      }
    });
    
    const htSumFormula = subtotalRows.map(r => `B${r}`).join("+");
    aoa.push(["TOTAL GENERAL HT", { f: htSumFormula }]);
    currentRow++;
    
    const vatRate = proposal.vat_rate || 20;
    aoa.push([`TVA (${vatRate}%)`, { f: `B${currentRow}*${vatRate}/100` }]);
    currentRow++;
    
    aoa.push(["TOTAL GENERAL TTC", { f: `B${currentRow-1}+B${currentRow}` }]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Répartition Honoraires");
    
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `Repartition_Honoraires_${proposal.reference || 'Projet'}.xlsx`);
  } catch (e) {
    console.error("Export failed:", e);
  }
};
