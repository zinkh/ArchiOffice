import React, { useState, useEffect, useCallback } from 'react';
import { CCTPEditor } from './CCTPEditor';
import { DPGFWorkspace } from './DPGFWorkspace';
import { EstimationEditor } from './EstimationEditor';
import { DPGF, Ligne } from '../../types/dpgf';
import {
  IconLayoutColumns, IconX, IconChevronDown, IconLayoutSidebar,
} from '@tabler/icons-react';

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

async function fetchDPGF(projectId: string): Promise<DPGF | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}/dpgf`);
    if (res.ok) return res.json();
  } catch { /* ignore */ }
  return null;
}

async function saveDPGFApi(projectId: string, data: DPGF): Promise<void> {
  await fetch(`/api/projects/${projectId}/dpgf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── component ─────────────────────────────────────────────────────────────────

export const ProTab: React.FC<ProTabProps> = ({ projectId, projectName }) => {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('CCTP');

  // Shared DPGF state — used by both DPGF and ESTIMATION tabs
  const [dpgf, setDpgf] = useState<DPGF | null>(null);
  const [dpgfLoading, setDpgfLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

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

  // ── Load DPGF ───────────────────────────────────────────────────────────────
  useEffect(() => {
    setDpgfLoading(true);
    fetchDPGF(projectId).then(data => {
      setDpgf(data ?? EMPTY_DPGF(projectId));
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

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!dpgf) return;
    setSaveStatus('saving');
    try {
      await saveDPGFApi(projectId, dpgf);
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
  const TABS: { id: SubTab; label: string }[] = [
    { id: 'CCTP', label: 'CCTP' },
    { id: 'DPGF', label: 'DPGF' },
    { id: 'ESTIMATION', label: 'ESTIMATION' },
  ];

  const canSplit = activeSubTab === 'DPGF' || activeSubTab === 'ESTIMATION';

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 200px)', minHeight: 500 }}>

      {/* ── Sub-tab navigation ──────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 shrink-0">
        <div className="flex">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`px-5 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
                activeSubTab === tab.id
                  ? 'text-blue-700 dark:text-blue-400 border-blue-600 bg-white dark:bg-zinc-800'
                  : 'text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tree toggle — only for DPGF / ESTIMATION */}
        {(activeSubTab === 'DPGF' || activeSubTab === 'ESTIMATION') && (
          <button
            onClick={toggleTree}
            title={showTree ? "Masquer l'arbre" : "Afficher l'arbre"}
            className={`ml-3 p-1.5 rounded transition-colors border ${
              showTree
                ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 text-blue-700 dark:text-blue-300'
                : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-500 hover:border-blue-300'
            }`}
          >
            <IconLayoutSidebar size={16} />
          </button>
        )}

        {/* Split view toggle — only for DPGF / ESTIMATION */}
        {canSplit && (
          <div className="ml-auto flex items-center gap-2 px-3">
            {saveStatus === 'saving' && <span className="text-xs text-zinc-400">Enregistrement…</span>}
            {saveStatus === 'saved' && <span className="text-xs text-green-600">✓ Enregistré</span>}
            {saveStatus === 'error' && <span className="text-xs text-red-600">Erreur</span>}
            <button
              onClick={() => setSplitView(v => !v)}
              title={splitView ? 'Vue simple' : 'Vue divisée (deux projets)'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                splitView
                  ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 text-blue-700 dark:text-blue-300'
                  : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:border-blue-300'
              }`}
            >
              <IconLayoutColumns size={15} />
              {splitView ? 'Vue divisée' : 'Diviser'}
            </button>
          </div>
        )}
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex">

        {/* CCTP */}
        {activeSubTab === 'CCTP' && (
          <div className="flex-1 overflow-hidden">
            {dpgfLoading ? (
              <div className="flex items-center gap-2 p-8 text-zinc-500">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
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
            <div className={`flex flex-col overflow-hidden ${splitView ? 'w-1/2 border-r border-zinc-300 dark:border-zinc-600' : 'flex-1'}`}>
              {dpgfLoading ? (
                <div className="flex items-center justify-center h-full text-zinc-400">Chargement du DPGF…</div>
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
                  <div className="flex items-center justify-center flex-1 text-zinc-400">Chargement…</div>
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
            <div className={`flex flex-col overflow-hidden ${splitView ? 'w-1/2 border-r border-zinc-300 dark:border-zinc-600' : 'flex-1'}`}>
              {dpgfLoading ? (
                <div className="flex items-center justify-center h-full text-zinc-400">Chargement…</div>
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
                  <div className="flex items-center justify-center flex-1 text-zinc-400">Chargement…</div>
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
    <div className="flex items-center gap-2 px-3 py-2 bg-[#edf1f7] dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
      <span className="text-xs text-zinc-500 font-medium shrink-0">Projet :</span>
      <div className="relative flex-1">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:text-blue-600 transition-colors"
        >
          <span>{current?.name ?? projectId}</span>
          <IconChevronDown size={12} />
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg min-w-[200px] max-h-64 overflow-y-auto">
            {projects.filter(p => p.id !== currentProjectId).map(p => (
              <button
                key={p.id}
                onClick={() => { onChange(p.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-zinc-700 transition-colors truncate"
              >
                {p.name}
              </button>
            ))}
            {projects.length === 0 && (
              <div className="px-3 py-2 text-xs text-zinc-400">Aucun autre projet</div>
            )}
          </div>
        )}
      </div>
      <button
        onClick={onClose}
        className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 ml-auto"
        title="Fermer vue divisée"
      >
        <IconX size={15} />
      </button>
    </div>
  );
};
