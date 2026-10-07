import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useToastWithUndo } from '../hooks/useToastWithUndo';
import { Toast } from './ui/Toast';
import { useConfirmDialog } from './ui/ConfirmDialog';
import { PillTabs } from './ui/PillTabs';
import {
  IconPlus, IconFileDownload, IconCopy, IconSend, IconCloud, IconTemperature,
  IconUsers, IconChevronLeft, IconChevronRight, IconCamera,
  IconBuilding, IconTools, IconPhoto, IconClipboardList, IconAlertTriangle,
  IconRefresh, IconListDetails,
} from '@tabler/icons-react';
import { Project, ProjectLot, SiteReport, SiteReportNote, SiteReportAttendee, SiteReportLotTracking, PresenceStatus, Observation, OrdreDeService, Contact } from '../types';
import ObservationsTable from './ObservationsTable';
import { SignedImage } from './SignedImage';
import { openSignedUrl } from '../lib/signedStorageUrl';
import { queuedJsonRequest, queuedMultipartRequest, listPendingWrites, OFFLINE_WRITE_SYNCED_EVENT } from '../lib/offlineQueue';
import {
  DECOUPAGE_VIDE, sanitizeDecoupage, superposerEcrituresEnAttente, correspondDecoupage, etiquetteDecoupage,
  batimentsActifs, phasesActives, type DecoupageChantier, type FiltreDecoupage,
} from '../lib/chantierDecoupage';
import { DecoupageSelects, DecoupageFilters, DecoupagePanelChantier } from './chantier/DecoupageFields';
import { cachedListFirst } from '../lib/offlineReadCache';
import { db } from '../db';
import { cn } from '../lib/utils';
import type { AgencySettings } from '../lib/proposalExport';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Section } from './chantier/Section';
import { DraftInput, parseDays } from './chantier/fields';
import { DecisionRow, ObservationRow, RubriqueRow } from './chantier/ReportRows';
import { DEFAULT_LIEU, LotTrackingCards } from './chantier/LotTrackingCards';
import { QuickCaptureBar } from './chantier/QuickCaptureBar';

interface ChantierModuleProps {
  project: Project;
  lots_list: ProjectLot[];
  ordresDeService: OrdreDeService[];
  osSituationsContent: React.ReactNode;
  contacts: Contact[];
  settings?: AgencySettings | null;
  /** Rafraîchit les réserves de l'AOR après une reprise d'observations. */
  onReservesChanged?: () => void;
}

const PRESENCE_LABELS: Record<PresenceStatus, string> = { P: 'Présent', R: 'Retard', AE: 'Absent excusé', ANE: 'Absent non excusé', NC: 'Non convoqué' };

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

const WEATHER_ALERT_KEYWORDS = ['pluie', 'neige', 'intemp', 'orage', 'gel', 'vent fort'];

function isBadWeather(meteo?: string) {
  if (!meteo) return false;
  const lower = meteo.toLowerCase();
  return WEATHER_ALERT_KEYWORDS.some(k => lower.includes(k));
}

