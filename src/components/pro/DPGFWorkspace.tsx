import { useTranslation } from 'react-i18next';
import { canDemote, demoteHierarchy, duplicateHierarchy, canMove, moveHierarchy, promoteHierarchy, hierarchyKey, type HierarchySelection } from './hierarchyOps';
import React, { useState, useRef } from 'react';
import {
  IconPlus, IconTrash, IconCopy, IconClipboard, IconFileTypePdf, IconTable,
  IconChevronRight, IconChevronDown, IconArrowsMaximize, IconArrowsMinimize,
  IconRowInsertBottom, IconFolderPlus, IconStackPush, IconBuildingStore,
  IconFileImport, IconScale, IconBuildingCommunity, IconArrowUp, IconArrowDown,
  IconArrowBarToLeft, IconArrowBarToRight, IconDots, IconDownload, IconLayoutSidebarLeftCollapse,
  IconSubtask,
} from '@tabler/icons-react';
import { DPGF, Lot, Chapitre, Ligne, type OffreDocument, type GroupementDpgf } from '../../types/dpgf';
import { exportDPGFtoPDF, exportDPGFtoExcel } from '../../lib/proExport';
import { useGroupementMembers } from './GroupementContext';
import { useSettings } from '../../hooks/useSettings';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatCurrency } from '../../lib/utils';
import { PriceLibraryPanel } from './PriceLibraryPanel';
import { DecoupagePanel, SelecteursDecoupage } from './DecoupagePanel';
import { DpgfGroupedView } from './DpgfGroupedView';
import { DpgfMobileList } from './DpgfMobileList';
import { EditableCell, type EditingCell } from './EditableCell';
import type { ArticleBibliotheque } from '../../types/library';
import { useProToolbar, type ToolbarMenuEntry } from './toolbar/proToolbar';
import { ToolbarMenu } from './toolbar/ToolbarMenu';
import { SelectionBar, type SelectionAction } from './toolbar/SelectionBar';
import { collectSelectedLignes, deleteSelection, parseSelection, pasteLignes, totauxDocument } from './selectionOps';
import {
  basculerBatimentEnMasse, batimentsParOrdre, etatBatimentSelection, feuillesSelectionnees, fixerQuantiteBatiment,
  heritagePour, modifierFeuilles, quantitesParBatiment,
} from '../../lib/batimentsArticles';
import { forBuilding } from '../../lib/dpgfBuildings';

// Les helpers d'arbre, l'évaluateur de formules et l'aplatissement vivent
// désormais dans treeOps.ts, partagés avec l'atelier BPU/DQE.
import {
  uid, evalFormula, MAX_ARTICLE_DEPTH, childNumber,
  mutateLigneAtPath, addChildToLigneAtPath,
  takeLigneAtPath, insertLigneAtPath, renumeroterLignes,
  collectLigneIdsWithChildren, sumLigne, recomputeLot as recomputeLotOp,
  buildFlatRows, rowKey as rowKeyOf, parseRowKey,
  type FlatRow,
} from './treeOps';

interface DragState {
  rowKey: string;
  ligne: Ligne;
  sourceLotIdx: number;
  sourceChapIdx: number;
  sourcePath: number[];
}

/** Message bref de l'atelier, avec au besoin un bouton (« Annuler »). */
export type ProNotify = (message: string, opts?: { type?: 'success' | 'error'; action?: { label: string; onClick: () => void } }) => void;

interface DPGFWorkspaceProps {
  dpgf: DPGF;
  onChange: (dpgf: DPGF) => void;
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
  notify?: ProNotify;
}

const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['TEXTAREA', 'SELECT'].includes(el.tagName)
    || (el instanceof HTMLInputElement && el.type !== 'checkbox'));

