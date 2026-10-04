import React, { useState, useEffect, useMemo, ChangeEvent, useRef, useId, type Dispatch, type SetStateAction } from 'react';
import CreatableSelect from 'react-select/creatable';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { 
  IconArrowLeft, 
  IconTrash, 
  IconPlus, 
  IconCircleCheck, 
  IconCircle, 
  IconCalendar, 
  IconClock, 
  IconFileInvoice, 
  IconUpload,
  IconExternalLink,
  IconFileCode,
  IconChevronRight,
  IconChevronDown,
  IconChevronUp,
  IconFileText,
  IconFileCheck,
  IconFlag,
  IconCalculator,
  IconHammer,
  IconBook,
  IconCheck,
  IconX,
  IconMessageDots,
  IconRefresh,
  IconSend,
  IconClipboardList,
  IconFileDownload,
  IconAlertCircle,
  IconAlertTriangle,
  IconFilePlus,
  IconCurrencyEuro,
  IconReceipt,
  IconEdit,
  IconUsersGroup,
  IconRubberStamp,
  IconTools,
  IconClipboardCheck,
  } from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { launchOriginRef } from '../lib/launchOrigin';
import { Table, Header, HeaderRow, Body, Row, HeaderCell, Cell } from '@table-library/react-table-library/table';
import { useTheme } from '@table-library/react-table-library/theme';
import { formatCurrency, cn, isFlagTrue } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl, fetchAgencySettings } from '../lib/pdfLetterhead';
import { openSignedUrl } from '../lib/signedStorageUrl';
import { cachedListFirst } from '../lib/offlineReadCache';
import { prefetchProjectForOffline, cachedProjectSnapshot } from '../lib/offlinePrefetch';
import { db } from '../db';
import type { Project, Milestone, Invoice, ProjectCategory, OrdreDeService, AvenantMoe, Visa, Reception, Tender, Reserve, GpaReserve, Permit, Rfi, Plan, DocumentPhase, ProjectPhaseHistoryEntry } from '../types';
import { ReserveTracker } from '../components/pro/ReserveTracker';
import { RESERVE_STATUSES, reserveStatusKey } from '../components/pro/reserveShared';
import { useUser } from '../UserContext';
import { canWriteInvoices } from '../lib/invoicePermissions';
import { isProjectDirty } from '../lib/projectDirty';
import { CHANTIER_ONLY_TABS, DEFAULT_PROJECT_TAB, isProjectTab } from '../lib/projectTabs';
import { ProjectTabBar } from '../components/projectDetail/ProjectTabBar';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useToastWithUndo } from '../hooks/useToastWithUndo';
import { Toast } from '../components/ui/Toast';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import { usePhaseNotes } from '../hooks/usePhaseNotes';
import { nextPhase } from '../lib/phaseJournal';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { useProjectAutosave } from '../hooks/useProjectAutosave';
import { AutosaveIndicator } from '../components/projectDetail/AutosaveIndicator';
import { GeoportailMap, RNBInfo } from '../components/LocationMaps';
import type { CadastreParcel } from '../components/MapLibreCadastre';
import { summarizeParcels } from '../lib/cadastreSelection';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { HistoricalMonuments } from '../components/HistoricalMonuments';
import ACTModule from '../components/ACTModule';
import { ContactAutocomplete } from '../components/ContactAutocomplete';
import { ContactModal } from '../components/ContactModal';
import { CONTACT_CATEGORY_CLIENT, isClientContact } from '../lib/contactCategories';
import { CadastreDownload } from '../components/CadastreDownload';
import { InfoPanelBoundary } from '../components/InfoPanelBoundary';
import { CompanyAutocomplete } from '../components/CompanyAutocomplete';
import ChantierModule from '../components/ChantierModule';
import MilestoneGantt from '../components/MilestoneGantt';
import CorrespondenceTab from '../components/CorrespondenceTab';
import { ProTab } from '../components/pro/ProTab';
import { SituationsTravaux } from '../components/projectDetail/situations/SituationsTravaux';
import { MAF_INTERCALAIRE_OPTIONS, TAUX_MISSION_OPTIONS } from '../lib/mafUtils';
import { useMafCost } from '../hooks/useMafCost';
import { useSettings } from '../hooks/useSettings';
import { MafCostBadge } from '../components/MafCostBadge';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { StatTile, StatTileColor } from '../components/ui/StatTile';
import { PhaseStepper } from '../components/ui/PhaseStepper';
import { ProjectOverview } from '../components/projectDetail/ProjectOverview';
import ProjectTasksTab from '../components/projectDetail/ProjectTasksTab';
import { ResourceAttachments } from '../components/ResourceAttachments';

import { useTranslation } from 'react-i18next';

