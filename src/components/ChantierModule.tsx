import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  IconPlus, IconFileDownload, IconCopy, IconSend, IconCloud, IconTemperature,
  IconUsers, IconChevronLeft, IconChevronRight, IconTrash, IconCamera,
  IconBuilding, IconTools, IconPhoto, IconClipboardList, IconAlertTriangle,
  IconRefresh, IconListDetails,
} from '@tabler/icons-react';
import { Project, ProjectLot, SiteReport, SiteReportNote, SiteReportAttendee, SiteReportLotTracking, PresenceStatus, Observation, OrdreDeService, Contact } from '../types';
import ObservationsTable from './ObservationsTable';
import { SignedImage } from './SignedImage';
import { openSignedUrl } from '../lib/signedStorageUrl';
import { queuedJsonRequest, queuedMultipartRequest, OFFLINE_WRITE_SYNCED_EVENT } from '../lib/offlineQueue';
import { cachedListFirst } from '../lib/offlineReadCache';
import { db } from '../db';
import { cn } from '../lib/utils';
import type { AgencySettings } from '../lib/proposalExport';

interface ChantierModuleProps {
  project: Project;
  lots_list: ProjectLot[];
  ordresDeService: OrdreDeService[];
  osSituationsContent: React.ReactNode;
  contacts: Contact[];
  settings?: AgencySettings | null;
}

const PRESENCE_LABELS: Record<PresenceStatus, string> = { P: 'Présent', R: 'Retard', AE: 'Absent excusé', ANE: 'Absent non excusé' };

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