export default function ChantierModule({ project, lots_list: lotsBruts, ordresDeService, osSituationsContent, contacts, settings, onReservesChanged }: ChantierModuleProps) {
  // Lots et entreprises classés par numéro de lot (« 2 » avant « 10 »), partout dans le module.
  const lots_list = useMemo(
    () => [...lotsBruts].sort((a, b) => String(a.lot_number ?? '').localeCompare(String(b.lot_number ?? ''), 'fr', { numeric: true })),
    [lotsBruts],
  );
  const { toast, showToast } = useToastWithUndo();
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
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

  // Bâtiments et phases du chantier : lus de la fiche (donc aussi de son cliché hors
  // connexion), écrits par leur route dédiée — jamais avec l'enregistrement de la fiche.
  const [decoupage, setDecoupage] = useState<DecoupageChantier>(() => sanitizeDecoupage(project.chantier_decoupage ?? DECOUPAGE_VIDE));
  useEffect(() => { setDecoupage(sanitizeDecoupage(project.chantier_decoupage ?? DECOUPAGE_VIDE)); }, [project.id, project.chantier_decoupage]);
  const [isDecoupageOpen, setIsDecoupageOpen] = useState(false);
  const [filtreDecoupage, setFiltreDecoupage] = useState<FiltreDecoupage>({ batimentId: '', phaseId: '' });
  const [newReportDecoupage, setNewReportDecoupage] = useState<{ batiment_id?: string | null; phase_id?: string | null }>({});
  const aDecoupage = batimentsActifs(decoupage).length + phasesActives(decoupage).length > 0;

  const saveDecoupage = async (next: DecoupageChantier) => {
    setDecoupage(next);
    setIsDecoupageOpen(false);
    try {
      const { data } = await queuedJsonRequest<DecoupageChantier>({
        entity: 'chantierDecoupage', id: crypto.randomUUID(), method: 'PUT', url: `/api/projects/${project.id}/chantier-decoupage`, body: next,
      });
      if (data) setDecoupage(sanitizeDecoupage(data));
    } catch (err) {
      console.error(err);
      showToast((err as Error).message || 'Impossible d’enregistrer les bâtiments et phases.', 'error');
    }
  };

  const selectedReport = useMemo(
    () => reports.find(r => r.id === selectedReportId) || null,
    [reports, selectedReportId]
  );

  // Cache d'abord, puis réseau, avec par-dessus la file d'écritures hors ligne
  // (src/lib/chantierDecoupage.ts::superposerEcrituresEnAttente) : sans réseau, les
  // comptes-rendus déjà consultés restent listés, et celui qu'on vient de créer
  // sur le chantier reste là au lieu de disparaître au premier rechargement.
  const visibleReports = useMemo(
    () => reports.filter(r => correspondDecoupage(r, filtreDecoupage)),
    [reports, filtreDecoupage],
  );

  const fetchReports = useCallback(async () => {
    const pending = await listPendingWrites('siteReport');
    await cachedListFirst(
      db.siteReportsCache,
      r => r.project_id === project.id,
      `/api/projects/${project.id}/reports`,
      list => setReports(superposerEcrituresEnAttente(Array.isArray(list) ? list : [], pending, project.id)),
    );
    // Rien en cache ni réseau : les créations en attente restent affichées seules.
    setReports(prev => (prev.length === 0 && pending.length > 0 ? superposerEcrituresEnAttente([], pending, project.id) : prev));
  }, [project.id]);

  // Premier compte-rendu sélectionné d'office, une fois la liste connue.
  useEffect(() => {
    if (!selectedReportId && reports.length > 0) setSelectedReportId(reports[0].id);
  }, [reports, selectedReportId]);

  // Enregistre un compte-rendu entier : en ligne, la réponse du serveur fait foi ;
  // hors ligne, la modification est mise en file (rejouée dans l'ordre) et le cache
  // local garde la version affichée.
  // Le numéro d'un compte-rendu encore en attente est provisoire : il ne part jamais
  // dans une modification (le serveur le renumérotait, ou refusait un doublon).
  // Dernière liste connue : l'annulation d'une diffusion repart de la version la plus récente.
  const reportsRef = useRef(reports);
  reportsRef.current = reports;

  const persistReport = async (
    updated: SiteReport,
    body: Record<string, unknown> = (() => {
      const { report_number, ...sansNumero } = updated as any;
      return updated.pendingSync ? sansNumero : (updated as any);
    })(),
  ): Promise<SiteReport | null> => {
    setReports(prev => prev.map(r => (r.id === updated.id ? updated : r)));
    db.siteReportsCache.put(updated).catch(() => {});
    const { queued, data } = await queuedJsonRequest<SiteReport>({
      entity: 'siteReport', id: crypto.randomUUID(), method: 'PUT', url: `/api/reports/${updated.id}`, body,
    });
    if (queued || !data) return null;
    const saved = { ...data, pendingSync: updated.pendingSync };
    setReports(prev => prev.map(r => (r.id === saved.id ? saved : r)));
    db.siteReportsCache.put(saved).catch(() => {});
    return saved;
  };

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
    setReportNotes([]);
    if (!selectedReportId) return;
    await cachedListFirst(
      db.siteReportNotesCache,
      n => n.report_id === selectedReportId,
      `/api/reports/${selectedReportId}/notes`,
      list => setReportNotes(Array.isArray(list) ? list : []),
    );
  }, [selectedReportId]);

  useEffect(() => { fetchReports().catch(() => {}); }, [fetchReports]);
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
      batiment_id: (duplicateFrom ? duplicateFrom.batiment_id : newReportDecoupage.batiment_id) || null,
      phase_id: (duplicateFrom ? duplicateFrom.phase_id : newReportDecoupage.phase_id) || null,
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
      db.siteReportsCache.put(newReport).catch(() => {});
      setSelectedReportId(newReport.id);
      setIsModalOpen(false);
      setFetchedWeather(null);
      setNewReportDecoupage({});
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
      if (!data.meteo || data.meteo === 'Inconnu') return;
      await persistReport({ ...report, meteo: data.meteo, temperature: data.temperature ?? report.temperature });
    } catch (err) {
      console.error('Failed to refresh weather:', err);
    } finally {
      setWeatherLoading(false);
    }
  };

  // Météo automatique : un CR dont la météo n'a jamais été renseignée
  // (« Inconnu », vide) est complété une seule fois à son ouverture.
  const autoWeatherTried = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedReport || selectedReport.pendingSync || !project.address) return;
    const unknown = !selectedReport.meteo || selectedReport.meteo === 'Inconnu';
    if (!unknown || autoWeatherTried.current.has(selectedReport.id)) return;
    autoWeatherTried.current.add(selectedReport.id);
    refreshWeather(selectedReport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReport?.id, selectedReport?.meteo, project.address]);

  // Numéro de CR : saisie libre, enregistrée à la sortie du champ. Refus
  // serveur (doublon dans l'affaire) : on annonce et on rétablit l'ancien.
  const [numberDraft, setNumberDraft] = useState('');
  useEffect(() => { setNumberDraft(selectedReport ? String(selectedReport.report_number ?? '') : ''); }, [selectedReport?.id, selectedReport?.report_number]);
  const commitReportNumber = async () => {
    if (!selectedReport) return;
    const n = parseInt(numberDraft, 10);
    if (!Number.isInteger(n) || n < 1) { setNumberDraft(String(selectedReport.report_number ?? '')); return; }
    if (n === selectedReport.report_number) return;
    try {
      const withNumber = { ...selectedReport, report_number: n };
      await persistReport(withNumber, withNumber as any);
    } catch (err) {
      // Refus du serveur (numéro déjà pris) : on annonce et on rétablit l'ancien.
      setReports(prev => prev.map(r => (r.id === selectedReport.id ? selectedReport : r)));
      db.siteReportsCache.put(selectedReport).catch(() => {});
      showToast((err as Error).message || 'Impossible de modifier le numéro.', 'error');
      setNumberDraft(String(selectedReport.report_number ?? ''));
    }
  };

  // La météo est celle du jour du compte-rendu : changer la date la recalcule.
  // Si elle est introuvable, on ne garde pas la météo d'un autre jour.
  const changeReportDate = async (date: string) => {
    if (!selectedReport || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date === selectedReport.date) return;
    let meteo = 'Inconnu';
    let temperature: number | null = null;
    if (project.address) {
      setWeatherLoading(true);
      try {
        const res = await fetch(`/api/weather?q=${encodeURIComponent(project.address)}&date=${date}`);
        if (res.ok) {
          const data = await res.json();
          if (data.meteo) { meteo = data.meteo; temperature = data.temperature ?? null; }
        }
      } catch (err) {
        console.error('Failed to fetch weather:', err);
      } finally {
        setWeatherLoading(false);
      }
    }
    const updated: SiteReport = { ...selectedReport, date, meteo, temperature: temperature ?? undefined };
    try {
      // null (et non undefined) pour que le serveur efface l'ancienne température.
      await persistReport(updated, { ...updated, temperature });
    } catch {
      setReports(prev => prev.map(r => (r.id === selectedReport.id ? selectedReport : r)));
      db.siteReportsCache.put(selectedReport).catch(() => {});
    }
  };

  const updateReportField = async (field: keyof SiteReport, value: SiteReport[keyof SiteReport]) => {
    if (!selectedReport) return;
    try {
      await persistReport({ ...selectedReport, [field]: value });
    } catch (err) {
      console.error(err);
      setSaveError(true);
    }
  };

  // « Diffuser » ne fait que passer le compte-rendu au statut diffusé (aucun
  // envoi n'est fait d'ici) : on le confirme, puis un toast permet de revenir en arrière.
  const diffuserCompteRendu = async () => {
    if (!selectedReport || selectedReport.statut === 'diffuse') return;
    const precedent = selectedReport.statut || 'brouillon';
    const ok = await confirmAction({
      title: `Marquer le compte-rendu n° ${selectedReport.report_number} comme diffusé ?`,
      message: "Le statut passe à « Diffusé » et le compte-rendu compte dans les indicateurs du chantier. Aucun e-mail n'est envoyé depuis ce bouton : exportez le PDF pour le transmettre aux entreprises.",
      confirmLabel: 'Marquer comme diffusé',
      cancelLabel: 'Annuler',
      tone: 'primary',
    });
    if (!ok) return;
    await updateReportField('statut', 'diffuse');
    showToast(`Compte-rendu n° ${selectedReport.report_number} marqué comme diffusé.`, 'success', {
      duration: 6000,
      action: {
        label: 'Annuler',
        onClick: () => {
          const courant = reportsRef.current.find(r => r.id === selectedReport.id);
          if (courant) void persistReport({ ...courant, statut: precedent }).catch(() => setSaveError(true));
        },
      },
    });
  };

  const setAttendance = (index: number, patch: Partial<SiteReportAttendee>) => {
    const list = [...(selectedReport?.attendance || [])];
    list[index] = { ...list[index], ...patch };
    updateReportField('attendance', list);
  };

  const setAttendanceStatus = (index: number, status: PresenceStatus) => {
    setAttendance(index, { status, present: status === 'P' || status === 'R', excused: status === 'AE' });
  };

  const ensureAttendanceRow = (lot: ProjectLot, status: PresenceStatus = 'P') => {
    const list = selectedReport?.attendance || [];
    if (list.some(a => a.role === lot.lot_title)) return;
    const name = lot.contact_name?.split(' - ')[1] || lot.contact_name?.split(' - ')[0] || '';
    updateReportField('attendance', [...list, { name, role: lot.lot_title, present: status === 'P' || status === 'R', excused: status === 'AE', status }]);
  };

  // Statut de présence d'un lot (« Présent » tant qu'aucune ligne n'existe) et son
  // changement : le premier choix crée la ligne AVEC le statut choisi (il était
  // auparavant ignoré, la ligne naissant « Présent »).
  const lotStatus = (lot: ProjectLot): PresenceStatus => {
    const row = (selectedReport?.attendance || []).find(a => a.role === lot.lot_title);
    return row ? (row.status || (row.present ? 'P' : row.excused ? 'AE' : 'ANE')) : 'P';
  };
  const changeLotStatus = (lot: ProjectLot, status: PresenceStatus) => {
    const idx = (selectedReport?.attendance || []).findIndex(a => a.role === lot.lot_title);
    if (idx < 0) ensureAttendanceRow(lot, status);
    else setAttendanceStatus(idx, status);
  };
  const isDesktop = useMediaQuery('(min-width: 768px)');

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
    // Id côté client : la création peut être mise en file hors ligne et rejouée sans doublon.
    const id = crypto.randomUUID();
    const body = {
      id,
      category,
      note_number: reportNotes.length + 1,
      issue_date: selectedReport?.date || new Date().toISOString().split('T')[0],
      text: '',
      status: 'open' as const,
    };
    try {
      const { queued, data } = await queuedJsonRequest<SiteReportNote>({
        entity: 'siteReportNote', id, method: 'POST', url: `/api/reports/${selectedReportId}/notes`, body,
      });
      const created: SiteReportNote = queued || !data ? { ...body, report_id: selectedReportId } : data;
      setReportNotes(prev => [...prev, created]);
      db.siteReportNotesCache.put(created).catch(() => {});
    } catch (err) { console.error(err); }
  };

  const saveNoteField = async (noteId: string, field: keyof SiteReportNote, value: SiteReportNote[keyof SiteReportNote]) => {
    setReportNotes(prev => prev.map(n => (n.id === noteId ? { ...n, [field]: value } : n)));
    db.siteReportNotesCache.update(noteId, { [field]: value }).catch(() => {});
    try {
      await queuedJsonRequest({ entity: 'siteReportNote', id: crypto.randomUUID(), method: 'PUT', url: `/api/notes/${noteId}`, body: { [field]: value } });
    } catch (err) {
      console.error('saveNoteField failed:', err);
    }
  };

  const deleteNote = async (noteId: string) => {
    setReportNotes(prev => prev.filter(n => n.id !== noteId));
    db.siteReportNotesCache.delete(noteId).catch(() => {});
    try {
      await queuedJsonRequest({ entity: 'siteReportNote', id: crypto.randomUUID(), method: 'DELETE', url: `/api/notes/${noteId}` });
    } catch (err) { console.error('deleteNote failed:', err); }
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

  const addObservation = async (type: Observation['type'] = 'observation'): Promise<string | undefined> => {
    if (!selectedReportId) return undefined;
    // Id généré côté client : une création rejouée après coupure réseau
    // (file de synchro hors-ligne, src/lib/offlineQueue.ts) ne crée jamais
    // deux observations.
    const id = crypto.randomUUID();
    const body = {
      id, texte: '', statut: 'À faire' as const, type, created_report_id: selectedReportId,
      // Une observation relevée dans un compte-rendu hérite de son bâtiment et de sa phase.
      batiment_id: selectedReport?.batiment_id || null, phase_id: selectedReport?.phase_id || null,
    };
    try {
      const { queued, data } = await queuedJsonRequest<Observation>({ entity: 'observation', id, method: 'POST', url: `/api/projects/${project.id}/observations`, body });
      const newObs: Observation = queued ? { ...body, project_id: project.id, pendingSync: true } : data!;
      setReportObservations(prev => [...prev, newObs]);
      fetchAllObservations().catch(() => {});
      return id;
    } catch (err) { console.error(err); return undefined; }
  };

  // Photo prise depuis la barre du bas : elle crée l'observation à laquelle elle se rattache.
  const captureObservationPhoto = async (file: File) => {
    const id = await addObservation('observation');
    if (id) await uploadObservationPhoto(id, file);
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
    if (!settings) { showToast('Réglages du cabinet non chargés, réessayez dans un instant.', 'error'); return; }
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
        { decoupageLabel: etiquetteDecoupage(selectedReport, decoupage) },
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

  const tabs: { id: ChantierTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'comptes-rendus', label: 'Comptes-rendus', icon: IconClipboardList },
    { id: 'reserves', label: 'Observations', icon: IconAlertTriangle },
    { id: 'entreprises', label: 'Entreprises', icon: IconBuilding },
    { id: 'os', label: 'OS & situations', icon: IconTools },
    { id: 'photos', label: 'Photos', icon: IconPhoto },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="hidden lg:block rounded-xl p-4 sm:p-6" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-1">
              Phase DET · Direction de l'exécution des travaux
            </p>
            <h2 className="text-2xl font-bold text-[var(--tblr-text)]">Chantier</h2>
            <p className="text-sm text-[var(--tblr-muted)] mt-1 max-w-xl">
              Suivi de l'exécution : visites, comptes-rendus diffusés aux entreprises, observations et ordres de service.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsDecoupageOpen(true)}
              className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] px-3 py-2 rounded-lg text-sm font-bold transition"
            >
              <IconBuilding size={16} /> {aDecoupage
                ? `${batimentsActifs(decoupage).length} bât. · ${phasesActives(decoupage).length} phase${phasesActives(decoupage).length > 1 ? 's' : ''}`
                : 'Bâtiments et phases'}
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 bg-[var(--tblr-primary)] hover:brightness-90 text-white px-4 py-2 rounded-lg text-sm font-bold transition"
            >
              <IconPlus size={16} /> Nouveau compte-rendu
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-4 mt-5">
          <StatPill label="Avancement DET" value={`${avancementDet} %`} />
          <StatPill label="Comptes-rendus" value={String(reports.length)} />
          <StatPill label="CR diffusés" value={String(crDiffuses)} />
          <StatPill label="Dernier CR diffusé" value={dernierCrDiffuse ? `n° ${dernierCrDiffuse.report_number}` : '—'} hint={dernierCrDiffuse?.date} />
          <StatPill
            label="Observations à lever"
            value={String(reservesOuvertes.length)}
            accent={reservesOuvertes.length > 0}
            hint={reservesOuvertes.length > 0 ? reservesOuvertes.slice(0, 3).map(o => o.texte).join(' · ') : undefined}
            title={reservesOuvertes.map(o => o.texte).join('\n') || undefined}
          />
          <StatPill label="OS émis" value={String(osEmisTravaux)} />
          <StatPill label="Intempéries cumulées" value={`${intemperies} j`} />
        </div>
      </div>

      {/* Tabs */}
      <PillTabs
        ariaLabel="Sections du chantier"
        tabs={tabs}
        activeId={activeTab}
        onChange={id => setActiveTab(id as ChantierTab)}
      />

      {/* Body */}
      <div>
        <div className="min-w-0">
          {activeTab === 'comptes-rendus' && (
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 items-start">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="lg:hidden min-h-11 flex items-center justify-center gap-2 bg-[var(--tblr-primary)] hover:brightness-90 text-white px-4 py-2 rounded-lg text-sm font-bold transition"
              >
                <IconPlus size={16} /> Nouveau compte-rendu
              </button>
              {/* CR list */}
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                <div className="px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)] border-b border-[var(--tblr-border)]">
                  Comptes-rendus · {visibleReports.length}{visibleReports.length !== reports.length ? ` / ${reports.length}` : ''}
                </div>
                {aDecoupage && (
                  <div className="flex flex-wrap gap-2 p-2 border-b border-[var(--tblr-border)]">
                    <DecoupageFilters decoupage={decoupage} filtre={filtreDecoupage} onChange={setFiltreDecoupage} />
                  </div>
                )}
                <div className="max-h-[70dvh] overflow-y-auto">
                  {visibleReports.map(r => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedReportId(r.id)}
                      className={cn(
                        'w-full text-left px-3 py-3 border-b border-[var(--tblr-border)] transition-colors',
                        selectedReportId === r.id ? 'bg-[var(--tblr-primary-lt)]' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sm text-[var(--tblr-text)]">CR {r.report_number}</span>
                        {r.pendingSync ? (
                          <span className="text-[0.6875rem] font-bold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">en attente</span>
                        ) : (
                          <span className={cn('text-[0.6875rem] font-bold px-1.5 py-0.5 rounded-full', STATUT_CR_COLORS[r.statut || 'brouillon'])}>
                            {STATUT_CR_LABELS[r.statut || 'brouillon']}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--tblr-muted)] mt-0.5">
                        {r.date}{etiquetteDecoupage(r, decoupage) && ` · ${etiquetteDecoupage(r, decoupage)}`}
                      </div>
                    </button>
                  ))}
                  {visibleReports.length === 0 && (
                    <p className="p-4 text-sm text-[var(--tblr-muted)] italic text-center">
                      {reports.length === 0 ? 'Aucun compte-rendu.' : 'Aucun compte-rendu pour ce bâtiment ou cette phase.'}
                    </p>
                  )}
                </div>
              </div>

              {/* CR detail */}
              {selectedReport ? (
                <div className="space-y-4 min-w-0">
                  <div className="rounded-xl p-4 sm:p-5" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            const idx = reports.findIndex(r => r.id === selectedReportId);
                            if (idx < reports.length - 1) setSelectedReportId(reports[idx + 1].id);
                          }}
                          aria-label="Compte-rendu plus ancien"
                          className="inline-flex h-11 w-11 items-center justify-center text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]"
                        ><IconChevronLeft size={18} /></button>
                        <div>
                          <h3 className="text-lg font-bold text-[var(--tblr-text)]">
                            Compte-rendu de visite n°{' '}
                            <input
                              type="number" min={1}
                              aria-label="Numéro du compte-rendu"
                              title="Modifier le numéro du compte-rendu"
                              className="w-16 bg-transparent border-b border-dashed border-[var(--tblr-border)] focus:border-[var(--tblr-primary)] outline-none font-bold text-lg text-center"
                              value={numberDraft}
                              onChange={e => setNumberDraft(e.target.value)}
                              onBlur={commitReportNumber}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            />
                          </h3>
                          <span className={cn('text-[0.6875rem] font-bold px-1.5 py-0.5 rounded-full', STATUT_CR_COLORS[selectedReport.statut || 'brouillon'])}>
                            {STATUT_CR_LABELS[selectedReport.statut || 'brouillon']}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            const idx = reports.findIndex(r => r.id === selectedReportId);
                            if (idx > 0) setSelectedReportId(reports[idx - 1].id);
                          }}
                          aria-label="Compte-rendu plus récent"
                          className="inline-flex h-11 w-11 items-center justify-center text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]"
                        ><IconChevronRight size={18} /></button>
                      </div>
                      <DecoupageSelects
                        decoupage={decoupage}
                        batimentId={selectedReport.batiment_id}
                        phaseId={selectedReport.phase_id}
                        onChange={patch => persistReport({ ...selectedReport, ...patch }).catch(err => { console.error(err); setSaveError(true); })}
                      />
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={generatePdf} disabled={isGeneratingPdf}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold transition">
                          <IconFileDownload size={14} /> PDF
                        </button>
                        <button type="button" onClick={() => handleCreateReport(selectedReport)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold transition">
                          <IconCopy size={14} /> Dupliquer
                        </button>
                        <button type="button" onClick={() => void diffuserCompteRendu()}
                          disabled={selectedReport.statut === 'diffuse'}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--tblr-primary)] hover:brightness-90 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition">
                          <IconSend size={14} /> Diffuser
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-[var(--tblr-muted)]">
                      <input
                        type="date"
                        aria-label="Date du compte-rendu"
                        title="La météo suit la date du compte-rendu"
                        className="bg-transparent border-none outline-none"
                        value={selectedReport.date || ''}
                        onChange={e => changeReportDate(e.target.value)}
                      />
                      <span className="flex items-center gap-1"><IconCloud size={14} />
                        <input className="bg-transparent border-none outline-none w-28" aria-label="Météo"
                          value={selectedReport.meteo || ''} onChange={e => updateReportField('meteo', e.target.value)} />
                      </span>
                      <span className="flex items-center gap-1"><IconTemperature size={14} />
                        <input type="number" className="bg-transparent border-none outline-none w-14" aria-label="Température en degrés Celsius"
                          value={selectedReport.temperature ?? ''} onChange={e => updateReportField('temperature', parseInt(e.target.value) || 0)} />°C
                      </span>
                      <button
                        onClick={() => refreshWeather(selectedReport)}
                        disabled={weatherLoading || !project.address}
                        title={project.address ? 'Actualiser la météo pour la date du compte-rendu' : "Renseignez l'adresse de l'affaire (onglet INFOS) pour récupérer la météo"}
                        className="flex items-center gap-1 text-xs text-[var(--tblr-primary)] hover:underline disabled:opacity-50 disabled:no-underline"
                      >
                        <IconRefresh size={13} className={weatherLoading ? 'animate-spin' : ''} /> Actualiser
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                      <MiniStat label="Présents" value={String((selectedReport.attendance || []).filter(a => a.present).length)} />
                      <MiniStat label="Absents/Excusés" value={String((selectedReport.attendance || []).filter(a => !a.present && a.status !== 'NC').length)} />
                      <MiniStat label="Observations" value={String(reportObservations.length)} />
                      <MiniStat label="À lever (ouv./tot.)" value={`${reportObservations.filter(o => o.type === 'reserve' && o.statut !== 'Levée').length}/${reportObservations.filter(o => o.type === 'reserve').length}`} />
                    </div>
                  </div>

                  {/* Présence des intervenants (page de garde du CR) */}
                  <Section id="intervenants" title="Présence des intervenants" icon={IconUsers}>
                    {(project.stakeholders_list || []).length === 0 && (
                      <p className="text-sm text-[var(--tblr-muted)] italic py-2 text-center">
                        Aucun intervenant renseigné — ajoutez le groupement (MOA, AMO, MOE, CT, CSPS...) depuis l'onglet Infos de l'affaire.
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
                  <Section id="presence" title="Présence & suivi des lots" icon={IconBuilding}>
                    {lots_list.length === 0 && (
                      <p className="text-sm text-[var(--tblr-muted)] italic py-2 text-center">Aucun lot renseigné pour ce projet.</p>
                    )}
                    {!isDesktop ? (
                      <LotTrackingCards
                        lots={lots_list}
                        statusLabels={PRESENCE_LABELS}
                        getStatus={lotStatus}
                        onStatus={changeLotStatus}
                        getTracking={lotId => (selectedReport.lot_tracking || []).find(x => x.lot_id === lotId)}
                        onTrack={setLotTracking}
                      />
                    ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-[var(--tblr-muted)] text-[0.6875rem] font-bold uppercase tracking-wider">
                          <tr>
                            <th className="text-left py-1.5 pr-2">Lot / Entreprise</th>
                            <th className="text-left py-1.5 pr-2">Statut</th>
                            <th className="text-left py-1.5 pr-2">Effectif</th>
                            <th className="text-center py-1.5 pr-2">Retard sem. (j)</th>
                            <th className="text-center py-1.5 pr-2">Retard cumulé (j)</th>
                            <th className="text-center py-1.5 pr-2">Retard docs (j)</th>
                            <th className="text-center py-1.5 pr-2">Intempéries (j)</th>
                            <th className="text-center py-1.5 pr-2">Convoqué suiv.</th>
                            <th className="text-left py-1.5 pr-2">Lieu</th>
                            <th className="text-left py-1.5">Heure</th>
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
                                    onChange={e => changeLotStatus(lot, e.target.value as PresenceStatus)}
                                  >
                                    {(Object.keys(PRESENCE_LABELS) as PresenceStatus[]).map(v => (
                                      <option key={v} value={v}>{PRESENCE_LABELS[v]}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2 pr-2">
                                  <DraftInput type="number" min={0} aria-label={`Effectif, ${lot.lot_title}`}
                                    className="w-16 p-1 rounded border border-[var(--tblr-border)] bg-transparent text-xs"
                                    value={t?.effectif != null ? String(t.effectif) : ''}
                                    onCommit={v => setLotTracking(lot.id, { effectif: parseDays(v) })} />
                                </td>
                                <td className="py-2 pr-2 text-center">
                                  <DraftInput type="number" min={0} aria-label={`Retard de la semaine en jours, ${lot.lot_title}`}
                                    className="w-16 p-1 rounded border border-[var(--tblr-border)] bg-transparent text-xs text-center"
                                    value={t?.retard_semaine != null ? String(t.retard_semaine) : ''}
                                    onCommit={v => setLotTracking(lot.id, { retard_semaine: parseDays(v) })} />
                                </td>
                                <td className="py-2 pr-2 text-center">
                                  <DraftInput type="number" min={0} aria-label={`Retard cumulé en jours, ${lot.lot_title}`}
                                    className="w-16 p-1 rounded border border-[var(--tblr-border)] bg-transparent text-xs text-center"
                                    value={t?.retard_cumule != null ? String(t.retard_cumule) : ''}
                                    onCommit={v => setLotTracking(lot.id, { retard_cumule: parseDays(v) })} />
                                </td>
                                <td className="py-2 pr-2 text-center">
                                  <DraftInput type="number" min={0} aria-label={`Retard de remise des documents en jours, ${lot.lot_title}`}
                                    className="w-16 p-1 rounded border border-[var(--tblr-border)] bg-transparent text-xs text-center"
                                    value={t?.retard_docs_jours != null ? String(t.retard_docs_jours) : ''}
                                    onCommit={v => setLotTracking(lot.id, { retard_docs_jours: parseDays(v) })} />
                                </td>
                                <td className="py-2 pr-2 text-center">
                                  <DraftInput type="number" min={0} aria-label={`Jours d\'intempéries, ${lot.lot_title}`}
                                    className="w-16 p-1 rounded border border-[var(--tblr-border)] bg-transparent text-xs text-center"
                                    value={t?.intemperies_jours != null ? String(t.intemperies_jours) : ''}
                                    onCommit={v => setLotTracking(lot.id, { intemperies_jours: parseDays(v) })} />
                                </td>
                                <td className="py-2 pr-2 text-center">
                                  <input type="checkbox" checked={!!t?.convoque_reunion_suivante} onChange={e => setLotTracking(lot.id, { convoque_reunion_suivante: e.target.checked })} />
                                </td>
                                <td className="py-2 pr-2">
                                  <DraftInput aria-label={`Lieu de la réunion, ${lot.lot_title}`}
                                    className="w-28 p-1 rounded border border-[var(--tblr-border)] bg-transparent text-xs"
                                    value={t?.lieu ?? DEFAULT_LIEU}
                                    onCommit={v => setLotTracking(lot.id, { lieu: v.trim() || DEFAULT_LIEU })} />
                                </td>
                                <td className="py-2">
                                  <DraftInput type="time" aria-label={`Heure de convocation, ${lot.lot_title}`}
                                    className="w-24 p-1 rounded border border-[var(--tblr-border)] bg-transparent text-xs"
                                    value={t?.heure || ''}
                                    onCommit={v => setLotTracking(lot.id, { heure: v || undefined })} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    )}
                  </Section>

                  {/* Rubriques personnalisées (corps administratif du CR) */}
                  <Section id="rubriques"
                    title="Rubriques"
                    icon={IconListDetails}
                    action={
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <input
                          className="min-w-0 flex-1 sm:flex-none text-sm sm:text-xs px-2.5 py-2 sm:py-1.5 rounded-lg border border-[var(--tblr-border)] bg-transparent sm:w-40"
                          placeholder="Nouvelle rubrique..."
                          value={newRubriqueName}
                          onChange={e => setNewRubriqueName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') addRubrique(); }}
                        />
                        <button type="button" onClick={addRubrique}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-2 sm:py-1.5 bg-[var(--tblr-primary)] hover:brightness-90 text-white rounded-lg text-xs font-bold transition">
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
                            <button type="button" onClick={() => addRubriqueEntry(category)}
                              className="text-xs font-semibold text-[var(--tblr-primary)] hover:underline">
                              + Entrée
                            </button>
                          </div>
                          <div className="space-y-1.5">
                            {[...items].sort((a, b) => (a.issue_date || '').localeCompare(b.issue_date || '')).map(n => (
                              <RubriqueRow key={n.id} note={n} onSave={saveNoteField} onDelete={deleteNote} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>

                  {/* Observations par lot */}
                  <Section id="observations"
                    title="Observations par lot"
                    icon={IconClipboardList}
                    action={
                      <button type="button" onClick={() => addObservation('observation')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--tblr-primary)] hover:brightness-90 text-white rounded-lg text-xs font-bold transition">
                        <IconPlus size={14} /> Ajouter une observation
                      </button>
                    }
                  >
                    {saveError && (
                      <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
                        <span>Une modification n'a pas pu être enregistrée (connexion interrompue). Rafraîchissez avant de reprendre votre saisie.</span>
                        <button
                          onClick={() => { setSaveError(false); fetchReportObservations(); }}
                          className="shrink-0 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold transition"
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
                  <Section id="decisions"
                    title="Décisions de la maîtrise d'œuvre"
                    action={
                      <button type="button" onClick={addDecision}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold transition">
                        <IconPlus size={14} /> Ajouter
                      </button>
                    }
                  >
                    {(selectedReport.decisions || []).length === 0 && (
                      <p className="text-sm text-[var(--tblr-muted)] italic py-2 text-center">Aucune décision consignée.</p>
                    )}
                    <div className="space-y-2">
                      {(selectedReport.decisions || []).map((d, i) => (
                        <DecisionRow key={i} decision={d} onChange={patch => updateDecision(i, patch)} onRemove={() => removeDecision(i)} />
                      ))}
                    </div>
                  </Section>

                  {/* Reportage photo */}
                  <Section id="photos" title="Reportage photo" icon={IconCamera}>
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

                  {/* Réserve la place de la barre fixe du bas (téléphone) pour que la dernière section reste atteignable. */}
                  <div className="h-16 md:hidden" aria-hidden="true" />
                  <QuickCaptureBar onAddObservation={() => { void addObservation('observation'); }} onCapturePhoto={file => { void captureObservationPhoto(file); }} />
                </div>
              ) : (
                <div className="rounded-xl p-10 text-center text-[var(--tblr-muted)] italic" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                  Sélectionnez ou créez un compte-rendu.
                </div>
              )}
            </div>
          )}

          {activeTab === 'reserves' && (
            <ObservationsTable projectId={project.id} lots={lots_list} decoupage={decoupage} defaultType="reserve" onReservesChanged={onReservesChanged} />
          )}

          {activeTab === 'entreprises' && <EntreprisesTab lots_list={lots_list} observations={allObservations} />}

          {activeTab === 'os' && osSituationsContent}

          {activeTab === 'photos' && <PhotosTab observations={allObservations} reports={reports} />}
        </div>

      </div>

      <Toast toast={toast} />
      {confirmDialog}

      {isDecoupageOpen && (
        <DecoupagePanelChantier decoupage={decoupage} projectId={project.id} onSave={saveDecoupage} onClose={() => setIsDecoupageOpen(false)} />
      )}

      {/* New CR modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setIsModalOpen(false)}>
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4 dark:text-white">Nouveau compte-rendu</h3>
            <label className="block text-sm font-bold mb-1 dark:text-zinc-300">Date de la visite</label>
            <input type="date" className="w-full p-2 border rounded-lg mb-4 dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              value={newReportDate} onChange={e => setNewReportDate(e.target.value)} />
            <DecoupageSelects className="flex flex-wrap gap-2 mb-4" decoupage={decoupage}
              batimentId={newReportDecoupage.batiment_id} phaseId={newReportDecoupage.phase_id}
              onChange={patch => setNewReportDecoupage(prev => ({ ...prev, ...patch }))} />
            {project.address && (
              <div className="mb-4 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm">
                {weatherLoading ? 'Récupération météo...' : fetchedWeather ? `${fetchedWeather.meteo} — ${fetchedWeather.temperature}°C` : 'Météo indisponible'}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-semibold dark:text-zinc-300">Annuler</button>
              <button
                onClick={() => handleCreateReport()}
                disabled={weatherLoading}
                title={weatherLoading ? 'Récupération de la météo en cours...' : undefined}
                className="px-4 py-2 bg-[var(--tblr-primary)] hover:brightness-90 disabled:opacity-50 text-white rounded-lg text-sm font-bold"
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

function StatPill({ label, value, accent, hint, title }: { label: string; value: string; accent?: boolean; hint?: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">{label}</p>
      <p className={cn('text-xl font-bold', accent ? 'text-red-600 dark:text-red-400' : 'text-[var(--tblr-text)]')}>{value}</p>
      {hint && <p className="text-[0.6875rem] text-[var(--tblr-muted)] truncate">{hint}</p>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--tblr-surface-2)] p-2.5 text-center">
      <p className="text-lg font-bold text-[var(--tblr-text)]">{value}</p>
      <p className="text-[0.6875rem] uppercase tracking-wider text-[var(--tblr-muted)]">{label}</p>
    </div>
  );
}

function EntreprisesTab({ lots_list, observations }: { lots_list: ProjectLot[]; observations: Observation[] }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
      <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[0.6875rem] tracking-wider">
          <tr>
            <th className="px-4 py-3 text-left">Lot</th>
            <th className="px-4 py-3 text-left">Entreprise</th>
            <th className="px-4 py-3 text-center">Observations (total)</th>
            <th className="px-4 py-3 text-center">À lever (ouvertes)</th>
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
            <span className="font-semibold text-[var(--tblr-primary)] underline underline-offset-2">Réessayer</span>
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
      {caption && <div className="truncate p-2 text-[0.6875rem] text-[var(--tblr-muted)]">{caption}</div>}
    </button>
  );
}
