import React, { useState, useRef } from 'react';
import {
  IconFileTypePdf, IconTable, IconChevronRight, IconChevronDown,
  IconLayoutSidebar, IconArrowsMaximize, IconArrowsMinimize,
  IconLayoutColumns, IconRefresh, IconX, IconDeviceFloppy,
} from '@tabler/icons-react';
import { ProRibbon, RibbonTabDef } from './ProRibbon';
import { DPGF, Lot } from '../../types/dpgf';
import { exportEstimationtoPDF, exportEstimationtoExcel } from '../../lib/proExport';
import { formatCurrency } from '../../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type ColSet = 'synthese' | 'detail' | 'marge';

interface EstimationEditorProps {
  dpgf: DPGF;
  onChange: (dpgf: DPGF) => void;
  onSave: () => void;
  projectName?: string;
  /** External ligne dropped from another panel */
  externalDrop?: import('../../types/dpgf').Ligne | null;
  onDragStart?: (ligne: import('../../types/dpgf').Ligne) => void;
}

// ── helpers ───────────────────────────────────────────────────────────────────
let _uid = 0;
const uid = () => `est_${Date.now()}_${_uid++}`;

function evalFormula(raw: string): number {
  if (!raw.startsWith('=')) return parseFloat(raw) || 0;
  try {
    const expr = raw.slice(1).replace(/[^0-9+\-*/.() ]/g, '');
    // eslint-disable-next-line no-new-func
    return Function('"use strict"; return (' + expr + ')')() as number;
  } catch { return 0; }
}

function recomputeDPGF(dpgf: DPGF): DPGF {
  const newLots = dpgf.lots.map(lot => {
    const sousTotal = lot.chapitres.reduce(
      (s, c) => s + c.lignes.reduce((ls, l) => ls + l.prixTotal, 0), 0
    );
    return { ...lot, sousTotal };
  });
  const totalHT = newLots.reduce((s, l) => s + l.sousTotal, 0);
  return { ...dpgf, lots: newLots, totalHT, totalTTC: totalHT * (1 + dpgf.TVA / 100) };
}

// ── Component ─────────────────────────────────────────────────────────────────

