import { useState, useEffect, useMemo, Fragment } from 'react';
import { db } from '../db';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';
import { 
  IconChevronRight, 
  IconChevronDown, 
  IconBriefcase, 
  IconSearch,
  IconFilter,
  IconChevronUp,
  IconCalendar,
  IconFileTypePdf,
  IconFileSpreadsheet
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../lib/utils';
import type { Project } from '../types';
import { MobileAccordionTable } from '../components/MobileAccordionTable';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadImageAsDataUrl } from '../lib/imageUtils';

interface GroupedProjects {
  [domain: string]: Project[];
}

export default function References() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState<{ key: keyof Project; direction: 'asc' | 'desc' } | null>(null);
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [customDateRange, setCustomDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        // Load from IndexedDB first (fast local response)
        const localData = await db.projects.toArray();
        if (localData.length > 0) {
          setProjects(localData);
          setIsLoading(false);
        }
        // Sync with API (authoritative, multi-tenant)
        if (navigator.onLine) {
          const data = await apiFetch<Project[]>('/api/projects');
          await db.projects.clear();
          await db.projects.bulkPut(data);
          setProjects(data);
        }
      } catch (err) {
        console.error('Failed to fetch projects:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchProjects();
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.category || 'Non classé').toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (dateFilter === 'all') return true;

      if (!p.end_date) return false;
      const deliveryDate = new Date(p.end_date);
      const now = new Date();

      if (dateFilter === 'last_year') {
        const lastYear = new Date();
        lastYear.setFullYear(now.getFullYear() - 1);
        return deliveryDate >= lastYear;
      }
      if (dateFilter === 'last_3_years') {
        const last3Years = new Date();
        last3Years.setFullYear(now.getFullYear() - 3);
        return deliveryDate >= last3Years;
      }
      if (dateFilter === 'last_5_years') {
        const last5Years = new Date();
        last5Years.setFullYear(now.getFullYear() - 5);
        return deliveryDate >= last5Years;
      }
      if (dateFilter === 'last_10_years') {
        const last10Years = new Date();
        last10Years.setFullYear(now.getFullYear() - 10);
        return deliveryDate >= last10Years;
      }
      if (dateFilter === 'custom') {
        const start = customDateRange.start ? new Date(customDateRange.start) : null;
        const end = customDateRange.end ? new Date(customDateRange.end) : null;
        if (start && deliveryDate < start) return false;
        if (end && deliveryDate > end) return false;
        return true;
      }

      return true;
    }).sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;
      const aValue = a[key];
      const bValue = b[key];

      if (aValue === undefined || bValue === undefined) return 0;

      if (aValue < bValue) {
        return direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [projects, searchQuery, sortConfig]);

  const groupedProjects = useMemo(() => {
    const groups: GroupedProjects = {};
    filteredProjects.forEach(p => {
      const domain = p.category || 'Non classé';
      if (!groups[domain]) groups[domain] = [];
      groups[domain].push(p);
    });
    return groups;
  }, [filteredProjects]);

  const domains = useMemo(() => Object.keys(groupedProjects).sort(), [groupedProjects]);

  const toggleDomain = (domain: string) => {
    const next = new Set(expandedDomains);
    if (next.has(domain)) next.delete(domain);
    else next.add(domain);
    setExpandedDomains(next);
  };

  const toggleSelectAll = (domain: string) => {
    const domainProjects = groupedProjects[domain];
    const allSelected = domainProjects.every(p => selectedIds.has(p.id));
    const next = new Set(selectedIds);
    
    domainProjects.forEach(p => {
      if (allSelected) next.delete(p.id);
      else next.add(p.id);
    });
    setSelectedIds(next);
  };

  const toggleSelectProject = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const requestSort = (key: keyof Project) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key) {
      if (sortConfig.direction === 'asc') {
        direction = 'desc';
      } else {
        // Clear sort to return to grouped view
        setSortConfig(null);
        return;
      }
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: keyof Project) => {
    if (!sortConfig || sortConfig.key !== key) return null;
    return sortConfig.direction === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />;
  };

  const exportToPDF = async () => {
    const selectedProjects = filteredProjects.filter(p => selectedIds.has(p.id));
    const doc = new jsPDF();
    let startY = 20;

    // Fetch settings for logo + agency name
    try {
      const s = await fetch('/api/settings').then(r => r.ok ? r.json() : null);
      if (s?.logoUrl) {
        try {
          const dataUrl = await loadImageAsDataUrl(s.logoUrl);
          doc.addImage(dataUrl, 'PNG', 14, 8, 30, 12);
          startY = 28;
        } catch { /* skip logo if load fails */ }
      }
      const headerText = s?.agencyName || 'Références Projets';
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text(headerText, s?.logoUrl ? 48 : 14, 15);
      if (s?.agencyName) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text('Références Projets', s?.logoUrl ? 48 : 14, 21);
      }
    } catch { doc.text('Références Projets', 14, 15); }

    autoTable(doc, {
      head: [['Projet', 'Client', 'Date', 'Surface', 'Budget', 'Statut']],
      body: selectedProjects.map(p => [
        p.name,
        p.client,
        p.end_date ? new Date(p.end_date).toLocaleDateString() : '---',
        p.surface ? `${p.surface} m²` : '---',
        formatCurrency(p.budget),
        p.status
      ]),
      startY,
    });
    doc.save('references.pdf');
  };

  const exportToExcel = async () => {
    const XLSX = await import('xlsx');
    const selectedProjects = filteredProjects.filter(p => selectedIds.has(p.id));
    let agencyName = '';
    try { const s = await fetch('/api/settings').then(r => r.ok ? r.json() : null); agencyName = s?.agencyName || ''; } catch { /* */ }

    const rows = selectedProjects.map(p => ({
      Projet: p.name,
      Client: p.client,
      'Date de livraison': p.end_date ? new Date(p.end_date).toLocaleDateString() : '---',
      Surface: p.surface ? `${p.surface} m²` : '---',
      Budget: formatCurrency(p.budget),
      Statut: p.status
    }));
    const worksheet = XLSX.utils.json_to_sheet([]);
    if (agencyName) {
      XLSX.utils.sheet_add_aoa(worksheet, [[agencyName]], { origin: 'A1' });
      XLSX.utils.sheet_add_aoa(worksheet, [['Références Projets']], { origin: 'A2' });
      XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A4' });
    } else {
      XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A1' });
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Références');
    XLSX.writeFile(workbook, 'references.xlsx');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('references_title')}</h2>
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('references_subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button 
            onClick={exportToPDF}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <IconFileTypePdf size={18} />
            {t('references_export_pdf', { count: selectedIds.size })}
          </button>
          <button 
            onClick={exportToExcel}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <IconFileSpreadsheet size={18} />
            {t('references_export_excel', { count: selectedIds.size })}
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-start md:items-center gap-4 p-4 rounded-lg" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        <div className="relative flex-1 w-full">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: 'var(--tblr-muted)' }} />
          <input
            type="text"
            placeholder={t('references_search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
            style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
            <IconCalendar size={16} style={{ color: 'var(--tblr-muted)' }} />
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-transparent text-sm outline-none cursor-pointer"
              style={{ color: 'var(--tblr-text)' }}
            >
              <option value="all">{t('references_all_dates')}</option>
              <option value="last_year">{t('references_last_year')}</option>
              <option value="last_3_years">{t('references_last_3_years')}</option>
              <option value="last_5_years">{t('references_last_5_years')}</option>
              <option value="last_10_years">{t('references_last_10_years')}</option>
              <option value="custom">{t('references_custom_range')}</option>
            </select>
          </div>

          {dateFilter === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customDateRange.start}
                onChange={(e) => setCustomDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              />
              <span className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('references_date_separator')}</span>
              <input
                type="date"
                value={customDateRange.end}
                onChange={(e) => setCustomDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        {/* Mobile accordion */}
        <div className="md:hidden">
          <MobileAccordionTable
            data={filteredProjects}
            keyField="id"
            emptyText={t('references_no_projects')}
            columns={[
              { label: t('references_col_project'), primary: true, render: p => (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded overflow-hidden shrink-0" style={{ background: 'var(--tblr-surface-2)' }}>
                    <img src={p.image_url || `https://picsum.photos/seed/${p.id}/60/60`} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{p.name}</p>
                    <p className="text-[10px] font-mono" style={{ color: 'var(--tblr-muted)' }}>#{p.project_code || '---'}</p>
                  </div>
                </div>
              )},
              { label: t('references_col_client'), render: p => p.client || '---' },
              { label: t('references_col_delivery'), render: p => p.end_date ? new Date(p.end_date).toLocaleDateString('fr-FR') : '---' },
              { label: t('references_col_surface'), render: p => p.surface ? `${p.surface} m²` : '---' },
              { label: t('references_col_budget'), render: p => <span className="font-mono">{p.budget ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(p.budget) : '---'}</span> },
              { label: t('references_col_status'), render: p => (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{
                  background: p.status === 'In Progress' ? 'var(--tblr-primary-lt)' : p.status === 'Completed' ? 'rgba(47,179,135,0.1)' : 'var(--tblr-surface-2)',
                  color: p.status === 'In Progress' ? 'var(--tblr-primary)' : p.status === 'Completed' ? 'var(--tblr-success)' : 'var(--tblr-muted)',
                  border: '1px solid currentColor',
                }}>{p.status}</span>
              )},
            ]}
          />
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                <th className="w-12 px-4 py-3"></th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('name')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <div className="flex items-center gap-1">{t('references_col_project')} {getSortIcon('name')}</div>
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('client')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <div className="flex items-center gap-1">{t('references_col_client')} {getSortIcon('client')}</div>
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('end_date')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <div className="flex items-center gap-1">{t('references_col_delivery')} {getSortIcon('end_date')}</div>
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('surface')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <div className="flex items-center gap-1">{t('references_col_surface')} {getSortIcon('surface')}</div>
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('budget')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <div className="flex items-center gap-1">{t('references_col_budget')} {getSortIcon('budget')}</div>
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort('status')} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <div className="flex items-center gap-1">{t('references_col_status')} {getSortIcon('status')}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {!sortConfig ? (
                // Grouped View (Default)
                domains.map(domain => {
                  const domainProjects = groupedProjects[domain];
                  const isExpanded = expandedDomains.has(domain);
                  const allSelected = domainProjects.every(p => selectedIds.has(p.id));
                  const someSelected = domainProjects.some(p => selectedIds.has(p.id)) && !allSelected;

                  return (
                    <Fragment key={domain}>
                      <tr
                        className="cursor-pointer transition-colors"
                        style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}
                        onClick={() => toggleDomain(domain)}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                      >
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={el => { if (el) el.indeterminate = someSelected; }}
                              onChange={() => toggleSelectAll(domain)}
                              className="w-4 h-4 rounded"
                            />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <IconChevronDown size={16} style={{ color: 'var(--tblr-muted)' }} /> : <IconChevronRight size={16} style={{ color: 'var(--tblr-muted)' }} />}
                            <span className="font-semibold uppercase text-xs tracking-wider" style={{ color: 'var(--tblr-text)' }}>{domain}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
                              {domainProjects.length}
                            </span>
                          </div>
                        </td>
                        <td colSpan={5}></td>
                      </tr>
                      <AnimatePresence initial={false}>
                        {isExpanded && domainProjects.map((project) => (
                          <motion.tr
                            key={project.id}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="transition-colors"
                            style={{ borderBottom: '1px solid var(--tblr-border)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                          >
                            <td className="px-4 py-3 pl-8">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(project.id)}
                                onChange={() => toggleSelectProject(project.id)}
                                className="w-4 h-4 rounded"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded overflow-hidden shrink-0" style={{ background: 'var(--tblr-surface-2)' }}>
                                  <img
                                    src={project.image_url || `https://picsum.photos/seed/${project.id}/100/100`}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                                <div>
                                  <p className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{project.name}</p>
                                  <p className="text-[10px] font-mono" style={{ color: 'var(--tblr-muted)' }}>#{project.project_code || '---'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{project.client}</td>
                            <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>
                              {project.end_date ? new Date(project.end_date).toLocaleDateString() : '---'}
                            </td>
                            <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{project.surface ? `${project.surface} m²` : '---'}</td>
                            <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{formatCurrency(project.budget)}</td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={
                                project.status === 'In Progress' ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' } :
                                project.status === 'Completed' ? { background: '#d3f9d8', color: '#2f9e44' } :
                                { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }
                              }>
                                {project.status}
                              </span>
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </Fragment>
                  );
                })
              ) : (
                // Flat Sorted View
                filteredProjects.map((project) => (
                  <tr
                    key={project.id}
                    style={{ borderBottom: '1px solid var(--tblr-border)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(project.id)}
                        onChange={() => toggleSelectProject(project.id)}
                        className="w-4 h-4 rounded"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded overflow-hidden shrink-0" style={{ background: 'var(--tblr-surface-2)' }}>
                          <img
                            src={project.image_url || `https://picsum.photos/seed/${project.id}/100/100`}
                            alt=""
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{project.name}</p>
                          <p className="text-[10px] font-mono" style={{ color: 'var(--tblr-muted)' }}>#{project.project_code || '---'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-muted)' }}>{project.client}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-muted)' }}>
                      {project.end_date ? new Date(project.end_date).toLocaleDateString() : '---'}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-muted)' }}>{project.surface ? `${project.surface} m²` : '---'}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-muted)' }}>{formatCurrency(project.budget)}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{
                        background: project.status === 'In Progress' ? 'var(--tblr-primary-lt)' : project.status === 'Completed' ? 'rgba(var(--tblr-success-rgb, 47,179,135), 0.1)' : 'var(--tblr-surface-2)',
                        color: project.status === 'In Progress' ? 'var(--tblr-primary)' : project.status === 'Completed' ? 'var(--tblr-success)' : 'var(--tblr-muted)',
                        border: '1px solid currentColor',
                      }}>
                        {project.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
              {domains.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center" style={{ color: 'var(--tblr-muted)' }}>
                    <div className="flex flex-col items-center gap-2">
                      <IconBriefcase size={48} className="opacity-20" />
                      <p>{t('references_no_projects')}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
