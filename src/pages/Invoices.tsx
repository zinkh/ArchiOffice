import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { IconPlus, IconFileInvoice, IconCircleCheck, IconClock, IconX, IconTrash, IconDeviceFloppy, IconSearch, IconEdit, IconFileCode, IconChevronDown, IconChevronRight, IconArrowsSort, IconSortAscending, IconSortDescending, IconLayoutGrid, IconList, IconRefresh, IconSend, IconPercentage, IconInfoCircle } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import { fetchJson } from '../lib/api';
import type { Invoice, Project } from '../types';
import { useTranslation } from 'react-i18next';
import { InvoiceGenerator } from '../components/InvoiceGenerator';

const MISSIONS = [
  { id: 'esquisse', name: 'Esquisse (ESQ)', default_pct: 10 },
  { id: 'aps',      name: 'A.P.S.',         default_pct: 12 },
  { id: 'apd',      name: 'A.P.D.',         default_pct: 14 },
  { id: 'projet',   name: 'Projet (PRO)',   default_pct: 18 },
  { id: 'act',      name: 'A.C.T.',         default_pct: 7  },
  { id: 'visa',     name: 'VISA',           default_pct: 7  },
  { id: 'det',      name: 'D.E.T.',         default_pct: 25 },
  { id: 'aor',      name: 'A.O.R.',         default_pct: 7  },
  { id: 'opc',      name: 'OPC',            default_pct: 0  },
];

