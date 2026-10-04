import { useTranslation } from 'react-i18next';
import { duplicateHierarchy, canMove, moveHierarchy, promoteHierarchy, hierarchyKey } from './hierarchyOps';
import React, { useState, useCallback, useRef } from 'react';
import {
  IconPlus, IconTrash, IconCopy, IconClipboard, IconDeviceFloppy,
  IconFileTypePdf, IconTable, IconChevronRight, IconChevronDown,
  IconLayoutSidebar, IconArrowsMaximize, IconArrowsMinimize,
  IconRowInsertBottom, IconFolderPlus, IconStackPush,
  IconX, IconBuildingStore, IconFileImport, IconScale, IconBuildingCommunity,
  IconArrowUp, IconArrowDown,
} from '@tabler/icons-react';
import { ProRibbon, RibbonTabDef } from './ProRibbon';
import { DPGF, Lot, Chapitre, Ligne, type OffreDocument, type GroupementDpgf } from '../../types/dpgf';
import { exportDPGFtoPDF, exportDPGFtoExcel } from '../../lib/proExport';
import { useSettings } from '../../hooks/useSettings';
import { formatCurrency } from '../../lib/utils';
import { PriceLibraryPanel } from './PriceLibraryPanel';
import { DecoupagePanel, SelecteursDecoupage } from './DecoupagePanel';
import { DpgfGroupedView } from './DpgfGroupedView';
import type { ArticleBibliotheque } from '../../types/library';

// Les helpers d'arbre, l'évaluateur de formules et l'aplatissement vivent
// désormais dans treeOps.ts, partagés avec l'atelier BPU/DQE.
import {
  uid, evalFormula, MAX_ARTICLE_DEPTH, childNumber,
  mutateLigneAtPath, deleteLigneAtPath, addChildToLigneAtPath,
  takeLigneAtPath, insertLigneAtPath, renumeroterLignes,
  collectLigneIdsWithChildren, sumLigne, recomputeLot as recomputeLotOp,
  buildFlatRows, rowKey as rowKeyOf, parseRowKey,
  type FlatRow,
} from './treeOps';

interface EditingCell {
  rowKey: string;
  field: string;
  value: string;
}

// Déclarés au niveau module : redéfinis à l'intérieur de DPGFWorkspace, ces
// composants changeaient d'identité à chaque rendu du parent, ce que React
// traite comme un composant entièrement différent — il démontait puis
// remontait l'input à chaque frappe, réinitialisant son état local `v` à la
// valeur d'origine. D'où le texte qui s'effaçait sauf à taper plus vite que
// le cycle de rendu, et l'édition qui ne se commitait jamais vraiment.
const CellInput = ({
  value, onCommit, onCancel, className = '',
}: { value: string; onCommit: (v: string) => void; onCancel: () => void; className?: string }) => {
  const [v, setV] = useState(value);
  return (
    <input
      autoFocus
      value={v}
      onChange={e => setV(e.target.value)}
      onFocus={e => e.target.select()}
      onBlur={() => onCommit(v)}
      onKeyDown={e => {
        if (e.key === 'Enter') { onCommit(v); e.currentTarget.blur(); }
        if (e.key === 'Escape') { onCancel(); }
      }}
      className={`w-full px-1 py-0 bg-[#fffde7] border border-blue-400 rounded outline-none text-sm font-mono ${className}`}
    />
  );
};

const EditableCell = ({
  rKey, field, value, editingCell, onStartEdit, onCommit, onCancel, numeric = false, className = '',
}: {
  rKey: string; field: string; value: string | number; editingCell: EditingCell | null;
  onStartEdit: (rKey: string, field: string, value: string | number) => void;
  onCommit: (v: string) => void; onCancel: () => void; numeric?: boolean; className?: string;
}) => {
  const isEditing = editingCell?.rowKey === rKey && editingCell?.field === field;
  const display = numeric && typeof value === 'number' && value > 0
    ? new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    : String(value || '');

  if (isEditing) {
    return (
      <CellInput
        value={editingCell.value}
        onCommit={onCommit}
        onCancel={onCancel}
        className={className}
      />
    );
  }
  return (
    <div
      onDoubleClick={() => onStartEdit(rKey, field, value)}
      className={`px-1 py-0.5 cursor-text hover:bg-blue-50 rounded min-h-[22px] ${numeric ? 'text-right font-mono' : ''} ${className}`}
      title="Double-clic pour éditer"
    >
      {display}
    </div>
  );
};

interface DragState {
  rowKey: string;
  ligne: Ligne;
  sourceLotIdx: number;
  sourceChapIdx: number;
  sourcePath: number[];
}

interface DPGFWorkspaceProps {
  dpgf: DPGF;
  onChange: (dpgf: DPGF) => void;
  onSave: () => void;
  projectName?: string;
  onDropExternal?: (ligne: Ligne) => void;
  onDragStart?: (ligne: Ligne) => void;
  showTree?: boolean;
  onToggleTree?: () => void;
  /** Ouvre l'import d'une offre reçue sur ce DPGF. Absent tant que ProTab ne le fournit pas. */
  onImportOffre?: () => void;
  /** Verse le DPGF et ses offres au comparatif détaillé du module ACT. */
  onPushToAct?: () => void;
  /** Juste pour désactiver « Verser au comparatif » tant qu'aucune offre n'est reçue. */
  offres?: OffreDocument[];
}

