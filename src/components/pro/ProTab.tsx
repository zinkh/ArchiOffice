import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CCTPEditor } from './CCTPEditor';
import { DPGFWorkspace } from './DPGFWorkspace';
import { EstimationEditor } from './EstimationEditor';
import { PrintPageDecorations } from '../PrintPageDecorations';
import { DPGF, Ligne } from '../../types/dpgf';
import {
  IconLayoutColumns, IconX, IconChevronDown, IconLayoutSidebar, IconPrinter,
  IconFileDescription, IconTable, IconCalculator,
} from '@tabler/icons-react';
import { PillTabs, PillTabItem } from '../ui/PillTabs';

// ── types ─────────────────────────────────────────────────────────────────────

type SubTab = 'CCTP' | 'DPGF' | 'ESTIMATION';

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

// ── helpers ───────────────────────────────────────────────────────────────────

const lsKey = (id: string) => `archioffice_dpgf_${id}`;

function lsSave(projectId: string, data: DPGF): void {
  try { localStorage.setItem(lsKey(projectId), JSON.stringify(data)); } catch { /* quota */ }
}

function lsLoad(projectId: string): DPGF | null {
  try {
    const raw = localStorage.getItem(lsKey(projectId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function fetchDPGF(projectId: string): Promise<DPGF | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}/dpgf`);
    if (res.ok) {
      const data: DPGF = await res.json();
      lsSave(projectId, data); // keep localStorage in sync
      return data;
    }
  } catch { /* ignore */ }
  // API unavailable — fall back to localStorage
  return lsLoad(projectId);
}

async function saveDPGFApi(projectId: string, data: DPGF): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/dpgf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('save failed');
}

// ── component ─────────────────────────────────────────────────────────────────

export const ProTab: React.FC<ProTabProps> = ({ projectId, projectName }) => {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('CCTP');

  // Shared DPGF state — used by CCTP, DPGF, and ESTIMATION tabs
  const [dpgf, setDpgf] = useState<DPGF | null>(null);
  const [dpgfLoading, setDpgfLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Tracks the JSON of the last persisted state to skip no-op saves
  const lastSavedJson = useRef<string | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Split view state (DPGF / ESTIMATION)
  const [splitView, setSplitView] = useState(false);
  const [rightProjectId, setRightProjectId] = useState<string>(projectId);
  const [rightDpgf, setRightDpgf] = useState<DPGF | null>(null);
  const [rightLoading, setRightLoading] = useState(false);

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

  // ── Load DPGF ───────────────────────────────────────────────────────────────
  useEffect(() => {
    setDpgfLoading(true);
    lastSavedJson.current = null;
    fetchDPGF(projectId).then(data => {
      const loaded = data ?? EMPTY_DPGF(projectId);
      // Record the loaded state so auto-save doesn't fire immediately
      lastSavedJson.current = JSON.stringify(loaded);
      setDpgf(loaded);
      setDpgfLoading(false);
    });
  }, [projectId]);

  // Load right-panel DPGF when split view or project changes
  useEffect(() => {
    if (!splitView) return;
    setRightLoading(true);
    fetchDPGF(rightProjectId).then(data => {
      setRightDpgf(data ?? EMPTY_DPGF(rightProjectId));
      setRightLoading(false);
    });
  }, [splitView, rightProjectId]);

  // ── Auto-save on change (debounced 2 s) + immediate localStorage backup ─────
  useEffect(() => {
    if (!dpgf) return;
    const json = JSON.stringify(dpgf);
    if (json === lastSavedJson.current) return; // nothing changed

    // Write to localStorage immediately so nothing is lost on navigation
    lsSave(projectId, dpgf);

    // Debounce the API call
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await saveDPGFApi(projectId, dpgf);
        lastSavedJson.current = json;
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('error');
      }
    }, 2000);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [dpgf, projectId]);

  // ── Manual save (ribbon button) ─────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!dpgf) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSaveStatus('saving');
    try {
      await saveDPGFApi(projectId, dpgf);
      lastSavedJson.current = JSON.stringify(dpgf);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
    }
  }, [dpgf, projectId]);

  const handleRightSave = useCallback(async () => {
    if (!rightDpgf) return;
    await saveDPGFApi(rightProjectId, rightDpgf);
  }, [rightDpgf, rightProjectId]);

  // ── Tab labels ───────────────────────────────────────────────────────────────
  const TABS: PillTabItem[] = [
    { id: 'CCTP', label: 'CCTP', icon: IconFileDescription },
    { id: 'DPGF', label: 'DPGF', icon: IconTable },
    { id: 'ESTIMATION', label: 'ESTIMATION', icon: IconCalculator },
  ];

  const canSplit = activeSubTab === 'DPGF' || activeSubTab === 'ESTIMATION';

  const PRINT_TITLES: Record<SubTab, string> = {
    CCTP:       'CCTP — Cahier des Clauses Techniques Particulières',
    DPGF:       'DPGF — Décomposition du Prix Global et Forfaitaire',
    ESTIMATION: 'Estimation Prévisionnelle',
  };

  return (
    <div id="printable-pro" className="flex flex-col" style={{ height: 'calc(100vh - 200px)', minHeight: 500 }}>

      {/* Print decorations — invisible on screen, fixed header/footer + QR when printing */}
      {dpgf && (
        <PrintPageDecorations
          title={PRINT_TITLES[activeSubTab]}
          subtitle={projectName}
          reference={`v${dpgf.version}`}
          projectUrl={`${window.location.origin}/projects/${projectId}`}
        />
      )}

      {/* ── Sub-tab navigation ──────────────────────────────────────────────── */}
      <div
        className="no-print flex items-center gap-3 border-b p-2 shrink-0"
        style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
      >
        <PillTabs tabs={TABS} activeId={activeSubTab} onChange={id => setActiveSubTab(id as SubTab)} />

        {/* Tree toggle — only for DPGF / ESTIMATION */}
        {(activeSubTab === 'DPGF' || activeSubTab === 'ESTIMATION') && (
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
          {saveStatus === 'saving' && <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>Enregistrement…</span>}
          {saveStatus === 'saved'  && <span className="text-xs text-green-600">✓ Enregistré</span>}
          {saveStatus === 'error'  && <span className="text-xs text-red-500">Erreur d'enregistrement</span>}

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
      </div>
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
