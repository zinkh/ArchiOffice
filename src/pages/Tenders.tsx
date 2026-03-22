import * as React from 'react';
import { useState, useEffect } from 'react';
import { IconPlus, IconFileText, IconCircleCheck, IconClock, IconAlertTriangle, IconDownload, IconX, IconTrash, IconEdit } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import type { Tender, Contact, Milestone } from '../types';
import { useTranslation } from 'react-i18next';
import MilestoneGantt from '../components/MilestoneGantt';

export default function Tenders() {
  const { t } = useTranslation();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [editingTender, setEditingTender] = useState<Tender | null>(null);
  const [formSpecialties, setFormSpecialties] = useState<{id?: string, specialty_name: string, contact_id?: string}[]>([]);
  const [formMilestones, setFormMilestones] = useState<{id?: string, title: string, due_date: string, completed: boolean}[]>([]);
  const initialTenderState: Partial<Tender> = { 
    title: '', 
    client: '', 
    submission_deadline: '', 
    value: 0,
    mandataire_id: '',
    type: 'Concours',
    surface: 0,
    construction_cost: 0,
    honoraires_percent: 0,
    mandatory_visit: false,
    visit_date: '',
    withdrawal_deadline: ''
  };
  const [newTender, setNewTender] = useState<Partial<Tender>>(initialTenderState);

  useEffect(() => {
    fetch('/api/tenders')
      .then(async res => {
        const contentType = res.headers.get('content-type');
        if (!res.ok || !contentType || !contentType.includes('application/json')) {
          const text = await res.text();
          if (text.includes('Please wait while your application starts')) {
            console.log('Server is still starting...');
            return [];
          }
          throw new Error('Failed to fetch tenders');
        }
        return res.json();
      })
      .then(data => {
        if (!data) return;
        // Convert SQLite 0/1 to boolean for mandatory_visit
        const formattedData = data.map((t: any) => ({
          ...t,
          mandatory_visit: !!t.mandatory_visit
        }));
        setTenders(formattedData);
      })
      .catch(err => console.error(err));

    fetch('/api/contacts')
      .then(async res => {
        const contentType = res.headers.get('content-type');
        if (res.ok && contentType && contentType.includes('application/json')) {
          return res.json();
        }
        return [];
      })
      .then(setContacts)
      .catch(err => console.error(err));
      
    fetchMilestones();
  }, []);

  const fetchMilestones = async () => {
    try {
      const res = await fetch('/api/milestones');
      const contentType = res.headers.get('content-type');
      if (res.ok && contentType && contentType.includes('application/json')) {
        setMilestones(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const addSpecialtyRow = () => {
    setFormSpecialties([...formSpecialties, { specialty_name: '', contact_id: '' }]);
  };

  const removeSpecialtyRow = (index: number) => {
    setFormSpecialties(formSpecialties.filter((_, i) => i !== index));
  };

  const updateSpecialty = (index: number, field: string, value: string) => {
    const updated = [...formSpecialties];
    updated[index] = { ...updated[index], [field]: value } as any;
    setFormSpecialties(updated);
  };

  const addMilestoneRow = () => {
    setFormMilestones([...formMilestones, { title: '', due_date: '', completed: false }]);
  };

  const removeMilestoneRow = (index: number) => {
    setFormMilestones(formMilestones.filter((_, i) => i !== index));
  };

  const updateMilestone = (index: number, field: string, value: any) => {
    const updated = [...formMilestones];
    updated[index] = { ...updated[index], [field]: value };
    setFormMilestones(updated);
  };

  const handleCreateBid = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const url = editingTender ? `/api/tenders/${editingTender.id}` : '/api/tenders';
      const method = editingTender ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newTender,
          status: editingTender ? newTender.status : 'Draft',
          notes: newTender.notes || '',
          specialties_list: formSpecialties,
          milestones_list: formMilestones
        })
      });
      if (!res.ok) throw new Error('Failed to save tender');
      const savedTender = await res.json();
      const formattedTender = {
        ...savedTender,
        mandatory_visit: !!savedTender.mandatory_visit
      };
      
      if (editingTender) {
        setTenders(tenders.map(t => t.id === formattedTender.id ? formattedTender : t));
      } else {
        setTenders([formattedTender, ...tenders]);
      }
      
      setShowSuccess(true);
      setTimeout(() => {
        setIsModalOpen(false);
        setEditingTender(null);
        setFormSpecialties([]);
        setFormMilestones([]);
        setNewTender(initialTenderState);
        setShowSuccess(false);
        fetchMilestones();
      }, 1000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditClick = (tender: Tender) => {
    setEditingTender(tender);
    setNewTender(tender);
    setFormSpecialties(tender.specialties_list || []);
    setFormMilestones(milestones.filter(m => m.tender_id === tender.id));
    setIsModalOpen(true);
  };

  const handleOpenCreateModal = () => {
    setEditingTender(null);
    setNewTender(initialTenderState);
    setFormSpecialties([]);
    setFormMilestones([]);
    setIsModalOpen(true);
  };

  const getStatusIcon = (status: Tender['status']) => {
    switch (status) {
      case 'Won': return <IconCircleCheck className="w-4 h-4 text-green-500" />;
      case 'Lost': return <IconAlertTriangle className="w-4 h-4 text-red-500" />;
      case 'Submitted': return <IconClock className="w-4 h-4 text-blue-500" />;
      default: return <IconFileText className="w-4 h-4 text-zinc-400" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('tenders')}</h2>
          <p className="text-zinc-500 dark:text-zinc-400">Track and manage bids for new architectural contracts.</p>
        </div>
        <motion.button 
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleOpenCreateModal}
          className="flex items-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 rounded-md font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shadow-sm"
        >
          <IconPlus size={18} />
          {t('create_bid')}
        </motion.button>
      </div>

      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-700">
                <th className="px-6 py-3 font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs">{t('description')}</th>
                <th className="px-6 py-3 font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs">{t('client')}</th>
                <th className="px-6 py-3 font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs">Type</th>
                <th className="px-6 py-3 font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs">Specialties / Partners</th>
                <th className="px-6 py-3 font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs">{t('deadline')}</th>
                <th className="px-6 py-3 font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs">{t('valuation')}</th>
                <th className="px-6 py-3 font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs">{t('status')}</th>
                <th className="px-6 py-3 font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs text-right">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {tenders.map((tender) => (
                <tr key={tender.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-zinc-900 dark:text-white">{tender.title}</span>
                      <span className="text-[10px] text-zinc-400 uppercase tracking-tight">{tender.mandataire_name || 'No representative'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{tender.client}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase">
                      {tender.type || 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {tender.specialties_list && tender.specialties_list.length > 0 ? (
                        tender.specialties_list.map((spec, i) => (
                          <div key={i} className="flex flex-col bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 rounded px-1.5 py-0.5">
                            <span className="text-[9px] font-bold text-zinc-400 uppercase leading-tight">{spec.specialty_name}</span>
                            <span className="text-[10px] text-zinc-600 dark:text-zinc-300 leading-tight">{spec.contact_name || 'TBD'}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-zinc-400 italic">None</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">
                    <div className="flex flex-col">
                      <span>{new Date(tender.submission_deadline).toLocaleDateString()}</span>
                      {tender.withdrawal_deadline && (
                        <span className="text-[10px] text-red-500">Withdrawal: {new Date(tender.withdrawal_deadline).toLocaleDateString()}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-zinc-600 dark:text-zinc-300">{formatCurrency(tender.value)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(tender.status)}
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">{tender.status}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => handleEditClick(tender)}
                        className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                        title="Edit"
                      >
                        <IconEdit size={18} />
                      </button>
                      <button className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
                        <IconDownload size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {tenders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-zinc-400 dark:text-zinc-500">
                    <div className="flex flex-col items-center gap-2">
                      <IconFileText size={32} className="opacity-20" />
                      <p>No active tenders found.</p>
                    </div>
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
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-xl overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
                  {editingTender ? 'Edit Tender Bid' : 'Créer une offre'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                  <IconX size={20} />
                </button>
              </div>
              <form onSubmit={handleCreateBid} className="p-6 space-y-4 max-h-[85vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Project Title</label>
                    <input 
                      required
                      placeholder="Réhabilitation du bâtiment URSSAF de Lorraine - S..."
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                      value={newTender.title || ''}
                      onChange={e => setNewTender({...newTender, title: e.target.value})}
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Entité adjudicatrice</label>
                    </div>
                    <select 
                      required
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                      value={newTender.client || ''}
                      onChange={e => setNewTender({...newTender, client: e.target.value})}
                    >
                      <option value="">Sélectionner un client</option>
                      {contacts.filter(c => c.category === 'Client' || c.category === 'Maitre d\'ouvrage').map(c => (
                        <option key={c.id} value={c.company_name || `${c.first_name} ${c.last_name}`}>{c.company_name || `${c.first_name} ${c.last_name}`}</option>
                      ))}
                      {/* Fallback if no clients found with category */}
                      {contacts.filter(c => c.category !== 'Client' && c.category !== 'Maitre d\'ouvrage').length > 0 && contacts.filter(c => c.category === 'Client' || c.category === 'Maitre d\'ouvrage').length === 0 && contacts.map(c => (
                        <option key={c.id} value={c.company_name || `${c.first_name} ${c.last_name}`}>{c.company_name || `${c.first_name} ${c.last_name}`}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Representative (Mandataire)</label>
                    <select 
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                      value={newTender.mandataire_id || ''}
                      onChange={e => setNewTender({...newTender, mandataire_id: e.target.value})}
                    >
                      <option value="">Select a contact</option>
                      {contacts.map(c => (
                        <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Type</label>
                    <select 
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                      value={newTender.type || ''}
                      onChange={e => setNewTender({...newTender, type: e.target.value})}
                    >
                      <option value="Concours">Concours</option>
                      <option value="MAPA">MAPA</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Surface (m²)</label>
                    <input 
                      type="number"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                      value={newTender.surface || 0}
                      onChange={e => setNewTender({...newTender, surface: Number(e.target.value)})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Construction Cost (HT)</label>
                    <input 
                      type="number"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                      value={newTender.construction_cost || 0}
                      onChange={e => setNewTender({...newTender, construction_cost: Number(e.target.value)})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fee Percentage (%)</label>
                    <input 
                      type="number"
                      step="0.01"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                      value={newTender.honoraires_percent || 0}
                      onChange={e => setNewTender({...newTender, honoraires_percent: Number(e.target.value)})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Submission Deadline</label>
                    <input 
                      required
                      type="date"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                      value={newTender.submission_deadline || ''}
                      onChange={e => setNewTender({...newTender, submission_deadline: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Withdrawal Deadline</label>
                    <input 
                      type="date"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                      value={newTender.withdrawal_deadline || ''}
                      onChange={e => setNewTender({...newTender, withdrawal_deadline: e.target.value})}
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <div className="relative flex items-center">
                        <input 
                          type="checkbox"
                          className="peer sr-only"
                          checked={newTender.mandatory_visit || false}
                          onChange={e => setNewTender({...newTender, mandatory_visit: e.target.checked})}
                        />
                        <div className="w-10 h-5 bg-zinc-200 dark:bg-zinc-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                      </div>
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors">
                        Mandatory Visit Required? (Visite obligatoire ?)
                      </span>
                    </label>
                  </div>

                  {newTender.mandatory_visit && (
                    <div className="col-span-2 border-t border-zinc-100 dark:border-zinc-800 pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Dates & Milestones</label>
                        <button 
                          type="button"
                          onClick={addMilestoneRow}
                          className="text-[10px] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold uppercase"
                        >
                          <IconPlus size={12} /> Add Date/Hour
                        </button>
                      </div>
                      
                      <div className="space-y-2 mb-4">
                        {formMilestones.map((m, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input 
                              placeholder="Title (e.g. Site Visit)"
                              className="flex-1 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                              value={m.title}
                              onChange={e => updateMilestone(idx, 'title', e.target.value)}
                            />
                            <input 
                              type="datetime-local"
                              className="w-44 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                              value={m.due_date}
                              onChange={e => updateMilestone(idx, 'due_date', e.target.value)}
                            />
                            <button 
                              type="button"
                              onClick={() => removeMilestoneRow(idx)}
                              className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                            >
                              <IconTrash size={16} />
                            </button>
                          </div>
                        ))}
                        {formMilestones.length === 0 && (
                          <p className="text-[10px] text-zinc-500 italic">No milestones added yet.</p>
                        )}
                      </div>

                      {editingTender && milestones.filter(m => m.tender_id === editingTender.id).length > 0 && (
                        <div className="space-y-4 mb-4">
                          <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400">Timeline Preview</h3>
                          <MilestoneGantt 
                            milestones={milestones.filter(m => m.tender_id === editingTender.id)} 
                            startDate={new Date(editingTender.submission_deadline)} 
                            endDate={new Date()} 
                          />
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="col-span-2 border-t border-zinc-100 dark:border-zinc-800 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Required Specialties</label>
                      <button 
                        type="button"
                        onClick={addSpecialtyRow}
                        className="text-[10px] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold uppercase"
                      >
                        <IconPlus size={12} /> Add Specialty
                      </button>
                    </div>
                    
                    <div className="space-y-2">
                      {formSpecialties.map((spec, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input 
                            placeholder="Specialty (e.g. Structure)"
                            className="flex-1 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                            value={spec.specialty_name}
                            onChange={e => updateSpecialty(idx, 'specialty_name', e.target.value)}
                          />
                          <ContactAutocomplete 
                            className="flex-1"
                            contacts={contacts}
                            value={spec.contact_id || ''}
                            onChange={val => updateSpecialty(idx, 'contact_id', val)}
                          />
                          <button 
                            type="button"
                            onClick={() => removeSpecialtyRow(idx)}
                            className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                          >
                            <IconTrash size={16} />
                          </button>
                        </div>
                      ))}
                      {formSpecialties.length === 0 && (
                        <p className="text-[10px] text-zinc-500 italic">No specialties added yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Valuation (Estimated Fees)</label>
                    <input 
                      required
                      type="number"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                      value={newTender.value || 0}
                      onChange={e => setNewTender({...newTender, value: Number(e.target.value)})}
                    />
                  </div>
                  {editingTender && (
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                      <select 
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white"
                        value={newTender.status || ''}
                        onChange={e => setNewTender({...newTender, status: e.target.value as any})}
                      >
                        <option value="Draft">Draft</option>
                        <option value="Submitted">Submitted</option>
                        <option value="Won">Won</option>
                        <option value="Lost">Lost</option>
                      </select>
                    </div>
                  )}
                </div>
                <button 
                  type="submit"
                  disabled={isSaving || showSuccess}
                  className={cn(
                    "w-full py-2 rounded-lg font-medium transition-all mt-4 flex items-center justify-center gap-2",
                    showSuccess 
                      ? "bg-green-600 text-white" 
                      : "bg-blue-600 text-white hover:bg-blue-700",
                    (isSaving || showSuccess) && "opacity-80 cursor-not-allowed"
                  )}
                >
                  {isSaving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : showSuccess ? (
                    <>
                      <IconCircleCheck size={20} />
                      Saved Successfully!
                    </>
                  ) : (
                    editingTender ? 'Update Tender Bid' : 'Create Tender Bid'
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