export const DPGFWorkspace: React.FC<DPGFWorkspaceProps> = ({
  dpgf, onChange, onSave, projectName, onDropExternal, onDragStart,
  showTree: showTreeProp, onToggleTree, onImportOffre, onPushToAct, offres = [],
}) => {
  const { settings } = useSettings();
  // ── UI state ────────────────────────────────────────────────────────────────
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set(dpgf.lots.map(l => l.id)));
  const [expandedChaps, setExpandedChaps] = useState<Set<string>>(
    new Set(dpgf.lots.flatMap(l => l.chapitres.map(c => c.id)))
  );
  const [expandedLignes, setExpandedLignes] = useState<Set<string>>(new Set());
  const [localShowTree, setLocalShowTree] = useState(true);
  const showTree = showTreeProp !== undefined ? showTreeProp : localShowTree;
  const toggleTree = onToggleTree ?? (() => setLocalShowTree(v => !v));
  const [selectedLotId, setSelectedLotId] = useState<string | null>(dpgf.lots[0]?.id ?? null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [clipboard, setClipboard] = useState<Ligne | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showDecoupage, setShowDecoupage] = useState(false);
  const { t } = useTranslation();
  const [groupement, setGroupement] = useState<GroupementDpgf>('lot');
  // Chapitre visé par une insertion depuis la bibliothèque : le DPGF ne
  // sélectionnait que le lot, ce qui ne suffit pas à savoir où poser un article.
  const [selectedChapId, setSelectedChapId] = useState('');
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const targets = dpgf.lots.flatMap((lot, lotIdx) => lot.chapitres.filter(c => !c.cctpOnly).map(chap => ({
    id: chap.id, lotIdx, chapIdx: lot.chapitres.findIndex(c => c.id === chap.id), label: `${lot.numero} ${lot.titre} / ${chap.numero} ${chap.titre}`,
  })));
  const selectedChap = targets.find(c => c.id === selectedChapId) ?? (!selectedChapId && targets.length === 1 ? targets[0] : null);
  const [insertMessage, setInsertMessage] = useState('');
  const tableRef = useRef<HTMLDivElement>(null);

  // ── Derived flat rows ────────────────────────────────────────────────────────
  // Nombre de colonnes ajoutées en queue de tableau par le découpage
  // (bâtiment, phase — chacune conditionnelle — et localisation, toujours
  // présente). Sert à étendre le colSpan des lignes de totaux en pied de
  // tableau, qui ne connaissent pas ces colonnes autrement.
  const nbColsDecoupage = (dpgf.multiBatiments ? 1 : 0) + (dpgf.multiPhases ? 1 : 0) + 1;

  const flatRows: FlatRow<Lot, Chapitre, Ligne>[] =
    buildFlatRows(dpgf.lots, { expandedLots, expandedChaps, expandedLignes });

  const rowKey = rowKeyOf;

  // ── Mutate helpers ───────────────────────────────────────────────────────────
  const mutateLots = useCallback((fn: (lots: Lot[]) => Lot[]) => {
    const newLots = fn(JSON.parse(JSON.stringify(dpgf.lots)));
    const totalHT = newLots.reduce((s, l) => s + l.sousTotal, 0);
    onChange({ ...dpgf, lots: newLots, totalHT, totalTTC: totalHT * (1 + dpgf.TVA / 100) });
  }, [dpgf, onChange]);

  const recomputeLot = recomputeLotOp<Lot>;

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
  const toggleLigne = (id: string) => setExpandedLignes(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });

  // ── Add / Remove ──────────────────────────────────────────────────────────────
  const addLot = () => {
    const newLotIdx = dpgf.lots.length;
    const newLotId = uid();
    const newLot: Lot = {
      id: newLotId,
      numero: String(newLotIdx + 1).padStart(2, '0'),
      titre: 'Nouveau lot',
      chapitres: [],
      sousTotal: 0,
    };
    mutateLots(lots => [...lots, newLot]);
    setExpandedLots(prev => new Set([...prev, newLotId]));
    setSelectedLotId(newLotId);
    setEditingCell({ rowKey: `lot-${newLotIdx}`, field: 'titre', value: 'Nouveau lot' });
  };

  const addChapitre = () => {
    if (!selectedLotId) return;
    const lotIdx = dpgf.lots.findIndex(l => l.id === selectedLotId);
    if (lotIdx < 0) return;
    const chapIdx = dpgf.lots[lotIdx].chapitres.length;
    const newChapId = uid();
    mutateLots(lots => lots.map(lot => {
      if (lot.id !== selectedLotId) return lot;
      const newChap: Chapitre = {
        id: newChapId,
        numero: `${lot.numero}.${lot.chapitres.length + 1}`,
        titre: 'Nouveau chapitre',
        lignes: [],
      };
      return { ...lot, chapitres: [...lot.chapitres, newChap] };
    }));
    setExpandedChaps(prev => new Set([...prev, newChapId]));
    setEditingCell({ rowKey: `chap-${lotIdx}-${chapIdx}`, field: 'titre', value: 'Nouveau chapitre' });
  };

  const addLigne = (lotIdx: number, chapIdx: number) => {
    const chap = dpgf.lots[lotIdx].chapitres[chapIdx];
    const newLigneIdx = chap.lignes.length;
    const newLigne: Ligne = {
      id: uid(),
      numero: `${chap.numero}.${newLigneIdx + 1}`,
      designation: 'Nouvel article',
      unite: 'u',
      quantite: 0,
      prixUnitaire: 0,
      prixTotal: 0,
      type: 'ouvrage',
      children: [],
    };
    mutateLots(lots => {
      const newLots = [...lots];
      const lot = { ...newLots[lotIdx] };
      const c = { ...lot.chapitres[chapIdx] };
      c.lignes = [...c.lignes, newLigne];
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), c, ...lot.chapitres.slice(chapIdx + 1)];
      newLots[lotIdx] = recomputeLot(lot);
      return newLots;
    });
    setEditingCell({ rowKey: `ligne-${lotIdx}-${chapIdx}-${newLigneIdx}`, field: 'designation', value: 'Nouvel article' });
  };

  // ── Bibliothèque d'ouvrages ─────────────────────────────────────────────────
  // Un article de la bibliothèque devient ici une ligne de DPGF : quantité à 0,
  // que le maître d'œuvre renseigne, et `articleTypeId` conservé — c'est par ce
  // fil que le prix remontera vers la bibliothèque quand une offre arrivera.
  const insererDepuisBibliotheque = (articles: ArticleBibliotheque[]) => {
    if (!selectedChap) { setInsertMessage('Choisissez un chapitre de destination.'); return false; }
    const { lotIdx, chapIdx } = selectedChap;
    // Les clés de ligne sont positionnelles : une insertion par programme
    // pendant une édition validerait dans le mauvais article.
    setEditingCell(null);
    mutateLots(lots => {
      const next = [...lots];
      const lot = { ...next[lotIdx] };
      const chap = { ...lot.chapitres[chapIdx] };
      const base = chap.lignes.length;
      chap.lignes = [...chap.lignes, ...articles.map((a, i) => ({
        id: uid(),
        numero: a.code || `${chap.numero}.${base + i + 1}`,
        designation: a.designation,
        unite: a.unite || 'u',
        quantite: 0,
        prixUnitaire: Number(a.prix_unitaire) || 0,
        prixTotal: 0,
        type: 'ouvrage' as const,
        children: [],
        articleTypeId: a.id,
        // La description technique de l'article amorce le CCTP du même coup.
        cctpDescription: a.description ?? undefined,
      }))];
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), chap, ...lot.chapitres.slice(chapIdx + 1)];
      next[lotIdx] = recomputeLot(lot);
      return next;
    });
    setExpandedLots(prev => new Set([...prev, dpgf.lots[lotIdx].id]));
    setExpandedChaps(prev => new Set([...prev, dpgf.lots[lotIdx].chapitres[chapIdx].id]));
    setInsertMessage(`${articles.length} article(s) inséré(s) dans ${selectedChap.label}.`);
    return true;
  };

  const addSubLigne = (lotIdx: number, chapIdx: number, parentLignePath: number[]) => {
    if (1 + parentLignePath.length >= MAX_ARTICLE_DEPTH) return;
    // Find parent to get its id and current children count
    let parentLigne = dpgf.lots[lotIdx].chapitres[chapIdx].lignes[parentLignePath[0]];
    for (let i = 1; i < parentLignePath.length; i++) {
      parentLigne = parentLigne.children![parentLignePath[i]];
    }
    const childIdx = (parentLigne.children || []).length;
    const newChildPath = [...parentLignePath, childIdx];
    const parentId = parentLigne.id;
    const newLigne: Ligne = {
      id: uid(),
      numero: childNumber(parentLigne.numero, childIdx, 2 + parentLignePath.length),
      designation: 'Nouvel article',
      unite: 'u',
      quantite: 0,
      prixUnitaire: 0,
      prixTotal: 0,
      type: 'ouvrage',
      children: [],
    };
    mutateLots(lots => {
      const newLots = [...lots];
      const lot = { ...newLots[lotIdx] };
      const chap = { ...lot.chapitres[chapIdx] };
      chap.lignes = addChildToLigneAtPath([...chap.lignes], parentLignePath, newLigne);
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), chap, ...lot.chapitres.slice(chapIdx + 1)];
      newLots[lotIdx] = recomputeLot(lot);
      return newLots;
    });
    setExpandedLignes(prev => new Set([...prev, parentId]));
    setEditingCell({ rowKey: `ligne-${lotIdx}-${chapIdx}-${newChildPath.join('-')}`, field: 'designation', value: 'Nouvel article' });
  };

  const deleteLigne = (lotIdx: number, chapIdx: number, lignePath: number[]) => {
    mutateLots(lots => {
      const newLots = [...lots];
      const lot = { ...newLots[lotIdx] };
      const chap = { ...lot.chapitres[chapIdx] };
      chap.lignes = deleteLigneAtPath([...chap.lignes], lignePath);
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
  const startEdit = (rKey: string, field: string, currentValue: string | number) => {
    setEditingCell({ rowKey: rKey, field, value: String(currentValue) });
  };

  const commitEdit = (overrideValue?: string) => {
    if (!editingCell) return;
    const { rowKey: rKey, field } = editingCell;
    const value = overrideValue !== undefined ? overrideValue : editingCell.value;

    const parsed = parseRowKey(rKey);
    if (!parsed) { setEditingCell(null); return; }

    if (parsed.kind === 'ligne') {
      const { lotIdx: li, chapIdx: ci, lignePath } = parsed;
      mutateLots(lots => {
        const newLots = [...lots];
        const lot = { ...newLots[li] };
        const chap = { ...lot.chapitres[ci] };
        chap.lignes = mutateLigneAtPath([...chap.lignes], lignePath, ligne => {
          if (field === 'designation') return { ...ligne, designation: value };
          if (field === 'unite') return { ...ligne, unite: value };
          if (field === 'numero') return { ...ligne, numero: value };
          if (field === 'quantite') {
            const q = evalFormula(value);
            return { ...ligne, quantite: q, prixTotal: q * ligne.prixUnitaire };
          }
          if (field === 'prixUnitaire') {
            const pu = evalFormula(value);
            return { ...ligne, prixUnitaire: pu, prixTotal: ligne.quantite * pu };
          }
          if (field === 'prixTotal') {
            return { ...ligne, prixTotal: evalFormula(value) };
          }
          if (field === 'localisation') {
            return { ...ligne, localisation: value };
          }
          return ligne;
        });
        lot.chapitres = [...lot.chapitres.slice(0, ci), chap, ...lot.chapitres.slice(ci + 1)];
        newLots[li] = recomputeLot(lot);
        return newLots;
      });
    } else if (parsed.kind === 'chapitre') {
      const { lotIdx: li, chapIdx: ci } = parsed;
      mutateLots(lots => {
        const newLots = [...lots];
        const lot = { ...newLots[li] };
        const chap = { ...lot.chapitres[ci], [field === 'titre' ? 'titre' : field]: value };
        lot.chapitres = [...lot.chapitres.slice(0, ci), chap, ...lot.chapitres.slice(ci + 1)];
        newLots[li] = lot;
        return newLots;
      });
    } else if (parsed.kind === 'lot') {
      const { lotIdx: li } = parsed;
      mutateLots(lots => {
        const newLots = [...lots];
        newLots[li] = { ...newLots[li], [field === 'titre' ? 'titre' : field]: value };
        return newLots;
      });
    }
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);

  /**
   * Pose batimentId/phaseId sur un lot, un chapitre ou un article, identifié
   * par sa clé de ligne — même dispatch que commitEdit, mais un <select>
   * s'applique tout de suite, sans passer par l'état d'édition en cours.
   */
  const setDecoupageChamp = (rKey: string, champ: 'batimentId' | 'phaseId', valeur: string | undefined) => {
    const parsed = parseRowKey(rKey);
    if (!parsed) return;
    if (parsed.kind === 'ligne') {
      const { lotIdx: li, chapIdx: ci, lignePath } = parsed;
      mutateLots(lots => {
        const newLots = [...lots];
        const lot = { ...newLots[li] };
        const chap = { ...lot.chapitres[ci] };
        chap.lignes = mutateLigneAtPath([...chap.lignes], lignePath, ligne => ({ ...ligne, [champ]: valeur }));
        lot.chapitres = [...lot.chapitres.slice(0, ci), chap, ...lot.chapitres.slice(ci + 1)];
        newLots[li] = recomputeLot(lot);
        return newLots;
      });
    } else if (parsed.kind === 'chapitre') {
      const { lotIdx: li, chapIdx: ci } = parsed;
      mutateLots(lots => {
        const newLots = [...lots];
        const lot = { ...newLots[li] };
        lot.chapitres = lot.chapitres.map((c, i) => i === ci ? { ...c, [champ]: valeur } : c);
        newLots[li] = lot;
        return newLots;
      });
    } else if (parsed.kind === 'lot') {
      const { lotIdx: li } = parsed;
      mutateLots(lots => lots.map((l, i) => i === li ? { ...l, [champ]: valeur } : l));
    }
  };

  // ── Clipboard ────────────────────────────────────────────────────────────────
  const copySelected = () => {
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
      chap.lignes = [...chap.lignes, { ...clipboard, id: uid(), children: [] }];
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), chap, ...lot.chapitres.slice(chapIdx + 1)];
      newLots[lotIdx] = recomputeLot(lot);
      return newLots;
    });
  };

  // ── Expand / Collapse all ─────────────────────────────────────────────────────
  const expandAll = () => {
    setExpandedLots(new Set(dpgf.lots.map(l => l.id)));
    setExpandedChaps(new Set(dpgf.lots.flatMap(l => l.chapitres.map(c => c.id))));
    const allLigneIds = new Set<string>();
    dpgf.lots.forEach(lot => lot.chapitres.forEach(chap => collectLigneIdsWithChildren(chap.lignes, allLigneIds)));
    setExpandedLignes(allLigneIds);
  };
  const collapseAll = () => {
    setExpandedLots(new Set());
    setExpandedChaps(new Set());
    setExpandedLignes(new Set());
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
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-archioffice-row', JSON.stringify({ rowKey: rowKey(row) }));
    e.dataTransfer.setData('application/json', JSON.stringify(row.ligne));
    setDragState({ rowKey: rowKey(row), ligne: row.ligne, sourceLotIdx: row.lotIdx, sourceChapIdx: row.chapIdx!, sourcePath: row.lignePath || [] });
    onDragStart?.(row.ligne);
  };

  const handleDragOver = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = dragState ? 'move' : 'copy';
    setDropTarget(targetKey);
  };

  const handleDrop = (e: React.DragEvent, targetRow: FlatRow) => {
    e.preventDefault();
    setDropTarget(null);
    const internal = e.dataTransfer.getData('application/x-archioffice-row');
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    if (internal && dragState && targetRow.chapIdx !== undefined && targetRow.kind !== 'lot') {
      const targetPath = targetRow.kind === 'ligne' ? (targetRow.lignePath || []) : [];
      if (dragState.sourceLotIdx === targetRow.lotIdx && dragState.sourceChapIdx === targetRow.chapIdx &&
          (targetPath.length === dragState.sourcePath.length && targetPath.every((n, i) => n === dragState.sourcePath[i]))) {
        setDragState(null); return;
      }
      mutateLots(lots => {
        const next = lots.map(l => ({ ...l, chapitres: l.chapitres.map(c => ({ ...c, lignes: [...c.lignes] })) }));
        const source = next[dragState.sourceLotIdx]?.chapitres[dragState.sourceChapIdx];
        if (!source) return lots;
        const taken = takeLigneAtPath(source.lignes, dragState.sourcePath);
        if (!taken.ligne) return lots;
        source.lignes = taken.lignes;
        const dest = next[targetRow.lotIdx]?.chapitres[targetRow.chapIdx!];
        if (!dest) return lots;
        const insertIndex = targetRow.kind === 'ligne' ? targetPath[targetPath.length - 1] : dest.lignes.length;
        const parentPath = targetRow.kind === 'ligne' ? targetPath.slice(0, -1) : [];
        dest.lignes = insertLigneAtPath(dest.lignes, parentPath, insertIndex, taken.ligne);
        source.lignes = renumeroterLignes(source.lignes, String(source.numero || dragState.sourceChapIdx + 1));
        if (source !== dest) dest.lignes = renumeroterLignes(dest.lignes, String(dest.numero || targetRow.chapIdx! + 1));
        return next.map(l => recomputeLot(l));
      });
    } else if (targetRow.chapIdx !== undefined) {
      const ligne: Ligne = JSON.parse(raw);
      mutateLots(lots => {
        const newLots = [...lots];
        const lot = { ...newLots[targetRow.lotIdx] };
        const chap = { ...lot.chapitres[targetRow.chapIdx!] };
        chap.lignes = renumeroterLignes([...chap.lignes, { ...ligne, id: uid(), children: [] }], String(chap.numero || targetRow.chapIdx! + 1));
        lot.chapitres = [...lot.chapitres.slice(0, targetRow.chapIdx!), chap, ...lot.chapitres.slice(targetRow.chapIdx! + 1)];
        newLots[targetRow.lotIdx] = recomputeLot(lot);
        return newLots;
      });
      onDropExternal?.(ligne);
    }
    setDragState(null);
  };

  const hierarchySelection = groupement === 'lot' && selectedRowKey ? parseRowKey(selectedRowKey) : null;
  const changeHierarchy = (direction?: -1 | 1 | 'duplicate') => {
    if (!hierarchySelection) return;
    const result = direction === 'duplicate'
      ? duplicateHierarchy(dpgf.lots, hierarchySelection, () => crypto.randomUUID())
      : direction === undefined
      ? promoteHierarchy(dpgf.lots, hierarchySelection, () => crypto.randomUUID())
      : moveHierarchy(dpgf.lots, hierarchySelection, direction);
    mutateLots(() => result.lots);
    setSelectedRowKey(hierarchyKey(result.selection));
    const selected = result.selection;
    if (selected.kind !== 'lot') {
      setSelectedLotId(result.lots[selected.lotIdx].id);
      setSelectedChapId(result.lots[selected.lotIdx].chapitres[selected.chapIdx].id);
    }
    setExpandedLots(new Set(result.lots.map(l => l.id)));
    setExpandedChaps(new Set(result.lots.flatMap(l => l.chapitres.map(c => c.id))));
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
            { id: 'moveUp', label: 'Monter', icon: <IconArrowUp size={20} />, onClick: () => changeHierarchy(-1), disabled: !canMove(dpgf.lots, hierarchySelection, -1) },
            { id: 'moveDown', label: 'Descendre', icon: <IconArrowDown size={20} />, onClick: () => changeHierarchy(1), disabled: !canMove(dpgf.lots, hierarchySelection, 1) },
            { id: 'duplicate', label: t('pro_duplicate'), icon: <IconPlus size={20} />, onClick: () => changeHierarchy('duplicate'), disabled: !hierarchySelection },
            { id: 'promote', label: t('pro_promote'), icon: <IconArrowUp size={20} />, onClick: () => changeHierarchy(), disabled: hierarchySelection?.kind !== 'ligne' },
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
          label: 'Bibliothèque',
          actions: [
            {
              id: 'openLib', label: 'Bibliothèque', icon: <IconBuildingStore size={20} />,
              onClick: () => { setGroupement('lot'); setShowLibrary(v => !v); }, active: showLibrary,
            },
            {
              id: 'decoupage', label: 'Bâtiments / phases', icon: <IconBuildingCommunity size={20} />,
              onClick: () => setShowDecoupage(v => !v), active: showDecoupage,
              badge: !!(dpgf.multiBatiments || dpgf.multiPhases),
            },
          ],
        },
        {
          label: 'Marché',
          actions: [
            { id: 'import', label: 'Importer une offre', icon: <IconFileImport size={20} />, onClick: () => onImportOffre?.(), disabled: !onImportOffre },
            { id: 'toAct', label: 'Verser au comparatif ACT', icon: <IconScale size={20} />, onClick: () => onPushToAct?.(), disabled: !onPushToAct || offres.length === 0 },
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
            { id: 'toggleTree', label: 'Arbre', icon: <IconLayoutSidebar size={20} />, onClick: toggleTree, active: showTree },
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
            { id: 'pdf', label: 'PDF', icon: <IconFileTypePdf size={20} />, onClick: () => exportDPGFtoPDF(dpgf, projectName, groupement, settings ?? {}) },
            { id: 'excel', label: 'Excel', icon: <IconTable size={20} />, onClick: () => exportDPGFtoExcel(dpgf, projectName, groupement, settings ?? {}) },
          ],
        },
      ],
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-zinc-900">
      <ProRibbon tabs={ribbonTabs} defaultTab="accueil" />
      <div className="px-3 py-1 border-b flex gap-3 items-center text-xs">
        <button className="text-blue-600" onClick={() => { setGroupement('lot'); setShowLibrary(v => !v); }}>Bibliothèque d’ouvrages</button>
        {insertMessage && <span role="status">{insertMessage}</span>}
      </div>

      {showDecoupage && (
        <DecoupagePanel
          doc={dpgf}
          onPatch={patch => onChange({ ...dpgf, ...patch })}
          onClose={() => setShowDecoupage(false)}
        />
      )}

      {/* Classement : l'arbre par lot reste la seule vue éditable ; les autres
          réordonnent les mêmes articles pour la lecture, sans les dupliquer. */}
      {(dpgf.multiBatiments || dpgf.multiPhases) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30">
          <label className="text-[0.6875rem] font-semibold uppercase tracking-wider text-zinc-500">Classement</label>
          <select
            className="px-2 py-1 text-xs border border-zinc-300 rounded outline-none focus:ring-1 focus:ring-blue-400"
            value={groupement}
            onChange={e => setGroupement(e.target.value as GroupementDpgf)}
          >
            <option value="lot">Par lot (éditable)</option>
            {dpgf.multiBatiments && <option value="batiment">Par bâtiment</option>}
            {dpgf.multiPhases && <option value="phase">Par phase</option>}
            {dpgf.multiBatiments && dpgf.multiPhases && <option value="batiment-phase">Par bâtiment et phase</option>}
          </select>
          {groupement !== 'lot' && (
            <span className="text-[0.6875rem] text-zinc-400">
              Lecture seule — repassez « Par lot » pour éditer. Les exports PDF/Excel suivent ce classement.
            </span>
          )}
        </div>
      )}

      {/* Main workspace */}
      {groupement !== 'lot' ? (
        <DpgfGroupedView dpgf={dpgf} groupement={groupement} />
      ) : (
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left tree panel ─────────────────────────────────────────────── */}
        {showTree && (
          <div className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-700 overflow-y-auto bg-[#f5f7fa] dark:bg-zinc-800/50 text-sm">
            <div className="px-3 py-2 text-[0.6875rem] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-700">
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
                {dpgf.multiBatiments && <th className="px-1 py-2 text-center font-semibold w-14">Bât.</th>}
                {dpgf.multiPhases && <th className="px-1 py-2 text-center font-semibold w-14">Phase</th>}
                <th className="px-2 py-2 text-left font-semibold w-28">Localisation</th>
                <th className="px-2 py-2 w-16"></th>
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
                      onClick={() => { setSelectedRowKey(rKey); setSelectedLotId(row.lot.id); }}
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
                        <EditableCell rKey={rKey} field="numero" value={row.lot.numero}  editingCell={editingCell} onStartEdit={startEdit} onCommit={commitEdit} onCancel={cancelEdit} />
                      </td>
                      <td className="px-2 py-1 font-bold text-sm" colSpan={4}>
                        <EditableCell rKey={rKey} field="titre" value={row.lot.titre}  editingCell={editingCell} onStartEdit={startEdit} onCommit={commitEdit} onCancel={cancelEdit} />
                      </td>
                      <td className="px-2 py-1 text-right font-bold text-sm font-mono text-[#1e5090]">
                        {formatCurrency(row.lot.sousTotal)}
                      </td>
                      {(dpgf.multiBatiments || dpgf.multiPhases) && (
                        <td className="px-1 py-1" colSpan={(dpgf.multiBatiments ? 1 : 0) + (dpgf.multiPhases ? 1 : 0)}>
                          <div className="flex items-center gap-1 justify-center">
                            <SelecteursDecoupage
                              doc={dpgf} batimentId={row.lot.batimentId} phaseId={row.lot.phaseId}
                              onBatimentChange={v => setDecoupageChamp(rKey, 'batimentId', v)}
                              onPhaseChange={v => setDecoupageChamp(rKey, 'phaseId', v)}
                            />
                          </div>
                        </td>
                      )}
                      <td className="px-1 py-1" />{/* pas de localisation au niveau lot */}
                      <td className="px-1 py-1">
                        <button onClick={() => deleteLot(row.lotIdx)} className="text-red-400 hover:text-red-600 opacity-60 hover:opacity-100">
                          <IconTrash size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                }

                if (row.kind === 'chapitre') {
                  const chapVise = showLibrary
                    && selectedChap?.lotIdx === row.lotIdx && selectedChap?.chapIdx === row.chapIdx;
                  return (
                    <tr
                      key={rKey}
                      className={`border-b border-zinc-200 dark:border-zinc-700 ${isDropTarget ? 'bg-blue-50 ring-1 ring-blue-300' : 'bg-[#edf1f7] dark:bg-zinc-800/40'} ${chapVise ? 'ring-1 ring-blue-500' : ''}`}
                      onClick={() => { setSelectedChapId(row.chapitre!.id); setSelectedLotId(row.lot.id); setSelectedRowKey(rKey); }}
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
                        <EditableCell rKey={rKey} field="numero" value={row.chapitre!.numero}  editingCell={editingCell} onStartEdit={startEdit} onCommit={commitEdit} onCancel={cancelEdit} />
                      </td>
                      <td className="px-2 py-1 font-semibold text-xs text-zinc-700 dark:text-zinc-300" colSpan={5}>
                        <EditableCell rKey={rKey} field="titre" value={row.chapitre!.titre}  editingCell={editingCell} onStartEdit={startEdit} onCommit={commitEdit} onCancel={cancelEdit} />
                      </td>
                      {(dpgf.multiBatiments || dpgf.multiPhases) && (
                        <td className="px-1 py-1" colSpan={(dpgf.multiBatiments ? 1 : 0) + (dpgf.multiPhases ? 1 : 0)}>
                          <div className="flex items-center gap-1 justify-center">
                            <SelecteursDecoupage
                              doc={dpgf} batimentId={row.chapitre!.batimentId} phaseId={row.chapitre!.phaseId}
                              onBatimentChange={v => setDecoupageChamp(rKey, 'batimentId', v)}
                              onPhaseChange={v => setDecoupageChamp(rKey, 'phaseId', v)}
                            />
                          </div>
                        </td>
                      )}
                      <td className="px-1 py-1" />{/* pas de localisation au niveau chapitre */}
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

                // ligne / article (depth 2 to MAX_ARTICLE_DEPTH)
                const l = row.ligne!;
                const hasChildren = !!(l.children && l.children.length > 0);
                const indentPx = (row.depth - 2) * 16;
                const canAddChild = row.depth < MAX_ARTICLE_DEPTH;

                return (
                  <tr
                    key={rKey}
                    onClick={() => setSelectedRowKey(rKey)}
                    draggable={!hasChildren}
                    onDragStart={e => handleDragStart(e, row)}
                    className={`border-b border-zinc-100 dark:border-zinc-800 hover:bg-[#f0f6ff] dark:hover:bg-zinc-800/60
                      ${hasChildren ? 'bg-zinc-50/80 dark:bg-zinc-800/20' : ''}
                      ${l.type === 'titre' ? 'italic' : ''}
                      ${l.type === 'commentaire' ? 'text-zinc-400' : ''}
                    `}
                  >
                    <td className="py-1 text-zinc-400" style={{ paddingLeft: `${4 + indentPx}px` }}>
                      {hasChildren ? (
                        <button onClick={() => toggleLigne(l.id)} className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                          {expandedLignes.has(l.id) ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                        </button>
                      ) : (
                        <span className="text-zinc-300 cursor-grab">⠿</span>
                      )}
                    </td>
                    <td className="px-2 py-0.5 text-xs text-zinc-400">
                      <EditableCell rKey={rKey} field="numero" value={l.numero} className="text-xs"  editingCell={editingCell} onStartEdit={startEdit} onCommit={commitEdit} onCancel={cancelEdit} />
                    </td>
                    <td className="px-2 py-0.5">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 min-w-0">
                          <EditableCell rKey={rKey} field="designation" value={l.designation}  editingCell={editingCell} onStartEdit={startEdit} onCommit={commitEdit} onCancel={cancelEdit} />
                        </div>
                        {/* Repère de provenance : cet article vient de la
                            bibliothèque du cabinet, c'est aussi lui qui permettra
                            au prix d'une offre d'y remonter. */}
                        {l.articleTypeId && (
                          <span
                            title="Article issu de la bibliothèque d’ouvrages"
                            className="shrink-0 text-[0.6875rem] font-bold px-1 py-px rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                          >
                            BIB
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-0.5 text-center">
                      <EditableCell rKey={rKey} field="unite" value={l.unite} className="text-center"  editingCell={editingCell} onStartEdit={startEdit} onCommit={commitEdit} onCancel={cancelEdit} />
                    </td>
                    <td className="px-2 py-0.5">
                      {l.quantitesBatiments !== undefined ? <span title="Modifier les quantités dans Articles et bâtiments">{l.quantite}</span> : (<EditableCell rKey={rKey} field="quantite" value={l.quantite} numeric  editingCell={editingCell} onStartEdit={startEdit} onCommit={commitEdit} onCancel={cancelEdit} />)}
                    </td>
                    <td className="px-2 py-0.5">
                      <EditableCell rKey={rKey} field="prixUnitaire" value={l.prixUnitaire} numeric  editingCell={editingCell} onStartEdit={startEdit} onCommit={commitEdit} onCancel={cancelEdit} />
                    </td>
                    <td className="px-2 py-0.5 text-right font-mono text-[#1e5090] font-medium">
                      {hasChildren ? (
                        <span className="px-1 py-0.5 text-sm text-zinc-500 italic">
                          {formatCurrency(sumLigne(l))}
                        </span>
                      ) : (
                        <EditableCell rKey={rKey} field="prixTotal" value={l.prixTotal} numeric  editingCell={editingCell} onStartEdit={startEdit} onCommit={commitEdit} onCancel={cancelEdit} />
                      )}
                    </td>
                    {(dpgf.multiBatiments || dpgf.multiPhases) && (
                      <td className="px-1 py-0.5" colSpan={(dpgf.multiBatiments ? 1 : 0) + (dpgf.multiPhases ? 1 : 0)}>
                        <div className="flex items-center gap-1 justify-center">
                          <SelecteursDecoupage
                            doc={l.quantitesBatiments !== undefined ? { ...dpgf, multiBatiments: false } : dpgf} batimentId={l.batimentId} phaseId={l.phaseId}
                            onBatimentChange={v => setDecoupageChamp(rKey, 'batimentId', v)}
                            onPhaseChange={v => setDecoupageChamp(rKey, 'phaseId', v)}
                          />
                        </div>
                      </td>
                    )}
                    <td className="px-2 py-0.5 text-xs text-zinc-500">
                      <EditableCell rKey={rKey} field="localisation" value={l.localisation || ''} className="text-xs"  editingCell={editingCell} onStartEdit={startEdit} onCommit={commitEdit} onCancel={cancelEdit} />
                    </td>
                    <td className="px-1 py-0.5 flex gap-0.5 items-center justify-end">
                      {canAddChild && (
                        <button
                          onClick={() => addSubLigne(row.lotIdx, row.chapIdx!, row.lignePath!)}
                          className="text-blue-400 hover:text-blue-600"
                          title="Ajouter sous-article"
                        >
                          <IconPlus size={11} />
                        </button>
                      )}
                      <button onClick={() => deleteLigne(row.lotIdx, row.chapIdx!, row.lignePath!)} className="text-red-400 hover:text-red-600 opacity-40 hover:opacity-100">
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
                <td colSpan={nbColsDecoupage} />
              </tr>
              <tr className="bg-[#2563eb]/10 text-zinc-700 dark:text-zinc-300">
                <td colSpan={6} className="px-4 py-1.5 text-sm">TVA {dpgf.TVA}%</td>
                <td className="px-2 py-1.5 text-right font-mono text-sm">
                  {formatCurrency(dpgf.totalTTC - dpgf.totalHT)}
                </td>
                <td colSpan={nbColsDecoupage} />
              </tr>
              <tr className="bg-[#1e5090]/90 text-white font-bold">
                <td colSpan={6} className="px-4 py-2">TOTAL TTC</td>
                <td className="px-2 py-2 text-right font-mono">{formatCurrency(dpgf.totalTTC)}</td>
                <td colSpan={nbColsDecoupage} />
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Bibliothèque d'ouvrages du cabinet ────────────────────────────── */}
        {showLibrary && (
          <PriceLibraryPanel
            onClose={() => setShowLibrary(false)}
            onInsert={insererDepuisBibliotheque}
            canInsert={!!selectedChap}
            targetSelector={<label className="text-xs block">Insérer dans le chapitre
              <select aria-label="Chapitre de destination" className="w-full border rounded p-1 mt-1" value={selectedChap?.id ?? ''} onChange={e => setSelectedChapId(e.target.value)}>
                <option value="">Choisir une destination</option>
                {targets.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              {!targets.length && <span>Ajoutez un chapitre au lot pour y insérer des ouvrages.</span>}
            </label>}
            hintCible="Sélectionnez d’abord un chapitre dans le DPGF"
          />
        )}
      </div>
      )}
    </div>
  );
};
