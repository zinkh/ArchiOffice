import React, { useState, useEffect, useCallback } from 'react';
import { CCTPEditor } from './CCTPEditor';
import { DPGFWorkspace } from './DPGFWorkspace';
import { EstimationEditor } from './EstimationEditor';
import { BPUWorkspace } from './BPUWorkspace';
import { PrintPageDecorations } from '../PrintPageDecorations';
import { DPGF, Ligne } from '../../types/dpgf';
import type { BPU, BPURow, OffreBPU } from '../../types/bpu';
import { EMPTY_BPU } from '../../types/bpu';
import { dpgfToBpu, bpuToDpgf, assignerReferences } from '../../lib/bpuConvert';
import { exportBPUtoExcel, exportBPUtoPDF } from '../../lib/bpuExport';
import { BPUImportDialog } from './BPUImportDialog';
import { bpuVersComparatif } from '../../lib/bpuToAct';
import { useSettings } from '../../hooks/useSettings';
import {
  IconLayoutColumns, IconX, IconChevronDown, IconLayoutSidebar, IconPrinter,
  IconFileDescription, IconTable, IconCalculator, IconListNumbers, IconSum,
} from '@tabler/icons-react';
import { PillTabs, PillTabItem } from '../ui/PillTabs';
import { useAutosavedDoc, loadProDoc } from '../../hooks/useAutosavedDoc';
import { apiFetch } from '../../lib/api';

// ── types ─────────────────────────────────────────────────────────────────────

type SubTab = 'CCTP' | 'DPGF' | 'ESTIMATION' | 'BPU' | 'DQE';