// Champ de la fiche complète : libellé relié au contrôle (htmlFor), quel que soit son type.
const FormField = ({ label, value, onChange, type = 'text', options = [], required = false, id: idProp }: any) => {
  const { t } = useTranslation();
  const autoId = useId();
  const id = idProp || autoId;
  return (
  <div className="space-y-1">
    <label htmlFor={id} className="block text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase tracking-wider">
      {label} {required && <span className="text-red-500" aria-hidden>*</span>}
    </label>
    {type === 'select' ? (
      <select
        id={id}
        className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-medium"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('projectdetail_field_select')}</option>
        {options.map((opt: string) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    ) : type === 'textarea' ? (
      <textarea
        id={id}
        className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-medium min-h-[80px] resize-none"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    ) : type === 'checkbox' ? (
      <div className="flex items-center gap-2 h-[42px]">
        <input
          id={id}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
        />
        <span className="text-sm text-[var(--tblr-muted)]">{t('projectdetail_field_yes')}</span>
      </div>
    ) : (
      <input 
        id={id}
        type={type}
        className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-medium"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )}
  </div>
  );
};

const MISSION_PHASES: DocumentPhase[] = ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR'];


// Maps ContratMOEMission ids (Contrats.tsx uses 'pro', Proposals.tsx's
// fee_distribution uses 'projet' for the same phase — both are accepted here)
// to the DocumentPhase codes used by the "Phase actuelle" buttons below.
const MISSION_ID_TO_PHASE: Record<string, DocumentPhase> = {
  esquisse: 'ESQ', aps: 'APS', apd: 'APD', pro: 'PRO', projet: 'PRO',
  act: 'ACT', visa: 'VISA', det: 'DET', aor: 'AOR',
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser, setHeaderTitle } = useUser();
  const { t } = useTranslation();
  
  const [project, setProject] = useState<Project | null>(null);
  // La fiche telle qu'elle est en base (dernier chargement ou dernier
  // enregistrement réussi) : c'est elle qui dit s'il reste des saisies à
  // enregistrer.
  const [savedProject, setSavedProject] = useState<Project | null>(null);
  const { toast, showToast } = useToastWithUndo();
  const undoableDelete = useUndoableDelete(showToast);
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  // Suppression définitive (fichiers, visas, réserves...) : confirmée dans une
  // fenêtre de l'application, jamais par la boîte du navigateur.
  const confirmDelete = (titleKey: string) => confirmAction({
    title: t(titleKey),
    message: t('projectdetail_delete_is_final'),
    confirmLabel: t('projectdetail_dialog_delete'),
    cancelLabel: t('projectdetail_dialog_cancel'),
    tone: 'danger',
  });
  // Suppression annulable : l'élément disparaît, « Annuler » le remet à sa
  // place tant que la requête n'est pas partie (src/lib/undoableDelete.ts).
  const deleteWithUndo = <T extends { id: string }>(
    setList: Dispatch<SetStateAction<T[]>>, id: string, url: string, messageKey: string,
  ) => {
    let removed: { item: T; index: number } | null = null;
    undoableDelete({
      message: t(messageKey),
      undoLabel: t('projectdetail_undo'),
      undoneMessage: t('projectdetail_deletion_undone'),
      failureMessage: t('projectdetail_delete_failed'),
      remove: () => setList(prev => {
        const index = prev.findIndex(x => x.id === id);
        if (index === -1) return prev;
        removed = { item: prev[index], index };
        return prev.filter(x => x.id !== id);
      }),
      restore: () => setList(prev => {
        const r = removed as { item: T; index: number } | null;
        if (!r || prev.some(x => x.id === id)) return prev;
        const next = [...prev];
        next.splice(Math.min(r.index, next.length), 0, r.item);
        return next;
      }),
      request: () => fetch(url, { method: 'DELETE', keepalive: true }),
    });
  };
  const { settings } = useSettings();
  const mafCost = useMafCost({ project, mafEnabled: !!(settings as any)?.maf_enabled, tauxContratPermil: parseFloat((settings as any)?.maf_taux_contrat_permil ?? 0) });

  useEffect(() => {
    if (project) {
      setHeaderTitle(project.name);
    }
    return () => setHeaderTitle('Dashboard');
  }, [project, setHeaderTitle]);
  const [team, setTeam] = useState<any[]>([]);
  const [projectMembers, setProjectMembers] = useState<any[]>([]);
  const [phaseHistory, setPhaseHistory] = useState<ProjectPhaseHistoryEntry[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  // Vrai une fois les jalons du projet réellement lus en base : la
  // synchronisation avec le contrat MOE (plus bas) ne doit jamais tourner
  // sur la liste vide initiale.
  const [milestonesLoaded, setMilestonesLoaded] = useState(false);
  const milestoneCreationsInFlight = useRef<Set<string>>(new Set());
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [visas, setVisas] = useState<Visa[]>([]);
  const [receptions, setReceptions] = useState<Reception[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [gpaReserves, setGpaReserves] = useState<GpaReserve[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [projectTenders, setProjectTenders] = useState<Tender[]>([]);
  const [categories, setCategories] = useState<ProjectCategory[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [ordresDeService, setOrdresDeService] = useState<OrdreDeService[]>([]);
  const [avenantsMoe, setAvenantsMoe] = useState<AvenantMoe[]>([]);
  const [marchesTravaux, setMarchesTravaux] = useState<any[]>([]);
  const [linkedContratsMoe, setLinkedContratsMoe] = useState<any[]>([]);
  const phaseNotes = usePhaseNotes(id, t('phase_journal_save_failed'));
  // Phases de la mission : celles du contrat MOE principal (PC et DCE toujours),
  // toutes à défaut de contrat. Partagées par le stepper, la fiche complète et
  // le journal de l'opération.
  const missionPhases = useMemo(() => {
    const primaryContrat = linkedContratsMoe[0];
    const includedPhases = primaryContrat
      ? new Set((primaryContrat.missions_list || []).filter((m: any) => m.incluse).map((m: any) => MISSION_ID_TO_PHASE[m.id]).filter(Boolean))
      : null;
    return MISSION_PHASES.filter(phase => !includedPhases || includedPhases.has(phase) || phase === 'PC' || phase === 'DCE');
  }, [linkedContratsMoe]);
  // Sans historique de phase, la fiche affiche déjà la première phase de la
  // mission : c'est la phase en cours.
  const actualCurrentPhase: DocumentPhase | undefined =
    (phaseHistory.find(p => !p.exited_at)?.phase as DocumentPhase | undefined) || missionPhases[0];
  const upcomingPhase = actualCurrentPhase ? (nextPhase(missionPhases, actualCurrentPhase) ?? null) : null;
  const phaseBadges = useMemo(() => Object.fromEntries(
    Object.entries(phaseNotes.summary).map(([phase, { count, overrun }]) => [phase, {
      count,
      alert: overrun,
      label: overrun ? t('phase_journal_badge_overrun', { count }) : t('phase_journal_badge', { count }),
    }])
  ), [phaseNotes.summary, t]);
  const advancePhase = async () => {
    if (!upcomingPhase || !actualCurrentPhase) return;
    const ok = await confirmAction({
      title: t('project_phase_advance_title', { phase: upcomingPhase }),
      message: t('project_phase_advance_message', { from: actualCurrentPhase, to: upcomingPhase, label: t(`mission_phase_${upcomingPhase}`) }),
      confirmLabel: t('project_phase_advance_confirm', { phase: upcomingPhase }),
      cancelLabel: t('projectdetail_dialog_cancel'),
      tone: 'primary',
    });
    if (ok) await handleSetPhase(upcomingPhase);
  };
  const [notesHonoraires, setNotesHonoraires] = useState<any[]>([]);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [editingNote, setEditingNote] = useState<any | null>(null);
  const [noteForm, setNoteForm] = useState<any>(null);

  const [newOs, setNewOs] = useState({
    title: '',
    os_number: '',
    marche_id: '',
    lot: '',
    entreprise: '',
    maitrise_oeuvre: '',
    montant_devis_presente: '',
    date_emission: new Date().toISOString().slice(0, 10),
    emetteur_os: '',
    destinataire_os: '',
    delai_execution: '',
    delai_unit: 'jours',
    objet: '',
  });
  // Formulaire de création rapide d'un marché travaux, ouvert depuis le
  // formulaire OS quand le projet n'en a encore aucun — un OS doit toujours
  // être rattaché à un marché (server/routes/ordresDeService.ts).
  const [isAddingMarche, setIsAddingMarche] = useState(false);
  const [newMarche, setNewMarche] = useState({ entreprise_nom: '', lot_numero: '', lot_titre: '', montant_ht: '' });

  // AR modal state
  const [arOsTarget, setArOsTarget] = useState<OrdreDeService | null>(null);
  const [showDeleteProjectConfirm, setShowDeleteProjectConfirm] = useState(false);
  const [deleteProjectConfirmInput, setDeleteProjectConfirmInput] = useState('');
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [arForm, setArForm] = useState({ date_ar: new Date().toISOString().slice(0, 10), date_execution: '', notes_ar: '' });
  const [arSaving, setArSaving] = useState(false);

  const [newOsMoe, setNewOsMoe] = useState({
    title: '',
    os_number: '',
    montant_devis_presente: '',
    objet: 'extension_mission' as string,
    description: '',
    origine_demande: 'maitrise_ouvrage' as string,
    date: new Date().toISOString().split('T')[0],
    date_signature: '',
    incidences_delais_type: 'non' as 'non' | 'oui',
    incidences_delais_details: '',
    delai_execution: '' as string,
  });

  const [isAddingOs, setIsAddingOs] = useState(false);
  const [isAddingOsMoe, setIsAddingOsMoe] = useState(false);

  // VISA modal state
  const [isVisaModalOpen, setIsVisaModalOpen] = useState(false);
  const [editingVisa, setEditingVisa] = useState<Visa | null>(null);
  const [visaForm, setVisaForm] = useState({ title: '', date: new Date().toISOString().split('T')[0], status: 'pending' as Visa['status'], comments: '', lot_id: '' });
  const [visaFile, setVisaFile] = useState<File | null>(null);
  const [visaSaving, setVisaSaving] = useState(false);
  const [visaExpandedGroups, setVisaExpandedGroups] = useState<Record<string, boolean>>({});
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [generatingInvoiceNoteId, setGeneratingInvoiceNoteId] = useState<string | null>(null);
  const [isAddingMilestone, setIsAddingMilestone] = useState(false);
  const [isAddingPermit, setIsAddingPermit] = useState(false);
  const [newPermit, setNewPermit] = useState({ type: 'PC' as 'PC' | 'DP' | 'AT', reference: '', submission_date: '', decision_date: '', status: 'en_instruction' as Permit['status'], notes: '' });
  const [expandedPermitId, setExpandedPermitId] = useState<string | null>(null);
  const [isAddingRfi, setIsAddingRfi] = useState(false);
  const [newRfi, setNewRfi] = useState({ question: '', asked_by: '', due_date: '' });
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newMilestoneDate, setNewMilestoneDate] = useState('');
  // L'onglet ouvert vit dans l'adresse (?tab=) : il survit au rechargement et
  // au retour arrière depuis un autre écran, et se partage par lien.
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(() => {
    const tab = searchParams.get('tab');
    return isProjectTab(tab) ? tab : DEFAULT_PROJECT_TAB;
  });
  const [showFullEditor, setShowFullEditor] = useState(false);
  // Which phase's notes are shown in the overview's "Note de phase" column.
  // Distinct from the project's actual current phase (phaseHistory) — the
  // topbar pills only change this, they never transition the real mission
  // phase. `null` means "follow the actual current phase".
  const [viewedPhase, setViewedPhase] = useState<DocumentPhase | null>(null);
  const [projectActivity, setProjectActivity] = useState<any[]>([]);
  const [updatingPlanId, setUpdatingPlanId] = useState<string | null>(null);
  const [planUploading, setPlanUploading] = useState(false);
  const planInputRef = useRef<HTMLInputElement>(null);

  // Reception PV form state
  const [showPvForm, setShowPvForm] = useState(false);
  const [editingReceptionId, setEditingReceptionId] = useState<string | null>(null);
  const [expandedPvId, setExpandedPvId] = useState<string | null>(null);
  const defaultPvForm = () => ({
    reference_pv: '',
    type: 'provisoire' as 'provisoire' | 'definitive',
    date: new Date().toISOString().split('T')[0],
    lieu: '',
    date_limite_levee: '',
    has_reserves: false,
    reserves_count: 0,
    signataires: [] as { nom: string; role: string }[],
    observations: '',
    pv_valide: false,
    reserves_list: [] as { id: string; title: string; batiment: string; local: string; lots: string; entreprises: string; due_date: string; status: string }[],
  });
  const [pvForm, setPvForm] = useState(defaultPvForm());

  // Extrait de l'onClick « Modifier » d'un PV de réception (onglet AOR) pour
  // être réutilisable depuis le lien direct d'un agent (?open=receptions:<id>
  // sur cette page, voir recordLinks.ts et l'effet de lien direct plus bas).
  const openReceptionForm = (rec: Reception) => {
    setEditingReceptionId(rec.id);
    const existingReserves = reserves.filter(r => r.reception_id === rec.id);
    setPvForm({
      reference_pv: rec.reference_pv || '',
      type: rec.type,
      date: rec.date,
      lieu: rec.lieu || '',
      date_limite_levee: rec.date_limite_levee || '',
      has_reserves: rec.has_reserves,
      reserves_count: rec.reserves_count || 0,
      signataires: rec.signataires ? JSON.parse(rec.signataires) : [],
      observations: rec.observations || '',
      pv_valide: rec.pv_valide || false,
      reserves_list: existingReserves.map(r => ({
        id: r.id,
        title: r.title,
        batiment: r.batiment || '',
        local: r.local || '',
        lots: (() => { try { const p = JSON.parse(r.lots); return Array.isArray(p) ? p.join(', ') : r.lots; } catch { return r.lots || ''; } })(),
        entreprises: (() => { try { const p = JSON.parse(r.entreprises); return Array.isArray(p) ? p.join(', ') : r.entreprises; } catch { return r.entreprises || ''; } })(),
        due_date: r.due_date || '',
        status: r.status,
      })),
    });
    setShowPvForm(true);
  };

  // DOE documents state
  const [doeDocuments, setDoeDocuments] = useState<any[]>([]);
  const doeInputRef = useRef<HTMLInputElement>(null);
  const [doeUploading, setDoeUploading] = useState(false);
  const [doeContactId, setDoeContactId] = useState('');
  const [doeExpandedGroups, setDoeExpandedGroups] = useState<Record<string, boolean>>({});
  const [editingDoeId, setEditingDoeId] = useState<string | null>(null);
  const [editDoeContactId, setEditDoeContactId] = useState('');
  const [editDoeComments, setEditDoeComments] = useState('');

  useEffect(() => {
    if (project && !project.is_chantier && (CHANTIER_ONLY_TABS as readonly string[]).includes(activeTab)) {
      setActiveTab('INFOS');
    }
  }, [project?.is_chantier, activeTab]);

  // Lien direct depuis un agent (?tab=<ONGLET>&open=<resourceKey>:<id>, voir
  // recordLinks.ts côté serveur) : sept ressources n'ont pas de page propre
  // et vivent comme onglets de cette fiche. `openResourceKey`/`openRecordId`
  // sont calculés au rendu (pas dans un effet) pour rester disponibles dès
  // le premier rendu du prop `initialOpenReserveId` de ReserveTracker plus
  // bas, qui gère lui-même 'reserves'.
  const openParam = searchParams.get('open') || '';
  const [openResourceKey, openRecordId] = openParam.split(':');

  // Adresse -> onglet : un lien (agent, aperçu « Prochaines tâches ») qui
  // change `?tab=` sans quitter la fiche.
  useEffect(() => {
    const tab = searchParams.get('tab');
    const wanted = isProjectTab(tab) ? tab : DEFAULT_PROJECT_TAB;
    setActiveTab(prev => (prev === wanted ? prev : wanted));
  }, [searchParams]);

  // Onglet -> adresse, en remplaçant l'entrée d'historique : changer d'onglet
  // ne doit pas obliger à remonter dix fois le bouton Retour pour quitter la
  // fiche. L'onglet par défaut n'apparaît pas dans l'adresse.
  useEffect(() => {
    const wanted = activeTab === DEFAULT_PROJECT_TAB ? null : activeTab;
    if (searchParams.get('tab') === wanted) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (wanted) next.set('tab', wanted); else next.delete('tab');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (!openParam) return;
    if (openResourceKey === 'visas') {
      if (visas.length === 0) return; // pas encore chargées — on réessaiera au prochain rendu
      const visa = visas.find(v => v.id === openRecordId);
      if (visa) { setEditingVisa(visa); setIsVisaModalOpen(true); }
    } else if (openResourceKey === 'receptions') {
      if (receptions.length === 0) return;
      const rec = receptions.find(r => r.id === openRecordId);
      if (rec) openReceptionForm(rec);
    }
    // 'reserves' est consommé directement par ReserveTracker via son prop
    // initialOpenReserveId (calculé ci-dessus) ; milestones/permits/
    // marches_entreprises/notes_honoraires n'ont que l'onglet déjà posé par
    // l'effet précédent (voir recordLinks.ts) — rien de plus à faire ici
    // dans les deux cas, seulement nettoyer le paramètre.
    setSearchParams(prev => { prev.delete('open'); return prev; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visas, receptions, searchParams]);

  useEffect(() => {
    // Unconditional (not tab-gated): the "Phase actuelle" buttons (INFOS tab)
    // and the mission→milestone sync below both need this regardless of
    // whether the user has opened the HONOS tab yet.
    if (id) {
      fetch('/api/contrats_moe')
        .then(r => r.json())
        .then((all: any[]) => setLinkedContratsMoe((all || []).filter((c: any) => c.project_id === id)))
        .catch(() => {});
    }
  }, [id]);

  // Keep project milestones in sync with the missions included in the linked
  // ContratMOE (one milestone per included mission, matched by title — same
  // principle used for proposal milestones in Proposals.tsx's FeeDistributionGrid).
  //
  // Cet effet ne tourne qu'une fois les jalons LUS EN BASE (`milestonesLoaded`) :
  // il se déclenchait auparavant dès l'arrivée du contrat, alors que la liste
  // des jalons était encore vide, et recréait donc TOUS les jalons de mission
  // à chaque ouverture de la fiche — d'où les « Esquisse (ESQ) » en double,
  // triple, dans « Prochains jalons ». `milestoneCreationsInFlight` évite le
  // même doublon entre deux exécutions rapprochées de l'effet (le contrat
  // relu avant que la création précédente n'ait répondu).
  useEffect(() => {
    if (!id || !milestonesLoaded) return;
    const primaryContrat = linkedContratsMoe[0];
    if (!primaryContrat) return;
    const includedMissions: any[] = (primaryContrat.missions_list || []).filter((m: any) => m.incluse);
    if (includedMissions.length === 0) return;

    const projectMilestones = milestones.filter(m => m.project_id === id);
    const inFlight = milestoneCreationsInFlight.current;

    includedMissions.forEach(mission => {
      if (!projectMilestones.some(m => m.title === mission.name) && !inFlight.has(mission.name)) {
        inFlight.add(mission.name);
        fetch('/api/milestones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: id, title: mission.name, due_date: new Date().toISOString(), completed: false, duration_days: 30 }),
        })
          .then(res => res.ok ? res.json() : null)
          .then(created => { if (created) setMilestones(prev => [...prev, { ...created, completed: !!created.completed }]); })
          .catch(console.error)
          .finally(() => inFlight.delete(mission.name));
      }
    });

    // Les doublons laissés par l'ancien comportement : pour chaque mission du
    // contrat, un seul jalon reste — celui déjà coché, sinon le plus ancien
    // — les autres sont supprimés.
    const toDelete = new Set<string>();
    includedMissions.forEach(mission => {
      const sameTitle = projectMilestones.filter(m => m.title === mission.name);
      if (sameTitle.length <= 1) return;
      const keep = sameTitle.find(m => m.completed)
        || [...sameTitle].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
      sameTitle.forEach(m => { if (m.id !== keep.id) toDelete.add(m.id); });
    });

    projectMilestones.forEach(m => {
      if (!includedMissions.some(mission => mission.name === m.title)) toDelete.add(m.id);
    });

    toDelete.forEach(milestoneId => {
      fetch(`/api/milestones/${milestoneId}`, { method: 'DELETE' })
        .then(() => setMilestones(prev => prev.filter(x => x.id !== milestoneId)))
        .catch(console.error);
    });
  }, [linkedContratsMoe, id, milestonesLoaded]);

  // Le contrat MOE fait foi pour les montants d'honoraires du projet : le
  // contrat signé s'il en existe un, à défaut le premier contrat lié.
  const contratHonoraires = useMemo(
    () => linkedContratsMoe.find((c: any) => c.status === 'Signé') || linkedContratsMoe[0] || null,
    [linkedContratsMoe],
  );

  // Seule la fiche (aperçu, fiche complète, champs HONOS) attend le bouton
  // Enregistrer : notes, avenants, jalons et documents s'écrivent seuls. Les
  // montants repris du contrat lié ne comptent pas comme une saisie.
  const isDirty = useMemo(
    () => isProjectDirty(savedProject as any, project as any, { contractLinked: !!contratHonoraires }),
    [savedProject, project, contratHonoraires],
  );
  // La fiche s'enregistre seule (plus de bouton Enregistrer) : la garde de
  // sortie ne se déclenche plus que si l'enregistrement a échoué ou ne peut
  // pas se faire. Une modification encore en attente part au départ de
  // l'écran (useProjectAutosave).
  const { status: autosaveStatus, saveNow } = useProjectAutosave(project, isDirty, sent => setSavedProject(sent));
  const { confirmDiscard } = useUnsavedChangesGuard(
    isDirty && (autosaveStatus === 'error' || autosaveStatus === 'invalid'),
    t('projectdetail_confirm_leave_unsaved'),
  );
  const leaveToProjects = () => { if (confirmDiscard()) navigate('/projects'); };

  // Échap referme les fenêtres de la fiche, sauf pendant un enregistrement
  // ou une suppression en cours.
  useEscapeKey(isVisaModalOpen, () => setIsVisaModalOpen(false));
  useEscapeKey(!!arOsTarget, () => { if (!arSaving) setArOsTarget(null); });
  useEscapeKey(showDeleteProjectConfirm, () => { if (!isDeletingProject) setShowDeleteProjectConfirm(false); });

  // Onglets de phase chantier gouvernés par une mission du contrat MOE : le
  // contrat fait foi (même principe que HONOS ci-dessus), donc un onglet
  // sans mission incluse est masqué — sauf s'il porte déjà des données,
  // pour ne jamais donner l'impression qu'elles ont disparu (il reste alors
  // affiché avec un badge « hors mission »). Sans contrat lié, impossible de
  // savoir si la mission est prévue : on garde le repli historique (gate sur
  // is_chantier seul). RDT n'a pas de mission MOP dédiée et suit DET.
  const CHANTIER_TAB_MISSION_ID: Partial<Record<string, string>> = {
    ACT: 'act', VISA: 'visa', DET: 'det', RDT: 'det', AOR: 'aor',
  };
  const chantierTabState = useMemo(() => {
    const missionsList = contratHonoraires?.missions_list;
    const hasData: Record<string, boolean> = {
      ACT: marchesTravaux.length > 0,
      VISA: visas.length > 0,
      DET: ordresDeService.length > 0 || marchesTravaux.length > 0,
      RDT: ordresDeService.length > 0 || marchesTravaux.length > 0,
      AOR: receptions.length > 0 || reserves.length > 0,
    };
    const result: Record<string, { visible: boolean; horsMission: boolean }> = {};
    for (const tabId of Object.keys(CHANTIER_TAB_MISSION_ID)) {
      if (!contratHonoraires || !missionsList) {
        result[tabId] = { visible: true, horsMission: false };
        continue;
      }
      const missionId = CHANTIER_TAB_MISSION_ID[tabId]!;
      const incluse = missionsList.some((m: any) => m.id === missionId && m.incluse);
      result[tabId] = incluse
        ? { visible: true, horsMission: false }
        : { visible: hasData[tabId], horsMission: hasData[tabId] };
    }
    return result;
  }, [contratHonoraires, marchesTravaux, visas, ordresDeService, receptions, reserves]);

  // Rapatrie les honoraires initiaux et le coût travaux prévisionnel depuis le
  // contrat MOE lié, plutôt que de laisser ces montants — déjà saisis dans le
  // contrat — à ressaisir manuellement ici. Dès qu'un contrat est lié, c'est
  // LUI qui fait foi : la synchronisation est inconditionnelle (elle ne se
  // limite plus aux champs restés vides côté projet) et les deux champs
  // passent en lecture seule dans l'onglet HONOS, pour qu'une valeur saisie
  // ici ne puisse plus diverger de la pièce contractuelle. Les avenants, eux,
  // continuent de s'ajouter par-dessus (`honRevises`) sans toucher au montant
  // initial.
  useEffect(() => {
    if (!project) return;
    if (!contratHonoraires) return;

    setProject(prev => {
      if (!prev) return prev;
      // En mode pourcentage, le budget travaux du contrat prime, mais un coût
      // travaux déjà saisi côté projet (avant même la liaison au contrat)
      // reste utilisable pour calculer le montant tant que le contrat n'en
      // porte pas un lui-même.
      const budgetTravaux = contratHonoraires.budget_previsionnel || prev.construction_cost;
      const honorairesContrat = contratHonoraires.mode_honoraires === 'forfait'
        ? contratHonoraires.montant_honoraires
        : (budgetTravaux && contratHonoraires.taux_honoraires ? budgetTravaux * contratHonoraires.taux_honoraires / 100 : undefined);

      const patch: Partial<Project> = {};
      if (honorairesContrat && prev.remuneration !== honorairesContrat) patch.remuneration = honorairesContrat;
      if (contratHonoraires.budget_previsionnel && prev.construction_cost !== contratHonoraires.budget_previsionnel) {
        patch.construction_cost = contratHonoraires.budget_previsionnel;
      }
      return Object.keys(patch).length > 0 ? { ...prev, ...patch } : prev;
    });
    // `project?.remuneration`/`construction_cost` sont bien des dépendances,
    // pas seulement le résultat de cet effet : `fetchFullProject()` recharge
    // le projet en entier (cache Dexie, puis réseau) de façon indépendante et
    // peut résoudre APRÈS cette synchronisation, écrasant alors le montant
    // repris du contrat par la valeur non persistée côté base (0). Sans ces
    // dépendances, l'effet ne se redéclenche jamais pour corriger ce retour
    // en arrière — c'est exactement le bug observé (montant du contrat
    // affiché puis retombé à 0,00 €).
  }, [contratHonoraires, project?.id, project?.remuneration, project?.construction_cost]);

  useEffect(() => {
    if (activeTab === 'HONOS' && id) {
      fetch(`/api/notes_honoraires?project_id=${id}`)
        .then(r => r.json())
        .then((data: any[]) => setNotesHonoraires(data || []))
        .catch(() => {});
    }
  }, [activeTab, id]);

  useEffect(() => {
    if (id) {
      fetchFullProject();
      fetchCategories();
      fetchContacts();
      fetchTeam();
      fetchProjectTenders();
      fetchProjectMembers();
      fetchPhaseHistory();
      fetchProjectActivity();
      fetchGpaReserves();
      fetchPermits();
      fetchRfis();
    }
  }, [id]);

  useEffect(() => {
    if (activeTab === 'AOR' && id) {
      fetchDoeDocuments();
    }
  }, [activeTab, id]);

  // Memoized derived data — these were recomputed inline with filter()/reduce()
  // in several places in the JSX below (up to 4x for the MOE avenants alone),
  // rescanning ordresDeService/invoices/reserves on every render even when
  // typing in an unrelated form field elsewhere in this component.
  const moeAvenants = avenantsMoe;
  const moeAvenantsApprouves = useMemo(
    () => moeAvenants.filter(o => o.status === 'approved'),
    [moeAvenants]
  );
  const cumulAvenantsApprouves = useMemo(
    () => moeAvenantsApprouves.reduce((s, o) => s + (Number(o.montant_devis_accepte ?? o.montant_devis_presente) || 0), 0),
    [moeAvenantsApprouves]
  );
  const totalInvoicesPaid = useMemo(
    () => invoices.filter(i => i.status === 'Paid').reduce((s, i) => s + i.amount, 0),
    [invoices]
  );
  // Groups reserves by reception_id once instead of re-filtering the whole
  // reserves array for every reception row in the PV table below.
  const reservesByReceptionId = useMemo(() => {
    const map = new Map<string, Reserve[]>();
    for (const r of reserves) {
      if (!r.reception_id) continue;
      const list = map.get(r.reception_id);
      if (list) list.push(r); else map.set(r.reception_id, [r]);
    }
    return map;
  }, [reserves]);

  const fetchProjectMembers = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/projects/${id}/members`);
      if (res.ok) { const data = await res.json(); setProjectMembers(Array.isArray(data) ? data : []); }
    } catch (err) { console.error('Failed to fetch project members:', err); }
  };

  const fetchPhaseHistory = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/projects/${id}/phase-history`);
      if (res.ok) { const data = await res.json(); setPhaseHistory(Array.isArray(data) ? data : []); }
    } catch (err) { console.error('Failed to fetch project phase history:', err); }
  };

  const fetchProjectActivity = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/projects/${id}/activity`);
      if (res.ok) { const data = await res.json(); setProjectActivity(Array.isArray(data) ? data : []); }
    } catch (err) { console.error('Failed to fetch project activity:', err); }
  };

  const handleSetPhase = async (phase: DocumentPhase) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/projects/${id}/phase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase }),
      });
      if (res.ok) {
        fetchPhaseHistory();
        fetchProjectActivity();
        setViewedPhase(null); // resync the overview's note column to the new actual phase
      } else {
        const err = await res.json().catch(() => null);
        showToast(t('projectdetail_phase_change_failed_detail', { error: err?.error || res.statusText }), 'error', { duration: 6000 });
      }
    } catch (err) {
      console.error('Failed to update project phase:', err);
      showToast(t('projectdetail_phase_change_failed'), 'error', { duration: 6000 });
    }
  };

  const applyFullProjectData = (data: any) => {
    const loaded = {
      ...data.project,
      is_complete_mission: isFlagTrue(data.project.is_complete_mission),
      is_chantier: isFlagTrue(data.project.is_chantier),
    };
    setProject(loaded);
    setSavedProject(loaded);
    setMilestones(data.milestones.map((m: any) => ({ ...m, completed: !!m.completed })));
    setMilestonesLoaded(true);
    setInvoices(data.invoices);
    setOrdresDeService(data.ordres_de_service);
    setAvenantsMoe(data.avenants_moe || []);
    setMarchesTravaux(data.marches_entreprises || []);
    setVisas(data.visas);
    setReceptions(data.receptions);
    setReserves(data.reserves);
    setPlans(data.plans);
  };

  // Cache d'abord (src/lib/offlinePrefetch.ts) : un projet ouvert en ligne au
  // moins une fois — coché « disponible hors connexion » ou non — garde un
  // instantané consultable si le réseau tombe ensuite. Pour un projet
  // volontairement préchargé, l'instantané peut même dater d'avant la toute
  // première ouverture de sa fiche aujourd'hui.
  const fetchFullProject = async () => {
    const cached = await cachedProjectSnapshot(id!);
    if (cached) applyFullProjectData(cached);
    if (!navigator.onLine) return;
    try {
      const res = await fetch(`/api/projects/${id}/full`);
      if (res.ok) {
        const data = await res.json();
        applyFullProjectData(data);
        await db.projectSnapshots.put({ id: id!, data, cachedAt: Date.now() });
      } else if (!cached) {
        navigate('/projects');
      }
    } catch (err) {
      console.error('Failed to fetch full project:', err);
      // Coupure réseau après le rendu depuis le cache (s'il y en avait un) :
      // on garde ce qui est déjà affiché plutôt que de naviguer ailleurs.
    }
  };

  const fetchVisas = async () => {
    try {
      const res = await fetch(`/api/visas?project_id=${id}`);
      if (res.ok) setVisas(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchReceptions = async () => {
    try {
      const res = await fetch(`/api/receptions?project_id=${id}`);
      if (res.ok) setReceptions(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  // Cache d'abord (src/lib/offlineReadCache.ts) : hors-ligne, les réserves
  // déjà consultées pour cette affaire restent affichées.
  const fetchReserves = async () => {
    try {
      await cachedListFirst(db.reservesCache, r => r.project_id === id, `/api/reserves?project_id=${id}`, setReserves);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchGpaReserves = async () => {
    try {
      await cachedListFirst(db.gpaReservesCache, r => r.project_id === id, `/api/gpa-reserves?project_id=${id}`, setGpaReserves);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchPermits = async () => {
    try {
      const res = await fetch(`/api/permits?project_id=${id}`);
      if (res.ok) setPermits(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchRfis = async () => {
    try {
      const res = await fetch(`/api/rfis?project_id=${id}`);
      if (res.ok) setRfis(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchPlans = async () => {
    try {
      const res = await fetch(`/api/plans?project_id=${id}`);
      if (res.ok) setPlans(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDoeDocuments = async () => {
    try {
      const res = await fetch(`/api/documents?project_id=${id}&doc_type=DOE`);
      if (res.ok) {
        const data = await res.json();
        setDoeDocuments(data.filter((d: any) => d.doc_type === 'DOE'));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchProjectTenders = async () => {
    try {
      const res = await fetch('/api/tenders');
      if (res.ok) setProjectTenders(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTeam = async () => {
    try {
      const res = await fetch('/api/team');
      if (res.ok) {
        const data = await res.json();
        setTeam(data);
      }
    } catch (err) {
      console.error('Failed to fetch team:', err);
    }
  };

  const fetchOrdresDeService = async () => {
    try {
      const res = await fetch(`/api/ordres_de_service?project_id=${id}`);
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          setOrdresDeService(data);
        } catch (e) {
          console.error("Failed to parse OS JSON:", text);
        }
      } else {
        console.error("Failed to fetch OS:", res.status, await res.text());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAvenantsMoe = async () => {
    try {
      const res = await fetch(`/api/avenants_moe?project_id=${id}`);
      if (res.ok) setAvenantsMoe(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMarchesTravaux = async () => {
    try {
      const res = await fetch(`/api/marches-entreprises/${id}`);
      if (res.ok) setMarchesTravaux(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await fetch('/api/contacts');
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          setContacts(data);
        } catch (e) {
          console.error("Failed to parse contacts JSON:", text);
        }
      } else {
        console.error("Failed to fetch contacts:", res.status, await res.text());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchProject = fetchFullProject;

  const fetchMilestones = async () => {
    try {
      const res = await fetch(`/api/milestones?project_id=${id}`);
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data)) { setMilestones(data.map((m: any) => ({ ...m, completed: !!m.completed }))); setMilestonesLoaded(true); }
        } catch (e) {
          console.error("Failed to parse milestones JSON:", text);
        }
      } else {
        console.error("Failed to fetch milestones:", res.status, await res.text());
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (project && !newOs.maitrise_oeuvre) {
      setNewOs(prev => ({ ...prev, maitrise_oeuvre: project.project_manager || '' }));
    }
  }, [project]);

  // Numérotation par marché, plutôt que par nom d'entreprise en texte libre :
  // un OS s'adresse toujours à un marché de travaux (marche_id).
  const getNextOsNumberForMarche = (marcheId: string) => {
    if (!marcheId) return '';
    const count = ordresDeService.filter(os => os.marche_id === marcheId).length;
    return (count + 1).toString().padStart(2, '0');
  };

  const handleMarcheChange = (marcheId: string) => {
    const marche = marchesTravaux.find((m: any) => m.id === marcheId);
    const entreprise = marche?.entreprise_nom || '';
    const lot = marche ? [marche.lot_numero, marche.lot_titre].filter(Boolean).join(' — ') : '';
    setNewOs(prev => ({
      ...prev,
      marche_id: marcheId,
      lot,
      entreprise,
      destinataire_os: entreprise,
      os_number: getNextOsNumberForMarche(marcheId),
    }));
  };

  const handleCreateMarche = async () => {
    if (!id || !newMarche.entreprise_nom) return;
    const res = await fetch('/api/marches-entreprises', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: id, entreprise_nom: newMarche.entreprise_nom,
        lot_numero: newMarche.lot_numero, lot_titre: newMarche.lot_titre,
        montant_ht: Number(newMarche.montant_ht) || 0,
      }),
    });
    if (res.ok) {
      const created = await res.json();
      await fetchMarchesTravaux();
      handleMarcheChange(created.id);
      setNewMarche({ entreprise_nom: '', lot_numero: '', lot_titre: '', montant_ht: '' });
      setIsAddingMarche(false);
    } else {
      showToast(t('projectdetail_marche_create_failed'), 'error', { duration: 6000 });
    }
  };

  const fetchInvoices = async () => {
    try {
      const res = await fetch(`/api/invoices?project_id=${id}`);
      if (res.ok) {
        setInvoices(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch invoices:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/project_categories');
      if (res.ok) {
        const text = await res.text();
        try {
          setCategories(JSON.parse(text));
        } catch (e) {
          console.error("Failed to parse categories JSON:", text);
        }
      } else {
        console.error("Failed to fetch categories:", res.status, await res.text());
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Ctrl+S (Cmd+S sur Mac) envoie tout de suite l'enregistrement en attente,
  // au lieu d'ouvrir la boîte « Enregistrer la page » du navigateur.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow]);

  const handleDelete = async () => {
    if (!project) return;
    setIsDeletingProject(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (res.ok) {
        navigate('/projects');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeletingProject(false);
    }
  };

  const handleAddMilestone = async () => {
    if (!id || !newMilestoneTitle || !newMilestoneDate) return;
    try {
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: id,
          title: newMilestoneTitle,
          due_date: newMilestoneDate,
          completed: false
        })
      });
      if (res.ok) {
        const newM = await res.json();
        setMilestones(prev => [...prev, { ...newM, completed: !!newM.completed }].sort((a, b) => a.due_date.localeCompare(b.due_date)));
        setNewMilestoneTitle('');
        setNewMilestoneDate('');
        setIsAddingMilestone(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleMilestone = async (milestone: Milestone) => {
    try {
      const res = await fetch(`/api/milestones/${milestone.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...milestone, completed: !milestone.completed })
      });
      if (res.ok) {
        setMilestones(prev => prev.map(m => m.id === milestone.id ? { ...m, completed: !m.completed } : m));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateOs = async () => {
    if (!id || !newOs.title || !newOs.os_number || !newOs.marche_id) return;
    try {
      const res = await fetch('/api/ordres_de_service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: id,
          marche_id: newOs.marche_id,
          os_number: newOs.os_number,
          title: newOs.title,
          lot: newOs.lot,
          entreprise: newOs.entreprise || newOs.destinataire_os,
          maitrise_oeuvre_adresse: newOs.maitrise_oeuvre,
          montant_devis_presente: Number(newOs.montant_devis_presente) || null,
          date: newOs.date_emission || new Date().toISOString().slice(0, 10),
          date_emission: newOs.date_emission || new Date().toISOString().slice(0, 10),
          emetteur_os: newOs.emetteur_os || newOs.maitrise_oeuvre,
          destinataire_os: newOs.destinataire_os || newOs.entreprise,
          delai_execution: Number(newOs.delai_execution) || null,
          delai_unit: newOs.delai_unit,
          objet: newOs.objet,
          status: 'draft',
          type: 'travaux'
        })
      });
      if (res.ok) {
        await fetchOrdresDeService();
        setNewOs({ title: '', os_number: '', marche_id: '', lot: '', entreprise: '', maitrise_oeuvre: project?.project_manager || '', montant_devis_presente: '', date_emission: new Date().toISOString().slice(0, 10), emetteur_os: '', destinataire_os: '', delai_execution: '', delai_unit: 'jours', objet: '' });
        setIsAddingOs(false);
      } else {
        const err = await res.json().catch(() => null);
        showToast(err?.error || t('projectdetail_os_create_failed'), 'error', { duration: 6000 });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateOsMoe = async () => {
    if (!id || !newOsMoe.title || !newOsMoe.os_number) return;
    const contratMoeId = (linkedContratsMoe.find((c: any) => c.status === 'Signé') || linkedContratsMoe[0])?.id;
    if (!contratMoeId) return;
    try {
      const res = await fetch('/api/avenants_moe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: id,
          contrat_moe_id: contratMoeId,
          os_number: newOsMoe.os_number,
          title: newOsMoe.title,
          objet: newOsMoe.objet || null,
          description: newOsMoe.description || null,
          origine_demande: newOsMoe.origine_demande || null,
          date: newOsMoe.date || new Date().toISOString().split('T')[0],
          date_signature: newOsMoe.date_signature || null,
          incidences_delais_type: newOsMoe.incidences_delais_type,
          incidences_delais_details: newOsMoe.incidences_delais_details || null,
          delai_execution: newOsMoe.delai_execution ? Number(newOsMoe.delai_execution) : null,
          montant_devis_presente: Number(newOsMoe.montant_devis_presente) || null,
          status: 'draft',
        })
      });
      if (res.ok) {
        await fetchAvenantsMoe();
        setNewOsMoe({ title: '', os_number: '', montant_devis_presente: '', objet: 'extension_mission', description: '', origine_demande: 'maitrise_ouvrage', date: new Date().toISOString().split('T')[0], date_signature: '', incidences_delais_type: 'non', incidences_delais_details: '', delai_execution: '' });
        setIsAddingOsMoe(false);
      } else {
        const err = await res.json().catch(() => null);
        showToast(err?.error || t('projectdetail_avenant_create_failed'), 'error', { duration: 6000 });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const generateAvenantPdf = async (os: AvenantMoe, projectName: string, honorairesInitiaux: number, cumulAvenants: number) => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, margin = 20;
    const TYPE_LABELS: Record<string, string> = {
      extension_mission: "Extension de mission",
      modification_programme: "Modification de programme",
      revision_honoraires: "Révision des honoraires",
      imprevus: "Imprévus / Aléas",
      autre: "Autre",
    };
    const ORIGINE_LABELS: Record<string, string> = {
      maitrise_ouvrage: "Maîtrise d'ouvrage", maitrise_oeuvre: "Maîtrise d'œuvre",
      aleas: "Aléas", autres: "Autres",
    };

    const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
    const GRIS_DOUX: [number, number, number] = [107, 114, 128];
    const GRIS_FOND: [number, number, number] = [243, 244, 246];

    // En-tête et pied du cabinet, comme les autres documents.
    const agence = await fetchAgencySettings();
    const logo = await loadLogoDataUrl(agence.logoUrl);
    const letterhead = {
      title: "Avenant au contrat de maîtrise d'œuvre",
      subtitle: `N° Avenant : ${os.os_number}`,
      reference: os.date ? new Date(os.date).toLocaleDateString('fr-FR') : undefined,
      margin, logo,
    };
    const headerEnd = drawAgencyHeader(doc, agence, letterhead);
    doc.setTextColor(...GRIS_DOUX); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text(`Projet : ${projectName}`, margin, headerEnd + 1);
    doc.text(TYPE_LABELS[os.objet || ''] || (os.objet || 'Avenant'), W - margin, headerEnd + 1, { align: 'right' });

    let y = headerEnd + 9;
    const section = (title: string) => {
      doc.setFillColor(...GRIS_FOND);
      doc.rect(margin, y, W - 2 * margin, 7, 'F');
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTE);
      doc.text(title, margin + 3, y + 5); y += 11;
    };
    const row = (label: string, value: string, x = margin, w = W - 2 * margin) => {
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_DOUX);
      doc.text(label.toUpperCase(), x, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIS_TEXTE);
      const lines = doc.splitTextToSize(value || '—', w - 2);
      doc.text(lines, x, y + 5); y += 5 + lines.length * 4 + 3;
    };

    // Identification
    section('1. IDENTIFICATION');
    const col = (W - 2 * margin - 5) / 2;
    const y0 = y; row('Objet', os.title, margin, col); const y1 = y;
    y = y0; row('Type d\'avenant', TYPE_LABELS[os.objet || ''] || '—', margin + col + 5, col); y = Math.max(y, y1);
    const y2 = y; row('Origine de la demande', ORIGINE_LABELS[os.origine_demande || ''] || '—', margin, col); const y3 = y;
    y = y2; row('Date de l\'avenant', os.date ? new Date(os.date).toLocaleDateString('fr-FR') : '—', margin + col + 5, col); y = Math.max(y, y3);

    // Motif
    if (os.description) { section('2. MOTIF ET DESCRIPTION'); row('Motif détaillé', os.description); }

    // Financier
    section('3. IMPACT FINANCIER');
    const montantPres = Number(os.montant_devis_presente) || 0;
    const montantAcc = Number(os.montant_devis_accepte ?? os.montant_devis_presente) || 0;
    autoTable(doc, {
      startY: y, margin: { left: margin, right: margin },
      head: [['', 'Montant HT']],
      body: [
        ['Honoraires initiaux du contrat', honorairesInitiaux > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(honorairesInitiaux) : '—'],
        ['Cumul avenants précédents', cumulAvenants - montantAcc > 0 ? '+ ' + new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cumulAvenants - montantAcc) : '—'],
        ['Montant présenté par le MOE', montantPres > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(montantPres) : '—'],
        ['Montant accepté par le MOA', os.status === 'approved' && montantAcc > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(montantAcc) : (os.status === 'approved' ? '—' : 'En attente')],
        ['Nouveaux honoraires révisés', honorairesInitiaux + cumulAvenants > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(honorairesInitiaux + cumulAvenants) : '—'],
      ],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [60, 60, 60], textColor: 255 },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      bodyStyles: { fillColor: false },
      alternateRowStyles: { fillColor: GRIS_FOND },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // Délais
    if (os.incidences_delais_type === 'oui') {
      section('4. IMPACT SUR LES DÉLAIS');
      row('Incidence sur les délais', os.incidences_delais_details || 'Oui');
      if (os.delai_execution) row('Prolongation', `${os.delai_execution} jours`);
    }

    // Signatures
    if (y > 240) { doc.addPage(); y = 20; }
    y += 8;
    doc.setFillColor(...GRIS_FOND);
    doc.rect(margin, y, W - 2 * margin, 40, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_TEXTE);
    doc.text('SIGNATURES', W / 2, y + 7, { align: 'center' });
    const sigY = y + 15;
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    ['Le Maître d\'Ouvrage', 'Le Maître d\'Œuvre'].forEach((label, i) => {
      const x = margin + i * (col + 5);
      doc.text(label, x + col / 2, sigY, { align: 'center' });
      doc.text(os.date_signature ? `Signé le : ${new Date(os.date_signature).toLocaleDateString('fr-FR')}` : 'Date et signature :', x + 5, sigY + 12);
    });

    drawAgencyFooters(doc, agence, letterhead);
    doc.save(`Avenant_${os.os_number.replace(/\s+/g, '_')}_${projectName.replace(/\s+/g, '_')}.pdf`);
  };

  const handleUpdateOsStatus = async (osId: string, newStatus: OrdreDeService['status'], montantAccepte?: number) => {
    if (newStatus === 'approved') {
      const os = ordresDeService.find(o => o.id === osId);
      if (os) { setArOsTarget(os); setArForm({ date_ar: new Date().toISOString().slice(0, 10), date_execution: '', notes_ar: '' }); }
      return;
    }
    try {
      const os = ordresDeService.find(o => o.id === osId);
      if (!os) return;
      const body: Partial<OrdreDeService> = { ...os, status: newStatus };
      if (montantAccepte !== undefined) body.montant_devis_accepte = montantAccepte;
      const res = await fetch(`/api/ordres_de_service/${osId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        setOrdresDeService(prev => prev.map(o =>
          o.id === osId ? { ...o, status: newStatus } : o
        ));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleArSubmit = async () => {
    if (!arOsTarget || !arForm.date_ar) return;
    setArSaving(true);
    try {
      const res = await fetch(`/api/ordres_de_service/${arOsTarget.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved', date_ar: arForm.date_ar, date_execution: arForm.date_execution || null, notes_ar: arForm.notes_ar || null })
      });
      if (res.ok) {
        setOrdresDeService(prev => prev.map(o =>
          o.id === arOsTarget.id ? { ...o, status: 'approved', date_ar: arForm.date_ar, date_execution: arForm.date_execution, notes_ar: arForm.notes_ar } : o
        ));
        setArOsTarget(null);
      }
    } catch (err) { console.error(err); }
    finally { setArSaving(false); }
  };

  // Distincts des transitions de statut d'un OS travaux ci-dessus : un
  // avenant MOE n'a pas d'accusé de réception d'entreprise (concept propre
  // au marché de travaux) — approuver un avenant est une simple transition
  // de statut, immédiate.
  const handleUpdateAvenantStatus = async (avenantId: string, newStatus: AvenantMoe['status']) => {
    try {
      const avenant = avenantsMoe.find(a => a.id === avenantId);
      const body: any = { status: newStatus };
      if (newStatus === 'approved') body.montant_devis_accepte = avenant?.montant_devis_accepte ?? avenant?.montant_devis_presente ?? undefined;
      const res = await fetch(`/api/avenants_moe/${avenantId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setAvenantsMoe(prev => prev.map(a => a.id === avenantId
          ? { ...a, status: newStatus, montant_devis_accepte: body.montant_devis_accepte ?? a.montant_devis_accepte }
          : a));
      }
    } catch (err) { console.error(err); }
  };

  const handleDeleteAvenant = (avenantId: string) => {
    deleteWithUndo(setAvenantsMoe, avenantId, `/api/avenants_moe/${avenantId}`, 'projectdetail_deleted_avenant');
  };

  const generateOsPdf = async (os: OrdreDeService) => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    // En-tête et pied du cabinet, comme les autres documents.
    const agence = await fetchAgencySettings();
    const logo = await loadLogoDataUrl(agence.logoUrl);
    const statusLabels: Record<string, string> = { draft: 'Brouillon', submitted: 'Émis', approved: 'AR reçu', rejected: 'Annulé' };
    const letterhead = {
      title: 'Ordre de service',
      subtitle: `N° ${os.os_number}${project?.name ? ` — ${project.name}` : ''}`,
      reference: `${statusLabels[os.status] ?? os.status}${os.date_emission ?? os.date ? ` · ${os.date_emission ?? os.date}` : ''}`,
      margin: 14, logo,
    };
    doc.setTextColor(17, 24, 39);
    let y = drawAgencyHeader(doc, agence, letterhead);
    autoTable(doc, {
      startY: y,
      head: [['Parties', '']],
      body: [
        ['Émetteur (MOE)', os.emetteur_os ?? project?.project_manager ?? '—'],
        ['Destinataire (Entreprise)', os.destinataire_os ?? os.entreprise ?? '—'],
        ['Lot', os.lot ?? '—'],
      ],
      theme: 'grid',
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70 } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
    if (os.objet ?? os.title) {
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text('OBJET', 14, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      const lines = doc.splitTextToSize(os.objet ?? os.title ?? '', 182);
      doc.text(lines, 14, y); y += lines.length * 5 + 4;
    }
    autoTable(doc, {
      startY: y,
      head: [['Champ', 'Valeur']],
      body: [
        ['Délai d\'exécution', os.delai_execution ? `${os.delai_execution} ${os.delai_unit ?? 'jours'}` : '—'],
        ['N° Marché', os.march_number ?? '—'],
        ['Montant présenté HT', os.montant_devis_presente != null ? `${Number(os.montant_devis_presente).toLocaleString('fr-FR')} €` : '—'],
        ['Montant accepté HT', os.montant_devis_accepte != null ? `${Number(os.montant_devis_accepte).toLocaleString('fr-FR')} €` : '—'],
      ],
      theme: 'striped',
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70 } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
    if (y > 220) { doc.addPage(); y = 20; }
    const sigY = Math.max(y, 230);
    doc.setFillColor(243, 244, 246);
    doc.rect(14, sigY, 82, 30, 'F'); doc.rect(114, sigY, 82, 30, 'F');
    doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text('Maître d\'œuvre (Émetteur)', 55, sigY + 6, { align: 'center' });
    doc.text('Entreprise (Destinataire)', 155, sigY + 6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text('Signature & cachet :', 18, sigY + 14); doc.text('Signature & cachet :', 118, sigY + 14);
    doc.text(`Date : ${os.date_emission ?? ''}`, 18, sigY + 22);
    doc.text(`Date d'AR : ${os.date_ar ?? '_______'}`, 118, sigY + 22);
    if (os.status === 'approved' && os.date_ar) {
      const arY = sigY + 36;
      doc.setFillColor(243, 244, 246); doc.rect(14, arY, 182, 20, 'F');
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(17, 24, 39);
      doc.text('ACCUSÉ DE RÉCEPTION', 14, arY + 7);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
      doc.text(`Reçu le : ${os.date_ar}  |  Exécution prévue le : ${os.date_execution ?? '—'}`, 14, arY + 14);
    }
    drawAgencyFooters(doc, agence, letterhead);
    doc.save(`OS_${os.os_number}_${(project?.name ?? '').replace(/\s+/g, '_')}.pdf`);
  };

  const generatePvPdf = async (rec: Reception, pvReserves: Reserve[], projectName: string, signataires: { nom: string; role: string }[]) => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const blue: [number, number, number] = [60, 60, 60];
    // En-tête et pied du cabinet, comme les autres documents.
    const agence = await fetchAgencySettings();
    const logo = await loadLogoDataUrl(agence.logoUrl);
    const letterhead = {
      title: 'Procès-verbal de réception',
      subtitle: projectName,
      reference: `${rec.reference_pv ? `Réf. : ${rec.reference_pv} · ` : ''}${rec.type === 'definitive' ? 'Réception définitive' : 'Réception provisoire'}`,
      margin: 14, logo,
    };
    doc.setTextColor(17, 24, 39);
    let y = drawAgencyHeader(doc, agence, letterhead) + 2;
    // Section opération
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('Opération', 14, y); y += 5;
    doc.setDrawColor(200); doc.line(14, y, 196, y); y += 5;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text(`Projet : ${projectName}`, 14, y); y += 5;
    doc.text(`Date de réception : ${new Date(rec.date).toLocaleDateString('fr-FR')}`, 14, y); y += 5;
    if (rec.lieu) { doc.text(`Lieu : ${rec.lieu}`, 14, y); y += 5; }
    // Date limite levée
    if (rec.date_limite_levee) {
      const dlimit = new Date(rec.date_limite_levee);
      const isUrgent = (dlimit.getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000;
      if (isUrgent) { doc.setFillColor(255, 237, 213); doc.rect(14, y - 2, 182, 10, 'F'); doc.setTextColor(194, 65, 12); }
      else { doc.setTextColor(30, 30, 30); }
      doc.setFont('helvetica', 'bold');
      doc.text(`Date limite de levée des réserves : ${dlimit.toLocaleDateString('fr-FR')}${isUrgent ? ' ⚠ Délai proche' : ''}`, 14, y + 5);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
      y += 14;
    }
    y += 3;
    // Signataires
    if (signataires.length > 0) {
      doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.text('Présents / Signataires', 14, y); y += 5;
      doc.setDrawColor(200); doc.line(14, y, 196, y); y += 4;
      autoTable(doc, {
        startY: y,
        head: [['Nom', 'Rôle']],
        body: signataires.map(s => [s.nom, s.role]),
        theme: 'grid',
        headStyles: { fillColor: blue, textColor: 255, fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }
    // Réserves
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('État des réserves', 14, y); y += 5;
    doc.setDrawColor(200); doc.line(14, y, 196, y); y += 4;
    if (pvReserves.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [['N°', 'Bâtiment / Local', 'Intitulé', 'Lots', 'Entreprises', 'Statut', 'Échéance']],
        body: pvReserves.map(r => [
          `#${r.number || '—'}`,
          `${r.batiment}${r.local ? ' / ' + r.local : ''}`,
          r.title,
          JSON.parse(r.lots || '[]').join(', ') || '—',
          JSON.parse(r.entreprises || '[]').join(', ') || '—',
          r.status,
          new Date(r.due_date).toLocaleDateString('fr-FR'),
        ]),
        theme: 'striped',
        headStyles: { fillColor: blue, textColor: 255, fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        columnStyles: { 2: { cellWidth: 40 }, 5: { cellWidth: 28 } },
        margin: { left: 14, right: 14 },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.row.raw[5] === 'Levée') {
            data.cell.styles.textColor = [22, 163, 74];
          } else if (data.section === 'body' && (data.row.raw[5] === 'A faire' || data.row.raw[5] === 'En cours')) {
            data.cell.styles.textColor = [180, 100, 0];
          }
        }
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    } else {
      doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.setTextColor(120);
      doc.text('Aucune réserve enregistrée pour cette réception.', 14, y + 5);
      y += 14; doc.setTextColor(30, 30, 30);
    }
    // Observations
    if (rec.observations) {
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 30);
      doc.text('Observations', 14, y); y += 5;
      doc.setDrawColor(200); doc.line(14, y, 196, y); y += 4;
      doc.setFontSize(9); doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(rec.observations, 182);
      doc.text(lines, 14, y); y += lines.length * 5 + 6;
    }
    // Signatures
    if (y > 230) { doc.addPage(); y = 20; }
    const sigY = Math.max(y + 10, 240);
    doc.setFillColor(243, 244, 246);
    doc.rect(14, sigY, 82, 30, 'F'); doc.rect(114, sigY, 82, 30, 'F');
    doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text('Maître d\'œuvre (MOE)', 55, sigY + 7, { align: 'center' });
    doc.text('Maître d\'ouvrage (MOA)', 155, sigY + 7, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text('Signature & cachet :', 18, sigY + 17);
    doc.text('Signature & cachet :', 118, sigY + 17);
    doc.text(`Date : ${new Date(rec.date).toLocaleDateString('fr-FR')}`, 18, sigY + 25);
    doc.text(`Date : ${new Date(rec.date).toLocaleDateString('fr-FR')}`, 118, sigY + 25);
    drawAgencyFooters(doc, agence, letterhead);
    doc.save(`PV_${(rec.reference_pv || rec.id).replace(/\s+/g, '_')}_${projectName.replace(/\s+/g, '_')}.pdf`);
  };

  const handleDeleteOs = (osId: string) => {
    deleteWithUndo(setOrdresDeService, osId, `/api/ordres_de_service/${osId}`, 'projectdetail_deleted_os');
  };

  // Même cycle de statuts pour un OS et un avenant, mais pas les mêmes mots :
  // un OS « approuvé » a son accusé de réception, un avenant est accepté.
  const osStatusBadge = (status: OrdreDeService['status'], kind: 'os' | 'avenant' = 'os') => {
    const prefix = kind === 'os' ? 'projectdetail_os_status_' : 'projectdetail_amendment_status_';
    const map: Record<OrdreDeService['status'], { label: string; cls: string }> = {
      draft:     { label: t(`${prefix}draft`), cls: 'bg-zinc-100 text-[var(--tblr-muted)] dark:bg-zinc-800 dark:text-[var(--tblr-muted)]' },
      submitted: { label: t(`${prefix}submitted`), cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
      approved:  { label: t(`${prefix}approved`), cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
      rejected:  { label: t(`${prefix}rejected`), cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
    };
    const { label, cls } = map[status] ?? map.draft;
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider ${cls}`}>{label}</span>;
  };

  const optimizeImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
          } else {
            if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    try {
      const optimizedBase64 = await optimizeImage(file);
      setProject({ ...project, image_url: optimizedBase64 });
    } catch (err) {
      console.error(err);
    }
  };

  const handlePlanUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;

    setPlanUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('project_id', id!);

      if (updatingPlanId) {
        // Create a new version of an existing plan
        const parentPlan = plans.find(p => p.id === updatingPlanId);
        if (!parentPlan) return;

        // Calculate new index (A -> B, B -> C...)
        let newIndex = 'A';
        if (parentPlan.index) {
          newIndex = String.fromCharCode(parentPlan.index.charCodeAt(0) + 1);
        }

        form.append('id', crypto.randomUUID());
        form.append('name', parentPlan.name);
        form.append('index', newIndex);
        form.append('version', String((parentPlan.version || 1) + 1));
        form.append('parent_id', parentPlan.id);
        form.append('category', parentPlan.category || (activeTab === 'PRO' || activeTab === 'AOR' ? activeTab : 'AOR'));

        const res = await fetch('/api/plans', { method: 'POST', body: form });
        if (res.ok) {
          const data = await res.json();
          setPlans(prev => [...prev, data]);
          setUpdatingPlanId(null);
        } else {
          const err = await res.json().catch(() => null);
          showToast(t('projectdetail_plan_upload_failed_detail', { error: err?.error || res.statusText }), 'error', { duration: 6000 });
        }
      } else {
        // Create a new plan
        form.append('name', file.name);
        form.append('index', 'A');
        form.append('version', '1');
        form.append('category', activeTab === 'PRO' || activeTab === 'AOR' ? activeTab : 'AOR');

        const res = await fetch('/api/plans', { method: 'POST', body: form });
        if (res.ok) {
          const data = await res.json();
          setPlans(prev => [...prev, data]);
        } else {
          const err = await res.json().catch(() => null);
          showToast(t('projectdetail_plan_upload_failed_detail', { error: err?.error || res.statusText }), 'error', { duration: 6000 });
        }
      }
    } catch (err) {
      console.error(err);
      showToast(t('projectdetail_plan_upload_failed'), 'error', { duration: 6000 });
    } finally {
      setPlanUploading(false);
      if (planInputRef.current) planInputRef.current.value = '';
    }
  };

  if (!project) return (
    <div role="status" className="p-8 flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--tblr-muted)' }}>
      <span aria-hidden className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      {t('loading')}
    </div>
  );

  return (
    <div className="flex flex-col lg:h-full">
      <Toast toast={toast} />
      {confirmDialog}
      {/* Compact topbar */}
      <div
        className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
      >
        <button
          type="button"
          onClick={leaveToProjects}
          className="w-8 h-8 flex items-center justify-center rounded-lg border transition-colors hover:bg-[var(--tblr-surface-2)] shrink-0"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
          title={t('projectdetail_back_to_projects')}
          aria-label={t('projectdetail_back_to_projects')}
        >
          <IconArrowLeft size={18} />
        </button>
        {/* Sur un téléphone, titre, retour et actions tiennent sur une ligne : le
            titre cède sa largeur (tronqué) plutôt que de repousser les actions. */}
        <div className="flex items-baseline gap-2.5 min-w-0 flex-1 lg:flex-none">
          <h1 className="font-bold text-base truncate min-w-0" style={{ color: 'var(--tblr-text)' }} title={project.name}>{project.name}</h1>
          {(project.project_code || project.reference) && (
            <span className="font-mono text-[0.6875rem] shrink-0" style={{ color: 'var(--tblr-muted)' }}>{project.project_code || project.reference}</span>
          )}
          <span
            className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[0.6875rem] font-semibold shrink-0 whitespace-nowrap"
            style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
          >
            {project.is_chantier
              ? t('projectdetail_header_chantier')
              : (['Planning', 'In Progress', 'Completed', 'On Hold'].includes(project.status)
                ? t(`projects_status_${project.status.toLowerCase().replace(' ', '_')}`)
                : project.status)}
          </span>
        </div>

        <div className="order-3 w-full lg:order-none lg:w-auto lg:flex-1 flex justify-start lg:justify-center min-w-0">
          <div className="flex items-center gap-2 min-w-0 w-full lg:w-auto">
            <PhaseStepper
              className="min-w-0 flex-1 lg:flex-none"
              ariaLabel={t('project_phase_stepper_label')}
              stepTitle={step => t('project_phase_stepper_view', { phase: step.label })}
              size="compact"
              steps={missionPhases.map(phase => ({ id: phase, label: phase }))}
              currentId={actualCurrentPhase}
              activeId={viewedPhase || actualCurrentPhase}
              badges={phaseBadges}
              // Une pastille montre le journal de sa phase ; la phase réelle
              // n'avance que par « Passer en … », confirmé.
              onSelect={phase => { setViewedPhase(phase as DocumentPhase); setActiveTab('INFOS'); setShowFullEditor(false); }}
            />
            {upcomingPhase && (
              <button
                type="button"
                onClick={() => { void advancePhase(); }}
                title={t('project_phase_advance_title', { phase: upcomingPhase })}
                className="shrink-0 h-8 px-2.5 inline-flex items-center gap-1 rounded-lg border text-[0.8125rem] font-semibold whitespace-nowrap transition-colors hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
              >
                {t('project_phase_advance', { phase: upcomingPhase })}
                <IconChevronRight size={14} aria-hidden />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0 lg:ml-0 lg:order-none">
          {currentUser?.system_role === 'admin' && (
            <button
              type="button"
              onClick={() => { setDeleteProjectConfirmInput(''); setShowDeleteProjectConfirm(true); }}
              className="p-2 text-[var(--tblr-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
              title={t('projectdetail_delete_project')}
              aria-label={t('projectdetail_delete_project')}
            >
              <IconTrash size={18} />
            </button>
          )}
          <AutosaveIndicator status={autosaveStatus} onRetry={() => { void saveNow(); }} />
        </div>
      </div>

      {/* Tab bar */}
      <div className="shrink-0 px-4 pt-3">
        <ProjectTabBar
          activeTab={activeTab}
          onChange={setActiveTab}
          isChantier={!!project.is_chantier}
          chantierTabState={chantierTabState}
        />
      </div>

      <div className={`flex-1 ${activeTab === 'INFOS' && !showFullEditor ? 'xl:min-h-0 xl:overflow-hidden' : 'lg:min-h-0 lg:overflow-hidden'}`}>
        {activeTab === 'INFOS' && !showFullEditor ? (
          <ProjectOverview
            project={project}
            setProject={setProject}
            notePhase={viewedPhase || actualCurrentPhase}
            phaseNotes={phaseNotes}
            journalPhases={missionPhases}
            phaseHistory={phaseHistory}
            projectActivity={projectActivity}
            projectMembers={projectMembers}
            permits={permits}
            milestones={milestones}
            onOpenFullEditor={() => setShowFullEditor(true)}
            onAddMilestone={handleAddMilestone}
            onToggleMilestone={handleToggleMilestone}
            newMilestoneTitle={newMilestoneTitle}
            setNewMilestoneTitle={setNewMilestoneTitle}
            newMilestoneDate={newMilestoneDate}
            setNewMilestoneDate={setNewMilestoneDate}
            isAddingMilestone={isAddingMilestone}
            setIsAddingMilestone={setIsAddingMilestone}
            onGoToInvoices={() => setActiveTab('HONOS')}
          />
        ) : (
          <div className={`lg:h-full overflow-visible lg:overflow-y-auto ${activeTab === 'PRO' ? 'p-0' : 'p-4 sm:p-6'}`}>
            <div className={activeTab === 'PRO' || activeTab === 'DET' ? 'w-full space-y-8' : 'max-w-6xl mx-auto space-y-8 pb-20'}>
            {activeTab === 'INFOS' && showFullEditor && (
              <div className="flex items-center justify-between -mt-2 mb-2">
                <button
                  onClick={() => setShowFullEditor(false)}
                  className="flex items-center gap-2 text-sm font-semibold"
                  style={{ color: 'var(--tblr-primary)' }}
                >
                  <IconArrowLeft size={16} /> {t('project_overview_back_to_summary')}
                </button>
              </div>
            )}
            {activeTab === 'HONOS' && (
              <div className="space-y-8">

                {/* ── Contrat MOE lié ────────────────────────────────────── */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconFileText}
                    title={t('projectdetail_contract_title')}
                    description={t('projectdetail_contract_desc')}
                    action={
                      <Link to="/contrats" className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition">
                        <IconPlus size={14} />
                        {t('projectdetail_contract_manage')}
                      </Link>
                    }
                  />
                  {linkedContratsMoe.length === 0 ? (
                    <div className="p-8 text-center text-[var(--tblr-muted)] italic text-sm">
                      {t('projectdetail_contract_empty')}{' '}
                      <Link to="/contrats" className="text-blue-500 hover:underline">{t('projectdetail_contract_empty_link')}</Link>
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--tblr-border)]">
                      {linkedContratsMoe.map((c: any) => {
                        const typeLabel = (type: string) => ['construction_neuve', 'rehabilitation', 'concours', 'amo', 'diagnostic', 'urbanisme'].includes(type)
                          ? t(`projectdetail_contract_type_${type}`) : type;
                        const STATUS_COLORS: Record<string, string> = {
                          Brouillon: 'bg-zinc-100 text-[var(--tblr-muted)]', Envoyé: 'bg-blue-100 text-blue-700',
                          Signé: 'bg-green-100 text-green-700', Résilié: 'bg-red-100 text-red-700',
                        };
                        const missionsIncluses = (c.missions_list || []).filter((m: any) => m.incluse);
                        return (
                          <div key={c.id} className="p-5 flex items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                {c.numero && <span className="text-[0.6875rem] font-mono px-2 py-0.5 rounded bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)]">{c.numero}</span>}
                                <span className={cn("text-[0.6875rem] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider", STATUS_COLORS[c.status] || 'bg-zinc-100 text-[var(--tblr-muted)]')}>{c.status}</span>
                                <span className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600">{typeLabel(c.type_contrat)}</span>
                              </div>
                              <p className="font-semibold text-[var(--tblr-text)] text-sm">{c.intitule_projet || c.project_name || t('projectdetail_contract_untitled')}</p>
                              <div className="flex flex-wrap gap-4 mt-1 text-xs text-[var(--tblr-muted)]">
                                {c.mode_honoraires === 'forfait' && c.montant_honoraires && <span className="text-blue-600 font-bold">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(c.montant_honoraires)} {t('projectdetail_ht')}</span>}
                                {c.mode_honoraires === 'pourcentage' && c.taux_honoraires && <span className="text-blue-600 font-bold">{t('projectdetail_contract_rate', { rate: c.taux_honoraires })}</span>}
                                {c.indice_revision && <span>{t('projectdetail_contract_index', { index: c.indice_revision })}</span>}
                                {c.date_debut && c.date_fin && <span>{t('projectdetail_contract_period', { from: new Date(c.date_debut).toLocaleDateString('fr-FR'), to: new Date(c.date_fin).toLocaleDateString('fr-FR') })}</span>}
                                {c.date_debut && !c.date_fin && <span>{t('projectdetail_contract_from', { from: new Date(c.date_debut).toLocaleDateString('fr-FR') })}</span>}
                              </div>
                              {missionsIncluses.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {missionsIncluses.map((m: any) => (
                                    <span key={m.id} className="text-[0.6875rem] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 font-medium">
                                      {m.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()}{m.pct ? ` ${m.pct}%` : ''}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── Honoraires MOE ─────────────────────────────────────── */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader icon={IconCurrencyEuro} title={t('projectdetail_fees_title')} />
                  <div className="p-6 space-y-6">
                    {/* KPIs */}
                    {(() => {
                      const honInit = Number(project.remuneration) || 0;
                      const cumul = cumulAvenantsApprouves;
                      const honRevises = honInit + cumul;
                      const encaisses = totalInvoicesPaid;
                      const restant = honRevises - encaisses;
                      return (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                          {[
                            { label: t('projectdetail_fees_initial'), value: honInit, color: 'blue', sub: contratHonoraires ? t('projectdetail_fees_initial_sub_contract') : t('projectdetail_fees_initial_sub_manual') },
                            { label: t('projectdetail_fees_amendments'), value: cumul, color: cumul >= 0 ? 'green' : 'red', sub: t('projectdetail_fees_amendments_sub', { count: moeAvenantsApprouves.length }) },
                            { label: t('projectdetail_fees_revised'), value: honRevises, color: 'indigo', sub: t('projectdetail_fees_revised_sub') },
                            { label: t('projectdetail_fees_remaining'), value: restant, color: restant > 0 ? 'amber' : 'green', sub: t('projectdetail_fees_remaining_sub', { amount: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(encaisses) }) },
                          ].map(kpi => (
                            <StatTile
                              key={kpi.label}
                              label={kpi.label}
                              color={kpi.color as StatTileColor}
                              value={new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(kpi.value)}
                              sub={kpi.sub}
                            />
                          ))}
                        </div>
                      );
                    })()}

                    {/* Honoraires initiaux et coût travaux : issus du contrat MOE
                        lié (donc en lecture seule ici, à corriger dans le
                        contrat). Ils ne redeviennent saisissables que si aucun
                        contrat n'est lié à l'affaire. */}
                    {(() => {
                      const verrouille = !!contratHonoraires;
                      const readOnlyCls = 'w-full pl-8 pr-4 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 text-[var(--tblr-text)] font-bold opacity-70 cursor-default';
                      const editCls = 'w-full pl-8 pr-4 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold';
                      const origine = verrouille
                        ? (contratHonoraires.numero ? t('projectdetail_fees_from_contract_num', { num: contratHonoraires.numero }) : t('projectdetail_fees_from_contract'))
                        : undefined;
                      return (
                        <div className="space-y-2 pt-2 border-t border-[var(--tblr-border)]">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                              <label htmlFor="honos-initiaux" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('projectdetail_fees_initial_input')}</label>
                              <div className="relative">
                                <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">€</span>
                                <input id="honos-initiaux" type="number" readOnly={verrouille} title={origine}
                                  className={verrouille ? readOnlyCls : editCls}
                                  value={project.remuneration || 0}
                                  onChange={e => setProject({...project, remuneration: Number(e.target.value)})} />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label htmlFor="honos-cout-travaux" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('projectdetail_fees_works_cost_input')}</label>
                              <div className="relative">
                                <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">€</span>
                                <input id="honos-cout-travaux" type="number" readOnly={verrouille} title={origine}
                                  className={verrouille ? readOnlyCls : editCls}
                                  value={project.construction_cost || 0}
                                  onChange={e => setProject({...project, construction_cost: Number(e.target.value)})} />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label htmlFor="honos-taux" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('projectdetail_fees_rate_input')}</label>
                              <div className="relative">
                                <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">%</span>
                                <input id="honos-taux" type="text" readOnly title={t('projectdetail_fees_rate_title')}
                                  className="w-full pl-4 pr-8 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none text-[var(--tblr-text)] font-bold opacity-70 cursor-default focus-visible:ring-2 focus-visible:ring-blue-500"
                                  value={project.construction_cost && project.remuneration
                                    ? Number(((project.remuneration / project.construction_cost) * 100).toFixed(10))
                                    : ''} placeholder={t('projectdetail_fees_rate_empty')} />
                              </div>
                            </div>
                          </div>
                          {verrouille && (
                            <p className="text-xs text-[var(--tblr-muted)]">
                              {contratHonoraires.numero ? t('projectdetail_fees_locked_num', { num: contratHonoraires.numero }) : t('projectdetail_fees_locked')}
                              {' '}<Link to="/contrats" className="underline hover:text-[var(--tblr-primary)]">{t('projectdetail_fees_locked_link')}</Link>
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {/* Répartition par phases */}
                    {(() => {
                      const DEFAULT_PHASES = [
                        { id: 'esquisse', name: 'ESQ', pct: 10 }, { id: 'aps', name: 'APS', pct: 12 },
                        { id: 'apd', name: 'APD', pct: 14 }, { id: 'pro', name: 'PRO', pct: 18 },
                        { id: 'act', name: 'ACT', pct: 7 },  { id: 'visa', name: 'VISA', pct: 7 },
                        { id: 'det', name: 'DET', pct: 25 }, { id: 'aor', name: 'AOR', pct: 7 },
                      ];
                      const honRevises = (Number(project.remuneration) || 0) + cumulAvenantsApprouves;
                      if (honRevises <= 0) return null;
                      const phases = linkedContratsMoe[0]?.missions_list?.filter((m: any) => m.incluse) ?? DEFAULT_PHASES;
                      return (
                        <div className="pt-2 border-t border-[var(--tblr-border)]">
                          <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-3">{t('projectdetail_fees_split_title')}</p>
                          <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
                            {phases.map((phase: any) => (
                              <div key={phase.id} className="text-center p-3 rounded-lg bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)]">
                                <p className="text-[0.6875rem] font-black uppercase text-[var(--tblr-muted)]">{phase.name}</p>
                                <p className="text-xs font-bold text-blue-600 dark:text-blue-400 mt-1">{phase.pct} %</p>
                                <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">{new Intl.NumberFormat('fr-FR', { notation: 'compact', currency: 'EUR', style: 'currency' }).format(honRevises * phase.pct / 100)}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* ── Avenants Contrat MOE ───────────────────────────────── */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconClipboardList}
                    title={t('projectdetail_amendments_title')}
                    description={(() => {
                      const moeApprouves = cumulAvenantsApprouves;
                      const honorairesInitiaux = Number(project.remuneration) || 0;
                      if (moeApprouves !== 0 || honorairesInitiaux !== 0) return (
                        <span className="font-semibold" style={{ color: 'var(--tblr-primary)' }}>
                          {t('projectdetail_amendments_revised', { amount: formatCurrency(honorairesInitiaux + moeApprouves) })}
                          {moeApprouves !== 0 && <span className="text-green-600 dark:text-green-400"> ({moeApprouves >= 0 ? '+' : ''}{formatCurrency(moeApprouves)})</span>}
                        </span>
                      );
                      return undefined;
                    })()}
                    action={linkedContratsMoe.length === 0 ? (
                      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-lg text-xs font-bold">
                        <IconAlertCircle size={14} />
                        {t('projectdetail_amendments_need_contract')}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsAddingOsMoe(!isAddingOsMoe)}
                        aria-expanded={isAddingOsMoe}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition"
                      >
                        <IconPlus size={14} />
                        {t('projectdetail_amendments_new')}
                      </button>
                    )}
                  />
                  {isAddingOsMoe && (
                    <div className="p-6 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-5">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="avenant-numero" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_amendment_number')} <span aria-hidden className="text-red-500">*</span></label>
                          <input id="avenant-numero" required type="text" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.os_number} onChange={e => setNewOsMoe({...newOsMoe, os_number: e.target.value})}
                            placeholder={`A${String(moeAvenants.length + 1).padStart(2, '0')}`} />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="avenant-type" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_amendment_type')}</label>
                          <select id="avenant-type" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.objet} onChange={e => setNewOsMoe({...newOsMoe, objet: e.target.value})}>
                            <option value="extension_mission">{t('projectdetail_amendment_type_extension_mission')}</option>
                            <option value="modification_programme">{t('projectdetail_amendment_type_modification_programme')}</option>
                            <option value="revision_honoraires">{t('projectdetail_amendment_type_revision_honoraires')}</option>
                            <option value="imprevus">{t('projectdetail_amendment_type_imprevus')}</option>
                            <option value="autre">{t('projectdetail_amendment_type_autre')}</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="avenant-date" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_amendment_date')}</label>
                          <input id="avenant-date" type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.date} onChange={e => setNewOsMoe({...newOsMoe, date: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="avenant-origine" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_amendment_origin')}</label>
                          <select id="avenant-origine" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.origine_demande} onChange={e => setNewOsMoe({...newOsMoe, origine_demande: e.target.value})}>
                            <option value="maitrise_ouvrage">{t('projectdetail_amendment_origin_maitrise_ouvrage')}</option>
                            <option value="maitrise_oeuvre">{t('projectdetail_amendment_origin_maitrise_oeuvre')}</option>
                            <option value="aleas">{t('projectdetail_amendment_origin_aleas')}</option>
                            <option value="autres">{t('projectdetail_amendment_origin_autres')}</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="avenant-intitule" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_amendment_title')} <span aria-hidden className="text-red-500">*</span></label>
                          <input id="avenant-intitule" required type="text" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.title} onChange={e => setNewOsMoe({...newOsMoe, title: e.target.value})}
                            placeholder={t('projectdetail_amendment_title_placeholder')} />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="avenant-motif" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_amendment_reason')}</label>
                          <textarea id="avenant-motif" rows={2} className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            value={newOsMoe.description} onChange={e => setNewOsMoe({...newOsMoe, description: e.target.value})}
                            placeholder={t('projectdetail_amendment_reason_placeholder')} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="avenant-montant" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_amendment_amount')}</label>
                          <input id="avenant-montant" type="number" aria-describedby="avenant-montant-aide" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.montant_devis_presente} onChange={e => setNewOsMoe({...newOsMoe, montant_devis_presente: e.target.value})}
                            placeholder="3500" />
                          <p id="avenant-montant-aide" className="text-[0.6875rem] text-[var(--tblr-muted)]">{t('projectdetail_amendment_amount_help')}</p>
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="avenant-signature" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_amendment_signature')}</label>
                          <input id="avenant-signature" type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.date_signature} onChange={e => setNewOsMoe({...newOsMoe, date_signature: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="avenant-delais" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_amendment_delay')}</label>
                          <select id="avenant-delais" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.incidences_delais_type} onChange={e => setNewOsMoe({...newOsMoe, incidences_delais_type: e.target.value as 'non' | 'oui'})}>
                            <option value="non">{t('projectdetail_amendment_delay_no')}</option>
                            <option value="oui">{t('projectdetail_amendment_delay_yes')}</option>
                          </select>
                        </div>
                        {newOsMoe.incidences_delais_type === 'oui' && (
                          <div className="space-y-1">
                            <label htmlFor="avenant-prolongation" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_amendment_extension')}</label>
                            <input id="avenant-prolongation" type="number" min={0} className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newOsMoe.delai_execution} onChange={e => setNewOsMoe({...newOsMoe, delai_execution: e.target.value})} placeholder="30" />
                          </div>
                        )}
                      </div>
                      {newOsMoe.incidences_delais_type === 'oui' && (
                        <div className="space-y-1">
                          <label htmlFor="avenant-justif" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_amendment_delay_reason')}</label>
                          <input id="avenant-justif" type="text" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOsMoe.incidences_delais_details} onChange={e => setNewOsMoe({...newOsMoe, incidences_delais_details: e.target.value})}
                            placeholder={t('projectdetail_amendment_delay_reason_placeholder')} />
                        </div>
                      )}
                      <div className="flex justify-end gap-3">
                        <button type="button" onClick={() => setIsAddingOsMoe(false)} className="px-4 py-2 text-sm font-bold text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors">{t('projectdetail_dialog_cancel')}</button>
                        <button type="button" onClick={handleCreateOsMoe} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition">{t('projectdetail_amendment_create')}</button>
                      </div>
                    </div>
                  )}
                  {/* Barre récap cumulée */}
                  {(() => {
                    const approuves = moeAvenantsApprouves;
                    const cumul = cumulAvenantsApprouves;
                    const honInit = Number(project.remuneration) || 0;
                    if (moeAvenants.length === 0) return null;
                    return (
                      <div className="mx-6 mb-4 mt-2 flex items-center gap-6 text-xs px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40">
                        <div><span className="text-blue-400 font-bold uppercase tracking-wider text-[0.6875rem]">{t('projectdetail_fees_initial')}</span><br/><span className="font-black text-blue-700 dark:text-blue-300 text-sm">{formatCurrency(honInit)}</span></div>
                        <div className="text-blue-300">+</div>
                        <div><span className="text-blue-400 font-bold uppercase tracking-wider text-[0.6875rem]">{t('projectdetail_fees_amendments_accepted')}</span><br/><span className={cn("font-black text-sm", cumul >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>{cumul >= 0 ? '+' : ''}{formatCurrency(cumul)}</span></div>
                        <div className="text-blue-300">=</div>
                        <div><span className="text-blue-400 font-bold uppercase tracking-wider text-[0.6875rem]">{t('projectdetail_fees_revised')}</span><br/><span className="font-black text-blue-700 dark:text-blue-300 text-sm">{formatCurrency(honInit + cumul)}</span></div>
                        <div className="ml-auto text-blue-400 text-[0.6875rem]">{t('projectdetail_amendments_accepted_ratio', { count: approuves.length, total: moeAvenants.length })}</div>
                      </div>
                    );
                  })()}
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[0.6875rem] tracking-wider">
                        <tr>
                          <th className="px-4 py-3 text-left">{t('projectdetail_col_number')}</th>
                          <th className="px-4 py-3 text-left">{t('projectdetail_col_type')}</th>
                          <th className="px-4 py-3 text-left">{t('projectdetail_col_title')}</th>
                          <th className="px-4 py-3 text-left">{t('projectdetail_col_date')}</th>
                          <th className="px-4 py-3 text-right">{t('projectdetail_col_presented_ht')}</th>
                          <th className="px-4 py-3 text-right">{t('projectdetail_col_accepted_ht')}</th>
                          <th className="px-4 py-3 text-center">{t('projectdetail_col_delays')}</th>
                          <th className="px-4 py-3 text-center">{t('projectdetail_col_status')}</th>
                          <th className="px-4 py-3 text-center">{t('projectdetail_col_next_step')}</th>
                          <th className="px-4 py-3 w-16"><span className="sr-only">{t('projectdetail_col_actions')}</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--tblr-border)]">
                        {(() => {
                          const typeShort = (type: string | undefined) => type && ['extension_mission', 'modification_programme', 'revision_honoraires', 'imprevus', 'autre'].includes(type)
                            ? t(`projectdetail_amendment_type_${type}`) : (type || t('projectdetail_not_set'));
                          const honorairesInitiaux = Number(project.remuneration) || 0;
                          const cumulTotal = cumulAvenantsApprouves;
                          return moeAvenants.map((os) => (
                            <tr key={os.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors group">
                              <td className="px-4 py-3 font-mono font-black text-[var(--tblr-text)] whitespace-nowrap text-xs">Av.{os.os_number}</td>
                              <td className="px-4 py-3"><span className="text-[0.6875rem] font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400">{typeShort(os.objet)}</span></td>
                              <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200 max-w-[180px]">
                                <p className="truncate font-medium">{os.title}</p>
                                {os.description && <p className="text-[0.6875rem] text-[var(--tblr-muted)] truncate mt-0.5">{os.description}</p>}
                              </td>
                              <td className="px-4 py-3 text-[var(--tblr-muted)] text-xs whitespace-nowrap">
                                {os.date ? new Date(os.date).toLocaleDateString('fr-FR') : '—'}
                                {os.date_signature && <div className="text-[0.6875rem] text-green-600">{t('projectdetail_signed_on', { date: new Date(os.date_signature).toLocaleDateString('fr-FR') })}</div>}
                              </td>
                              <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{os.montant_devis_presente != null ? formatCurrency(Number(os.montant_devis_presente)) : '—'}</td>
                              <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                                {os.status === 'approved'
                                  ? <span className={cn(Number(os.montant_devis_accepte ?? os.montant_devis_presente) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600')}>{formatCurrency(Number(os.montant_devis_accepte ?? os.montant_devis_presente ?? 0))}</span>
                                  : <span className="text-[var(--tblr-muted)]">—</span>}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {os.incidences_delais_type === 'oui'
                                  ? <span className="text-[0.6875rem] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">{os.delai_execution ? t('projectdetail_amendment_days_short', { days: os.delai_execution }) : t('projectdetail_field_yes')}</span>
                                  : <span className="text-[var(--tblr-muted)] text-[0.6875rem]">—</span>}
                              </td>
                              <td className="px-4 py-3 text-center">{osStatusBadge(os.status, 'avenant')}</td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {os.status === 'draft' && <button type="button" onClick={() => handleUpdateAvenantStatus(os.id, 'submitted')} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 text-[0.6875rem] font-bold transition"><IconSend size={11} /> {t('projectdetail_amendment_action_submit')}</button>}
                                  {os.status === 'submitted' && (<>
                                    <button type="button" onClick={() => handleUpdateAvenantStatus(os.id, 'approved')} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 text-[0.6875rem] font-bold transition"><IconCheck size={11} /> {t('projectdetail_amendment_action_accept')}</button>
                                    <button type="button" onClick={() => handleUpdateAvenantStatus(os.id, 'rejected')} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 text-[0.6875rem] font-bold transition"><IconX size={11} /> {t('projectdetail_amendment_action_refuse')}</button>
                                  </>)}
                                  {os.status === 'rejected' && <button type="button" onClick={() => handleUpdateAvenantStatus(os.id, 'draft')} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-[0.6875rem] font-bold transition"><IconRefresh size={11} /> {t('projectdetail_amendment_action_reopen')}</button>}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                                  <button type="button" title={t('projectdetail_amendment_export_pdf')} aria-label={t('projectdetail_amendment_export_pdf')} onClick={() => generateAvenantPdf(os, project.name, honorairesInitiaux, cumulTotal)} className="p-1 text-[var(--tblr-muted)] hover:text-blue-500 transition-colors"><IconFileDownload size={14} /></button>
                                  <button type="button" title={t('projectdetail_amendment_delete')} aria-label={t('projectdetail_amendment_delete')} onClick={() => handleDeleteAvenant(os.id)} className="p-1 text-[var(--tblr-muted)] hover:text-red-500 transition-colors"><IconTrash size={14} /></button>
                                </div>
                              </td>
                            </tr>
                          ));
                        })()}
                        {moeAvenants.length === 0 && (
                          <tr><td colSpan={10} className="px-6 py-8 text-left sm:text-center text-[var(--tblr-muted)] italic"><span className="table-empty-message">{t('projectdetail_amendments_empty')}</span></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Notes d'honoraires ──────────────────────────────────── */}
                {(() => {
                  const DEFAULT_PHASES = [
                    { id: 'esquisse', name: 'ESQ — Esquisse' },
                    { id: 'aps', name: 'APS — Avant-Projet Sommaire' },
                    { id: 'apd', name: 'APD — Avant-Projet Détaillé' },
                    { id: 'pro', name: 'PRO — Projet' },
                    { id: 'act', name: 'ACT — Assistance Contrats de Travaux' },
                    { id: 'visa', name: 'VISA' },
                    { id: 'det', name: 'DET — Direction de l\'Exécution des Travaux' },
                    { id: 'aor', name: 'AOR — Assistance à la Réception' },
                  ];
                  const honRevises = (Number(project.remuneration) || 0) + cumulAvenantsApprouves;
                  const contrat = linkedContratsMoe.find((c: any) => c.status === 'Signé') || linkedContratsMoe[0];
                  const cotraitants: any[] = contrat?.cotraitants || [];
                  const sousTraitants: any[] = contrat?.sous_traitants || [];
                  const phases = contrat?.missions_list?.filter((m: any) => m.incluse).map((m: any) => ({ id: m.id, name: m.name })) ?? DEFAULT_PHASES;

                  // Parts de répartition par défaut, reprises du contrat : chaque
                  // cotraitant a la part qui lui est contractuellement due
                  // (`fee_pct`), l'agence le solde. C'est la répartition la plus
                  // probable d'une mission, à ajuster mission par mission dans la
                  // note (une esquisse peut pencher davantage vers l'agence que le
                  // contrat dans son ensemble).
                  const partCotraitantDefaut = (ct: any) => Number(ct?.fee_pct) || 0;
                  const partAgenceDefaut = Math.max(0, 100 - cotraitants.reduce((s: number, ct: any) => s + partCotraitantDefaut(ct), 0));

                  const initNoteForm = () => ({
                    numero: `NH-${String(notesHonoraires.length + 1).padStart(2, '0')}`,
                    date: new Date().toISOString().split('T')[0],
                    objet: '',
                    status: 'Brouillon',
                    tva_rate: 20,
                    phases: phases.map((p: any) => ({ phase_id: p.id, phase_name: p.name, avancement_pct: 0, montant_phase: 0, part_pct: partAgenceDefaut })),
                    cotraitants_facturation: cotraitants.map((ct: any) => ({
                      contact_id: ct.contact_id, nom: ct.contact_name || ct.specialty || '',
                      phases: phases.map((p: any) => ({ phase_id: p.id, phase_name: p.name, avancement_pct: 0, montant_phase: 0, part_pct: partCotraitantDefaut(ct) })),
                      montant_ht: 0, tva_rate: 20, montant_ttc: 0,
                    })),
                    sous_traitants_facturation: sousTraitants.map((st: any) => ({
                      contact_id: st.contact_id, nom: st.contact_name || st.specialty || '',
                      phases: phases.map((p: any) => ({ phase_id: p.id, phase_name: p.name, avancement_pct: 0, montant_phase: 0 })),
                      montant_ht: 0, tva_rate: 20, montant_ttc: 0,
                      payeur: st.payeur ?? (st.paiement_direct_moa ? 'moa' : 'agence'),
                    })),
                    notes: '',
                  });

                  // Le nom de l'agence — jamais le mot générique "Agence" —
                  // pour rappeler qu'une note d'honoraires concerne toute
                  // l'équipe de maîtrise d'œuvre (le groupement), alors que
                  // seule cette colonne, une fois isolée, donne la facture de
                  // l'agence elle-même.
                  const agencyName = (settings as any)?.agencyName || t('projectdetail_note_agency_fallback');

                  // Nom affiché d'un cotraitant/sous-traitant : toujours relu
                  // depuis le contrat courant (par contact_id), jamais depuis
                  // le `nom` figé dans la note à sa création — sinon renommer
                  // un intervenant dans le contrat (ContactAutocomplete) ne se
                  // répercutait jamais sur les notes déjà en cours d'édition
                  // ni sur les nouvelles tant que la page n'était pas rechargée.
                  // Un intervenant retiré du contrat depuis garde son dernier
                  // nom connu plutôt que d'afficher un intitulé vide.
                  const ctDisplayName = (ct: any) => {
                    const rec = cotraitants.find((c: any) => (c.contact_id || c.contact_name) === (ct.contact_id || ct.nom));
                    return rec?.contact_name || rec?.specialty || ct.nom || t('projectdetail_note_cotraitant_fallback');
                  };
                  const stDisplayName = (st: any) => {
                    const rec = sousTraitants.find((s: any) => (s.contact_id || s.contact_name) === (st.contact_id || st.nom));
                    return rec?.contact_name || rec?.specialty || st.nom || t('projectdetail_note_soustraitant_fallback');
                  };

                  /**
                   * Qui règle ce sous-traitant, pour la note en cours — relu sur le
                   * CONTRAT (par `contact_id`), comme les noms juste au-dessus, et
                   * non depuis la valeur figée dans la note à sa création : désigner
                   * ou changer le payeur dans le contrat doit se répercuter
                   * immédiatement sur la ventilation, y compris d'une note déjà
                   * ouverte. La valeur figée ne sert de repli que si le
                   * sous-traitant a depuis été retiré du contrat.
                   *
                   * Rend une clé canonique : `'agence'`, `'moa'`, ou l'`id` du
                   * cotraitant payeur. Un payeur désigné mais introuvable dans le
                   * contrat (cotraitant supprimé depuis) revient à l'agence, qui est
                   * le mandataire : sans ça, le montant du sous-traitant sortait de
                   * l'enveloppe de la mission sans revenir à personne, et les
                   * montants de TOUS les membres baissaient.
                   */
                  const payeurEffectif = (st: any): string => {
                    const rec = sousTraitants.find((s: any) => (s.contact_id || s.contact_name) === (st.contact_id || st.nom));
                    const source = rec || st;
                    const brut = source.payeur ?? (source.paiement_direct_moa ? 'moa' : 'agence');
                    if (brut === 'moa' || brut === 'agence') return brut;
                    // Un payeur cotraitant est enregistré par son `id` de contrat, mais
                    // une note ancienne ou un import peuvent porter son `contact_id` :
                    // les deux sont acceptés pour ne pas perdre l'imputation.
                    const ct = cotraitants.find((c: any) => c.id === brut || c.contact_id === brut);
                    return ct ? ct.id : 'agence';
                  };

                  // Libellé du payeur sous le nom de colonne d'un sous-traitant —
                  // rien à afficher quand c'est l'agence, le cas par défaut.
                  const payeurLabel = (st: any) => {
                    const payeur = payeurEffectif(st);
                    if (payeur === 'agence') return null;
                    if (payeur === 'moa') return t('projectdetail_note_paid_by_moa');
                    const ct = cotraitants.find((c: any) => c.id === payeur);
                    return ct ? t('projectdetail_note_paid_by', { name: ct.contact_name || ct.specialty || t('projectdetail_note_cotraitant_fallback') }) : null;
                  };

                  // Plafonds de ventilation : le cumul déjà facturé sur les notes
                  // précédentes du même contrat — ne jamais laisser le total, toutes
                  // notes confondues, dépasser ce qui est dû.
                  const contratIdForCaps = contrat?.id || null;
                  const priorNotesForCaps = notesHonoraires.filter((n: any) => n.contrat_id === contratIdForCaps && n.id !== editingNote?.id);
                  // L'avancement se cumule en POURCENTAGE et non en montant : c'est
                  // le groupement qui porte l'avancement d'une mission, et une
                  // mission ne peut pas être facturée au-delà de 100 %.
                  const cumulGroupementPct = (phaseId: string) => priorNotesForCaps.reduce((s: number, n: any) =>
                    s + (Number((n.phases || []).find((p: any) => p.phase_id === phaseId)?.avancement_pct) || 0), 0);
                  const cumulStTotal = (key: string) => priorNotesForCaps.reduce((s: number, n: any) => {
                    const st = (n.sous_traitants_facturation || []).find((x: any) => (x.contact_id || x.nom) === key);
                    return s + (st?.montant_ht || 0);
                  }, 0);

                  // Montant total d'une mission pour TOUT le groupement : le
                  // pourcentage de mission du contrat appliqué aux honoraires
                  // révisés, qui sont eux-mêmes le montant du contrat pour
                  // l'ensemble de l'équipe. C'est ce montant que la répartition
                  // par membre découpe ensuite — il n'additionne donc PAS les
                  // parts des cotraitants, qui en sont des fractions et non des
                  // suppléments.
                  const groupementPhaseBase = (phaseId: string) => {
                    const pct = (contrat?.missions_list || []).find((m: any) => m.id === phaseId)?.pct || 0;
                    return honRevises * pct / 100;
                  };

                  // Identifiant contractuel d'un cotraitant de la note — c'est cet
                  // `id` que `ContratSousTraitant.payeur` désigne, et donc lui qui
                  // relie un sous-traitant au membre dont le montant se réduit.
                  const ctContratId = (ct: any) => cotraitants.find((c: any) =>
                    (c.contact_id || c.contact_name) === (ct.contact_id || ct.nom))?.id;

                  /**
                   * Recalcule tous les montants dérivés de la note, mission par
                   * mission : seuls trois champs sont réellement saisis — le
                   * pourcentage d'avancement du groupement, la quote-part de chaque
                   * membre, et le montant de chaque sous-traitant. Tout le reste en
                   * découle, d'où un recalcul global plutôt qu'une retouche cellule
                   * par cellule : changer l'avancement du groupement déplace les
                   * montants de tous les membres de la ligne.
                   */
                  const recalcNote = (form: any) => {
                    // Les objets `phases` sont recopiés et non seulement leurs
                    // tableaux : `montant_phase` y est réécrit, et ces objets sont
                    // partagés avec l'état précédent du formulaire.
                    const cts = (form.cotraitants_facturation || []).map((ct: any) => ({ ...ct, phases: (ct.phases || []).map((p: any) => ({ ...p })) }));
                    // `payeur` est réécrit avec la valeur résolue sur le contrat :
                    // la note enregistrée porte ainsi le payeur qui a réellement
                    // servi au calcul, et l'export PDF comme la facture brouillon
                    // lisent la même imputation que l'écran.
                    const sts = (form.sous_traitants_facturation || []).map((st: any) => ({
                      ...st,
                      payeur: payeurEffectif(st),
                      paiement_direct_moa: undefined,
                      phases: (st.phases || []).map((p: any) => ({ ...p })),
                    }));
                    const phaseOf = (list: any[], phaseId: string) => list.find((p: any) => p.phase_id === phaseId);

                    const nextPhases = (form.phases || []).map((phase: any) => {
                      const montantGroupement = groupementPhaseBase(phase.phase_id) * (Number(phase.avancement_pct) || 0) / 100;
                      const stMission = (st: any) => Number(phaseOf(st.phases, phase.phase_id)?.montant_phase) || 0;
                      const stPayePar = (payeurKey: string) => sts.reduce((s: number, st: any) =>
                        payeurEffectif(st) === payeurKey ? s + stMission(st) : s, 0);

                      // Le montant facturé par le groupement sur une mission ne bouge
                      // PAS quand des sous-traitants sont saisis : ce qui leur est
                      // reversé sort de l'enveloppe de la mission, pas en supplément.
                      // Les quote-parts se calculent donc sur ce qui reste après
                      // sous-traitance (`resteAPartager`), de sorte que chacun
                      // touche RÉELLEMENT sa part une fois les sous-traitants payés.
                      const stTotalMission = sts.reduce((s: number, st: any) => s + stMission(st), 0);
                      const resteAPartager = Math.max(0, montantGroupement - stTotalMission);

                      // Le membre qui règle un sous-traitant le facture au maître
                      // d'ouvrage puis le reverse : son montant facturé est donc sa
                      // part NETTE augmentée de ce qu'il reverse, tandis que celui
                      // qui ne règle personne voit sa part baisser d'autant — les
                      // deux touchent bien leur pourcentage une fois la
                      // sous-traitance payée, et la somme des membres reste égale au
                      // montant du groupement (diminuée de ce que le maître
                      // d'ouvrage règle lui-même en direct).
                      cts.forEach((ct: any) => {
                        const p = phaseOf(ct.phases, phase.phase_id);
                        if (!p) return;
                        const net = resteAPartager * (Number(p.part_pct) || 0) / 100;
                        p.montant_phase = parseFloat((net + stPayePar(ctContratId(ct) || '')).toFixed(2));
                      });

                      const netAgence = resteAPartager * (Number(phase.part_pct) || 0) / 100;
                      return { ...phase, montant_phase: parseFloat((netAgence + stPayePar('agence')).toFixed(2)) };
                    });

                    const totaux = (intervenant: any) => {
                      const montant_ht = parseFloat((intervenant.phases || []).reduce((s: number, p: any) => s + (Number(p.montant_phase) || 0), 0).toFixed(2));
                      return {
                        ...intervenant,
                        montant_ht,
                        montant_ttc: parseFloat((montant_ht * (1 + (intervenant.tva_rate || 20) / 100)).toFixed(2)),
                      };
                    };

                    return {
                      ...form,
                      phases: nextPhases,
                      cotraitants_facturation: cts.map(totaux),
                      sous_traitants_facturation: sts.map(totaux),
                    };
                  };

                  const totalNotesHT = notesHonoraires.reduce((s: number, n: any) => s + (n.montant_ht || 0), 0);
                  const totalNotesTTC = notesHonoraires.reduce((s: number, n: any) => s + (n.montant_ttc || 0), 0);

                  // Saisie d'une cellule d'intervenant : pose la valeur saisie
                  // (`part_pct` pour un cotraitant, `montant_phase` pour un
                  // sous-traitant) puis laisse `recalcNote` refaire tous les
                  // montants dérivés — un montant de sous-traitant change la part
                  // nette de celui qui le règle, donc un recalcul local ne suffit
                  // pas.
                  const updateIntervenantPhase = (
                    group: 'cotraitants_facturation' | 'sous_traitants_facturation',
                    intervenantIdx: number,
                    phaseId: string,
                    phaseName: string,
                    patch: Partial<{ part_pct: number; montant_phase: number }>,
                  ) => {
                    const list = [...(noteForm[group] || [])];
                    const intervenant = { ...list[intervenantIdx] };
                    const phasesArr = [...(intervenant.phases || [])];
                    let pIdx = phasesArr.findIndex((p: any) => p.phase_id === phaseId);
                    if (pIdx === -1) {
                      phasesArr.push({ phase_id: phaseId, phase_name: phaseName, avancement_pct: 0, montant_phase: 0, part_pct: 0 });
                      pIdx = phasesArr.length - 1;
                    }
                    phasesArr[pIdx] = { ...phasesArr[pIdx], ...patch };
                    intervenant.phases = phasesArr;
                    list[intervenantIdx] = intervenant;
                    setNoteForm(recalcNote({ ...noteForm, [group]: list }));
                  };

                  /**
                   * Ouverture d'une note enregistrée AVANT cette refonte : chaque
                   * intervenant y portait son propre avancement et aucun
                   * `part_pct`, donc un recalcul direct ramènerait tous ses
                   * montants à zéro. On reconstruit ici les valeurs saisissables
                   * du nouveau modèle à partir des montants déjà enregistrés —
                   * l'avancement du groupement depuis le montant total de la
                   * mission, et la quote-part de chaque membre depuis son montant
                   * brut (son montant net plus ce qu'il règle à ses
                   * sous-traitants) — de sorte que la note rouvre sur exactement
                   * les mêmes montants qu'à son enregistrement.
                   */
                  const noteFormFromSaved = (note: any) => {
                    // Copie en profondeur des `phases` : on y écrit les `part_pct`
                    // reconstruits, et les objets de la note enregistrée sont
                    // partagés avec la liste affichée (`notesHonoraires`).
                    const copiePhases = (list: any[]) => (list || []).map((p: any) => ({ ...p }));
                    const form = {
                      ...note,
                      phases: copiePhases(note.phases),
                      cotraitants_facturation: (note.cotraitants_facturation || []).map((ct: any) => ({ ...ct, phases: copiePhases(ct.phases) })),
                      sous_traitants_facturation: (note.sous_traitants_facturation || []).map((st: any) => ({ ...st, phases: copiePhases(st.phases) })),
                    };
                    const dejaMigree = (form.phases || []).every((p: any) => p.part_pct != null);
                    if (dejaMigree) return recalcNote(form);

                    const phaseOf = (list: any[], phaseId: string) => (list || []).find((p: any) => p.phase_id === phaseId);
                    form.phases = (form.phases || []).map((phase: any) => {
                      const stMission = (st: any) => Number(phaseOf(st.phases, phase.phase_id)?.montant_phase) || 0;
                      const stPayePar = (payeurKey: string) => form.sous_traitants_facturation.reduce((s: number, st: any) =>
                        payeurEffectif(st) === payeurKey ? s + stMission(st) : s, 0);

                      // Dans l'ancien modèle, les montants des sous-traitants
                      // s'ajoutaient à ceux des membres ; dans le nouveau, ceux
                      // qu'un membre règle sont compris dans son montant. Les
                      // montants des membres sont donc repris tels quels et les
                      // valeurs saisissables déduites à l'envers : l'enveloppe à
                      // partager est la somme des membres moins ce qu'ils
                      // reversent, et le montant du groupement cette enveloppe plus
                      // TOUS les sous-traitants (ceux réglés en direct par le
                      // maître d'ouvrage compris, qui ne reviennent à aucun membre).
                      const totalMembres = (Number(phase.montant_phase) || 0)
                        + form.cotraitants_facturation.reduce((s: number, ct: any) => s + (Number(phaseOf(ct.phases, phase.phase_id)?.montant_phase) || 0), 0);
                      const stMoa = form.sous_traitants_facturation.reduce((s: number, st: any) =>
                        payeurEffectif(st) === 'moa' ? s + stMission(st) : s, 0);
                      const stMembres = form.sous_traitants_facturation.reduce((s: number, st: any) =>
                        payeurEffectif(st) !== 'moa' ? s + stMission(st) : s, 0);
                      const resteAPartager = totalMembres - stMembres;
                      const part = (montantFacture: number, reverse: number) =>
                        resteAPartager > 0 ? parseFloat((Math.max(0, montantFacture - reverse) / resteAPartager * 100).toFixed(4)) : 0;

                      form.cotraitants_facturation.forEach((ct: any) => {
                        const p = phaseOf(ct.phases, phase.phase_id);
                        if (!p) return;
                        p.part_pct = part(Number(p.montant_phase) || 0, stPayePar(ctContratId(ct) || ''));
                      });

                      const base = groupementPhaseBase(phase.phase_id);
                      const montantGroupement = resteAPartager + stMembres + stMoa;
                      return {
                        ...phase,
                        avancement_pct: base > 0 ? parseFloat((montantGroupement / base * 100).toFixed(4)) : 0,
                        part_pct: part(Number(phase.montant_phase) || 0, stPayePar('agence')),
                      };
                    });
                    return recalcNote(form);
                  };

                  // Avancement du groupement sur une mission — la seule valeur
                  // d'avancement saisie de toute la note.
                  const updateGroupementPct = (phaseIdx: number, pct: number) => {
                    const nextPhases = [...(noteForm.phases || [])];
                    nextPhases[phaseIdx] = { ...nextPhases[phaseIdx], avancement_pct: pct };
                    setNoteForm(recalcNote({ ...noteForm, phases: nextPhases }));
                  };

                  // Quote-part de l'agence sur une mission (les parts des
                  // cotraitants passent, elles, par `updateIntervenantPhase`).
                  const updatePartAgence = (phaseIdx: number, part: number) => {
                    const nextPhases = [...(noteForm.phases || [])];
                    nextPhases[phaseIdx] = { ...nextPhases[phaseIdx], part_pct: part };
                    setNoteForm(recalcNote({ ...noteForm, phases: nextPhases }));
                  };

                  // Remet la répartition d'une mission sur celle du contrat :
                  // chaque cotraitant à sa part contractuelle, l'agence au solde.
                  const resetRepartition = (phaseIdx: number) => {
                    const phaseId = (noteForm.phases || [])[phaseIdx]?.phase_id;
                    if (!phaseId) return;
                    const nextPhases = [...(noteForm.phases || [])];
                    nextPhases[phaseIdx] = { ...nextPhases[phaseIdx], part_pct: partAgenceDefaut };
                    const cts = (noteForm.cotraitants_facturation || []).map((ct: any) => {
                      const rec = cotraitants.find((c: any) => (c.contact_id || c.contact_name) === (ct.contact_id || ct.nom));
                      return {
                        ...ct,
                        phases: (ct.phases || []).map((p: any) => p.phase_id === phaseId ? { ...p, part_pct: partCotraitantDefaut(rec) } : p),
                      };
                    });
                    setNoteForm(recalcNote({ ...noteForm, phases: nextPhases, cotraitants_facturation: cts }));
                  };

                  const saveNote = async () => {
                    if (!noteForm || !id) return;
                    const montant_ht = (noteForm.phases || []).reduce((s: number, p: any) => s + (Number(p.montant_phase) || 0), 0);
                    const montant_tva = montant_ht * (noteForm.tva_rate || 20) / 100;
                    const montant_ttc = montant_ht + montant_tva;
                    // Instantané du cumul agence, exactement comme "Montant des
                    // Honoraires Cumulés HT" / "Montant à l'Acompte Précédent HT" sur
                    // le modèle papier — pris au moment de l'enregistrement pour ne
                    // pas bouger rétroactivement si une note antérieure est éditée.
                    const contratId = contrat?.id || null;
                    const priorNotes = notesHonoraires.filter((n: any) =>
                      n.contrat_id === contratId && n.id !== editingNote?.id
                      && (!n.date || !noteForm.date || n.date <= noteForm.date));
                    const montant_cumule_precedent_ht = priorNotes.reduce((s: number, n: any) => s + (Number(n.montant_ht) || 0), 0);
                    const montant_cumule_ht = montant_cumule_precedent_ht + montant_ht;
                    const pct_facturation_cumule = honRevises > 0 ? Math.min(100, parseFloat((montant_cumule_ht / honRevises * 100).toFixed(2))) : 0;
                    const payload = {
                      ...noteForm, project_id: id, contrat_id: contratId, montant_ht, montant_tva, montant_ttc,
                      montant_cumule_precedent_ht, montant_cumule_ht, pct_facturation_cumule,
                    };
                    // Un échec fermait jusqu'ici le formulaire comme une réussite :
                    // la ventilation saisie était perdue sans un mot. Le formulaire
                    // reste désormais ouvert, saisie intacte, tant que le serveur
                    // n'a pas confirmé.
                    if (isSavingNote) return;
                    setIsSavingNote(true);
                    try {
                      const res = editingNote?.id
                        ? await fetch(`/api/notes_honoraires/${editingNote.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
                        : await fetch('/api/notes_honoraires', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                      if (!res.ok) {
                        const err = await res.json().catch(() => null);
                        showToast(t('projectdetail_note_save_failed', { error: err?.error || res.statusText }), 'error', { duration: 6000 });
                        return;
                      }
                      setIsAddingNote(false);
                      setEditingNote(null);
                      setNoteForm(null);
                      showToast(t('projectdetail_note_saved'));
                      const listRes = await fetch(`/api/notes_honoraires?project_id=${id}`);
                      if (listRes.ok) setNotesHonoraires((await listRes.json()) || []);
                    } catch (err) {
                      console.error('Failed to save fee note:', err);
                      showToast(t('projectdetail_note_save_failed', { error: (err as Error)?.message || '' }), 'error', { duration: 6000 });
                    } finally {
                      setIsSavingNote(false);
                    }
                  };

                  const deleteNote = (noteId: string) => {
                    deleteWithUndo(setNotesHonoraires, noteId, `/api/notes_honoraires/${noteId}`, 'projectdetail_deleted_note');
                  };

                  const exportNotePdf = async (note: any) => {
                    const { exportNoteHonorairesToPDF } = await import('../lib/noteHonorairesExport');
                    await exportNoteHonorairesToPDF(
                      note, contrat,
                      { name: project.name, client: project.client, construction_cost: project.construction_cost },
                      settings ?? {},
                    );
                  };

                  // L'acte le plus engageant de la fiche (numérotation, envoi au
                  // connecteur comptable) : il se confirme, montant sous les yeux,
                  // et se conclut par un lien vers la facture plutôt que par un
                  // simple changement de couleur d'icône.
                  const createFactureFromNote = async (note: any) => {
                    if (note.invoice_id || generatingInvoiceNoteId) return;
                    const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
                    const ht = Number(note.montant_ht) || 0;
                    const ttc = Number(note.montant_ttc) || 0;
                    const confirmed = await confirmAction({
                      title: t('projectdetail_generate_invoice_title'),
                      tone: 'primary',
                      confirmLabel: t('projectdetail_generate_invoice'),
                      cancelLabel: t('projectdetail_dialog_cancel'),
                      message: (
                        <>
                          {note.numero && <p className="mb-2 font-medium" style={{ color: 'var(--tblr-text)' }}>{t('projectdetail_generate_invoice_note', { numero: note.numero })}{note.objet ? ` · ${note.objet}` : ''}</p>}
                          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 py-3 my-3 border-y tabular-nums" style={{ borderColor: 'var(--tblr-border)' }}>
                            <dt>{t('projectdetail_generate_invoice_ht')}</dt>
                            <dd className="text-right font-medium" style={{ color: 'var(--tblr-text)' }}>{eur.format(ht)}</dd>
                            <dt>{t('projectdetail_generate_invoice_tva')}</dt>
                            <dd className="text-right" style={{ color: 'var(--tblr-text)' }}>{eur.format(ttc - ht)}</dd>
                            <dt className="font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('projectdetail_generate_invoice_ttc')}</dt>
                            <dd className="text-right font-bold" style={{ color: 'var(--tblr-text)' }}>{eur.format(ttc)}</dd>
                          </dl>
                          <p>{t('projectdetail_generate_invoice_explain')}</p>
                        </>
                      ),
                    });
                    if (!confirmed) return;
                    setGeneratingInvoiceNoteId(note.id);
                    try {
                      const res = await fetch(`/api/notes_honoraires/${note.id}/facture`, { method: 'POST' });
                      if (!res.ok) {
                        const err = await res.json().catch(() => null);
                        showToast(err?.error || t('projectdetail_draft_invoice_create_failed'), 'error', { duration: 6000 });
                        return;
                      }
                      const created = await res.json().catch(() => null);
                      const invoiceId: string | undefined = created?.invoice?.id;
                      showToast(t('projectdetail_draft_invoice_created'), 'success', {
                        duration: 8000,
                        action: invoiceId ? { label: t('projectdetail_open_invoice'), onClick: () => { if (confirmDiscard()) navigate(`/invoices?open=${invoiceId}`); } } : undefined,
                      });
                      const listRes = await fetch(`/api/notes_honoraires?project_id=${id}`);
                      if (listRes.ok) setNotesHonoraires((await listRes.json()) || []);
                    } catch (err) {
                      console.error('Failed to create draft invoice:', err);
                      showToast(t('projectdetail_draft_invoice_create_failed'), 'error', { duration: 6000 });
                    } finally {
                      setGeneratingInvoiceNoteId(null);
                    }
                  };

                  const STATUS_NOTE_COLORS: Record<string, string> = {
                    Brouillon: 'bg-zinc-100 text-[var(--tblr-muted)]',
                    Envoyée: 'bg-blue-100 text-blue-700',
                    Payée: 'bg-green-100 text-green-700',
                  };
                  // Le statut est enregistré en français (valeur de base) ; seul
                  // son affichage passe par la traduction.
                  const NOTE_STATUS_KEYS: Record<string, string> = { Brouillon: 'draft', Envoyée: 'sent', Payée: 'paid' };
                  const noteStatusLabel = (status: string) => NOTE_STATUS_KEYS[status] ? t(`projectdetail_note_status_${NOTE_STATUS_KEYS[status]}`) : status;

                  return (
                    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <CardHeader
                        icon={IconReceipt}
                        title={t('projectdetail_notes_title')}
                        description={t('projectdetail_notes_desc')}
                        action={
                          <button
                            type="button"
                            onClick={() => {
                              setNoteForm(initNoteForm());
                              setEditingNote(null);
                              setIsAddingNote(true);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition"
                          >
                            <IconPlus size={14} />
                            {t('projectdetail_notes_new')}
                          </button>
                        }
                      />

                      {/* KPIs notes */}
                      {notesHonoraires.length > 0 && (
                        <div className="px-6 pt-4 pb-2 grid grid-cols-3 gap-3">
                          {[
                            { label: t('projectdetail_notes_kpi_ht'), value: totalNotesHT, color: 'blue' },
                            { label: t('projectdetail_notes_kpi_ttc'), value: totalNotesTTC, color: 'indigo' },
                            { label: t('projectdetail_notes_kpi_remaining'), value: Math.max(0, honRevises - totalNotesHT), color: 'amber' },
                          ].map(kpi => (
                            <StatTile
                              key={kpi.label}
                              label={kpi.label}
                              color={kpi.color as StatTileColor}
                              value={new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(kpi.value)}
                            />
                          ))}
                        </div>
                      )}

                      {/* Formulaire nouvelle note */}
                      {isAddingNote && noteForm && (
                        <div className="p-6 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-5">
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="space-y-1">
                              <label htmlFor="note-numero" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_note_number')}</label>
                              <input id="note-numero" type="text" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                value={noteForm.numero} onChange={e => setNoteForm({ ...noteForm, numero: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <label htmlFor="note-date" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_col_date')}</label>
                              <input id="note-date" type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                value={noteForm.date} onChange={e => setNoteForm({ ...noteForm, date: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <label htmlFor="note-tva" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_note_vat')}</label>
                              <input id="note-tva" type="number" min={0} max={30} className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                value={noteForm.tva_rate} onChange={e => setNoteForm({ ...noteForm, tva_rate: parseFloat(e.target.value) || 20 })} />
                            </div>
                            <div className="space-y-1">
                              <label htmlFor="note-statut" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_col_status')}</label>
                              <select id="note-statut" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                value={noteForm.status} onChange={e => setNoteForm({ ...noteForm, status: e.target.value })}>
                                {['Brouillon', 'Envoyée', 'Payée'].map(s => <option key={s} value={s}>{noteStatusLabel(s)}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label htmlFor="note-objet" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_note_subject')}</label>
                            <input id="note-objet" type="text" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={noteForm.objet} onChange={e => setNoteForm({ ...noteForm, objet: e.target.value })}
                              placeholder={t('projectdetail_note_subject_placeholder')} />
                          </div>

                          {/* Ventilation par mission — agence, cotraitants et sous-traitants */}
                          <div>
                            <p className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase mb-3">{t('projectdetail_note_breakdown')}</p>
                            {/* min-w-full (et non w-full) : avec un cotraitant et plusieurs
                                sous-traitants, cette ligne dépasse vite la largeur de l'écran
                                (deux colonnes % + € par membre). min-w-full garde le tableau à
                                sa largeur naturelle sans jamais la plafonner à celle du
                                conteneur, pour que le débordement se traduise par le défilement
                                horizontal de ce conteneur plutôt que par des colonnes tassées. */}
                            <div className="overflow-x-auto rounded-lg border border-[var(--tblr-border)]">
                              <table className="min-w-full text-xs border-collapse">
                                <thead>
                                  <tr className="bg-[var(--tblr-surface-2)]">
                                    <th rowSpan={2} className="text-left font-bold text-[var(--tblr-muted)] uppercase p-2 sticky left-0 bg-[var(--tblr-surface-2)] align-bottom whitespace-nowrap">{t('projectdetail_note_col_mission')}</th>
                                    {/* Groupement : le pourcentage de la mission facturé par
                                        l'ensemble de l'équipe dans cette note, et son montant. */}
                                    <th colSpan={2} title={t('projectdetail_note_col_groupement_title')} className="text-center font-bold text-[var(--tblr-muted)] uppercase p-1 border-l border-[var(--tblr-border)]">{t('projectdetail_note_col_groupement')}</th>
                                    {/* L'agence (mandataire) et les cotraitants sous une même
                                        entête : ce sont les membres du groupement titulaires du
                                        marché de maîtrise d'œuvre, par opposition aux
                                        sous-traitants regroupés à leur droite. */}
                                    <th colSpan={2 + (noteForm.cotraitants_facturation || []).length * 2} className="text-center font-bold text-[var(--tblr-muted)] uppercase p-1 border-l border-[var(--tblr-border)]">
                                      {(noteForm.cotraitants_facturation || []).length > 0 ? t('projectdetail_note_col_members') : t('projectdetail_note_col_mandataire')}
                                    </th>
                                    {(noteForm.sous_traitants_facturation || []).length > 0 && (
                                      <th colSpan={(noteForm.sous_traitants_facturation || []).length} className="text-center font-bold text-[var(--tblr-muted)] uppercase p-1 border-l border-[var(--tblr-border)]">{t('projectdetail_note_col_subcontractors')}</th>
                                    )}
                                  </tr>
                                  <tr className="bg-[var(--tblr-surface-2)]">
                                    <th className="text-center font-bold text-[var(--tblr-muted)] uppercase p-2 border-l border-[var(--tblr-border)]">%</th>
                                    <th className="text-center font-bold text-[var(--tblr-muted)] uppercase p-2">€</th>
                                    <th className="text-center font-bold text-[var(--tblr-muted)] uppercase p-2 border-l border-[var(--tblr-border)]" colSpan={2}>{agencyName}</th>
                                    {(noteForm.cotraitants_facturation || []).map((ct: any, i: number) => (
                                      <th key={`ct-h-${i}`} className="text-center font-bold text-[var(--tblr-muted)] uppercase p-2 border-l border-[var(--tblr-border)]" colSpan={2}>{ctDisplayName(ct)}</th>
                                    ))}
                                    {(noteForm.sous_traitants_facturation || []).map((st: any, i: number) => (
                                      <th key={`st-h-${i}`} className="text-center font-bold text-[var(--tblr-muted)] uppercase p-2 border-l border-[var(--tblr-border)]">
                                        {stDisplayName(st)}
                                        {payeurLabel(st) && <span className="block text-[0.6875rem] font-normal normal-case text-amber-600">{payeurLabel(st)}</span>}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(noteForm.phases || []).map((phase: any, idx: number) => {
                                    const basePhase = phases.find((p: any) => p.id === phase.phase_id) || DEFAULT_PHASES.find((p: any) => p.id === phase.phase_id);
                                    // Montant total de la mission pour le groupement, et ce qui en
                                    // est facturé dans cette note : c'est LA valeur saisie de la
                                    // ligne, tous les montants des membres s'en déduisant.
                                    const baseGroupement = groupementPhaseBase(phase.phase_id);
                                    const pctGroupement = Number(phase.avancement_pct) || 0;
                                    const montantGroupement = baseGroupement * pctGroupement / 100;
                                    // Une mission ne se facture pas au-delà de 100 %, cumul des
                                    // notes précédentes du même contrat compris.
                                    const pctRestant = Math.max(0, 100 - cumulGroupementPct(phase.phase_id));
                                    const ctPhasesRow = (noteForm.cotraitants_facturation || []).map((ct: any) =>
                                      (ct.phases || []).find((p: any) => p.phase_id === phase.phase_id) || { part_pct: 0, montant_phase: 0 });
                                    const stPhasesRow = (noteForm.sous_traitants_facturation || []).map((st: any) =>
                                      (st.phases || []).find((p: any) => p.phase_id === phase.phase_id) || { montant_phase: 0 });
                                    // La répartition d'une mission doit totaliser 100 % : en deçà,
                                    // une part du montant groupement n'est attribuée à personne ;
                                    // au-delà, la somme des membres dépasse ce qui est facturé.
                                    const totalParts = (Number(phase.part_pct) || 0)
                                      + ctPhasesRow.reduce((s: number, p: any) => s + (Number(p.part_pct) || 0), 0);
                                    const repartitionIncomplete = pctGroupement > 0 && Math.abs(totalParts - 100) > 0.01;
                                    // Ce que chaque membre reverse à ses sous-traitants sur cette
                                    // mission : compris dans son montant facturé, donc affiché
                                    // sous celui-ci en « dont … » et jamais additionné en plus.
                                    const stReverse = (payeurKey: string) => (noteForm.sous_traitants_facturation || []).reduce((s: number, st: any, i: number) =>
                                      payeurEffectif(st) === payeurKey ? s + (Number(stPhasesRow[i]?.montant_phase) || 0) : s, 0);
                                    // Tous sous-traitants de la mission confondus : ce qui sort de
                                    // l'enveloppe avant répartition entre les membres.
                                    const stTotalMission = stPhasesRow.reduce((s: number, p: any) => s + (Number(p.montant_phase) || 0), 0);
                                    const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
                                    // Pourcentage RÉELLEMENT facturé par un membre sur cette
                                    // mission : sa quote-part saisie porte sur ce qui reste après
                                    // sous-traitance, celui qui règle un sous-traitant facture donc
                                    // un pourcentage plus élevé (et les autres plus faible). On
                                    // l'affiche sous le montant dès qu'il diffère de la part
                                    // saisie, sinon la ligne semblerait contredire les 50/50 du
                                    // contrat sans dire pourquoi.
                                    const pctEffectif = (montant: number) =>
                                      montantGroupement > 0 ? montant / montantGroupement * 100 : 0;
                                    const pct1 = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n);
                                    return (
                                      <tr key={phase.phase_id} className="border-t border-[var(--tblr-border)] bg-white dark:bg-zinc-900">
                                        {/* Icône plutôt que le libellé « Répartir » : sur cette
                                            colonne sticky, chaque caractère de plus s'ajoute à la
                                            largeur qui reste fixe pendant le défilement horizontal
                                            des colonnes financières — la garder compacte laisse plus
                                            de place à ces dernières sur un écran étroit. */}
                                        <td className="p-2 font-semibold text-zinc-600 dark:text-zinc-300 whitespace-nowrap sticky left-0 bg-white dark:bg-zinc-900">
                                          <span className="inline-flex items-center gap-1.5">
                                            {basePhase?.name || phase.phase_name}
                                            {(noteForm.cotraitants_facturation || []).length > 0 && (
                                              <button type="button" title={t('projectdetail_note_reset_split')} aria-label={t('projectdetail_note_reset_split_aria', { mission: basePhase?.name || phase.phase_name })}
                                                className="p-0.5 rounded text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex-shrink-0"
                                                onClick={() => resetRepartition(idx)}><IconRefresh size={12} /></button>
                                            )}
                                          </span>
                                        </td>
                                        <td className="p-1 border-l border-[var(--tblr-border)]">
                                          <div className="flex items-center gap-1 justify-center">
                                            <input type="number" min={0} max={pctRestant} step={5}
                                              title={t('projectdetail_note_groupement_pct_title', { remaining: pctRestant.toFixed(1) })}
                                              aria-label={t('projectdetail_note_groupement_pct_aria', { mission: basePhase?.name || phase.phase_name })}
                                              className="w-14 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded p-1 text-center font-bold outline-none focus:ring-2 focus:ring-blue-500"
                                              value={phase.avancement_pct}
                                              onChange={e => updateGroupementPct(idx, Math.min(pctRestant, Math.max(0, parseFloat(e.target.value) || 0)))} />
                                            <span className="text-[var(--tblr-muted)]">%</span>
                                          </div>
                                        </td>
                                        <td className="p-2 text-right font-bold text-zinc-700 dark:text-zinc-300 whitespace-nowrap"
                                          title={t('projectdetail_note_groupement_amount_title', { amount: eur(baseGroupement) })}>
                                          {eur(montantGroupement)}
                                          {repartitionIncomplete && (
                                            <span className="block text-[0.6875rem] font-normal text-amber-600" title={t('projectdetail_note_split_incomplete_title')}>
                                              {t('projectdetail_note_split_incomplete', { pct: totalParts.toFixed(1) })}
                                            </span>
                                          )}
                                        </td>
                                        {/* Quote-part de l'agence dans ce qui reste après
                                            sous-traitance, et son montant facturé — sa part nette
                                            plus ce qu'elle reverse à ses propres sous-traitants. */}
                                        <td className="p-1 border-l border-[var(--tblr-border)]">
                                          <div className="flex items-center gap-1">
                                            <input type="number" min={0} max={100} step="any"
                                              title={t('projectdetail_note_share_title', { name: agencyName })}
                                              aria-label={t('projectdetail_note_share_aria', { name: agencyName, mission: basePhase?.name || phase.phase_name })}
                                              className="w-12 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded p-1 text-center outline-none focus:ring-2 focus:ring-blue-500"
                                              value={phase.part_pct ?? 0}
                                              onChange={e => updatePartAgence(idx, Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))} />
                                            <span className="text-[var(--tblr-muted)]">%</span>
                                          </div>
                                        </td>
                                        <td className="p-2 text-right whitespace-nowrap">
                                          {eur(Number(phase.montant_phase) || 0)}
                                          {stTotalMission > 0 && (
                                            <span className="block text-[0.6875rem] font-normal text-amber-600"
                                              title={stReverse('agence') > 0
                                                ? t('projectdetail_note_effective_pct_payer', { name: agencyName })
                                                : t('projectdetail_note_effective_pct_other')}>
                                              {pct1(pctEffectif(Number(phase.montant_phase) || 0))} %
                                              {stReverse('agence') > 0 && ` · ${t('projectdetail_note_including_st', { amount: eur(stReverse('agence')) })}`}
                                            </span>
                                          )}
                                        </td>
                                        {(noteForm.cotraitants_facturation || []).map((ct: any, ctIdx: number) => {
                                          const ctPhase = ctPhasesRow[ctIdx];
                                          const reverse = stReverse(ctContratId(ct) || '');
                                          return (
                                            <React.Fragment key={`ct-${ctIdx}`}>
                                              <td className="p-1 border-l border-[var(--tblr-border)]">
                                                <div className="flex items-center gap-1">
                                                  <input type="number" min={0} max={100} step="any"
                                                    title={t('projectdetail_note_share_title', { name: ctDisplayName(ct) })}
                                                    aria-label={t('projectdetail_note_share_aria', { name: ctDisplayName(ct), mission: basePhase?.name || phase.phase_name })}
                                                    className="w-12 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded p-1 text-center outline-none focus:ring-2 focus:ring-blue-500"
                                                    value={ctPhase.part_pct ?? 0}
                                                    onChange={e => updateIntervenantPhase('cotraitants_facturation', ctIdx, phase.phase_id, basePhase?.name || phase.phase_name, { part_pct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })} />
                                                  <span className="text-[var(--tblr-muted)]">%</span>
                                                </div>
                                              </td>
                                              <td className="p-2 text-right whitespace-nowrap">
                                                {eur(Number(ctPhase.montant_phase) || 0)}
                                                {stTotalMission > 0 && (
                                                  <span className="block text-[0.6875rem] font-normal text-amber-600"
                                                    title={reverse > 0
                                                      ? t('projectdetail_note_effective_pct_payer', { name: ctDisplayName(ct) })
                                                      : t('projectdetail_note_effective_pct_other')}>
                                                    {pct1(pctEffectif(Number(ctPhase.montant_phase) || 0))} %
                                                    {reverse > 0 && ` · ${t('projectdetail_note_including_st', { amount: eur(reverse) })}`}
                                                  </span>
                                                )}
                                              </td>
                                            </React.Fragment>
                                          );
                                        })}
                                        {(noteForm.sous_traitants_facturation || []).map((st: any, stIdx: number) => {
                                          const stPhase = stPhasesRow[stIdx];
                                          const stKey = st.contact_id || st.nom;
                                          // Les sous-traitants n'ont pas de répartition par mission dans
                                          // le contrat (un seul montant global) : le plafond porte donc
                                          // sur le montant total du sous-traitant, réparti sur les autres
                                          // missions déjà saisies dans cette note et le cumul des notes
                                          // précédentes.
                                          const stRecord = sousTraitants.find((s: any) => (s.contact_id || s.contact_name) === stKey);
                                          const stTotal = stRecord?.montant || 0;
                                          const stOtherPhasesSum = (st.phases || []).filter((p: any) => p.phase_id !== phase.phase_id).reduce((s: number, p: any) => s + (Number(p.montant_phase) || 0), 0);
                                          // Second plafond : la sous-traitance d'une mission sort de
                                          // l'enveloppe de cette mission, elle ne peut donc pas la
                                          // dépasser (les autres sous-traitants de la ligne déjà
                                          // saisis comptent dans ce qui reste).
                                          const resteMission = Math.max(0, montantGroupement - (stTotalMission - (Number(stPhase.montant_phase) || 0)));
                                          const stCap = Math.min(
                                            Math.max(0, stTotal - cumulStTotal(stKey) - stOtherPhasesSum),
                                            resteMission,
                                          );
                                          return (
                                            <td key={`st-${stIdx}`} className="p-1 border-l border-[var(--tblr-border)]">
                                              <input type="number" min={0} max={stCap}
                                                title={t('projectdetail_note_st_amount_title', { name: stDisplayName(st) })}
                                                aria-label={t('projectdetail_note_st_amount_aria', { name: stDisplayName(st), mission: basePhase?.name || phase.phase_name })}
                                                className="w-20 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded p-1 text-right outline-none focus:ring-2 focus:ring-blue-500"
                                                value={stPhase.montant_phase}
                                                onChange={e => updateIntervenantPhase('sous_traitants_facturation', stIdx, phase.phase_id, basePhase?.name || phase.phase_name, { montant_phase: Math.min(Math.max(0, parseFloat(e.target.value) || 0), stCap) })} />
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-[var(--tblr-border)] font-bold text-zinc-700 dark:text-zinc-300 bg-[var(--tblr-surface-2)]">
                                    <td className="p-2 sticky left-0 bg-[var(--tblr-surface-2)]">{t('projectdetail_note_total_ht')}</td>
                                    {(() => {
                                      // Le total du groupement est la somme des montants de
                                      // mission facturés (base × avancement), et NON la somme des
                                      // colonnes : saisir des sous-traitants ne change pas ce que
                                      // le groupement facture, seulement qui l'encaisse — les
                                      // additionner aux membres compterait deux fois ce que le
                                      // payeur leur reverse.
                                      const totalGroupement = (noteForm.phases || []).reduce((s: number, p: any) =>
                                        s + groupementPhaseBase(p.phase_id) * (Number(p.avancement_pct) || 0) / 100, 0);
                                      // Base de l'ensemble des missions présentes dans la note,
                                      // pour que le % du pied se lise comme la somme des lignes.
                                      const baseGroupement = (noteForm.phases || []).reduce((s: number, p: any) => s + groupementPhaseBase(p.phase_id), 0);
                                      return (
                                        <>
                                          <td className="p-2 border-l border-[var(--tblr-border)] text-center whitespace-nowrap">
                                            {baseGroupement > 0 ? `${(totalGroupement / baseGroupement * 100).toFixed(1)} %` : ''}
                                          </td>
                                          <td className="p-2 text-right whitespace-nowrap">
                                            {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(totalGroupement)}
                                          </td>
                                        </>
                                      );
                                    })()}
                                    <td className="p-2 border-l border-[var(--tblr-border)]"></td>
                                    <td className="p-2 text-right text-blue-600 whitespace-nowrap">
                                      {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((noteForm.phases || []).reduce((s: number, p: any) => s + (Number(p.montant_phase) || 0), 0))}
                                    </td>
                                    {(noteForm.cotraitants_facturation || []).map((ct: any, i: number) => (
                                      <td key={`ct-tot-${i}`} className="p-2 text-right whitespace-nowrap border-l border-[var(--tblr-border)]" colSpan={2}>
                                        {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(ct.montant_ht || 0)}
                                      </td>
                                    ))}
                                    {(noteForm.sous_traitants_facturation || []).map((st: any, i: number) => (
                                      <td key={`st-tot-${i}`} className="p-2 text-right whitespace-nowrap border-l border-[var(--tblr-border)]">
                                        {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(st.montant_ht || 0)}
                                      </td>
                                    ))}
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                            <p className="mt-2 text-[0.6875rem] text-[var(--tblr-muted)]">{t('projectdetail_note_help_short', { agency: agencyName })}</p>
                            <details className="mt-1 text-[0.6875rem] text-[var(--tblr-muted)]">
                              <summary className="cursor-pointer font-semibold w-fit">{t('projectdetail_note_help_more')}</summary>
                              <ul className="mt-1.5 space-y-1 list-disc pl-4 max-w-prose">
                                <li>{t('projectdetail_note_help_1')}</li>
                                <li>{t('projectdetail_note_help_2')}</li>
                                <li>{t('projectdetail_note_help_3')}</li>
                                <li>{t('projectdetail_note_help_4', { agency: agencyName })}</li>
                              </ul>
                            </details>
                          </div>

                          {/* Suivi du pourcentage de facturation */}
                          {honRevises > 0 && (() => {
                            const montant_ht_preview = (noteForm.phases || []).reduce((s: number, p: any) => s + (Number(p.montant_phase) || 0), 0);
                            const contratId = contrat?.id || null;
                            const priorNotes = notesHonoraires.filter((n: any) => n.contrat_id === contratId && n.id !== editingNote?.id);
                            const cumulPrecedent = priorNotes.reduce((s: number, n: any) => s + (Number(n.montant_ht) || 0), 0);
                            const pct = Math.min(100, (cumulPrecedent + montant_ht_preview) / honRevises * 100);
                            return (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">
                                  <span>{t('projectdetail_note_cumulative', { agency: agencyName })}</span>
                                  <span className="text-zinc-700 dark:text-zinc-300">{pct.toFixed(1)} %</span>
                                </div>
                                <div className="h-1.5 rounded-full bg-[var(--tblr-surface-2)] overflow-hidden">
                                  <div className="h-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                                </div>
                              </div>
                            );
                          })()}

                          <div className="flex gap-2 justify-end pt-2 border-t border-[var(--tblr-border)]">
                            <button type="button" onClick={() => { setIsAddingNote(false); setNoteForm(null); setEditingNote(null); }} className="px-4 py-2 text-sm font-bold text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors">{t('projectdetail_dialog_cancel')}</button>
                            <button type="button" onClick={saveNote} disabled={isSavingNote} aria-busy={isSavingNote} className="px-4 py-2 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition disabled:opacity-60 disabled:cursor-wait">
                              {isSavingNote && <span aria-hidden className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                              {editingNote ? t('projectdetail_note_save_edit') : t('projectdetail_note_save_new')}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Liste des notes */}
                      {notesHonoraires.length === 0 && !isAddingNote ? (
                        <div className="p-8 text-center text-[var(--tblr-muted)] italic text-sm">
                          {t('projectdetail_notes_empty')}
                        </div>
                      ) : (
                        <div className="divide-y divide-[var(--tblr-border)]">
                          {notesHonoraires.map((note: any) => {
                            const phases = (note.phases || []).filter((p: any) => p.montant_phase > 0);
                            return (
                              <div key={note.id} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      {note.numero && <span className="text-[0.6875rem] font-mono px-2 py-0.5 rounded bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)]">{note.numero}</span>}
                                      <span className={cn('text-[0.6875rem] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider', STATUS_NOTE_COLORS[note.status] || 'bg-zinc-100 text-[var(--tblr-muted)]')}>{noteStatusLabel(note.status)}</span>
                                      {note.date && <span className="text-[0.6875rem] text-[var(--tblr-muted)]">{new Date(note.date).toLocaleDateString('fr-FR')}</span>}
                                    </div>
                                    {note.objet && <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium">{note.objet}</p>}
                                    {phases.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {phases.map((p: any) => (
                                          <span key={p.phase_id} className="text-[0.6875rem] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 font-medium">
                                            {p.phase_name.split('—')[0].trim()} {p.avancement_pct}%
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    <div className="flex gap-4 mt-1 text-xs text-[var(--tblr-muted)]">
                                      <span className="font-bold text-blue-600">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(note.montant_ht)} {t('projectdetail_ht')}</span>
                                      <span>{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(note.montant_ttc)} {t('projectdetail_ttc')}</span>
                                      {note.pct_facturation_cumule != null && (
                                        <span className="flex items-center gap-1">
                                          <span className="inline-block w-16 h-1.5 rounded-full bg-[var(--tblr-surface-2)] overflow-hidden align-middle">
                                            <span className="block h-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, note.pct_facturation_cumule))}%` }} />
                                          </span>
                                          {t('projectdetail_note_cumulative_pct', { pct: note.pct_facturation_cumule.toFixed(1) })}
                                        </span>
                                      )}
                                      {note.invoice_id && (
                                        <Link to={`/invoices?open=${note.invoice_id}`} className="text-green-700 dark:text-green-400 font-bold underline underline-offset-2 hover:no-underline">
                                          {t('projectdetail_invoice_created_link')}
                                        </Link>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    {canWriteInvoices(currentUser?.system_role) && !note.invoice_id && (
                                      <button
                                        type="button"
                                        title={t('projectdetail_generate_invoice_hint')}
                                        onClick={() => createFactureFromNote(note)}
                                        disabled={generatingInvoiceNoteId === note.id}
                                        aria-busy={generatingInvoiceNoteId === note.id}
                                        className="mr-1 h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border text-[0.8125rem] font-semibold transition-colors hover:bg-[var(--tblr-primary-lt)] disabled:opacity-60 disabled:cursor-wait"
                                        style={{ borderColor: 'var(--tblr-primary)', color: 'var(--tblr-primary)' }}
                                      >
                                        {generatingInvoiceNoteId === note.id
                                          ? <span aria-hidden className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                          : <IconFileInvoice size={16} aria-hidden />}
                                        <span className="hidden sm:inline">{t('projectdetail_generate_invoice')}</span>
                                        <span className="sm:hidden">{t('projectdetail_generate_invoice_short')}</span>
                                      </button>
                                    )}
                                    <button type="button" title={t('projectdetail_note_export_pdf')} aria-label={t('projectdetail_note_export_pdf')} onClick={() => exportNotePdf(note)} className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-[var(--tblr-primary)] hover:bg-[var(--tblr-surface-2)] transition-colors"><IconFileDownload size={16} /></button>
                                    <button type="button" title={t('projectdetail_edit_note')} aria-label={t('projectdetail_edit_note')} onClick={() => {
                                      setEditingNote(note);
                                      setNoteForm(noteFormFromSaved(note));
                                      setIsAddingNote(true);
                                    }} className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-[var(--tblr-primary)] hover:bg-[var(--tblr-surface-2)] transition-colors"><IconEdit size={16} /></button>
                                    <button type="button" title={t('projectdetail_delete_note')} aria-label={t('projectdetail_delete_note')} onClick={() => deleteNote(note.id)} className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-[var(--tblr-danger)] hover:bg-[var(--tblr-surface-2)] transition-colors"><IconTrash size={16} /></button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

              </div>
            )}
            {activeTab === 'PRO' && <div className="mt-4"><ProTab projectId={id!} projectName={project?.name} onLotsChanged={fetchProject} /></div>}
            {activeTab === 'TACHES' && <ProjectTasksTab projectId={id!} projects={project ? [project] : []} />}
            {activeTab === 'INFOS' && showFullEditor && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-8">
                    {/* Hero Section - Editable */}
                    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <div className="aspect-[21/9] relative overflow-hidden bg-zinc-100 dark:bg-zinc-800 group">
                        {project.image_url ? (
                          <img src={project.image_url} alt={project.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[var(--tblr-muted)]">
                            <IconUpload size={48} />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 pointer-coarse:bg-transparent pointer-coarse:items-start pointer-coarse:justify-end pointer-coarse:p-3 transition-opacity flex items-center justify-center">
                          <label className="cursor-pointer bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-6 py-3 pointer-coarse:px-3 pointer-coarse:py-2 rounded-lg font-bold border border-white/30 transition focus-within:ring-2 focus-within:ring-white">
                            <input type="file" className="sr-only" accept="image/*" onChange={handleImageUpload} />
                            {project.image_url ? t('projectdetail_cover_change') : t('projectdetail_cover_add')}
                          </label>
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                        <div className="absolute inset-x-0 bottom-0 p-8 space-y-4">
                          <input 
                            type="text"
                            className="w-full bg-transparent border-none text-4xl font-bold text-white placeholder:text-white/40 focus:ring-0 p-0"
                            value={project.name}
                            onChange={e => setProject({...project, name: e.target.value})}
                            aria-label={t('projectdetail_full_name')}
                            placeholder={t('projectdetail_full_name')}
                          />
                          <div className="flex flex-wrap items-center gap-4">
                            <ContactAutocomplete
                              contacts={contacts.filter(isClientContact)}
                              value={project.client_id || contacts.find(c => (c.company_name || `${c.first_name} ${c.last_name}`) === project.client)?.id || ''}
                              onChange={id => {
                                const contact = contacts.find(c => c.id === id);
                                if (contact) {
                                  setProject({...project, client_id: contact.id, client: contact.company_name || `${contact.first_name} ${contact.last_name}`});
                                }
                              }}
                              onAddNew={() => setIsContactModalOpen(true)}
                              placeholder={t('projectdetail_full_client')}
                              inputClassName="bg-white/10 border border-white/20 text-white placeholder:text-white/60"
                              addNewLabel={t('projectdetail_full_client_new')}
                            />
                            <span aria-hidden className="text-white/40">•</span>
                            <input 
                              type="text"
                              className="bg-white/10 border border-white/20 rounded-lg px-3 py-1 text-sm font-medium text-white placeholder:text-white/60 focus:ring-2 focus:ring-blue-500 outline-none"
                              value={project.category || ''}
                              onChange={e => setProject({...project, category: e.target.value})}
                              aria-label={t('projectdetail_full_category')}
                              placeholder={t('projectdetail_full_category')}
                            />
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-8 space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                          <div className="md:col-span-2 space-y-2">
                            <label htmlFor="fiche-description" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('project_overview_objet')}</label>
                            <textarea
                              id="fiche-description"
                              className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] min-h-[120px] resize-none"
                              value={project.description}
                              onChange={e => setProject({...project, description: e.target.value})}
                              placeholder={t('project_overview_objet_placeholder')}
                            />
                          </div>
                          <div className="space-y-6">
                            <div className="space-y-2">
                              <label htmlFor="fiche-chef-projet" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('project_overview_project_manager')}</label>
                              <input
                                id="fiche-chef-projet"
                                type="text"
                                className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                                value={project.project_manager || ''}
                                onChange={e => setProject({...project, project_manager: e.target.value})}
                                placeholder={t('projectdetail_full_manager_placeholder')}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 pt-8 border-t border-[var(--tblr-border)]">
                          <div className="space-y-2">
                            <label htmlFor="fiche-surface" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('projectdetail_full_surface')}</label>
                            <input
                              id="fiche-surface"
                              type="number"
                              className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                              value={project.surface || 0}
                              onChange={e => setProject({...project, surface: Number(e.target.value)})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="fiche-cout-travaux" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('projectdetail_fees_works_cost_input')}</label>
                            <div className="relative">
                              <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">€</span>
                              <input
                                id="fiche-cout-travaux"
                                type="number"
                                readOnly={!!contratHonoraires}
                                title={contratHonoraires ? t('projectdetail_fees_locked') : undefined}
                                className={cn('w-full pl-8 pr-4 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold', contratHonoraires && 'opacity-70 cursor-default')}
                                value={project.construction_cost || 0}
                                onChange={e => setProject({...project, construction_cost: Number(e.target.value)})}
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="fiche-remuneration" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('projectdetail_fees_initial_input')}</label>
                            <div className="relative">
                              <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">€</span>
                              <input
                                id="fiche-remuneration"
                                type="number"
                                readOnly={!!contratHonoraires}
                                title={contratHonoraires ? t('projectdetail_fees_locked') : undefined}
                                className={cn('w-full pl-8 pr-4 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold', contratHonoraires && 'opacity-70 cursor-default')}
                                value={project.remuneration || 0}
                                onChange={e => setProject({...project, remuneration: Number(e.target.value)})}
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="fiche-progression" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('projectdetail_full_progress')}</label>
                            <input
                              id="fiche-progression"
                              type="number"
                              min="0"
                              max="100"
                              className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                              value={project.progression || 0}
                              onChange={e => setProject({...project, progression: Number(e.target.value)})}
                            />
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="fiche-code" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('projectdetail_full_code')}</label>
                            <input
                              id="fiche-code"
                              type="text"
                              className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                              value={project.project_code || ''}
                              onChange={e => setProject({...project, project_code: e.target.value})}
                              placeholder="PRJ-001"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Location & Maps - Editable */}
                    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <div className="p-6 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--tblr-surface-2)' }}>
                            <IconExternalLink size={20} style={{ color: 'var(--tblr-primary)' }} />
                          </div>
                          <h3 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>{t('projectdetail_full_location')}</h3>
                        </div>
                        <div className="mt-4">
                          <AddressAutocomplete 
                            value={project.address || ''}
                            onChange={addr => setProject(prev => prev ? ({...prev, address: addr}) : null)}
                          />
                        </div>
                      </div>
                      {project.address && (
                        <div className="space-y-6 p-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <InfoPanelBoundary label="RNB"><RNBInfo address={project.address} /></InfoPanelBoundary>
                            <InfoPanelBoundary label={t('projectdetail_full_cadastre')}><CadastreDownload address={project.address} /></InfoPanelBoundary>
                            <InfoPanelBoundary label={t('projectdetail_full_monuments')}><HistoricalMonuments address={project.address} /></InfoPanelBoundary>
                          </div>
                          <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-hidden border border-[var(--tblr-border)]">
                            <div className="bg-white dark:bg-zinc-900 relative h-[500px]">
                              <InfoPanelBoundary label={t('projectdetail_full_cadastre')}>
                                <GeoportailMap
                                  address={project.address}
                                  onSelectionChange={(parcels: CadastreParcel[]) => {
                                    if (parcels.length === 0) return;
                                    const { reference, surface } = summarizeParcels(parcels);
                                    setProject(prev => prev ? ({
                                      ...prev,
                                      ref_cadastrale: reference || prev.ref_cadastrale,
                                      surface_parcelle: surface != null ? String(surface) : prev.surface_parcelle,
                                    }) : null);
                                  }}
                                />
                              </InfoPanelBoundary>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Milestones section moved into INFOS tab */}
                      <div className="p-6 rounded-lg space-y-6" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-text)' }}>{t('projects_milestones_title')}</h3>
                          <button
                            type="button"
                            onClick={() => setIsAddingMilestone(!isAddingMilestone)}
                            aria-expanded={isAddingMilestone}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition"
                          >
                            <IconPlus size={14} />
                            {t('project_overview_add_task')}
                          </button>
                        </div>

                        {isAddingMilestone && (
                          <div className="p-6 bg-[var(--tblr-surface-2)] rounded-lg border border-[var(--tblr-border)] space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <label htmlFor="jalon-titre" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('project_overview_milestone_title')}</label>
                                <input
                                  id="jalon-titre"
                                  type="text"
                                  className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                  value={newMilestoneTitle}
                                  onChange={e => setNewMilestoneTitle(e.target.value)}
                                  placeholder={t('projectdetail_milestone_placeholder')}
                                />
                              </div>
                              <div className="space-y-1">
                                <label htmlFor="jalon-date" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('project_overview_milestone_date')}</label>
                                <input
                                  id="jalon-date"
                                  type="date"
                                  className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                  value={newMilestoneDate}
                                  onChange={e => setNewMilestoneDate(e.target.value)}
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-3">
                              <button
                                type="button"
                                onClick={() => setIsAddingMilestone(false)}
                                className="px-4 py-2 text-sm font-bold text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors"
                              >
                                {t('projectdetail_dialog_cancel')}
                              </button>
                              <button
                                type="button"
                                onClick={handleAddMilestone}
                                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition"
                              >
                                {t('project_overview_milestone_add')}
                              </button>
                            </div>
                          </div>
                        )}

                        {project && milestones.length > 0 && (
                          <div className="mb-6">
                            <MilestoneGantt
                              milestones={milestones}
                              startDate={new Date(project.start_date)}
                              endDate={new Date(project.end_date)}
                              onUpdate={(updated) => {
                                setMilestones(updated);
                                const changed = updated.find(m => {
                                  const orig = milestones.find(o => o.id === m.id);
                                  return orig && (orig.duration_days !== m.duration_days || JSON.stringify(orig.dependencies) !== JSON.stringify(m.dependencies));
                                });
                                if (changed) {
                                  fetch(`/api/milestones/${changed.id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(changed),
                                  }).catch(console.error);
                                }
                              }}
                            />
                          </div>
                        )}

                        <div className="space-y-3">
                          {milestones.length > 0 ? milestones.map((m) => (
                            <div key={m.id} className="flex items-center justify-between group">
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked={!!m.completed}
                                  aria-label={m.title}
                                  onClick={() => handleToggleMilestone(m)}
                                  className={cn(
                                    "transition-colors",
                                    m.completed ? "text-green-500" : "text-[var(--tblr-muted)] hover:text-[var(--tblr-muted)]"
                                  )}
                                >
                                  {m.completed ? <IconCircleCheck size={20} /> : <IconCircle size={20} />}
                                </button>
                                <div>
                                  <p className={cn("text-sm font-medium", m.completed ? "text-[var(--tblr-muted)] line-through" : "text-[var(--tblr-text)]")}>
                                    {m.title}
                                  </p>
                                  <div className="flex items-center gap-1 text-[0.6875rem] text-[var(--tblr-muted)]">
                                    <IconCalendar size={10} />
                                    {new Date(m.due_date).toLocaleDateString('fr-FR')}
                                  </div>
                                </div>
                              </div>
                              <button type="button" title={t('projectdetail_milestone_delete')} aria-label={t('projectdetail_milestone_delete_named', { title: m.title })}
                                onClick={async () => {
                                  if (!(await confirmDelete('projectdetail_confirm_delete_milestone'))) return;
                                  const res = await fetch(`/api/milestones/${m.id}`, { method: 'DELETE' });
                                  if (res.ok) setMilestones(prev => prev.filter(x => x.id !== m.id));
                                  else showToast(t('projectdetail_delete_failed'), 'error', { duration: 6000 });
                                }}
                                className="p-1 text-[var(--tblr-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition"
                              >
                                <IconTrash size={14} />
                              </button>
                            </div>
                          )) : (
                            <p className="text-xs text-[var(--tblr-muted)] italic text-center py-4">{t('project_overview_no_tasks')}</p>
                          )}
                        </div>
                      </div>

                      {/* Additional Details from Proposal */}
                      <div className="p-6 rounded-lg space-y-8" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                        <div className="space-y-4">
                          <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2 uppercase tracking-wider">
                            <span aria-hidden className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[0.6875rem]">01</span>
                            {t('projectdetail_ff_section_client')}
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField label={t('projectdetail_ff_is_company')} type="checkbox" value={project.is_entreprise} onChange={(v: any) => setProject(prev => prev ? ({...prev, is_entreprise: v}) : null)} />
                            <CompanyAutocomplete 
                              label={t('projectdetail_ff_company_name')}
                              value={project.nom_societe || ''} 
                              onChange={(val, details) => {
                                if (details) {
                                  setProject(prev => prev ? ({
                                    ...prev,
                                    nom_societe: val,
                                    rcs: details.siren || details.siret || '',
                                    adresse_client: details.address || '',
                                    cp_client: details.zipcode || '',
                                    ville_client: details.city || '',
                                    is_entreprise: true
                                  }) : null);
                                } else {
                                  setProject(prev => prev ? ({...prev, nom_societe: val}) : null);
                                }
                              }} 
                            />
                            <FormField label={t('projectdetail_ff_rcs')} value={project.rcs} onChange={(v: any) => setProject(prev => prev ? ({...prev, rcs: v}) : null)} />
                            <FormField label={t('projectdetail_ff_representative')} value={project.representant} onChange={(v: any) => setProject(prev => prev ? ({...prev, representant: v}) : null)} />
                            <FormField label={t('projectdetail_ff_capacity')} value={project.qualite} onChange={(v: any) => setProject(prev => prev ? ({...prev, qualite: v}) : null)} />
                          </div>
                          {/* Facturation électronique (Factur-X, Chorus Pro, Super PDP) */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                            <FormField label={t('projectdetail_ff_client_siret')} value={project.client_siret} onChange={(v: any) => setProject(prev => prev ? ({...prev, client_siret: v}) : null)} />
                            <FormField label={t('projectdetail_ff_client_vat')} value={project.client_vat_number} onChange={(v: any) => setProject(prev => prev ? ({...prev, client_vat_number: v}) : null)} />
                            <FormField label={t('projectdetail_ff_public_client')} type="checkbox" value={project.is_public_client} onChange={(v: any) => setProject(prev => prev ? ({...prev, is_public_client: v}) : null)} />
                          </div>
                          <p className="text-[0.6875rem] text-[var(--tblr-muted)] -mt-4">
                            {t('projectdetail_ff_public_client_help')}
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
                              <FormField 
                                label={t('projectdetail_ff_client_address')} 
                                value={project.adresse_client || ''} 
                                onChange={(v: any) => setProject(prev => prev ? ({...prev, adresse_client: v}) : null)} 
                              />
                              <FormField 
                                label={t('projectdetail_ff_client_postcode')} 
                                value={project.cp_client || ''} 
                                onChange={(v: any) => setProject(prev => prev ? ({...prev, cp_client: v}) : null)} 
                              />
                              <FormField 
                                label={t('projectdetail_ff_client_city')} 
                                value={project.ville_client || ''} 
                                onChange={(v: any) => setProject(prev => prev ? ({...prev, ville_client: v}) : null)} 
                              />
                            </div>
                            <FormField label={t('projectdetail_ff_phone')} value={project.telephone} onChange={(v: any) => setProject(prev => prev ? ({...prev, telephone: v}) : null)} />
                            <FormField label={t('projectdetail_ff_mobile')} value={project.portable} onChange={(v: any) => setProject(prev => prev ? ({...prev, portable: v}) : null)} />
                            <FormField label={t('projectdetail_ff_email')} type="email" value={project.email_client} onChange={(v: any) => setProject(prev => prev ? ({...prev, email_client: v}) : null)} />
                          </div>
                        </div>

                        <div className="space-y-4 pt-8 border-t border-[var(--tblr-border)]">
                          <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2 uppercase tracking-wider">
                            <span aria-hidden className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[0.6875rem]">02</span>
                            {t('projectdetail_ff_section_site')}
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField label={t('projectdetail_ff_reference')} value={project.reference} onChange={(v: any) => setProject(prev => prev ? ({...prev, reference: v}) : null)} />
                            <FormField label={t('projectdetail_ff_index')} value={project.ind} onChange={(v: any) => setProject(prev => prev ? ({...prev, ind: v}) : null)} />
                            <FormField label={t('projectdetail_ff_detail')} type="textarea" value={project.projet_detail} onChange={(v: any) => setProject(prev => prev ? ({...prev, projet_detail: v}) : null)} />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="md:col-span-3 space-y-4">
                              <AddressAutocomplete 
                                label={t('projectdetail_ff_site_address')}
                                value={project.adresse_terrain || ''} 
                                onChange={(val: string) => {
                                  setProject(prev => {
                                    if (!prev) return null;
                                    const updates: any = { adresse_terrain: val };
                                    if (!val) {
                                      updates.cp_ville_terrain = '';
                                      updates.site_postcode = '';
                                      updates.site_city = '';
                                      updates.ban_id_terrain = '';
                                      updates.city_code_terrain = '';
                                    }
                                    return { ...prev, ...updates };
                                  });
                                }}
                                onSelect={(details) => {
                                  setProject(prev => prev ? ({
                                    ...prev, 
                                    adresse_terrain: details.fullAddress,
                                    cp_ville_terrain: `${details.zipcode || ''} ${details.city || ''}`.trim(),
                                    site_postcode: details.zipcode || '',
                                    site_city: details.city || '',
                                    ban_id_terrain: details.banId || '',
                                    city_code_terrain: details.cityCode || ''
                                  }) : null);
                                }} 
                              />
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField label={t('projectdetail_ff_site_postcode')} value={project.site_postcode} onChange={(v: any) => setProject(prev => prev ? ({...prev, site_postcode: v}) : null)} />
                                <FormField label={t('projectdetail_ff_site_city')} value={project.site_city} onChange={(v: any) => setProject(prev => prev ? ({...prev, site_city: v}) : null)} />
                              </div>
                            </div>
                            <FormField label={t('projectdetail_ff_cadastre')} value={project.ref_cadastrale} onChange={(v: any) => setProject(prev => prev ? ({...prev, ref_cadastrale: v}) : null)} />
                            <FormField label={t('projectdetail_ff_plu')} value={project.zone_plu} onChange={(v: any) => setProject(prev => prev ? ({...prev, zone_plu: v}) : null)} />
                            <FormField label={t('projectdetail_ff_plot_area')} value={project.surface_parcelle} onChange={(v: any) => setProject(prev => prev ? ({...prev, surface_parcelle: v}) : null)} />
                            <FormField label={t('projectdetail_ff_establishment')} value={project.nom_etablissement} onChange={(v: any) => setProject(prev => prev ? ({...prev, nom_etablissement: v}) : null)} />
                            <FormField label={t('projectdetail_ff_before_works')} value={project.avant_trav} onChange={(v: any) => setProject(prev => prev ? ({...prev, avant_trav: v}) : null)} />
                            <FormField label={t('projectdetail_ff_after_works')} value={project.apres_trav} onChange={(v: any) => setProject(prev => prev ? ({...prev, apres_trav: v}) : null)} />
                            <FormField label={t('projectdetail_ff_erp_type')} value={project.type_et_cat} onChange={(v: any) => setProject(prev => prev ? ({...prev, type_et_cat: v}) : null)} />
                            <FormField label={t('projectdetail_ff_type')} value={project.type_projet} onChange={(v: any) => setProject(prev => prev ? ({...prev, type_projet: v}) : null)} />
                            <FormField label={t('projectdetail_ff_category')} value={project.categorie_projet} onChange={(v: any) => setProject(prev => prev ? ({...prev, categorie_projet: v}) : null)} />
                            <div className="space-y-1">
                              <label htmlFor="fiche-maf" className="block text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('projectdetail_ff_maf_mission')}</label>
                              <select
                                id="fiche-maf"
                                className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-medium"
                                value={project.maf_intercalaire ?? ''}
                                onChange={(e) => setProject(prev => prev ? ({
                                  ...prev,
                                  maf_intercalaire: (e.target.value || undefined) as any,
                                  taux_mission: e.target.value === 'jaune' ? prev.taux_mission : undefined,
                                }) : null)}
                              >
                                <option value="">{t('projectdetail_field_select')}</option>
                                {MAF_INTERCALAIRE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                              </select>
                            </div>
                            {project.maf_intercalaire === 'jaune' && (
                              <div className="space-y-1">
                                <label htmlFor="fiche-taux-mission" className="block text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('projectdetail_ff_maf_rate')}</label>
                                <select
                                  id="fiche-taux-mission"
                                  className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-medium"
                                  value={project.taux_mission ?? ''}
                                  onChange={(e) => setProject(prev => prev ? ({...prev, taux_mission: e.target.value ? Number(e.target.value) : undefined}) : null)}
                                >
                                  <option value="">{t('projectdetail_field_select')}</option>
                                  {TAUX_MISSION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              </div>
                            )}
                            <FormField label={t('projectdetail_ff_share')} type="number" value={project.part_interet} onChange={(v: any) => setProject(prev => prev ? ({...prev, part_interet: v ? Number(v) : undefined}) : null)} />
                          </div>
                          {mafCost && (
                            <div className="mt-4">
                              <MafCostBadge result={mafCost} showDetails />
                            </div>
                          )}
                        </div>

                        <div className="space-y-4 pt-8 border-t border-[var(--tblr-border)]">
                          <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2 uppercase tracking-wider">
                            <span aria-hidden className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[0.6875rem]">03</span>
                            {t('projectdetail_ff_section_areas')}
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField label={t('projectdetail_ff_floor_area')} value={project.surface_plancher} onChange={(v: any) => setProject(prev => prev ? ({...prev, surface_plancher: v}) : null)} />
                            <FormField label={t('projectdetail_ff_floor_area_ext')} value={project.surface_plancher_ext} onChange={(v: any) => setProject(prev => prev ? ({...prev, surface_plancher_ext: v}) : null)} />
                            <FormField label={t('projectdetail_ff_erp_area')} value={project.surface_erp} onChange={(v: any) => setProject(prev => prev ? ({...prev, surface_erp: v}) : null)} />
                            <FormField label={t('projectdetail_ff_ert_area')} value={project.surface_ert} onChange={(v: any) => setProject(prev => prev ? ({...prev, surface_ert: v}) : null)} />
                            <FormField label={t('projectdetail_ff_public_capacity')} value={project.effectif_public} onChange={(v: any) => setProject(prev => prev ? ({...prev, effectif_public: v}) : null)} />
                            <FormField label={t('projectdetail_ff_staff_capacity')} value={project.effectif_personnel} onChange={(v: any) => setProject(prev => prev ? ({...prev, effectif_personnel: v}) : null)} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Status & Budget (Moved into INFOS Tab) */}
                  <div className="space-y-8">
                    <div className="p-6 rounded-lg space-y-6" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <div className="space-y-2">
                        <label htmlFor="fiche-statut" className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('status')}</label>
                        <select
                          id="fiche-statut"
                          className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                          value={project.status}
                          onChange={e => setProject({...project, status: e.target.value as any})}
                        >
                          <option value="Planning">{t('projects_status_planning')}</option>
                          <option value="In Progress">{t('projects_status_in_progress')}</option>
                          <option value="Completed">{t('projects_status_completed')}</option>
                          <option value="On Hold">{t('projects_status_on_hold')}</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="fiche-budget" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('budget')}</label>
                        <div className="relative">
                          <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)] font-bold">€</span>
                          <input
                            id="fiche-budget"
                            type="number"
                            className="w-full pl-8 pr-4 py-3 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-bold"
                            value={project.budget || 0}
                            onChange={e => setProject({...project, budget: Number(e.target.value)})}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label htmlFor="fiche-debut" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('projectdetail_ff_start')}</label>
                          <input
                            id="fiche-debut"
                            type="date"
                            className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)]"
                            value={project.start_date}
                            onChange={e => setProject({...project, start_date: e.target.value})}
                          />
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="fiche-echeance" className="text-xs font-bold text-[var(--tblr-muted)] uppercase tracking-wider">{t('deadline')}</label>
                          <input
                            id="fiche-echeance"
                            type="date"
                            className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)]"
                            value={project.end_date}
                            onChange={e => setProject({...project, end_date: e.target.value})}
                          />
                        </div>
                      </div>
                      <div className="space-y-4 pt-4 border-t border-[var(--tblr-border)]">
                        <div className="flex items-center gap-2">
                          <input 
                            type="checkbox"
                            id="is_complete_mission"
                            className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
                            checked={!!project.is_complete_mission}
                            onChange={e => setProject({...project, is_complete_mission: e.target.checked})}
                          />
                          <label htmlFor="is_complete_mission" className="text-sm font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                            {t('project_overview_mission_complete')}
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <input 
                            type="checkbox"
                            id="is_chantier"
                            className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
                            checked={!!project.is_chantier}
                            onChange={e => setProject({...project, is_chantier: e.target.checked})}
                          />
                          <label htmlFor="is_chantier" className="text-sm font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                            {t('projectdetail_ff_chantier')}
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="offline_enabled"
                            className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
                            checked={!!project.offline_enabled}
                            onChange={e => {
                              const checked = e.target.checked;
                              setProject({ ...project, offline_enabled: checked });
                              // Précharge tout de suite plutôt que d'attendre le
                              // prochain passage par /projects (src/lib/offlinePrefetch.ts)
                              // — sans réseau, ce préchargement ne fait simplement rien.
                              if (checked) prefetchProjectForOffline(project.id).catch(() => {});
                            }}
                          />
                          <label htmlFor="offline_enabled" className="text-sm font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                            {t('projectdetail_ff_offline')}
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="p-6 rounded-lg space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('project_phase_current')}</label>
                      <PhaseStepper
                        steps={missionPhases.map(phase => ({ id: phase, label: phase, description: t(`mission_phase_${phase}`) }))}
                        currentId={actualCurrentPhase}
                        badges={phaseBadges}
                        onSelect={phase => handleSetPhase(phase as DocumentPhase)}
                      />
                      {phaseHistory.length > 0 && (
                        <div className="pt-3 border-t border-[var(--tblr-border)] space-y-1.5">
                          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('project_phase_history')}</p>
                          {[...phaseHistory].reverse().map(entry => (
                            <div key={entry.id} className="flex items-center justify-between text-xs" style={{ color: 'var(--tblr-text)' }}>
                              <span className="font-semibold">{entry.phase}</span>
                              <span style={{ color: 'var(--tblr-muted)' }}>
                                {new Date(entry.entered_at).toLocaleDateString('fr-FR')} → {entry.exited_at ? new Date(entry.exited_at).toLocaleDateString('fr-FR') : t('project_phase_ongoing')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Project Members Section */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconUsersGroup}
                    title={
                      <span className="flex items-center gap-2">
                        {t('projectdetail_team_title')}
                        <span className="text-xs font-medium bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] px-2 py-0.5 rounded-full">{projectMembers.length}</span>
                      </span>
                    }
                    action={
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={t('projectdetail_team_add')}
                        className="px-3 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        defaultValue=""
                        onChange={async e => {
                          const userId = e.target.value;
                          if (!userId) return;
                          e.target.value = '';
                          try {
                            const res = await fetch(`/api/projects/${id}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, role: 'member' }) });
                            if (res.ok) fetchProjectMembers();
                          } catch (err) { console.error(err); }
                        }}
                      >
                        <option value="">{t('projectdetail_team_add_option')}</option>
                        {team.filter(m => !projectMembers.find(pm => pm.user_id === m.id || pm.id === m.id)).map(m => (
                          <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                        ))}
                      </select>
                    </div>
                    }
                  />
                  <div className="p-4">
                    {projectMembers.length === 0 ? (
                      <p className="text-sm text-[var(--tblr-muted)] italic text-center py-4">{t('projectdetail_team_empty')}</p>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        {projectMembers.map(m => (
                          <div key={m.id || m.user_id} className="flex items-center gap-2 px-3 py-2 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg group">
                            <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-xs font-bold text-violet-700 dark:text-violet-400 flex-shrink-0">
                              {(m.name || m.email || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">{m.name || m.email}</p>
                              <p className="text-[0.6875rem] text-[var(--tblr-muted)]">{m.role || t('project_overview_team_member')}</p>
                            </div>
                            <button
                              type="button"
                              aria-label={t('projectdetail_team_remove_named', { name: m.name || m.email })}
                              onClick={async () => {
                                try {
                                  const userId = m.user_id || m.id;
                                  const res = await fetch(`/api/projects/${id}/members/${userId}`, { method: 'DELETE' });
                                  if (res.ok) setProjectMembers(prev => prev.filter(pm => (pm.user_id || pm.id) !== userId));
                                } catch (err) { console.error(err); }
                              }}
                              className="ml-1 p-1 text-[var(--tblr-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition rounded"
                              title={t('projectdetail_team_remove')}
                            ><IconX size={14} aria-hidden /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Permits Section */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconRubberStamp}
                    title={
                      <span className="flex items-center gap-2">
                        {t('projectdetail_permits_title')}
                        <span className="text-xs font-medium bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] px-2 py-0.5 rounded-full">{permits.length}</span>
                      </span>
                    }
                    action={
                      <button
                        type="button"
                        onClick={() => setIsAddingPermit(!isAddingPermit)}
                        aria-expanded={isAddingPermit}
                        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition"
                      >
                        {isAddingPermit ? <IconX size={14} /> : <IconPlus size={14} />}
                        {isAddingPermit ? t('projectdetail_dialog_cancel') : t('projectdetail_permits_add')}
                      </button>
                    }
                  />
                  {isAddingPermit && (
                    <div className="p-4 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <select aria-label={t('projectdetail_permit_type')} className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={newPermit.type} onChange={e => setNewPermit(prev => ({ ...prev, type: e.target.value as any }))}>
                          <option value="PC">{t('projectdetail_permit_type_PC')}</option>
                          <option value="DP">{t('projectdetail_permit_type_DP')}</option>
                          <option value="AT">{t('projectdetail_permit_type_AT')}</option>
                        </select>
                        <input type="text" aria-label={t('projectdetail_permit_reference')} placeholder={t('projectdetail_permit_reference')} className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={newPermit.reference} onChange={e => setNewPermit(prev => ({ ...prev, reference: e.target.value }))} />
                        <input type="date" aria-label={t('projectdetail_permit_submitted_on')} title={t('projectdetail_permit_submitted_on')} className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={newPermit.submission_date} onChange={e => setNewPermit(prev => ({ ...prev, submission_date: e.target.value }))} />
                        <select aria-label={t('projectdetail_col_status')} className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={newPermit.status} onChange={e => setNewPermit(prev => ({ ...prev, status: e.target.value as any }))}>
                          {(['en_instruction', 'accorde', 'refuse', 'recours'] as const).map(s => <option key={s} value={s}>{t(`project_permit_status_${s}`)}</option>)}
                        </select>
                      </div>
                      <div className="flex justify-end">
                        <button
                          onClick={async () => {
                            if (!id) return;
                            try {
                              const res = await fetch('/api/permits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newPermit, project_id: id }) });
                              if (res.ok) {
                                const data = await res.json();
                                setPermits(prev => [...prev, data]);
                                setIsAddingPermit(false);
                                setNewPermit({ type: 'PC', reference: '', submission_date: '', decision_date: '', status: 'en_instruction', notes: '' });
                              }
                            } catch (err) { console.error(err); }
                          }}
                          type="button"
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition"
                        >
                          {t('projectdetail_permits_save')}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="p-4">
                    {permits.length === 0 ? (
                      <p className="text-sm text-[var(--tblr-muted)] italic text-center py-4">{t('projectdetail_permits_empty')}</p>
                    ) : (
                      <div className="space-y-2">
                        {permits.map(p => (
                          <div key={p.id} className="bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg overflow-hidden">
                            <div className="flex items-center justify-between gap-2 px-3 py-2 group">
                              <button
                                type="button"
                                onClick={() => setExpandedPermitId(expandedPermitId === p.id ? null : p.id)}
                                aria-expanded={expandedPermitId === p.id}
                                title={t('projectdetail_permit_toggle_files')}
                                className="flex items-center gap-3 min-w-0 text-left"
                              >
                                {expandedPermitId === p.id ? <IconChevronDown size={14} className="text-[var(--tblr-muted)] shrink-0" /> : <IconChevronRight size={14} className="text-[var(--tblr-muted)] shrink-0" />}
                                <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 shrink-0">{p.type}</span>
                                <span className="text-xs text-zinc-600 dark:text-zinc-300 truncate">{p.reference || t('projectdetail_permit_no_reference')}</span>
                                {p.submission_date && <span className="text-[0.6875rem] text-[var(--tblr-muted)] shrink-0">{t('projectdetail_permit_submitted_date', { date: new Date(p.submission_date).toLocaleDateString('fr-FR') })}</span>}
                              </button>
                              <div className="flex items-center gap-2 shrink-0">
                                <select
                                  aria-label={t('projectdetail_permit_status_named', { ref: p.reference || p.type })}
                                  className="text-[0.6875rem] font-bold uppercase px-2 py-1 rounded-full border-0 outline-none cursor-pointer bg-zinc-100 dark:bg-zinc-800 text-[var(--tblr-text)] focus-visible:ring-2 focus-visible:ring-blue-500"
                                  value={p.status}
                                  onChange={async (e) => {
                                    const status = e.target.value;
                                    const res = await fetch(`/api/permits/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, status }) });
                                    if (res.ok) setPermits(prev => prev.map(x => x.id === p.id ? { ...x, status: status as any } : x));
                                  }}
                                >
                                  {(['en_instruction', 'accorde', 'refuse', 'recours'] as const).map(s => <option key={s} value={s}>{t(`project_permit_status_${s}`)}</option>)}
                                </select>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    deleteWithUndo(setPermits, p.id, `/api/permits/${p.id}`, 'projectdetail_deleted_permit');
                                  }}
                                  className="p-1 text-[var(--tblr-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition rounded"
                                  title={t('projectdetail_permit_delete')}
                                  aria-label={t('projectdetail_permit_delete')}
                                >
                                  <IconTrash size={14} />
                                </button>
                              </div>
                            </div>
                            {expandedPermitId === p.id && (
                              <div className="px-3 pb-3 pt-1 border-t border-[var(--tblr-border)]">
                                <ResourceAttachments resourceType="permits" resourceId={p.id} category="CERFA" />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}


            {/* Tab content for PRO, VISA, AOR ... */}
            {activeTab === 'DET' && (
              <ChantierModule
                project={project}
                lots_list={project.lots_list || []}
                ordresDeService={ordresDeService}
                contacts={contacts}
                settings={settings}
                osSituationsContent={
              <div className="space-y-8">
                {/* Ordres de Service Travaux */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconTools}
                    title={t('projectdetail_os_title')}
                    description={(() => {
                      const travauxApprouves = ordresDeService
                        .filter(o => (o.type === 'travaux' || !o.type) && o.status === 'approved')
                        .reduce((acc, o) => acc + (Number(o.montant_devis_accepte) || Number(o.montant_devis_presente) || 0), 0);
                      if (travauxApprouves !== 0) return (
                        <span className="text-green-600 dark:text-green-400 font-semibold">
                          {t('projectdetail_os_approved_total', { amount: formatCurrency(travauxApprouves) })}
                        </span>
                      );
                      return undefined;
                    })()}
                    action={
                      <button
                        type="button"
                        onClick={() => setIsAddingOs(!isAddingOs)}
                        aria-expanded={isAddingOs}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition"
                      >
                        <IconPlus size={14} />
                        {t('projectdetail_os_new')}
                      </button>
                    }
                  />
                  {isAddingOs && (
                    <div className="p-6 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="os-numero" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_os_number')}</label>
                          <input id="os-numero" type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.os_number} onChange={e => setNewOs({...newOs, os_number: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="os-date" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_os_issue_date')}</label>
                          <input id="os-date" type="date"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.date_emission} onChange={e => setNewOs({...newOs, date_emission: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="os-marche" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_os_contract')} <span aria-hidden className="text-red-500">*</span></label>
                          <select
                            id="os-marche"
                            required
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.marche_id} onChange={e => handleMarcheChange(e.target.value)}>
                            <option value="">{t('projectdetail_os_contract_choose')}</option>
                            {marchesTravaux.map((m: any) => (
                              <option key={m.id} value={m.id}>{[m.lot_numero, m.lot_titre].filter(Boolean).join(' — ')} · {m.entreprise_nom}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {marchesTravaux.length === 0 && !isAddingMarche && (
                        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 text-xs text-amber-700 dark:text-amber-400">
                          <span>{t('projectdetail_os_no_contract')}</span>
                          <button type="button" onClick={() => setIsAddingMarche(true)} className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[0.6875rem] whitespace-nowrap transition">{t('projectdetail_os_create_contract')}</button>
                        </div>
                      )}
                      {isAddingMarche && (
                        <div className="p-4 rounded-lg bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] space-y-3">
                          <p className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_contract_new_title')}</p>
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <input type="text" required aria-label={t('projectdetail_contract_company')} placeholder={t('projectdetail_contract_company_required')}
                              className="md:col-span-2 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newMarche.entreprise_nom} onChange={e => setNewMarche({ ...newMarche, entreprise_nom: e.target.value })} />
                            <input type="text" aria-label={t('projectdetail_contract_lot_number')} placeholder={t('projectdetail_contract_lot_number')}
                              className="bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newMarche.lot_numero} onChange={e => setNewMarche({ ...newMarche, lot_numero: e.target.value })} />
                            <input type="number" aria-label={t('projectdetail_contract_amount_ht')} placeholder={t('projectdetail_contract_amount_ht')}
                              className="bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newMarche.montant_ht} onChange={e => setNewMarche({ ...newMarche, montant_ht: e.target.value })} />
                          </div>
                          <input type="text" aria-label={t('projectdetail_contract_lot_title')} placeholder={t('projectdetail_contract_lot_title_placeholder')}
                            className="w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newMarche.lot_titre} onChange={e => setNewMarche({ ...newMarche, lot_titre: e.target.value })} />
                          <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setIsAddingMarche(false)} className="px-3 py-1.5 text-xs font-bold text-[var(--tblr-muted)]">{t('projectdetail_dialog_cancel')}</button>
                            <button type="button" onClick={handleCreateMarche} disabled={!newMarche.entreprise_nom} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs transition">{t('projectdetail_contract_create')}</button>
                          </div>
                        </div>
                      )}
                      <div className="space-y-1">
                        <label htmlFor="os-titre" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_os_title_field')} <span aria-hidden className="text-red-500">*</span></label>
                        <input id="os-titre" required type="text"
                          className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          value={newOs.title} onChange={e => setNewOs({...newOs, title: e.target.value})}
                          placeholder={t('projectdetail_os_title_placeholder')} />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="os-objet" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_note_subject')}</label>
                        <input id="os-objet" type="text"
                          className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          value={newOs.objet} onChange={e => setNewOs({...newOs, objet: e.target.value})}
                          placeholder={t('projectdetail_os_subject_placeholder')} />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="os-emetteur" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_os_issuer')}</label>
                          <input id="os-emetteur" type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.emetteur_os} onChange={e => setNewOs({...newOs, emetteur_os: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="os-destinataire" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_os_recipient')}</label>
                          <input id="os-destinataire" type="text"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.destinataire_os || newOs.entreprise}
                            onChange={e => setNewOs(prev => ({...prev, destinataire_os: e.target.value, entreprise: e.target.value}))} />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="os-montant" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_os_amount')}</label>
                          <input id="os-montant" type="number"
                            className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={newOs.montant_devis_presente} onChange={e => setNewOs({...newOs, montant_devis_presente: e.target.value})} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="os-delai" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_os_duration')}</label>
                          <div className="flex gap-2">
                            <input id="os-delai" type="number" placeholder="30"
                              className="w-20 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newOs.delai_execution} onChange={e => setNewOs({...newOs, delai_execution: e.target.value})} />
                            <select
                              aria-label={t('projectdetail_os_duration_unit')}
                              className="flex-1 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={newOs.delai_unit} onChange={e => setNewOs({...newOs, delai_unit: e.target.value})}>
                              <option value="jours">{t('projectdetail_unit_jours')}</option>
                              <option value="semaines">{t('projectdetail_unit_semaines')}</option>
                              <option value="mois">{t('projectdetail_unit_mois')}</option>
                            </select>
                          </div>
                        </div>
                        <div className="md:col-span-2 flex items-end">
                          <button type="button" onClick={handleCreateOs} disabled={!newOs.marche_id || !newOs.title}
                            title={!newOs.marche_id || !newOs.title ? t('projectdetail_os_create_disabled') : undefined}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold transition">
                            {t('projectdetail_os_create')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[0.6875rem] tracking-wider">
                        <tr>
                          <th className="px-4 py-3 text-left">{t('projectdetail_col_number')}</th>
                          <th className="px-4 py-3 text-left">{t('projectdetail_col_title')}</th>
                          <th className="px-4 py-3 text-left">{t('projectdetail_col_lot_company')}</th>
                          <th className="px-4 py-3 text-left">{t('projectdetail_os_issue_date')}</th>
                          <th className="px-4 py-3 text-left">{t('projectdetail_col_duration')}</th>
                          <th className="px-4 py-3 text-right">{t('projectdetail_col_presented_ht')}</th>
                          <th className="px-4 py-3 text-right">{t('projectdetail_col_accepted_ht')}</th>
                          <th className="px-4 py-3 text-center">{t('projectdetail_col_status')}</th>
                          <th className="px-4 py-3 text-center">{t('projectdetail_col_actions')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--tblr-border)]">
                        {ordresDeService.filter(o => o.type === 'travaux' || !o.type).map((os) => (
                          <tr key={os.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors">
                            <td className="px-4 py-3 font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap font-mono text-xs">
                              {t('projectdetail_os_label', { number: os.os_number })}
                            </td>
                            <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200 max-w-[160px] truncate">{os.title}</td>
                            <td className="px-4 py-3 text-[var(--tblr-muted)] text-xs">
                              {os.lot && <span className="font-semibold">{os.lot}</span>}
                              {os.lot && (os.destinataire_os || os.entreprise) && ' · '}
                              {os.destinataire_os || os.entreprise}
                            </td>
                            <td className="px-4 py-3 text-xs text-[var(--tblr-muted)]">{(os.date_emission ?? os.date?.slice(0, 10)) ? new Date(os.date_emission ?? os.date!.slice(0, 10)).toLocaleDateString('fr-FR') : '—'}</td>
                            <td className="px-4 py-3 text-xs text-[var(--tblr-muted)]">
                              {os.delai_execution ? `${os.delai_execution} ${t(`projectdetail_unit_${os.delai_unit && ['jours', 'semaines', 'mois'].includes(os.delai_unit) ? os.delai_unit : 'jours'}`).toLowerCase()}` : '—'}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-300">
                              {os.montant_devis_presente ? formatCurrency(Number(os.montant_devis_presente)) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-[var(--tblr-text)]">
                              {os.status === 'approved'
                                ? formatCurrency(Number(os.montant_devis_accepte ?? os.montant_devis_presente ?? 0))
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-center">{osStatusBadge(os.status)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                {os.status === 'draft' && (
                                  <button type="button" onClick={() => handleUpdateOsStatus(os.id, 'submitted')}
                                    title={t('projectdetail_os_action_issue_title')}
                                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 text-[0.6875rem] font-bold transition">
                                    <IconSend size={11} /> {t('projectdetail_os_action_issue')}
                                  </button>
                                )}
                                {os.status === 'submitted' && (
                                  <button type="button" onClick={() => handleUpdateOsStatus(os.id, 'approved')}
                                    title={t('projectdetail_os_action_ack_title')}
                                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 text-[0.6875rem] font-bold transition">
                                    <IconCheck size={11} /> {t('projectdetail_os_action_ack')}
                                  </button>
                                )}
                                {(os.status === 'draft' || os.status === 'submitted') && (
                                  <button type="button" onClick={() => handleUpdateOsStatus(os.id, 'rejected')}
                                    title={t('projectdetail_os_action_cancel')}
                                    aria-label={t('projectdetail_os_action_cancel_named', { number: os.os_number })}
                                    className="p-1 text-red-400 hover:text-red-600 transition-colors">
                                    <IconX size={13} />
                                  </button>
                                )}
                                <button type="button" onClick={() => generateOsPdf(os)} title={t('projectdetail_os_export_pdf')} aria-label={t('projectdetail_os_export_pdf')}
                                  className="p-1 text-[var(--tblr-muted)] hover:text-blue-500 transition-colors">
                                  <IconFileDownload size={13} />
                                </button>
                                <button type="button" title={t('projectdetail_os_delete')} aria-label={t('projectdetail_os_delete')} onClick={() => handleDeleteOs(os.id)}
                                  className="p-1 text-[var(--tblr-muted)] hover:text-red-500 transition-colors">
                                  <IconTrash size={13} />
                                </button>
                              </div>
                              {os.status === 'approved' && os.date_ar && (
                                <p className="text-[0.6875rem] text-green-600 mt-0.5">{t('projectdetail_os_ack_on', { date: new Date(os.date_ar).toLocaleDateString('fr-FR') })}</p>
                              )}
                            </td>
                          </tr>
                        ))}
                        {ordresDeService.filter(o => o.type === 'travaux' || !o.type).length === 0 && (
                          <tr>
                            <td colSpan={9} className="px-6 py-8 text-left sm:text-center text-[var(--tblr-muted)] italic"><span className="table-empty-message">{t('projectdetail_os_empty')}</span></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* RFI Section */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconMessageDots}
                    title={
                      <span className="flex items-center gap-2">
                        {t('projectdetail_rfi_title')}
                        <span className="text-xs font-medium bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] px-2 py-0.5 rounded-full">{rfis.length}</span>
                      </span>
                    }
                    action={
                      <button
                        type="button"
                        onClick={() => setIsAddingRfi(!isAddingRfi)}
                        aria-expanded={isAddingRfi}
                        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition"
                      >
                        {isAddingRfi ? <IconX size={14} /> : <IconPlus size={14} />}
                        {isAddingRfi ? t('projectdetail_dialog_cancel') : t('projectdetail_rfi_add')}
                      </button>
                    }
                  />
                  {isAddingRfi && (
                    <div className="p-4 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-3">
                      <textarea rows={2} aria-label={t('projectdetail_rfi_question')} placeholder={t('projectdetail_rfi_question')} className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none resize-none focus-visible:ring-2 focus-visible:ring-blue-500" value={newRfi.question} onChange={e => setNewRfi(prev => ({ ...prev, question: e.target.value }))} />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input type="text" aria-label={t('projectdetail_rfi_asked_by')} placeholder={t('projectdetail_rfi_asked_by')} className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={newRfi.asked_by} onChange={e => setNewRfi(prev => ({ ...prev, asked_by: e.target.value }))} />
                        <input type="date" aria-label={t('projectdetail_rfi_due')} title={t('projectdetail_rfi_due')} className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={newRfi.due_date} onChange={e => setNewRfi(prev => ({ ...prev, due_date: e.target.value }))} />
                      </div>
                      <div className="flex justify-end">
                        <button
                          onClick={async () => {
                            if (!id || !newRfi.question) return;
                            try {
                              const res = await fetch('/api/rfis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newRfi, project_id: id }) });
                              if (res.ok) {
                                const data = await res.json();
                                setRfis(prev => [...prev, data]);
                                setIsAddingRfi(false);
                                setNewRfi({ question: '', asked_by: '', due_date: '' });
                              }
                            } catch (err) { console.error(err); }
                          }}
                          type="button"
                          disabled={!newRfi.question}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition"
                        >
                          {t('projectdetail_rfi_save')}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="p-4">
                    {rfis.length === 0 ? (
                      <p className="text-sm text-[var(--tblr-muted)] italic text-center py-4">{t('projectdetail_rfi_empty')}</p>
                    ) : (
                      <div className="space-y-2">
                        {rfis.map(r => (
                          <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg group">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{r.question}</p>
                              <p className="text-[0.6875rem] text-[var(--tblr-muted)]">{r.due_date ? t('projectdetail_rfi_due_on', { date: new Date(r.due_date).toLocaleDateString('fr-FR') }) : t('projectdetail_rfi_no_due')}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <select
                                aria-label={t('projectdetail_rfi_status_named', { question: r.question })}
                                className={cn(
                                  "text-[0.6875rem] font-bold uppercase px-2 py-1 rounded-full border-0 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer",
                                  r.status === 'repondu' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                )}
                                value={r.status}
                                onChange={async (e) => {
                                  const status = e.target.value;
                                  const res = await fetch(`/api/rfis/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...r, status, answered_date: status === 'repondu' ? new Date().toISOString().split('T')[0] : null }) });
                                  if (res.ok) setRfis(prev => prev.map(x => x.id === r.id ? { ...x, status: status as any } : x));
                                }}
                              >
                                <option value="en_attente">{t('projectdetail_rfi_status_waiting')}</option>
                                <option value="repondu">{t('projectdetail_rfi_status_answered')}</option>
                              </select>
                              <button
                                type="button"
                                aria-label={t('projectdetail_rfi_delete')}
                                onClick={async () => {
                                  if (!(await confirmDelete('projectdetail_confirm_delete_rfi'))) return;
                                  const res = await fetch(`/api/rfis/${r.id}`, { method: 'DELETE' });
                                  if (res.ok) setRfis(prev => prev.filter(x => x.id !== r.id));
                                }}
                                className="p-1 text-[var(--tblr-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition rounded"
                                title={t('projectdetail_rfi_delete')}
                              >
                                <IconTrash size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
                }
              />
            )}
            {activeTab === 'RDT' && (
              <div className="space-y-8">
                {/* Financial Summary */}
                {(() => {
                  const marchesInitiaux = (project.lots_list || []).reduce((acc, lot) => acc + (lot.base_amount || 0) + (lot.options_amount || 0) + (lot.amendments_amount || 0), 0);
                  const avenantsTravauxApprouves = ordresDeService
                    .filter(o => (o.type === 'travaux' || !o.type) && o.status === 'approved')
                    .reduce((acc, o) => acc + (Number(o.montant_devis_accepte) || Number(o.montant_devis_presente) || 0), 0);
                  const marchesRevises = marchesInitiaux + avenantsTravauxApprouves;
                  const honorairesInitiaux = Number(project.remuneration) || 0;
                  const avenantsHonorairesApprouves = cumulAvenantsApprouves;
                  const honorairesRevises = honorairesInitiaux + avenantsHonorairesApprouves;
                  return (
                    <>
                      {(avenantsTravauxApprouves !== 0 || avenantsHonorairesApprouves !== 0) && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded-lg p-4 flex flex-wrap gap-6 items-center">
                          <div>
                            <p className="text-[0.6875rem] font-bold text-blue-400 uppercase tracking-wider">{t('projectdetail_rdt_contracts_revised')}</p>
                            <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatCurrency(marchesRevises)}</p>
                            {avenantsTravauxApprouves !== 0 && (
                              <p className="text-xs text-blue-500">{t('projectdetail_rdt_initial_plus', { initial: formatCurrency(marchesInitiaux), sign: avenantsTravauxApprouves >= 0 ? '+' : '', delta: formatCurrency(avenantsTravauxApprouves) })}</p>
                            )}
                          </div>
                          {honorairesRevises !== 0 && (
                            <div>
                              <p className="text-[0.6875rem] font-bold text-blue-400 uppercase tracking-wider">{t('projectdetail_fees_revised')}</p>
                              <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatCurrency(honorairesRevises)}</p>
                              {avenantsHonorairesApprouves !== 0 && (
                                <p className="text-xs text-blue-500">{t('projectdetail_rdt_initial_plus', { initial: formatCurrency(honorairesInitiaux), sign: avenantsHonorairesApprouves >= 0 ? '+' : '', delta: formatCurrency(avenantsHonorairesApprouves) })}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
                <SituationsTravaux
                  projectId={id!}
                  lots={project.lots_list || []}
                  operation={{ nom: project.name, code: project.project_code, adresse: project.address, maitreOuvrage: project.client }}
                  clientSiret={project.client_siret}
                  isPublicClient={!!project.is_public_client}
                  showToast={showToast}
                />
              </div>
            )}
            {activeTab === 'ACT' && (
              <div className="mt-4">
                <ACTModule
                  projectId={id!}
                  projectName={project.name}
                  lots={project.lots_list || []}
                  contacts={contacts}
                />
              </div>
            )}

            {activeTab === 'VISA' && (
              <div className="space-y-8">
                {/* VISA Modal */}
                {isVisaModalOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setIsVisaModalOpen(false)}>
                    <div role="dialog" aria-modal="true" aria-labelledby="visa-modal-title" className="rounded-lg shadow-2xl w-full max-w-md mx-4 p-6" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }} onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-4">
                        <h4 id="visa-modal-title" className="text-base font-bold text-[var(--tblr-text)]">{editingVisa ? t('projectdetail_visa_edit') : t('projectdetail_visa_new')}</h4>
                        <button type="button" title={t('projectdetail_close')} aria-label={t('projectdetail_close')} onClick={() => setIsVisaModalOpen(false)} className="p-1 text-[var(--tblr-muted)] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
                          <IconX size={18} />
                        </button>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label htmlFor="visa-titre" className="block text-xs font-semibold text-[var(--tblr-muted)] mb-1">{t('projectdetail_os_title_field')} <span aria-hidden className="text-red-500">*</span></label>
                          <input
                            id="visa-titre"
                            required
                            type="text"
                            value={visaForm.title}
                            onChange={e => setVisaForm(f => ({ ...f, title: e.target.value }))}
                            className="w-full px-3 py-2 text-sm border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]"
                            placeholder={t('projectdetail_visa_title_placeholder')}
                          />
                        </div>
                        <div>
                          <label htmlFor="visa-lot" className="block text-xs font-semibold text-[var(--tblr-muted)] mb-1">{t('projectdetail_visa_lot')}</label>
                          <select
                            id="visa-lot"
                            value={visaForm.lot_id}
                            onChange={e => setVisaForm(f => ({ ...f, lot_id: e.target.value }))}
                            className="w-full px-3 py-2 text-sm border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]"
                          >
                            <option value="">{t('projectdetail_visa_no_lot')}</option>
                            {(project.lots_list || []).map(l => (
                              <option key={l.id} value={l.id}>{l.lot_title}{l.contact_name ? ` — ${l.contact_name}` : ''}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="visa-document" className="block text-xs font-semibold text-[var(--tblr-muted)] mb-1">{t('projectdetail_visa_document')}</label>
                          <input
                            id="visa-document"
                            type="file"
                            onChange={e => setVisaFile(e.target.files?.[0] || null)}
                            className="w-full text-xs text-[var(--tblr-muted)] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-zinc-100 dark:file:bg-zinc-800 file:text-[var(--tblr-text)]"
                          />
                          {editingVisa?.document_url && !visaFile && (
                            <button type="button" onClick={() => openSignedUrl(editingVisa.document_url!)} className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              <IconExternalLink size={12} /> {t('projectdetail_visa_current_document')}
                            </button>
                          )}
                        </div>
                        <div>
                          <p id="visa-statut-label" className="block text-xs font-semibold text-[var(--tblr-muted)] mb-2">{t('projectdetail_visa_opinion')}</p>
                          <div role="group" aria-labelledby="visa-statut-label" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {(['pending', 'approved', 'commented', 'rejected'] as const).map(s => (
                              <button
                                key={s}
                                type="button"
                                aria-pressed={visaForm.status === s}
                                onClick={() => setVisaForm(f => ({ ...f, status: s }))}
                                className={cn(
                                  "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold uppercase transition border",
                                  visaForm.status === s
                                    ? s === 'approved' ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:border-green-700 dark:text-green-400'
                                      : s === 'rejected' ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:border-red-700 dark:text-red-400'
                                      : s === 'commented' ? 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-400'
                                      : 'bg-zinc-200 text-zinc-700 border-zinc-300 dark:bg-zinc-700 dark:border-zinc-600 dark:text-zinc-200'
                                    : 'bg-white text-[var(--tblr-muted)] border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-[var(--tblr-muted)]'
                                )}
                              >
                                {t(`projectdetail_visa_status_${s}`)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label htmlFor="visa-observations" className="block text-xs font-semibold text-[var(--tblr-muted)] mb-1">{t('projectdetail_visa_observations')}</label>
                          <textarea
                            id="visa-observations"
                            rows={3}
                            value={visaForm.comments}
                            onChange={e => setVisaForm(f => ({ ...f, comments: e.target.value }))}
                            className="w-full px-3 py-2 text-sm border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)] resize-none"
                            placeholder={t('projectdetail_visa_observations_placeholder')}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-5">
                        <button type="button" onClick={() => setIsVisaModalOpen(false)} className="flex-1 py-2 px-4 text-sm font-medium text-[var(--tblr-muted)] border border-[var(--tblr-border)] rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                          {t('projectdetail_dialog_cancel')}
                        </button>
                        <button
                          type="button"
                          disabled={!visaForm.title.trim() || visaSaving}
                          onClick={async () => {
                            if (!visaForm.title.trim() || !id) return;
                            setVisaSaving(true);
                            try {
                              const form = new FormData();
                              form.append('project_id', id);
                              form.append('title', visaForm.title);
                              form.append('date', visaForm.date || new Date().toISOString());
                              form.append('status', visaForm.status);
                              form.append('comments', visaForm.comments);
                              form.append('lot_id', visaForm.lot_id);
                              if (visaFile) form.append('file', visaFile);

                              if (editingVisa) {
                                const res = await fetch(`/api/visas/${editingVisa.id}`, { method: 'PUT', body: form });
                                if (res.ok) {
                                  const updated = await res.json();
                                  setVisas(prev => prev.map(v => v.id === editingVisa.id ? updated : v));
                                } else {
                                  const err = await res.json().catch(() => null);
                                  showToast(t('projectdetail_visa_save_failed_detail', { error: err?.error || res.statusText }), 'error', { duration: 6000 });
                                }
                              } else {
                                const res = await fetch('/api/visas', { method: 'POST', body: form });
                                if (res.ok) {
                                  const data = await res.json();
                                  setVisas(prev => [...prev, data]);
                                } else {
                                  const err = await res.json().catch(() => null);
                                  showToast(t('projectdetail_visa_save_failed_detail', { error: err?.error || res.statusText }), 'error', { duration: 6000 });
                                }
                              }
                              setIsVisaModalOpen(false);
                              setEditingVisa(null);
                              setVisaFile(null);
                              setVisaForm({ title: '', date: new Date().toISOString().split('T')[0], status: 'pending', comments: '', lot_id: '' });
                            } catch (err) {
                              console.error(err);
                              showToast(t('projectdetail_visa_save_failed'), 'error', { duration: 6000 });
                            } finally {
                              setVisaSaving(false);
                            }
                          }}
                          className="flex-1 py-2 px-4 text-sm font-bold text-white bg-[var(--tblr-primary)] hover:opacity-90 disabled:opacity-50 rounded-lg transition-colors"
                        >
                          {visaSaving ? t('projectdetail_autosave_saving') : editingVisa ? t('projectdetail_visa_save') : t('projectdetail_visa_create')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconRubberStamp}
                    title={
                      <span className="flex items-center gap-2">
                        {t('projectdetail_visas_title')}
                        <span className="text-xs font-medium bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] px-2 py-0.5 rounded-full">{visas.length}</span>
                      </span>
                    }
                    action={
                      <button
                        type="button"
                        onClick={() => {
                          setEditingVisa(null);
                          setVisaFile(null);
                          setVisaForm({ title: '', date: new Date().toISOString().split('T')[0], status: 'pending', comments: '', lot_id: '' });
                          setIsVisaModalOpen(true);
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition"
                      >
                        <IconPlus size={14} />
                        {t('projectdetail_visa_add')}
                      </button>
                    }
                  />
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[0.6875rem] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left">{t('projectdetail_col_title')}</th>
                          <th className="px-6 py-3 text-left">{t('projectdetail_col_date')}</th>
                          <th className="px-6 py-3 text-left">{t('projectdetail_visa_opinion')}</th>
                          <th className="px-6 py-3 text-left">{t('projectdetail_visa_observations')}</th>
                          <th className="px-6 py-3 text-right"><span className="sr-only">{t('projectdetail_col_actions')}</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--tblr-border)]">
                        {Object.entries(visas.reduce((acc, v) => {
                          const lot = (project.lots_list || []).find(l => l.id === v.lot_id);
                          const key = lot ? `${lot.lot_title}${lot.contact_name ? ` · ${lot.contact_name}` : ''}` : t('projectdetail_visa_no_lot');
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(v);
                          return acc;
                        }, {} as Record<string, Visa[]>)).map(([groupKey, groupVisas]) => (
                        <React.Fragment key={groupKey}>
                          <tr
                            className="bg-zinc-50/50 dark:bg-zinc-800/20 hover:bg-zinc-100 dark:hover:bg-zinc-800/40 transition-colors">
                            <td colSpan={5} className="p-0">
                              <button type="button" aria-expanded={!!visaExpandedGroups[groupKey]} onClick={() => setVisaExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }))} className="w-full flex items-center gap-2 px-6 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                                {visaExpandedGroups[groupKey] ? <IconChevronDown size={14} className="text-[var(--tblr-muted)]" /> : <IconChevronRight size={14} className="text-[var(--tblr-muted)]" />}
                                <span className="font-bold text-[var(--tblr-text)] uppercase tracking-wider text-[0.6875rem]">{groupKey}</span>
                                <span className="text-[0.6875rem] text-[var(--tblr-muted)] font-normal">{t('projectdetail_visa_count', { count: groupVisas.length })}</span>
                              </button>
                            </td>
                          </tr>
                          {visaExpandedGroups[groupKey] && groupVisas.map((visa) => (
                          <tr key={visa.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors group">
                            <td className="px-6 py-4 font-bold text-[var(--tblr-text)]">
                              <div className="flex items-center gap-2">
                                {visa.title}
                                {visa.document_url && (
                                  <button type="button" onClick={e => { e.stopPropagation(); openSignedUrl(visa.document_url!); }} title={t('projectdetail_visa_open_document')} aria-label={t('projectdetail_visa_open_document')} className="text-[var(--tblr-muted)] hover:text-blue-600">
                                    <IconExternalLink size={13} />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{new Date(visa.date).toLocaleDateString('fr-FR')}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider",
                                visa.status === 'approved' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                visa.status === 'rejected' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                visa.status === 'commented' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                                "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-[var(--tblr-muted)]"
                              )}>
                                {t(`projectdetail_visa_status_${visa.status}`)}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 max-w-xs">
                              <span className="truncate block max-w-48" title={visa.comments}>{visa.comments || <span className="italic text-[var(--tblr-muted)]">—</span>}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                                {/* Quick validate */}
                                {visa.status !== 'approved' && (
                                  <button
                                    type="button"
                                    title={t('projectdetail_visa_quick_approve')}
                                    aria-label={t('projectdetail_visa_quick_approve_named', { title: visa.title })}
                                    onClick={async () => {
                                      try {
                                        const res = await fetch(`/api/visas/${visa.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...visa, status: 'approved' }) });
                                        if (res.ok) setVisas(prev => prev.map(v => v.id === visa.id ? { ...v, status: 'approved' } : v));
                                      } catch (err) { console.error(err); }
                                    }}
                                    className="p-1.5 text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                                  >
                                    <IconCheck size={15} />
                                  </button>
                                )}
                                {/* Quick reject */}
                                {visa.status !== 'rejected' && (
                                  <button
                                    type="button"
                                    title={t('projectdetail_visa_quick_reject')}
                                    aria-label={t('projectdetail_visa_quick_reject_named', { title: visa.title })}
                                    onClick={async () => {
                                      try {
                                        const res = await fetch(`/api/visas/${visa.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...visa, status: 'rejected' }) });
                                        if (res.ok) setVisas(prev => prev.map(v => v.id === visa.id ? { ...v, status: 'rejected' } : v));
                                      } catch (err) { console.error(err); }
                                    }}
                                    className="p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                  >
                                    <IconX size={15} />
                                  </button>
                                )}
                                {/* Edit */}
                                <button
                                  type="button"
                                  title={t('projectdetail_visa_edit')}
                                  aria-label={t('projectdetail_visa_edit_named', { title: visa.title })}
                                  onClick={() => {
                                    setEditingVisa(visa);
                                    setVisaFile(null);
                                    setVisaForm({ title: visa.title, date: visa.date.split('T')[0], status: visa.status, comments: visa.comments || '', lot_id: visa.lot_id || '' });
                                    setIsVisaModalOpen(true);
                                  }}
                                  className="p-1.5 text-[var(--tblr-muted)] hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                                >
                                  <IconEdit size={15} />
                                </button>
                                {/* Delete */}
                                <button
                                  type="button"
                                  title={t('projectdetail_visa_delete')}
                                  aria-label={t('projectdetail_visa_delete_named', { title: visa.title })}
                                  onClick={async () => {
                                    if (!(await confirmDelete('projectdetail_confirm_delete_visa'))) return;
                                    try {
                                      const res = await fetch(`/api/visas/${visa.id}`, { method: 'DELETE' });
                                      if (res.ok) setVisas(prev => prev.filter(v => v.id !== visa.id));
                                    } catch (err) { console.error(err); }
                                  }}
                                  className="p-1.5 text-[var(--tblr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                >
                                  <IconTrash size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          ))}
                        </React.Fragment>
                        ))}
                        {visas.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-6 py-8 text-left sm:text-center text-[var(--tblr-muted)] italic"><span className="table-empty-message">{t('projectdetail_visas_empty')}</span></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'CORRESPONDANCE' && (
              <div className="space-y-8">
                <CorrespondenceTab localType="project" localId={id!} contactEmail={project?.client_email} relatedKeywords={[project?.name, project?.project_code, project?.reference].filter(Boolean) as string[]} />
              </div>
            )}
            {activeTab === 'AOR' && (
              <div className="space-y-8">
                <ReserveTracker
                  projectId={id || ''}
                  apiBase="/api/reserves"
                  title={t('projectdetail_reserves_title')}
                  reserves={reserves}
                  setReserves={setReserves}
                  plans={plans}
                  lotsList={project?.lots_list}
                  project={project}
                  settings={settings}
                  initialOpenReserveId={openResourceKey === 'reserves' ? openRecordId : undefined}
                />

                <ReserveTracker
                  projectId={id || ''}
                  apiBase="/api/gpa-reserves"
                  title={t('projectdetail_reserves_gpa_title')}
                  reserves={gpaReserves}
                  setReserves={setGpaReserves}
                  plans={plans}
                  lotsList={project?.lots_list}
                  project={project}
                  settings={settings}
                />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-8">
                {/* PV de réception */}
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                  <CardHeader
                    icon={IconClipboardCheck}
                    title={t('projectdetail_pv_title')}
                    action={
                      <button
                        type="button"
                        onClick={() => { setShowPvForm(true); setEditingReceptionId(null); setPvForm(defaultPvForm()); }}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition"
                      >
                        <IconPlus size={14} />
                        {t('projectdetail_pv_new')}
                      </button>
                    }
                  />

                  {/* Formulaire PV */}
                  {showPvForm && (
                    <div className="p-6 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-5">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="pv-reference" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_pv_reference')}</label>
                          <input id="pv-reference" type="text" placeholder="PV-2026-001" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={pvForm.reference_pv} onChange={e => setPvForm(prev => ({ ...prev, reference_pv: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="pv-type" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_col_type')}</label>
                          <select id="pv-type" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={pvForm.type} onChange={e => setPvForm(prev => ({ ...prev, type: e.target.value as 'provisoire' | 'definitive' }))}>
                            <option value="provisoire">{t('projectdetail_pv_type_provisoire')}</option>
                            <option value="definitive">{t('projectdetail_pv_type_definitive')}</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="pv-date" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_pv_date')}</label>
                          <input id="pv-date" type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={pvForm.date} onChange={e => setPvForm(prev => ({ ...prev, date: e.target.value }))} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="pv-lieu" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_pv_place')}</label>
                          <input id="pv-lieu" type="text" placeholder={t('projectdetail_pv_place_placeholder')} className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={pvForm.lieu} onChange={e => setPvForm(prev => ({ ...prev, lieu: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="pv-limite" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_pv_deadline')}</label>
                          <input id="pv-limite" type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={pvForm.date_limite_levee} onChange={e => setPvForm(prev => ({ ...prev, date_limite_levee: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                        </div>
                      </div>

                      {/* Liste des réserves */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">
                            {t('projectdetail_reserves_title')}
                            {pvForm.reserves_list.length > 0 && (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[0.6875rem]">{pvForm.reserves_list.length}</span>
                            )}
                          </h4>
                          <button
                            type="button"
                            onClick={() => setPvForm(prev => ({
                              ...prev,
                              has_reserves: true,
                              reserves_list: [...prev.reserves_list, { id: crypto.randomUUID(), title: '', batiment: '', local: '', lots: '', entreprises: '', due_date: prev.date_limite_levee || '', status: 'A faire' }]
                            }))}
                            className="flex items-center gap-1 text-[0.6875rem] font-bold text-amber-600 hover:text-amber-700 transition-colors"
                          >
                            <IconPlus size={12} /> {t('projectdetail_pv_reserve_add')}
                          </button>
                        </div>
                        {pvForm.reserves_list.length === 0 && (
                          <p className="text-xs text-[var(--tblr-muted)] italic py-1">{t('projectdetail_pv_reserves_empty')}</p>
                        )}
                        {pvForm.reserves_list.map((r, idx) => (
                          <div key={r.id} className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10 p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] w-6 shrink-0 tabular-nums">#{idx + 1}</span>
                              <input
                                type="text"
                                aria-label={t('projectdetail_pv_reserve_title_named', { n: idx + 1 })}
                                placeholder={t('projectdetail_pv_reserve_title')}
                                className="flex-1 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                                value={r.title}
                                onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, title: e.target.value } : x) }))}
                              />
                              <button title={t('projectdetail_pv_reserve_remove')} aria-label={t('projectdetail_pv_reserve_remove_named', { n: idx + 1 })}
                                type="button"
                                onClick={() => setPvForm(prev => ({
                                  ...prev,
                                  reserves_list: prev.reserves_list.filter((_, i) => i !== idx),
                                  has_reserves: prev.reserves_list.length > 1,
                                }))}
                                className="p-1.5 text-red-400 hover:text-red-600 transition-colors shrink-0"
                              >
                                <IconX size={14} />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pl-7">
                              <input type="text" aria-label={t('projectdetail_pv_building')} placeholder={t('projectdetail_pv_building')} className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={r.batiment} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, batiment: e.target.value } : x) }))} />
                              <input type="text" aria-label={t('projectdetail_pv_room')} placeholder={t('projectdetail_pv_room')} className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={r.local} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, local: e.target.value } : x) }))} />
                              <input type="text" aria-label={t('projectdetail_pv_lots')} placeholder={t('projectdetail_pv_lots')} className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={r.lots} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, lots: e.target.value } : x) }))} />
                              <input type="text" aria-label={t('projectdetail_pv_companies')} placeholder={t('projectdetail_pv_companies')} className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={r.entreprises} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, entreprises: e.target.value } : x) }))} />
                              <div className="space-y-0.5">
                                <label htmlFor={`pv-reserve-${r.id}-date`} className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_pv_reserve_deadline')}</label>
                                <input id={`pv-reserve-${r.id}-date`} type="date" className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={r.due_date} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, due_date: e.target.value } : x) }))} />
                              </div>
                              <div className="space-y-0.5">
                                <label htmlFor={`pv-reserve-${r.id}-statut`} className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_col_status')}</label>
                                <select id={`pv-reserve-${r.id}-statut`} className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-500" value={r.status} onChange={e => setPvForm(prev => ({ ...prev, reserves_list: prev.reserves_list.map((x, i) => i === idx ? { ...x, status: e.target.value } : x) }))}>
                                  {RESERVE_STATUSES.map(s => <option key={s} value={s}>{t(reserveStatusKey(s)!)}</option>)}
                                </select>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Signataires */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_pv_signatories')}</h4>
                          <button type="button" onClick={() => setPvForm(prev => ({ ...prev, signataires: [...prev.signataires, { nom: '', role: '' }] }))} className="flex items-center gap-1 text-[0.6875rem] font-bold text-blue-600 hover:text-blue-700 transition-colors">
                            <IconPlus size={12} /> {t('projectdetail_pv_signatory_add')}
                          </button>
                        </div>
                        {pvForm.signataires.map((sig, idx) => (
                          <div key={idx} className="flex gap-2 items-center">
                            <input type="text" aria-label={t('projectdetail_pv_signatory_name')} placeholder={t('projectdetail_pv_signatory_name')} className="flex-1 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={sig.nom} onChange={e => setPvForm(prev => ({ ...prev, signataires: prev.signataires.map((s, i) => i === idx ? { ...s, nom: e.target.value } : s) }))} />
                            <input type="text" aria-label={t('projectdetail_pv_signatory_role')} placeholder={t('projectdetail_pv_signatory_role_placeholder')} className="flex-1 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={sig.role} onChange={e => setPvForm(prev => ({ ...prev, signataires: prev.signataires.map((s, i) => i === idx ? { ...s, role: e.target.value } : s) }))} />
                            <button title={t('projectdetail_pv_signatory_remove')} aria-label={t('projectdetail_pv_signatory_remove')} type="button" onClick={() => setPvForm(prev => ({ ...prev, signataires: prev.signataires.filter((_, i) => i !== idx) }))} className="p-2 text-red-400 hover:text-red-600 transition-colors"><IconX size={14} /></button>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="pv-observations" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase">{t('projectdetail_visa_observations')}</label>
                        <textarea id="pv-observations" rows={3} className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none" value={pvForm.observations} onChange={e => setPvForm(prev => ({ ...prev, observations: e.target.value }))} />
                      </div>

                      <div className="flex justify-end gap-3">
                        <button type="button" onClick={() => { setShowPvForm(false); setEditingReceptionId(null); }} className="px-4 py-2 text-sm font-bold text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors">{t('projectdetail_dialog_cancel')}</button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const rl = pvForm.reserves_list;
                              const body = {
                                project_id: id,
                                date: pvForm.date,
                                type: pvForm.type,
                                has_reserves: rl.length > 0,
                                reserves_count: rl.length,
                                reference_pv: pvForm.reference_pv,
                                lieu: pvForm.lieu,
                                date_limite_levee: pvForm.date_limite_levee,
                                signataires: JSON.stringify(pvForm.signataires),
                                observations: pvForm.observations,
                                pv_valide: pvForm.pv_valide,
                              };
                              let receptionId = editingReceptionId;
                              if (editingReceptionId) {
                                const res = await fetch(`/api/receptions/${editingReceptionId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                                if (res.ok) { const data = await res.json(); setReceptions(prev => prev.map(r => r.id === editingReceptionId ? data : r)); }
                                // Remove old reserves for this PV then re-create
                                const existingForPv = reserves.filter(r => r.reception_id === editingReceptionId);
                                await Promise.all(existingForPv.map(r => fetch(`/api/reserves/${r.id}`, { method: 'DELETE' })));
                              } else {
                                const res = await fetch('/api/receptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                                if (res.ok) { const data = await res.json(); receptionId = data.id; setReceptions(prev => [...prev, data]); }
                              }
                              // Save inline reserves
                              if (receptionId && rl.length > 0) {
                                const today = new Date().toISOString().split('T')[0];
                                const saved = await Promise.all(rl.map(r => fetch('/api/reserves', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    id: r.id, project_id: id, reception_id: receptionId,
                                    title: r.title || t('projectdetail_pv_reserve_untitled'), batiment: r.batiment, local: r.local,
                                    lots: JSON.stringify(r.lots ? r.lots.split(',').map((s: string) => s.trim()) : []),
                                    entreprises: JSON.stringify(r.entreprises ? r.entreprises.split(',').map((s: string) => s.trim()) : []),
                                    status: r.status || 'A faire', due_date: r.due_date || today, created_at: today,
                                  }),
                                }).then(res => res.json())));
                                setReserves(prev => [...prev.filter(r => r.reception_id !== receptionId), ...saved]);
                              }
                              setShowPvForm(false);
                              setEditingReceptionId(null);
                              setPvForm(defaultPvForm());
                            } catch (err) { console.error(err); }
                          }}
                          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition"
                        >
                          {editingReceptionId ? t('projectdetail_pv_save') : t('projectdetail_pv_create')}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[0.6875rem] tracking-wider">
                        <tr>
                          <th className="px-6 py-3 text-left">{t('projectdetail_ff_reference')}</th>
                          <th className="px-6 py-3 text-left">{t('projectdetail_col_type')}</th>
                          <th className="px-6 py-3 text-left">{t('projectdetail_col_date')}</th>
                          <th className="px-6 py-3 text-left">{t('projectdetail_pv_place')}</th>
                          <th className="px-6 py-3 text-left">{t('projectdetail_reserves_title')}</th>
                          <th className="px-6 py-3 text-left">{t('projectdetail_pv_col_deadline')}</th>
                          <th className="px-6 py-3 text-left">{t('projectdetail_col_status')}</th>
                          <th className="px-6 py-3 text-right w-28"><span className="sr-only">{t('projectdetail_col_actions')}</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--tblr-border)]">
                        {receptions.map((rec) => {
                          const dlimit = rec.date_limite_levee ? new Date(rec.date_limite_levee) : null;
                          const isUrgent = dlimit && (dlimit.getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000;
                          const pvReserves = reservesByReceptionId.get(rec.id) ?? [];
                          const isExpanded = expandedPvId === rec.id;
                          const reservesLevees = pvReserves.filter(r => r.status === 'Levée' || r.status === 'Quitus Transmis').length;
                          return (
                            <React.Fragment key={rec.id}>
                            <tr className="hover:bg-[var(--tblr-surface-2)] transition-colors group">
                              <td className="px-6 py-4 font-mono text-xs font-bold text-[var(--tblr-text)]">{rec.reference_pv || '—'}</td>
                              <td className="px-6 py-4">
                                <span className={cn("px-2 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider", rec.type === 'definitive' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400")}>
                                  {rec.type === 'provisoire' ? t('projectdetail_pv_type_provisoire_short') : t('projectdetail_pv_type_definitive_short')}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 text-xs">{new Date(rec.date).toLocaleDateString('fr-FR')}</td>
                              <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 text-xs">{rec.lieu || '—'}</td>
                              <td className="px-6 py-4">
                                {pvReserves.length > 0 ? (
                                  <button
                                    type="button"
                                    aria-expanded={isExpanded}
                                    onClick={() => setExpandedPvId(isExpanded ? null : rec.id)}
                                    className={cn("flex items-center gap-1.5 px-2 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider transition-colors", "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-200")}
                                  >
                                    {isExpanded ? <IconChevronUp size={10} /> : <IconChevronDown size={10} />}
                                    {t('projectdetail_pv_reserves_count', { count: pvReserves.length })} · {t('projectdetail_pv_reserves_lifted', { count: reservesLevees })}
                                  </button>
                                ) : (
                                  <span className="px-2 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                    {t('projectdetail_pv_no_reserves')}
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                {dlimit ? (
                                  <span className={cn("text-xs font-medium", isUrgent ? "text-orange-600 dark:text-orange-400 font-bold" : "text-zinc-600 dark:text-zinc-300")}>
                                    {dlimit.toLocaleDateString('fr-FR')}
                                    {isUrgent && <span className="sr-only"> {t('projectdetail_pv_deadline_near')}</span>}
                                    {isUrgent && <span aria-hidden> ⚠</span>}
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-6 py-4">
                                <span className={cn("px-2 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider", rec.pv_valide ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-100 text-[var(--tblr-muted)] dark:bg-zinc-800 dark:text-[var(--tblr-muted)]")}>
                                  {rec.pv_valide ? t('projectdetail_pv_status_signed') : t('projectdetail_os_status_draft')}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                                  {/* PDF export */}
                                  <button
                                    type="button"
                                    title={t('projectdetail_pv_export_pdf')}
                                    aria-label={t('projectdetail_pv_export_pdf')}
                                    onClick={() => {
                                      const signataires: { nom: string; role: string }[] = rec.signataires ? JSON.parse(rec.signataires) : [];
                                      generatePvPdf(rec, pvReserves, project?.name || 'Projet', signataires);
                                    }}
                                    className="p-1.5 text-[var(--tblr-muted)] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                                  >
                                    <IconFileDownload size={15} />
                                  </button>
                                  {/* Edit */}
                                  <button
                                    type="button"
                                    title={t('projectdetail_pv_edit')}
                                    aria-label={t('projectdetail_pv_edit')}
                                    onClick={() => openReceptionForm(rec)}
                                    className="p-1.5 text-[var(--tblr-muted)] hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
                                  >
                                    <IconEdit size={15} />
                                  </button>
                                  {/* Delete */}
                                  <button
                                    type="button"
                                    title={t('projectdetail_pv_delete')}
                                    aria-label={t('projectdetail_pv_delete')}
                                    onClick={async () => {
                                      if (!(await confirmDelete('projectdetail_confirm_delete_pv_reception'))) return;
                                      try {
                                        const res = await fetch(`/api/receptions/${rec.id}`, { method: 'DELETE' });
                                        if (res.ok) setReceptions(prev => prev.filter(r => r.id !== rec.id));
                                      } catch (err) { console.error(err); }
                                    }}
                                    className="p-1.5 text-[var(--tblr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                  >
                                    <IconTrash size={15} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {/* Panneau dépliable — liste des réserves */}
                            {isExpanded && pvReserves.length > 0 && (
                              <tr>
                                <td colSpan={8} className="px-0 pb-0 pt-0">
                                  <div className="mx-6 mb-4 rounded-lg border border-amber-200 dark:border-amber-800/40 overflow-hidden">
                                    <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40 flex items-center justify-between">
                                      <span className="text-[0.6875rem] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">
                                        {rec.reference_pv ? t('projectdetail_pv_reserves_list_ref', { ref: rec.reference_pv }) : t('projectdetail_pv_reserves_list')}
                                      </span>
                                      <span className="text-[0.6875rem] text-amber-600 dark:text-amber-500">
                                        {t('projectdetail_pv_lifted_ratio', { count: reservesLevees, total: pvReserves.length })}
                                      </span>
                                    </div>
                                    <table className="w-full text-xs">
                                      <thead className="bg-amber-50/50 dark:bg-amber-900/10 text-amber-600 dark:text-amber-500 font-bold uppercase text-[0.6875rem] tracking-wider">
                                        <tr>
                                          <th className="px-4 py-2 text-left w-8">{t('projectdetail_col_number')}</th>
                                          <th className="px-4 py-2 text-left">{t('projectdetail_col_title')}</th>
                                          <th className="px-4 py-2 text-left">{t('projectdetail_pv_col_place')}</th>
                                          <th className="px-4 py-2 text-left">{t('projectdetail_col_lot_company')}</th>
                                          <th className="px-4 py-2 text-left">{t('projectdetail_pv_reserve_deadline')}</th>
                                          <th className="px-4 py-2 text-left">{t('projectdetail_col_status')}</th>
                                          <th className="px-4 py-2 text-right w-16"><span className="sr-only">{t('projectdetail_col_actions')}</span></th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-amber-100 dark:divide-amber-900/20">
                                        {pvReserves.map((r, idx) => {
                                          const isLevee = r.status === 'Levée' || r.status === 'Quitus Transmis';
                                          const isEnRetard = r.due_date && new Date(r.due_date) < new Date() && !isLevee;
                                          const statusColors: Record<string, string> = {
                                            'A faire': 'bg-red-100 text-red-700',
                                            'En cours': 'bg-blue-100 text-blue-700',
                                            'Levée': 'bg-green-100 text-green-700',
                                            'Quitus Transmis': 'bg-green-200 text-green-800',
                                            "Refusée par l'entreprise": 'bg-orange-100 text-orange-700',
                                            'Levée refusée par le MOE': 'bg-purple-100 text-purple-700',
                                          };
                                          return (
                                            <tr key={r.id} className={cn("transition-colors", isLevee ? "opacity-60" : "hover:bg-amber-50/60 dark:hover:bg-amber-900/10")}>
                                              <td className="px-4 py-2 font-black text-amber-500">{r.number ?? idx + 1}</td>
                                              <td className="px-4 py-2 font-medium text-zinc-800 dark:text-zinc-200">{r.title}</td>
                                              <td className="px-4 py-2 text-[var(--tblr-muted)]">
                                                {[r.batiment, r.local].filter(Boolean).join(' / ') || '—'}
                                              </td>
                                              <td className="px-4 py-2 text-[var(--tblr-muted)]">
                                                {(() => {
                                                  const lots = (() => { try { return JSON.parse(r.lots); } catch { return [r.lots]; } })();
                                                  const ents = (() => { try { return JSON.parse(r.entreprises); } catch { return [r.entreprises]; } })();
                                                  return [...(Array.isArray(lots) ? lots : []), ...(Array.isArray(ents) ? ents : [])].filter(Boolean).join(', ') || '—';
                                                })()}
                                              </td>
                                              <td className={cn("px-4 py-2 font-medium", isEnRetard ? "text-red-600 font-bold" : "text-[var(--tblr-muted)]")}>
                                                {r.due_date ? new Date(r.due_date).toLocaleDateString('fr-FR') : '—'}
                                                {isEnRetard && <span className="sr-only"> {t('projectdetail_pv_reserve_late')}</span>}
                                                {isEnRetard && <span aria-hidden> ⚠</span>}
                                              </td>
                                              <td className="px-4 py-2">
                                                <select
                                                  aria-label={t('projectdetail_pv_reserve_status_named', { title: r.title })}
                                                  value={r.status}
                                                  onChange={async (e) => {
                                                    const newStatus = e.target.value;
                                                    await fetch(`/api/reserves/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...r, status: newStatus }) });
                                                    setReserves(prev => prev.map(rv => rv.id === r.id ? { ...rv, status: newStatus as Reserve['status'] } : rv));
                                                  }}
                                                  className={cn("text-[0.6875rem] font-bold px-2 py-0.5 rounded-full border-0 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer", statusColors[r.status] || 'bg-zinc-100 text-zinc-600')}
                                                >
                                                  {RESERVE_STATUSES.map(s => <option key={s} value={s}>{t(reserveStatusKey(s)!)}</option>)}
                                                </select>
                                              </td>
                                              <td className="px-4 py-2 text-right">
                                                <button type="button" title={t('projectdetail_reserve_delete')} aria-label={t('projectdetail_reserve_delete_named', { title: r.title })}
                                                  onClick={async () => {
                                                    if (!(await confirmDelete('projectdetail_confirm_delete_reserve'))) return;
                                                    const res = await fetch(`/api/reserves/${r.id}`, { method: 'DELETE' });
                                                    if (res.ok) setReserves(prev => prev.filter(rv => rv.id !== r.id));
                                                    else showToast(t('projectdetail_delete_failed'), 'error', { duration: 6000 });
                                                  }}
                                                  className="p-1 text-[var(--tblr-muted)] hover:text-red-500 transition-colors"
                                                >
                                                  <IconTrash size={12} />
                                                </button>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                            </React.Fragment>
                          );
                        })}
                        {receptions.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-6 py-8 text-left sm:text-center text-[var(--tblr-muted)] italic"><span className="table-empty-message">{t('projectdetail_pv_empty')}</span></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* DOE — Dossier des Ouvrages Exécutés */}
                {(() => {
                  // Dedupe the project lots down to one entry per entreprise (contact),
                  // for the "assign entreprise" picker.
                  const doeEntreprises = Object.values(
                    (project.lots_list || []).filter(l => l.contact_name).reduce((acc, l) => {
                      const key = l.contact_id || l.contact_name!;
                      if (!acc[key]) acc[key] = { id: key, name: l.contact_name! };
                      return acc;
                    }, {} as Record<string, { id: string; name: string }>)
                  );
                  const doeGroups = doeDocuments.reduce<Record<string, any[]>>((acc, doc) => {
                    const key = doc.contact_name || t('projectdetail_doe_unassigned');
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(doc);
                    return acc;
                  }, {});

                  const updateDoeValidation = async (doc: any, fields: { validation_status?: string; validation_comments?: string; contact_id?: string; contact_name?: string }) => {
                    const form = new FormData();
                    form.append('name', doc.name);
                    form.append('category', doc.category || 'DOE');
                    form.append('description', doc.description || '');
                    form.append('validation_status', fields.validation_status ?? doc.validation_status ?? 'pending');
                    form.append('validation_comments', fields.validation_comments ?? doc.validation_comments ?? '');
                    form.append('contact_id', fields.contact_id !== undefined ? fields.contact_id : (doc.contact_id || ''));
                    form.append('contact_name', fields.contact_name !== undefined ? fields.contact_name : (doc.contact_name || ''));
                    try {
                      const res = await fetch(`/api/documents/${doc.id}`, { method: 'PUT', body: form });
                      if (res.ok) await fetchDoeDocuments();
                    } catch (err) { console.error(err); }
                  };

                  return (
                  <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                    <CardHeader
                      icon={IconClipboardCheck}
                      title={t('projectdetail_doe_title')}
                      description={t('projectdetail_doe_desc')}
                      action={
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={t('projectdetail_doe_company')}
                          value={doeContactId}
                          onChange={e => setDoeContactId(e.target.value)}
                          className="bg-zinc-100 dark:bg-zinc-800 border-none rounded-lg px-3 py-2 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        >
                          <option value="">{t('projectdetail_doe_company_none')}</option>
                          {doeEntreprises.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <input type="file" className="hidden" ref={doeInputRef} onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !id) return;
                          setDoeUploading(true);
                          try {
                            const selected = doeEntreprises.find(c => c.id === doeContactId);
                            const form = new FormData();
                            form.append('file', file);
                            form.append('name', file.name);
                            form.append('project_id', id);
                            form.append('doc_type', 'DOE');
                            form.append('category', 'DOE');
                            if (selected) {
                              form.append('contact_id', selected.id);
                              form.append('contact_name', selected.name);
                            }
                            const res = await fetch('/api/documents', { method: 'POST', body: form });
                            if (res.ok) {
                              await fetchDoeDocuments();
                            } else {
                              const err = await res.json().catch(() => null);
                              showToast(t('projectdetail_doe_upload_failed_detail', { error: err?.error || res.statusText }), 'error', { duration: 6000 });
                            }
                          } catch (err) {
                            console.error(err);
                            showToast(t('projectdetail_doe_upload_failed'), 'error', { duration: 6000 });
                          } finally {
                            setDoeUploading(false);
                            if (doeInputRef.current) doeInputRef.current.value = '';
                          }
                        }} />
                        <button
                          type="button"
                          onClick={() => doeInputRef.current?.click()}
                          disabled={doeUploading}
                          aria-busy={doeUploading}
                          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition disabled:opacity-50"
                        >
                          <IconFilePlus size={14} />
                          {doeUploading ? t('projectdetail_doe_uploading') : t('projectdetail_doe_add')}
                        </button>
                      </div>
                      }
                    />
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[0.6875rem] tracking-wider">
                          <tr>
                            <th className="px-6 py-3 text-left">{t('projectdetail_doe_col_name')}</th>
                            <th className="px-6 py-3 text-left">{t('projectdetail_visa_opinion')}</th>
                            <th className="px-6 py-3 text-left">{t('projectdetail_visa_observations')}</th>
                            <th className="px-6 py-3 text-left">{t('projectdetail_doe_col_date')}</th>
                            <th className="px-6 py-3 text-right w-32"><span className="sr-only">{t('projectdetail_col_actions')}</span></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--tblr-border)]">
                          {Object.entries(doeGroups).map(([groupKey, groupDocs]) => (
                            <React.Fragment key={groupKey}>
                              <tr
                                className="bg-zinc-50/50 dark:bg-zinc-800/20 hover:bg-zinc-100 dark:hover:bg-zinc-800/40 transition-colors">
                                <td colSpan={5} className="p-0">
                                  <button type="button" aria-expanded={!!doeExpandedGroups[groupKey]} onClick={() => setDoeExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }))} className="w-full flex items-center gap-2 px-6 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                                    {doeExpandedGroups[groupKey] ? <IconChevronDown size={14} className="text-[var(--tblr-muted)]" /> : <IconChevronRight size={14} className="text-[var(--tblr-muted)]" />}
                                    <span className="font-bold text-[var(--tblr-text)] uppercase tracking-wider text-[0.6875rem]">{groupKey}</span>
                                    <span className="text-[0.6875rem] text-[var(--tblr-muted)] font-normal">{t('projectdetail_doe_count', { count: groupDocs.length })}</span>
                                  </button>
                                </td>
                              </tr>
                              {doeExpandedGroups[groupKey] && groupDocs.map((doc) => (
                                <tr key={doc.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors group">
                                  <td className="px-6 py-4 font-medium text-[var(--tblr-text)]">{doc.name}</td>
                                  <td className="px-6 py-4">
                                    <span className={cn(
                                      "px-2 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider",
                                      doc.validation_status === 'approved' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                      doc.validation_status === 'rejected' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                      doc.validation_status === 'commented' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                                      "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-[var(--tblr-muted)]"
                                    )}>
                                      {t(`projectdetail_visa_status_${['approved', 'rejected', 'commented'].includes(doc.validation_status) ? doc.validation_status : 'pending'}`)}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 max-w-xs">
                                    {editingDoeId === doc.id ? (
                                      <textarea
                                        rows={2}
                                        autoFocus
                                        aria-label={t('projectdetail_visa_observations')}
                                        value={editDoeComments}
                                        onChange={e => setEditDoeComments(e.target.value)}
                                        className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded p-1 text-xs resize-none"
                                      />
                                    ) : (
                                      <span className="truncate block max-w-48" title={doc.validation_comments}>{doc.validation_comments || <span className="italic text-[var(--tblr-muted)]">—</span>}</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300 text-xs">{new Date(doc.uploaded_at).toLocaleDateString('fr-FR')}</td>
                                  <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                                      {editingDoeId === doc.id ? (
                                        <>
                                          <select
                                            aria-label={t('projectdetail_doe_company')}
                                            value={editDoeContactId}
                                            onChange={e => setEditDoeContactId(e.target.value)}
                                            className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded p-1 text-xs mr-1"
                                          >
                                            <option value="">{t('projectdetail_doe_unassigned')}</option>
                                            {doeEntreprises.map(c => (
                                              <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                          </select>
                                          <button
                                            type="button"
                                            title={t('projectdetail_doe_save')}
                                            aria-label={t('projectdetail_doe_save')}
                                            onClick={async () => {
                                              const selected = doeEntreprises.find(c => c.id === editDoeContactId);
                                              await updateDoeValidation(doc, {
                                                validation_comments: editDoeComments,
                                                contact_id: selected?.id || '',
                                                contact_name: selected?.name || '',
                                              });
                                              setEditingDoeId(null);
                                            }}
                                            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                                          >
                                            <IconCheck size={14} />
                                          </button>
                                          <button
                                            type="button"
                                            title={t('projectdetail_dialog_cancel')}
                                            aria-label={t('projectdetail_dialog_cancel')}
                                            onClick={() => setEditingDoeId(null)}
                                            className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                          >
                                            <IconX size={14} />
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          {doc.validation_status !== 'approved' && (
                                            <button type="button" title={t('projectdetail_visa_quick_approve')} aria-label={t('projectdetail_visa_quick_approve_named', { title: doc.name })} onClick={() => updateDoeValidation(doc, { validation_status: 'approved' })} className="p-1.5 text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors">
                                              <IconCheck size={15} />
                                            </button>
                                          )}
                                          {doc.validation_status !== 'rejected' && (
                                            <button type="button" title={t('projectdetail_visa_quick_reject')} aria-label={t('projectdetail_visa_quick_reject_named', { title: doc.name })} onClick={() => updateDoeValidation(doc, { validation_status: 'rejected' })} className="p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                                              <IconX size={15} />
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            title={t('projectdetail_doe_edit')}
                                            aria-label={t('projectdetail_doe_edit_named', { name: doc.name })}
                                            onClick={() => {
                                              setEditingDoeId(doc.id);
                                              setEditDoeContactId(doc.contact_id || '');
                                              setEditDoeComments(doc.validation_comments || '');
                                            }}
                                            className="p-1.5 text-[var(--tblr-muted)] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                          >
                                            <IconEdit size={15} />
                                          </button>
                                          <button type="button" onClick={() => openSignedUrl(doc.file_url)} className="p-1.5 text-[var(--tblr-muted)] hover:text-blue-600 transition-colors" title={t('projectdetail_doe_open')} aria-label={t('projectdetail_doe_open_named', { name: doc.name })}>
                                            <IconExternalLink size={15} />
                                          </button>
                                          <button
                                            type="button"
                                            aria-label={t('projectdetail_doe_delete_named', { name: doc.name })}
                                            onClick={async () => {
                                              if (!(await confirmDelete('projectdetail_confirm_delete_doe_document'))) return;
                                              try {
                                                const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
                                                if (res.ok) setDoeDocuments(prev => prev.filter(d => d.id !== doc.id));
                                              } catch (err) { console.error(err); }
                                            }}
                                            className="p-1.5 text-[var(--tblr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                            title={t('projectdetail_doe_delete')}
                                          >
                                            <IconTrash size={15} />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </React.Fragment>
                          ))}
                          {doeDocuments.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-6 py-8 text-left sm:text-center text-[var(--tblr-muted)] italic"><span className="table-empty-message">{t('projectdetail_doe_empty')}</span></td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  );
                })()}

                {/* Plans de l'opération */}
                {(() => {
                  const aorPlans = plans.filter(p => p.category === 'AOR' || !p.category);
                  return (
                    <div className="rounded-lg overflow-hidden mt-8" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                      <CardHeader
                        className="p-4 sm:p-6"
                        icon={IconClipboardCheck}
                        title={t('projectdetail_plans_title')}
                        action={
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="file"
                            className="hidden"
                            ref={planInputRef}
                            onChange={handlePlanUpload}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setUpdatingPlanId(null);
                              planInputRef.current?.click();
                            }}
                            disabled={planUploading}
                            aria-busy={planUploading}
                            className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition whitespace-nowrap disabled:opacity-50"
                          >
                            <IconUpload size={14} />
                            <span className="hidden sm:inline">{planUploading ? t('projectdetail_doe_uploading') : t('projectdetail_plans_import')}</span>
                            <span className="sm:hidden">{planUploading ? t('projectdetail_doe_uploading') : t('projectdetail_plans_import_short')}</span>
                          </button>
                        </div>
                        }
                      />
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[0.6875rem] tracking-wider">
                            <tr>
                              <th className="px-6 py-3 text-left">{t('projectdetail_plans_col_name')}</th>
                              <th className="px-6 py-3 text-left w-20">{t('projectdetail_ff_index')}</th>
                              <th className="px-6 py-3 text-left">{t('projectdetail_doe_col_date')}</th>
                              <th className="px-6 py-3 text-right w-24"><span className="sr-only">{t('projectdetail_col_actions')}</span></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--tblr-border)]">
                            {aorPlans
                              .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
                              .map((plan) => (
                              <tr key={plan.id} className="hover:bg-[var(--tblr-surface-2)] transition-colors group">
                                <td className="px-6 py-4 font-bold text-[var(--tblr-text)]">{plan.name}</td>
                                <td className="px-6 py-4">
                                  <span className="px-2 py-0.5 bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] rounded text-[0.6875rem] font-bold">
                                    {plan.index || 'A'}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-zinc-600 dark:text-zinc-300">{new Date(plan.uploaded_at).toLocaleDateString('fr-FR')}</td>
                                <td className="px-6 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setUpdatingPlanId(plan.id);
                                        planInputRef.current?.click();
                                      }}
                                      disabled={planUploading}
                                      title={t('projectdetail_plans_new_index')}
                                      aria-label={t('projectdetail_plans_new_index_named', { name: plan.name })}
                                      className="p-2 text-[var(--tblr-muted)] hover:text-blue-600 transition-colors disabled:opacity-50"
                                    >
                                      <IconRefresh size={16} />
                                    </button>
                                    <button title={t('projectdetail_plans_open')} aria-label={t('projectdetail_plans_open_named', { name: plan.name })} type="button" onClick={() => openSignedUrl(plan.file_url)} className="p-2 text-[var(--tblr-muted)] hover:text-blue-600 transition-colors">
                                      <IconExternalLink size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={t('projectdetail_plans_delete_named', { name: plan.name })}
                                      onClick={async () => {
                                        if (!(await confirmDelete('projectdetail_confirm_delete_plan'))) return;
                                        try {
                                          const res = await fetch(`/api/plans/${plan.id}`, { method: 'DELETE' });
                                          if (res.ok) setPlans(prev => prev.filter(p => p.id !== plan.id));
                                        } catch (err) {
                                          console.error(err);
                                        }
                                      }}
                                      title={t('projectdetail_plans_delete')}
                                      className="p-2 text-[var(--tblr-muted)] hover:text-red-600 transition-colors"
                                    >
                                      <IconTrash size={16} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {aorPlans.length === 0 && (
                              <tr>
                                <td colSpan={4} className="px-6 py-8 text-left sm:text-center text-[var(--tblr-muted)] italic"><span className="table-empty-message">{t('projectdetail_plans_empty')}</span></td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
              </div>
              </div>
            )}
            </div>
          </div>
        )}
      </div>
      {/* AR Modal */}
      <AnimatePresence>
        {arOsTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <motion.div
              ref={launchOriginRef}
              role="dialog" aria-modal="true" aria-labelledby="ar-modal-title"
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-md rounded-lg shadow-2xl p-6"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
            >
              <h3 id="ar-modal-title" className="text-sm font-bold text-[var(--tblr-text)] mb-4">
                {t('projectdetail_ar_title', { number: arOsTarget.os_number })}
              </h3>
              <div className="space-y-3">
                <div>
                  <label htmlFor="ar-date" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase block mb-1">{t('projectdetail_ar_date')} <span aria-hidden className="text-red-500">*</span></label>
                  <input id="ar-date" required type="date" value={arForm.date_ar} onChange={e => setArForm(f => ({...f, date_ar: e.target.value}))}
                    className="w-full bg-white dark:bg-zinc-800 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label htmlFor="ar-execution" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase block mb-1">{t('projectdetail_ar_execution')}</label>
                  <input id="ar-execution" type="date" value={arForm.date_execution} onChange={e => setArForm(f => ({...f, date_execution: e.target.value}))}
                    className="w-full bg-white dark:bg-zinc-800 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label htmlFor="ar-notes" className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase block mb-1">{t('projectdetail_ar_notes')}</label>
                  <textarea id="ar-notes" rows={3} value={arForm.notes_ar} onChange={e => setArForm(f => ({...f, notes_ar: e.target.value}))}
                    className="w-full bg-white dark:bg-zinc-800 border border-[var(--tblr-border)] rounded-lg p-2 text-sm resize-none outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div className="flex gap-2 mt-5 justify-end">
                <button type="button" onClick={() => setArOsTarget(null)}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                  {t('projectdetail_dialog_cancel')}
                </button>
                <button type="button" onClick={handleArSubmit} disabled={arSaving || !arForm.date_ar} aria-busy={arSaving}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition">
                  {arSaving ? t('projectdetail_autosave_saving') : t('projectdetail_ar_confirm')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Project Confirmation Modal — type-to-confirm to prevent accidental deletion */}
      <AnimatePresence>
        {showDeleteProjectConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <motion.div
              ref={launchOriginRef}
              role="dialog" aria-modal="true" aria-labelledby="delete-project-modal-title"
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-md rounded-lg shadow-2xl p-6"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
            >
              <h3 id="delete-project-modal-title" className="text-sm font-bold text-[var(--tblr-text)] mb-2">{t('projects_delete_confirm_title')}</h3>
              <p className="text-sm text-[var(--tblr-muted)] mb-2">
                {t('projects_delete_confirm_body', { name: project?.name })}
              </p>
              <p className="text-sm text-[var(--tblr-muted)] mb-3">
                {t('projects_delete_confirm_instruction', { word: t('projects_delete_confirm_word') })}
              </p>
              <input
                autoFocus
                aria-label={t('projects_delete_confirm_instruction', { word: t('projects_delete_confirm_word') })}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg outline-none focus:ring-2 focus:ring-red-500 text-[var(--tblr-text)]"
                value={deleteProjectConfirmInput}
                onChange={e => setDeleteProjectConfirmInput(e.target.value)}
                placeholder={t('projects_delete_confirm_word')}
                onKeyDown={e => {
                  if (e.key === 'Enter' && deleteProjectConfirmInput.trim().toLowerCase() === t('projects_delete_confirm_word').toLowerCase() && !isDeletingProject) {
                    handleDelete();
                  }
                }}
              />
              <div className="flex gap-2 mt-5 justify-end">
                <button type="button" onClick={() => setShowDeleteProjectConfirm(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                  {t('btn_cancel')}
                </button>
                <button
                  type="button"
                  disabled={deleteProjectConfirmInput.trim().toLowerCase() !== t('projects_delete_confirm_word').toLowerCase() || isDeletingProject}
                  onClick={handleDelete}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {isDeletingProject ? t('projects_deleting') : t('projects_delete_confirm_button')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ContactModal
        isOpen={isContactModalOpen}
        initialCategory={CONTACT_CATEGORY_CLIENT}
        onClose={() => setIsContactModalOpen(false)}
        onSuccess={(newContact) => {
          setContacts(prev => [...prev, newContact]);
          setProject(prev => prev ? ({
            ...prev,
            client_id: newContact.id,
            client: newContact.company_name || `${newContact.first_name} ${newContact.last_name}`
          }) : prev);
          fetchContacts();
        }}
      />
    </div>
  );
}
