import * as React from 'react';
import { useState, useEffect } from 'react';
import { IconPlus, IconFileSpreadsheet, IconCircleCheck, IconClock, IconX, IconTrash, IconDeviceFloppy, IconSearch, IconFilter, IconEdit, IconFileText } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import { fetchJson } from '../lib/api';
import type { Proposal, Contact, Milestone } from '../types';
import { useTranslation } from 'react-i18next';
import { GeoportailMap, GoogleMap, GeorisquesMap, GeorisquesInfo, RNBInfo } from '../components/LocationMaps';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import { CompanyAutocomplete } from '../components/CompanyAutocomplete';
import { CadastreDownload } from '../components/CadastreDownload';
import MilestoneGantt from '../components/MilestoneGantt';

const FormField = ({ label, value, onChange, type = "text", required = false, options = [] }: any) => (
  <div>
    <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    {type === "select" ? (
      <select 
        required={required}
        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">Select...</option>
        {options.map((opt: any) => (
          <option key={opt.id || opt} value={opt.id || opt}>{opt.name || opt}</option>
        ))}
      </select>
    ) : type === "textarea" ? (
      <textarea 
        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white resize-none h-20"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    ) : type === "checkbox" ? (
      <div className="flex items-center h-9">
        <input 
          type="checkbox"
          className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
          checked={value}
          onChange={e => onChange(e.target.checked)}
        />
      </div>
    ) : (
      <input 
        type={type}
        required={required}
        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    )}
  </div>
);