interface ProTabProps {
  projectId: string;
  projectName?: string;
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

export const ProTab: React.FC<ProTabProps> = ({ projectId, projectName }) => {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('CCTP');

  // Document DPGF partagé par les onglets CCTP, DPGF et ESTIMATION.
  const dpgfDoc = useAutosavedDoc<DPGF>({
    key: projectId, load: loadDPGF, save: saveDPGF, empty: EMPTY_DPGF, lsKey: dpgfLsKey,
  });
  const { doc: dpgf, setDoc: setDpgf, loading: dpgfLoading, saveStatus, saveNow: handleSave } = dpgfDoc;

  // Vue divisée (DPGF / ESTIMATION)
  const [splitView, setSplitView] = useState(false);
  const [rightProjectId, setRightProjectId] = useState<string>(projectId);

  // Le panneau droit passe par le même hook : il gagne au passage
  // l'autosauvegarde qu'il n'avait pas, seul un bouton manuel le sauvegardait.
  const rightDoc = useAutosavedDoc<DPGF>({
    key: rightProjectId, load: loadDPGF, save: saveDPGF, empty: EMPTY_DPGF, lsKey: dpgfLsKey,
    enabled: splitView,
  });
  const { doc: rightDpgf, setDoc: setRightDpgf, loading: rightLoading, saveNow: handleRightSave } = rightDoc;

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
  useEffect(() => { if (isBpuTab) setBpuTouched(true); }, [isBpuTab]);

  // Initialise le bordereau depuis le DPGF, en préservant tout ce qui a déjà
  // été saisi côté BPU — l'action doit pouvoir être relancée sans dégât.
  const initBpuFromDpgf = useCallback(() => {
    if (!dpgf) return;
    setBpu(assignerReferences(dpgfToBpu(dpgf, bpu)));
  }, [dpgf, bpu, setBpu]);

  // Reverser un DQE dans le DPGF écrase des prix : on montre les écarts avant.
  const pushBpuToDpgf = useCallback(() => {
    if (!bpu || !dpgf) return;
    const { dpgf: next, diff } = bpuToDpgf(bpu, dpgf);
    const lignes = [
      `${diff.modifies.length} prix unitaire(s) seront modifiés dans le DPGF.`,
      diff.nonChiffres.length ? `${diff.nonChiffres.length} article(s) du DPGF ne sont pas chiffrés au bordereau et resteront inchangés.` : '',
      diff.absentsDuDpgf.length ? `${diff.absentsDuDpgf.length} article(s) n'existent que dans le bordereau et ne seront pas ajoutés.` : '',
      '',
      ...diff.modifies.slice(0, 12).map(m => `  ${m.numero} ${m.designation} : ${m.ancien} → ${m.nouveau} €`),
      diff.modifies.length > 12 ? `  … et ${diff.modifies.length - 12} autre(s).` : '',
      '',
      'Confirmer le reversement ?',
    ].filter(Boolean).join('\n');
    if (window.confirm(lignes)) setDpgf(next);
  }, [bpu, dpgf, setDpgf]);

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
      await exportBPUtoExcel(avecRefs, { mode, vierge, projectName });
    } else {
      await exportBPUtoPDF(avecRefs, { mode, projectName, settings: settings ?? {}, vierge });
    }
  }, [bpu, setBpu, projectName, settings]);

  // ── Offres reçues des entreprises ───────────────────────────────────────────
  const [importOuvert, setImportOuvert] = useState(false);

  /**
   * Les offres vivent dans une colonne séparée du document et passent par leur
   * propre endpoint : logées dans le document, elles seraient effacées par la
   * première autosauvegarde suivant l'import.
   */
  const enregistrerOffre = useCallback(async (offre: any) => {
    const saved = await apiFetch<OffreBPU>(`/api/projects/${projectId}/bpu/offres`, {
      method: 'POST', body: JSON.stringify({ offre }),
    });
    setOffres(prev => [...prev, saved]);
  }, [projectId]);

  /**
   * Verse le bordereau et les offres dans le comparatif détaillé du module ACT,
   * qui sait déjà les comparer, les noter et en tirer un RAO. À la demande
   * seulement : ce comparatif est éditable, une synchronisation automatique se
   * battrait contre l'architecte.
   */
  const verserAuComparatifAct = useCallback(async () => {
    if (!bpu) return;
    const { comparatif, lotsNonRattaches } = bpuVersComparatif(bpu, offres);
    if (lotsNonRattaches.length) {
      const liste = lotsNonRattaches.map(l => `  ${l.numero} ${l.titre}`).join('\n');
      if (!window.confirm(
        `Ces lots du bordereau ne sont rattachés à aucun lot du projet et ne seront pas versés :\n${liste}\n\nContinuer ?`,
      )) return;
    }
    if (!comparatif.length) {
      window.alert("Aucun lot du bordereau n'est rattaché à un lot du projet : rien à verser.");
      return;
    }
    try {
      const act = await apiFetch<any>(`/api/projects/${projectId}/act`);
      const consultation = { ...(act?.consultation ?? {}), comparatif };
      await apiFetch(`/api/projects/${projectId}/act`, {
        method: 'PUT',
        body: JSON.stringify({ ...(act ?? {}), consultation }),
      });
      window.alert(`Comparatif mis à jour : ${comparatif.length} lot(s) versé(s). Onglet ACT du projet.`);
    } catch (e: any) {
      window.alert(`Le versement a échoué : ${e?.message ?? 'erreur inconnue'}`);
    }
  }, [bpu, offres, projectId]);

  // Cross-panel DnD
  const [draggedLigne, setDraggedLigne] = useState<Ligne | null>(null);

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
  const TABS: PillTabItem[] = [
    { id: 'CCTP', label: 'CCTP', icon: IconFileDescription },
    { id: 'DPGF', label: 'DPGF', icon: IconTable },
    { id: 'ESTIMATION', label: 'ESTIMATION', icon: IconCalculator },
    { id: 'BPU', label: 'BPU', icon: IconListNumbers },
    { id: 'DQE', label: 'DQE', icon: IconSum },
  ];

  const canSplit = activeSubTab === 'DPGF' || activeSubTab === 'ESTIMATION';

  // Un seul indicateur, toujours celui du document à l'écran.
  const activeSaveStatus = isBpuTab ? bpuSaveStatus : saveStatus;
  const activeVersion = (isBpuTab ? bpu?.version : dpgf?.version) ?? '1.0';

  const PRINT_TITLES: Record<SubTab, string> = {
    CCTP:       'CCTP — Cahier des Clauses Techniques Particulières',
    DPGF:       'DPGF — Décomposition du Prix Global et Forfaitaire',
    ESTIMATION: 'Estimation Prévisionnelle',
    BPU:        'BPU — Bordereau de Prix Unitaires',
    DQE:        'DQE — Détail Quantitatif Estimatif',
  };

  return (
    <div id="printable-pro" className="flex flex-col" style={{ height: 'calc(100vh - 200px)', minHeight: 500 }}>

      {/* Print decorations — invisible on screen, fixed header/footer + QR when printing */}
      {(dpgf || bpu) && (
        <PrintPageDecorations
          title={PRINT_TITLES[activeSubTab]}
          subtitle={projectName}
          reference={`v${activeVersion}`}
          projectUrl={`${window.location.origin}/projects/${projectId}`}
        />
      )}

      {/* ── Sub-tab navigation ──────────────────────────────────────────────── */}
      <div
        className="no-print flex items-center gap-3 border-b p-2 shrink-0"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
      >
        <PillTabs tabs={TABS} activeId={activeSubTab} onChange={id => setActiveSubTab(id as SubTab)} />

        {/* Volet arbre — DPGF, ESTIMATION, BPU et DQE */}
        {(activeSubTab === 'DPGF' || activeSubTab === 'ESTIMATION' || isBpuTab) && (
          <button
            onClick={toggleTree}
            title={showTree ? "Masquer l'arbre" : "Afficher l'arbre"}
            className="p-1.5 rounded-lg transition-colors border"
            style={
              showTree
                ? { background: 'var(--tblr-primary-lt)', borderColor: 'var(--tblr-primary)', color: 'var(--tblr-primary)' }
                : { background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }
            }
          >
            <IconLayoutSidebar size={16} />
          </button>
        )}

        {/* Save status + print + split — always visible on the right */}
        <div className="ml-auto flex items-center gap-2 px-3 no-print">
          {activeSaveStatus === 'saving' && <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>Enregistrement…</span>}
          {activeSaveStatus === 'saved'  && <span className="text-xs text-green-600">✓ Enregistré</span>}
          {activeSaveStatus === 'error'  && <span className="text-xs text-red-500">Erreur d'enregistrement</span>}

          {/* Print button */}
          <button
            onClick={handlePrint}
            title="Imprimer"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:text-[var(--tblr-primary)]"
            style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
          >
            <IconPrinter size={14} />
            Imprimer
          </button>

          {/* Split view toggle — only for DPGF / ESTIMATION */}
          {canSplit && (
            <button
              onClick={() => setSplitView(v => !v)}
              title={splitView ? 'Vue simple' : 'Vue divisée (deux projets)'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={
                splitView
                  ? { background: 'var(--tblr-primary-lt)', borderColor: 'var(--tblr-primary)', color: 'var(--tblr-primary)' }
                  : { background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }
              }
            >
              <IconLayoutColumns size={15} />
              {splitView ? 'Vue divisée' : 'Diviser'}
            </button>
          )}
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex">

        {/* CCTP */}
        {activeSubTab === 'CCTP' && (
          <div className="flex-1 overflow-hidden">
            {dpgfLoading ? (
              <div className="flex items-center gap-2 p-8 text-[var(--tblr-muted)]">
                <div className="w-4 h-4 border-2 border-[var(--tblr-primary)] border-t-transparent rounded-full animate-spin" />
                Chargement…
              </div>
            ) : dpgf ? (
              <CCTPEditor dpgf={dpgf} onChange={setDpgf} onSave={handleSave} />
            ) : null}
          </div>
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
                  onChange={setDpgf}
                  onSave={handleSave}
                  projectName={projectName}
                  showTree={showTree}
                  onToggleTree={toggleTree}
                  onDragStart={ligne => setDraggedLigne(ligne)}
                  onDropExternal={ligne => {
                    // Dropped from right panel — find last chapitre in last lot
                    if (!dpgf.lots.length) return;
                    const newDpgf = JSON.parse(JSON.stringify(dpgf)) as DPGF;
                    const lot = newDpgf.lots[newDpgf.lots.length - 1];
                    if (!lot.chapitres.length) return;
                    const chap = lot.chapitres[lot.chapitres.length - 1];
                    chap.lignes.push({ ...ligne, id: `imp_${Date.now()}` });
                    lot.sousTotal = lot.chapitres.reduce((s, c) => s + c.lignes.reduce((ls, l) => ls + l.prixTotal, 0), 0);
                    const totalHT = newDpgf.lots.reduce((s, l) => s + l.sousTotal, 0);
                    setDpgf({ ...newDpgf, totalHT, totalTTC: totalHT * (1 + newDpgf.TVA / 100) });
                  }}
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
                {rightLoading ? (
                  <div className="flex items-center justify-center flex-1 text-[var(--tblr-muted)]">Chargement…</div>
                ) : rightDpgf ? (
                  <DPGFWorkspace
                    dpgf={rightDpgf}
                    onChange={setRightDpgf}
                    onSave={handleRightSave}
                    projectName={`Projet ${rightProjectId}`}
                    showTree={showTree}
                    onToggleTree={toggleTree}
                    onDragStart={ligne => setDraggedLigne(ligne)}
                  />
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
                  onChange={setDpgf}
                  onSave={handleSave}
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
                {rightLoading ? (
                  <div className="flex items-center justify-center flex-1 text-[var(--tblr-muted)]">Chargement…</div>
                ) : rightDpgf ? (
                  <EstimationEditor
                    dpgf={rightDpgf}
                    onChange={setRightDpgf}
                    onSave={handleRightSave}
                    projectName={`Projet ${rightProjectId}`}
                    showTree={showTree}
                    onToggleTree={toggleTree}
                    onDragStart={ligne => setDraggedLigne(ligne)}
                  />
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
                onChange={setBpu}
                onSave={handleBpuSave}
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
                onImportOffre={() => setImportOuvert(true)}
                onPushToAct={verserAuComparatifAct}
              />
            ) : null}
          </div>
        )}
      </div>

      {importOuvert && bpu && (
        <BPUImportDialog
          bpu={bpu}
          onClose={() => setImportOuvert(false)}
          onConfirm={enregistrerOffre}
        />
      )}
    </div>
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
