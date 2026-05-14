import { useState, useEffect, useMemo, Fragment } from 'react';
import { db } from '../db';
import { useTranslation } from 'react-i18next';
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
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

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
        const data = await db.projects.toArray();
        setProjects(data);
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

  const exportToPDF = () => {
    const selectedProjects = filteredProjects.filter(p => selectedIds.has(p.id));
    const doc = new jsPDF();
    doc.text('Références Projets', 14, 15);
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
      startY: 20,
    });
    doc.save('references.pdf');
  };

  const exportToExcel = () => {
    const selectedProjects = filteredProjects.filter(p => selectedIds.has(p.id));
    const worksheet = XLSX.utils.json_to_sheet(selectedProjects.map(p => ({
      Projet: p.name,
      Client: p.client,
      'Date de livraison': p.end_date ? new Date(p.end_date).toLocaleDateString() : '---',
      Surface: p.surface ? `${p.surface} m²` : '---',
      Budget: formatCurrency(p.budget),
      Statut: p.status
    })));
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
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('references_title')}</h2>
          <p className="text-zinc-500 dark:text-zinc-400">{t('references_subtitle')}</p>
        </div>
        <div className="flex gap-2">
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

      <div className="flex flex-col md:flex-row items-start md:items-center gap-4 bg-white dark:bg-zinc-800 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
        <div className="relative flex-1 w-full">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input 
            type="text" 
            placeholder={t('references_search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-zinc-900 dark:text-white"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2">
            <IconCalendar size={18} className="text-zinc-400" />
            <select 
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-transparent text-sm outline-none text-zinc-900 dark:text-white cursor-pointer"
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
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
              <input 
                type="date" 
                value={customDateRange.start}
                onChange={(e) => setCustomDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
              />
              <span className="text-zinc-400 text-sm">{t('references_date_separator')}</span>
              <input 
                type="date" 
                value={customDateRange.end}
                onChange={(e) => setCustomDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 text-zinc-900 dark:text-white"
              />
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-700">
                <th className="w-12 px-4 py-3"></th>
                <th 
                  className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  onClick={() => requestSort('name')}
                >
                  <div className="flex items-center gap-1">{t('references_col_project')} {getSortIcon('name')}</div>
                </th>
                <th 
                  className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  onClick={() => requestSort('client')}
                >
                  <div className="flex items-center gap-1">{t('references_col_client')} {getSortIcon('client')}</div>
                </th>
                <th 
                  className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  onClick={() => requestSort('end_date')}
                >
                  <div className="flex items-center gap-1">{t('references_col_delivery')} {getSortIcon('end_date')}</div>
                </th>
                <th 
                  className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  onClick={() => requestSort('surface')}
                >
                  <div className="flex items-center gap-1">{t('references_col_surface')} {getSortIcon('surface')}</div>
                </th>
                <th 
                  className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  onClick={() => requestSort('budget')}
                >
                  <div className="flex items-center gap-1">{t('references_col_budget')} {getSortIcon('budget')}</div>
                </th>
                <th 
                  className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  onClick={() => requestSort('status')}
                >
                  <div className="flex items-center gap-1">{t('references_col_status')} {getSortIcon('status')}</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
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
                        className="bg-zinc-50/50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 cursor-pointer transition-colors"
                        onClick={() => toggleDomain(domain)}
                      >
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <input 
                              type="checkbox" 
                              checked={allSelected}
                              ref={el => { if (el) el.indeterminate = someSelected; }}
                              onChange={() => toggleSelectAll(domain)}
                              className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                            />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <IconChevronDown size={18} className="text-zinc-400" /> : <IconChevronRight size={18} className="text-zinc-400" />}
                            <span className="font-bold text-zinc-900 dark:text-white uppercase text-xs tracking-wider">{domain}</span>
                            <span className="text-[10px] bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded-full text-zinc-600 dark:text-zinc-400">
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
                            className="hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors group"
                          >
                            <td className="px-4 py-3 pl-8">
                              <input 
                                type="checkbox" 
                                checked={selectedIds.has(project.id)}
                                onChange={() => toggleSelectProject(project.id)}
                                className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden shrink-0">
                                  <img 
                                    src={project.image_url || `https://picsum.photos/seed/${project.id}/100/100`} 
                                    alt="" 
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-zinc-900 dark:text-white">{project.name}</p>
                                  <p className="text-[10px] text-zinc-500 font-mono">#{project.project_code || '---'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">{project.client}</td>
                            <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">
                              {project.end_date ? new Date(project.end_date).toLocaleDateString() : '---'}
                            </td>
                            <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">{project.surface ? `${project.surface} m²` : '---'}</td>
                            <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">{formatCurrency(project.budget)}</td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-medium border",
                                project.status === 'In Progress' ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800" :
                                project.status === 'Completed' ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800" :
                                "bg-zinc-50 text-zinc-700 border-zinc-200 dark:bg-zinc-900/20 dark:text-zinc-400 dark:border-zinc-800"
                              )}>
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
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(project.id)}
                        onChange={() => toggleSelectProject(project.id)}
                        className="w-4 h-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden shrink-0">
                          <img 
                            src={project.image_url || `https://picsum.photos/seed/${project.id}/100/100`} 
                            alt="" 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-white">{project.name}</p>
                          <p className="text-[10px] text-zinc-500 font-mono">#{project.project_code || '---'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">{project.client}</td>
                    <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">
                      {project.end_date ? new Date(project.end_date).toLocaleDateString() : '---'}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">{project.surface ? `${project.surface} m²` : '---'}</td>
                    <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">{formatCurrency(project.budget)}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-medium border",
                        project.status === 'In Progress' ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800" :
                        project.status === 'Completed' ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800" :
                        "bg-zinc-50 text-zinc-700 border-zinc-200 dark:bg-zinc-900/20 dark:text-zinc-400 dark:border-zinc-800"
                      )}>
                        {project.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
              {domains.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-zinc-500 dark:text-zinc-400">
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