export default function Proposals() {
  const { t } = useTranslation();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
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
    specialties_list: []
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

  const updateSpecialty = (index: number, field: string, value: string) => {
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
              
              <form id="proposal-form" onSubmit={handleSubmitProposal} className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar">
                {/* Section 1: General Info */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">01</span>
                    General Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField label="Référence" value={newProposal.reference} onChange={(v: any) => setNewProposal({...newProposal, reference: v})} />
                    <div className="md:col-span-2">
                      <FormField label="Projet (Titre)" required value={newProposal.title} onChange={(v: any) => setNewProposal({...newProposal, title: v})} />
                    </div>
                    <FormField label="Amount" type="number" required value={newProposal.amount} onChange={(v: any) => setNewProposal({...newProposal, amount: Number(v)})} />
                    <FormField label="Status" type="select" options={['Draft', 'Sent', 'Accepted', 'Rejected']} value={newProposal.status} onChange={(v: any) => setNewProposal({...newProposal, status: v})} />
                    <FormField label="Ind" value={newProposal.ind} onChange={(v: any) => setNewProposal({...newProposal, ind: v})} />
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
                      <FormField label="Client Database" type="select" required options={contacts.map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name}` }))} value={newProposal.client_id} onChange={(v: any) => setNewProposal({...newProposal, client_id: v})} />
                    </div>
                    <FormField label="Entreprise?" type="checkbox" value={newProposal.is_entreprise} onChange={(v: any) => setNewProposal({...newProposal, is_entreprise: v})} />
                    <CompanyAutocomplete 
                      label="Nom Société" 
                      value={newProposal.nom_societe || ''} 
                      onChange={(val, details) => {
                        if (details) {
                          setNewProposal({
                            ...newProposal,
                            nom_societe: val,
                            rcs: details.siren || details.siret || '',
                            adresse_client: details.address || '',
                            cp_client: details.zipcode || '',
                            ville_client: details.city || '',
                            is_entreprise: true
                          });
                        } else {
                          setNewProposal({...newProposal, nom_societe: val});
                        }
                      }} 
                    />
                    <FormField label="RCS / SIRET" value={newProposal.rcs} onChange={(v: any) => setNewProposal({...newProposal, rcs: v})} />
                    <FormField label="Représentant" value={newProposal.representant} onChange={(v: any) => setNewProposal({...newProposal, representant: v})} />
                    <FormField label="Qualité" value={newProposal.qualite} onChange={(v: any) => setNewProposal({...newProposal, qualite: v})} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-3">
                      <AddressAutocomplete 
                        label="Adresse Complète Client" 
                        value={newProposal.adresse_client || ''} 
                        onChange={(val: string, details: any) => {
                          setNewProposal({
                            ...newProposal, 
                            adresse_client: val,
                            cp_client: details?.zipcode || '',
                            ville_client: details?.city || ''
                          });
                        }} 
                      />
                    </div>
                    <FormField label="Téléphone" value={newProposal.telephone} onChange={(v: any) => setNewProposal({...newProposal, telephone: v})} />
                    <FormField label="Portable" value={newProposal.portable} onChange={(v: any) => setNewProposal({...newProposal, portable: v})} />
                    <FormField label="Adresse Mail" type="email" value={newProposal.email_client} onChange={(v: any) => setNewProposal({...newProposal, email_client: v})} />
                  </div>
                </div>

                {/* Section 3: Project Specifics */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">03</span>
                    Project Specifics
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label="Détail du Projet" type="textarea" value={newProposal.projet_detail} onChange={(v: any) => setNewProposal({...newProposal, projet_detail: v})} />
                    <FormField label="Description Générale" type="textarea" value={newProposal.description} onChange={(v: any) => setNewProposal({...newProposal, description: v})} />
                  </div>
                </div>

                {/* Section 4: Terrain & Technical */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">04</span>
                    Terrain & Technical Info
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-3">
                      <AddressAutocomplete 
                        label="Adresse Complète Terrain" 
                        value={newProposal.adresse_terrain || ''} 
                        onChange={(val: string, details: any) => {
                          setNewProposal({
                            ...newProposal, 
                            adresse_terrain: val,
                            cp_ville_terrain: details ? `${details.zipcode || ''} ${details.city || ''}`.trim() : ''
                          });
                        }} 
                      />
                    </div>
                    <FormField label="Référence Cadastrale" value={newProposal.ref_cadastrale} onChange={(v: any) => setNewProposal({...newProposal, ref_cadastrale: v})} />
                    <FormField label="Zone PLU" value={newProposal.zone_plu} onChange={(v: any) => setNewProposal({...newProposal, zone_plu: v})} />
                    <FormField label="Surface Parcelle" value={newProposal.surface_parcelle} onChange={(v: any) => setNewProposal({...newProposal, surface_parcelle: v})} />
                    <FormField label="Nom Etablissement" value={newProposal.nom_etablissement} onChange={(v: any) => setNewProposal({...newProposal, nom_etablissement: v})} />
                    <FormField label="Avant Travaux" value={newProposal.avant_trav} onChange={(v: any) => setNewProposal({...newProposal, avant_trav: v})} />
                    <FormField label="Après Travaux" value={newProposal.apres_trav} onChange={(v: any) => setNewProposal({...newProposal, apres_trav: v})} />
                    <FormField label="Type Et Cat" value={newProposal.type_et_cat} onChange={(v: any) => setNewProposal({...newProposal, type_et_cat: v})} />
                    <FormField label="Type" value={newProposal.type_projet} onChange={(v: any) => setNewProposal({...newProposal, type_projet: v})} />
                    <FormField label="Catégorie" value={newProposal.categorie_projet} onChange={(v: any) => setNewProposal({...newProposal, categorie_projet: v})} />
                  </div>
                </div>

                {/* Section 5: Surfaces & Capacity */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">05</span>
                    Surfaces & Capacity
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <FormField label="Surf. Plancher" value={newProposal.surface_plancher} onChange={(v: any) => setNewProposal({...newProposal, surface_plancher: v})} />
                    <FormField label="Surf. Extension" value={newProposal.surface_plancher_ext} onChange={(v: any) => setNewProposal({...newProposal, surface_plancher_ext: v})} />
                    <FormField label="Surf. ERP" value={newProposal.surface_erp} onChange={(v: any) => setNewProposal({...newProposal, surface_erp: v})} />
                    <FormField label="Surf. ERT" value={newProposal.surface_ert} onChange={(v: any) => setNewProposal({...newProposal, surface_ert: v})} />
                    <FormField label="Effectif Public" value={newProposal.effectif_public} onChange={(v: any) => setNewProposal({...newProposal, effectif_public: v})} />
                    <FormField label="Effectif Personnel" value={newProposal.effectif_personnel} onChange={(v: any) => setNewProposal({...newProposal, effectif_personnel: v})} />
                    <FormField label="Date Modif." value={newProposal.date_modification} onChange={(v: any) => setNewProposal({...newProposal, date_modification: v})} />
                  </div>
                </div>

                {newProposal.adresse_terrain && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <RNBInfo address={[newProposal.adresse_terrain, newProposal.cp_ville_terrain].filter(Boolean).join(', ')} />
                      <GeorisquesInfo address={[newProposal.adresse_terrain, newProposal.cp_ville_terrain].filter(Boolean).join(', ')} />
                      <CadastreDownload address={[newProposal.adresse_terrain, newProposal.cp_ville_terrain].filter(Boolean).join(', ')} />
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2 block">Location & Risks</label>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-64">
                        <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative">
                          <GeoportailMap address={[newProposal.adresse_terrain, newProposal.cp_ville_terrain].filter(Boolean).join(', ')} />
                          <div className="absolute top-2 left-2 px-2 py-1 bg-white/80 dark:bg-black/80 backdrop-blur-sm rounded text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700">Cadastre</div>
                        </div>
                        <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative">
                          <GoogleMap address={[newProposal.adresse_terrain, newProposal.cp_ville_terrain].filter(Boolean).join(', ')} />
                          <div className="absolute top-2 left-2 px-2 py-1 bg-white/80 dark:bg-black/80 backdrop-blur-sm rounded text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700">Google Maps</div>
                        </div>
                        <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 relative">
                          <GeorisquesMap address={[newProposal.adresse_terrain, newProposal.cp_ville_terrain].filter(Boolean).join(', ')} />
                          <div className="absolute top-2 left-2 px-2 py-1 bg-white/80 dark:bg-black/80 backdrop-blur-sm rounded text-[10px] font-bold uppercase tracking-wider border border-zinc-200 dark:border-zinc-700">Géorisques</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Section 6: Cotraitants / Spécialités */}
                <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">06</span>
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
                  
                  <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden bg-white dark:bg-zinc-900/50">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                        <tr>
                          <th className="px-4 py-3 text-left font-bold text-zinc-500 uppercase tracking-wider">Spécialité</th>
                          <th className="px-4 py-3 text-left font-bold text-zinc-500 uppercase tracking-wider">Contact</th>
                          <th className="px-4 py-3 text-right font-bold text-zinc-500 uppercase tracking-wider w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                        {newProposal.specialties_list?.map((spec, idx) => (
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
                        ))}
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
                {/* Section 7: Milestones */}
                {editingProposal && (
                  <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-6">
                    <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px]">07</span>
                      Milestones
                    </h3>
                    <MilestoneGantt 
                      milestones={milestones.filter(m => m.proposal_id === editingProposal.id)} 
                      startDate={new Date(editingProposal.created_at)} 
                      endDate={new Date()} 
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
    </div>
  );
}
