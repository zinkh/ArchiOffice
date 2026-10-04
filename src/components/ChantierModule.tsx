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
import { SignedImage } from './SignedImage';
import { openSignedUrl } from '../lib/signedStorageUrl';
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
  const modalTriggerRef = React.useRef<HTMLButtonElement>(null);
  const modalDateRef = React.useRef<HTMLInputElement>(null);
  const observationFetchRef = React.useRef(0);

  const [reports, setReports] = useState<SiteReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsLoadError, setReportsLoadError] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reportObservations, setReportObservations] = useState<Observation[]>([]);
  const [reportObservationsLoading, setReportObservationsLoading] = useState(true);
  const [reportObservationsLoadError, setReportObservationsLoadError] = useState(false);
  const [allObservations, setAllObservations] = useState<Observation[]>([]);
  const [overviewLoadError, setOverviewLoadError] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreatingReport, setIsCreatingReport] = useState(false);
  const [reportCreateError, setReportCreateError] = useState(false);
  const [reportSaveError, setReportSaveError] = useState(false);
  const [isAddingObservation, setIsAddingObservation] = useState(false);
  const [observationCreateError, setObservationCreateError] = useState(false);
  const [uploadingObservationId, setUploadingObservationId] = useState<string | null>(null);
  const [photoUploadError, setPhotoUploadError] = useState(false);
  const [newReportDate, setNewReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherRefreshError, setWeatherRefreshError] = useState(false);
  const [fetchedWeather, setFetchedWeather] = useState<{ meteo: string; temperature: number | null } | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (!isModalOpen) return;
    modalDateRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsModalOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      modalTriggerRef.current?.focus();
    };
  }, [isModalOpen]);

  const selectedReport = useMemo(
    () => reports.find(r => r.id === selectedReportId) || null,
    [reports, selectedReportId]
  );

  const fetchReports = useCallback(async () => {
    setReportsLoading(true);
    setReportsLoadError(false);
    try {
      const res = await fetch(`/api/projects/${project.id}/reports`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Unexpected response shape');
      setReports(data);
      if (data.length > 0 && !selectedReportId) setSelectedReportId(data[0].id);
      return true;
    } catch (err) {
      console.error('Failed to load site reports:', err);
      setReportsLoadError(true);
      return false;
    } finally {
      setReportsLoading(false);
    }
  }, [project.id, selectedReportId]);

  const fetchReportObservations = useCallback(async () => {
    const requestId = ++observationFetchRef.current;
    if (!selectedReportId) {
      setReportObservations([]);
      setReportObservationsLoading(false);
      setReportObservationsLoadError(false);
      return true;
    }
    setReportObservationsLoading(true);
    setReportObservationsLoadError(false);
    setReportObservations([]);
    try {
      const res = await fetch(`/api/reports/${selectedReportId}/observations`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Unexpected response shape');
      if (requestId !== observationFetchRef.current) return false;
      setReportObservations(data);
      setReportObservationsLoadError(false);
      return true;
    } catch (err) {
      console.error('Failed to reload report observations:', err);
      if (requestId === observationFetchRef.current) setReportObservationsLoadError(true);
      return false;
    } finally {
      if (requestId === observationFetchRef.current) setReportObservationsLoading(false);
    }
  }, [selectedReportId]);

  const fetchAllObservations = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/observations`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Unexpected response shape');
      setAllObservations(data);
      setOverviewLoadError(false);
    } catch (err) {
      console.error('Failed to load project observations:', err);
      setOverviewLoadError(true);
    }
  }, [project.id]);

  useEffect(() => { fetchReports(); }, [fetchReports]);
  useEffect(() => { fetchReportObservations(); }, [fetchReportObservations]);
  useEffect(() => { fetchAllObservations(); }, [fetchAllObservations]);

  useEffect(() => {
    if (!isModalOpen || !project.address) return;
    const controller = new AbortController();
    setWeatherLoading(true);
    setFetchedWeather(null);
    const loadWeather = async () => {
      try {
        const res = await fetch(`/api/weather?q=${encodeURIComponent(project.address)}&date=${newReportDate}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setFetchedWeather(await res.json());
      } catch (err) {
        if (!controller.signal.aborted) console.error('Failed to fetch weather:', err);
      } finally {
        if (!controller.signal.aborted) setWeatherLoading(false);
      }
    };
    loadWeather();
    return () => controller.abort();
  }, [isModalOpen, newReportDate, project.address]);

  const handleCreateReport = async (duplicateFrom?: SiteReport) => {
    if (isCreatingReport) return;
    setIsCreatingReport(true);
    setReportCreateError(false);
    const report_number = reports.length + 1;
    const reportData = {
      date: duplicateFrom ? duplicateFrom.date : newReportDate,
      report_number,
      meteo: duplicateFrom ? duplicateFrom.meteo : (fetchedWeather?.meteo || 'Inconnu'),
      temperature: duplicateFrom ? duplicateFrom.temperature : fetchedWeather?.temperature,
      effectif_total: 0,
    };
    try {
      const res = await fetch(`/api/projects/${project.id}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (!result?.id) throw new Error('The report response did not include an id');
      const newReport: SiteReport = { ...reportData, id: result.id, project_id: project.id };
      setReports(prev => [newReport, ...prev]);
      setSelectedReportId(newReport.id);
      setIsModalOpen(false);
      setFetchedWeather(null);
    } catch (err) {
      console.error('Failed to create site report:', err);
      setReportCreateError(true);
    } finally {
      setIsCreatingReport(false);
    }
  };

  const refreshWeather = async (report: SiteReport) => {
    if (!project.address) return;
    setWeatherLoading(true);
    setWeatherRefreshError(false);
    try {
      const res = await fetch(`/api/weather?q=${encodeURIComponent(project.address)}&date=${report.date}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const updated = { ...report, meteo: data.meteo, temperature: data.temperature };
      const saveRes = await fetch(`/api/reports/${report.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!saveRes.ok) throw new Error(`HTTP ${saveRes.status}`);
      const saved = await saveRes.json();
      setReports(prev => prev.map(r => (r.id === saved.id ? saved : r)));
    } catch (err) {
      console.error('Failed to refresh weather:', err);
      setWeatherRefreshError(true);
    } finally {
      setWeatherLoading(false);
    }
  };

  const updateReportField = async (field: keyof SiteReport, value: any) => {
    if (!selectedReport) return;
    const previousValue = (selectedReport as any)[field];
    const updated = { ...selectedReport, [field]: value };
    setReports(prev => prev.map(r => (r.id === selectedReport.id ? updated : r)));
    try {
      const res = await fetch(`/api/reports/${selectedReport.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      setReports(prev => prev.map(r => (r.id === saved.id ? saved : r)));
    } catch (err) {
      console.error('Failed to save site report:', err);
      setReports(prev => prev.map(r =>
        r.id === selectedReport.id && Object.is((r as any)[field], value) ? { ...r, [field]: previousValue } : r
      ));
      setReportSaveError(true);
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
    if (!selectedReportId || isAddingObservation || reportObservationsLoading || reportObservationsLoadError) return;
    setIsAddingObservation(true);
    setObservationCreateError(false);
    try {
      const res = await fetch(`/api/projects/${project.id}/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texte: '', statut: 'À faire', type, created_report_id: selectedReportId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const newObs = await res.json();
      setReportObservations(prev => [...prev, newObs]);
      fetchAllObservations();
    } catch (err) {
      console.error('Failed to add observation:', err);
      setObservationCreateError(true);
    } finally {
      setIsAddingObservation(false);
    }
  };

  const saveObservationField = async (obsId: string, field: string, value: any) => {
    const current = reportObservations.find(o => o.id === obsId);
    const previousValue = current ? (current as any)[field] : undefined;
    setReportObservations(prev => prev.map(o => (o.id === obsId ? { ...o, [field]: value } : o)));
    try {
      const res = await fetch(`/api/observations/${obsId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error(err);
      setReportObservations(prev => prev.map(o =>
        o.id === obsId && Object.is((o as any)[field], value) ? { ...o, [field]: previousValue } : o
      ));
      setSaveError(true);
    }
    fetchAllObservations();
  };

  const uploadObservationPhoto = async (obsId: string, file: File) => {
    if (uploadingObservationId) return;
    setUploadingObservationId(obsId);
    setPhotoUploadError(false);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/api/observations/${obsId}/photos`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReportObservations(prev => prev.map(o => (o.id === obsId ? { ...o, photos: data.photos } : o)));
      fetchAllObservations();
    } catch (err) {
      console.error('Failed to upload observation photo:', err);
      setPhotoUploadError(true);
    } finally {
      setUploadingObservationId(null);
    }
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
    { id: 'os', label: 'Ordres de service & situations', icon: IconTools },
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
            ref={modalTriggerRef}
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shrink-0"
          >
            <IconPlus size={16} /> Nouveau compte-rendu
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
          <StatPill label="Réserves levées" value={`${avancementDet} %`} />
          <StatPill label="Comptes-rendus" value={String(reports.length)} />
          <StatPill label="Réserves ouvertes" value={String(reservesOuvertes.length)} accent={reservesOuvertes.length > 0} />
          <StatPill label="Ordres de service émis" value={String(osEmisTravaux)} />
        </div>
      </div>

      {overviewLoadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
          <span>Impossible de charger les données des réserves, lots et photos.</span>
          <button type="button" onClick={fetchAllObservations} className="min-h-10 px-3 font-semibold underline">Réessayer</button>
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" aria-label="Sections du chantier" className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map(tabItem => (
          <button
            key={tabItem.id}
            id={`det-tab-${tabItem.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tabItem.id}
            aria-controls={`det-panel-${tabItem.id}`}
            tabIndex={activeTab === tabItem.id ? 0 : -1}
            onClick={() => setActiveTab(tabItem.id)}
            onKeyDown={event => {
              const currentIndex = tabs.findIndex(item => item.id === tabItem.id);
              const nextIndex = event.key === 'ArrowRight' ? (currentIndex + 1) % tabs.length
                : event.key === 'ArrowLeft' ? (currentIndex - 1 + tabs.length) % tabs.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
              if (nextIndex >= 0) {
                event.preventDefault();
                const nextTab = tabs[nextIndex];
                setActiveTab(nextTab.id);
                document.getElementById(`det-tab-${nextTab.id}`)?.focus();
              }
            }}
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
        <div role="tabpanel" id={`det-panel-${activeTab}`} aria-labelledby={`det-tab-${activeTab}`} tabIndex={0} className="min-w-0">
          {reportCreateError && (
            <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
              Le compte-rendu n’a pas été créé. Réessayez.
            </p>
          )}
          {reportSaveError && (
            <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
              <span>Une modification n’a pas été enregistrée. Rechargez le compte-rendu pour récupérer sa dernière version.</span>
              <button type="button" onClick={async () => { if (await fetchReports()) setReportSaveError(false); }} className="min-h-10 px-2 font-semibold underline">Recharger le compte-rendu</button>
            </div>
          )}
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
                  {reportsLoading && <p role="status" className="p-4 text-sm text-[var(--tblr-muted)] text-center">Chargement des comptes-rendus…</p>}
                  {!reportsLoading && reportsLoadError && (
                    <div className="p-4 text-center">
                      <p role="alert" className="text-sm text-red-700 dark:text-red-300">Impossible de charger les comptes-rendus.</p>
                      <button type="button" onClick={fetchReports} className="mt-2 min-h-10 px-3 text-sm font-semibold text-blue-700 dark:text-blue-300 underline">Réessayer</button>
                    </div>
                  )}
                  {!reportsLoading && !reportsLoadError && reports.length === 0 && (
                    <p className="p-4 text-sm text-[var(--tblr-muted)] italic text-center">Aucun compte-rendu pour ce chantier.</p>
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
                          aria-label="Compte-rendu précédent"
                          className="min-h-11 min-w-11 flex items-center justify-center p-1 text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]"
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
                          aria-label="Compte-rendu suivant"
                          className="min-h-11 min-w-11 flex items-center justify-center p-1 text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]"
                        ><IconChevronRight size={18} /></button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={generatePdf} disabled={isGeneratingPdf}
                          className="flex min-h-10 items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold transition-all">
                          <IconFileDownload size={14} /> Télécharger PDF
                        </button>
                        <button onClick={() => handleCreateReport(selectedReport)} disabled={isCreatingReport}
                          className="flex min-h-10 items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold transition-all">
                          <IconCopy size={14} /> {isCreatingReport ? 'Création…' : 'Dupliquer'}
                        </button>
                        <button onClick={() => updateReportField('statut', 'diffuse')}
                          disabled={selectedReport.statut === 'diffuse'}
                          className="flex min-h-10 items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all">
                          <IconSend size={14} /> Diffuser le compte-rendu
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-sm text-[var(--tblr-muted)]">
                      <span>{selectedReport.date}</span>
                      <span className="flex items-center gap-1"><IconCloud size={14} />
                        <input aria-label="Météo du compte-rendu" className="bg-transparent border-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400 w-28"
                          value={selectedReport.meteo || ''} onChange={e => updateReportField('meteo', e.target.value)} />
                      </span>
                      <span className="flex items-center gap-1"><IconTemperature size={14} />
                        <input aria-label="Température du compte-rendu en degrés Celsius" type="number" className="bg-transparent border-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400 w-14"
                          value={selectedReport.temperature ?? ''} onChange={e => updateReportField('temperature', parseInt(e.target.value) || 0)} />°C
                      </span>
                      {project.address && (
                        <>
                          <button
                            onClick={() => refreshWeather(selectedReport)}
                            disabled={weatherLoading}
                            title="Actualiser la météo pour la date du compte-rendu"
                            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                          >
                            <IconRefresh size={13} className={weatherLoading ? 'animate-spin det-loading-spin' : ''} /> {weatherLoading ? 'Actualisation…' : 'Actualiser la météo'}
                          </button>
                          {weatherRefreshError && <span role="alert" className="text-xs text-red-700 dark:text-red-300">La météo n’a pas été actualisée. Réessayez.</span>}
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                      <MiniStat label="Présents" value={String((selectedReport.attendance || []).filter(a => a.present).length)} />
                        <MiniStat label="Absents ou excusés" value={String((selectedReport.attendance || []).filter(a => !a.present).length)} />
                      <MiniStat label="Observations" value={String(reportObservations.length)} />
                        <MiniStat label="Réserves ouvertes / total" value={`${reportObservations.filter(o => o.type === 'reserve' && o.statut !== 'Levée').length}/${reportObservations.filter(o => o.type === 'reserve').length}`} />
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
                              <td className="py-2 pr-2 min-w-0">
                                <div className="font-semibold text-[var(--tblr-text)] break-words">{lot.contact_name?.split(' - ')[0]}</div>
                                <div className="text-xs text-[var(--tblr-muted)]">{lot.lot_title}</div>
                              </td>
                              <td className="py-2 text-right">
                                <select
                                  aria-label={`Présence de ${lot.contact_name?.split(' - ')[0] || lot.lot_title}`}
                                  className="min-h-11 max-w-full p-2 rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-xs"
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
                      <button onClick={() => addObservation('observation')} disabled={isAddingObservation || reportObservationsLoading || reportObservationsLoadError}
                        className="flex min-h-10 items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all">
                        <IconPlus size={14} /> {isAddingObservation ? 'Ajout…' : 'Ajouter une observation'}
                      </button>
                    }
                  >
                    {saveError && (
                      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
                        <span>L’enregistrement a échoué. Rechargez les observations pour retrouver la dernière version enregistrée avant de continuer.</span>
                        <button
                          onClick={async () => { if (await fetchReportObservations()) setSaveError(false); }}
                          className="shrink-0 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold transition-all"
                        >
                          Recharger les observations
                        </button>
                      </div>
                    )}
                    {observationCreateError && (
                      <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
                        L’observation n’a pas été ajoutée. Réessayez.
                      </p>
                    )}
                    {photoUploadError && (
                      <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
                        La photo n’a pas été envoyée. Réessayez.
                      </p>
                    )}
                    {reportObservationsLoading && <p role="status" className="text-sm text-[var(--tblr-muted)] italic py-4 text-center">Chargement des observations…</p>}
                    {!reportObservationsLoading && reportObservationsLoadError && (
                      <div className="py-4 text-center">
                        <p role="alert" className="text-sm text-red-700 dark:text-red-300">Impossible de charger les observations de ce compte-rendu.</p>
                        <button type="button" onClick={fetchReportObservations} className="mt-2 min-h-10 px-3 text-sm font-semibold text-blue-700 dark:text-blue-300 underline">Recharger les observations</button>
                      </div>
                    )}
                    {!reportObservationsLoading && !reportObservationsLoadError && observationsByLot.length === 0 && (
                      <p className="text-sm text-[var(--tblr-muted)] italic py-4 text-center">Aucune observation pour ce compte-rendu.</p>
                    )}
                    {!reportObservationsLoading && !reportObservationsLoadError && <div className="space-y-4">
                      {observationsByLot.map(group => (
                        <div key={group.title}>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-bold text-[var(--tblr-text)] mb-2 break-words">
                            {group.title} {group.entreprise && <span className="text-xs font-normal text-[var(--tblr-muted)] break-words">{group.entreprise}</span>}
                          </div>
                          <div className="space-y-1.5">
                            {group.items.map(o => (
                              <ObservationRow key={o.id} obs={o} onSave={saveObservationField} onUploadPhoto={uploadObservationPhoto} isUploading={uploadingObservationId === o.id} uploadDisabled={uploadingObservationId !== null} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>}
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
                        <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded-lg bg-[var(--tblr-surface-2)]">
                          <input aria-label="Décision" className="w-full sm:flex-1 min-w-0 min-h-11 bg-transparent border-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400 text-sm"
                            placeholder="Décision..." value={d.texte} onChange={e => updateDecision(i, { texte: e.target.value })} />
                          <select aria-label="Catégorie de la décision" className="min-h-11 text-xs font-bold uppercase px-3 rounded-lg border-none bg-zinc-200 dark:bg-zinc-700"
                            value={d.tag} onChange={e => updateDecision(i, { tag: e.target.value as any })}>
                            <option value="planning">Planning</option>
                            <option value="technique">Technique</option>
                            <option value="financier">Financier</option>
                          </select>
                          <button type="button" onClick={() => removeDecision(i)} aria-label="Supprimer la décision" className="min-h-11 min-w-11 flex items-center justify-center self-end sm:self-auto text-zinc-400 hover:text-red-500"><IconTrash size={15} /></button>
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
                            <SignedPhotoButton
                              key={i}
                              src={url}
                              label={`Ouvrir la photo ${i + 1} du compte-rendu n° ${selectedReport.report_number}`}
                              className="block aspect-square rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800"
                              frameClassName="h-full w-full"
                              imageClassName="w-full h-full object-cover"
                            />
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
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-2">Dernier compte-rendu diffusé</p>
            {dernierCrDiffuse ? (
              <p className="text-sm text-[var(--tblr-text)]">N° {dernierCrDiffuse.report_number} — {dernierCrDiffuse.date}</p>
            ) : (
              <p className="text-sm text-[var(--tblr-muted)] italic">Aucun compte-rendu diffusé pour l’instant.</p>
            )}
          </div>
          <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-3">Levée des réserves</p>
            <p className="text-3xl font-bold text-[var(--tblr-text)]">{avancementDet} %</p>
            <div role="progressbar" aria-label="Pourcentage de réserves levées" aria-valuemin={0} aria-valuemax={100} aria-valuenow={avancementDet} className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-blue-600" style={{ width: `${avancementDet}%` }} />
            </div>
            <ul className="mt-4 space-y-1.5 text-sm text-[var(--tblr-muted)]">
              <li className="flex justify-between"><span>Comptes-rendus</span><span className="font-semibold text-[var(--tblr-text)]">{reports.length}</span></li>
              <li className="flex justify-between"><span>Comptes-rendus diffusés</span><span className="font-semibold text-[var(--tblr-text)]">{crDiffuses}</span></li>
              <li className="flex justify-between"><span>Ordres de service émis</span><span className="font-semibold text-[var(--tblr-text)]">{osEmisTravaux}</span></li>
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
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-2">Lots et entreprises</p>
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
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-2">Comptes-rendus avec intempéries</p>
            <p className="text-2xl font-bold text-[var(--tblr-text)]">{intemperies}</p>
            <p className="text-xs text-[var(--tblr-muted)] mt-1">Comptes-rendus signalant une météo défavorable.</p>
          </div>
        </div>
      </div>

      {/* New CR modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setIsModalOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="new-report-title" onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }} className="bg-white dark:bg-zinc-900 p-6 rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 id="new-report-title" className="text-lg font-bold mb-4 dark:text-white">Nouveau compte-rendu</h3>
            <label htmlFor="new-report-date" className="block text-sm font-bold mb-1 dark:text-zinc-300">Date de la visite</label>
            <input id="new-report-date" ref={modalDateRef} type="date" className="w-full p-2 border rounded-lg mb-4 dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              value={newReportDate} onChange={e => setNewReportDate(e.target.value)} />
            {project.address && (
              <div className="mb-4 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm">
                {weatherLoading ? 'Récupération météo...' : fetchedWeather ? `${fetchedWeather.meteo} — ${fetchedWeather.temperature}°C` : 'Météo indisponible'}
              </div>
            )}
          <div className="flex flex-wrap items-center justify-end gap-2">
              {reportCreateError && (
                <p role="alert" className="mr-auto self-center text-sm text-red-700 dark:text-red-300">
                  Le compte-rendu n’a pas été créé. Réessayez.
                </p>
              )}
              <button onClick={() => setIsModalOpen(false)} disabled={isCreatingReport} className="px-4 py-2 text-sm font-semibold dark:text-zinc-300">Annuler</button>
              <button
                onClick={() => handleCreateReport()}
                disabled={weatherLoading || isCreatingReport}
                title={weatherLoading ? 'Récupération de la météo en cours...' : undefined}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-bold"
              >
                {isCreatingReport ? 'Création…' : 'Créer'}
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
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 text-sm font-bold text-[var(--tblr-text)]">
          {Icon && <Icon size={18} />} {title}
        </div>
        {action && <div className="max-w-full">{action}</div>}
      </div>
      {children}
    </div>
  );
}

function ObservationRow({ obs, onSave, onUploadPhoto, isUploading, uploadDisabled }: { obs: Observation; onSave: (id: string, field: string, value: any) => void; onUploadPhoto: (id: string, file: File) => void; isUploading: boolean; uploadDisabled: boolean }) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [draftText, setDraftText] = React.useState(obs.texte || '');
  const [draftDueDate, setDraftDueDate] = React.useState(obs.due_date || '');

  React.useEffect(() => setDraftText(obs.texte || ''), [obs.texte]);
  React.useEffect(() => setDraftDueDate(obs.due_date || ''), [obs.due_date]);

  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 p-2 rounded-lg bg-[var(--tblr-surface-2)] group">
      <select
        aria-label="Type d’observation"
        className={cn('shrink-0 min-h-11 px-2 text-[10px] font-bold uppercase rounded border-none cursor-pointer', TYPE_COLORS[obs.type || 'observation'])}
        value={obs.type || 'observation'}
        onChange={e => onSave(obs.id, 'type', e.target.value)}
      >
        {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input
        aria-label="Description de l’observation"
        className="w-full sm:flex-1 sm:min-w-[120px] min-w-0 min-h-11 bg-transparent border-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400 text-sm"
        value={draftText}
        placeholder="Description..."
        onChange={e => setDraftText(e.target.value)}
        onBlur={() => onSave(obs.id, 'texte', draftText)}
      />
      {obs.urgence === 'bloquant' && (
        <span className="shrink-0 text-[9px] font-bold uppercase px-1.5 py-1 rounded bg-red-600 text-white">{URGENCE_LABELS.bloquant}</span>
      )}
      <select
        aria-label="Niveau d’urgence"
        className="shrink-0 min-h-11 px-2 text-xs rounded border border-[var(--tblr-border)] bg-transparent"
        value={obs.urgence || 'normal'}
        onChange={e => onSave(obs.id, 'urgence', e.target.value)}
      >
        <option value="normal">Normal</option>
        <option value="urgent">Urgent</option>
        <option value="bloquant">Bloquant</option>
      </select>
      <input aria-label="Échéance de l’observation" type="date" className="shrink-0 min-h-11 text-xs bg-transparent border-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400 w-36"
        value={draftDueDate} onChange={e => setDraftDueDate(e.target.value)} onBlur={() => onSave(obs.id, 'due_date', draftDueDate)} />
      <button type="button" disabled={uploadDisabled} onClick={() => fileInputRef.current?.click()} className="shrink-0 min-h-11 min-w-11 flex items-center justify-center p-1 text-zinc-400 hover:text-blue-500 disabled:opacity-50" aria-label={isUploading ? 'Envoi de la photo en cours' : 'Ajouter une photo à l’observation'} title={isUploading ? 'Envoi en cours…' : uploadDisabled ? 'Un envoi est déjà en cours' : 'Ajouter une photo'}>
        {isUploading ? <IconRefresh size={16} className="animate-spin det-loading-spin" /> : <IconCamera size={16} />}
      </button>
      {isUploading && <span role="status" className="sr-only">Envoi de la photo en cours</span>}
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUploadPhoto(obs.id, f); e.target.value = ''; }} />
      {(obs.photos || []).length > 0 && (
        <span className="shrink-0 text-xs text-[var(--tblr-muted)]">{obs.photos!.length} photo{obs.photos!.length > 1 ? 's' : ''}</span>
      )}
    </div>
  );
}

function EntreprisesTab({ lots_list, observations }: { lots_list: ProjectLot[]; observations: Observation[] }) {
  return (
    <div className="min-w-0 rounded-xl" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
      <div role="region" aria-label="Entreprises par lot" tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400">
      <p className="px-4 pt-3 text-xs text-[var(--tblr-muted)] sm:hidden">Faites défiler horizontalement pour voir toutes les colonnes.</p>
      <table className="w-full min-w-[40rem] text-sm">
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
        <SignedPhotoButton
          key={i}
          src={item.url}
          label={`Ouvrir la photo ${i + 1}${item.report ? ` du compte-rendu n° ${item.report.report_number}` : ''}${item.obs.lot?.lot_title ? ` — ${item.obs.lot.lot_title}` : ''}`}
          className="block text-left rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--tblr-border)' }}
          frameClassName="aspect-square bg-zinc-100 dark:bg-zinc-800"
          imageClassName="w-full h-full object-cover"
          caption={item.report ? `CR ${item.report.report_number} ${item.obs.lot?.lot_title || ''}` : (item.obs.lot?.lot_title || '')}
        />
      ))}
    </div>
  );
}

function SignedPhotoButton({
  src,
  label,
  className,
  style,
  frameClassName,
  imageClassName,
  caption,
}: {
  src: string;
  label: string;
  className: string;
  style?: React.CSSProperties;
  frameClassName: string;
  imageClassName: string;
  caption?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const handleClick = () => {
    if (failed) {
      setFailed(false);
      setAttempt(current => current + 1);
      return;
    }
    openSignedUrl(src);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={failed ? `${label} — photo indisponible. Réessayer.` : label}
      className={className}
      style={style}
    >
      <div className={frameClassName}>
        {failed ? (
          <div role="status" className="flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center text-xs text-[var(--tblr-muted)]">
            <IconPhoto size={20} aria-hidden="true" />
            <span>Photo indisponible</span>
            <span className="font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300">Réessayer</span>
          </div>
        ) : (
          <SignedImage
            key={attempt}
            src={src}
            alt=""
            deferUntilVisible
            onLoadError={() => setFailed(true)}
            className={imageClassName}
          />
        )}
      </div>
      {caption && <div className="truncate p-2 text-[10px] text-[var(--tblr-muted)]">{caption}</div>}
    </button>
  );
}

