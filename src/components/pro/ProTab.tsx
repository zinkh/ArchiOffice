import { ProReadOnlyPanel } from './ProReadOnlyPanel';
import { appliquerTitresLots, titresModifies } from '../../lib/lotTitles';
import { ArticleBuildingPanel } from './ArticleBuildingPanel';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CCTPEditor } from './CCTPEditor';
import { DPGFWorkspace } from './DPGFWorkspace';
import { EstimationEditor } from './EstimationEditor';
import { BPUWorkspace } from './BPUWorkspace';
import { LotsManager } from './LotsManager';
import { appliquerOrdreLots, comparerNumerosDeLot, lotsDivergent, planImportLots, type LotProjet } from '../../lib/lotsOrder';
import { PrintPageDecorations } from '../PrintPageDecorations';
import { DPGF, Lot, Chapitre, Ligne, type OffreDocument } from '../../types/dpgf';
import type { BPU, BPURow, OffreBPU } from '../../types/bpu';
import { EMPTY_BPU } from '../../types/bpu';
import { dpgfToBpu, bpuToDpgf, assignerReferences } from '../../lib/bpuConvert';
import { exportBPUtoExcel, exportBPUtoPDF } from '../../lib/bpuExport';
import { OffreImportDialog } from './OffreImportDialog';
import { bpuVersComparatif, dpgfVersComparatif } from '../../lib/bpuToAct';
import { useSettings } from '../../hooks/useSettings';
import {
  IconLayoutColumns, IconX, IconChevronDown, IconLayoutSidebar, IconPrinter,
  IconChecklist, IconCamera, IconHistory,
} from '@tabler/icons-react';
import { PillTabs, PillTabItem } from '../ui/PillTabs';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { AutosaveIndicator } from '../projectDetail/AutosaveIndicator';
import type { AutosaveStatus } from '../../hooks/useProjectAutosave';
import { ProToolbar } from './toolbar/ProToolbar';
import { ProToolbarContext, type ToolbarMenuEntry, type ToolbarRegistration, type ToolbarRegistry } from './toolbar/proToolbar';
import type { ProNotify } from './DPGFWorkspace';
import { useAutosavedDoc, loadProDoc } from '../../hooks/useAutosavedDoc';
import { apiFetch } from '../../lib/api';
import { validateProDocument } from '../../lib/proValidation';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import { useToastWithUndo } from '../../hooks/useToastWithUndo';
import { Toast } from '../ui/Toast';
import { collectLigneIds, collectNouvellesLignes } from './treeOps';
import { VersionsDialog } from './VersionsDialog';

// ── types ─────────────────────────────────────────────────────────────────────

type SubTab = 'LOTS' | 'CCTP' | 'DPGF' | 'ESTIMATION' | 'BPU' | 'DQE';
interface DpgfVersion { id: string; label: string; phase?: string; version?: string; created_at: string }

interface ProTabProps {
  projectId: string;
  projectName?: string;
  /** Rappelé après création/suppression d'un lot, pour que la fiche projet (qui en garde une copie dans `lots_list`) se resynchronise. */
  onLotsChanged?: () => void;
}

const EMPTY_DPGF = (projectId: string): DPGF => ({
  id: 'new',
  projectId,
  titre: 'DPGF',
  version: '1.0',
  dateCreation: new Date().toISOString(),
  statut: 'draft',
  lots: [],
  totalHT: 0,
  TVA: 20,
  totalTTC: 0,
});

// ── Accès au document DPGF ────────────────────────────────────────────────────
// Références stables au niveau du module : passées telles quelles au hook, qui
// les a dans les dépendances de ses effets.

const dpgfLsKey = (projectId: string) => `archioffice_dpgf_${projectId}`;

const loadDPGF = (projectId: string) => loadProDoc<DPGF>(`/api/projects/${projectId}/dpgf`);

const saveDPGF = async (projectId: string, data: DPGF): Promise<void> => {
  await apiFetch(`/api/projects/${projectId}/dpgf`, { method: 'POST', body: JSON.stringify(data) });
};

// ── Accès au document BPU ─────────────────────────────────────────────────────
// La route rend la ligne entière (document + offres reçues), pas seulement le
// document : les offres vivent dans une colonne séparée pour que
// l'autosauvegarde du document ne les efface pas après un import.

const bpuLsKey = (projectId: string) => `archioffice_bpu_${projectId}`;

const loadBpuRow = (projectId: string) => loadProDoc<BPURow>(`/api/projects/${projectId}/bpu`);

const saveBpu = async (projectId: string, document: BPU): Promise<void> => {
  await apiFetch(`/api/projects/${projectId}/bpu`, { method: 'PUT', body: JSON.stringify({ document }) });
};

// ── component ─────────────────────────────────────────────────────────────────

