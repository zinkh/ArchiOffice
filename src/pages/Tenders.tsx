import * as React from 'react';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { IconPlus, IconFileText, IconCircleCheck, IconClock, IconAlertTriangle, IconDownload, IconX, IconTrash, IconEdit, IconArchive, IconFilter, IconSortAscending, IconSortDescending, IconEye, IconList, IconRss } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import { fetchJson } from '../lib/api';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import { ContactModal } from '../components/ContactModal';
import { TenderRssWatch } from '../components/TenderRssWatch';
import type { Tender, Contact, Milestone } from '../types';
import { useTranslation } from 'react-i18next';
import MilestoneGantt from '../components/MilestoneGantt';
import { MobileAccordionTable } from '../components/MobileAccordionTable';

export default function Tenders() {
  const { t } = useTranslation();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
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
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterType, setFilterType] = useState<string>('All');
  const [sortByDeadline, setSortByDeadline] = useState<'asc' | 'desc' | null>(null);
  const [activeTab, setActiveTab] = useState<'list' | 'watch'>('list');

  useEffect(() => {
    const loadData = async () => {
      try {
        const [tendersData, contactsData] = await Promise.all([
          fetchJson<any[]>('/api/tenders'),
          fetchJson<Contact[]>('/api/contacts')
        ]);

        const formattedTenders = tendersData.map((t: any) => ({
          ...t,
          mandatory_visit: !!t.mandatory_visit
        }));
        setTenders(formattedTenders);
        setContacts(contactsData);
      } catch (err) {
        console.error('Tenders data fetch failed:', err);
      }
    };

    loadData();
    fetchMilestones();
  }, []);

  const fetchMilestones = async () => {
    try {
      const data = await fetchJson<Milestone[]>('/api/milestones');
      setMilestones(data);
    } catch (err) {
      console.error('Milestones fetch failed:', err);
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

  const handleArchive = async (tender: Tender) => {
    try {
      const res = await fetch(`/api/tenders/${tender.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...tender,
          archived: !tender.archived
        })
      });
      if (!res.ok) throw new Error('Failed to archive tender');
      const updatedTender = await res.json();
      setTenders(tenders.map(t => t.id === updatedTender.id ? { ...updatedTender, mandatory_visit: !!updatedTender.mandatory_visit } : t));
    } catch (err) {
      console.error(err);
    }
  };

  const filteredTenders = tenders.filter(t => {
    const statusMatch = filterStatus === 'All' || t.status === filterStatus;
    const typeMatch = filterType === 'All' || t.type === filterType;
    return statusMatch && typeMatch;
  });

  const sortedTenders = [...filteredTenders].sort((a, b) => {
    if (!sortByDeadline) return 0;
    const dateA = new Date(a.submission_deadline).getTime();
    const dateB = new Date(b.submission_deadline).getTime();
    return sortByDeadline === 'asc' ? dateA - dateB : dateB - dateA;
  });

  const activeTenders = sortedTenders.filter(t => !t.archived);
  const archivedTenders = sortedTenders.filter(t => t.archived);

  const handleOpenCreateModal = () => {
    setEditingTender(null);
    setNewTender(initialTenderState);
    setFormSpecialties([]);
    setFormMilestones([]);
    setIsModalOpen(true);
  };

  const handleExportXLSX = async () => {
    let agencyName = '';
    try { const s = await fetch('/api/settings').then(r => r.ok ? r.json() : null); agencyName = s?.agencyName || ''; } catch { /* */ }
    const XLSX = await import('xlsx');
    const rows = filteredTenders.map(t => ({
      'Titre': t.title,
      'Client': t.client || '',
      'Statut': t.status || '',
      'Type': t.type || '',
      'Date de rendu': t.submission_deadline || '',
      'Valeur estimée': t.value || 0,
      'Honoraires (%)': t.honoraires_percent || 0,
      'Surface': t.surface || 0,
      'Coût travaux': t.construction_cost || 0,
    }));
    const worksheet = XLSX.utils.json_to_sheet([]);
    if (agencyName) {
      XLSX.utils.sheet_add_aoa(worksheet, [[agencyName], ['Appels d\'offres']], { origin: 'A1' });
      XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A4' });
    } else {
      XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A1' });
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Appels d\'offres');
    XLSX.writeFile(workbook, 'appels-offres.xlsx');
  };

  const getStatusIcon = (status: Tender['status']) => {
    switch (status) {
      case 'Won': return <IconCircleCheck className="w-4 h-4" style={{ color: 'var(--tblr-success)' }} />;
      case 'Lost': return <IconAlertTriangle className="w-4 h-4" style={{ color: 'var(--tblr-danger)' }} />;
      case 'Submitted': return <IconClock className="w-4 h-4" style={{ color: 'var(--tblr-primary)' }} />;
      default: return <IconFileText className="w-4 h-4" style={{ color: 'var(--tblr-muted)' }} />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('tenders')}</h2>
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('tenders_subtitle')}</p>
        </div>
        {activeTab === 'list' && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleOpenCreateModal}
          className="flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors shadow-sm"
          style={{ background: 'var(--tblr-primary)', color: '#fff' }}
        >
          <IconPlus size={18} />
          {t('create_bid')}
        </motion.button>
        )}
      </div>

      <div className="flex items-center gap-2 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
        <button
          onClick={() => setActiveTab('list')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors"
          style={{
            borderColor: activeTab === 'list' ? 'var(--tblr-primary)' : 'transparent',
            color: activeTab === 'list' ? 'var(--tblr-primary)' : 'var(--tblr-muted)'
          }}
        >
          <IconList size={16} />
          {t('tenders')}
        </button>
        <button
          onClick={() => setActiveTab('watch')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors"
          style={{
            borderColor: activeTab === 'watch' ? 'var(--tblr-primary)' : 'transparent',
            color: activeTab === 'watch' ? 'var(--tblr-primary)' : 'var(--tblr-muted)'
          }}
        >
          <IconRss size={16} />
          {t('tender_rss_tab_label')}
        </button>
      </div>

      {activeTab === 'watch' && <TenderRssWatch />}

      {activeTab === 'list' && (
      <>
      <div
        className="flex flex-col md:flex-row gap-4 items-center justify-between p-4 rounded-lg shadow-sm"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
          <div className="flex items-center gap-2">
            <IconFilter size={18} style={{ color: 'var(--tblr-muted)' }} />
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              <option value="All">{t('tenders_all_statuses')}</option>
              <option value="Draft">Draft</option>
              <option value="Submitted">Submitted</option>
              <option value="Won">Won</option>
              <option value="Lost">Lost</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              <option value="All">{t('tenders_all_types')}</option>
              <option value="Concours">Concours</option>
              <option value="MAPA">MAPA</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => setSortByDeadline(prev => prev === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          >
            {sortByDeadline === 'asc' ? <IconSortAscending size={18} /> : <IconSortDescending size={18} />}
            {t('tenders_sort_by_deadline')}
          </button>
          <button
            onClick={handleExportXLSX}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          >
            <IconDownload size={18} />
            Export XLSX
          </button>
        </div>
      </div>

      <div
        className="rounded-lg overflow-hidden"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        {/* Mobile accordion */}
        <div className="md:hidden">
          <MobileAccordionTable
            data={activeTenders}
            keyField="id"
            emptyText={t('tenders_no_active')}
            columns={[
              { label: t('description'), primary: true, render: t => (
                <div>
                  <p className="font-medium text-sm">{t.title}</p>
                  <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{t.mandataire_name || '---'}</p>
                </div>
              )},
              { label: t('client'), render: td => td.client_name || '---' },
              { label: 'Type', render: td => td.type || '---' },
              { label: t('deadline'), render: td => td.deadline ? new Date(td.deadline).toLocaleDateString('fr-FR') : '---' },
              { label: t('valuation'), render: td => td.valuation ? `${td.valuation.toLocaleString('fr-FR')} €` : '---' },
              { label: t('status'), render: td => (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{
                  background: td.status === 'Won' ? 'rgba(47,179,135,0.1)' : td.status === 'Lost' ? 'rgba(214,57,57,0.1)' : 'var(--tblr-primary-lt)',
                  color: td.status === 'Won' ? 'var(--tblr-success)' : td.status === 'Lost' ? 'var(--tblr-danger)' : 'var(--tblr-primary)',
                  border: '1px solid currentColor',
                }}>{td.status}</span>
              )},
            ]}
            actions={td => (
              <div className="flex gap-2">
                <Link to={`/tenders/${td.id}`} className="p-1.5 rounded-lg" style={{ color: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)' }}><IconEye size={15} /></Link>
                <button onClick={() => handleEditClick(td)} className="p-1.5 rounded-lg" style={{ color: 'var(--tblr-muted)', background: 'var(--tblr-surface-2)' }}><IconEdit size={15} /></button>
              </div>
            )}
          />
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('description')}</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('client')}</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>Type</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('tenders_col_specialties')}</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('deadline')}</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('valuation')}</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('status')}</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs text-right" style={{ color: 'var(--tblr-muted)' }}>{t('actions')}</th>
              </tr>
            </thead>
            <tbody style={{ borderTop: '1px solid var(--tblr-border)' }}>
              {activeTenders.map((tender) => (
                <tr
                  key={tender.id}
                  className="transition-colors"
                  style={{ borderBottom: '1px solid var(--tblr-border)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <Link
                        to={`/tenders/${tender.id}`}
                        className="font-medium hover:underline transition-colors"
                        style={{ color: 'var(--tblr-text)' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-primary)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                      >
                        {tender.title}
                      </Link>
                      <span className="text-[10px] uppercase tracking-tight" style={{ color: 'var(--tblr-muted)' }}>{tender.mandataire_name || 'No representative'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4" style={{ color: 'var(--tblr-text)' }}>{tender.client}</td>
                  <td className="px-6 py-4">
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
                      style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
                    >
                      {tender.type || 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {tender.specialties_list && tender.specialties_list.length > 0 ? (
                        tender.specialties_list.map((spec, i) => (
                          <div
                            key={i}
                            className="flex flex-col rounded px-1.5 py-0.5"
                            style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}
                          >
                            <span className="text-[9px] font-bold uppercase leading-tight" style={{ color: 'var(--tblr-muted)' }}>{spec.specialty_name}</span>
                            <span className="text-[10px] leading-tight" style={{ color: 'var(--tblr-text)' }}>{spec.contact_name || 'TBD'}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>{t('tenders_no_specialties')}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4" style={{ color: 'var(--tblr-text)' }}>
                    <div className="flex flex-col">
                      <span>{tender.submission_deadline ? new Date(tender.submission_deadline).toLocaleDateString() : '---'}</span>
                      {tender.withdrawal_deadline && (
                        <span className="text-[10px]" style={{ color: 'var(--tblr-danger)' }}>{t('tenders_withdrawal_label')} {new Date(tender.withdrawal_deadline).toLocaleDateString()}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono" style={{ color: 'var(--tblr-text)' }}>{formatCurrency(tender.value)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(tender.status)}
                      <span className="font-medium" style={{ color: 'var(--tblr-text)' }}>{tender.status}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        to={`/tenders/${tender.id}`}
                        className="p-2 rounded-lg transition-colors"
                        style={{ color: 'var(--tblr-muted)' }}
                        title="View Details"
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-primary)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
                      >
                        <IconEye size={18} />
                      </Link>
                      <button
                        onClick={() => handleEditClick(tender)}
                        className="p-2 rounded-lg transition-colors"
                        style={{ color: 'var(--tblr-muted)' }}
                        title="Edit"
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
                      >
                        <IconEdit size={18} />
                      </button>
                      <button
                        onClick={() => handleArchive(tender)}
                        className="p-2 rounded-lg transition-colors"
                        style={{ color: 'var(--tblr-muted)' }}
                        title="Archive"
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
                      >
                        <IconArchive size={18} />
                      </button>
                      <button
                        className="p-2 rounded-lg transition-colors"
                        style={{ color: 'var(--tblr-muted)' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
                      >
                        <IconDownload size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {activeTenders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center" style={{ color: 'var(--tblr-muted)' }}>
                    <div className="flex flex-col items-center gap-2">
                      <IconFileText size={32} className="opacity-20" />
                      <p>{t('tenders_no_active')}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {archivedTenders.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2" style={{ color: 'var(--tblr-muted)' }}>
            <IconArchive size={20} />
            <h3 className="text-lg font-bold">{t('tenders_archived_title')}</h3>
          </div>
          <div
            className="rounded-lg overflow-hidden shadow-sm opacity-75"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                    <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('description')}</th>
                    <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('client')}</th>
                    <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>Type</th>
                    <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('deadline')}</th>
                    <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('status')}</th>
                    <th className="px-6 py-3 font-medium uppercase tracking-wider text-xs text-right" style={{ color: 'var(--tblr-muted)' }}>{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedTenders.map((tender) => (
                    <tr
                      key={tender.id}
                      className="transition-colors"
                      style={{ borderBottom: '1px solid var(--tblr-border)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <Link
                            to={`/tenders/${tender.id}`}
                            className="font-medium hover:underline transition-colors"
                            style={{ color: 'var(--tblr-text)' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-primary)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                          >
                            {tender.title}
                          </Link>
                          <span className="text-[10px] uppercase tracking-tight" style={{ color: 'var(--tblr-muted)' }}>{tender.mandataire_name || t('tenders_no_representative')}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4" style={{ color: 'var(--tblr-text)' }}>{tender.client}</td>
                      <td className="px-6 py-4">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
                          style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
                        >
                          {tender.type || 'N/A'}
                        </span>
                      </td>
                      <td className="px-6 py-4" style={{ color: 'var(--tblr-text)' }}>
                        {tender.submission_deadline ? new Date(tender.submission_deadline).toLocaleDateString() : '---'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(tender.status)}
                          <span className="font-medium" style={{ color: 'var(--tblr-text)' }}>{tender.status}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleArchive(tender)}
                            className="p-2 rounded-lg transition-colors"
                            style={{ color: 'var(--tblr-muted)' }}
                            title="Unarchive"
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-text)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
                          >
                            <IconPlus size={18} className="rotate-45" />
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm(t('tenders_confirm_delete'))) return;
                              try {
                                const res = await fetch(`/api/tenders/${tender.id}`, { method: 'DELETE' });
                                if (res.ok) setTenders(tenders.filter(t => t.id !== tender.id));
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                            className="p-2 rounded-lg transition-colors"
                            style={{ color: 'var(--tblr-muted)' }}
                            title="Delete"
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-danger)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
                          >
                            <IconTrash size={18} />
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
      )}

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-lg shadow-xl w-full max-w-xl overflow-hidden"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
            >
              <div
                className="p-6 flex items-center justify-between"
                style={{ borderBottom: '1px solid var(--tblr-border)' }}
              >
                <h3 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>
                  {editingTender ? t('tenders_edit_title') : t('tenders_create_title')}
                </h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  style={{ color: 'var(--tblr-muted)' }}
                >
                  <IconX size={20} />
                </button>
              </div>
              <form onSubmit={handleCreateBid} className="p-6 pb-64 space-y-4 max-h-[85vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tenders_project_title_label')}</label>
                    <input
                      required
                      placeholder="Réhabilitation du bâtiment URSSAF de Lorraine - S..."
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      value={newTender.title || ''}
                      onChange={e => setNewTender({...newTender, title: e.target.value})}
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{t('tenders_awarding_entity_label')}</label>
                    </div>
                    <ContactAutocomplete
                      contacts={contacts.filter(c => c.category === 'Client' || c.category === 'Maitre d\'ouvrage')}
                      value={contacts.find(c => (c.company_name || `${c.first_name} ${c.last_name}`) === newTender.client)?.id || ''}
                      onChange={id => {
                        const contact = contacts.find(c => c.id === id);
                        if (contact) {
                          setNewTender({...newTender, client: contact.company_name || `${contact.first_name} ${contact.last_name}`});
                        }
                      }}
                      onAddNew={() => setIsContactModalOpen(true)}
                      addNewLabel="Add New Client"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tenders_representative_label')}</label>
                    <select
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      value={newTender.mandataire_id || ''}
                      onChange={e => setNewTender({...newTender, mandataire_id: e.target.value})}
                    >
                      <option value="">{t('tenders_select_contact')}</option>
                      {contacts.map(c => (
                        <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>Type</label>
                    <select
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      value={newTender.type || ''}
                      onChange={e => setNewTender({...newTender, type: e.target.value})}
                    >
                      <option value="Concours">Concours</option>
                      <option value="MAPA">MAPA</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tenders_surface_m2_label')}</label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      value={newTender.surface || 0}
                      onChange={e => setNewTender({...newTender, surface: Number(e.target.value)})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tenders_construction_cost_label')}</label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      value={newTender.construction_cost || 0}
                      onChange={e => setNewTender({...newTender, construction_cost: Number(e.target.value)})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tenders_fee_pct_label')}</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      value={newTender.honoraires_percent || 0}
                      onChange={e => setNewTender({...newTender, honoraires_percent: Number(e.target.value)})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tenders_submission_deadline_label')}</label>
                    <input
                      required
                      type="date"
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      value={newTender.submission_deadline || ''}
                      onChange={e => setNewTender({...newTender, submission_deadline: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tenders_withdrawal_deadline_label')}</label>
                    <input
                      type="date"
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
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
                        <div className="w-10 h-5 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"
                          style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)' }}
                        ></div>
                      </div>
                      <span className="text-sm font-medium transition-colors" style={{ color: 'var(--tblr-text)' }}>
                        {t('tenders_mandatory_visit_label')}
                      </span>
                    </label>
                  </div>

                  {newTender.mandatory_visit && (
                    <div className="col-span-2 pt-4" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-text)' }}>{t('tenders_dates_milestones_label')}</label>
                        <button
                          type="button"
                          onClick={addMilestoneRow}
                          className="text-[10px] flex items-center gap-1 font-bold uppercase"
                          style={{ color: 'var(--tblr-primary)' }}
                        >
                          <IconPlus size={12} /> {t('tenders_add_date')}
                        </button>
                      </div>

                      <div className="space-y-2 mb-4">
                        {formMilestones.map((m, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              placeholder={t('tenders_milestone_title_placeholder')}
                              className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                              value={m.title}
                              onChange={e => updateMilestone(idx, 'title', e.target.value)}
                            />
                            <input
                              type="datetime-local"
                              className="w-44 px-3 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                              value={m.due_date}
                              onChange={e => updateMilestone(idx, 'due_date', e.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => removeMilestoneRow(idx)}
                              className="p-1.5 transition-colors"
                              style={{ color: 'var(--tblr-muted)' }}
                              onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-danger)')}
                              onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
                            >
                              <IconTrash size={16} />
                            </button>
                          </div>
                        ))}
                        {formMilestones.length === 0 && (
                          <p className="text-[10px] italic" style={{ color: 'var(--tblr-muted)' }}>{t('tenders_no_milestones')}</p>
                        )}
                      </div>

                      {editingTender && milestones.filter(m => m.tender_id === editingTender.id).length > 0 && (
                        <div className="space-y-4 mb-4">
                          <h3 className="text-sm font-bold" style={{ color: 'var(--tblr-primary)' }}>{t('tenders_timeline_preview')}</h3>
                          <MilestoneGantt
                            milestones={milestones.filter(m => m.tender_id === editingTender.id)}
                            startDate={new Date(editingTender.submission_deadline)}
                            endDate={new Date()}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="col-span-2 pt-4" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-text)' }}>{t('tenders_required_specialties_label')}</label>
                      <button
                        type="button"
                        onClick={addSpecialtyRow}
                        className="text-[10px] flex items-center gap-1 font-bold uppercase"
                        style={{ color: 'var(--tblr-primary)' }}
                      >
                        <IconPlus size={12} /> {t('tenders_add_specialty_btn')}
                      </button>
                    </div>

                    <div className="space-y-2">
                      {formSpecialties.map((spec, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            placeholder={t('tenders_specialty_placeholder')}
                            className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                            value={spec.specialty_name}
                            onChange={e => updateSpecialty(idx, 'specialty_name', e.target.value)}
                          />
                          <ContactAutocomplete
                            className="flex-1"
                            contacts={contacts}
                            value={spec.contact_id || ''}
                            onChange={val => updateSpecialty(idx, 'contact_id', val)}
                            onAddNew={() => setIsContactModalOpen(true)}
                          />
                          <button
                            type="button"
                            onClick={() => removeSpecialtyRow(idx)}
                            className="p-1.5 transition-colors"
                            style={{ color: 'var(--tblr-muted)' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-danger)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
                          >
                            <IconTrash size={16} />
                          </button>
                        </div>
                      ))}
                      {formSpecialties.length === 0 && (
                        <p className="text-[10px] italic" style={{ color: 'var(--tblr-muted)' }}>{t('tenders_no_specialties_yet')}</p>
                      )}
                    </div>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tenders_valuation_label')}</label>
                    <input
                      required
                      type="number"
                      className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      value={newTender.value || 0}
                      onChange={e => setNewTender({...newTender, value: Number(e.target.value)})}
                    />
                  </div>
                  {editingTender && (
                    <div className="col-span-2">
                      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('tenders_status_label')}</label>
                      <select
                        className="w-full px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
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
                  className="w-full py-2 rounded-lg font-medium transition-all mt-4 flex items-center justify-center gap-2 disabled:opacity-80 disabled:cursor-not-allowed"
                  style={showSuccess
                    ? { background: 'var(--tblr-success)', color: '#fff' }
                    : { background: 'var(--tblr-primary)', color: '#fff' }
                  }
                >
                  {isSaving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {t('tenders_saving')}
                    </>
                  ) : showSuccess ? (
                    <>
                      <IconCircleCheck size={20} />
                      {t('tenders_saved_ok')}
                    </>
                  ) : (
                    editingTender ? t('tenders_update_btn') : t('tenders_create_btn')
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ContactModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
        onSuccess={() => {
          // Refetch contacts
          const loadContacts = async () => {
            try {
              const data = await fetchJson<Contact[]>('/api/contacts');
              setContacts(data);
            } catch (err) {
              console.error('Contacts fetch failed:', err);
            }
          };
          loadContacts();
        }}
      />
      </>
      )}
    </div>
  );
}
