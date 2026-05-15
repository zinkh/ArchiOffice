import * as React from 'react';
import { useState, useEffect } from 'react';
import { IconPlus, IconFileInvoice, IconCircleCheck, IconClock, IconX, IconTrash, IconDeviceFloppy, IconSearch, IconFilter, IconAlertTriangle, IconEdit, IconFileCode, IconChevronDown, IconChevronRight, IconArrowsSort, IconSortAscending, IconSortDescending, IconLayoutGrid, IconList, IconRefresh } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import { fetchJson } from '../lib/api';
import type { Invoice, Project } from '../types';
import { useTranslation } from 'react-i18next';
import { InvoiceGenerator } from '../components/InvoiceGenerator';

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
  const [newInvoice, setNewInvoice] = useState<Partial<Invoice>>({
    project_id: '',
    amount: 0,
    description: '',
    status: 'Draft',
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

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saved = await fetchJson<Invoice>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify(newInvoice)
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
    return sortConfig.direction === 'asc' ? <IconSortAscending size={14} className="text-emerald-500" /> : <IconSortDescending size={14} className="text-emerald-500" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight">{t('invoices')}</h1>
          <p className="text-zinc-500 dark:text-zinc-400">{t('invoices_subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {zohoConnected && (
            <button
              onClick={handleZohoSync}
              disabled={isSyncingZoho}
              className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold transition-all active:scale-95 disabled:opacity-60"
            >
              <IconRefresh size={18} className={isSyncingZoho ? 'animate-spin' : ''} />
              {t('zoho_sync_btn')}
            </button>
          )}
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
          >
            <IconPlus size={20} />
            {t('invoices_create_btn')}
          </button>
        </div>
      </div>

      {zohoSyncResult && (
        <div className={cn(
          "text-sm p-3 rounded-xl border flex items-center justify-between gap-4",
          zohoSyncResult.errors.length > 0
            ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300"
            : "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400"
        )}>
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

      <div className="flex flex-col md:flex-row items-center gap-4 bg-white dark:bg-zinc-800 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
        <div className="relative flex-1 w-full">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input 
            type="text" 
            placeholder={t('invoices_search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-white"
          />
        </div>
        <div className="flex items-center gap-2 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <button 
            onClick={() => setIsGroupedByProject(true)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all",
              isGroupedByProject ? "bg-white dark:bg-zinc-800 text-emerald-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
          >
            <IconLayoutGrid size={16} />
            {t('invoices_group_by_project')}
          </button>
          <button
            onClick={() => setIsGroupedByProject(false)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all",
              !isGroupedByProject ? "bg-white dark:bg-zinc-800 text-emerald-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
          >
            <IconList size={16} />
            {t('invoices_list_view')}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-700">
                <th 
                  className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer group"
                  onClick={() => handleSort('project_name')}
                >
                  <div className="flex items-center gap-2">
                    {t('invoices_col_invoice_project')}
                    <SortIcon column="project_name" />
                  </div>
                </th>
                <th
                  className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer group"
                  onClick={() => handleSort('amount')}
                >
                  <div className="flex items-center gap-2">
                    {t('invoices_col_amount')}
                    <SortIcon column="amount" />
                  </div>
                </th>
                <th
                  className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer group"
                  onClick={() => handleSort('due_date')}
                >
                  <div className="flex items-center gap-2">
                    {t('invoices_col_due_date')}
                    <SortIcon column="due_date" />
                  </div>
                </th>
                <th
                  className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer group"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center gap-2">
                    {t('invoices_col_status')}
                    <SortIcon column="status" />
                  </div>
                </th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-right">{t('invoices_col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {isGroupedByProject ? (
                Object.entries(groupedInvoices).map(([projectId, group]) => (
                  <React.Fragment key={projectId}>
                    <tr 
                      className="bg-zinc-100/50 dark:bg-zinc-900/50 cursor-pointer hover:bg-zinc-200/50 dark:hover:bg-zinc-900/80 transition-colors group/header"
                      onClick={() => toggleProjectExpansion(projectId)}
                    >
                      <td colSpan={5} className="px-6 py-3 border-y border-zinc-200/50 dark:border-zinc-700/50">
                        <div className="flex items-center gap-3">
                          <div className="p-1 bg-white dark:bg-zinc-800 rounded shadow-sm border border-zinc-200 dark:border-zinc-700">
                            {expandedProjects.has(projectId) ? <IconChevronDown size={16} className="text-emerald-500" /> : <IconChevronRight size={16} className="text-zinc-400" />}
                          </div>
                          <span className="font-bold text-sm text-zinc-900 dark:text-white group-hover/header:text-emerald-600 transition-colors">{group.name}</span>
                          <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-bold">
                            {group.invoices.length > 1 ? t('invoices_count_invoices_plural', { count: group.invoices.length }) : t('invoices_count_invoices', { count: group.invoices.length })}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {expandedProjects.has(projectId) && group.invoices.map((invoice) => (
                        <tr key={invoice.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors border-l-4 border-emerald-500/30">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3 pl-4">
                              <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-lg">
                                <IconFileInvoice size={20} />
                              </div>
                              <div>
                                <p className="font-bold text-zinc-900 dark:text-white text-sm">{invoice.invoice_number}</p>
                                <p className="text-xs text-zinc-500 truncate max-w-[200px]">{invoice.description}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-mono font-bold text-zinc-900 dark:text-white text-sm">
                            {formatCurrency(invoice.amount, currency)}
                          </td>
                          <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 text-sm">
                            <div className="flex items-center gap-1.5">
                              <IconClock size={14} className="text-zinc-400" />
                              {new Date(invoice.due_date).toLocaleDateString()}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                              invoice.status === 'Paid' ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800" :
                              invoice.status === 'Overdue' ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800" :
                              invoice.status === 'Sent' ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800" :
                              "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700"
                            )}>
                              {invoice.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button 
                                onClick={() => handleOpenGenerator(invoice)}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                title="Generate Factur-X"
                              >
                                <IconFileCode size={20} />
                              </button>
                              {invoice.status !== 'Paid' && (
                                <button 
                                  onClick={() => handleUpdateStatus(invoice, 'Paid')}
                                  className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                                  title="Mark as Paid"
                                >
                                  <IconCircleCheck size={20} />
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
                  <tr key={invoice.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-lg">
                          <IconFileInvoice size={20} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-zinc-900 dark:text-white text-sm">{invoice.invoice_number}</p>
                            <span className="text-[10px] text-zinc-400 font-mono">/</span>
                            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{invoice.project_name || 'General'}</p>
                          </div>
                          <p className="text-xs text-zinc-500 truncate max-w-[200px]">{invoice.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono font-bold text-zinc-900 dark:text-white text-sm">
                      {formatCurrency(invoice.amount, currency)}
                    </td>
                    <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 text-sm">
                      <div className="flex items-center gap-1.5">
                        <IconClock size={14} className="text-zinc-400" />
                        {new Date(invoice.due_date).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                        invoice.status === 'Paid' ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800" :
                        invoice.status === 'Overdue' ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-green-800" :
                        invoice.status === 'Sent' ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800" :
                        "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700"
                      )}>
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => handleOpenGenerator(invoice)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                          title="Generate Factur-X"
                        >
                          <IconFileCode size={20} />
                        </button>
                        {invoice.status !== 'Paid' && (
                          <button 
                            onClick={() => handleUpdateStatus(invoice, 'Paid')}
                            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                            title="Mark as Paid"
                          >
                            <IconCircleCheck size={20} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
              {sortedInvoices.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">
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
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{t('invoices_new_title')}</h2>
                <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                  <IconX size={24} />
                </button>
              </div>
              <form onSubmit={handleCreateInvoice} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('invoices_project_label')}</label>
                  <select
                    required
                    className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white"
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
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('invoices_amount_label')}</label>
                  <input 
                    type="number"
                    required
                    className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white"
                    value={newInvoice.amount}
                    onChange={e => setNewInvoice({...newInvoice, amount: Number(e.target.value)})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('invoices_due_date_label')}</label>
                  <input 
                    type="date"
                    required
                    className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white"
                    value={newInvoice.due_date}
                    onChange={e => setNewInvoice({...newInvoice, due_date: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('invoices_description_label')}</label>
                  <textarea 
                    className="w-full h-32 px-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white resize-none"
                    value={newInvoice.description ?? ''}
                    onChange={e => setNewInvoice({...newInvoice, description: e.target.value})}
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-xl font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    {t('btn_cancel')}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-500/20"
                  >
                    {t('invoices_create_btn')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
