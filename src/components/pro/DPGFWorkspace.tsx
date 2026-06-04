import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  IconPlus, IconTrash, IconCopy, IconClipboard, IconDeviceFloppy,
  IconFileTypePdf, IconTable, IconChevronRight, IconChevronDown,
  IconLayoutSidebarLeft, IconArrowsMaximize, IconArrowsMinimize,
  IconRowInsertBottom, IconFolderPlus, IconStackPush,
  IconMath, IconX, IconCheck,
} from '@tabler/icons-react';
import { ProRibbon, RibbonTabDef } from './ProRibbon';
import { DPGF, Lot, Chapitre, Ligne } from '../../types/dpgf';
import { exportDPGFtoPDF, exportDPGFtoExcel } from '../../lib/proExport';
import { formatCurrency } from '../../lib/utils';

// ── uid helper ───────────────────────────────────────────────────────────────
let _uid = 0;
const uid = () => `id_${Date.now()}_${_uid++}`;

// ── Formula evaluator (supports basic arithmetic) ────────────────────────────
function evalFormula(raw: string): number {
  if (!raw.startsWith('=')) return parseFloat(raw) || 0;
  try {
    const expr = raw.slice(1).replace(/[^0-9+\-*/.() ]/g, '');
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + expr + ')')();
    return typeof result === 'number' && isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface FlatRow {
  kind: 'lot' | 'chapitre' | 'ligne';
  lotIdx: number;
  chapIdx?: number;
  ligneIdx?: number;
  lot: Lot;
  chapitre?: Chapitre;
  ligne?: Ligne;
  depth: number;
}

interface EditingCell {
  rowKey: string;
  field: string;
  value: string;
}

interface DragState {
  rowKey: string;
  ligne: Ligne;
  sourceLotIdx: number;
  sourceChapIdx: number;
}

interface DPGFWorkspaceProps {
  dpgf: DPGF;
  onChange: (dpgf: DPGF) => void;
  onSave: () => void;
  projectName?: string;
  /** When used in split mode, dragged lines come from here */
  onDropExternal?: (ligne: Ligne) => void;
  /** Drag start notifies parent for cross-panel DnD */
  onDragStart?: (ligne: Ligne) => void;
}

export const DPGFWorkspace: React.FC<DPGFWorkspaceProps> = ({
  dpgf, onChange, onSave, projectName, onDropExternal, onDragStart,
}) => {
  // ── UI state ────────────────────────────────────────────────────────────────
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set(dpgf.lots.map(l => l.id)));
  const [expandedChaps, setExpandedChaps] = useState<Set<string>>(
    new Set(dpgf.lots.flatMap(l => l.chapitres.map(c => c.id)))
  );
  const [showTree, setShowTree] = useState(true);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(dpgf.lots[0]?.id ?? null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [clipboard, setClipboard] = useState<Ligne | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // ── Derived flat rows ────────────────────────────────────────────────────────
  const flatRows: FlatRow[] = [];
  dpgf.lots.forEach((lot, li) => {
    flatRows.push({ kind: 'lot', depth: 0, lotIdx: li, lot });
    if (expandedLots.has(lot.id)) {
      lot.chapitres.forEach((chap, ci) => {
        flatRows.push({ kind: 'chapitre', depth: 1, lotIdx: li, chapIdx: ci, lot, chapitre: chap });
        if (expandedChaps.has(chap.id)) {
          chap.lignes.forEach((ligne, lgi) => {
            flatRows.push({ kind: 'ligne', depth: 2, lotIdx: li, chapIdx: ci, ligneIdx: lgi, lot, chapitre: chap, ligne });
          });
        }
      });
    }
  });

  const rowKey = (r: FlatRow) =>
    r.kind === 'lot' ? `lot-${r.lotIdx}`
    : r.kind === 'chapitre' ? `chap-${r.lotIdx}-${r.chapIdx}`
    : `ligne-${r.lotIdx}-${r.chapIdx}-${r.ligneIdx}`;

  // ── Mutate helpers ───────────────────────────────────────────────────────────
  const mutateLots = useCallback((fn: (lots: Lot[]) => Lot[]) => {
    const newLots = fn(JSON.parse(JSON.stringify(dpgf.lots)));
    const totalHT = newLots.reduce((s, l) => s + l.sousTotal, 0);
    onChange({ ...dpgf, lots: newLots, totalHT, totalTTC: totalHT * (1 + dpgf.TVA / 100) });
  }, [dpgf, onChange]);

  const recomputeLot = (lot: Lot): Lot => {
    const sousTotal = lot.chapitres.reduce(
      (s, c) => s + c.lignes.reduce((ls, l) => ls + l.prixTotal, 0), 0
    );
    return { ...lot, sousTotal };
  };

  // ── Tree toggle ───────────────────────────────────────────────────────────────
  const toggleLot = (id: string) => setExpandedLots(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });
  const toggleChap = (id: string) => setExpandedChaps(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });

  // ── Add / Remove ──────────────────────────────────────────────────────────────
  const addLot = () => {
    const newLot: Lot = {
      id: uid(), numero: String(dpgf.lots.length + 1).padStart(2, '0'),
      titre: 'Nouveau lot', chapitres: [], sousTotal: 0,
    };
    mutateLots(lots => [...lots, newLot]);
    setExpandedLots(prev => new Set([...prev, newLot.id]));
    setSelectedLotId(newLot.id);
  };

  const addChapitre = () => {
    if (!selectedLotId) return;
    mutateLots(lots => lots.map(lot => {
      if (lot.id !== selectedLotId) return lot;
      const newChap: Chapitre = {
        id: uid(),
        numero: `${lot.numero}.${lot.chapitres.length + 1}`,
        titre: 'Nouveau chapitre',
        lignes: [],
      };
      const updated = { ...lot, chapitres: [...lot.chapitres, newChap] };
      setExpandedChaps(prev => new Set([...prev, newChap.id]));
      return updated;
    }));
  };

  const addLigne = (lotIdx: number, chapIdx: number) => {
    mutateLots(lots => {
      const newLots = [...lots];
      const lot = { ...newLots[lotIdx] };
      const chap = { ...lot.chapitres[chapIdx] };
      const newLigne: Ligne = {
        id: uid(),
        numero: `${chap.numero}.${chap.lignes.length + 1}`,
        designation: 'Nouvel article',
        unite: 'u',
        quantite: 0,
        prixUnitaire: 0,
        prixTotal: 0,
        type: 'ouvrage',
      };
      chap.lignes = [...chap.lignes, newLigne];
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), chap, ...lot.chapitres.slice(chapIdx + 1)];
      newLots[lotIdx] = recomputeLot(lot);
      return newLots;
    });
  };

  const deleteLigne = (lotIdx: number, chapIdx: number, ligneIdx: number) => {
    mutateLots(lots => {
      const newLots = [...lots];
      const lot = { ...newLots[lotIdx] };
      const chap = { ...lot.chapitres[chapIdx] };
      chap.lignes = chap.lignes.filter((_, i) => i !== ligneIdx);
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), chap, ...lot.chapitres.slice(chapIdx + 1)];
      newLots[lotIdx] = recomputeLot(lot);
      return newLots;
    });
  };

  const deleteChapitre = (lotIdx: number, chapIdx: number) => {
    mutateLots(lots => {
      const newLots = [...lots];
      const lot = { ...newLots[lotIdx] };
      lot.chapitres = lot.chapitres.filter((_, i) => i !== chapIdx);
      newLots[lotIdx] = recomputeLot(lot);
      return newLots;
    });
  };

  const deleteLot = (lotIdx: number) => {
    mutateLots(lots => lots.filter((_, i) => i !== lotIdx));
  };

  // ── Cell editing ──────────────────────────────────────────────────────────────
  const startEdit = (rowKey: string, field: string, currentValue: string | number) => {
    setEditingCell({ rowKey, field, value: String(currentValue) });
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { rowKey, field, value } = editingCell;

    if (rowKey.startsWith('ligne-')) {
      const [, li, ci, lgi] = rowKey.split('-').map(Number);
      mutateLots(lots => {
        const newLots = [...lots];
        const lot = { ...newLots[li] };
        const chap = { ...lot.chapitres[ci] };
        const ligne = { ...chap.lignes[lgi] };

        if (field === 'designation') ligne.designation = value;
        else if (field === 'unite') ligne.unite = value;
        else if (field === 'numero') ligne.numero = value;
        else if (field === 'quantite') {
          ligne.quantite = evalFormula(value);
          ligne.prixTotal = ligne.quantite * ligne.prixUnitaire;
        } else if (field === 'prixUnitaire') {
          ligne.prixUnitaire = evalFormula(value);
          ligne.prixTotal = ligne.quantite * ligne.prixUnitaire;
        } else if (field === 'prixTotal') {
          ligne.prixTotal = evalFormula(value);
        }

        chap.lignes = [...chap.lignes.slice(0, lgi), ligne, ...chap.lignes.slice(lgi + 1)];
        lot.chapitres = [...lot.chapitres.slice(0, ci), chap, ...lot.chapitres.slice(ci + 1)];
        newLots[li] = recomputeLot(lot);
        return newLots;
      });
    } else if (rowKey.startsWith('chap-')) {
      const [, li, ci] = rowKey.split('-').map(Number);
      mutateLots(lots => {
        const newLots = [...lots];
        const lot = { ...newLots[li] };
        const chap = { ...lot.chapitres[ci], [field === 'titre' ? 'titre' : field]: value };
        lot.chapitres = [...lot.chapitres.slice(0, ci), chap, ...lot.chapitres.slice(ci + 1)];
        newLots[li] = lot;
        return newLots;
      });
    } else if (rowKey.startsWith('lot-')) {
      const [, li] = rowKey.split('-').map(Number);
      mutateLots(lots => {
        const newLots = [...lots];
        newLots[li] = { ...newLots[li], [field === 'titre' ? 'titre' : field]: value };
        return newLots;
      });
    }
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    else if (e.key === 'Escape') cancelEdit();
  };

  // ── Clipboard ────────────────────────────────────────────────────────────────
  const copySelected = () => {
    // copy the last selected ligne
    const lastLigne = flatRows.filter(r => r.kind === 'ligne').at(-1);
    if (lastLigne?.ligne) setClipboard({ ...lastLigne.ligne });
  };

  const pasteLigne = () => {
    if (!clipboard || !selectedLotId) return;
    const lotIdx = dpgf.lots.findIndex(l => l.id === selectedLotId);
    if (lotIdx < 0) return;
    const chapIdx = dpgf.lots[lotIdx].chapitres.length - 1;
    if (chapIdx < 0) return;
    mutateLots(lots => {
      const newLots = [...lots];
      const lot = { ...newLots[lotIdx] };
      const chap = { ...lot.chapitres[chapIdx] };
      chap.lignes = [...chap.lignes, { ...clipboard, id: uid() }];
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), chap, ...lot.chapitres.slice(chapIdx + 1)];
      newLots[lotIdx] = recomputeLot(lot);
      return newLots;
    });
  };

  // ── Expand / Collapse all ─────────────────────────────────────────────────────
  const expandAll = () => {
    setExpandedLots(new Set(dpgf.lots.map(l => l.id)));
    setExpandedChaps(new Set(dpgf.lots.flatMap(l => l.chapitres.map(c => c.id))));
  };
  const collapseAll = () => {
    setExpandedLots(new Set());
    setExpandedChaps(new Set());
  };

  // ── Scroll to selected lot ────────────────────────────────────────────────────
  const scrollToLot = (lotId: string) => {
    setSelectedLotId(lotId);
    setExpandedLots(prev => new Set([...prev, lotId]));
    setTimeout(() => {
      const el = tableRef.current?.querySelector(`[data-lot-id="${lotId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, row: FlatRow) => {
    if (row.kind !== 'ligne' || !row.ligne) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/json', JSON.stringify(row.ligne));
    setDragState({ rowKey: rowKey(row), ligne: row.ligne, sourceLotIdx: row.lotIdx, sourceChapIdx: row.chapIdx! });
    onDragStart?.(row.ligne);
  };

  const handleDragOver = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTarget(targetKey);
  };

  const handleDrop = (e: React.DragEvent, targetRow: FlatRow) => {
    e.preventDefault();
    setDropTarget(null);
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    const ligne: Ligne = JSON.parse(raw);
    if (targetRow.kind === 'chapitre' && targetRow.chapIdx !== undefined) {
      mutateLots(lots => {
        const newLots = [...lots];
        const lot = { ...newLots[targetRow.lotIdx] };
        const chap = { ...lot.chapitres[targetRow.chapIdx!] };
        chap.lignes = [...chap.lignes, { ...ligne, id: uid() }];
        lot.chapitres = [...lot.chapitres.slice(0, targetRow.chapIdx!), chap, ...lot.chapitres.slice(targetRow.chapIdx! + 1)];
        newLots[targetRow.lotIdx] = recomputeLot(lot);
        return newLots;
      });
    }
    setDragState(null);
    onDropExternal?.(ligne);
  };

  // ── Ribbon definition ─────────────────────────────────────────────────────────
  const ribbonTabs: RibbonTabDef[] = [
    {
      id: 'accueil',
      label: 'Accueil',
      groups: [
        {
          label: 'Presse-papiers',
          actions: [
            { id: 'copy', label: 'Copier', icon: <IconCopy size={20} />, onClick: copySelected },
            { id: 'paste', label: 'Coller', icon: <IconClipboard size={20} />, onClick: pasteLigne, disabled: !clipboard },
          ],
        },
        {
          label: 'Structure',
          actions: [
            { id: 'addLot', label: 'Lot', icon: <IconFolderPlus size={20} />, onClick: addLot },
            { id: 'addChap', label: 'Chapitre', icon: <IconStackPush size={20} />, onClick: addChapitre, disabled: !selectedLotId },
            {
              id: 'addLigne', label: 'Article', icon: <IconRowInsertBottom size={20} />, onClick: () => {
                if (!selectedLotId) return;
                const li = dpgf.lots.findIndex(l => l.id === selectedLotId);
                if (li < 0 || dpgf.lots[li].chapitres.length === 0) return;
                addLigne(li, dpgf.lots[li].chapitres.length - 1);
              },
              disabled: !selectedLotId || (dpgf.lots.find(l => l.id === selectedLotId)?.chapitres.length ?? 0) === 0,
            },
          ],
        },
        {
          label: 'Document',
          actions: [
            { id: 'save', label: 'Enregistrer', icon: <IconDeviceFloppy size={20} />, onClick: onSave },
          ],
        },
      ],
    },
    {
      id: 'vue',
      label: 'Vue',
      groups: [
        {
          label: 'Volet arbre',
          actions: [
            { id: 'toggleTree', label: 'Arbre', icon: <IconLayoutSidebarLeft size={20} />, onClick: () => setShowTree(v => !v), active: showTree },
          ],
        },
        {
          label: 'Développement',
          actions: [
            { id: 'expandAll', label: 'Tout développer', icon: <IconArrowsMaximize size={20} />, onClick: expandAll },
            { id: 'collapseAll', label: 'Tout réduire', icon: <IconArrowsMinimize size={20} />, onClick: collapseAll },
          ],
        },
      ],
    },
    {
      id: 'export',
      label: 'Exporter',
      groups: [
        {
          label: 'Formats',
          actions: [
            { id: 'pdf', label: 'PDF', icon: <IconFileTypePdf size={20} />, onClick: () => exportDPGFtoPDF(dpgf, projectName) },
            { id: 'excel', label: 'Excel', icon: <IconTable size={20} />, onClick: () => exportDPGFtoExcel(dpgf, projectName) },
          ],
        },
      ],
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
  const CellInput = ({ value, onCommit, className = '' }: { value: string; onCommit: (v: string) => void; className?: string }) => {
    const [v, setV] = useState(value);
    return (
      <input
        autoFocus
        value={v}
        onChange={e => setV(e.target.value)}
        onBlur={() => onCommit(v)}
        onKeyDown={e => {
          if (e.key === 'Enter') { onCommit(v); e.currentTarget.blur(); }
          if (e.key === 'Escape') { cancelEdit(); }
        }}
        className={`w-full px-1 py-0 bg-[#fffde7] border border-blue-400 rounded outline-none text-sm font-mono ${className}`}
      />
    );
  };

  const EditableCell = ({
    rKey, field, value, numeric = false, className = '',
  }: {
    rKey: string; field: string; value: string | number; numeric?: boolean; className?: string;
  }) => {
    const isEditing = editingCell?.rowKey === rKey && editingCell?.field === field;
    const display = numeric && typeof value === 'number' && value > 0
      ? new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
      : String(value || '');

    if (isEditing) {
      return (
        <CellInput
          value={editingCell.value}
          onCommit={v => {
            setEditingCell(prev => prev ? { ...prev, value: v } : null);
            setTimeout(commitEdit, 0);
          }}
          className={className}
        />
      );
    }
    return (
      <div
        onDoubleClick={() => startEdit(rKey, field, value)}
        className={`px-1 py-0.5 cursor-text hover:bg-blue-50 rounded min-h-[22px] ${numeric ? 'text-right font-mono' : ''} ${className}`}
        title="Double-clic pour éditer"
      >
        {display}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-zinc-900">
      <ProRibbon tabs={ribbonTabs} defaultTab="accueil" />

      {/* Main workspace */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left tree panel ─────────────────────────────────────────────── */}
        {showTree && (
          <div className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-700 overflow-y-auto bg-[#f5f7fa] dark:bg-zinc-800/50 text-sm">
            <div className="px-3 py-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-700">
              Structure
            </div>
            {dpgf.lots.map((lot, li) => (
              <div key={lot.id}>
                <button
                  className={`w-full flex items-center gap-1 px-2 py-1.5 text-left hover:bg-blue-50 dark:hover:bg-zinc-700 transition-colors font-medium text-xs
                    ${selectedLotId === lot.id ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300' : 'text-zinc-700 dark:text-zinc-300'}`}
                  onClick={() => scrollToLot(lot.id)}
                >
                  <span className="shrink-0" onClick={e => { e.stopPropagation(); toggleLot(lot.id); }}>
                    {expandedLots.has(lot.id) ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  </span>
                  <span className="font-bold text-zinc-500 mr-1">{lot.numero}</span>
                  <span className="truncate">{lot.titre}</span>
                </button>
                {expandedLots.has(lot.id) && lot.chapitres.map((chap, ci) => (
                  <button
                    key={chap.id}
                    className="w-full flex items-center gap-1 pl-7 pr-2 py-1 text-left text-xs hover:bg-blue-50 dark:hover:bg-zinc-700 transition-colors text-zinc-600 dark:text-zinc-400"
                    onClick={() => {
                      setSelectedLotId(lot.id);
                      setExpandedChaps(prev => new Set([...prev, chap.id]));
                    }}
                  >
                    <span className="font-medium text-zinc-400 mr-1">{chap.numero}</span>
                    <span className="truncate">{chap.titre}</span>
                  </button>
                ))}
              </div>
            ))}
            <button
              className="w-full flex items-center gap-1 px-2 py-2 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-zinc-700 border-t border-zinc-200 dark:border-zinc-700 mt-2"
              onClick={addLot}
            >
              <IconPlus size={13} /> Nouveau lot
            </button>
          </div>
        )}

        {/* ── Right table ─────────────────────────────────────────────────── */}
        <div ref={tableRef} className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: 720 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#1e5090] text-white text-xs">
                <th className="px-2 py-2 text-left font-semibold w-8"></th>
                <th className="px-2 py-2 text-left font-semibold w-20">N°</th>
                <th className="px-2 py-2 text-left font-semibold">Désignation</th>
                <th className="px-2 py-2 text-center font-semibold w-16">Unité</th>
                <th className="px-2 py-2 text-right font-semibold w-24">Quantité</th>
                <th className="px-2 py-2 text-right font-semibold w-28">P.U. HT (€)</th>
                <th className="px-2 py-2 text-right font-semibold w-28">Total HT (€)</th>
                <th className="px-2 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {flatRows.map(row => {
                const rKey = rowKey(row);
                const isDropTarget = dropTarget === rKey;

                if (row.kind === 'lot') {
                  return (
                    <tr
                      key={rKey}
                      data-lot-id={row.lot.id}
                      className={`border-b border-[#9ab0cb] ${isDropTarget ? 'bg-blue-100' : 'bg-[#c8d8ec] dark:bg-blue-900/30'}`}
                      onDragOver={e => handleDragOver(e, rKey)}
                      onDrop={e => handleDrop(e, row)}
                      onDragLeave={() => setDropTarget(null)}
                    >
                      <td className="px-1 py-1.5">
                        <button onClick={() => toggleLot(row.lot.id)} className="text-zinc-600">
                          {expandedLots.has(row.lot.id) ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        </button>
                      </td>
                      <td className="px-2 py-1 font-bold text-xs text-zinc-600">
                        <EditableCell rKey={rKey} field="numero" value={row.lot.numero} />
                      </td>
                      <td className="px-2 py-1 font-bold text-sm" colSpan={4}>
                        <EditableCell rKey={rKey} field="titre" value={row.lot.titre} />
                      </td>
                      <td className="px-2 py-1 text-right font-bold text-sm font-mono text-[#1e5090]">
                        {formatCurrency(row.lot.sousTotal)}
                      </td>
                      <td className="px-1 py-1">
                        <button onClick={() => deleteLot(row.lotIdx)} className="text-red-400 hover:text-red-600 opacity-60 hover:opacity-100">
                          <IconTrash size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                }

                if (row.kind === 'chapitre') {
                  return (
                    <tr
                      key={rKey}
                      className={`border-b border-zinc-200 dark:border-zinc-700 ${isDropTarget ? 'bg-blue-50 ring-1 ring-blue-300' : 'bg-[#edf1f7] dark:bg-zinc-800/40'}`}
                      onDragOver={e => handleDragOver(e, rKey)}
                      onDrop={e => handleDrop(e, row)}
                      onDragLeave={() => setDropTarget(null)}
                    >
                      <td className="px-1 py-1 pl-4">
                        <button onClick={() => toggleChap(row.chapitre!.id)} className="text-zinc-500">
                          {expandedChaps.has(row.chapitre!.id) ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                        </button>
                      </td>
                      <td className="px-2 py-1 text-xs text-zinc-500">
                        <EditableCell rKey={rKey} field="numero" value={row.chapitre!.numero} />
                      </td>
                      <td className="px-2 py-1 font-semibold text-xs text-zinc-700 dark:text-zinc-300" colSpan={5}>
                        <EditableCell rKey={rKey} field="titre" value={row.chapitre!.titre} />
                      </td>
                      <td className="px-1 py-1 flex gap-0.5 items-center">
                        <button onClick={() => addLigne(row.lotIdx, row.chapIdx!)} className="text-blue-400 hover:text-blue-600" title="Ajouter article">
                          <IconPlus size={13} />
                        </button>
                        <button onClick={() => deleteChapitre(row.lotIdx, row.chapIdx!)} className="text-red-400 hover:text-red-600 opacity-60 hover:opacity-100" title="Supprimer chapitre">
                          <IconTrash size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                }

                // ligne
                const l = row.ligne!;
                return (
                  <tr
                    key={rKey}
                    draggable
                    onDragStart={e => handleDragStart(e, row)}
                    className={`border-b border-zinc-100 dark:border-zinc-800 cursor-grab hover:bg-[#f0f6ff] dark:hover:bg-zinc-800/60
                      ${l.type === 'titre' ? 'bg-zinc-50 dark:bg-zinc-800/20 italic' : ''}
                      ${l.type === 'commentaire' ? 'text-zinc-400' : ''}
                    `}
                  >
                    <td className="px-1 py-1 pl-8 text-zinc-300 cursor-grab">⠿</td>
                    <td className="px-2 py-0.5 text-xs text-zinc-400">
                      <EditableCell rKey={rKey} field="numero" value={l.numero} className="text-xs" />
                    </td>
                    <td className="px-2 py-0.5">
                      <EditableCell rKey={rKey} field="designation" value={l.designation} />
                    </td>
                    <td className="px-2 py-0.5 text-center">
                      <EditableCell rKey={rKey} field="unite" value={l.unite} className="text-center" />
                    </td>
                    <td className="px-2 py-0.5">
                      <EditableCell rKey={rKey} field="quantite" value={l.quantite} numeric />
                    </td>
                    <td className="px-2 py-0.5">
                      <EditableCell rKey={rKey} field="prixUnitaire" value={l.prixUnitaire} numeric />
                    </td>
                    <td className="px-2 py-0.5 text-right font-mono text-[#1e5090] font-medium">
                      <EditableCell rKey={rKey} field="prixTotal" value={l.prixTotal} numeric />
                    </td>
                    <td className="px-1 py-0.5">
                      <button onClick={() => deleteLigne(row.lotIdx, row.chapIdx!, row.ligneIdx!)} className="text-red-400 hover:text-red-600 opacity-40 hover:opacity-100">
                        <IconX size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* Totals row */}
              <tr className="bg-[#1e5090] text-white font-bold">
                <td colSpan={6} className="px-4 py-2 text-sm">TOTAL HT</td>
                <td className="px-2 py-2 text-right font-mono">{formatCurrency(dpgf.totalHT)}</td>
                <td />
              </tr>
              <tr className="bg-[#2563eb]/10 text-zinc-700 dark:text-zinc-300">
                <td colSpan={6} className="px-4 py-1.5 text-sm">TVA {dpgf.TVA}%</td>
                <td className="px-2 py-1.5 text-right font-mono text-sm">
                  {formatCurrency(dpgf.totalTTC - dpgf.totalHT)}
                </td>
                <td />
              </tr>
              <tr className="bg-[#1e5090]/90 text-white font-bold">
                <td colSpan={6} className="px-4 py-2">TOTAL TTC</td>
                <td className="px-2 py-2 text-right font-mono">{formatCurrency(dpgf.totalTTC)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
