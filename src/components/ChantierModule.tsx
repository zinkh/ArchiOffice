import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  IconPlus, IconFileDownload, IconCopy, IconSend, IconCloud, IconTemperature,
  IconUsers, IconChevronLeft, IconChevronRight, IconTrash, IconCamera,
  IconBuilding, IconTools, IconPhoto, IconClipboardList, IconAlertTriangle,
  IconRefresh,
} from '@tabler/icons-react';
import { Project, ProjectLot, SiteReport, Observation, OrdreDeService } from '../types';
import { autoSaveDocument } from '../lib/autoSaveDocument';
import ObservationsTable from './ObservationsTable';
import { cn } from '../lib/utils';

interface ChantierModuleProps {
  project: Project;
  lots_list: ProjectLot[];
  ordresDeService: OrdreDeService[];
  osSituationsContent: React.ReactNode;
}

type ChantierTab = 'comptes-rendus' | 'reserves' | 'entreprises' | 'os' | 'photos';

const STATUT_CR_LABELS: Record<string, string> = {
  brouillon: 'BROUILLON',
  diffuse: 'DIFFUSÉ',
  archive: 'ARCHIVÉ',
};

const STATUT_CR_COLORS: Record<string, string> = {
  brouillon: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  diffuse: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  archive: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const TYPE_LABELS: Record<string, string> = {
  observation: 'OBSERVATION',
  reserve: 'RÉSERVE',
  a_faire: 'À FAIRE',
};

const TYPE_COLORS: Record<string, string> = {
  observation: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  reserve: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  a_faire: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

const URGENCE_LABELS: Record<string, string> = {
  normal: '',
  urgent: 'URGENT',
  bloquant: 'BLOQUANT',
};

const WEATHER_ALERT_KEYWORDS = ['pluie', 'neige', 'intemp', 'orage', 'gel', 'vent fort'];

function isBadWeather(meteo?: string) {
  if (!meteo) return false;
  const lower = meteo.toLowerCase();
  return WEATHER_ALERT_KEYWORDS.some(k => lower.includes(k));
}

export default function ChantierModule({ project, lots_list, ordresDeService, osSituationsContent }: ChantierModuleProps) {
  const [activeTab, setActiveTab] = useState<ChantierTab>('comptes-rendus');

  const [reports, setReports] = useState<SiteReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reportObservations, setReportObservations] = useState<Observation[]>([]);
  const [allObservations, setAllObservations] = useState<Observation[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newReportDate, setNewReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [fetchedWeather, setFetchedWeather] = useState<{ meteo: string; temperature: number | null } | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const selectedReport = useMemo(
    () => reports.find(r => r.id === selectedReportId) || null,
    [reports, selectedReportId]
  );

  const fetchReports = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.id}/reports`);
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data)) return;
    setReports(data);
    if (data.length > 0 && !selectedReportId) setSelectedReportId(data[0].id);
  }, [project.id, selectedReportId]);

  const fetchReportObservations = useCallback(async () => {
    if (!selectedReportId) { setReportObservations([]); return; }
    const res = await fetch(`/api/reports/${selectedReportId}/observations`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data)) setReportObservations(data);
  }, [selectedReportId]);

  const fetchAllObservations = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.id}/observations`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data)) setAllObservations(data);
  }, [project.id]);

  useEffect(() => { fetchReports(); }, [fetchReports]);
  useEffect(() => { fetchReportObservations(); }, [fetchReportObservations]);
  useEffect(() => { fetchAllObservations(); }, [fetchAllObservations]);

  useEffect(() => {
    if (isModalOpen && project.address) {
      const fetchWeather = async () => {
        setWeatherLoading(true);
        try {
          const res = await fetch(`/api/weather?q=${encodeURIComponent(project.address ?? '')}&date=${newReportDate}`);
          if (res.ok) setFetchedWeather(await res.json());
        } catch (err) {
          console.error('Failed to fetch weather:', err);
        } finally {
          setWeatherLoading(false);
        }
      };
      fetchWeather();
    }
  }, [isModalOpen, newReportDate, project.address]);

  const handleCreateReport = async (duplicateFrom?: SiteReport) => {
    const report_number = reports.length + 1;
    const res = await fetch(`/api/projects/${project.id}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: duplicateFrom ? duplicateFrom.date : newReportDate,
        report_number,
        meteo: duplicateFrom ? duplicateFrom.meteo : (fetchedWeather?.meteo || 'Inconnu'),
        temperature: duplicateFrom ? duplicateFrom.temperature : (fetchedWeather?.temperature || 0),
        effectif_total: 0,
      }),
    });
    if (!res.ok) return;
    const newReport = await res.json();
    setReports(prev => [newReport, ...prev]);
    setSelectedReportId(newReport.id);
    setIsModalOpen(false);
    setFetchedWeather(null);
  };

  const refreshWeather = async (report: SiteReport) => {
    if (!project.address) return;
    setWeatherLoading(true);
    try {
      const res = await fetch(`/api/weather?q=${encodeURIComponent(project.address)}&date=${report.date}`);
      if (!res.ok) return;
      const data = await res.json();
      const updated = { ...report, meteo: data.meteo, temperature: data.temperature };
      setReports(prev => prev.map(r => (r.id === report.id ? updated : r)));
      const saveRes = await fetch(`/api/reports/${report.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (saveRes.ok) {
        const saved = await saveRes.json();
        setReports(prev => prev.map(r => (r.id === saved.id ? saved : r)));
      }
    } catch (err) {
      console.error('Failed to refresh weather:', err);
    } finally {
      setWeatherLoading(false);
    }
  };

  const updateReportField = async (field: keyof SiteReport, value: any) => {
    if (!selectedReport) return;
    const updated = { ...selectedReport, [field]: value };
    setReports(prev => prev.map(r => (r.id === selectedReport.id ? updated : r)));
    const res = await fetch(`/api/reports/${selectedReport.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (res.ok) {
      const saved = await res.json();
      setReports(prev => prev.map(r => (r.id === saved.id ? saved : r)));
    }
  };

  const setAttendance = (index: number, patch: Partial<{ name: string; role: string; present: boolean; excused: boolean }>) => {
    const list = [...(selectedReport?.attendance || [])];
    list[index] = { ...list[index], ...patch };
    updateReportField('attendance', list);
  };

  const ensureAttendanceRow = (lot: ProjectLot) => {
    const list = selectedReport?.attendance || [];
    if (list.some(a => a.role === lot.lot_title)) return;
    const name = lot.contact_name?.split(' - ')[1] || lot.contact_name?.split(' - ')[0] || '';
    updateReportField('attendance', [...list, { name, role: lot.lot_title, present: true }]);
  };

  const addDecision = () => {
    const list = selectedReport?.decisions || [];
    updateReportField('decisions', [...list, { auteur: '', texte: '', tag: 'technique' as const }]);
  };
  const updateDecision = (index: number, patch: Partial<{ auteur: string; texte: string; tag: 'planning' | 'technique' | 'financier' }>) => {
    const list = [...(selectedReport?.decisions || [])];
    list[index] = { ...list[index], ...patch };
    updateReportField('decisions', list);
  };
  const removeDecision = (index: number) => {
    updateReportField('decisions', (selectedReport?.decisions || []).filter((_, i) => i !== index));
  };

  const addObservation = async (type: Observation['type'] = 'observation') => {
    if (!selectedReportId) return;
    const res = await fetch(`/api/projects/${project.id}/observations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texte: '', statut: 'À faire', type, created_report_id: selectedReportId }),
    });
    if (!res.ok) return;
    const newObs = await res.json();
    setReportObservations(prev => [...prev, newObs]);
    fetchAllObservations();
  };

  const saveObservationField = async (obsId: string, field: string, value: any) => {
    setReportObservations(prev => prev.map(o => (o.id === obsId ? { ...o, [field]: value } : o)));
    await fetch(`/api/observations/${obsId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    fetchAllObservations();
  };

  const uploadObservationPhoto = async (obsId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`/api/observations/${obsId}/photos`, { method: 'POST', body: formData });
    if (!res.ok) return;
    const data = await res.json();
    setReportObservations(prev => prev.map(o => (o.id === obsId ? { ...o, photos: data.photos } : o)));
    fetchAllObservations();
  };

  const observationsByLot = useMemo(() => {
    const groups = new Map<string, { title: string; entreprise: string; items: Observation[] }>();
    reportObservations.forEach(o => {
      const key = o.lot?.id || 'sans-lot';
      const title = o.lot ? `${o.lot.lot_number} — ${o.lot.lot_title}` : 'Sans lot identifié';
      const lotFull = lots_list.find(l => l.id === o.lot_id);
      if (!groups.has(key)) groups.set(key, { title, entreprise: lotFull?.contact_name || '', items: [] });
      groups.get(key)!.items.push(o);
    });
    return Array.from(groups.values());
  }, [reportObservations, lots_list]);

  const generatePdf = async () => {
    if (!selectedReport) return;
    setIsGeneratingPdf(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const pdf = new jsPDF('p', 'mm', 'a4');
      pdf.setFontSize(16);
      pdf.text(`COMPTE RENDU DE CHANTIER N°${selectedReport.report_number}`, 14, 18);
      pdf.setFontSize(10);
      pdf.text(`${project.name} — ${project.client || ''}`, 14, 25);
      pdf.text(`${selectedReport.date}  ·  ${selectedReport.meteo || ''}  ${selectedReport.temperature ?? ''}°C`, 14, 31);
      autoTable(pdf, {
        startY: 38,
        head: [['Lot', 'Type', 'Description', 'Statut', 'Échéance']],
        body: reportObservations.map(o => [
          o.lot?.lot_title || '—',
          TYPE_LABELS[o.type || 'observation'],
          o.texte + (o.urgence === 'bloquant' ? ' [BLOQUANT]' : ''),
          o.statut,
          o.due_date || '—',
        ]),
        styles: { fontSize: 8 },
      });
      const filename = `CR_${selectedReport.report_number}_${project.name}.pdf`;
      pdf.save(filename);
      autoSaveDocument({
        blob: pdf.output('blob'),
        filename,
        name: `CR Chantier N°${selectedReport.report_number} - ${project.name}`,
        projectId: project.id,
        phase: 'DET',
        category: 'Report',
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // ---- Sidebar stats (derived from existing data only — no invented metrics) ----
  const reserves = useMemo(() => allObservations.filter(o => o.type === 'reserve'), [allObservations]);
  const reservesOuvertes = useMemo(() => reserves.filter(o => o.statut !== 'Levée'), [reserves]);
  const reservesLevees = reserves.length - reservesOuvertes.length;
  const avancementDet = reserves.length > 0 ? Math.round((reservesLevees / reserves.length) * 100) : 0;
  const crDiffuses = reports.filter(r => r.statut === 'diffuse').length;
  const osEmisTravaux = ordresDeService.filter(o => (o.type === 'travaux' || !o.type) && o.status !== 'draft').length;
  const intemperies = reports.filter(r => isBadWeather(r.meteo)).length;
  const dernierCrDiffuse = [...reports].filter(r => r.statut === 'diffuse').sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

  const tabs: { id: ChantierTab; label: string; icon: any }[] = [
    { id: 'comptes-rendus', label: 'Comptes-rendus', icon: IconClipboardList },
    { id: 'reserves', label: 'Réserves', icon: IconAlertTriangle },
    { id: 'entreprises', label: 'Entreprises', icon: IconBuilding },
    { id: 'os', label: 'OS & situations', icon: IconTools },
    { id: 'photos', label: 'Photos', icon: IconPhoto },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl p-4 sm:p-6" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-1">
              Phase DET · Direction de l'exécution des travaux
            </p>
            <h2 className="text-2xl font-bold text-[var(--tblr-text)]">Chantier</h2>
            <p className="text-sm text-[var(--tblr-muted)] mt-1 max-w-xl">
              Suivi de l'exécution : visites, comptes-rendus diffusés aux entreprises, réserves et ordres de service.
            </p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shrink-0"
          >
            <IconPlus size={16} /> Nouveau compte-rendu
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
          <StatPill label="Avancement DET" value={`${avancementDet} %`} />
          <StatPill label="Comptes-rendus" value={String(reports.length)} />
          <StatPill label="Réserves ouvertes" value={String(reservesOuvertes.length)} accent={reservesOuvertes.length > 0} />
          <StatPill label="OS émis" value={String(osEmisTravaux)} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map(tabItem => (
          <button
            key={tabItem.id}
            onClick={() => setActiveTab(tabItem.id)}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all',
              activeTab === tabItem.id
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            )}
          >
            <tabItem.icon size={16} /> {tabItem.label}
          </button>
        ))}
      </div>

      {/* Body: main content + persistent sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4 items-start">
        <div className="min-w-0">
          {activeTab === 'comptes-rendus' && (
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 items-start">
              {/* CR list */}
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] border-b border-[var(--tblr-border)]">
                  Comptes-rendus · {reports.length}
                </div>
                <div className="max-h-[70vh] overflow-y-auto">
                  {reports.map(r => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedReportId(r.id)}
                      className={cn(
                        'w-full text-left px-3 py-3 border-b border-[var(--tblr-border)] transition-colors',
                        selectedReportId === r.id ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sm text-[var(--tblr-text)]">CR {r.report_number}</span>
                        <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', STATUT_CR_COLORS[r.statut || 'brouillon'])}>
                          {STATUT_CR_LABELS[r.statut || 'brouillon']}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--tblr-muted)] mt-0.5">{r.date}</div>
                    </button>
                  ))}
                  {reports.length === 0 && (
                    <p className="p-4 text-sm text-[var(--tblr-muted)] italic text-center">Aucun compte-rendu.</p>
                  )}
                </div>
              </div>

              {/* CR detail */}
              {selectedReport ? (
                <div className="space-y-4">
                  <div className="rounded-xl p-4 sm:p-5" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            const idx = reports.findIndex(r => r.id === selectedReportId);
                            if (idx < reports.length - 1) setSelectedReportId(reports[idx + 1].id);
                          }}
                          className="p-1 text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]"
                        ><IconChevronLeft size={18} /></button>
                        <div>
                          <h3 className="text-lg font-bold text-[var(--tblr-text)]">
                            Compte-rendu de visite n° {selectedReport.report_number}
                          </h3>
                          <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', STATUT_CR_COLORS[selectedReport.statut || 'brouillon'])}>
                            {STATUT_CR_LABELS[selectedReport.statut || 'brouillon']}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            const idx = reports.findIndex(r => r.id === selectedReportId);
                            if (idx > 0) setSelectedReportId(reports[idx - 1].id);
                          }}
                          className="p-1 text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]"
                        ><IconChevronRight size={18} /></button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={generatePdf} disabled={isGeneratingPdf}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold transition-all">
                          <IconFileDownload size={14} /> PDF
                        </button>
                        <button onClick={() => handleCreateReport(selectedReport)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold transition-all">
                          <IconCopy size={14} /> Dupliquer
                        </button>
                        <button onClick={() => updateReportField('statut', 'diffuse')}
                          disabled={selectedReport.statut === 'diffuse'}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all">
                          <IconSend size={14} /> Diffuser
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-[var(--tblr-muted)]">
                      <span>{selectedReport.date}</span>
                      <span className="flex items-center gap-1"><IconCloud size={14} />
                        <input className="bg-transparent border-none outline-none w-28"
                          value={selectedReport.meteo || ''} onChange={e => updateReportField('meteo', e.target.value)} />
                      </span>
                      <span className="flex items-center gap-1"><IconTemperature size={14} />
                        <input type="number" className="bg-transparent border-none outline-none w-14"
                          value={selectedReport.temperature ?? ''} onChange={e => updateReportField('temperature', parseInt(e.target.value) || 0)} />°C
                      </span>
                      {project.address && (
                        <button
                          onClick={() => refreshWeather(selectedReport)}
                          disabled={weatherLoading}
                          title="Actualiser la météo pour la date du compte-rendu"
                          className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                        >
                          <IconRefresh size={13} className={weatherLoading ? 'animate-spin' : ''} /> Actualiser
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                      <MiniStat label="Présents" value={String((selectedReport.attendance || []).filter(a => a.present).length)} />
                      <MiniStat label="Absents/Excusés" value={String((selectedReport.attendance || []).filter(a => !a.present).length)} />
                      <MiniStat label="Observations" value={String(reportObservations.length)} />
                      <MiniStat label="Réserves ouv./tot." value={`${reportObservations.filter(o => o.type === 'reserve' && o.statut !== 'Levée').length}/${reportObservations.filter(o => o.type === 'reserve').length}`} />
                    </div>
                  </div>

                  {/* Présences */}
                  <Section title="Présences" icon={IconUsers}>
                    <table className="w-full text-sm">
                      <tbody>
                        {lots_list.map(lot => {
                          const idx = (selectedReport.attendance || []).findIndex(a => a.role === lot.lot_title);
                          const row = idx >= 0 ? selectedReport.attendance![idx] : undefined;
                          return (
                            <tr key={lot.id} className="border-b border-[var(--tblr-border)] last:border-0">
                              <td className="py-2 pr-2">
                                <div className="font-semibold text-[var(--tblr-text)]">{lot.contact_name?.split(' - ')[0]}</div>
                                <div className="text-xs text-[var(--tblr-muted)]">{lot.lot_title}</div>
                              </td>
                              <td className="py-2 text-right">
                                <select
                                  className="p-1.5 rounded-lg border border-[var(--tblr-border)] bg-transparent text-xs"
                                  value={row ? (row.present ? 'present' : row.excused ? 'excused' : 'absent') : 'present'}
                                  onChange={e => {
                                    if (idx < 0) { ensureAttendanceRow(lot); return; }
                                    const v = e.target.value;
                                    setAttendance(idx, { present: v === 'present', excused: v === 'excused' });
                                  }}
                                  onFocus={() => { if (idx < 0) ensureAttendanceRow(lot); }}
                                >
                                  <option value="present">Présent</option>
                                  <option value="absent">Absent</option>
                                  <option value="excused">Excusé</option>
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Section>

                  {/* Observations par lot */}
                  <Section
                    title="Observations par lot"
                    icon={IconClipboardList}
                    action={
                      <button onClick={() => addObservation('observation')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all">
                        <IconPlus size={14} /> Ajouter une observation
                      </button>
                    }
                  >
                    {observationsByLot.length === 0 && (
                      <p className="text-sm text-[var(--tblr-muted)] italic py-4 text-center">Aucune observation pour ce compte-rendu.</p>
                    )}
                    <div className="space-y-4">
                      {observationsByLot.map(group => (
                        <div key={group.title}>
                          <div className="flex items-center gap-2 text-sm font-bold text-[var(--tblr-text)] mb-2">
                            {group.title} {group.entreprise && <span className="text-xs font-normal text-[var(--tblr-muted)]">{group.entreprise}</span>}
                          </div>
                          <div className="space-y-1.5">
                            {group.items.map(o => (
                              <ObservationRow key={o.id} obs={o} onSave={saveObservationField} onUploadPhoto={uploadObservationPhoto} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>

                  {/* Décisions de la maîtrise d'œuvre */}
                  <Section
                    title="Décisions de la maîtrise d'œuvre"
                    action={
                      <button onClick={addDecision}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold transition-all">
                        <IconPlus size={14} /> Ajouter
                      </button>
                    }
                  >
                    {(selectedReport.decisions || []).length === 0 && (
                      <p className="text-sm text-[var(--tblr-muted)] italic py-2 text-center">Aucune décision consignée.</p>
                    )}
                    <div className="space-y-2">
                      {(selectedReport.decisions || []).map((d, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-[var(--tblr-surface-2)]">
                          <input className="flex-1 bg-transparent border-none outline-none text-sm"
                            placeholder="Décision..." value={d.texte} onChange={e => updateDecision(i, { texte: e.target.value })} />
                          <select className="text-[10px] font-bold uppercase px-2 py-1 rounded-full border-none bg-zinc-200 dark:bg-zinc-700"
                            value={d.tag} onChange={e => updateDecision(i, { tag: e.target.value as any })}>
                            <option value="planning">Planning</option>
                            <option value="technique">Technique</option>
                            <option value="financier">Financier</option>
                          </select>
                          <button onClick={() => removeDecision(i)} className="text-zinc-300 hover:text-red-500"><IconTrash size={15} /></button>
                        </div>
                      ))}
                    </div>
                  </Section>

                  {/* Reportage photo */}
                  <Section title="Reportage photo" icon={IconCamera}>
                    {(() => {
                      const photos = reportObservations.flatMap(o => o.photos || []);
                      if (photos.length === 0) return <p className="text-sm text-[var(--tblr-muted)] italic py-2 text-center">Aucune photo pour ce compte-rendu.</p>;
                      return (
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                          {photos.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                              <img src={url} alt="" className="w-full h-full object-cover" />
                            </a>
                          ))}
                        </div>
                      );
                    })()}
                  </Section>
                </div>
              ) : (
                <div className="rounded-xl p-10 text-center text-[var(--tblr-muted)] italic" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                  Sélectionnez ou créez un compte-rendu.
                </div>
              )}
            </div>
          )}

          {activeTab === 'reserves' && (
            <ObservationsTable projectId={project.id} lots={lots_list} typeFilter="reserve" />
          )}

          {activeTab === 'entreprises' && <EntreprisesTab lots_list={lots_list} observations={allObservations} />}

          {activeTab === 'os' && osSituationsContent}

          {activeTab === 'photos' && <PhotosTab observations={allObservations} reports={reports} />}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-2">Dernier CR diffusé</p>
            {dernierCrDiffuse ? (
              <p className="text-sm text-[var(--tblr-text)]">CR n° {dernierCrDiffuse.report_number} — {dernierCrDiffuse.date}</p>
            ) : (
              <p className="text-sm text-[var(--tblr-muted)] italic">Aucun CR diffusé pour l'instant.</p>
            )}
          </div>
          <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-3">Avancement DET</p>
            <p className="text-3xl font-bold text-[var(--tblr-text)]">{avancementDet} %</p>
            <div className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-blue-600" style={{ width: `${avancementDet}%` }} />
            </div>
            <ul className="mt-4 space-y-1.5 text-sm text-[var(--tblr-muted)]">
              <li className="flex justify-between"><span>Comptes-rendus</span><span className="font-semibold text-[var(--tblr-text)]">{reports.length}</span></li>
              <li className="flex justify-between"><span>CR diffusés</span><span className="font-semibold text-[var(--tblr-text)]">{crDiffuses}</span></li>
              <li className="flex justify-between"><span>OS émis</span><span className="font-semibold text-[var(--tblr-text)]">{osEmisTravaux}</span></li>
            </ul>
          </div>
          <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-2">
              Réserves ouvertes <span className="text-red-600 dark:text-red-400">{reservesOuvertes.length}</span>
            </p>
            {reservesOuvertes.length === 0 ? (
              <p className="text-sm text-[var(--tblr-muted)] italic">Aucune réserve ouverte.</p>
            ) : (
              <div className="space-y-2">
                {reservesOuvertes.slice(0, 5).map(o => (
                  <div key={o.id} className="border-l-2 border-red-500 pl-2">
                    <p className="text-xs text-[var(--tblr-text)] line-clamp-2">{o.texte}</p>
                    {o.due_date && <p className="text-[10px] text-red-500 font-semibold">échéance {o.due_date}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-2">Entreprises sur site</p>
            <div className="space-y-1.5 text-sm">
              {lots_list.slice(0, 6).map(lot => (
                <div key={lot.id} className="flex justify-between text-[var(--tblr-text)]">
                  <span className="truncate">{lot.contact_name?.split(' - ')[0] || lot.lot_title}</span>
                  <span className="text-[var(--tblr-muted)] text-xs">{lot.lot_number}</span>
                </div>
              ))}
              {lots_list.length === 0 && <p className="text-[var(--tblr-muted)] italic">Aucun lot renseigné.</p>}
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-2">Intempéries cumulées</p>
            <p className="text-2xl font-bold text-[var(--tblr-text)]">{intemperies} <span className="text-sm font-normal text-[var(--tblr-muted)]">j</span></p>
            <p className="text-xs text-[var(--tblr-muted)] mt-1">Comptes-rendus signalant une météo défavorable.</p>
          </div>
        </div>
      </div>

      {/* New CR modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setIsModalOpen(false)}>
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4 dark:text-white">Nouveau compte-rendu</h3>
            <label className="block text-sm font-bold mb-1 dark:text-zinc-300">Date de la visite</label>
            <input type="date" className="w-full p-2 border rounded-lg mb-4 dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              value={newReportDate} onChange={e => setNewReportDate(e.target.value)} />
            {project.address && (
              <div className="mb-4 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm">
                {weatherLoading ? 'Récupération météo...' : fetchedWeather ? `${fetchedWeather.meteo} — ${fetchedWeather.temperature}°C` : 'Météo indisponible'}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-semibold dark:text-zinc-300">Annuler</button>
              <button
                onClick={() => handleCreateReport()}
                disabled={weatherLoading}
                title={weatherLoading ? 'Récupération de la météo en cours...' : undefined}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-bold"
              >
                Créer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">{label}</p>
      <p className={cn('text-xl font-bold', accent ? 'text-red-600 dark:text-red-400' : 'text-[var(--tblr-text)]')}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--tblr-surface-2)] p-2.5 text-center">
      <p className="text-lg font-bold text-[var(--tblr-text)]">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-[var(--tblr-muted)]">{label}</p>
    </div>
  );
}

function Section({ title, icon: Icon, action, children }: { title: string; icon?: any; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4 sm:p-5" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 text-sm font-bold text-[var(--tblr-text)]">
          {Icon && <Icon size={18} />} {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function ObservationRow({ obs, onSave, onUploadPhoto }: { obs: Observation; onSave: (id: string, field: string, value: any) => void; onUploadPhoto: (id: string, file: File) => void }) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-start gap-2 p-2 rounded-lg bg-[var(--tblr-surface-2)] group">
      <select
        className={cn('shrink-0 text-[9px] font-bold uppercase px-1.5 py-1 rounded border-none cursor-pointer', TYPE_COLORS[obs.type || 'observation'])}
        value={obs.type || 'observation'}
        onChange={e => onSave(obs.id, 'type', e.target.value)}
      >
        {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input
        className="flex-1 bg-transparent border-none outline-none text-sm min-w-[120px]"
        defaultValue={obs.texte}
        placeholder="Description..."
        onBlur={e => onSave(obs.id, 'texte', e.target.value)}
      />
      {obs.urgence === 'bloquant' && (
        <span className="shrink-0 text-[9px] font-bold uppercase px-1.5 py-1 rounded bg-red-600 text-white">{URGENCE_LABELS.bloquant}</span>
      )}
      <select
        className="shrink-0 text-[10px] px-1.5 py-1 rounded border border-[var(--tblr-border)] bg-transparent"
        value={obs.urgence || 'normal'}
        onChange={e => onSave(obs.id, 'urgence', e.target.value)}
      >
        <option value="normal">Normal</option>
        <option value="urgent">Urgent</option>
        <option value="bloquant">Bloquant</option>
      </select>
      <input type="date" className="shrink-0 text-xs bg-transparent border-none outline-none w-28"
        defaultValue={obs.due_date || ''} onBlur={e => onSave(obs.id, 'due_date', e.target.value)} />
      <button onClick={() => fileInputRef.current?.click()} className="shrink-0 p-1 text-zinc-400 hover:text-blue-500" title="Ajouter une photo">
        <IconCamera size={16} />
      </button>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUploadPhoto(obs.id, f); e.target.value = ''; }} />
      {(obs.photos || []).length > 0 && (
        <span className="shrink-0 text-[10px] text-[var(--tblr-muted)]">{obs.photos!.length} 📷</span>
      )}
    </div>
  );
}

function EntreprisesTab({ lots_list, observations }: { lots_list: ProjectLot[]; observations: Observation[] }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
      <table className="w-full text-sm">
        <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[10px] tracking-wider">
          <tr>
            <th className="px-4 py-3 text-left">Lot</th>
            <th className="px-4 py-3 text-left">Entreprise</th>
            <th className="px-4 py-3 text-center">Observations</th>
            <th className="px-4 py-3 text-center">Réserves ouvertes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--tblr-border)]">
          {lots_list.map(lot => {
            const lotObs = observations.filter(o => o.lot_id === lot.id);
            const openReserves = lotObs.filter(o => o.type === 'reserve' && o.statut !== 'Levée').length;
            return (
              <tr key={lot.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors">
                <td className="px-4 py-3 font-semibold text-[var(--tblr-text)]">{lot.lot_number} — {lot.lot_title}</td>
                <td className="px-4 py-3 text-[var(--tblr-muted)]">{lot.contact_name || '—'}</td>
                <td className="px-4 py-3 text-center">{lotObs.length}</td>
                <td className="px-4 py-3 text-center">
                  {openReserves > 0 ? <span className="text-red-600 dark:text-red-400 font-bold">{openReserves}</span> : '—'}
                </td>
              </tr>
            );
          })}
          {lots_list.length === 0 && (
            <tr><td colSpan={4} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucun lot renseigné pour ce projet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PhotosTab({ observations, reports }: { observations: Observation[]; reports: SiteReport[] }) {
  const items = observations.flatMap(o =>
    (o.photos || []).map(url => ({ url, obs: o, report: reports.find(r => r.id === o.created_report_id) }))
  );
  if (items.length === 0) {
    return <p className="text-sm text-[var(--tblr-muted)] italic py-8 text-center">Aucune photo pour ce projet.</p>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {items.map((item, i) => (
        <a key={i} href={item.url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }}>
          <div className="aspect-square bg-zinc-100 dark:bg-zinc-800">
            <img src={item.url} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="p-2 text-[10px] text-[var(--tblr-muted)] truncate">
            {item.report ? `CR ${item.report.report_number}` : ''} {item.obs.lot?.lot_title || ''}
          </div>
        </a>
      ))}
    </div>
  );
}