// Status badge style helper
function statusStyle(status: string): React.CSSProperties {
  switch (status) {
    case 'Paid':     return { background: '#d3f9d8', color: '#2f9e44', border: '1px solid #b2f2bb' };
    case 'Overdue':  return { background: '#ffe3e3', color: 'var(--tblr-danger)', border: '1px solid #ffc9c9' };
    case 'Sent':     return { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary-lt)' };
    case 'Draft':
    case 'Cancelled':
    default:         return { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', border: '1px solid var(--tblr-border)' };
  }
}

export default function Invoices() {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currency, setCurrency] = useState('EUR');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGroupedByProject, setIsGroupedByProject] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: keyof Invoice | 'project_name'; direction: 'asc' | 'desc' } | null>({ key: 'due_date', direction: 'desc' });
  const [zohoConnected, setZohoConnected] = useState(false);
  const [isSyncingZoho, setIsSyncingZoho] = useState(false);
  const [zohoSyncResult, setZohoSyncResult] = useState<{ pushed: number; pulled: number; errors: string[] } | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editForm, setEditForm] = useState<Partial<Invoice>>({});
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [sendingInvoice, setSendingInvoice] = useState<Invoice | null>(null);
  const [sendForm, setSendForm] = useState({ to: '', subject: '', message: '' });
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);
  const [newInvoice, setNewInvoice] = useState<Partial<Invoice>>({
    project_id: '',
    amount: 0,
    description: '',
    status: 'Draft',
    invoice_type: 'standard',
    due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        const [invoicesData, projectsData, settingsData] = await Promise.all([
          fetchJson<Invoice[]>('/api/invoices'),
          fetchJson<Project[]>('/api/projects'),
          fetchJson<any>('/api/settings')
        ]);
        const enrichedInvoices = invoicesData.map(inv => ({
          ...inv,
          project_name: projectsData.find(p => p.id === inv.project_id)?.name || inv.project_name
        }));
        setInvoices(enrichedInvoices);
        setProjects(projectsData);
        if (settingsData?.currency) setCurrency(settingsData.currency);
      } catch (err) {
        console.error('Invoices data fetch failed:', err);
      }
    };
    loadData();
    fetch('/api/zoho/status').then(r => r.json()).then(s => setZohoConnected(!!s.connected)).catch(() => {});
  }, []);

  const handleZohoSync = async () => {
    setIsSyncingZoho(true);
    setZohoSyncResult(null);
    try {
      const res = await fetch('/api/zoho/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync échouée');
      setZohoSyncResult(data);
      fetchInvoices();
    } catch (err: any) {
      setZohoSyncResult({ pushed: 0, pulled: 0, errors: [err.message] });
    } finally {
      setIsSyncingZoho(false);
    }
  };

  const fetchInvoices = async () => {
    try {
      const data = await fetchJson<Invoice[]>('/api/invoices');
      const enriched = data.map(inv => ({
        ...inv,
        project_name: projects.find(p => p.id === inv.project_id)?.name || inv.project_name
      }));
      setInvoices(enriched);
    } catch (err) {
      console.error('Invoices fetch failed:', err);
    }
  };

  const fetchProjects = async () => {
    try {
      const data = await fetchJson<Project[]>('/api/projects');
      setProjects(data);
    } catch (err) {
      console.error('Projects fetch failed:', err);
    }
  };

  const openEditModal = (invoice: Invoice) => {
    setEditingInvoice(invoice);
    setEditForm({ ...invoice });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInvoice) return;
    setIsSavingEdit(true);
    try {
      const updated = await fetchJson<Invoice>(`/api/invoices/${editingInvoice.id}`, {
        method: 'PUT',
        body: JSON.stringify(editForm)
      });
      const enriched = { ...updated, project_name: projects.find(p => p.id === updated.project_id)?.name || updated.project_name };
      setInvoices(invoices.map(i => i.id === enriched.id ? enriched : i));
      setEditingInvoice(null);
    } catch (err) {
      console.error('Edit invoice failed:', err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const openSendModal = (invoice: Invoice) => {
    const project = projects.find(p => p.id === invoice.project_id);
    const clientEmail = project?.client_email || project?.email_client || '';
    const subject = `${invoice.invoice_type === 'acompte' ? "Facture d'acompte" : 'Facture'} N° ${invoice.invoice_number} – ${invoice.project_name || project?.name || ''}`;
    const isAcompte = invoice.invoice_type === 'acompte';
    const missionLine = isAcompte && invoice.mission_name
      ? `Mission : ${invoice.mission_name} (${invoice.advancement_pct ?? 0}% d'avancement)\n`
      : '';
    const message = `Bonjour,\n\nVeuillez trouver ci-joint ${isAcompte ? "la facture d'acompte" : 'la facture'} N° ${invoice.invoice_number}.\n\n${missionLine}Montant HT : ${formatCurrency(invoice.amount, currency)}\nMontant TTC : ${formatCurrency(invoice.total_amount ?? invoice.amount, currency)}\nDate d'échéance : ${new Date(invoice.due_date).toLocaleDateString('fr-FR')}\n\nCordialement`;
    setSendingInvoice(invoice);
    setSendForm({ to: clientEmail, subject, message });
    setSendResult(null);
  };

  const handleSendInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendingInvoice) return;
    setIsSending(true);
    setSendResult(null);
    try {
      const html = `<p>${sendForm.message.replace(/\n/g, '<br/>')}</p>`;
      await fetchJson('/api/send-email', {
        method: 'POST',
        body: JSON.stringify({ to: sendForm.to, subject: sendForm.subject, text: sendForm.message, html })
      });
      if (sendingInvoice.status === 'Draft') {
        const updated = await fetchJson<Invoice>(`/api/invoices/${sendingInvoice.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...sendingInvoice, status: 'Sent' })
        });
        const enriched = { ...updated, project_name: projects.find(p => p.id === updated.project_id)?.name || updated.project_name };
        setInvoices(invoices.map(i => i.id === enriched.id ? enriched : i));
      }
      setSendResult({ success: true, message: t('invoices_send_success') });
    } catch (err: any) {
      setSendResult({ success: false, message: err.message || t('invoices_send_error') });
    } finally {
      setIsSending(false);
    }
  };

  // Computed: auto-calculate acompte amount from mission + advancement
  const acompteCalculated = useMemo(() => {
    if (editForm.invoice_type !== 'acompte' || !editForm.mission_id || !editForm.project_id) return null;
    const project = projects.find(p => p.id === editForm.project_id);
    const remuneration = project?.remuneration || 0;
    if (!remuneration) return null;
    const mission = MISSIONS.find(m => m.id === editForm.mission_id);
    if (!mission || !mission.default_pct) return null;
    const advancement = editForm.advancement_pct ?? 0;
    return (remuneration * mission.default_pct / 100) * (advancement / 100);
  }, [editForm.invoice_type, editForm.mission_id, editForm.project_id, editForm.advancement_pct, projects]);

  // Same for create modal
  const newAcompteCalculated = useMemo(() => {
    if (newInvoice.invoice_type !== 'acompte' || !newInvoice.mission_id || !newInvoice.project_id) return null;
    const project = projects.find(p => p.id === newInvoice.project_id);
    const remuneration = project?.remuneration || 0;
    if (!remuneration) return null;
    const mission = MISSIONS.find(m => m.id === newInvoice.mission_id);
    if (!mission || !mission.default_pct) return null;
    const advancement = newInvoice.advancement_pct ?? 0;
    return (remuneration * mission.default_pct / 100) * (advancement / 100);
  }, [newInvoice.invoice_type, newInvoice.mission_id, newInvoice.project_id, newInvoice.advancement_pct, projects]);

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { ...newInvoice };
      if (newAcompteCalculated !== null) payload.amount = newAcompteCalculated;
      if (payload.invoice_type === 'acompte' && payload.mission_name && !payload.description) {
        payload.description = `Acompte – ${payload.mission_name} – ${payload.advancement_pct ?? 0}% d'avancement`;
      }
      const saved = await fetchJson<Invoice>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const enrichedSaved = {
        ...saved,
        project_name: projects.find(p => p.id === saved.project_id)?.name || saved.project_name
      };
      setInvoices([enrichedSaved, ...invoices]);
      setIsModalOpen(false);
      setNewInvoice({
        project_id: '',
        amount: 0,
        description: '',
        status: 'Draft',
        invoice_type: 'standard',
        due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      });
    } catch (err) {
      console.error('Create invoice failed:', err);
    }
  };

  const handleUpdateStatus = async (invoice: Invoice, newStatus: Invoice['status']) => {
    try {
      const updated = await fetchJson<Invoice>(`/api/invoices/${invoice.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...invoice, status: newStatus })
      });
      const enrichedUpdated = {
        ...updated,
        project_name: projects.find(p => p.id === updated.project_id)?.name || updated.project_name
      };
      setInvoices(invoices.map(i => i.id === enrichedUpdated.id ? enrichedUpdated : i));
    } catch (err) {
      console.error('Update invoice status failed:', err);
    }
  };

  const handleOpenGenerator = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsGeneratorOpen(true);
  };

  const toggleProjectExpansion = (projectId: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId);
    } else {
      newExpanded.add(projectId);
    }
    setExpandedProjects(newExpanded);
  };

  const handleSort = (key: keyof Invoice | 'project_name') => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortedInvoices = (list: Invoice[]) => {
    if (!sortConfig) return list;

    return [...list].sort((a, b) => {
      const aValue = a[sortConfig.key as keyof Invoice] ?? '';
      const bValue = b[sortConfig.key as keyof Invoice] ?? '';

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const filteredInvoices = invoices.filter(i =>
    i.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.project_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.invoice_number.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedInvoices = getSortedInvoices(filteredInvoices);

  const groupedInvoices = sortedInvoices.reduce((acc, invoice) => {
    const projectId = invoice.project_id || 'general';
    if (!acc[projectId]) {
      acc[projectId] = {
        name: invoice.project_name || 'General / Internal',
        invoices: []
      };
    }
    acc[projectId].invoices.push(invoice);
    return acc;
  }, {} as Record<string, { name: string; invoices: Invoice[] }>);

  const SortIcon = ({ column }: { column: keyof Invoice | 'project_name' }) => {
    if (sortConfig?.key !== column) return <IconArrowsSort size={14} className="opacity-20 group-hover:opacity-50 transition-opacity" />;
    return sortConfig.direction === 'asc'
      ? <IconSortAscending size={14} style={{ color: 'var(--tblr-primary)' }} />
      : <IconSortDescending size={14} style={{ color: 'var(--tblr-primary)' }} />;
  };

  // Shared input style
  const inputStyle: React.CSSProperties = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--tblr-text)' }}>{t('invoices')}</h1>
          <p style={{ color: 'var(--tblr-muted)' }}>{t('invoices_subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {zohoConnected && (
            <button
              onClick={handleZohoSync}
              disabled={isSyncingZoho}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold transition-all active:scale-95 disabled:opacity-60"
              style={{ background: '#f76707', color: '#fff' }}
            >
              <IconRefresh size={18} className={isSyncingZoho ? 'animate-spin' : ''} />
              {t('zoho_sync_btn')}
            </button>
          )}
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold transition-all active:scale-95"
            style={{ background: 'var(--tblr-primary)', color: '#fff' }}
          >
            <IconPlus size={20} />
            {t('invoices_create_btn')}
          </button>
        </div>
      </div>

      {zohoSyncResult && (
        <div
          className="text-sm p-3 rounded-lg flex items-center justify-between gap-4"
          style={zohoSyncResult.errors.length > 0
            ? { background: '#fff3bf', color: '#e67700', border: '1px solid #ffe066' }
            : { background: '#d3f9d8', color: '#2f9e44', border: '1px solid #b2f2bb' }}
        >
          <span>
            {t('zoho_sync_result', { pushed: zohoSyncResult.pushed, pulled: zohoSyncResult.pulled })}
            {zohoSyncResult.errors.length > 0 && (
              <span className="ml-2">· {zohoSyncResult.errors.join(', ')}</span>
            )}
          </span>
          <button onClick={() => setZohoSyncResult(null)} className="shrink-0 opacity-60 hover:opacity-100">
            <IconX size={16} />
          </button>
        </div>
      )}

      <div className="flex flex-col md:flex-row items-center gap-4 p-4 rounded-lg shadow-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="relative flex-1 w-full">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2" size={18} style={{ color: 'var(--tblr-muted)' }} />
          <input
            type="text"
            placeholder={t('invoices_search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
            style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
        </div>
        <div className="flex items-center gap-2 p-1 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
          <button
            onClick={() => setIsGroupedByProject(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all"
            style={isGroupedByProject
              ? { background: 'var(--tblr-surface)', color: 'var(--tblr-primary)', boxShadow: 'var(--tblr-shadow)' }
              : { color: 'var(--tblr-muted)' }}
          >
            <IconLayoutGrid size={16} />
            {t('invoices_group_by_project')}
          </button>
          <button
            onClick={() => setIsGroupedByProject(false)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all"
            style={!isGroupedByProject
              ? { background: 'var(--tblr-surface)', color: 'var(--tblr-primary)', boxShadow: 'var(--tblr-shadow)' }
              : { color: 'var(--tblr-muted)' }}
          >
            <IconList size={16} />
            {t('invoices_list_view')}
          </button>
        </div>
      </div>

      <div className="rounded-lg overflow-hidden shadow-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                <th
                  className="px-6 py-4 text-xs font-bold uppercase tracking-wider cursor-pointer group"
                  style={{ color: 'var(--tblr-muted)' }}
                  onClick={() => handleSort('project_name')}
                >
                  <div className="flex items-center gap-2">
                    {t('invoices_col_invoice_project')}
                    <SortIcon column="project_name" />
                  </div>
                </th>
                <th
                  className="px-6 py-4 text-xs font-bold uppercase tracking-wider cursor-pointer group"
                  style={{ color: 'var(--tblr-muted)' }}
                  onClick={() => handleSort('amount')}
                >
                  <div className="flex items-center gap-2">
                    {t('invoices_col_amount')}
                    <SortIcon column="amount" />
                  </div>
                </th>
                <th
                  className="px-6 py-4 text-xs font-bold uppercase tracking-wider cursor-pointer group"
                  style={{ color: 'var(--tblr-muted)' }}
                  onClick={() => handleSort('due_date')}
                >
                  <div className="flex items-center gap-2">
                    {t('invoices_col_due_date')}
                    <SortIcon column="due_date" />
                  </div>
                </th>
                <th
                  className="px-6 py-4 text-xs font-bold uppercase tracking-wider cursor-pointer group"
                  style={{ color: 'var(--tblr-muted)' }}
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center gap-2">
                    {t('invoices_col_status')}
                    <SortIcon column="status" />
                  </div>
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-right" style={{ color: 'var(--tblr-muted)' }}>{t('invoices_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isGroupedByProject ? (
                Object.entries(groupedInvoices).map(([projectId, group]) => (
                  <React.Fragment key={projectId}>
                    <tr
                      className="cursor-pointer transition-colors group/header"
                      style={{ background: 'var(--tblr-surface-2)', borderTop: '1px solid var(--tblr-border)', borderBottom: '1px solid var(--tblr-border)' }}
                      onClick={() => toggleProjectExpansion(projectId)}
                    >
                      <td colSpan={5} className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className="p-1 rounded shadow-sm" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                            {expandedProjects.has(projectId)
                              ? <IconChevronDown size={16} style={{ color: 'var(--tblr-primary)' }} />
                              : <IconChevronRight size={16} style={{ color: 'var(--tblr-muted)' }} />}
                          </div>
                          <span className="font-bold text-sm transition-colors" style={{ color: 'var(--tblr-text)' }}>{group.name}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
                            {group.invoices.length > 1 ? t('invoices_count_invoices_plural', { count: group.invoices.length }) : t('invoices_count_invoices', { count: group.invoices.length })}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {expandedProjects.has(projectId) && group.invoices.map((invoice) => (
                      <tr key={invoice.id} className="transition-colors" style={{ borderTop: '1px solid var(--tblr-border)', borderLeft: '4px solid var(--tblr-primary)' }}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3 pl-4">
                            <div
                              className="p-2 rounded-lg"
                              style={invoice.invoice_type === 'acompte'
                                ? { background: '#fff3bf', color: '#e67700' }
                                : { background: '#d3f9d8', color: '#2f9e44' }}
                            >
                              <IconFileInvoice size={20} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-sm" style={{ color: 'var(--tblr-text)' }}>{invoice.invoice_number}</p>
                                {invoice.invoice_type === 'acompte' && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider" style={{ background: '#fff3bf', color: '#e67700' }}>{t('invoices_badge_acompte')}</span>
                                )}
                              </div>
                              <p className="text-xs truncate max-w-[200px]" style={{ color: 'var(--tblr-muted)' }}>{invoice.description}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono font-bold text-sm" style={{ color: 'var(--tblr-text)' }}>
                          {formatCurrency(invoice.amount, currency)}
                        </td>
                        <td className="px-6 py-4 text-sm" style={{ color: 'var(--tblr-text)' }}>
                          <div className="flex items-center gap-1.5">
                            <IconClock size={14} style={{ color: 'var(--tblr-muted)' }} />
                            {new Date(invoice.due_date).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider" style={statusStyle(invoice.status)}>
                            {invoice.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEditModal(invoice)}
                              className="p-1.5 rounded-lg transition-colors"
                              style={{ color: 'var(--tblr-muted)' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--tblr-text)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--tblr-surface-2)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--tblr-muted)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                              title={t('invoices_edit_btn')}
                            >
                              <IconEdit size={18} />
                            </button>
                            <button
                              onClick={() => handleOpenGenerator(invoice)}
                              className="p-1.5 rounded-lg transition-colors"
                              style={{ color: 'var(--tblr-primary)' }}
                              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--tblr-primary-lt)'}
                              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                              title="Generate Factur-X"
                            >
                              <IconFileCode size={18} />
                            </button>
                            {invoice.status !== 'Paid' && (
                              <button
                                onClick={() => openSendModal(invoice)}
                                className="p-1.5 rounded-lg transition-colors"
                                style={{ color: 'var(--tblr-primary)' }}
                                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--tblr-primary-lt)'}
                                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                                title={t('invoices_send_btn')}
                              >
                                <IconSend size={18} />
                              </button>
                            )}
                            {invoice.status !== 'Paid' && (
                              <button
                                onClick={() => handleUpdateStatus(invoice, 'Paid')}
                                className="p-1.5 rounded-lg transition-colors"
                                style={{ color: '#2f9e44' }}
                                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#d3f9d8'}
                                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                                title="Mark as Paid"
                              >
                                <IconCircleCheck size={18} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))
              ) : (
                sortedInvoices.map((invoice) => (
                  <tr key={invoice.id} className="transition-colors" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="p-2 rounded-lg"
                          style={invoice.invoice_type === 'acompte'
                            ? { background: '#fff3bf', color: '#e67700' }
                            : { background: '#d3f9d8', color: '#2f9e44' }}
                        >
                          <IconFileInvoice size={20} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-sm" style={{ color: 'var(--tblr-text)' }}>{invoice.invoice_number}</p>
                            {invoice.invoice_type === 'acompte' && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider" style={{ background: '#fff3bf', color: '#e67700' }}>{t('invoices_badge_acompte')}</span>
                            )}
                            <span className="text-[10px] font-mono" style={{ color: 'var(--tblr-muted)' }}>/</span>
                            <p className="text-xs font-medium" style={{ color: 'var(--tblr-primary)' }}>{invoice.project_name || 'General'}</p>
                          </div>
                          <p className="text-xs truncate max-w-[200px]" style={{ color: 'var(--tblr-muted)' }}>{invoice.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono font-bold text-sm" style={{ color: 'var(--tblr-text)' }}>
                      {formatCurrency(invoice.amount, currency)}
                    </td>
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--tblr-text)' }}>
                      <div className="flex items-center gap-1.5">
                        <IconClock size={14} style={{ color: 'var(--tblr-muted)' }} />
                        {new Date(invoice.due_date).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider" style={statusStyle(invoice.status)}>
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditModal(invoice)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: 'var(--tblr-muted)' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--tblr-text)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--tblr-surface-2)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--tblr-muted)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                          title={t('invoices_edit_btn')}
                        >
                          <IconEdit size={18} />
                        </button>
                        <button
                          onClick={() => handleOpenGenerator(invoice)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: 'var(--tblr-primary)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--tblr-primary-lt)'}
                          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                          title="Generate Factur-X"
                        >
                          <IconFileCode size={18} />
                        </button>
                        {invoice.status !== 'Paid' && (
                          <button
                            onClick={() => openSendModal(invoice)}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--tblr-primary)' }}
                            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--tblr-primary-lt)'}
                            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                            title={t('invoices_send_btn')}
                          >
                            <IconSend size={18} />
                          </button>
                        )}
                        {invoice.status !== 'Paid' && (
                          <button
                            onClick={() => handleUpdateStatus(invoice, 'Paid')}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: '#2f9e44' }}
                            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#d3f9d8'}
                            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                            title="Mark as Paid"
                          >
                            <IconCircleCheck size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
              {sortedInvoices.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center" style={{ color: 'var(--tblr-muted)' }}>
                    {t('invoices_no_invoices')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isGeneratorOpen && selectedInvoice && (
          <InvoiceGenerator
            onClose={() => setIsGeneratorOpen(false)}
            onSave={(updated) => {
              setInvoices(invoices.map(i => i.id === updated.id ? updated : i));
              setIsGeneratorOpen(false);
            }}
            initialData={selectedInvoice}
            project={projects.find(p => p.id === selectedInvoice.project_id)}
          />
        )}

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-lg shadow-xl w-full max-w-lg overflow-hidden flex flex-col"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
            >
              <div className="p-6 flex items-center justify-between" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                <h2 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('invoices_new_title')}</h2>
                <button onClick={() => setIsModalOpen(false)} style={{ color: 'var(--tblr-muted)' }}>
                  <IconX size={24} />
                </button>
              </div>
              <form onSubmit={handleCreateInvoice} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_project_label')}</label>
                  <select
                    required
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                    style={inputStyle}
                    value={newInvoice.project_id}
                    onChange={e => setNewInvoice({...newInvoice, project_id: e.target.value})}
                  >
                    <option value="">{t('invoices_select_project')}</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--tblr-text)' }}>{t('invoices_type_label')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewInvoice({...newInvoice, invoice_type: 'standard'})}
                      className="flex flex-col items-center gap-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all"
                      style={newInvoice.invoice_type === 'standard' || !newInvoice.invoice_type
                        ? { borderColor: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }
                        : { borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
                    >
                      <IconFileInvoice size={20} />
                      {t('invoices_type_standard')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewInvoice({...newInvoice, invoice_type: 'acompte'})}
                      className="flex flex-col items-center gap-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all"
                      style={newInvoice.invoice_type === 'acompte'
                        ? { borderColor: '#e67700', background: '#fff3bf', color: '#e67700' }
                        : { borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
                    >
                      <IconFileInvoice size={20} />
                      {t('invoices_type_acompte')}
                    </button>
                  </div>
                </div>
                {newInvoice.invoice_type === 'acompte' && (
                  <div className="space-y-3 p-4 rounded-lg" style={{ background: '#fff3bf', border: '1px solid #ffe066' }}>
                    <div>
                      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_mission_label')}</label>
                      <select
                        className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                        style={inputStyle}
                        value={newInvoice.mission_id || ''}
                        onChange={e => {
                          const m = MISSIONS.find(m => m.id === e.target.value);
                          setNewInvoice({ ...newInvoice, mission_id: e.target.value, mission_name: m?.name || '' });
                        }}
                      >
                        <option value="">{t('invoices_mission_placeholder')}</option>
                        {MISSIONS.map(m => (
                          <option key={m.id} value={m.id}>{m.name} {m.default_pct ? `(${m.default_pct}%)` : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_advancement_label')}</label>
                      <input
                        type="number" min={0} max={100} step={5}
                        className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                        style={inputStyle}
                        value={newInvoice.advancement_pct ?? ''}
                        onChange={e => setNewInvoice({ ...newInvoice, advancement_pct: Number(e.target.value) })}
                        placeholder="Ex : 30"
                      />
                    </div>
                    {newAcompteCalculated !== null && (
                      <div className="flex items-center gap-2 text-sm">
                        <IconInfoCircle size={16} style={{ color: '#e67700' }} className="shrink-0" />
                        <span style={{ color: '#7d4e00' }}>
                          {t('invoices_calculated_amount')} : <strong>{formatCurrency(newAcompteCalculated, currency)}</strong>
                        </span>
                      </div>
                    )}
                    {newInvoice.project_id && !projects.find(p => p.id === newInvoice.project_id)?.remuneration && (
                      <p className="text-xs" style={{ color: '#e67700' }}>{t('invoices_no_remuneration')}</p>
                    )}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_amount_label')}</label>
                  <input
                    type="number"
                    required={newInvoice.invoice_type !== 'acompte' || newAcompteCalculated === null}
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                    style={inputStyle}
                    value={newAcompteCalculated !== null ? newAcompteCalculated.toFixed(2) : (newInvoice.amount ?? '')}
                    readOnly={newAcompteCalculated !== null}
                    onChange={e => newAcompteCalculated === null && setNewInvoice({...newInvoice, amount: Number(e.target.value)})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_due_date_label')}</label>
                  <input
                    type="date"
                    required
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                    style={inputStyle}
                    value={newInvoice.due_date}
                    onChange={e => setNewInvoice({...newInvoice, due_date: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_description_label')}</label>
                  <textarea
                    className="w-full h-32 px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                    style={inputStyle}
                    value={newInvoice.description ?? ''}
                    onChange={e => setNewInvoice({...newInvoice, description: e.target.value})}
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors"
                    style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
                  >
                    {t('btn_cancel')}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors"
                    style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                  >
                    {t('invoices_create_btn')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Edit Invoice Modal */}
        {editingInvoice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-lg shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
            >
              <div className="p-6 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                <h2 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('invoices_edit_title')}</h2>
                <button onClick={() => setEditingInvoice(null)} style={{ color: 'var(--tblr-muted)' }}><IconX size={24} /></button>
              </div>
              <form onSubmit={handleSaveEdit} className="p-6 space-y-4 overflow-y-auto">
                {/* Invoice type toggle */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--tblr-text)' }}>{t('invoices_type_label')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['standard', 'acompte'] as const).map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setEditForm({ ...editForm, invoice_type: type })}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all"
                        style={editForm.invoice_type === type
                          ? type === 'acompte'
                            ? { borderColor: '#e67700', background: '#fff3bf', color: '#e67700' }
                            : { borderColor: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }
                          : { borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
                      >
                        <IconFileInvoice size={16} />
                        {t(`invoices_type_${type}`)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Acompte mission fields */}
                {editForm.invoice_type === 'acompte' && (
                  <div className="space-y-3 p-4 rounded-lg" style={{ background: '#fff3bf', border: '1px solid #ffe066' }}>
                    <div>
                      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_mission_label')}</label>
                      <select
                        className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                        style={inputStyle}
                        value={editForm.mission_id || ''}
                        onChange={e => {
                          const m = MISSIONS.find(m => m.id === e.target.value);
                          setEditForm({ ...editForm, mission_id: e.target.value, mission_name: m?.name || '' });
                        }}
                      >
                        <option value="">{t('invoices_mission_placeholder')}</option>
                        {MISSIONS.map(m => (
                          <option key={m.id} value={m.id}>{m.name} {m.default_pct ? `(${m.default_pct}%)` : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_advancement_label')}</label>
                      <div className="relative">
                        <input
                          type="number" min={0} max={100} step={5}
                          className="w-full px-4 py-2 pr-10 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                          style={inputStyle}
                          value={editForm.advancement_pct ?? ''}
                          onChange={e => setEditForm({ ...editForm, advancement_pct: Number(e.target.value) })}
                          placeholder="Ex : 30"
                        />
                        <IconPercentage size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--tblr-muted)' }} />
                      </div>
                    </div>
                    {acompteCalculated !== null && (
                      <div className="flex items-center gap-2 text-sm p-2 rounded-lg" style={{ background: 'rgba(255,243,191,0.7)' }}>
                        <IconInfoCircle size={16} style={{ color: '#e67700' }} className="shrink-0" />
                        <span style={{ color: '#7d4e00' }}>
                          {t('invoices_calculated_amount')} : <strong>{formatCurrency(acompteCalculated, currency)}</strong>
                        </span>
                      </div>
                    )}
                    {editForm.project_id && !projects.find(p => p.id === editForm.project_id)?.remuneration && (
                      <p className="text-xs" style={{ color: '#e67700' }}>{t('invoices_no_remuneration')}</p>
                    )}
                  </div>
                )}

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_amount_label')}</label>
                  <input
                    type="number"
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                    style={inputStyle}
                    value={acompteCalculated !== null ? acompteCalculated.toFixed(2) : (editForm.amount ?? '')}
                    readOnly={acompteCalculated !== null}
                    onChange={e => acompteCalculated === null && setEditForm({ ...editForm, amount: Number(e.target.value) })}
                  />
                </div>

                {/* Due date */}
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_due_date_label')}</label>
                  <input
                    type="date" required
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                    style={inputStyle}
                    value={editForm.due_date || ''}
                    onChange={e => setEditForm({ ...editForm, due_date: e.target.value })}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_description_label')}</label>
                  <textarea
                    className="w-full h-24 px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                    style={inputStyle}
                    value={editForm.description || ''}
                    onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>

                {/* Status */}
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_col_status')}</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                    style={inputStyle}
                    value={editForm.status || 'Draft'}
                    onChange={e => setEditForm({ ...editForm, status: e.target.value as Invoice['status'] })}
                  >
                    {(['Draft', 'Sent', 'Paid', 'Overdue'] as const).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingInvoice(null)}
                    className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors"
                    style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
                  >
                    {t('btn_cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingEdit}
                    className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                  >
                    <IconDeviceFloppy size={18} />
                    {isSavingEdit ? '...' : t('btn_save')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Send Invoice Modal */}
        {sendingInvoice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-lg shadow-xl w-full max-w-lg overflow-hidden flex flex-col"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
            >
              <div className="p-6 flex items-center justify-between" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
                    <IconSend size={20} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('invoices_send_title')}</h2>
                    <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{sendingInvoice.invoice_number}</p>
                  </div>
                </div>
                <button onClick={() => { setSendingInvoice(null); setSendResult(null); }} style={{ color: 'var(--tblr-muted)' }}><IconX size={24} /></button>
              </div>
              <form onSubmit={handleSendInvoice} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_send_to_label')}</label>
                  <input
                    type="email" required
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                    style={inputStyle}
                    value={sendForm.to}
                    onChange={e => setSendForm({ ...sendForm, to: e.target.value })}
                    placeholder="client@exemple.fr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_send_subject_label')}</label>
                  <input
                    type="text" required
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                    style={inputStyle}
                    value={sendForm.subject}
                    onChange={e => setSendForm({ ...sendForm, subject: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--tblr-text)' }}>{t('invoices_send_message_label')}</label>
                  <textarea
                    required rows={8}
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 resize-none font-mono text-sm"
                    style={inputStyle}
                    value={sendForm.message}
                    onChange={e => setSendForm({ ...sendForm, message: e.target.value })}
                  />
                </div>
                {sendResult && (
                  <div
                    className="text-sm p-3 rounded-lg"
                    style={sendResult.success
                      ? { background: '#d3f9d8', color: '#2f9e44' }
                      : { background: '#ffe3e3', color: 'var(--tblr-danger)' }}
                  >
                    {sendResult.message}
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { setSendingInvoice(null); setSendResult(null); }}
                    className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors"
                    style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
                  >
                    {sendResult?.success ? t('btn_close') : t('btn_cancel')}
                  </button>
                  {!sendResult?.success && (
                    <button
                      type="submit"
                      disabled={isSending}
                      className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                      style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                    >
                      <IconSend size={18} />
                      {isSending ? '...' : t('invoices_send_confirm')}
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