export const DPGFWorkspace: React.FC<DPGFWorkspaceProps> = ({
  dpgf, onChange, projectName, onDropExternal, onDragStart,
  showTree: showTreeProp, onToggleTree, onImportOffre, onPushToAct, offres = [], notify,
}) => {
  const { settings } = useSettings();
  const cotraitants = useGroupementMembers();
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 767px)');
  // ── UI state ────────────────────────────────────────────────────────────────
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set(dpgf.lots.map(l => l.id)));
  const [expandedChaps, setExpandedChaps] = useState<Set<string>>(
    new Set(dpgf.lots.flatMap(l => l.chapitres.map(c => c.id)))
  );
  const [expandedLignes, setExpandedLignes] = useState<Set<string>>(new Set());
  const [localShowTree, setLocalShowTree] = useState(true);
  const showTree = (showTreeProp !== undefined ? showTreeProp : localShowTree) && !isMobile;
  const toggleTree = onToggleTree ?? (() => setLocalShowTree(v => !v));
  const [selectedLotId, setSelectedLotId] = useState<string | null>(dpgf.lots[0]?.id ?? null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [clipboard, setClipboard] = useState<Ligne[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showDecoupage, setShowDecoupage] = useState(false);
  const [groupement, setGroupement] = useState<GroupementDpgf>('lot');
  // Chapitre visé par une insertion depuis la bibliothèque : le DPGF ne
  // sélectionnait que le lot, ce qui ne suffit pas à savoir où poser un article.
  const [selectedChapId, setSelectedChapId] = useState('');
  // Vraie sélection multiple, comme dans l'atelier BPU : cases à cocher, clic,
  // Ctrl+clic et Maj+clic. Les clés sont positionnelles (cf. treeOps.rowKey).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const targets = dpgf.lots.flatMap((lot, lotIdx) => lot.chapitres.filter(c => !c.cctpOnly).map(chap => ({
    id: chap.id, lotIdx, chapIdx: lot.chapitres.findIndex(c => c.id === chap.id), label: `${lot.numero} ${lot.titre} / ${chap.numero} ${chap.titre}`,
  })));
  const selectedChap = targets.find(c => c.id === selectedChapId) ?? (!selectedChapId && targets.length === 1 ? targets[0] : null);
  const tableRef = useRef<HTMLDivElement>(null);
  const dpgfRef = useRef(dpgf);
  dpgfRef.current = dpgf;

  // ── Derived flat rows ────────────────────────────────────────────────────────
  // Nombre de colonnes ajoutées en queue de tableau par le découpage
  // (bâtiment, phase — chacune conditionnelle — et localisation, toujours
  // présente). Sert à étendre le colSpan des lignes de totaux en pied de
  // tableau, qui ne connaissent pas ces colonnes autrement.
  const nbColsDecoupage = (dpgf.multiPhases ? 1 : 0) + 1;
  // Plusieurs bâtiments : une colonne « Bâtiments » (cases à cocher) puis une
  // quantité par bâtiment, avant la quantité totale.
  const multiBat = !!dpgf.multiBatiments;
  const batiments = multiBat ? batimentsParOrdre(dpgf.batiments) : [];
  const nbColsBat = multiBat ? 1 + batiments.length : 0;
  // La phase seule reste dans la colonne de découpage : le bâtiment a la sienne.
  const docPhases = { ...dpgf, multiBatiments: false };

  const flatRows: FlatRow<Lot, Chapitre, Ligne>[] =
    buildFlatRows(dpgf.lots, { expandedLots, expandedChaps, expandedLignes });

  const rowKey = rowKeyOf;
  // Totaux recalculés depuis les articles : le total enregistré peut dater.
  const totaux = totauxDocument(dpgf.lots, dpgf.TVA);

  // ── Mutate helpers ───────────────────────────────────────────────────────────
  const commitLots = (newLots: Lot[]) => {
    const totalHT = newLots.reduce((s, l) => s + l.sousTotal, 0);
    onChange({ ...dpgf, lots: newLots, totalHT, totalTTC: totalHT * (1 + dpgf.TVA / 100) });
  };
  const mutateLots = (fn: (lots: Lot[]) => Lot[]) => commitLots(fn(JSON.parse(JSON.stringify(dpgf.lots))));

  const recomputeLot = recomputeLotOp<Lot>;

  // ── Sélection ───────────────────────────────────────────────────────────────
  const selection = groupement === 'lot' ? parseSelection(selectedKeys) : [];
  const single: HierarchySelection | null = selection.length === 1 ? selection[0] : null;
  const selectKeys = (keys: string[]) => {
    setSelectedKeys(new Set(keys));
    setAnchorKey(keys.at(-1) ?? null);
  };
  const clearSelection = () => { setSelectedKeys(new Set()); setAnchorKey(null); };
  const toggleKey = (rKey: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      next.has(rKey) ? next.delete(rKey) : next.add(rKey);
      return next;
    });
    setAnchorKey(rKey);
  };
  /** Clic sur une ligne : seule, Ctrl/⌘ pour l'ajouter, Maj pour une plage. */
  const clickRow = (e: React.MouseEvent, row: FlatRow) => {
    const rKey = rowKey(row);
    // Le focus passe au tableau pour que ses raccourcis répondent aussitôt.
    if (!(e.target as HTMLElement).closest('button, input, select, textarea, a')) {
      tableRef.current?.focus({ preventScroll: true });
    }
    setSelectedLotId(row.lot.id);
    if (row.chapitre) setSelectedChapId(row.chapitre.id);
    if (e.metaKey || e.ctrlKey) { toggleKey(rKey); return; }
    if (e.shiftKey && anchorKey) {
      const keys = flatRows.map(rowKey);
      const [a, b] = [keys.indexOf(anchorKey), keys.indexOf(rKey)].sort((x, y) => x - y);
      if (a >= 0) { setSelectedKeys(new Set(keys.slice(a, b + 1))); return; }
    }
    selectKeys([rKey]);
  };

  // ── Tree toggle ───────────────────────────────────────────────────────────────
  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (id: string) => setter(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });
  const toggleLot = toggleIn(setExpandedLots);
  const toggleChap = toggleIn(setExpandedChaps);
  const toggleLigne = toggleIn(setExpandedLignes);

  // ── Add ───────────────────────────────────────────────────────────────────────
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
    selectKeys([`lot-${newLotIdx}`]);
    setEditingCell({ rowKey: `lot-${newLotIdx}`, field: 'titre', value: 'Nouveau lot' });
  };

  // Le lot et le chapitre visés par « Ajouter » : ceux de la dernière ligne
  // sélectionnée, sinon le lot choisi dans la structure.
  const anchor = selection.at(-1) ?? null;
  const targetLotIdx = anchor ? anchor.lotIdx : dpgf.lots.findIndex(l => l.id === selectedLotId);
  const targetChapIdx = anchor && anchor.kind !== 'lot'
    ? anchor.chapIdx
    : (dpgf.lots[targetLotIdx]?.chapitres.length ?? 0) - 1;

  const addChapitre = (lotIdx = targetLotIdx) => {
    if (lotIdx < 0 || !dpgf.lots[lotIdx]) return;
    const lot = dpgf.lots[lotIdx];
    const chapIdx = lot.chapitres.length;
    const newChapId = uid();
    mutateLots(lots => lots.map((l, i) => i !== lotIdx ? l : {
      ...l, chapitres: [...l.chapitres, { id: newChapId, numero: `${l.numero}.${l.chapitres.length + 1}`, titre: 'Nouveau chapitre', lignes: [] }],
    }));
    setExpandedLots(prev => new Set([...prev, lot.id]));
    setExpandedChaps(prev => new Set([...prev, newChapId]));
    selectKeys([`chap-${lotIdx}-${chapIdx}`]);
    setEditingCell({ rowKey: `chap-${lotIdx}-${chapIdx}`, field: 'titre', value: 'Nouveau chapitre' });
  };

  const addLigne = (lotIdx: number, chapIdx: number) => {
    const chap = dpgf.lots[lotIdx]?.chapitres[chapIdx];
    if (!chap) return;
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
    setExpandedLots(prev => new Set([...prev, dpgf.lots[lotIdx].id]));
    setExpandedChaps(prev => new Set([...prev, chap.id]));
    const key = `ligne-${lotIdx}-${chapIdx}-${newLigneIdx}`;
    selectKeys([key]);
    setEditingCell({ rowKey: key, field: 'designation', value: 'Nouvel article' });
  };

  // ── Bibliothèque d'ouvrages ─────────────────────────────────────────────────
  // Un article de la bibliothèque devient ici une ligne de DPGF : quantité à 0,
  // que le maître d'œuvre renseigne, et `articleTypeId` conservé — c'est par ce
  // fil que le prix remontera vers la bibliothèque quand une offre arrivera.
  const insererDepuisBibliotheque = (articles: ArticleBibliotheque[]) => {
    if (!selectedChap) { notify?.(t('pro_library_choose_chapter'), { type: 'error' }); return false; }
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
    notify?.(t('pro_library_inserted', { count: articles.length, cible: selectedChap.label }));
    return true;
  };

  const canAddChildTo = (s: HierarchySelection | null): s is Extract<HierarchySelection, { kind: 'ligne' }> =>
    s?.kind === 'ligne' && 1 + s.lignePath.length < MAX_ARTICLE_DEPTH;

  const addSubLigne = (lotIdx: number, chapIdx: number, parentLignePath: number[]) => {
    if (1 + parentLignePath.length >= MAX_ARTICLE_DEPTH) return;
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
    const key = `ligne-${lotIdx}-${chapIdx}-${newChildPath.join('-')}`;
    selectKeys([key]);
    setEditingCell({ rowKey: key, field: 'designation', value: 'Nouvel article' });
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

    // Quantité d'un bâtiment : « qb:<id du bâtiment> ».
    if (field.startsWith('qb:') && parsed.kind === 'ligne') {
      const id = field.slice(3);
      const q = evalFormula(value);
      commitLots(modifierFeuilles(dpgf.lots, feuillesSelectionnees(dpgf.lots, [rKey]), f => fixerQuantiteBatiment(f.ligne, id, q, f.herite)));
      setEditingCell(null);
      return;
    }

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
  const cellProps = { editingCell, onStartEdit: startEdit, onCommit: commitEdit, onCancel: cancelEdit };

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

  // ── Opérations sur la sélection ─────────────────────────────────────────────
  const changeHierarchy = (s: HierarchySelection, op: -1 | 1 | 'duplicate' | 'promote' | 'demote') => {
    const result = op === 'demote'
      ? demoteHierarchy(dpgf.lots, s, () => crypto.randomUUID())
      : op === 'duplicate'
      ? duplicateHierarchy(dpgf.lots, s, () => crypto.randomUUID())
      : op === 'promote'
      ? promoteHierarchy(dpgf.lots, s, () => crypto.randomUUID())
      : moveHierarchy(dpgf.lots, s, op);
    commitLots(result.lots);
    selectKeys([hierarchyKey(result.selection)]);
    const selected = result.selection;
    if (selected.kind !== 'lot') {
      setSelectedLotId(result.lots[selected.lotIdx].id);
      setSelectedChapId(result.lots[selected.lotIdx].chapitres[selected.chapIdx].id);
    }
    setExpandedLots(new Set(result.lots.map(l => l.id)));
    const expanded = new Set(expandedLignes);
    result.lots.forEach(lot => lot.chapitres.forEach(chap => collectLigneIdsWithChildren(chap.lignes, expanded)));
    setExpandedLignes(expanded);
    setExpandedChaps(new Set(result.lots.flatMap(l => l.chapitres.map(c => c.id))));
  };

  const copySelection = (sel: HierarchySelection[]) => {
    const lignes = collectSelectedLignes<Ligne>(dpgf.lots, sel.map(hierarchyKey));
    if (!lignes.length) return;
    setClipboard(lignes);
    notify?.(t('pro_copied', { count: lignes.length }));
  };

  const pasteAt = (target: HierarchySelection | null) => {
    const result = pasteLignes(dpgf.lots, target, clipboard, uid);
    if (!result) return;
    commitLots(result.lots);
    setExpandedLots(prev => new Set([...prev, dpgf.lots[target!.lotIdx].id]));
    selectKeys(result.pasted.map(hierarchyKey));
  };

  const removeSelection = (sel: HierarchySelection[]) => {
    if (!sel.length) return;
    const before = dpgf;
    const nextLots = deleteSelection(dpgf.lots, sel.map(hierarchyKey));
    commitLots(nextLots);
    clearSelection();
    setEditingCell(null);
    notify?.(t('pro_deleted', { count: sel.length }), {
      action: {
        label: t('pro_undo'),
        onClick: () => {
          // Rien n'est restauré si le document a changé depuis : on écraserait
          // la saisie faite entre-temps.
          if (dpgfRef.current.lots !== nextLots && JSON.stringify(dpgfRef.current.lots) !== JSON.stringify(nextLots)) {
            notify?.(t('pro_undo_unavailable'), { type: 'error' });
            return;
          }
          onChange(before);
        },
      },
    });
  };

  // ── Bâtiments des articles ──────────────────────────────────────────────────
  // Cases à cocher, pour une ligne comme pour une sélection : un lot, un
  // chapitre ou un article à sous-articles vaut tous ses articles.
  const batimentEntries = (keys: string[]): ToolbarMenuEntry[] => {
    if (!batiments.length) return [{ id: 'bat-none', label: t('pro_buildings_none_declared'), onClick: () => setShowDecoupage(true) }];
    return batiments.map(b => {
      const etat = etatBatimentSelection(dpgf.lots, keys, b.id);
      return {
        id: `bat-${b.id}`,
        label: b.libelle ? `${b.code} · ${b.libelle}` : b.code,
        checked: etat === 'tous' ? true : etat === 'certains' ? 'mixed' as const : false,
        keepOpen: true,
        onClick: () => commitLots(basculerBatimentEnMasse(dpgf.lots, keys, b.id, etat !== 'tous')),
      };
    });
  };
  const resumeBatiments = (keys: string[]): string => {
    const etats = batiments.map(b => [b.code, etatBatimentSelection(dpgf.lots, keys, b.id)] as const);
    const codes = etats.filter(([, e]) => e === 'tous').map(([c]) => c);
    const partiel = etats.some(([, e]) => e === 'certains');
    return codes.length || partiel ? `${codes.join(', ')}${partiel ? (codes.length ? ', …' : '…') : ''}` : '—';
  };
  const batimentsCell = (rKey: string, label: string) => (
    <td className="px-1 py-0.5" onClick={e => e.stopPropagation()}>
      <ToolbarMenu
        entries={() => batimentEntries([rKey])}
        onSelect={entry => entry.onClick()}
        ariaLabel={t('pro_buildings_of', { numero: label })}
        title={t('pro_buildings_of', { numero: label })}
        triggerClassName="w-full inline-flex items-center justify-between gap-1 h-7 px-1.5 rounded border text-xs whitespace-nowrap outline-none hover:bg-[var(--tblr-surface)] focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]"
        triggerStyle={{ borderColor: 'var(--tblr-border)' }}
        trigger={<><span className="truncate">{resumeBatiments([rKey])}</span><IconChevronDown size={12} aria-hidden className="shrink-0" /></>}
      />
    </td>
  );

  const selectionActions = (sel: HierarchySelection[]): SelectionAction[] => {
    const one = sel.length === 1 ? sel[0] : null;
    const onlyOne = t('pro_selection_single_only');
    const hasLigne = sel.some(s => s.kind === 'ligne');
    const pasteTarget = sel.at(-1) ?? null;
    return [
      { id: 'up', label: t('pro_move_up'), icon: <IconArrowUp size={16} />, shortcut: 'Alt+↑', mobile: true,
        onClick: () => one && changeHierarchy(one, -1), disabled: !canMove(dpgf.lots, one, -1), hint: sel.length > 1 ? onlyOne : undefined },
      { id: 'down', label: t('pro_move_down'), icon: <IconArrowDown size={16} />, shortcut: 'Alt+↓', mobile: true,
        onClick: () => one && changeHierarchy(one, 1), disabled: !canMove(dpgf.lots, one, 1), hint: sel.length > 1 ? onlyOne : undefined },
      { id: 'promote', label: t('pro_promote'), icon: <IconArrowBarToLeft size={16} />, iconOnly: true, shortcut: 'Maj+Tab',
        onClick: () => one && changeHierarchy(one, 'promote'), disabled: one?.kind !== 'ligne', hint: sel.length > 1 ? onlyOne : undefined },
      { id: 'demote', label: t('pro_demote'), icon: <IconArrowBarToRight size={16} />, iconOnly: true, shortcut: 'Tab',
        onClick: () => one && changeHierarchy(one, 'demote'), disabled: !canDemote(dpgf.lots, one), hint: sel.length > 1 ? onlyOne : undefined },
      ...(multiBat ? [{ id: 'batiments', label: t('pro_buildings'), icon: <IconBuildingCommunity size={16} />, groupStart: true, onClick: () => {},
        menu: () => batimentEntries(sel.map(hierarchyKey)) }] : []),
      { id: 'duplicate', label: t('pro_duplicate'), icon: <IconCopy size={16} />, shortcut: 'Ctrl+D', mobile: true, groupStart: true,
        onClick: () => one && changeHierarchy(one, 'duplicate'), disabled: !one, hint: sel.length > 1 ? onlyOne : undefined },
      { id: 'copy', label: t('pro_copy'), icon: <IconCopy size={16} />, shortcut: 'Ctrl+C',
        onClick: () => copySelection(sel), disabled: !hasLigne, hint: hasLigne ? undefined : t('pro_copy_articles_only') },
      { id: 'paste', label: t('pro_paste'), icon: <IconClipboard size={16} />, iconOnly: true, shortcut: 'Ctrl+V',
        onClick: () => pasteAt(pasteTarget), disabled: !clipboard.length || !pasteTarget || pasteTarget.kind === 'lot' },
      { id: 'delete', label: t('pro_delete'), icon: <IconTrash size={16} />, shortcut: 'Suppr', danger: true, mobile: true, groupStart: true,
        onClick: () => removeSelection(sel), disabled: !sel.length },
    ];
  };

  /** Menu « ⋯ » d'une ligne : les mêmes actions, appliquées à cette ligne. */
  const rowMenuEntries = (row: FlatRow): ToolbarMenuEntry[] => {
    const s = parseRowKey(rowKey(row))!;
    const add: ToolbarMenuEntry[] = s.kind === 'lot'
      ? [{ id: 'add-chap', label: t('pro_add_chapter'), icon: <IconStackPush size={16} />, onClick: () => addChapitre(s.lotIdx) }]
      : s.kind === 'chapitre'
      ? [{ id: 'add-art', label: t('pro_add_article'), icon: <IconRowInsertBottom size={16} />, onClick: () => addLigne(s.lotIdx, s.chapIdx) }]
      : [{ id: 'add-sub', label: t('pro_add_sub_article'), icon: <IconSubtask size={16} />, onClick: () => addSubLigne(s.lotIdx, s.chapIdx, s.lignePath), disabled: !canAddChildTo(s) }];
    return [...add, { id: 'sep', separator: true }, ...selectionActions([s]).filter(a => !a.menu)];
  };

  // ── Raccourcis clavier du tableau ───────────────────────────────────────────
  const onTableKeyDown = (e: React.KeyboardEvent) => {
    if (editingCell || isTextField(e.target) || groupement !== 'lot') return;
    const mod = e.ctrlKey || e.metaKey;
    const run = (id: string) => {
      const action = selectionActions(selection).find(a => a.id === id);
      if (!action || action.disabled) return false;
      e.preventDefault();
      action.onClick();
      return true;
    };
    if (e.key === 'Escape' && selection.length) { e.preventDefault(); clearSelection(); return; }
    if (!selection.length) return;
    if (e.altKey && e.key === 'ArrowUp') { run('up'); return; }
    if (e.altKey && e.key === 'ArrowDown') { run('down'); return; }
    // Tab ne change de niveau que si une ligne est sélectionnée ; Échap la
    // désélectionne et rend à Tab son rôle de navigation.
    // Seulement depuis le tableau lui-même : entre ses boutons, Tab navigue.
    if (e.key === 'Tab' && !mod && !e.altKey) {
      if (e.target === e.currentTarget) run(e.shiftKey ? 'promote' : 'demote');
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); run('duplicate'); return; }
    if (mod && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) { run('copy'); return; }
    if (mod && e.key.toLowerCase() === 'v') { run('paste'); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') run('delete');
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
      clearSelection();
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

  // ── Barre d'outils (ligne des sous-onglets de ProTab) ───────────────────────
  const editable = groupement === 'lot';
  const targetChap = dpgf.lots[targetLotIdx]?.chapitres[targetChapIdx];
  useProToolbar([
    {
      kind: 'menu', id: 'dpgf-add', label: t('pro_add'), icon: <IconPlus size={16} />, accent: true, mobile: true,
      entries: [
        { id: 'dpgf-add-lot', label: t('pro_add_lot'), icon: <IconFolderPlus size={16} />, onClick: addLot, disabled: !editable },
        { id: 'dpgf-add-chap', label: t('pro_add_chapter'), icon: <IconStackPush size={16} />, onClick: () => addChapitre(), disabled: !editable || !dpgf.lots[targetLotIdx], hint: dpgf.lots.length ? undefined : t('pro_add_lot_first') },
        { id: 'dpgf-add-art', label: t('pro_add_article'), icon: <IconRowInsertBottom size={16} />, onClick: () => addLigne(targetLotIdx, targetChapIdx), disabled: !editable || !targetChap, hint: targetChap ? undefined : t('pro_add_chapter_first') },
        { id: 'dpgf-add-sub', label: t('pro_add_sub_article'), icon: <IconSubtask size={16} />, onClick: () => single?.kind === 'ligne' && addSubLigne(single.lotIdx, single.chapIdx, single.lignePath), disabled: !editable || !canAddChildTo(single), hint: t('pro_add_sub_article_hint') },
      ],
    },
    {
      kind: 'button', id: 'dpgf-library', label: t('pro_library'), icon: <IconBuildingStore size={16} />,
      pressed: showLibrary, onClick: () => { setGroupement('lot'); setShowLibrary(v => !v); },
    },
    {
      kind: 'button', id: 'dpgf-decoupage', label: t('pro_buildings_phases'), icon: <IconBuildingCommunity size={16} />,
      pressed: showDecoupage, badge: !!(dpgf.multiBatiments || dpgf.multiPhases), onClick: () => setShowDecoupage(v => !v),
    },
    {
      kind: 'menu', id: 'dpgf-market', label: t('pro_market'), icon: <IconScale size={16} />,
      entries: [
        { id: 'dpgf-import-offer', label: t('pro_import_offer'), icon: <IconFileImport size={16} />, onClick: () => onImportOffre?.(), disabled: !onImportOffre },
        { id: 'dpgf-to-act', label: t('pro_push_to_act'), icon: <IconScale size={16} />, onClick: () => onPushToAct?.(), disabled: !onPushToAct || offres.length === 0, hint: offres.length ? undefined : t('pro_push_to_act_no_offer') },
      ],
    },
    {
      kind: 'menu', id: 'dpgf-export', label: t('pro_export'), icon: <IconDownload size={16} />,
      entries: [
        { id: 'dpgf-pdf', label: t('pro_export_pdf'), icon: <IconFileTypePdf size={16} />, onClick: () => exportDPGFtoPDF(dpgf, projectName, groupement, settings ?? {}, cotraitants) },
        { id: 'dpgf-xlsx', label: t('pro_export_excel'), icon: <IconTable size={16} />, onClick: () => exportDPGFtoExcel(dpgf, projectName, groupement, settings ?? {}) },
        ...(batiments.length ? [{ id: 'dpgf-by-building', heading: t('pro_export_by_building') } as ToolbarMenuEntry] : []),
        ...batiments.flatMap(b => {
          const titre = `${projectName ?? dpgf.titre} · ${b.code}${b.libelle ? ` ${b.libelle}` : ''}`;
          return [
            { id: `dpgf-pdf-${b.id}`, label: `${b.code} · ${t('pro_export_pdf')}`, icon: <IconFileTypePdf size={16} />, onClick: () => exportDPGFtoPDF({ ...forBuilding(dpgf, b.id), titre: `DPGF ${b.code}` }, titre, 'lot', settings ?? {}, cotraitants) },
            { id: `dpgf-xlsx-${b.id}`, label: `${b.code} · ${t('pro_export_excel')}`, icon: <IconTable size={16} />, onClick: () => exportDPGFtoExcel({ ...forBuilding(dpgf, b.id), titre: `DPGF ${b.code}` }, titre, 'lot', settings ?? {}) },
          ];
        }),
      ],
    },
  ]);

  const selectionLabel = t('pro_selection_count', { count: selection.length });
  const visibleKeys = flatRows.map(rowKey);
  const allChecked = visibleKeys.length > 0 && visibleKeys.every(k => selectedKeys.has(k));
  const someChecked = !allChecked && visibleKeys.some(k => selectedKeys.has(k));

  const rowClass = (rKey: string, base: string) => {
    const isSelected = selectedKeys.has(rKey);
    if (dropTarget === rKey) return `${base} bg-[var(--tblr-primary-lt)] outline outline-1 outline-[var(--tblr-primary)]`;
    return `${base} ${isSelected ? 'bg-[var(--tblr-primary-lt)]' : ''}`;
  };

  const checkboxCell = (rKey: string, label: string) => (
    <td className="pl-3 pr-1 py-1 w-8" onClick={e => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={selectedKeys.has(rKey)}
        onChange={() => toggleKey(rKey)}
        aria-label={t('pro_select_row', { numero: label })}
        className="w-4 h-4 align-middle accent-[var(--tblr-primary)]"
      />
    </td>
  );

  const menuCell = (row: FlatRow, label: string) => (
    <td className="px-1 py-0.5 w-10 text-right" onClick={e => e.stopPropagation()}>
      <ToolbarMenu
        entries={() => rowMenuEntries(row)}
        onSelect={entry => entry.onClick()}
        onOpen={() => selectKeys([rowKey(row)])}
        align="end"
        ariaLabel={t('pro_row_actions', { numero: label })}
        triggerClassName="w-7 h-7 pointer-coarse:w-10 pointer-coarse:h-10 inline-flex items-center justify-center rounded opacity-60 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]"
        triggerStyle={{ color: 'var(--tblr-muted)' }}
        trigger={<IconDots size={16} aria-hidden />}
      />
    </td>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}>
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
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
          <label htmlFor="dpgf-groupement" className="text-xs font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('pro_grouping')}</label>
          <select
            id="dpgf-groupement"
            className="px-2 py-1 text-xs border rounded outline-none focus:ring-1 focus:ring-[var(--tblr-primary)]"
            style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
            value={groupement}
            onChange={e => { setGroupement(e.target.value as GroupementDpgf); clearSelection(); }}
          >
            <option value="lot">{t('pro_grouping_lot')}</option>
            {dpgf.multiBatiments && <option value="batiment">{t('pro_grouping_building')}</option>}
            {dpgf.multiPhases && <option value="phase">{t('pro_grouping_phase')}</option>}
            {dpgf.multiBatiments && dpgf.multiPhases && <option value="batiment-phase">{t('pro_grouping_building_phase')}</option>}
          </select>
          {groupement !== 'lot' && (
            <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_grouping_read_only')}</span>
          )}
        </div>
      )}

      {/* Main workspace */}
      {groupement !== 'lot' ? (
        <DpgfGroupedView dpgf={dpgf} groupement={groupement} />
      ) : (
      <div className="flex flex-1 overflow-hidden">

        {/* ── Structure ───────────────────────────────────────────────────── */}
        {showTree && (
          <nav aria-label={t('pro_structure')} className="w-56 shrink-0 border-r overflow-y-auto text-sm" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
            <div className="flex items-center gap-0.5 pl-3 pr-1 py-1.5 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="flex-1 text-xs font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('pro_structure')}</span>
              {[
                { label: t('pro_expand_all'), icon: <IconArrowsMaximize size={14} />, onClick: expandAll },
                { label: t('pro_collapse_all'), icon: <IconArrowsMinimize size={14} />, onClick: collapseAll },
                { label: t('pro_hide_structure'), icon: <IconLayoutSidebarLeftCollapse size={14} />, onClick: toggleTree },
              ].map(b => (
                <button key={b.label} type="button" onClick={b.onClick} aria-label={b.label} title={b.label}
                  className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-[var(--tblr-surface)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]"
                  style={{ color: 'var(--tblr-muted)' }}>
                  {b.icon}
                </button>
              ))}
            </div>
            {dpgf.lots.map((lot, li) => (
              <div key={lot.id}>
                <div className={`flex items-center ${selectedLotId === lot.id ? 'bg-[var(--tblr-primary-lt)]' : ''}`}>
                  <button
                    type="button"
                    aria-expanded={expandedLots.has(lot.id)}
                    aria-label={t('pro_toggle_lot', { numero: lot.numero })}
                    className="shrink-0 w-6 h-7 inline-flex items-center justify-center"
                    style={{ color: 'var(--tblr-muted)' }}
                    onClick={() => toggleLot(lot.id)}
                  >
                    {expandedLots.has(lot.id) ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  </button>
                  <button
                    type="button"
                    className="flex-1 min-w-0 flex items-center gap-1 pr-2 py-1.5 text-left text-xs font-medium hover:underline"
                    onClick={() => scrollToLot(lot.id)}
                  >
                    <span className="font-mono shrink-0" style={{ color: 'var(--tblr-muted)' }}>{lot.numero}</span>
                    <span className="truncate">{lot.titre}</span>
                  </button>
                </div>
                {expandedLots.has(lot.id) && lot.chapitres.map((chap, ci) => chap.cctpOnly ? null : (
                  <button
                    key={chap.id}
                    type="button"
                    className="w-full flex items-center gap-1 pl-7 pr-2 py-1 text-left text-xs hover:underline"
                    style={{ color: 'var(--tblr-muted)' }}
                    onClick={() => {
                      setSelectedLotId(lot.id);
                      setSelectedChapId(chap.id);
                      setExpandedChaps(prev => new Set([...prev, chap.id]));
                      selectKeys([`chap-${li}-${ci}`]);
                    }}
                  >
                    <span className="font-mono shrink-0">{chap.numero}</span>
                    <span className="truncate">{chap.titre}</span>
                  </button>
                ))}
              </div>
            ))}
            <button
              type="button"
              className="w-full flex items-center gap-1 px-3 py-2 text-xs font-medium border-t mt-2 hover:bg-[var(--tblr-surface)]"
              style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-primary)' }}
              onClick={addLot}
            >
              <IconPlus size={13} /> {t('pro_add_lot')}
            </button>
          </nav>
        )}

        {/* ── Tableau ─────────────────────────────────────────────────────── */}
        <div className="relative flex-1 min-w-0 flex flex-col">
          <div
            ref={tableRef}
            tabIndex={0}
            aria-label={t('pro_dpgf_table')}
            aria-keyshortcuts="Escape Delete Alt+ArrowUp Alt+ArrowDown Tab Shift+Tab Control+D Control+C Control+V"
            className="flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--tblr-primary)]"
            onKeyDown={onTableKeyDown}
          >
            {isMobile ? (
              <DpgfMobileList
                rows={flatRows}
                extra={multiBat ? (row, rKey) => {
                  const l = row.ligne!;
                  const quantites = l.children?.length ? {} : quantitesParBatiment(l, heritagePour(row.lot, row.chapitre!, row.lignePath!));
                  return (
                    <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                      <ToolbarMenu
                        entries={() => batimentEntries([rKey])}
                        onSelect={entry => entry.onClick()}
                        ariaLabel={t('pro_buildings_of', { numero: l.numero })}
                        triggerClassName="inline-flex items-center gap-1 h-9 px-2 rounded border text-xs"
                        triggerStyle={{ borderColor: 'var(--tblr-border)' }}
                        trigger={<><IconBuildingCommunity size={14} aria-hidden />{resumeBatiments([rKey])}<IconChevronDown size={12} aria-hidden /></>}
                      />
                      {batiments.filter(b => b.id in quantites).map(b => (
                        <span key={b.id} className="inline-flex items-center gap-1">
                          <span style={{ color: 'var(--tblr-muted)' }}>{b.code}</span>
                          <span className="w-16"><EditableCell rKey={rKey} field={`qb:${b.id}`} value={quantites[b.id]} numeric showZero editOnClick label={t('pro_col_quantity_of', { code: b.code })} {...cellProps} /></span>
                        </span>
                      ))}
                    </div>
                  );
                } : undefined}
                sousTotaux={totaux.sousTotaux}
                selected={selectedKeys}
                onToggleSelect={toggleKey}
                expandedLots={expandedLots}
                expandedChaps={expandedChaps}
                expandedLignes={expandedLignes}
                onToggleLot={toggleLot}
                onToggleChap={toggleChap}
                onToggleLigne={toggleLigne}
                {...cellProps}
              />
            ) : (
            <table className={`w-full border-collapse text-sm ${selection.length ? 'mb-20' : ''}`} style={{ minWidth: 760 }}>
              <thead className="sticky top-0 z-10">
                <tr className="text-xs" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', boxShadow: 'inset 0 -1px 0 var(--tblr-border)' }}>
                  <th className="pl-3 pr-1 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={el => { if (el) el.indeterminate = someChecked; }}
                      onChange={() => (allChecked ? clearSelection() : selectKeys(visibleKeys))}
                      aria-label={t('pro_select_all')}
                      className="w-4 h-4 align-middle accent-[var(--tblr-primary)]"
                    />
                  </th>
                  <th className="w-6" aria-hidden />
                  <th className="px-2 py-2 text-left font-semibold w-24">{t('pro_col_number')}</th>
                  <th className="px-2 py-2 text-left font-semibold">{t('pro_col_designation')}</th>
                  <th className="px-2 py-2 text-center font-semibold w-16">{t('pro_col_unit')}</th>
                  {multiBat && <th className="px-1 py-2 text-left font-semibold w-24">{t('pro_buildings')}</th>}
                  {batiments.map(b => (
                    <th key={b.id} className="px-2 py-2 text-right font-semibold w-20" title={b.libelle || b.code}>{t('pro_col_quantity_of', { code: b.code })}</th>
                  ))}
                  <th className="px-2 py-2 text-right font-semibold w-24">{multiBat ? t('pro_col_quantity_total') : t('pro_col_quantity')}</th>
                  <th className="px-2 py-2 text-right font-semibold w-28">{t('pro_col_unit_price')}</th>
                  <th className="px-2 py-2 text-right font-semibold w-32">{t('pro_col_total')}</th>
                  {dpgf.multiPhases && <th className="px-1 py-2 text-center font-semibold w-14">{t('pro_col_phase')}</th>}
                  <th className="px-2 py-2 text-left font-semibold w-28">{t('pro_col_location')}</th>
                  <th className="w-10"><span className="sr-only">{t('pro_col_actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {flatRows.map(row => {
                  const rKey = rowKey(row);

                  if (row.kind === 'lot') {
                    return (
                      <tr
                        key={rKey}
                        data-lot-id={row.lot.id}
                        onClick={e => clickRow(e, row)}
                        className={rowClass(rKey, 'group border-y font-semibold')}
                        style={{ borderColor: 'var(--tblr-border)', ...(selectedKeys.has(rKey) || dropTarget === rKey ? {} : { background: 'var(--tblr-surface-2)' }) }}
                        onDragOver={e => handleDragOver(e, rKey)}
                        onDrop={e => handleDrop(e, row)}
                        onDragLeave={() => setDropTarget(null)}
                      >
                        {checkboxCell(rKey, row.lot.numero)}
                        <td className="py-1">
                          <button type="button" className="inline-flex align-middle" onClick={e => { e.stopPropagation(); toggleLot(row.lot.id); }} aria-expanded={expandedLots.has(row.lot.id)} aria-label={t('pro_toggle_lot', { numero: row.lot.numero })} style={{ color: 'var(--tblr-muted)' }}>
                            {expandedLots.has(row.lot.id) ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                          </button>
                        </td>
                        <td className="px-2 py-1 font-mono text-xs" style={{ color: 'var(--tblr-muted)' }}>
                          <EditableCell rKey={rKey} field="numero" value={row.lot.numero} {...cellProps} />
                        </td>
                        <td className="px-2 py-1" colSpan={multiBat ? 2 : 4}>
                          <EditableCell rKey={rKey} field="titre" value={row.lot.titre} {...cellProps} />
                        </td>
                        {multiBat && <>{batimentsCell(rKey, row.lot.numero)}<td colSpan={batiments.length + 2} /></>}
                        <td className="px-2 py-1 text-right font-mono tabular-nums">
                          {formatCurrency(totaux.sousTotaux[row.lotIdx])}
                        </td>
                        {dpgf.multiPhases && (
                          <td className="px-1 py-1" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1 justify-center">
                              <SelecteursDecoupage
                                doc={docPhases} batimentId={row.lot.batimentId} phaseId={row.lot.phaseId}
                                onBatimentChange={v => setDecoupageChamp(rKey, 'batimentId', v)}
                                onPhaseChange={v => setDecoupageChamp(rKey, 'phaseId', v)}
                              />
                            </div>
                          </td>
                        )}
                        <td className="px-1 py-1" />{/* pas de localisation au niveau lot */}
                        {menuCell(row, row.lot.numero)}
                      </tr>
                    );
                  }

                  if (row.kind === 'chapitre') {
                    const chapVise = showLibrary
                      && selectedChap?.lotIdx === row.lotIdx && selectedChap?.chapIdx === row.chapIdx;
                    return (
                      <tr
                        key={rKey}
                        className={rowClass(rKey, `group border-b font-semibold text-[0.8125rem] ${chapVise ? 'outline outline-1 -outline-offset-1 outline-[var(--tblr-primary)]' : ''}`)}
                        style={{ borderColor: 'var(--tblr-border)' }}
                        onClick={e => clickRow(e, row)}
                        onDragOver={e => handleDragOver(e, rKey)}
                        onDrop={e => handleDrop(e, row)}
                        onDragLeave={() => setDropTarget(null)}
                      >
                        {checkboxCell(rKey, row.chapitre!.numero)}
                        <td className="py-1 pl-1">
                          <button type="button" className="inline-flex align-middle" onClick={e => { e.stopPropagation(); toggleChap(row.chapitre!.id); }} aria-expanded={expandedChaps.has(row.chapitre!.id)} aria-label={t('pro_toggle_chapter', { numero: row.chapitre!.numero })} style={{ color: 'var(--tblr-muted)' }}>
                            {expandedChaps.has(row.chapitre!.id) ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                          </button>
                        </td>
                        <td className="px-2 py-1 font-mono text-xs font-normal" style={{ color: 'var(--tblr-muted)' }}>
                          <EditableCell rKey={rKey} field="numero" value={row.chapitre!.numero} {...cellProps} />
                        </td>
                        <td className="px-2 py-1" colSpan={multiBat ? 2 : 5}>
                          <EditableCell rKey={rKey} field="titre" value={row.chapitre!.titre} {...cellProps} />
                        </td>
                        {multiBat && <>{batimentsCell(rKey, row.chapitre!.numero)}<td colSpan={batiments.length + 3} /></>}
                        {dpgf.multiPhases && (
                          <td className="px-1 py-1" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1 justify-center">
                              <SelecteursDecoupage
                                doc={docPhases} batimentId={row.chapitre!.batimentId} phaseId={row.chapitre!.phaseId}
                                onBatimentChange={v => setDecoupageChamp(rKey, 'batimentId', v)}
                                onPhaseChange={v => setDecoupageChamp(rKey, 'phaseId', v)}
                              />
                            </div>
                          </td>
                        )}
                        <td className="px-1 py-1" />{/* pas de localisation au niveau chapitre */}
                        {menuCell(row, row.chapitre!.numero)}
                      </tr>
                    );
                  }

                  // ligne / article (depth 2 to MAX_ARTICLE_DEPTH)
                  const l = row.ligne!;
                  const hasChildren = !!(l.children && l.children.length > 0);
                  const indentPx = (row.depth - 2) * 16;

                  return (
                    <tr
                      key={rKey}
                      onClick={e => clickRow(e, row)}
                      draggable={!hasChildren}
                      onDragStart={e => handleDragStart(e, row)}
                      onDragOver={e => handleDragOver(e, rKey)}
                      onDrop={e => handleDrop(e, row)}
                      onDragLeave={() => setDropTarget(null)}
                      className={rowClass(rKey, `group border-b hover:bg-[var(--tblr-surface-2)]
                        ${l.type === 'titre' ? 'italic' : ''}
                      `)}
                      style={{ borderColor: 'var(--tblr-border)', ...(l.type === 'commentaire' ? { color: 'var(--tblr-muted)' } : {}) }}
                    >
                      {checkboxCell(rKey, l.numero)}
                      <td className="py-1" style={{ paddingLeft: `${indentPx}px`, color: 'var(--tblr-muted)' }}>
                        {hasChildren ? (
                          <button type="button" onClick={e => { e.stopPropagation(); toggleLigne(l.id); }} aria-expanded={expandedLignes.has(l.id)} aria-label={t('pro_toggle_article', { numero: l.numero })}>
                            {expandedLignes.has(l.id) ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                          </button>
                        ) : (
                          <span aria-hidden className="cursor-grab opacity-50">⠿</span>
                        )}
                      </td>
                      <td className="px-2 py-0.5 text-xs font-mono" style={{ color: 'var(--tblr-muted)' }}>
                        <EditableCell rKey={rKey} field="numero" value={l.numero} className="text-xs" {...cellProps} />
                      </td>
                      <td className="px-2 py-0.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 min-w-0">
                            <EditableCell rKey={rKey} field="designation" value={l.designation} {...cellProps} />
                          </div>
                          {/* Repère de provenance : cet article vient de la
                              bibliothèque du cabinet, c'est aussi lui qui permettra
                              au prix d'une offre d'y remonter. */}
                          {l.articleTypeId && (
                            <span
                              title={t('pro_badge_library')}
                              className="shrink-0 text-[0.6875rem] font-semibold px-1.5 rounded"
                              style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
                            >
                              BIB
                            </span>
                          )}
                          {l.genereParIa && (
                            <span title={t('pro_badge_ai')} className="shrink-0 text-[0.6875rem] font-semibold px-1.5 rounded border" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
                              IA
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-0.5 text-center">
                        <EditableCell rKey={rKey} field="unite" value={l.unite} className="text-center" {...cellProps} />
                      </td>
                      {multiBat && batimentsCell(rKey, l.numero)}
                      {batiments.map(b => {
                        const quantites = hasChildren ? {} : quantitesParBatiment(l, heritagePour(row.lot, row.chapitre!, row.lignePath!));
                        return (
                          <td key={b.id} className="px-2 py-0.5">
                            {b.id in quantites
                              ? <EditableCell rKey={rKey} field={`qb:${b.id}`} value={quantites[b.id]} numeric showZero label={t('pro_col_quantity_of', { code: b.code })} {...cellProps} />
                              : <span className="block text-right px-1" style={{ color: 'var(--tblr-muted)' }} title={t('pro_building_not_assigned')}>·</span>}
                          </td>
                        );
                      })}
                      <td className="px-2 py-0.5">
                        {l.quantitesBatiments !== undefined ? <span className="block text-right font-mono tabular-nums px-1" title={t('pro_quantities_by_building')}>{new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(l.quantite)}</span> : (<EditableCell rKey={rKey} field="quantite" value={l.quantite} numeric {...cellProps} />)}
                      </td>
                      <td className="px-2 py-0.5">
                        <EditableCell rKey={rKey} field="prixUnitaire" value={l.prixUnitaire} numeric {...cellProps} />
                      </td>
                      <td className="px-2 py-0.5 text-right font-mono tabular-nums">
                        {hasChildren ? (
                          <span className="px-1 py-0.5 text-sm" style={{ color: 'var(--tblr-muted)' }}>
                            {formatCurrency(sumLigne(l))}
                          </span>
                        ) : (
                          <EditableCell rKey={rKey} field="prixTotal" value={l.prixTotal} numeric {...cellProps} />
                        )}
                      </td>
                      {dpgf.multiPhases && (
                        <td className="px-1 py-0.5" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-center">
                            <SelecteursDecoupage
                              doc={docPhases} batimentId={l.batimentId} phaseId={l.phaseId}
                              onBatimentChange={v => setDecoupageChamp(rKey, 'batimentId', v)}
                              onPhaseChange={v => setDecoupageChamp(rKey, 'phaseId', v)}
                            />
                          </div>
                        </td>
                      )}
                      <td className="px-2 py-0.5 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                        <EditableCell rKey={rKey} field="localisation" value={l.localisation || ''} className="text-xs" {...cellProps} />
                      </td>
                      {menuCell(row, l.numero)}
                    </tr>
                  );
                })}

                {/* Totaux, recalculés depuis les articles */}
                <tr className="border-t-2" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                  <th scope="row" colSpan={7 + nbColsBat} className="px-4 py-2 text-left text-sm font-semibold">{t('pro_total_ht')}</th>
                  <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums">{formatCurrency(totaux.totalHT)}</td>
                  <td colSpan={nbColsDecoupage + 1} />
                </tr>
                <tr style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                  <th scope="row" colSpan={7 + nbColsBat} className="px-4 py-1.5 text-left text-sm font-normal">{t('pro_vat_rate', { rate: dpgf.TVA })}</th>
                  <td className="px-2 py-1.5 text-right font-mono text-sm tabular-nums">{formatCurrency(totaux.montantTVA)}</td>
                  <td colSpan={nbColsDecoupage + 1} />
                </tr>
                <tr className="border-t" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                  <th scope="row" colSpan={7 + nbColsBat} className="px-4 py-2 text-left font-bold">{t('pro_total_ttc')}</th>
                  <td className="px-2 py-2 text-right font-mono font-bold tabular-nums">{formatCurrency(totaux.totalTTC)}</td>
                  <td colSpan={nbColsDecoupage + 1} />
                </tr>
              </tbody>
            </table>
            )}
          </div>

          {selection.length > 0 && (
            <SelectionBar
              label={selectionLabel}
              actions={selectionActions(selection)}
              onClear={clearSelection}
              isMobile={isMobile}
            />
          )}
        </div>

        {/* ── Bibliothèque d'ouvrages du cabinet ────────────────────────────── */}
        {showLibrary && (
          <PriceLibraryPanel
            onClose={() => setShowLibrary(false)}
            onInsert={insererDepuisBibliotheque}
            canInsert={!!selectedChap}
            targetSelector={<label className="text-xs block">{t('pro_library_insert_into')}
              <select aria-label={t('pro_library_target')} className="w-full border rounded p-1 mt-1" value={selectedChap?.id ?? ''} onChange={e => setSelectedChapId(e.target.value)}>
                <option value="">{t('pro_library_choose_target')}</option>
                {targets.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              {!targets.length && <span>{t('pro_library_no_chapter')}</span>}
            </label>}
            hintCible={t('pro_library_hint')}
          />
        )}
      </div>
      )}
    </div>
  );
};