export const EstimationEditor: React.FC<EstimationEditorProps> = ({
  dpgf, onChange, onSave, projectName, externalDrop, onDragStart,
}) => {
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set(dpgf.lots.map(l => l.id)));
  const [expandedChaps, setExpandedChaps] = useState<Set<string>>(
    new Set(dpgf.lots.flatMap(l => l.chapitres.map(c => c.id)))
  );
  const [showTree, setShowTree] = useState(true);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(dpgf.lots[0]?.id ?? null);
  const [colSet, setColSet] = useState<ColSet>('detail');
  const [editCell, setEditCell] = useState<{ rowId: string; field: string; value: string } | null>(null);
  const [tvaDraft, setTvaDraft] = useState(String(dpgf.TVA));
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const fmt2 = (n: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  // ── Lot-level editing (for Estimation, we mainly edit quantite + prixUnitaire) ──
  const mutateLigne = (lotIdx: number, chapIdx: number, ligneIdx: number, patch: Partial<import('../../types/dpgf').Ligne>) => {
    const newDpgf = JSON.parse(JSON.stringify(dpgf)) as DPGF;
    const ligne = { ...newDpgf.lots[lotIdx].chapitres[chapIdx].lignes[ligneIdx], ...patch };
    if (('quantite' in patch || 'prixUnitaire' in patch) && !('prixTotal' in patch)) {
      ligne.prixTotal = ligne.quantite * ligne.prixUnitaire;
    }
    newDpgf.lots[lotIdx].chapitres[chapIdx].lignes[ligneIdx] = ligne;
    onChange(recomputeDPGF(newDpgf));
  };

  const commitCell = (rawValue: string) => {
    if (!editCell) return;
    const { rowId, field } = editCell;
    const parts = rowId.split('-');
    if (parts[0] === 'ligne') {
      const [, li, ci, lgi] = parts.map(Number);
      const v = evalFormula(rawValue);
      mutateLigne(li, ci, lgi, { [field]: v });
    }
    setEditCell(null);
  };

  const startEdit = (rowId: string, field: string, currentVal: number | string) => {
    setEditCell({ rowId, field, value: String(currentVal) });
  };

  // ── TVA update ───────────────────────────────────────────────────────────────
  const applyTVA = () => {
    const tva = parseFloat(tvaDraft);
    if (!isNaN(tva)) {
      const newDpgf = { ...dpgf, TVA: tva, totalTTC: dpgf.totalHT * (1 + tva / 100) };
      onChange(newDpgf);
    }
  };

  // ── Expand/Collapse ───────────────────────────────────────────────────────────
  const toggleLot = (id: string) => setExpandedLots(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleChap = (id: string) => setExpandedChaps(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const expandAll = () => { setExpandedLots(new Set(dpgf.lots.map(l => l.id))); setExpandedChaps(new Set(dpgf.lots.flatMap(l => l.chapitres.map(c => c.id)))); };
  const collapseAll = () => { setExpandedLots(new Set()); setExpandedChaps(new Set()); };

  const scrollToLot = (lotId: string) => {
    setSelectedLotId(lotId);
    setExpandedLots(prev => new Set([...prev, lotId]));
    setTimeout(() => {
      tableRef.current?.querySelector(`[data-lot-id="${lotId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, ligne: import('../../types/dpgf').Ligne) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/json', JSON.stringify(ligne));
    onDragStart?.(ligne);
  };

  const handleDrop = (e: React.DragEvent, lotIdx: number, chapIdx: number) => {
    e.preventDefault();
    setDropTarget(null);
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    const ligne = { ...JSON.parse(raw) as import('../../types/dpgf').Ligne, id: uid() };
    const newDpgf = JSON.parse(JSON.stringify(dpgf)) as DPGF;
    newDpgf.lots[lotIdx].chapitres[chapIdx].lignes.push(ligne);
    onChange(recomputeDPGF(newDpgf));
  };

  // ── Ribbon ────────────────────────────────────────────────────────────────────
  const ribbonTabs: RibbonTabDef[] = [
    {
      id: 'accueil',
      label: 'Accueil',
      groups: [
        {
          label: 'Colonnes',
          actions: [
            { id: 'colSynthese', label: 'Synthèse', icon: <IconLayoutColumns size={20} />, onClick: () => setColSet('synthese'), active: colSet === 'synthese' },
            { id: 'colDetail', label: 'Détail', icon: <IconLayoutColumns size={20} />, onClick: () => setColSet('detail'), active: colSet === 'detail' },
            { id: 'colMarge', label: '+ Marge', icon: <IconLayoutColumns size={20} />, onClick: () => setColSet('marge'), active: colSet === 'marge' },
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
            { id: 'tree', label: 'Arbre', icon: <IconLayoutSidebar size={20} />, onClick: () => setShowTree(v => !v), active: showTree },
          ],
        },
        {
          label: 'Développement',
          actions: [
            { id: 'expand', label: 'Développer', icon: <IconArrowsMaximize size={20} />, onClick: expandAll },
            { id: 'collapse', label: 'Réduire', icon: <IconArrowsMinimize size={20} />, onClick: collapseAll },
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
            { id: 'pdf', label: 'PDF', icon: <IconFileTypePdf size={20} />, onClick: () => exportEstimationtoPDF(dpgf, projectName) },
            { id: 'excel', label: 'Excel', icon: <IconTable size={20} />, onClick: () => exportEstimationtoExcel(dpgf, projectName) },
          ],
        },
      ],
    },
  ];

  // ── Column definitions ────────────────────────────────────────────────────────
  const showQtyPU = colSet === 'detail' || colSet === 'marge';
  const showMarge = colSet === 'marge';

  // ── Editable number cell ──────────────────────────────────────────────────────
  const EditNum = ({ rowId, field, value }: { rowId: string; field: string; value: number }) => {
    const isEditing = editCell?.rowId === rowId && editCell?.field === field;
    if (isEditing) {
      return (
        <input
          autoFocus
          defaultValue={editCell!.value}
          onBlur={e => commitCell(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commitCell((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setEditCell(null);
          }}
          className="w-full px-1 py-0 bg-[#fffde7] border border-blue-400 rounded text-right font-mono text-sm outline-none"
        />
      );
    }
    return (
      <div
        className="text-right font-mono text-sm px-1 cursor-text hover:bg-blue-50 rounded min-h-[22px]"
        onDoubleClick={() => startEdit(rowId, field, value)}
        title="Double-clic pour éditer"
      >
        {value > 0 ? fmt2(value) : ''}
      </div>
    );
  };

  // ── Grand totals ──────────────────────────────────────────────────────────────
  const grandHT = dpgf.totalHT;
  const grandTVA = grandHT * dpgf.TVA / 100;
  const grandTTC = grandHT + grandTVA;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-zinc-900">
      <ProRibbon tabs={ribbonTabs} defaultTab="accueil" />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left tree ──────────────────────────────────────────────────── */}
        {showTree && (
          <div className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-700 overflow-y-auto bg-[#f5f7fa] dark:bg-zinc-800/50 text-sm">
            <div className="px-3 py-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-700">
              Lots / Chapitres
            </div>
            {dpgf.lots.map(lot => (
              <div key={lot.id}>
                <button
                  className={`w-full flex items-center justify-between gap-1 px-2 py-1.5 text-left hover:bg-blue-50 dark:hover:bg-zinc-700 text-xs
                    ${selectedLotId === lot.id ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 font-semibold' : 'font-medium text-zinc-700 dark:text-zinc-300'}`}
                  onClick={() => scrollToLot(lot.id)}
                >
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="shrink-0" onClick={e => { e.stopPropagation(); toggleLot(lot.id); }}>
                      {expandedLots.has(lot.id) ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                    </span>
                    <span className="font-bold text-zinc-400">{lot.numero}</span>
                    <span className="truncate">{lot.titre}</span>
                  </span>
                  <span className="text-[#1e5090] font-mono shrink-0 ml-1">{formatCurrency(lot.sousTotal)}</span>
                </button>
                {expandedLots.has(lot.id) && lot.chapitres.map(chap => (
                  <div key={chap.id} className="pl-6 pr-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
                    <span className="truncate">{chap.numero} {chap.titre}</span>
                  </div>
                ))}
              </div>
            ))}
            {/* TVA control */}
            <div className="border-t border-zinc-200 dark:border-zinc-700 mt-2 p-2">
              <div className="text-[11px] text-zinc-500 mb-1">TVA (%)</div>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={tvaDraft}
                  onChange={e => setTvaDraft(e.target.value)}
                  className="w-14 px-2 py-1 text-xs border border-zinc-300 rounded focus:ring-1 focus:ring-blue-400 outline-none"
                />
                <button onClick={applyTVA} className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                  <IconRefresh size={12} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Right table ─────────────────────────────────────────────────── */}
        <div ref={tableRef} className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: showMarge ? 900 : 700 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#1e5090] text-white text-xs">
                <th className="px-2 py-2 text-left w-24">N°</th>
                <th className="px-2 py-2 text-left">Désignation</th>
                <th className="px-2 py-2 text-center w-16">Unité</th>
                {showQtyPU && <th className="px-2 py-2 text-right w-24">Quantité</th>}
                {showQtyPU && <th className="px-2 py-2 text-right w-28">P.U. HT (€)</th>}
                <th className="px-2 py-2 text-right w-28">Total HT (€)</th>
                <th className="px-2 py-2 text-right w-28">Total TTC (€)</th>
                {showMarge && <th className="px-2 py-2 text-right w-24">Marge %</th>}
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {dpgf.lots.map((lot, li) => (
                <React.Fragment key={lot.id}>
                  {/* Lot header */}
                  <tr
                    data-lot-id={lot.id}
                    className="bg-[#c8d8ec] dark:bg-blue-900/30 border-b border-[#9ab0cb] font-bold"
                    onDragOver={e => { e.preventDefault(); setDropTarget(`lot-${li}`); }}
                    onDrop={e => { e.preventDefault(); setDropTarget(null); }}
                    onDragLeave={() => setDropTarget(null)}
                  >
                    <td className="px-2 py-2">
                      <button onClick={() => toggleLot(lot.id)} className="flex items-center gap-1 text-zinc-600">
                        {expandedLots.has(lot.id) ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        <span className="text-xs">{lot.numero}</span>
                      </button>
                    </td>
                    <td className="px-2 py-2 text-sm">{lot.titre}</td>
                    <td />
                    {showQtyPU && <td />}
                    {showQtyPU && <td />}
                    <td className="px-2 py-2 text-right font-mono text-[#1e5090]">{formatCurrency(lot.sousTotal)}</td>
                    <td className="px-2 py-2 text-right font-mono text-zinc-600">{formatCurrency(lot.sousTotal * (1 + dpgf.TVA / 100))}</td>
                    {showMarge && <td />}
                    <td />
                  </tr>

                  {expandedLots.has(lot.id) && lot.chapitres.map((chap, ci) => (
                    <React.Fragment key={chap.id}>
                      {/* Chapitre header */}
                      <tr
                        className={`bg-[#edf1f7] dark:bg-zinc-800/40 border-b border-zinc-200 ${dropTarget === `chap-${li}-${ci}` ? 'ring-1 ring-blue-400' : ''}`}
                        onDragOver={e => { e.preventDefault(); setDropTarget(`chap-${li}-${ci}`); }}
                        onDrop={e => handleDrop(e, li, ci)}
                        onDragLeave={() => setDropTarget(null)}
                      >
                        <td className="px-2 py-1 pl-6 text-xs text-zinc-500">
                          <button onClick={() => toggleChap(chap.id)} className="flex items-center gap-1">
                            {expandedChaps.has(chap.id) ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                            {chap.numero}
                          </button>
                        </td>
                        <td className="px-2 py-1 font-semibold text-xs text-zinc-700 dark:text-zinc-300" colSpan={showMarge ? 6 : 5}>
                          {chap.titre}
                        </td>
                        <td />
                      </tr>

                      {expandedChaps.has(chap.id) && chap.lignes.map((ligne, lgi) => {
                        const rowId = `ligne-${li}-${ci}-${lgi}`;
                        const ttc = ligne.prixTotal * (1 + dpgf.TVA / 100);
                        const margeVal = ligne.prixUnitaire > 0
                          ? ((ligne.prixUnitaire - (ligne.prixUnitaire * 0.7)) / ligne.prixUnitaire * 100) : 0;
                        return (
                          <tr
                            key={ligne.id}
                            draggable
                            onDragStart={e => { e.dataTransfer.setData('application/json', JSON.stringify(ligne)); onDragStart?.(ligne); }}
                            className={`border-b border-zinc-100 dark:border-zinc-800 hover:bg-[#f0f6ff] dark:hover:bg-zinc-800/60 cursor-grab
                              ${ligne.type === 'titre' ? 'bg-zinc-50 italic text-zinc-500' : ''}
                              ${ligne.type === 'commentaire' ? 'text-zinc-400' : ''}
                            `}
                          >
                            <td className="px-2 py-0.5 pl-8 text-xs text-zinc-400">{ligne.numero}</td>
                            <td className="px-2 py-0.5 text-sm">{ligne.designation}</td>
                            <td className="px-2 py-0.5 text-center text-xs text-zinc-500">{ligne.unite}</td>
                            {showQtyPU && (
                              <td className="px-1 py-0.5">
                                <EditNum rowId={rowId} field="quantite" value={ligne.quantite} />
                              </td>
                            )}
                            {showQtyPU && (
                              <td className="px-1 py-0.5">
                                <EditNum rowId={rowId} field="prixUnitaire" value={ligne.prixUnitaire} />
                              </td>
                            )}
                            <td className="px-1 py-0.5">
                              <EditNum rowId={rowId} field="prixTotal" value={ligne.prixTotal} />
                            </td>
                            <td className="px-2 py-0.5 text-right font-mono text-xs text-zinc-500">
                              {ttc > 0 ? fmt2(ttc) : ''}
                            </td>
                            {showMarge && (
                              <td className="px-2 py-0.5 text-right text-xs text-zinc-400">
                                {margeVal > 0 ? `${margeVal.toFixed(1)}%` : ''}
                              </td>
                            )}
                            <td className="px-1 py-0.5">
                              <button
                                onClick={() => {
                                  const newDpgf = JSON.parse(JSON.stringify(dpgf)) as DPGF;
                                  newDpgf.lots[li].chapitres[ci].lignes = chap.lignes.filter((_, i) => i !== lgi);
                                  onChange(recomputeDPGF(newDpgf));
                                }}
                                className="text-red-400 hover:text-red-600 opacity-40 hover:opacity-100"
                              >
                                <IconX size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}

              {/* Grand totals */}
              <tr className="bg-[#edf1f7] dark:bg-zinc-800/30">
                <td colSpan={showQtyPU ? 5 : 3} className="px-4 py-2 text-sm text-zinc-600 font-semibold">
                  TVA {dpgf.TVA}%
                </td>
                <td className="px-2 py-2 text-right font-mono text-zinc-600">{formatCurrency(grandTVA)}</td>
                <td className="px-2 py-2 text-right font-mono text-zinc-600">{formatCurrency(grandTVA)}</td>
                {showMarge && <td />}
                <td />
              </tr>
              <tr className="bg-[#1e5090] text-white font-bold">
                <td colSpan={showQtyPU ? 5 : 3} className="px-4 py-2 text-sm">TOTAL HT</td>
                <td className="px-2 py-2 text-right font-mono">{formatCurrency(grandHT)}</td>
                <td className="px-2 py-2 text-right font-mono text-blue-200">{formatCurrency(grandHT)}</td>
                {showMarge && <td />}
                <td />
              </tr>
              <tr className="bg-[#1a4080] text-white font-bold">
                <td colSpan={showQtyPU ? 5 : 3} className="px-4 py-3 text-base">TOTAL TTC</td>
                <td className="px-2 py-3 text-right font-mono text-blue-200">{formatCurrency(grandHT)}</td>
                <td className="px-2 py-3 text-right font-mono text-lg">{formatCurrency(grandTTC)}</td>
                {showMarge && <td />}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