export const ProTab: React.FC<ProTabProps> = ({ projectId, projectName, onLotsChanged }) => {
  const { t } = useTranslation();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('CCTP');
  const [versions, setVersions] = useState<DpgfVersion[] | null>(null);
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  const { toast, showToast } = useToastWithUndo();
  const isMobile = useMediaQuery('(max-width: 767px)');

  // Les actions du document affiché, déclarées par l'atelier (useProToolbar).
  const [toolbar, setToolbar] = useState<ToolbarRegistration | null>(null);
  const toolbarRegistry = useMemo<ToolbarRegistry>(() => ({ register: setToolbar }), []);
  const notify = useCallback<ProNotify>((message, opts) => {
    showToast(message, opts?.type ?? 'success', opts?.action ? { action: opts.action, duration: 6000 } : undefined);
  // showToast change d'identité à chaque rendu mais ne lit que des refs et setState.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── État du formulaire de création d'instantané (remplace window.prompt) ──
  const [snapForm, setSnapForm] = useState<{ label: string; phase: string } | null>(null);

  // Document DPGF partagé par les onglets CCTP, DPGF et ESTIMATION.
  const dpgfDoc = useAutosavedDoc<DPGF>({
    key: projectId, load: loadDPGF, save: saveDPGF, empty: EMPTY_DPGF, lsKey: dpgfLsKey,
  });
  const { doc: dpgf, setDoc: setDpgf, loading: dpgfLoading, saveStatus, saveNow: handleSave } = dpgfDoc;

  // ── État du rapport de contrôle (remplace window.alert) ──────────────────
  const [controleReport, setControleReport] = useState<{ errors: number; warnings: number; lines: string[] } | null>(null);

  const controlerDossier = useCallback(() => {
    if (!dpgf) return;
    const issues = validateProDocument(dpgf);
    if (!issues.length) {
      showToast(t('pro_control_toast_ok'), 'success');
      return;
    }
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    setControleReport({
      errors: errors.length,
      warnings: warnings.length,
      lines: [
        ...issues.slice(0, 40).map(i => `${i.severity === 'error' ? '⛔' : '⚠'} ${i.message}`),
        ...(issues.length > 40 ? [`… et ${issues.length - 40} autre(s).`] : []),
      ],
    });
  }, [dpgf, showToast]);

  const creerInstantane = useCallback(async () => {
    if (!dpgf) return;
    // Ouvre le formulaire inline (remplace les deux window.prompt)
    setSnapForm({ label: `${dpgf.version || '1.0'} — ${dpgf.titre}`, phase: '' });
  }, [dpgf]);

  const validerInstantane = useCallback(async (label: string, phase: string) => {
    if (!label.trim() || !dpgf) return;
    setSnapForm(null);
    try {
      // Flush avant de figer : si la sauvegarde échoue, on abandonne.
      await handleSave();
      if (saveStatus === 'error') {
        showToast(t('pro_snap_toast_saved_error'), 'error');
        return;
      }
      await apiFetch(`/api/projects/${projectId}/dpgf/versions`, {
        method: 'POST',
        body: JSON.stringify({ label: label.trim(), phase: phase.trim() || null, version: dpgf.version }),
      });
      showToast(t('pro_snap_toast_frozen', { label: label.trim() }), 'success');
    } catch (e: any) {
      showToast(t('pro_snap_toast_error', { message: e?.message ?? t('pro_snap_toast_network_error') }), 'error');
    }
  }, [dpgf, handleSave, saveStatus, projectId, showToast]);

  const ouvrirVersions = useCallback(async () => {
    setVersions(await apiFetch<DpgfVersion[]>(`/api/projects/${projectId}/dpgf/versions`));
  }, [projectId]);

  // Offres reçues sur le DPGF. Chargées à part du document lui-même (route
  // dédiée, cf. server/routes/dpgf.ts) : GET /api/projects/:id/dpgf ne rend
  // que le document, exactement comme avant cette fonctionnalité — useDPGF.ts
  // en dépend et n'a aucune raison de changer de forme pour ça.
  const [dpgfOffres, setDpgfOffres] = useState<OffreDocument[]>([]);
  useEffect(() => {
    let annule = false;
    apiFetch<OffreDocument[]>(`/api/projects/${projectId}/dpgf/offres`)
      .then(rows => { if (!annule) setDpgfOffres(rows); })
      .catch(() => { /* pas encore de DPGF, ou hors ligne : liste vide */ });
    return () => { annule = true; };
  }, [projectId]);

  // Vue divisée (DPGF / ESTIMATION)
  const [splitView, setSplitView] = useState(false);
  const [rightProjectId, setRightProjectId] = useState<string>(projectId);

  // Le panneau droit passe par le même hook : il gagne au passage
  // l'autosauvegarde qu'il n'avait pas, seul un bouton manuel le sauvegardait.
  const [rightDpgf, setRightDpgf] = useState<DPGF | null>(null);
  const [rightLoading, setRightLoading] = useState(false);
  useEffect(() => {
    if (!splitView || rightProjectId === projectId) return;
    let cancelled = false;
    setRightLoading(true); setRightDpgf(null);
    loadDPGF(rightProjectId).then(doc => { if (!cancelled) setRightDpgf(doc ?? EMPTY_DPGF(rightProjectId)); })
      .catch(() => { if (!cancelled) setRightDpgf(null); })
      .finally(() => { if (!cancelled) setRightLoading(false); });
    return () => { cancelled = true; };
  }, [splitView, rightProjectId, projectId]);

  // ── Document BPU ────────────────────────────────────────────────────────────
  // Chargé seulement une fois l'un des onglets BPU ou DQE ouvert, et gardé
  // actif ensuite : sans ce verrou, tout projet forfaitaire paierait un appel
  // réseau inutile à chaque ouverture de l'espace PRO.
  const [bpuTouched, setBpuTouched] = useState(false);
  const [offres, setOffres] = useState<OffreBPU[]>([]);

  const bpuDoc = useAutosavedDoc<BPU>({
    key: projectId,
    load: useCallback(async (id: string) => {
      const row = await loadBpuRow(id);
      // Les offres voyagent avec la ligne mais ne font pas partie du document
      // que l'éditeur réécrit : on les met de côté ici.
      setOffres(row?.offres ?? []);
      return row?.document && Object.keys(row.document).length ? row.document : null;
    }, []),
    save: saveBpu, empty: EMPTY_BPU, lsKey: bpuLsKey,
    enabled: bpuTouched,
  });
  const { doc: bpu, setDoc: setBpu, loading: bpuLoading, saveStatus: bpuSaveStatus, saveNow: handleBpuSave } = bpuDoc;

  const isBpuTab = activeSubTab === 'BPU' || activeSubTab === 'DQE';

  // La liste des lots du projet fait foi : son ordre et ses numéros sont
  // reportés sur le DPGF (donc le CCTP, même document) et sur le bordereau.
  // Lots du projet : source de vérité, lus avant tout alignement.
  const [projectLots, setProjectLots] = useState<LotProjet[]>([]);
  const [projectLotsLoaded, setProjectLotsLoaded] = useState(false);
  useEffect(() => {
    let annule = false;
    setProjectLotsLoaded(false);
    apiFetch<any[]>(`/api/projects/${projectId}/lots`)
      .then(rows => {
        if (annule) return;
        setProjectLots((rows ?? [])
          .map(r => ({ id: r.id, lot_number: r.lot_number, lot_title: r.lot_title }))
          .sort((a, b) => comparerNumerosDeLot(a.lot_number, b.lot_number)));
        setProjectLotsLoaded(true);
      })
      .catch(() => { if (!annule) setProjectLotsLoaded(true); });
    return () => { annule = true; };
  }, [projectId]);

  // Le document et la liste des lots divergent (CCTP rédigé avant la liste, par
  // exemple) : rien n'est modifié en silence, l'architecte choisit le sens.
  const divergence = projectLotsLoaded && !dpgfLoading && lotsDivergent(dpgf, projectLots);
  const [lotsVersion, setLotsVersion] = useState(0);

  const [titleError, setTitleError] = useState('');
  const [renaming, setRenaming] = useState(0);
  const currentTitles = useRef({ dpgf, bpu, projectLots, projectId });
  currentTitles.current = { dpgf, bpu, projectLots, projectId };
  const titleQueue = useRef(Promise.resolve());
  const renameLot = (id: string, title: string): Promise<void> => {
    const titre = title.trim();
    if (!titre) { setTitleError('Le titre du lot ne peut pas être vide.'); return Promise.reject(new Error('Le titre du lot ne peut pas être vide.')); }
    setRenaming(n => n + 1); setTitleError('');
    const operation = titleQueue.current.catch(() => {}).then(async () => {
      await apiFetch(`/api/lots/${id}`, { method: 'PUT', body: JSON.stringify({ lot_title: titre }) });
      const current = currentTitles.current;
      if (current.projectId !== projectId) return;
      const lots = current.projectLots.map(l => l.id === id ? { ...l, lot_title: titre } : l);
      setProjectLots(lots);
      const nextDpgf = current.dpgf && appliquerTitresLots(current.dpgf, lots);
      const nextBpu = current.bpu && appliquerTitresLots(current.bpu, lots);
      if (nextDpgf) setDpgf(nextDpgf);
      if (nextBpu) setBpu(nextBpu);
      currentTitles.current = { ...current, projectLots: lots, dpgf: nextDpgf, bpu: nextBpu };
      setLotsVersion(v => v + 1); onLotsChanged?.();
    }).catch(e => {
      if (currentTitles.current.projectId === projectId) setTitleError(e instanceof Error ? e.message : 'Échec de la synchronisation des titres.');
      throw e;
    }).finally(() => setRenaming(n => Math.max(0, n - 1)));
    titleQueue.current = operation;
    return operation;
  };
  const editDpgf = (next: DPGF) => {
    const beforeIds = new Set<string>();
    collectLigneIds(dpgf, beforeIds);
    const added = collectNouvellesLignes(next, beforeIds);
    if (added.length) void apiFetch('/api/price-library/bulk', {
      method: 'POST',
      body: JSON.stringify({ items: added.map(x => ({ code: x.numero, designation: x.designation, unite: x.unite, prix_unitaire: x.prixUnitaire, source: `projet:${projectId}` })) }),
    }).catch(() => {});
    const changes = dpgf ? titresModifies(dpgf, next) : [];
    setDpgf(next);
    if (!changes.length) return;
    for (const change of changes) void renameLot(change.id, change.titre).catch(() => {});
  };
  const editBpu = (next: BPU) => {
    const beforeIds = new Set<string>();
    collectLigneIds(bpu, beforeIds);
    const added = collectNouvellesLignes(next, beforeIds);
    if (added.length) void apiFetch('/api/price-library/bulk', {
      method: 'POST',
      body: JSON.stringify({ items: added.map(x => ({ code: x.numero, designation: x.designation, unite: x.unite, prix_unitaire: x.prixUnitaire, source: `projet:${projectId}` })) }),
    }).catch(() => {});
    const changes = bpu ? titresModifies(bpu, next) : [];
    setBpu(next);
    if (!changes.length) return;
    for (const change of changes) void renameLot(change.id, change.titre).catch(() => {});
  };

  const displayedRightDpgf = rightProjectId === projectId ? dpgf : rightDpgf;
  const displayedRightLoading = rightProjectId === projectId ? dpgfLoading : rightLoading;

  // Sans lot au projet, les documents ne sont pas touchés : une liste vide
  // ne doit pas vider un CCTP déjà rédigé.
  const synchroniserLots = useCallback((lotsProjet: LotProjet[]) => {
    setProjectLots(lotsProjet);
    if (lotsProjet.length) {
      if (dpgf) setDpgf(lotsDivergent(dpgf, lotsProjet) ? appliquerTitresLots(dpgf, lotsProjet) : appliquerOrdreLots(dpgf, lotsProjet));
      if (bpuTouched && bpu) setBpu(lotsDivergent(bpu, lotsProjet) ? appliquerTitresLots(bpu, lotsProjet) : appliquerOrdreLots(bpu, lotsProjet));
    }
    onLotsChanged?.();
  }, [dpgf, setDpgf, bpuTouched, bpu, setBpu, onLotsChanged]);

  // À l'ouverture, un document dont les lots sont tous rattachés à la liste
  // (ou sans lot) est aligné une seule fois : numéros et intitulés identiques.
  const lotsAlignesPour = useRef<string | null>(null);
  useEffect(() => {
    if (dpgfLoading || !dpgf || !projectLotsLoaded) return;
    if (lotsAlignesPour.current === projectId) return;
    lotsAlignesPour.current = projectId;
    if (projectLots.length && !lotsDivergent(dpgf, projectLots)) setDpgf(appliquerOrdreLots(dpgf, projectLots));
  }, [dpgfLoading, dpgf, projectLotsLoaded, projectLots, projectId, setDpgf]);
  useEffect(() => { lotsAlignesPour.current = null; }, [projectId]);

  /** Sens document → liste : la liste des lots reprend numéros et intitulés du CCTP/DPGF. */
  const importerLotsDuDocument = useCallback(async () => {
    if (!dpgf) return;
    const plan = planImportLots(dpgf, projectLots);
    try {
      const rattachement = new Map<string, string>();
      for (const l of plan) {
        if (l.projectLotId) {
          await apiFetch(`/api/lots/${l.projectLotId}`, { method: 'PUT', body: JSON.stringify({ lot_number: l.numero, lot_title: l.titre }) });
          rattachement.set(l.lotDocId, l.projectLotId);
        } else {
          const { id } = await apiFetch<{ id: string }>(`/api/projects/${projectId}/lots`, { method: 'POST', body: JSON.stringify({ lot_number: l.numero, lot_title: l.titre }) });
          rattachement.set(l.lotDocId, id);
        }
      }
      const rows = await apiFetch<any[]>(`/api/projects/${projectId}/lots`);
      const lotsProjet = (rows ?? [])
        .map(r => ({ id: r.id, lot_number: r.lot_number, lot_title: r.lot_title }))
        .sort((a, b) => comparerNumerosDeLot(a.lot_number, b.lot_number));
      const lie = { ...dpgf, lots: dpgf.lots.map(l => ({ ...l, projectLotId: rattachement.get(l.id) ?? l.projectLotId })) };
      setProjectLots(lotsProjet);
      setDpgf(appliquerOrdreLots(lie, lotsProjet));
      if (bpuTouched && bpu && !lotsDivergent(bpu, lotsProjet)) setBpu(appliquerOrdreLots(bpu, lotsProjet));
      setLotsVersion(v => v + 1);
      onLotsChanged?.();
    } catch (e: any) {
      showToast(`Import des lots impossible : ${e?.message ?? String(e)}`, 'error');
    }
  }, [dpgf, projectLots, projectId, setDpgf, bpuTouched, bpu, setBpu, onLotsChanged, showToast]);

  /** Sens liste → document : le document reprend exactement la liste (lots hors liste retirés après confirmation). */
  const alignerDocumentSurListe = useCallback(async () => {
    if (!dpgf) return;
    const apres = appliquerOrdreLots(dpgf, projectLots, { rapprocher: true, retirerHorsProjet: true });
    const perdus = dpgf.lots.length - apres.lots.filter(l => dpgf.lots.some(x => x.id === l.id)).length;
    const avecContenu = dpgf.lots.filter(l => !apres.lots.some(x => x.id === l.id) && (l.chapitres ?? []).some(c => c.lignes?.length || (c.cctpDescription ?? '').trim()));
    const detail = avecContenu.length
      ? `, dont ${avecContenu.length} avec du contenu (${avecContenu.map(l => `${l.numero} ${l.titre}`).slice(0, 5).join(' ; ')}).`
      : '.';
    const confirmed = await confirmAction({
      title: 'Aligner le CCTP/DPGF sur la liste des lots ?',
      message: `${perdus} lot(s) absent(s) de la liste seront retirés${detail}`,
      confirmLabel: 'Aligner',
      cancelLabel: 'Annuler',
      tone: perdus > 0 ? 'danger' : 'primary',
    });
    if (!confirmed) return;
    setDpgf(apres);
    if (bpuTouched && bpu) setBpu(appliquerOrdreLots(bpu, projectLots, { rapprocher: true, retirerHorsProjet: true }));
  }, [dpgf, projectLots, setDpgf, bpuTouched, bpu, setBpu, confirmAction]);

  // Le bordereau, chargé plus tard, est aligné de la même façon à son ouverture.
  const bpuAligne = useRef<string | null>(null);
  useEffect(() => {
    if (!bpuTouched || bpuLoading || !bpu || !projectLotsLoaded) return;
    if (bpuAligne.current === projectId) return;
    bpuAligne.current = projectId;
    if (projectLots.length && bpu.lots.length && !lotsDivergent(bpu, projectLots)) setBpu(appliquerOrdreLots(bpu, projectLots));
  }, [bpuTouched, bpuLoading, bpu, projectLotsLoaded, projectLots, projectId, setBpu]);
  useEffect(() => { bpuAligne.current = null; }, [projectId]);
  useEffect(() => { if (isBpuTab) setBpuTouched(true); }, [isBpuTab]);

  // Initialise le bordereau depuis le DPGF, en préservant tout ce qui a déjà
  // été saisi côté BPU — l'action doit pouvoir être relancée sans dégât.
  const initBpuFromDpgf = useCallback(() => {
    if (!dpgf) return;
    setBpu(assignerReferences(dpgfToBpu(dpgf, bpu)));
  }, [dpgf, bpu, setBpu]);

  // Reverser un DQE dans le DPGF écrase des prix : on montre les écarts avant.
  const pushBpuToDpgf = useCallback(async () => {
    if (!bpu || !dpgf) return;
    const { dpgf: next, diff } = bpuToDpgf(bpu, dpgf);
    const messageLines = [
      t('pro_tab_bpu_revert_modified_count', { count: diff.modifies.length }),
      diff.nonChiffres.length ? t('pro_tab_bpu_revert_not_priced_count', { count: diff.nonChiffres.length }) : '',
      diff.absentsDuDpgf.length ? t('pro_tab_bpu_revert_absent_count', { count: diff.absentsDuDpgf.length }) : '',
      ...diff.modifies.slice(0, 12).map(m => `${m.numero} ${m.designation} : ${m.ancien} → ${m.nouveau} €`),
      diff.modifies.length > 12 ? t('pro_tab_bpu_revert_more_count', { count: diff.modifies.length - 12 }) : '',
    ].filter(Boolean);
    const confirmed = await confirmAction({
      title: t('pro_tab_bpu_revert_confirm'),
      message: (
        <ul className="mt-1 space-y-0.5 text-xs font-mono">
          {messageLines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      ),
      confirmLabel: 'Reverser dans le DPGF',
      cancelLabel: 'Annuler',
      tone: 'danger',
    });
    if (confirmed) setDpgf(next);
  }, [bpu, dpgf, setDpgf, t, confirmAction]);

  // Les exports portent la charte du cabinet : en-tête avec logo et
  // coordonnées, pied de page adresse et SIRET, pagination « P1|2 ».
  const { settings } = useSettings();

  /**
   * Un bordereau part chez les entreprises avec sa colonne « Réf. » : ce sont
   * ces références qui permettront de rapprocher le fichier renvoyé. On les
   * attribue donc avant d'exporter, et on les persiste.
   */
  const exporterBpu = useCallback(async (kind: 'pdf' | 'xlsx', colSet: string, vierge: boolean) => {
    if (!bpu) return;
    const avecRefs = assignerReferences(bpu);
    if (avecRefs !== bpu) setBpu(avecRefs);
    const mode = colSet === 'bpu' ? 'bpu' : 'dqe';
    if (kind === 'xlsx') {
      await exportBPUtoExcel(avecRefs, { mode, vierge, projectName, settings: settings ?? {} });
    } else {
      await exportBPUtoPDF(avecRefs, { mode, projectName, settings: settings ?? {}, vierge });
    }
  }, [bpu, setBpu, projectName, settings]);

  /** Envoie les articles sélectionnés vers la bibliothèque de prix du cabinet. */
  const envoyerVersBibliotheque = useCallback(async (lignes: any[]) => {
    if (!lignes.length) return;
    try {
      const res = await apiFetch<{ created: number; updated: number; prixRemontes?: number }>('/api/price-library/bulk', {
        method: 'POST',
        body: JSON.stringify({
          items: lignes.map(l => ({
            code: l.numero, designation: l.designation, unite: l.unite,
            prix_unitaire: l.prixUnitaire, source: `projet:${projectId}`,
          })),
        }),
      });
      const historique = res.prixRemontes
        ? t('pro_tab_library_history_suffix', { count: res.prixRemontes })
        : '';
      showToast(t('pro_tab_library_updated', { created: res.created, updated: res.updated, historique }), 'success');
    } catch (e: any) {
      showToast(t('pro_tab_library_send_failed', { error: e?.message ?? t('pro_tab_unknown_error') }), 'error');
    }
  }, [projectId, t, showToast]);

  // ── Offres reçues des entreprises ───────────────────────────────────────────
  // Un seul dialogue sert les deux documents (OffreImportDialog) ; ce
  // discriminant dit dans lequel des deux on est en train d'importer.
  const [importCible, setImportCible] = useState<'dpgf' | 'bpu' | null>(null);

  /**
   * Les offres vivent dans une colonne séparée du document et passent par leur
   * propre endpoint : logées dans le document, elles seraient effacées par la
   * première autosauvegarde suivant l'import.
   */
  const enregistrerOffre = useCallback(async (offre: any) => {
    const saved = await apiFetch<OffreBPU & { prixRemontes?: number }>(
      `/api/projects/${projectId}/bpu/offres`,
      { method: 'POST', body: JSON.stringify({ offre }) },
    );
    setOffres(prev => [...prev, saved]);
    // Le serveur verse au passage les prix de l'offre dans la bibliothèque,
    // pour les articles qui en viennent. On le dit, sinon l'enrichissement se
    // fait dans le dos de l'architecte et il ne pensera pas à aller le lire.
    if (saved.prixRemontes) {
      showToast(t('pro_tab_offer_prices_added', { count: saved.prixRemontes }), 'success');
    }
  }, [projectId, t, showToast]);

  /** Même chose côté DPGF, sur sa propre route et son propre état d'offres. */
  const enregistrerOffreDpgf = useCallback(async (offre: any) => {
    const saved = await apiFetch<OffreDocument & { prixRemontes?: number }>(
      `/api/projects/${projectId}/dpgf/offres`,
      { method: 'POST', body: JSON.stringify({ offre }) },
    );
    setDpgfOffres(prev => [...prev, saved]);
    if (saved.prixRemontes) {
      showToast(t('pro_tab_offer_prices_added', { count: saved.prixRemontes }), 'success');
    }
  }, [projectId, t, showToast]);

  /**
   * Verse un résultat de versComparatif (DPGF ou BPU) dans le comparatif
   * détaillé du module ACT, qui sait déjà comparer, noter et en tirer un RAO.
   * À la demande seulement : ce comparatif est éditable, une synchronisation
   * automatique se battrait contre l'architecte.
   */
  const verserComparatif = useCallback(async (
    resultat: { comparatif: any[]; lotsNonRattaches: { numero: string; titre: string }[] },
    docLabel: string,
  ) => {
    const { comparatif, lotsNonRattaches } = resultat;
    if (lotsNonRattaches.length) {
      const confirmed = await confirmAction({
        title: `Lots non rattachés dans le ${docLabel}`,
        message: (
          <>
            <p>{t('pro_tab_lots_not_linked_confirm', { docLabel, liste: '' })}</p>
            <ul className="mt-2 space-y-0.5 text-xs font-mono">
              {lotsNonRattaches.map(l => <li key={l.numero}>{l.numero} {l.titre}</li>)}
            </ul>
          </>
        ),
        confirmLabel: 'Continuer quand même',
        cancelLabel: 'Annuler',
        tone: 'primary',
      });
      if (!confirmed) return;
    }
    if (!comparatif.length) {
      showToast(t('pro_tab_no_lots_linked', { docLabel }), 'error');
      return;
    }
    try {
      const act = await apiFetch<any>(`/api/projects/${projectId}/act`);
      const consultation = { ...(act?.consultation ?? {}), comparatif };
      await apiFetch(`/api/projects/${projectId}/act`, {
        method: 'PUT',
        body: JSON.stringify({ ...(act ?? {}), consultation }),
      });
      showToast(t('pro_tab_comparatif_updated', { count: comparatif.length }), 'success');
    } catch (e: any) {
      showToast(t('pro_tab_comparatif_send_failed', { error: e?.message ?? t('pro_tab_unknown_error') }), 'error');
    }
  }, [projectId, t, confirmAction, showToast]);

  const verserAuComparatifAct = useCallback(async () => {
    if (!bpu) return;
    await verserComparatif(bpuVersComparatif(bpu, offres), 'bordereau');
  }, [bpu, offres, verserComparatif]);

  const verserAuComparatifActDpgf = useCallback(async () => {
    if (!dpgf) return;
    await verserComparatif(dpgfVersComparatif(dpgf, dpgfOffres), 'DPGF');
  }, [dpgf, dpgfOffres, verserComparatif]);

  // Cross-panel DnD : la ligne draguée depuis le panneau droit est déposée dans
  // le panneau gauche (DPGFWorkspace) via onDropExternal.
  const [draggedLigne, setDraggedLigne] = useState<Ligne | null>(null);
  const handleDropExternal = useCallback((ligne: Ligne) => {
    setDraggedLigne(null);
    if (!dpgf) return;
    const lots = dpgf.lots;
    if (!lots.length) return;
    const lastLot = lots[lots.length - 1];
    const chaps = lastLot.chapitres;
    if (!chaps.length) return;
    const lastChap = chaps[chaps.length - 1];
    const newLigne = { ...ligne, id: `ext_${Date.now()}` };
    const nextChap = { ...lastChap, lignes: [...(lastChap.lignes ?? []), newLigne] };
    const nextLot = { ...lastLot, chapitres: chaps.map((c: Chapitre, i: number) => i === chaps.length - 1 ? nextChap : c) };
    editDpgf({ ...dpgf, lots: lots.map((l: Lot, i: number) => i === lots.length - 1 ? nextLot : l) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpgf]);

  // Cross-panel DnD pour CCTPEditor : même logique que handleDropExternal mais
  // la ligne est ajoutée au dernier chapitre du dernier lot du DPGF (CCTP).
  const handleDropExternalCctp = useCallback((ligne: Ligne) => {
    setDraggedLigne(null);
    if (!dpgf) return;
    const lots = dpgf.lots;
    if (!lots.length) return;
    const lastLot = lots[lots.length - 1];
    const chaps = lastLot.chapitres;
    if (!chaps.length) return;
    const lastChap = chaps[chaps.length - 1];
    const newLigne = { ...ligne, id: `ext_cctp_${Date.now()}` };
    const nextChap = { ...lastChap, lignes: [...(lastChap.lignes ?? []), newLigne] };
    const nextLot = { ...lastLot, chapitres: chaps.map((c: Chapitre, i: number) => i === chaps.length - 1 ? nextChap : c) };
    editDpgf({ ...dpgf, lots: lots.map((l: Lot, i: number) => i === lots.length - 1 ? nextLot : l) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpgf]);

  // Shared tree panel state for DPGF / ESTIMATION
  const [showTree, setShowTree] = useState(true);
  const toggleTree = () => setShowTree(v => !v);

  // ── Browser print with page isolation ───────────────────────────────────────
  const handlePrint = useCallback(() => {
    document.body.classList.add('printing-pro');
    window.print();
  }, []);

  useEffect(() => {
    const cleanup = () => document.body.classList.remove('printing-pro');
    window.addEventListener('afterprint', cleanup);
    return () => window.removeEventListener('afterprint', cleanup);
  }, []);

  // ── Tab labels ───────────────────────────────────────────────────────────────
  // Casse normale ; les sigles gardent leurs capitales et leur nom complet en infobulle.
  const TABS: PillTabItem[] = [
    { id: 'LOTS', label: t('pro_tab_lots') },
    { id: 'CCTP', label: 'CCTP', title: t('pro_tab_cctp_title') },
    { id: 'DPGF', label: 'DPGF', title: t('pro_tab_dpgf_title') },
    { id: 'ESTIMATION', label: t('pro_tab_estimation') },
    { id: 'BPU', label: 'BPU', title: t('pro_tab_bpu_title') },
    { id: 'DQE', label: 'DQE', title: t('pro_tab_dqe_title') },
  ];

  const canSplit = activeSubTab === 'CCTP' || activeSubTab === 'DPGF' || activeSubTab === 'ESTIMATION';

  // Un seul indicateur, toujours celui du document à l'écran. Le hook revient
  // à « idle » deux secondes après un enregistrement : un document chargé et
  // sans modification en attente est enregistré, on le dit.
  const activeSaveStatus = isBpuTab ? bpuSaveStatus : saveStatus;
  const activeLoaded = isBpuTab ? !bpuLoading && !!bpu : !dpgfLoading && !!dpgf;
  const indicatorStatus: AutosaveStatus = activeSubTab === 'LOTS' || !activeLoaded ? 'idle'
    : activeSaveStatus === 'idle' ? 'saved' : activeSaveStatus;
  const saveActive = isBpuTab ? handleBpuSave : handleSave;

  // Ctrl+S (⌘+S) enregistre tout de suite le document à l'écran.
  const saveActiveRef = useRef<(() => Promise<void>) | null>(null);
  saveActiveRef.current = activeSubTab === 'LOTS' ? null : saveActive;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      if (!saveActiveRef.current) return;
      e.preventDefault();
      void saveActiveRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Menu « ⋯ » : ce qui concerne le dossier PRO plutôt que le document.
  const hasTree = activeSubTab !== 'LOTS';
  const dossierEntries: ToolbarMenuEntry[] = [
    ...(!isBpuTab && activeSubTab !== 'LOTS' ? [
      { id: 'pro-check', label: t('pro_dossier_check'), icon: <IconChecklist size={16} />, onClick: controlerDossier, disabled: !dpgf },
      { id: 'pro-freeze', label: t('pro_dossier_freeze'), icon: <IconCamera size={16} />, onClick: () => { void creerInstantane(); }, disabled: !dpgf },
      { id: 'pro-history', label: t('pro_dossier_history'), icon: <IconHistory size={16} />, onClick: () => { void ouvrirVersions(); } },
    ] : []),
    ...(canSplit ? [{ id: 'pro-compare', label: t('pro_dossier_compare'), icon: <IconLayoutColumns size={16} />, onClick: () => setSplitView(v => !v), checked: splitView }] : []),
    ...(hasTree && !isMobile ? [{ id: 'pro-tree', label: t('pro_dossier_show_structure'), icon: <IconLayoutSidebar size={16} />, onClick: toggleTree, checked: showTree }] : []),
    { id: 'pro-print-sep', separator: true as const },
    { id: 'pro-print', label: t('pro_dossier_print'), icon: <IconPrinter size={16} />, onClick: handlePrint },
  ];
  const activeVersion = (isBpuTab ? bpu?.version : dpgf?.version) ?? '1.0';

  const PRINT_TITLES: Record<SubTab, string> = {
    LOTS:       'Lots de travaux',
    CCTP:       'CCTP — Cahier des Clauses Techniques Particulières',
    DPGF:       'DPGF — Décomposition du Prix Global et Forfaitaire',
    ESTIMATION: 'Estimation Prévisionnelle',
    BPU:        'BPU — Bordereau de Prix Unitaires',
    DQE:        'DQE — Détail Quantitatif Estimatif',
  };

  return (
    <ProToolbarContext.Provider value={toolbarRegistry}>
    <div id="printable-pro" className="flex flex-col" style={{ height: 'calc(100dvh - 200px)', minHeight: 500 }}>

      {/* Print decorations — invisible on screen, fixed header/footer + QR when printing */}
      {(dpgf || bpu) && (
        <PrintPageDecorations
          title={PRINT_TITLES[activeSubTab]}
          subtitle={projectName}
          reference={`v${activeVersion}`}
          projectUrl={`${window.location.origin}/projects/${projectId}`}
        />
      )}

      {/* ── Sous-onglets, état d'enregistrement, actions du document ─────────── */}
      <div
        className="no-print flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 shrink-0"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
      >
        <PillTabs tabs={TABS} activeId={activeSubTab} onChange={id => setActiveSubTab(id as SubTab)} ariaLabel={t('pro_tabs_label')} className="max-md:w-full" />
        <AutosaveIndicator status={indicatorStatus} onRetry={() => { void saveActive(); }} />
        <div className="ml-auto min-w-0">
          <ProToolbar
            items={activeSubTab === 'LOTS' ? [] : toolbar?.source.current ?? []}
            resolve={() => toolbar?.source.current ?? []}
            dossierEntries={dossierEntries}
            dossierLabel={t('pro_dossier_menu')}
            isMobile={isMobile}
          />
        </div>
      </div>

      {renaming > 0 && <p role="status" className="px-3 text-sm">Synchronisation des titres de lots…</p>}
      {titleError && <p role="alert" className="px-3 text-sm text-red-600">{titleError} Le titre n’a pas été enregistré ; réessayez le renommage.</p>}
      {!isBpuTab && dpgf && <ArticleBuildingPanel dpgf={dpgf} onChange={editDpgf} projectName={projectName} />}
      <VersionsDialog
        versions={versions}
        onClose={() => setVersions(null)}
        confirmAction={confirmAction}
        onRestore={async (v) => {
          const restored = await apiFetch<DPGF>(`/api/projects/${projectId}/dpgf/versions/${v.id}/restore`, { method: 'POST' });
          setDpgf(restored);
          setVersions(null);
          showToast(t('pro_versions_toast_restored', { label: v.label }), 'success');
        }}
      />

      {/* ── Formulaire de création d'instantané (remplace window.prompt) ─── */}
      {snapForm && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) setSnapForm(null); }}
        >
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-zinc-900 shadow-2xl p-6">
            <h3 className="font-semibold mb-4">{t('pro_snap_title')}</h3>
            <label className="block text-sm font-medium mb-1">{t('pro_snap_label')}</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
              value={snapForm.label}
              onChange={e => setSnapForm(f => f && ({ ...f, label: e.target.value }))}
              placeholder={t('pro_snap_label_placeholder')}
              autoFocus
            />
            <label className="block text-sm font-medium mb-1">{t('pro_snap_phase')}</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-5"
              style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
              value={snapForm.phase}
              onChange={e => setSnapForm(f => f && ({ ...f, phase: e.target.value }))}
              placeholder={t('pro_snap_phase_placeholder')}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSnapForm(null)}
                className="h-9 px-4 rounded-lg text-sm border"
                style={{ borderColor: 'var(--tblr-border)' }}
              >
                {t('pro_snap_cancel')}
              </button>
              <button
                onClick={() => void validerInstantane(snapForm.label, snapForm.phase)}
                disabled={!snapForm.label.trim()}
                className="h-9 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: 'var(--tblr-primary)' }}
              >
                {t('pro_snap_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rapport de contrôle (remplace window.alert) ─────────────────── */}
      {controleReport && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) setControleReport(null); }}
        >
          <div className="w-full max-w-2xl max-h-[80dvh] overflow-auto rounded-xl bg-white dark:bg-zinc-900 shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <h3 className="font-semibold">{t('pro_control_title')}</h3>
                <p className="text-xs text-zinc-500">
                  {controleReport.errors > 0 && <span className="text-red-600 mr-2">⛔ {t('pro_control_errors', { count: controleReport.errors })}</span>}
                  {controleReport.warnings > 0 && <span className="text-amber-600">⚠ {t('pro_control_warnings', { count: controleReport.warnings })}</span>}
                </p>
              </div>
              <button
                onClick={() => setControleReport(null)}
                aria-label={t('pro_control_close')}
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <IconX size={18} />
              </button>
            </div>
            <ul className="divide-y">
              {controleReport.lines.map((line, i) => (
                <li key={i} className="px-4 py-2 text-sm font-mono">{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Toast global ────────────────────────────────────────────────── */}
      <Toast toast={toast} />
      {/* ── Confirm dialog global ───────────────────────────────────────── */}
      {confirmDialog}

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {divergence && !isBpuTab && (
        <div className="px-4 py-2 flex flex-wrap items-center gap-3 text-sm border-b" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
          <span className="flex-1 min-w-[16rem]">
            Les lots du CCTP/DPGF ne correspondent pas à la liste des lots du projet (numéros et intitulés doivent être identiques partout).
          </span>
          <button type="button" className="btn btn-sm" onClick={() => void importerLotsDuDocument()}>
            Remplir la liste des lots depuis le CCTP
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void alignerDocumentSurListe()}>
            Aligner le CCTP sur la liste
          </button>
        </div>
      )}
      <div className="flex-1 overflow-hidden flex">

        {/* LOTS */}
        {activeSubTab === 'LOTS' && (
          <div className="flex-1 overflow-y-auto px-4">
            <LotsManager key={lotsVersion} projectId={projectId} onChange={synchroniserLots} onRename={renameLot} />
          </div>
        )}

        {/* CCTP */}
        {activeSubTab === 'CCTP' && (
          <>
          <div className={`flex flex-col overflow-hidden ${splitView ? 'w-1/2 border-r border-[var(--tblr-border)]' : 'flex-1'}`}>
            {dpgfLoading ? (
              <div className="flex items-center gap-2 p-8 text-[var(--tblr-muted)]">
                <div className="w-4 h-4 border-2 border-[var(--tblr-primary)] border-t-transparent rounded-full animate-spin" />
                Chargement…
              </div>
            ) : dpgf ? (
              <CCTPEditor dpgf={dpgf} onChange={editDpgf} showTree={showTree} onToggleTree={toggleTree} onDropExternal={draggedLigne ? handleDropExternalCctp : undefined} />
            ) : null}
          </div>
          {splitView && (
            <div className="w-1/2 flex flex-col overflow-hidden">
              <RightPanelHeader projectId={rightProjectId} currentProjectId={projectId} onChange={setRightProjectId} onClose={() => setSplitView(false)} />
              {displayedRightLoading ? <div className="flex items-center justify-center flex-1 text-[var(--tblr-muted)]">Chargement…</div> : displayedRightDpgf ? <ProReadOnlyPanel dpgf={displayedRightDpgf} cctp onDragStart={ligne => setDraggedLigne(ligne)} /> : null}
            </div>
          )}
          </>
        )}

        {/* DPGF */}
        {activeSubTab === 'DPGF' && (
          <>
            {/* Left panel */}
            <div className={`flex flex-col overflow-hidden ${splitView ? 'w-1/2 border-r border-[var(--tblr-border)]' : 'flex-1'}`}>
              {dpgfLoading ? (
                <div className="flex items-center justify-center h-full text-[var(--tblr-muted)]">Chargement du DPGF…</div>
              ) : dpgf ? (
                <DPGFWorkspace
                  dpgf={dpgf}
                  onChange={editDpgf}
                  notify={notify}
                  projectName={projectName}
                  showTree={showTree}
                  onToggleTree={toggleTree}
                  onImportOffre={() => setImportCible('dpgf')}
                  onPushToAct={dpgf.lots.length > 0 ? verserAuComparatifActDpgf : undefined}
                  offres={dpgfOffres}
                  onDragStart={ligne => setDraggedLigne(ligne)}
                  onDropExternal={draggedLigne ? handleDropExternal : undefined}
                />
              ) : null}
            </div>

            {/* Right panel (split view) */}
            {splitView && (
              <div className="w-1/2 flex flex-col overflow-hidden">
                <RightPanelHeader
                  projectId={rightProjectId}
                  currentProjectId={projectId}
                  onChange={setRightProjectId}
                  onClose={() => setSplitView(false)}
                />
                {displayedRightLoading ? (
                  <div className="flex items-center justify-center flex-1 text-[var(--tblr-muted)]">Chargement…</div>
                ) : displayedRightDpgf ? (
                  <ProReadOnlyPanel dpgf={displayedRightDpgf} onDragStart={ligne => setDraggedLigne(ligne)} />
                ) : null}
              </div>
            )}
          </>
        )}

        {/* ESTIMATION */}
        {activeSubTab === 'ESTIMATION' && (
          <>
            {/* Left panel */}
            <div className={`flex flex-col overflow-hidden ${splitView ? 'w-1/2 border-r border-[var(--tblr-border)]' : 'flex-1'}`}>
              {dpgfLoading ? (
                <div className="flex items-center justify-center h-full text-[var(--tblr-muted)]">Chargement…</div>
              ) : dpgf ? (
                <EstimationEditor
                  dpgf={dpgf}
                  onChange={editDpgf}
                  projectName={projectName}
                  showTree={showTree}
                  onToggleTree={toggleTree}
                  onDragStart={ligne => setDraggedLigne(ligne)}
                />
              ) : null}
            </div>

            {/* Right panel (split view) */}
            {splitView && (
              <div className="w-1/2 flex flex-col overflow-hidden">
                <RightPanelHeader
                  projectId={rightProjectId}
                  currentProjectId={projectId}
                  onChange={id => {
                    setRightProjectId(id);
                  }}
                  onClose={() => setSplitView(false)}
                />
                {displayedRightLoading ? (
                  <div className="flex items-center justify-center flex-1 text-[var(--tblr-muted)]">Chargement…</div>
                ) : displayedRightDpgf ? (
                  <ProReadOnlyPanel dpgf={displayedRightDpgf} estimation onDragStart={ligne => setDraggedLigne(ligne)} />
                ) : null}
              </div>
            )}
          </>
        )}

        {/* BPU / DQE — un seul document, deux jeux de colonnes */}
        {isBpuTab && (
          <div className="flex-1 overflow-hidden">
            {bpuLoading ? (
              <div className="flex items-center justify-center h-full text-[var(--tblr-muted)]">
                Chargement du {activeSubTab}…
              </div>
            ) : bpu ? (
              <BPUWorkspace
                bpu={bpu}
                onChange={editBpu}
                notify={notify}
                mode={activeSubTab === 'BPU' ? 'bpu' : 'dqe'}
                projectName={projectName}
                offres={offres}
                showTree={showTree}
                onToggleTree={toggleTree}
                onDragStart={ligne => setDraggedLigne(ligne)}
                onInitFromDpgf={dpgf && dpgf.lots.length > 0 ? initBpuFromDpgf : undefined}
                onPushToDpgf={dpgf && bpu.lots.length > 0 ? pushBpuToDpgf : undefined}
                onExportPdf={colSet => { void exporterBpu('pdf', colSet, false); }}
                onExportExcel={(colSet, vierge) => { void exporterBpu('xlsx', colSet, vierge); }}
                onImportOffre={() => setImportCible('bpu')}
                onPushToAct={verserAuComparatifAct}
                onPushToLibrary={lignes => { void envoyerVersBibliotheque(lignes); }}
                onOpenLibrary={() => { /* le panneau vit dans l'atelier */ }}
                projectLots={projectLots}
              />
            ) : null}
          </div>
        )}
      </div>

      {importCible === 'bpu' && bpu && (
        <OffreImportDialog
          doc={bpu}
          docLabel="bordereau"
          onClose={() => setImportCible(null)}
          onConfirm={enregistrerOffre}
        />
      )}
      {importCible === 'dpgf' && dpgf && (
        <OffreImportDialog
          doc={dpgf}
          docLabel="DPGF"
          onClose={() => setImportCible(null)}
          onConfirm={enregistrerOffreDpgf}
        />
      )}
    </div>
    </ProToolbarContext.Provider>
  );
};

// ── Right panel header with project selector ──────────────────────────────────

const RightPanelHeader: React.FC<{
  projectId: string;
  currentProjectId: string;
  onChange: (id: string) => void;
  onClose: () => void;
}> = ({ projectId, currentProjectId, onChange, onClose }) => {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/projects?limit=50')
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data.projects ?? data.data ?? []);
        setProjects(list.map((p: any) => ({ id: p.id, name: p.name || p.project_name || p.id })));
      })
      .catch(() => {});
  }, []);

  const current = projects.find(p => p.id === projectId);

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0" style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)' }}>
      <span className="text-xs font-medium shrink-0" style={{ color: 'var(--tblr-muted)' }}>Projet :</span>
      <div className="relative flex-1">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1 text-xs font-medium transition-colors hover:text-[var(--tblr-primary)]"
          style={{ color: 'var(--tblr-text)' }}
        >
          <span>{current?.name ?? projectId}</span>
          <IconChevronDown size={12} />
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 z-50 rounded-lg shadow-lg min-w-[200px] max-h-64 overflow-y-auto" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            {projects.filter(p => p.id !== currentProjectId).map(p => (
              <button
                key={p.id}
                onClick={() => { onChange(p.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--tblr-surface-2)] transition-colors truncate"
              >
                {p.name}
              </button>
            ))}
            {projects.length === 0 && (
              <div className="px-3 py-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>Aucun autre projet</div>
            )}
          </div>
        )}
      </div>
      <button
        onClick={onClose}
        className="ml-auto hover:text-[var(--tblr-text)]"
        style={{ color: 'var(--tblr-muted)' }}
        title="Fermer vue divisée"
      >
        <IconX size={15} />
      </button>
    </div>
  );
};
