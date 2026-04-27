import * as React from 'react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconPlus, IconFileSpreadsheet, IconCircleCheck, IconClock, IconX, IconTrash, IconDeviceFloppy, IconSearch, IconFilter, IconEdit, IconFileText, IconFileTypePdf } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import { fetchJson } from '../lib/api';
import type { Proposal, Contact, Milestone } from '../types';
import { useTranslation } from 'react-i18next';
import { GeoportailMap, GoogleMap, GeorisquesMap, GeorisquesInfo, RNBInfo, BDNBInfo } from '../components/LocationMaps';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import { ReactGrid, Column, Row, Cell, CellChange, TextCell, NumberCell, HeaderCell } from "@silevis/reactgrid";
import { ContactModal } from '../components/ContactModal';
import { CompanyAutocomplete } from '../components/CompanyAutocomplete';
import { CadastreDownload } from '../components/CadastreDownload';
import { UrbanPlanningInfo } from '../components/UrbanPlanningInfo';
import { HistoricalMonuments } from '../components/HistoricalMonuments';
import MilestoneGantt from '../components/MilestoneGantt';

import * as XLSX from 'xlsx';
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

const FormField = ({ label, value, onChange, type = "text", required = false, options = [], id }: any) => (
  <div>
    <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    {type === "select" ? (
      <select 
        id={id}
        required={required}
        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white"
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
        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white resize-none h-20"
        value={(typeof value === 'number' && isNaN(value)) ? '' : (value ?? '')}
        onChange={e => onChange(e.target.value)}
      />
    ) : type === "checkbox" ? (
      <div className="flex items-center h-9">
        <input 
          id={id}
          type="checkbox"
          className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
          checked={!!value}
          onChange={e => onChange(e.target.checked)}
        />
      </div>
    ) : (
      <input 
        id={id}
        type={type}
        required={required}
        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white"
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
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
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
    specialties_list: [],
    fee_distribution: JSON.stringify({ 
      missions: DEFAULT_MISSIONS.map(m => ({ 
        ...m, 
        amount: m.default_pct ? (0 * (m.default_pct / 100)) : 0,
        percentages: {} 
      })) 
    }),
    construction_cost: 0,
    complexity_rate: 1,
    base_fee_percent: 0,
    vat_rate: 20,
    decimal_precision: 2
  };
  const [newProposal, setNewProposal] = useState<Partial<Proposal>>(initialProposalState);

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
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditClick = (proposal: Proposal) => {
    setEditingProposal(proposal);
    setNewProposal(proposal);
    setIsModalOpen(true);
  };

  const handleOpenCreateModal = () => {
    setEditingProposal(null);
    setNewProposal(initialProposalState);
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
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight">Proposals</h1>
          <p className="text-zinc-500 dark:text-zinc-400">Manage client proposals and convert them to projects</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => document.getElementById('xml-file-upload')?.click()}
            className="flex items-center gap-2 px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-xl font-semibold transition-all shadow-sm"
          >
            <IconFileText size={18} />
            Import XML
          </button>
          <input id="xml-file-upload" type="file" className="hidden" accept=".xml" onChange={handleImport} />
          <button 
            onClick={handleOpenCreateModal}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/20 active:scale-95"
          >
            <IconPlus size={20} />
            Create Proposal
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 bg-white dark:bg-zinc-800 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input 
            type="text" 
            placeholder="Search proposals..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-zinc-900 dark:text-white"
          />
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-700">
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Proposal</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Client</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {filteredProposals.map((proposal) => (
                <tr key={proposal.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg">
                        <IconFileSpreadsheet size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-zinc-900 dark:text-white">{proposal.title}</p>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{proposal.reference}</p>
                        <p className="text-[10px] text-zinc-400">Created {new Date(proposal.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 font-medium">
                    {proposal.client_name || 'Unknown Client'}
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-zinc-900 dark:text-white">
                    {formatCurrency(proposal.amount)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                      proposal.status === 'Accepted' ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800" :
                      proposal.status === 'Rejected' ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800" :
                      proposal.status === 'Sent' ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800" :
                      "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700"
                    )}>
                      {proposal.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => handleEditClick(proposal)}
                        className="p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                        title="Edit Proposal"
                      >
                        <IconEdit size={20} />
                      </button>
                      <button 
                        onClick={() => handleExport(proposal.id)}
                        className="p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700 rounded-lg transition-colors"
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
                            onClick={() => handleUpdateStatus(proposal, 'Rejected')}
                            className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            title="Reject"
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
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">
                    No proposals found.
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
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
                <div>
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
                    {editingProposal ? 'Edit Proposal' : 'New Proposal'}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {editingProposal ? 'Update project and client details' : 'Enter project and client details'}
                  </p>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
                  <IconX size={24} />
                </button>
              </div>
              
              <form id="proposal-form" onSubmit={handleSubmitProposal} className="flex-1 overflow-y-auto p-6 pb-64 space-y-8 no-scrollbar">
                {/* Section 1: General Info */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">01</span>
                    General Information
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
                    Client Details
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/30">
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
                        onAddNew={() => setIsContactModalOpen(true)}
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
                    Project Specifics
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
                    Terrain & Technical Info
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
                  </div>
                </div>

                {/* Section 5: Surfaces & Capacity */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">05</span>
                    Surfaces & Capacity
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
                      Informations d'urbanisme et risques
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <RNBInfo address={newProposal.adresse_terrain || ''} />
                      <BDNBInfo 
                        address={newProposal.adresse_terrain || ''} 
                        banId={newProposal.ban_id_terrain}
                        cityCode={newProposal.city_code_terrain}
                      />
                      <CadastreDownload address={newProposal.adresse_terrain || ''} />
                      <UrbanPlanningInfo address={newProposal.adresse_terrain || ''} />
                      <GeorisquesInfo address={newProposal.adresse_terrain || ''} banId={newProposal.ban_id_terrain} />
                      <HistoricalMonuments address={newProposal.adresse_terrain || ''} />
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2 block">Location & Risks Maps</label>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-64">
                        <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative shadow-sm hover:shadow-md transition-shadow duration-300 group">
                          <GeoportailMap address={newProposal.adresse_terrain || ''} banId={newProposal.ban_id_terrain} />
                          <div className="absolute top-2 left-2 px-2 py-1 bg-white/90 dark:bg-black/90 backdrop-blur-md rounded text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 shadow-sm z-10">Cadastre</div>
                        </div>
                        <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative shadow-sm hover:shadow-md transition-shadow duration-300 group">
                          <GoogleMap address={newProposal.adresse_terrain || ''} />
                          <div className="absolute top-2 left-2 px-2 py-1 bg-white/90 dark:bg-black/90 backdrop-blur-md rounded text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 shadow-sm z-10">Google Maps</div>
                        </div>
                        <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative shadow-sm hover:shadow-md transition-shadow duration-300 group">
                          <GeorisquesMap address={newProposal.adresse_terrain || ''} banId={newProposal.ban_id_terrain} />
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField label="Montant des travaux (€)" type="number" value={newProposal.construction_cost} onChange={(v: any) => setNewProposal(prev => ({...prev, construction_cost: Number(v)}))} />
                    <FormField label="Taux de complexité" type="number" value={newProposal.complexity_rate} onChange={(v: any) => setNewProposal(prev => ({...prev, complexity_rate: Number(v)}))} />
                    <FormField label="% Honoraires Base" type="number" value={newProposal.base_fee_percent} onChange={(v: any) => setNewProposal(prev => ({...prev, base_fee_percent: Number(v)}))} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField label="Montant Honoraires HT (€)" type="number" value={newProposal.amount} onChange={(v: any) => setNewProposal(prev => ({...prev, amount: Number(v)}))} />
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">% avec Exé</label>
                      <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm font-medium text-zinc-900 dark:text-white">
                        {calculatedExePercent.toFixed(2)} %
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">% avec Missions Comp.</label>
                      <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm font-medium text-zinc-900 dark:text-white">
                        {calculatedTotalPercent.toFixed(2)} %
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField label="Taux de TVA (%)" type="number" value={newProposal.vat_rate} onChange={(v: any) => setNewProposal(prev => ({...prev, vat_rate: Number(v)}))} />
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Montant TVA (€)</label>
                      <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm font-medium text-zinc-900 dark:text-white">
                        {formatCurrency(vatAmount)}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Montant TTC (€)</label>
                      <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-sm font-bold text-blue-700 dark:text-blue-400">
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
                      Cotraitants / Spécialités
                    </h3>
                    <button 
                      type="button"
                      onClick={addSpecialtyRow}
                      className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold uppercase tracking-wider"
                    >
                      <IconPlus size={14} /> Ajouter une spécialité
                    </button>
                  </div>
                  
                  <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-visible bg-white dark:bg-zinc-900/50">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                        <tr>
                          <th className="px-4 py-3 text-left font-bold text-zinc-500 uppercase tracking-wider">Spécialité</th>
                          <th className="px-4 py-3 text-left font-bold text-zinc-500 uppercase tracking-wider">Contact</th>
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
                                onAddNew={() => setIsContactModalOpen(true)}
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
                              Aucun cotraitant ajouté.
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
                      Répartition des Honoraires
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
                        <IconFileSpreadsheet size={12} /> Exporter XLSX
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
                        <IconPlus size={12} /> Base
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
                        <IconPlus size={12} /> Exécution
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
                        <IconPlus size={12} /> Complémentaire
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 rounded-xl p-2 bg-white dark:bg-zinc-900/50 min-h-[400px]">
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
                      Calendrier prévisionnel
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

              <div className="p-6 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2.5 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 rounded-xl font-bold hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  form="proposal-form"
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                >
                  {editingProposal ? 'Update Proposal' : 'Create Proposal'}
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
          fetchContacts();
          // If we are in the main proposal form, we might want to auto-select it
          // but since we have multiple autocompletes, it's safer to just refresh the list
        }}
      />
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

  // Sync milestones with missions
  React.useEffect(() => {
    if (!proposal.id) return;
    
    const currentMissions = data.missions;
    const currentMilestones = milestones.filter(m => m.proposal_id === proposal.id);
    
    let hasChanges = false;
    const updatedMilestones = [...currentMilestones];

    // Add missing milestones
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

    // Remove extra milestones (those not in missions)
    const finalMilestones = updatedMilestones.filter(m => 
      currentMissions.find((mission: any) => mission.name === m.title)
    );

    if (finalMilestones.length !== currentMilestones.length || hasChanges) {
      onMilestonesChange(finalMilestones);
    }
  }, [data.missions, proposal.id]);

  const selectedContacts = React.useMemo(() => {
    const list = proposal.specialties_list || [];
    return list.map(s => {
      const contact = contacts.find(c => c.id === s.contact_id);
      return {
        id: s.contact_id || s.id,
        name: contact ? `${contact.first_name} ${contact.last_name}` : s.specialty_name,
        role: s.specialty_name
      };
    }).filter(c => c.id);
  }, [proposal.specialties_list, contacts]);

  const columns: Column[] = [
    { columnId: "mission", width: 150 },
    { columnId: "amount", width: 100 },
    { columnId: "rel_pct", width: 70 },
    { columnId: "solde", width: 100 },
    { columnId: "architect_pct", width: 70 },
    { columnId: "architect_amt", width: 100 },
    ...selectedContacts.flatMap(c => [
      { columnId: `${c.id}_pct`, width: 70 },
      { columnId: `${c.id}_amt`, width: 100 }
    ]),
    { columnId: "actions", width: 40 }
  ];

  const headerRow1: Row = {
    rowId: "header1",
    cells: [
      { type: "header", text: "Désignation" },
      { type: "header", text: "Montant HT" },
      { type: "header", text: "Rel %" },
      { type: "header", text: "Solde" },
      { type: "header", text: "Architecte", style: { textAlign: 'center' } },
      { type: "header", text: "" },
      ...selectedContacts.flatMap(c => [
        { type: "header", text: c.name, style: { textAlign: 'center' } },
        { type: "header", text: "" }
      ]),
      { type: "header", text: "" }
    ] as HeaderCell[]
  };

  const headerRow2: Row = {
    rowId: "header2",
    cells: [
      { type: "header", text: "" },
      { type: "header", text: "" },
      { type: "header", text: "" },
      { type: "header", text: "" },
      { type: "header", text: "%" },
      { type: "header", text: "€" },
      ...selectedContacts.flatMap(c => [
        { type: "header", text: "%" },
        { type: "header", text: "€" }
      ]),
      { type: "header", text: "" }
    ] as HeaderCell[]
  };

  const precision = (typeof proposal.decimal_precision === 'number' && !isNaN(proposal.decimal_precision)) ? proposal.decimal_precision : 2;

  const totalBaseAmount = React.useMemo(() => {
    return data.missions
      .filter((m: any) => m.category === 'Mission base')
      .reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
  }, [data.missions]);

  const buildRow = (m: any) => {
    const isBaseMission = m.category === 'Mission base';
    const missionAmount = m.amount || 0;
    const relPct = totalBaseAmount > 0 ? (missionAmount / totalBaseAmount) * 100 : 0;
    const archPct = m.percentages['architect'] || 0;
    const archAmt = missionAmount * (archPct / 100);
    
    let sumPct = archPct;
    selectedContacts.forEach(c => {
      sumPct += (m.percentages[c.id] || 0);
    });
    const soldePct = 100 - sumPct;
    const soldeAmt = missionAmount * (soldePct / 100);

    const safeNum = (val: number) => isNaN(val) ? 0 : Number(val.toFixed(precision));

    return {
      rowId: m.id,
      cells: [
        { type: "text", text: m.name } as TextCell,
        { type: "number", value: safeNum(missionAmount) } as NumberCell,
        { type: "number", value: safeNum(relPct) } as NumberCell,
        { type: "number", value: safeNum(soldeAmt) } as NumberCell,
        { type: "number", value: safeNum(archPct) } as NumberCell,
        { type: "number", value: safeNum(archAmt) } as NumberCell,
        ...selectedContacts.flatMap(c => {
          const pct = m.percentages[c.id] || 0;
          const amt = missionAmount * (pct / 100);
          return [
            { type: "number", value: safeNum(pct) } as NumberCell,
            { type: "number", value: safeNum(amt) } as NumberCell
          ];
        }),
        { type: "text", text: isBaseMission ? "" : "🗑️", style: { cursor: isBaseMission ? 'default' : 'pointer' } } as TextCell
      ]
    };
  };

  const buildTotalRow = (rowId: string, label: string, missions: any[], isCumulative = false) => {
    const totalAmt = missions.reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
    const relPct = totalBaseAmount > 0 ? (totalAmt / totalBaseAmount) * 100 : 0;
    
    const totalSolde = missions.reduce((acc: number, m: any) => {
      const missionAmount = m.amount || 0;
      const archPct = m.percentages['architect'] || 0;
      let sumPct = archPct;
      selectedContacts.forEach(c => {
        sumPct += (m.percentages[c.id] || 0);
      });
      return acc + (missionAmount * ((100 - sumPct) / 100));
    }, 0);

    const totalArchAmt = missions.reduce((acc: number, m: any) => acc + ((m.amount || 0) * ((m.percentages['architect'] || 0) / 100)), 0);

    const safeNum = (val: number) => isNaN(val) ? 0 : Number(val.toFixed(precision));

    return {
      rowId,
      cells: [
        { type: "text", text: label, style: { fontWeight: 'bold', background: '#f8fafc' } } as TextCell,
        { type: "number", value: safeNum(totalAmt), style: { fontWeight: 'bold', background: '#f8fafc' } } as NumberCell,
        { type: "number", value: safeNum(relPct), style: { fontWeight: 'bold', background: '#f8fafc' } } as NumberCell,
        { type: "number", value: safeNum(totalSolde), style: { fontWeight: 'bold', background: '#f8fafc' } } as NumberCell,
        { type: "number", value: 0, style: { fontWeight: 'bold', background: '#f8fafc' } } as NumberCell,
        { type: "number", value: safeNum(totalArchAmt), style: { fontWeight: 'bold', background: '#f8fafc' } } as NumberCell,
        ...selectedContacts.flatMap(c => {
          const contactTotalAmt = missions.reduce((acc: number, m: any) => acc + ((m.amount || 0) * ((m.percentages[c.id] || 0) / 100)), 0);
          return [
            { type: "number", value: 0, style: { fontWeight: 'bold', background: '#f8fafc' } } as NumberCell,
            { type: "number", value: safeNum(contactTotalAmt), style: { fontWeight: 'bold', background: '#f8fafc' } } as NumberCell
          ];
        }),
        { type: "text", text: "", style: { background: '#f8fafc' } } as TextCell
      ]
    };
  };

  const buildVATRows = (missions: any[]) => {
    const totalHT = missions.reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
    const vatRate = proposal.vat_rate || 20;
    const vatAmt = totalHT * (vatRate / 100);
    const totalTTC = totalHT + vatAmt;

    const safeNum = (val: number) => isNaN(val) ? 0 : Number(val.toFixed(precision));

    return [
      {
        rowId: `vat-${missions.length}`,
        cells: [
          { type: "text", text: `TVA (${vatRate}%)`, style: { fontStyle: 'italic', color: '#64748b' } } as TextCell,
          { type: "number", value: safeNum(vatAmt), style: { fontStyle: 'italic', color: '#64748b' } } as NumberCell,
          ...Array(columns.length - 2).fill({ type: "text", text: "" })
        ]
      },
      {
        rowId: `ttc-${missions.length}`,
        cells: [
          { type: "text", text: "TOTAL TTC", style: { fontWeight: 'bold', color: '#1e40af' } } as TextCell,
          { type: "number", value: safeNum(totalTTC), style: { fontWeight: 'bold', color: '#1e40af' } } as NumberCell,
          ...Array(columns.length - 2).fill({ type: "text", text: "" })
        ]
      }
    ];
  };

  const baseMissions = data.missions.filter((m: any) => m.category === 'Mission base');
  const exeMissions = data.missions.filter((m: any) => m.category === 'Mission Exécution');
  const compMissions = data.missions.filter((m: any) => m.category === 'Missions complémentaires');

  const rows: Row[] = [
    headerRow1,
    headerRow2,
    { rowId: 'cat-base', cells: [{ type: 'header', text: 'Mission base' }, ...Array(columns.length - 1).fill({ type: 'header', text: '' })] as HeaderCell[] },
    ...baseMissions.map((m: any) => buildRow(m)),
    buildTotalRow('total-base', 'Sous-total Base', baseMissions),

    { rowId: 'cat-exe', cells: [{ type: 'header', text: 'Mission Exécution' }, ...Array(columns.length - 1).fill({ type: 'header', text: '' })] as HeaderCell[] },
    ...exeMissions.map((m: any) => buildRow(m)),
    buildTotalRow('total-exe', 'Sous-total Exécution', exeMissions),
    buildTotalRow('cumul-exe', 'Total Base + Exé', [...baseMissions, ...exeMissions], true),

    { rowId: 'cat-comp', cells: [{ type: 'header', text: 'Missions complémentaires' }, ...Array(columns.length - 1).fill({ type: 'header', text: '' })] as HeaderCell[] },
    ...compMissions.map((m: any) => buildRow(m)),
    buildTotalRow('total-comp', 'Sous-total Complémentaire', compMissions),
    buildTotalRow('cumul-comp', 'TOTAL GENERAL HT', [...baseMissions, ...exeMissions, ...compMissions], true),
    ...buildVATRows([...baseMissions, ...exeMissions, ...compMissions])
  ];

  const handleChanges = (changes: CellChange[]) => {
    let newData = { ...data };
    changes.forEach(change => {
      const missionIndex = newData.missions.findIndex((m: any) => m.id === change.rowId);
      if (missionIndex === -1) return;

      const isBaseMission = newData.missions[missionIndex].category === 'Mission base';

      if (change.columnId === "mission") {
        newData.missions[missionIndex].name = (change.newCell as TextCell).text;
      } else if (change.columnId === "amount") {
        newData.missions[missionIndex].amount = (change.newCell as NumberCell).value;
      } else if (change.columnId === "rel_pct") {
        const newRelPct = (change.newCell as NumberCell).value;
        if (isBaseMission) {
          const baseMissions = newData.missions.filter((m: any) => m.category === 'Mission base');
          const idx = baseMissions.findIndex((m: any) => m.id === change.rowId);
          const targetTotal = proposal.amount || 0;
          
          let sumAbove = 0;
          for (let i = 0; i < idx; i++) {
            sumAbove += (baseMissions[i].amount / targetTotal) * 100;
          }
          
          const remaining = 100 - sumAbove - newRelPct;
          newData.missions[missionIndex].amount = (newRelPct * targetTotal) / 100;
          
          const missionsBelow = baseMissions.slice(idx + 1);
          const sumBelow = missionsBelow.reduce((acc, m) => acc + (m.amount || 0), 0);
          
          if (missionsBelow.length > 0) {
            missionsBelow.forEach(mb => {
              const mbIdx = newData.missions.findIndex((m: any) => m.id === mb.id);
              if (sumBelow > 0) {
                const mbRelWeight = mb.amount / sumBelow;
                newData.missions[mbIdx].amount = (mbRelWeight * remaining * targetTotal) / 100;
              } else {
                newData.missions[mbIdx].amount = (remaining / missionsBelow.length * targetTotal) / 100;
              }
            });
          }
        } else {
          newData.missions[missionIndex].amount = (newRelPct * totalBaseAmount) / 100;
        }
      } else if (change.columnId === "architect_pct") {
        newData.missions[missionIndex].percentages['architect'] = (change.newCell as NumberCell).value;
      } else if (typeof change.columnId === 'string' && change.columnId.endsWith("_pct")) {
        const contactId = change.columnId.replace("_pct", "");
        newData.missions[missionIndex].percentages[contactId] = (change.newCell as NumberCell).value;
      } else if (change.columnId === "actions" && !isBaseMission) {
        // Handle delete via clearing the cell or typing something
        if ((change.newCell as TextCell).text === "") {
          newData.missions = newData.missions.filter((m: any) => m.id !== change.rowId);
        }
      }
    });
    onChange(newData);
  };

  return (
    <ReactGrid 
      rows={rows} 
      columns={columns} 
      onCellsChanged={handleChanges}
      enableRowSelection
      enableColumnSelection
    />
  );
};

const exportToXlsx = (proposal: Partial<Proposal>, contacts: Contact[]) => {
  if (!proposal.fee_distribution) return;
  try {
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