export default function ChantierModule({ project, lots_list, ordresDeService, osSituationsContent, contacts, settings }: ChantierModuleProps) {
  const [activeTab, setActiveTab] = useState<ChantierTab>('comptes-rendus');

  const [reports, setReports] = useState<SiteReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reportObservations, setReportObservations] = useState<Observation[]>([]);
  const [allObservations, setAllObservations] = useState<Observation[]>([]);
  const [reportNotes, setReportNotes] = useState<SiteReportNote[]>([]);
  const [newRubriqueName, setNewRubriqueName] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newReportDate, setNewReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [fetchedWeather, setFetchedWeather] = useState<{ meteo: string; temperature: number | null } | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [saveError, setSaveError] = useState(false);

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

  // Cache d'abord (src/lib/offlineReadCache.ts) : hors-ligne, les
  // observations déjà consultées pour ce compte rendu/cette affaire restent
  // affichées plutôt que de disparaître.
  const fetchReportObservations = useCallback(async () => {
    if (!selectedReportId) { setReportObservations([]); return; }
    await cachedListFirst(
      db.observationsCache,
      o => (o.report_ids || []).includes(selectedReportId),
      `/api/reports/${selectedReportId}/observations`,
      setReportObservations,
    );
  }, [selectedReportId]);

  const fetchAllObservations = useCallback(async () => {
    await cachedListFirst(
      db.observationsCache,
      o => o.project_id === project.id,
      `/api/projects/${project.id}/observations`,
      setAllObservations,
    );
  }, [project.id]);

  const fetchReportNotes = useCallback(async () => {
    if (!selectedReportId) { setReportNotes([]); return; }
    const res = await fetch(`/api/reports/${selectedReportId}/notes`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data)) setReportNotes(data);
  }, [selectedReportId]);

  useEffect(() => { fetchReports(); }, [fetchReports]);
  useEffect(() => { fetchReportObservations(); }, [fetchReportObservations]);
  useEffect(() => { fetchAllObservations(); }, [fetchAllObservations]);
  useEffect(() => { fetchReportNotes(); }, [fetchReportNotes]);

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
    // Id généré côté client : une création rejouée après coupure réseau
    // (file de synchro hors-ligne, src/lib/offlineQueue.ts) ne crée jamais
    // deux comptes-rendus. Le numéro exact (calculé côté serveur à partir
    // des comptes-rendus existants) n'est connu qu'une fois la requête
    // effectivement traitée — hors ligne, une valeur provisoire est
    // affichée en attendant, corrigée au retour du réseau (voir l'écoute de
    // OFFLINE_WRITE_SYNCED_EVENT ci-dessous).
    const id = crypto.randomUUID();
    const body = {
      id,
      date: duplicateFrom ? duplicateFrom.date : newReportDate,
      meteo: duplicateFrom ? duplicateFrom.meteo : (fetchedWeather?.meteo || 'Inconnu'),
      temperature: duplicateFrom ? duplicateFrom.temperature : (fetchedWeather?.temperature || 0),
      effectif_total: 0,
    };
    try {
      const { queued, data } = await queuedJsonRequest<{ id: string; report_number: number }>({
        entity: 'siteReport', id, method: 'POST', url: `/api/projects/${project.id}/reports`, body,
      });
      const provisionalNumber = Math.max(0, ...reports.map(r => r.report_number || 0)) + 1;
      const newReport: SiteReport = {
        ...body,
        project_id: project.id,
        report_number: queued ? provisionalNumber : data!.report_number,
        pendingSync: queued,
      };
      setReports(prev => [newReport, ...prev]);
      setSelectedReportId(newReport.id);
      setIsModalOpen(false);
      setFetchedWeather(null);
    } catch (err) { console.error(err); }
  };

  // Lève le badge « en attente » d'un compte-rendu et recale son numéro
  // (attribué par le serveur, jamais connu avec certitude hors ligne) dès
  // que sa création a effectivement atteint le serveur.
  useEffect(() => {
    const onSynced = (e: Event) => {
      const { entity } = (e as CustomEvent).detail || {};
      if (entity !== 'siteReport') return;
      fetchReports().catch(() => {});
    };
    window.addEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
  }, [fetchReports]);

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

  const setAttendance = (index: number, patch: Partial<SiteReportAttendee>) => {
    const list = [...(selectedReport?.attendance || [])];
    list[index] = { ...list[index], ...patch };
    updateReportField('attendance', list);
  };

  const setAttendanceStatus = (index: number, status: PresenceStatus) => {
    setAttendance(index, { status, present: status === 'P' || status === 'R', excused: status === 'AE' });
  };

  const ensureAttendanceRow = (lot: ProjectLot) => {
    const list = selectedReport?.attendance || [];
    if (list.some(a => a.role === lot.lot_title)) return;
    const name = lot.contact_name?.split(' - ')[1] || lot.contact_name?.split(' - ')[0] || '';
    updateReportField('attendance', [...list, { name, role: lot.lot_title, present: true, status: 'P' as PresenceStatus }]);
  };

  // Présence des intervenants du projet (MOA/AMO/MOE/CT/CSPS...), distincte
  // de la présence des lots ci-dessus : même tableau `attendance`, ligne
  // repérée par contact_id plutôt que par intitulé de lot.
  const stakeholderAttendanceIndex = (s: { contact_id?: string; role: string; name: string }) =>
    (selectedReport?.attendance || []).findIndex(a =>
      s.contact_id ? a.contact_id === s.contact_id : (!a.contact_id && a.role === s.role && a.name === s.name)
    );

  const ensureStakeholderAttendance = (s: { contact_id?: string; role: string; name: string }) => {
    if (stakeholderAttendanceIndex(s) >= 0) return;
    const list = selectedReport?.attendance || [];
    updateReportField('attendance', [...list, { name: s.name, role: s.role, contact_id: s.contact_id, present: true, status: 'P' as PresenceStatus }]);
  };

  // Suivi par lot, page 2 du CR (effectif, retards, intempéries...) — table
  // séparée de la présence, indexée par lot_id. Crée la ligne à la volée.
  const setLotTracking = (lotId: string, patch: Partial<Omit<SiteReportLotTracking, 'lot_id'>>) => {
    const list = [...(selectedReport?.lot_tracking || [])];
    const idx = list.findIndex(t => t.lot_id === lotId);
    if (idx < 0) { list.push({ lot_id: lotId, ...patch }); } else { list[idx] = { ...list[idx], ...patch }; }
    updateReportField('lot_tracking', list);
  };

  const addRubrique = async () => {
    const category = newRubriqueName.trim();
    if (!category || !selectedReportId) return;
    setNewRubriqueName('');
    await addRubriqueEntry(category);
  };

  const addRubriqueEntry = async (category: string) => {
    if (!selectedReportId) return;
    const res = await fetch(`/api/reports/${selectedReportId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category,
        note_number: reportNotes.length + 1,
        issue_date: selectedReport?.date || new Date().toISOString().split('T')[0],
        text: '',
        status: 'open',
      }),
    });
    if (!res.ok) return;
    const created = await res.json();
    setReportNotes(prev => [...prev, created]);
  };

  const saveNoteField = async (noteId: string, field: keyof SiteReportNote, value: any) => {
    setReportNotes(prev => prev.map(n => (n.id === noteId ? { ...n, [field]: value } : n)));
    await fetch(`/api/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
  };

  const deleteNote = async (noteId: string) => {
    setReportNotes(prev => prev.filter(n => n.id !== noteId));
    await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
  };

  const rubriquesByCategory = useMemo(() => {
    const groups = new Map<string, SiteReportNote[]>();
    reportNotes.forEach(n => {
      if (!groups.has(n.category)) groups.set(n.category, []);
      groups.get(n.category)!.push(n);
    });
    return Array.from(groups.entries());
  }, [reportNotes]);

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
    // Id généré côté client : une création rejouée après coupure réseau
    // (file de synchro hors-ligne, src/lib/offlineQueue.ts) ne crée jamais
    // deux observations.
    const id = crypto.randomUUID();
    const body = { id, texte: '', statut: 'À faire' as const, type, created_report_id: selectedReportId };
    try {
      const { queued, data } = await queuedJsonRequest<Observation>({ entity: 'observation', id, method: 'POST', url: `/api/projects/${project.id}/observations`, body });
      const newObs: Observation = queued ? { ...body, project_id: project.id, pendingSync: true } : data!;
      setReportObservations(prev => [...prev, newObs]);
      fetchAllObservations().catch(() => {});
    } catch (err) { console.error(err); }
  };

  const saveObservationField = async (obsId: string, field: string, value: any) => {
    setReportObservations(prev => prev.map(o => (o.id === obsId ? { ...o, [field]: value } : o)));
    try {
      await queuedJsonRequest({ entity: 'observation', id: crypto.randomUUID(), method: 'PUT', url: `/api/observations/${obsId}`, body: { [field]: value } });
      setSaveError(false);
    } catch (err) {
      // The optimistic update above already landed locally regardless of
      // outcome — a failed PUT here silently leaves the UI showing an edit
      // the server never persisted (see 2026-09-08 incident: writes
      // occasionally 500 transiently with no corresponding DB error).
      // Hors-ligne, la modification est mise en file plutôt que rejetée :
      // ce n'est donc plus un échec ici.
      console.error(err);
      setSaveError(true);
    }
    fetchAllObservations().catch(() => {});
  };

  // Lève le badge « en attente » d'une observation dès que sa création a
  // effectivement atteint le serveur (voir src/lib/offlineQueue.ts).
  useEffect(() => {
    const onSynced = (e: Event) => {
      const { id, entity } = (e as CustomEvent).detail || {};
      if (entity !== 'observation') return;
      setReportObservations(prev => prev.map(o => o.id === id ? { ...o, pendingSync: false } : o));
    };
    window.addEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
  }, []);

  const uploadObservationPhoto = async (obsId: string, file: File) => {
    const photoId = crypto.randomUUID();
    try {
      const { queued, data } = await queuedMultipartRequest<{ photos: string[] }>({
        entity: 'observationPhoto', id: photoId, method: 'POST', url: `/api/observations/${obsId}/photos`,
        blob: file, blobFieldName: 'file', blobFilename: file.name, extraFields: { id: photoId },
      });
      if (!queued) {
        setReportObservations(prev => prev.map(o => (o.id === obsId ? { ...o, photos: data!.photos } : o)));
        fetchAllObservations().catch(() => {});
      }
      // Hors-ligne, la photo est en file : pas d'URL serveur à afficher tant
      // qu'elle n'a pas été envoyée (photos est un simple tableau d'URL, pas
      // d'objet à marquer « en attente » comme pour les réunions/réserves —
      // voir CLAUDE.md « fiabiliser la synchro hors-ligne »).
    } catch (err) { console.error(err); }
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
    if (!settings) { alert("Réglages du cabinet non chargés, réessayez dans un instant."); return; }
    setIsGeneratingPdf(true);
    try {
      const { exportSiteReportToPDF } = await import('../lib/siteReportExport');
      await exportSiteReportToPDF(
        selectedReport,
        reportNotes,
        observationsByLot,
        { id: project.id, name: project.name, project_code: project.project_code, address: project.address, client: project.client },
        lots_list,
        project.stakeholders_list || [],
        contacts,
        settings,
      );
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
                        {r.pendingSync ? (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">en attente</span>
                        ) : (
                          <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', STATUT_CR_COLORS[r.statut || 'brouillon'])}>
                            {STATUT_CR_LABELS[r.statut || 'brouillon']}
                          </span>
                        )}
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

                  {/* Présence des intervenants (page de garde du CR) */}
                  <Section title="Présence des intervenants" icon={IconUsers}>
                    {(project.stakeholders_list || []).length === 0 && (
                      <p className="text-sm text-[var(--tblr-muted)] italic py-2 text-center">
                        Aucun intervenant renseigné — ajoutez le groupement (MOA, AMO, MOE, CT, CSPS...) depuis la fiche projet.
                      </p>
                    )}
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <tbody>
                          {(project.stakeholders_list || []).map(s => {
                            const idx = stakeholderAttendanceIndex(s);
                            const row = idx >= 0 ? selectedReport.attendance![idx] : undefined;
                            const contact = s.contact_id ? contacts.find(c => c.id === s.contact_id) : undefined;
                            const status: PresenceStatus = row ? (row.status || (row.present ? 'P' : row.excused ? 'AE' : 'ANE')) : 'P';
                            return (
                              <tr key={s.id} className="border-b border-[var(--tblr-border)] last:border-0">
                                <td className="py-2 pr-2">
                                  <div className="font-semibold text-[var(--tblr-text)]">{s.role}</div>
                                  <div className="text-xs text-[var(--tblr-muted)]">
                                    {[s.name, contact?.company_name].filter(Boolean).join(' — ')}
                                  </div>
                                </td>
                                <td className="py-2 text-right whitespace-nowrap">
                                  <select
                                    className="p-1.5 rounded-lg border border-[var(--tblr-border)] bg-transparent text-xs"
                                    value={status}
                                    onFocus={() => ensureStakeholderAttendance(s)}
                                    onChange={e => {
                                      if (idx < 0) { ensureStakeholderAttendance(s); return; }
                                      setAttendanceStatus(idx, e.target.value as PresenceStatus);
                                    }}
                                  >
                                    {(Object.keys(PRESENCE_LABELS) as PresenceStatus[]).map(v => (
                                      <option key={v} value={v}>{PRESENCE_LABELS[v]}</option>
                                    ))}
                                  </select>
                                  <label className="ml-3 inline-flex items-center gap-1 text-xs text-[var(--tblr-muted)]">
                                    <input
                                      type="checkbox"
                                      checked={!!row?.diffusion}
                                      onFocus={() => ensureStakeholderAttendance(s)}
                                      onChange={e => { if (idx < 0) return; setAttendance(idx, { diffusion: e.target.checked }); }}
                                    /> Diffusion
                                  </label>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Section>

                  {/* Présence & suivi des lots (page 2 du CR) */}
                  <Section title="Présence & suivi des lots" icon={IconBuilding}>
                    {lots_list.length === 0 && (
                      <p className="text-sm text-[var(--tblr-muted)] italic py-2 text-center">Aucun lot renseigné pour ce projet.</p>
                    )}
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-[var(--tblr-muted)] text-[10px] font-bold uppercase tracking-wider">
                          <tr>
                            <th className="text-left py-1.5 pr-2">Lot / Entreprise</th>
                            <th className="text-left py-1.5 pr-2">Statut</th>
                            <th className="text-left py-1.5 pr-2">Effectif</th>
                            <th className="text-center py-1.5 pr-2">Retard exéc.</th>
                            <th className="text-center py-1.5 pr-2">Retard docs</th>
                            <th className="text-center py-1.5 pr-2">Intempéries</th>
                            <th className="text-center py-1.5 pr-2">Convoqué suiv.</th>
                            <th className="text-left py-1.5">Lieu</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lots_list.map(lot => {
                            const idx = (selectedReport.attendance || []).findIndex(a => a.role === lot.lot_title);
                            const row = idx >= 0 ? selectedReport.attendance![idx] : undefined;
                            const status: PresenceStatus = row ? (row.status || (row.present ? 'P' : row.excused ? 'AE' : 'ANE')) : 'P';
                            const t = (selectedReport.lot_tracking || []).find(x => x.lot_id === lot.id);
                            return (
                              <tr key={lot.id} className="border-b border-[var(--tblr-border)] last:border-0">
                                <td className="py-2 pr-2">
                                  <div className="font-semibold text-[var(--tblr-text)]">{lot.contact_name?.split(' - ')[0]}</div>
                                  <div className="text-xs text-[var(--tblr-muted)]">{lot.lot_number} — {lot.lot_title}</div>
                                </td>
                                <td className="py-2 pr-2 whitespace-nowrap">
                                  <select
                                    className="p-1.5 rounded-lg border border-[var(--tblr-border)] bg-transparent text-xs"
                                    value={status}
                                    onFocus={() => { if (idx < 0) ensureAttendanceRow(lot); }}
                                    onChange={e => {
                                      if (idx < 0) { ensureAttendanceRow(lot); return; }
                                      setAttendanceStatus(idx, e.target.value as PresenceStatus);
                                    }}
                                  >
                                    {(Object.keys(PRESENCE_LABELS) as PresenceStatus[]).map(v => (
                                      <option key={v} value={v}>{PRESENCE_LABELS[v]}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2 pr-2">
                                  <input type="number" min={0} className="w-16 p-1 rounded border border-[var(--tblr-border)] bg-transparent text-xs"
                                    value={t?.effectif ?? ''} onChange={e => setLotTracking(lot.id, { effectif: e.target.value ? parseInt(e.target.value) : undefined })} />
                                </td>
                                <td className="py-2 pr-2 text-center">
                                  <input type="checkbox" checked={!!t?.retard_execution} onChange={e => setLotTracking(lot.id, { retard_execution: e.target.checked })} />
                                </td>
                                <td className="py-2 pr-2 text-center">
                                  <input type="checkbox" checked={!!t?.retard_remise_docs} onChange={e => setLotTracking(lot.id, { retard_remise_docs: e.target.checked })} />
                                </td>
                                <td className="py-2 pr-2 text-center">
                                  <input type="checkbox" checked={!!t?.intemperies} onChange={e => setLotTracking(lot.id, { intemperies: e.target.checked })} />
                                </td>
                                <td className="py-2 pr-2 text-center">
                                  <input type="checkbox" checked={!!t?.convoque_reunion_suivante} onChange={e => setLotTracking(lot.id, { convoque_reunion_suivante: e.target.checked })} />
                                </td>
                                <td className="py-2">
                                  <input className="w-24 p-1 rounded border border-[var(--tblr-border)] bg-transparent text-xs"
                                    value={t?.lieu || ''} onChange={e => setLotTracking(lot.id, { lieu: e.target.value })} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Section>

                  {/* Rubriques personnalisées (corps administratif du CR) */}
                  <Section
                    title="Rubriques"
                    icon={IconListDetails}
                    action={
                      <div className="flex items-center gap-2">
                        <input
                          className="text-xs px-2 py-1.5 rounded-lg border border-[var(--tblr-border)] bg-transparent w-40"
                          placeholder="Nouvelle rubrique..."
                          value={newRubriqueName}
                          onChange={e => setNewRubriqueName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') addRubrique(); }}
                        />
                        <button onClick={addRubrique}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all">
                          <IconPlus size={14} /> Ajouter
                        </button>
                      </div>
                    }
                  >
                    {rubriquesByCategory.length === 0 && (
                      <p className="text-sm text-[var(--tblr-muted)] italic py-4 text-center">Aucune rubrique pour ce compte-rendu.</p>
                    )}
                    <div className="space-y-4">
                      {rubriquesByCategory.map(([category, items]) => (
                        <div key={category}>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-sm font-bold uppercase tracking-wide text-[var(--tblr-text)]">{category}</span>
                            <button onClick={() => addRubriqueEntry(category)}
                              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                              + Entrée
                            </button>
                          </div>
                          <div className="space-y-1.5">
                            {[...items].sort((a, b) => (a.issue_date || '').localeCompare(b.issue_date || '')).map(n => (
                              <div key={n.id} className="flex items-start gap-2 p-2 rounded-lg bg-[var(--tblr-surface-2)]">
                                <input type="date" className="shrink-0 text-xs bg-transparent border-none outline-none w-28"
                                  defaultValue={n.issue_date} onBlur={e => saveNoteField(n.id, 'issue_date', e.target.value)} />
                                <input className="flex-1 bg-transparent border-none outline-none text-sm min-w-[120px]"
                                  defaultValue={n.text} placeholder="Texte..." onBlur={e => saveNoteField(n.id, 'text', e.target.value)} />
                                <input className="shrink-0 w-32 bg-transparent border-none outline-none text-xs"
                                  defaultValue={n.responsible_company || ''} placeholder="Société" onBlur={e => saveNoteField(n.id, 'responsible_company', e.target.value)} />
                                <select className="shrink-0 text-[10px] px-1.5 py-1 rounded border border-[var(--tblr-border)] bg-transparent"
                                  value={n.status} onChange={e => saveNoteField(n.id, 'status', e.target.value)}>
                                  <option value="open">Ouvert</option>
                                  <option value="done">Soldé</option>
                                </select>
                                <button onClick={() => deleteNote(n.id)} className="text-zinc-300 hover:text-red-500"><IconTrash size={15} /></button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
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
                    {saveError && (
                      <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
                        <span>Une modification n'a pas pu être enregistrée (connexion interrompue). Rafraîchissez avant de reprendre votre saisie.</span>
                        <button
                          onClick={() => { setSaveError(false); fetchReportObservations(); }}
                          className="shrink-0 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold transition-all"
                        >
                          Rafraîchir
                        </button>
                      </div>
                    )}
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
                            <button
                              key={i}
                              type="button"
                              onClick={() => openSignedUrl(url)}
                              className="block aspect-square rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800"
                            >
                              <SignedImage src={url} alt="" className="w-full h-full object-cover" />
                            </button>
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
      {obs.pendingSync && (
        <span className="shrink-0 text-[9px] font-bold uppercase px-1.5 py-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">en attente</span>
      )}
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
        <button
          key={i}
          type="button"
          onClick={() => openSignedUrl(item.url)}
          className="block text-left rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--tblr-border)' }}
        >
          <div className="aspect-square bg-zinc-100 dark:bg-zinc-800">
            <SignedImage src={item.url} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="p-2 text-[10px] text-[var(--tblr-muted)] truncate">
            {item.report ? `CR ${item.report.report_number}` : ''} {item.obs.lot?.lot_title || ''}
          </div>
        </button>
      ))}
    </div>
  );
}
