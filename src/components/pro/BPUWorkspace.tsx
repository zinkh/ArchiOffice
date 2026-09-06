import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  IconPlus, IconTrash, IconCopy, IconClipboard, IconDeviceFloppy,
  IconFileTypePdf, IconTable, IconChevronRight, IconChevronDown,
  IconLayoutSidebar, IconArrowsMaximize, IconArrowsMinimize,
  IconRowInsertBottom, IconFolderPlus, IconStackPush, IconX,
  IconLayoutColumns, IconBuildingStore, IconFileImport, IconFileExport,
  IconArrowsExchange, IconAbc, IconScale,
} from '@tabler/icons-react';
import { ProRibbon, RibbonTabDef } from './ProRibbon';
import type { BPU, BPULot, BPUChapitre, BPULigne, Tranche, OffreBPU, NatureArticle } from '../../types/bpu';
import { natureEffective, trancheEffective } from '../../types/bpu';
import {
  evalFormula, MAX_ARTICLE_DEPTH,
  mutateLigneAtPath, deleteLigneAtPath, addChildToLigneAtPath,
  collectLigneIdsWithChildren, sumLigne, recomputeLot,
  buildFlatRows, rowKey as rowKeyOf, parseRowKey, forEachLigne,
  type FlatRow,
} from './treeOps';
import { montantEnLettres } from '../../lib/numberToFrenchWords';
import { PriceLibraryPanel } from './PriceLibraryPanel';
import type { ArticleBibliotheque } from '../../types/library';
import { formatCurrency } from '../../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Le BPU et le DQE sont le MÊME document, vu avec deux jeux de colonnes : le
 * bordereau ne montre que l'unité et le prix unitaire, le DQE y ajoute les
 * quantités estimatives et les montants. Un troisième jeu compare les offres
 * reçues, ce qui réutilise l'arbre et le rendu plutôt qu'une seconde table.
 */
export type ColSet = 'bpu' | 'dqe' | 'comparatif';

interface BPUWorkspaceProps {
  bpu: BPU;
  onChange: (bpu: BPU) => void;
  onSave: () => void;
  mode: 'bpu' | 'dqe';
  projectName?: string;
  offres?: OffreBPU[];
  /** Lots du projet (project_lots), pour rattacher les lots du bordereau. */
  projectLots?: { id: string; lot_number: string; lot_title: string }[];
  showTree?: boolean;
  onToggleTree?: () => void;
  onDragStart?: (ligne: BPULigne) => void;
  onDropExternal?: (ligne: BPULigne) => void;
  /** « Initialiser depuis le DPGF » — absent tant qu'aucun DPGF n'existe. */
  onInitFromDpgf?: () => void;
  /** « Reverser le DQE vers le DPGF ». */
  onPushToDpgf?: () => void;
  onOpenLibrary?: () => void;
  onPushToLibrary?: (lignes: BPULigne[]) => void;
  onImportOffre?: () => void;
  onExportPdf?: (colSet: ColSet) => void;
  onExportExcel?: (colSet: ColSet, vierge: boolean) => void;
  onPushToAct?: () => void;
}

const newId = () => crypto.randomUUID();

const fmt2 = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const NATURE_LABELS: Record<NatureArticle, string> = {
  base: 'Base', pse: 'PSE', variante: 'Variante', option: 'Option',
};
const NATURE_COLORS: Record<NatureArticle, string> = {
  base: '', pse: 'bg-amber-100 text-amber-800', variante: 'bg-violet-100 text-violet-800',
  option: 'bg-sky-100 text-sky-800',
};

const TYPE_MARCHE_LABELS: Record<string, string> = {
  bons_de_commande: 'Marché à bons de commande',
  prix_unitaires: 'Marché à prix unitaires',
  mixte: 'Marché mixte (forfait + prix unitaires)',
};

// ── Totaux ────────────────────────────────────────────────────────────────────

/**
 * Recalcule les sous-totaux et le total. ATTENTION : ce total est
 * l'ESTIMATION DQE, jamais un montant de marché — le jeu de colonnes « bpu »
 * ne l'affiche pas, c'est ce qui distingue un bordereau d'un DPGF.
 */
function recomputeBPU(bpu: BPU): BPU {
  const lots = bpu.lots.map(l => recomputeLot(l));
  const totalHT = lots.reduce((s, l) => s + l.sousTotal, 0);
  return { ...bpu, lots, totalHT, totalTTC: totalHT * (1 + bpu.TVA / 100) };
}

/** Ventilation du montant estimatif par nature puis par tranche. */
function ventilation(bpu: BPU) {
  const parNature: Record<string, number> = {};
  const parTranche: Record<string, number> = {};
  forEachLigne(bpu.lots, (ligne: BPULigne, chap: BPUChapitre, lot: BPULot) => {
    if (ligne.children?.length) return; // le parent porte la somme de ses enfants
    const montant = ligne.prixTotal || 0;
    const nature = natureEffective(ligne);
    parNature[nature] = (parNature[nature] ?? 0) + montant;
    const tId = trancheEffective(lot, chap, ligne) ?? '__hors__';
    parTranche[tId] = (parTranche[tId] ?? 0) + montant;
  });
  return { parNature, parTranche };
}

// ── Composant ─────────────────────────────────────────────────────────────────

export const BPUWorkspace: React.FC<BPUWorkspaceProps> = ({
  bpu, onChange, onSave, mode, projectName, offres = [], projectLots = [],
  showTree: showTreeProp, onToggleTree, onDragStart, onDropExternal,
  onInitFromDpgf, onPushToDpgf, onOpenLibrary, onPushToLibrary,
  onImportOffre, onExportPdf, onExportExcel, onPushToAct,
}) => {
  const [colSet, setColSet] = useState<ColSet>(mode);
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set(bpu.lots.map(l => l.id)));
  const [expandedChaps, setExpandedChaps] = useState<Set<string>>(
    new Set(bpu.lots.flatMap(l => l.chapitres.map(c => c.id))),
  );
  const [expandedLignes, setExpandedLignes] = useState<Set<string>>(new Set());
  const [localShowTree, setLocalShowTree] = useState(true);
  const showTree = showTreeProp !== undefined ? showTreeProp : localShowTree;
  const toggleTree = onToggleTree ?? (() => setLocalShowTree(v => !v));
  const [selectedLotId, setSelectedLotId] = useState<string | null>(bpu.lots[0]?.id ?? null);
  // Vraie sélection multiple : l'envoi vers la bibliothèque et toute opération
  // en lot en dépendent. DPGFWorkspace n'en a jamais eu.
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowKey: string; field: string; value: string } | null>(null);
  const [clipboard, setClipboard] = useState<BPULigne | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [showMarche, setShowMarche] = useState(false);
  const [showTranches, setShowTranches] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  // Chapitre visé par une insertion depuis la bibliothèque.
  const [selectedChap, setSelectedChap] = useState<{ lotIdx: number; chapIdx: number } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const flatRows = useMemo<FlatRow<BPULot, BPUChapitre, BPULigne>[]>(
    () => buildFlatRows(bpu.lots, { expandedLots, expandedChaps, expandedLignes }),
    [bpu.lots, expandedLots, expandedChaps, expandedLignes],
  );
  const rowKey = rowKeyOf;

  const showQte = colSet === 'dqe' || colSet === 'comparatif';
  const showMontant = colSet === 'dqe';
  const showLettres = colSet === 'bpu' && bpu.prixEnLettres;
  const showOffres = colSet === 'comparatif';
  // Un bordereau de prix unitaires n'a pas de total : c'est justement ce qui le
  // distingue d'un DPGF, et l'afficher serait l'erreur métier à ne pas commettre.
  const showTotaux = colSet !== 'bpu';

  const nbCols = 4 + (showQte ? 1 : 0) + 1 + (showMontant ? 1 : 0)
    + (showLettres ? 1 : 0) + (showOffres ? offres.length + 1 : 0) + 1;

  // ── Mutations ───────────────────────────────────────────────────────────────
  const mutateLots = useCallback((fn: (lots: BPULot[]) => BPULot[]) => {
    const lots = fn(JSON.parse(JSON.stringify(bpu.lots)) as BPULot[]);
    onChange(recomputeBPU({ ...bpu, lots }));
  }, [bpu, onChange]);

  const patchBpu = (patch: Partial<BPU>) => onChange(recomputeBPU({ ...bpu, ...patch }));

  // ── Repli / dépli ───────────────────────────────────────────────────────────
  const toggleIn = (set: Set<string>, id: string) => {
    const s = new Set(set);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  };
  const toggleLot = (id: string) => setExpandedLots(p => toggleIn(p, id));
  const toggleChap = (id: string) => setExpandedChaps(p => toggleIn(p, id));
  const toggleLigne = (id: string) => setExpandedLignes(p => toggleIn(p, id));

  const expandAll = () => {
    setExpandedLots(new Set(bpu.lots.map(l => l.id)));
    setExpandedChaps(new Set(bpu.lots.flatMap(l => l.chapitres.map(c => c.id))));
    const ids = new Set<string>();
    bpu.lots.forEach(lot => lot.chapitres.forEach(chap => collectLigneIdsWithChildren(chap.lignes, ids)));
    setExpandedLignes(ids);
  };
  const collapseAll = () => {
    setExpandedLots(new Set()); setExpandedChaps(new Set()); setExpandedLignes(new Set());
  };

  const scrollToLot = (lotId: string) => {
    setSelectedLotId(lotId);
    setExpandedLots(prev => new Set([...prev, lotId]));
    setTimeout(() => {
      tableRef.current?.querySelector(`[data-lot-id="${lotId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  // ── Ajout / suppression ─────────────────────────────────────────────────────
  const addLot = () => {
    const id = newId();
    const lot: BPULot = {
      id, numero: String(bpu.lots.length + 1).padStart(2, '0'),
      titre: 'Nouveau lot', chapitres: [], sousTotal: 0,
    };
    mutateLots(lots => [...lots, lot]);
    setExpandedLots(prev => new Set([...prev, id]));
    setSelectedLotId(id);
  };

  const addChapitre = () => {
    if (!selectedLotId) return;
    const id = newId();
    mutateLots(lots => lots.map(lot => lot.id !== selectedLotId ? lot : {
      ...lot,
      chapitres: [...lot.chapitres, {
        id, numero: `${lot.numero}.${lot.chapitres.length + 1}`,
        titre: 'Nouveau chapitre', lignes: [],
      } as BPUChapitre],
    }));
    setExpandedChaps(prev => new Set([...prev, id]));
  };

  const makeLigne = (numero: string): BPULigne => ({
    id: newId(), numero, designation: 'Nouvel article', unite: 'u',
    quantite: 0, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage',
    nature: 'base', children: [],
  });

  const addLigne = (lotIdx: number, chapIdx: number) => {
    const chap = bpu.lots[lotIdx].chapitres[chapIdx];
    const ligne = makeLigne(`${chap.numero}.${chap.lignes.length + 1}`);
    mutateLots(lots => {
      const next = [...lots];
      const lot = { ...next[lotIdx] };
      const c = { ...lot.chapitres[chapIdx] };
      c.lignes = [...c.lignes, ligne];
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), c, ...lot.chapitres.slice(chapIdx + 1)];
      next[lotIdx] = recomputeLot(lot);
      return next;
    });
  };

  const addSubLigne = (lotIdx: number, chapIdx: number, parentPath: number[]) => {
    if (2 + parentPath.length >= MAX_ARTICLE_DEPTH) return;
    let parent = bpu.lots[lotIdx].chapitres[chapIdx].lignes[parentPath[0]];
    for (let i = 1; i < parentPath.length; i++) parent = parent.children![parentPath[i]];
    const ligne = makeLigne(`${parent.numero}.${(parent.children ?? []).length + 1}`);
    mutateLots(lots => {
      const next = [...lots];
      const lot = { ...next[lotIdx] };
      const chap = { ...lot.chapitres[chapIdx] };
      chap.lignes = addChildToLigneAtPath([...chap.lignes], parentPath, ligne);
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), chap, ...lot.chapitres.slice(chapIdx + 1)];
      next[lotIdx] = recomputeLot(lot);
      return next;
    });
    setExpandedLignes(prev => new Set([...prev, parent.id]));
  };

  const deleteLigne = (lotIdx: number, chapIdx: number, path: number[]) => {
    mutateLots(lots => {
      const next = [...lots];
      const lot = { ...next[lotIdx] };
      const chap = { ...lot.chapitres[chapIdx] };
      chap.lignes = deleteLigneAtPath([...chap.lignes], path);
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), chap, ...lot.chapitres.slice(chapIdx + 1)];
      next[lotIdx] = recomputeLot(lot);
      return next;
    });
  };

  const deleteChapitre = (lotIdx: number, chapIdx: number) =>
    mutateLots(lots => {
      const next = [...lots];
      const lot = { ...next[lotIdx] };
      lot.chapitres = lot.chapitres.filter((_, i) => i !== chapIdx);
      next[lotIdx] = recomputeLot(lot);
      return next;
    });

  const deleteLot = (lotIdx: number) => mutateLots(lots => lots.filter((_, i) => i !== lotIdx));

  // ── Édition de cellule ──────────────────────────────────────────────────────
  const startEdit = (rKey: string, field: string, value: string | number) =>
    setEditingCell({ rowKey: rKey, field, value: String(value ?? '') });
  const cancelEdit = () => setEditingCell(null);

  const commitEdit = (raw: string) => {
    if (!editingCell) return;
    const { rowKey: rKey, field } = editingCell;
    const parsed = parseRowKey(rKey);
    if (!parsed) { setEditingCell(null); return; }

    if (parsed.kind === 'ligne') {
      const { lotIdx: li, chapIdx: ci, lignePath } = parsed;
      mutateLots(lots => {
        const next = [...lots];
        const lot = { ...next[li] };
        const chap = { ...lot.chapitres[ci] };
        chap.lignes = mutateLigneAtPath([...chap.lignes], lignePath, (ligne: BPULigne) => {
          switch (field) {
            case 'numero': return { ...ligne, numero: raw };
            case 'designation': return { ...ligne, designation: raw };
            case 'unite': return { ...ligne, unite: raw };
            case 'prixUnitaireLettres': return { ...ligne, prixUnitaireLettres: raw };
            case 'quantite': {
              const q = evalFormula(raw);
              return { ...ligne, quantite: q, prixTotal: q * ligne.prixUnitaire };
            }
            case 'prixUnitaire': {
              const pu = evalFormula(raw);
              // Un libellé en lettres saisi à la main est conservé par le
              // spread ; sans surcharge, il reste dérivé du nombre à l'affichage.
              return { ...ligne, prixUnitaire: pu, prixTotal: ligne.quantite * pu };
            }
            case 'prixTotal': return { ...ligne, prixTotal: evalFormula(raw) };
            default: return ligne;
          }
        });
        lot.chapitres = [...lot.chapitres.slice(0, ci), chap, ...lot.chapitres.slice(ci + 1)];
        next[li] = recomputeLot(lot);
        return next;
      });
    } else if (parsed.kind === 'chapitre') {
      const { lotIdx: li, chapIdx: ci } = parsed;
      mutateLots(lots => {
        const next = [...lots];
        const lot = { ...next[li] };
        lot.chapitres = lot.chapitres.map((c, i) => i === ci ? { ...c, [field]: raw } : c);
        next[li] = lot;
        return next;
      });
    } else {
      const { lotIdx: li } = parsed;
      mutateLots(lots => lots.map((l, i) => i === li ? { ...l, [field]: raw } : l));
    }
    setEditingCell(null);
  };

  /** Applique un correctif à un article désigné par sa clé de ligne. */
  const patchLigneAt = (rKey: string, patch: Partial<BPULigne>) => {
    const parsed = parseRowKey(rKey);
    if (parsed?.kind !== 'ligne') return;
    const { lotIdx: li, chapIdx: ci, lignePath } = parsed;
    mutateLots(lots => {
      const next = [...lots];
      const lot = { ...next[li] };
      const chap = { ...lot.chapitres[ci] };
      chap.lignes = mutateLigneAtPath([...chap.lignes], lignePath, (l: BPULigne) => ({ ...l, ...patch }));
      lot.chapitres = [...lot.chapitres.slice(0, ci), chap, ...lot.chapitres.slice(ci + 1)];
      next[li] = recomputeLot(lot);
      return next;
    });
  };

  // ── Sélection ───────────────────────────────────────────────────────────────
  const toggleSelect = (rKey: string, additive: boolean) => {
    setSelectedRowKeys(prev => {
      if (!additive) return prev.has(rKey) && prev.size === 1 ? new Set() : new Set([rKey]);
      return toggleIn(prev, rKey);
    });
  };

  const selectedLignes = (): BPULigne[] =>
    flatRows.filter(r => r.kind === 'ligne' && selectedRowKeys.has(rowKey(r)))
      .map(r => r.ligne!)
      .filter(Boolean);

  // ── Presse-papiers ──────────────────────────────────────────────────────────
  const copySelected = () => {
    const [first] = selectedLignes();
    if (first) setClipboard({ ...first });
  };

  const pasteLigne = () => {
    if (!clipboard || !selectedLotId) return;
    const lotIdx = bpu.lots.findIndex(l => l.id === selectedLotId);
    const chapIdx = bpu.lots[lotIdx]?.chapitres.length - 1;
    if (lotIdx < 0 || chapIdx < 0) return;
    mutateLots(lots => {
      const next = [...lots];
      const lot = { ...next[lotIdx] };
      const chap = { ...lot.chapitres[chapIdx] };
      chap.lignes = [...chap.lignes, { ...clipboard, id: newId(), refBpu: undefined, children: [] }];
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), chap, ...lot.chapitres.slice(chapIdx + 1)];
      next[lotIdx] = recomputeLot(lot);
      return next;
    });
  };

  // ── Glisser-déposer ─────────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, ligne: BPULigne) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/json', JSON.stringify(ligne));
    onDragStart?.(ligne);
  };

  const handleDrop = (e: React.DragEvent, row: FlatRow<BPULot, BPUChapitre, BPULigne>) => {
    e.preventDefault();
    setDropTarget(null);
    const raw = e.dataTransfer.getData('application/json');
    if (!raw || row.kind !== 'chapitre' || row.chapIdx === undefined) return;
    let ligne: BPULigne;
    try { ligne = JSON.parse(raw) as BPULigne; } catch { return; }
    // Une insertion par programme pendant une édition validerait dans le
    // mauvais article : les clés de ligne sont positionnelles.
    setEditingCell(null);
    mutateLots(lots => {
      const next = [...lots];
      const lot = { ...next[row.lotIdx] };
      const chap = { ...lot.chapitres[row.chapIdx!] };
      chap.lignes = [...chap.lignes, { ...ligne, id: newId(), refBpu: undefined, children: [] }];
      lot.chapitres = [...lot.chapitres.slice(0, row.chapIdx!), chap, ...lot.chapitres.slice(row.chapIdx! + 1)];
      next[row.lotIdx] = recomputeLot(lot);
      return next;
    });
    onDropExternal?.(ligne);
  };

  // ── Bibliothèque ────────────────────────────────────────────────────────────
  // La conversion article -> ligne de bordereau vit ici : un BPU n'a pas de
  // quantités (elles se constatent à l'exécution) et porte une nature au sens
  // du règlement de la consultation, deux choses qu'un DPGF ignore.
  const insererDepuisBibliotheque = (articles: ArticleBibliotheque[]) => {
    if (!selectedChap) return;
    const modeles: Omit<BPULigne, 'id'>[] = articles.map(a => ({
      numero: a.code ?? '',
      designation: a.designation,
      unite: a.unite || 'u',
      quantite: 0,
      prixUnitaire: Number(a.prix_unitaire) || 0,
      prixTotal: 0,
      type: 'ouvrage' as const,
      nature: 'base' as const,
      articleTypeId: a.id,   // provenance : c'est par ce fil que les prix remontent
      cctpDescription: a.description ?? undefined,
    }));
    const { lotIdx, chapIdx } = selectedChap;
    // Les clés de ligne sont positionnelles : une insertion par programme
    // pendant une édition validerait dans le mauvais article.
    setEditingCell(null);
    mutateLots(lots => {
      const next = [...lots];
      const lot = { ...next[lotIdx] };
      const chap = { ...lot.chapitres[chapIdx] };
      const base = chap.lignes.length;
      chap.lignes = [...chap.lignes, ...modeles.map((m, i) => ({
        ...m, id: newId(),
        numero: m.numero || `${chap.numero}.${base + i + 1}`,
      }))];
      lot.chapitres = [...lot.chapitres.slice(0, chapIdx), chap, ...lot.chapitres.slice(chapIdx + 1)];
      next[lotIdx] = recomputeLot(lot);
      return next;
    });
  };

  // ── Tranches ────────────────────────────────────────────────────────────────
  const addTranche = () => {
    const t: Tranche = {
      id: newId(), code: `T${bpu.tranches.length + 1}`,
      libelle: bpu.tranches.length === 0 ? 'Tranche ferme' : 'Tranche optionnelle',
      type: bpu.tranches.length === 0 ? 'ferme' : 'optionnelle',
      ordre: bpu.tranches.length,
    };
    patchBpu({ tranches: [...bpu.tranches, t] });
  };
  const patchTranche = (id: string, patch: Partial<Tranche>) =>
    patchBpu({ tranches: bpu.tranches.map(t => t.id === id ? { ...t, ...patch } : t) });
  const removeTranche = (id: string) =>
    patchBpu({ tranches: bpu.tranches.filter(t => t.id !== id) });

  // ── Ruban ───────────────────────────────────────────────────────────────────
  const selectionCount = selectedRowKeys.size;

  const ribbonTabs: RibbonTabDef[] = [
    {
      id: 'accueil', label: 'Accueil',
      groups: [
        {
          label: 'Presse-papiers',
          actions: [
            { id: 'copy', label: 'Copier', icon: <IconCopy size={20} />, onClick: copySelected, disabled: selectionCount === 0 },
            { id: 'paste', label: 'Coller', icon: <IconClipboard size={20} />, onClick: pasteLigne, disabled: !clipboard },
          ],
        },
        {
          label: 'Structure',
          actions: [
            { id: 'addLot', label: 'Lot', icon: <IconFolderPlus size={20} />, onClick: addLot },
            { id: 'addChap', label: 'Chapitre', icon: <IconStackPush size={20} />, onClick: addChapitre, disabled: !selectedLotId },
            {
              id: 'addLigne', label: 'Article', icon: <IconRowInsertBottom size={20} />,
              onClick: () => {
                const li = bpu.lots.findIndex(l => l.id === selectedLotId);
                if (li < 0 || bpu.lots[li].chapitres.length === 0) return;
                addLigne(li, bpu.lots[li].chapitres.length - 1);
              },
              disabled: !selectedLotId || (bpu.lots.find(l => l.id === selectedLotId)?.chapitres.length ?? 0) === 0,
            },
          ],
        },
        {
          label: 'Document',
          actions: [{ id: 'save', label: 'Enregistrer', icon: <IconDeviceFloppy size={20} />, onClick: onSave }],
        },
      ],
    },
    {
      id: 'vue', label: 'Vue',
      groups: [
        {
          label: 'Colonnes',
          actions: [
            { id: 'colBpu', label: 'BPU', icon: <IconLayoutColumns size={20} />, onClick: () => setColSet('bpu'), active: colSet === 'bpu' },
            { id: 'colDqe', label: 'DQE', icon: <IconLayoutColumns size={20} />, onClick: () => setColSet('dqe'), active: colSet === 'dqe' },
            { id: 'colCmp', label: 'Comparatif', icon: <IconScale size={20} />, onClick: () => setColSet('comparatif'), active: colSet === 'comparatif', disabled: offres.length === 0 },
          ],
        },
        {
          label: 'Volet arbre',
          actions: [{ id: 'tree', label: 'Arbre', icon: <IconLayoutSidebar size={20} />, onClick: toggleTree, active: showTree }],
        },
        {
          label: 'Développement',
          actions: [
            { id: 'expand', label: 'Tout développer', icon: <IconArrowsMaximize size={20} />, onClick: expandAll },
            { id: 'collapse', label: 'Tout réduire', icon: <IconArrowsMinimize size={20} />, onClick: collapseAll },
          ],
        },
      ],
    },
    {
      id: 'marche', label: 'Marché',
      groups: [
        {
          label: 'Cadre',
          actions: [
            { id: 'marche', label: 'En-tête', icon: <IconAbc size={20} />, onClick: () => setShowMarche(v => !v), active: showMarche },
            { id: 'tranches', label: 'Tranches', icon: <IconStackPush size={20} />, onClick: () => setShowTranches(v => !v), active: showTranches },
            {
              id: 'lettres', label: 'Prix en lettres', icon: <IconAbc size={20} />,
              onClick: () => patchBpu({ prixEnLettres: !bpu.prixEnLettres }), active: bpu.prixEnLettres,
            },
          ],
        },
        {
          label: 'DPGF',
          actions: [
            { id: 'fromDpgf', label: 'Initialiser depuis le DPGF', icon: <IconArrowsExchange size={20} />, onClick: () => onInitFromDpgf?.(), disabled: !onInitFromDpgf },
            { id: 'toDpgf', label: 'Reverser vers le DPGF', icon: <IconArrowsExchange size={20} />, onClick: () => onPushToDpgf?.(), disabled: !onPushToDpgf },
          ],
        },
      ],
    },
    {
      id: 'bibliotheque', label: 'Bibliothèque',
      groups: [
        {
          label: 'Prix du cabinet',
          actions: [
            { id: 'openLib', label: 'Ouvrir', icon: <IconBuildingStore size={20} />, onClick: () => { setShowLibrary(v => !v); onOpenLibrary?.(); }, active: showLibrary },
            {
              id: 'pushLib', label: `Envoyer${selectionCount ? ` (${selectionCount})` : ''}`,
              icon: <IconFileExport size={20} />,
              onClick: () => onPushToLibrary?.(selectedLignes()),
              disabled: !onPushToLibrary || selectionCount === 0,
            },
          ],
        },
      ],
    },
    {
      id: 'echange', label: 'Import / Export',
      groups: [
        {
          label: 'Aux entreprises',
          actions: [
            { id: 'xlsVierge', label: 'Excel vierge', icon: <IconTable size={20} />, onClick: () => onExportExcel?.(colSet, true), disabled: !onExportExcel },
            { id: 'xlsChiffre', label: 'Excel chiffré', icon: <IconTable size={20} />, onClick: () => onExportExcel?.(colSet, false), disabled: !onExportExcel },
            { id: 'pdf', label: 'PDF', icon: <IconFileTypePdf size={20} />, onClick: () => onExportPdf?.(colSet), disabled: !onExportPdf },
          ],
        },
        {
          label: 'Offres reçues',
          actions: [
            { id: 'import', label: 'Importer une offre', icon: <IconFileImport size={20} />, onClick: () => onImportOffre?.(), disabled: !onImportOffre },
            { id: 'toAct', label: 'Verser au comparatif ACT', icon: <IconScale size={20} />, onClick: () => onPushToAct?.(), disabled: !onPushToAct || offres.length === 0 },
          ],
        },
      ],
    },
  ];

  // ── Cellules ────────────────────────────────────────────────────────────────
  const CellInput = ({ value, onCommit, className = '' }: { value: string; onCommit: (v: string) => void; className?: string }) => {
    const [v, setV] = useState(value);
    return (
      <input
        autoFocus value={v}
        onChange={e => setV(e.target.value)}
        onFocus={e => e.target.select()}
        onBlur={() => onCommit(v)}
        onKeyDown={e => {
          if (e.key === 'Enter') { onCommit(v); e.currentTarget.blur(); }
          if (e.key === 'Escape') cancelEdit();
        }}
        className={`w-full px-1 py-0 bg-[#fffde7] border border-blue-400 rounded outline-none text-sm font-mono ${className}`}
      />
    );
  };

  const EditableCell = ({ rKey, field, value, numeric = false, className = '' }: {
    rKey: string; field: string; value: string | number; numeric?: boolean; className?: string;
  }) => {
    const isEditing = editingCell?.rowKey === rKey && editingCell?.field === field;
    if (isEditing) return <CellInput value={editingCell.value} onCommit={commitEdit} className={className} />;
    const display = numeric && typeof value === 'number' && value > 0 ? fmt2(value) : String(value || '');
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

  // ── Comparatif ──────────────────────────────────────────────────────────────
  /** Prix remis par chaque entreprise pour un article, et le moins-disant. */
  const prixOffres = (ligneId: string) => {
    const valeurs = offres.map(o => ({ offre: o, prix: o.prix?.[ligneId] ?? null }));
    const chiffres = valeurs.map(v => v.prix).filter((p): p is number => p != null && p > 0);
    const mini = chiffres.length ? Math.min(...chiffres) : null;
    return { valeurs, mini };
  };

  const totauxOffres = useMemo(() => {
    const totaux = new Map<string, number>();
    for (const o of offres) {
      let total = 0;
      forEachLigne(bpu.lots, (ligne: BPULigne) => {
        if (ligne.children?.length) return;
        const pu = o.prix?.[ligne.id];
        if (pu != null) total += pu * (ligne.quantite || 0);
      });
      totaux.set(o.id, total);
    }
    return totaux;
  }, [offres, bpu.lots]);

  const vent = useMemo(() => ventilation(bpu), [bpu]);
  const trancheById = useMemo(
    () => new Map(bpu.tranches.map(t => [t.id, t])), [bpu.tranches],
  );

  const grandTVA = bpu.totalHT * bpu.TVA / 100;

  // Dépassement de la fourchette d'un marché à bons de commande.
  const horsFourchette =
    colSet === 'dqe' && bpu.totalHT > 0 && (
      (bpu.marche.montantMaxiHT != null && bpu.totalHT > bpu.marche.montantMaxiHT) ||
      (bpu.marche.montantMiniHT != null && bpu.totalHT < bpu.marche.montantMiniHT)
    );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-zinc-900">
      <ProRibbon tabs={ribbonTabs} defaultTab="accueil" />

      {/* ── Cadre du marché ──────────────────────────────────────────────── */}
      {showMarche && (
        <MarchePanel bpu={bpu} onPatch={patchBpu} onClose={() => setShowMarche(false)} />
      )}

      {/* ── Tranches ─────────────────────────────────────────────────────── */}
      {showTranches && (
        <TranchesPanel
          bpu={bpu} onAdd={addTranche} onPatch={patchTranche} onRemove={removeTranche}
          onClose={() => setShowTranches(false)}
        />
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* ── Volet arbre ────────────────────────────────────────────────── */}
        {showTree && (
          <div className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-700 overflow-y-auto bg-[#f5f7fa] dark:bg-zinc-800/50 text-sm">
            <div className="px-3 py-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-700">
              {colSet === 'bpu' ? 'Bordereau' : 'Structure'}
            </div>
            {bpu.lots.map(lot => (
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
                  {showTotaux && <span className="text-[#1e5090] font-mono shrink-0 ml-1">{formatCurrency(lot.sousTotal)}</span>}
                </button>
                {expandedLots.has(lot.id) && lot.chapitres.map(chap => (
                  <div key={chap.id} className="pl-6 pr-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {chap.numero} {chap.titre}
                  </div>
                ))}
              </div>
            ))}
            <button
              className="w-full flex items-center gap-1 px-2 py-2 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-zinc-700 border-t border-zinc-200 dark:border-zinc-700 mt-2"
              onClick={addLot}
            >
              <IconPlus size={13} /> Nouveau lot
            </button>

            {/* TVA — sans objet sur un bordereau, qui n'a pas de montant. */}
            {showTotaux && (
              <div className="border-t border-zinc-200 dark:border-zinc-700 mt-2 p-2">
                <div className="text-[11px] text-zinc-500 mb-1">TVA (%)</div>
                <input
                  type="number" value={bpu.TVA}
                  onChange={e => patchBpu({ TVA: parseFloat(e.target.value) || 0 })}
                  className="w-16 px-2 py-1 text-xs border border-zinc-300 rounded focus:ring-1 focus:ring-blue-400 outline-none"
                />
              </div>
            )}
          </div>
        )}

        {/* ── Table ──────────────────────────────────────────────────────── */}
        <div ref={tableRef} className="flex-1 overflow-auto">
          {horsFourchette && (
            <div className="px-3 py-2 text-xs bg-amber-50 border-b border-amber-200 text-amber-800">
              Le montant estimatif ({formatCurrency(bpu.totalHT)}) sort de la fourchette du marché
              {bpu.marche.montantMiniHT != null && ` — mini ${formatCurrency(bpu.marche.montantMiniHT)}`}
              {bpu.marche.montantMaxiHT != null && ` — maxi ${formatCurrency(bpu.marche.montantMaxiHT)}`}.
            </div>
          )}

          <table className="w-full border-collapse text-sm" style={{ minWidth: showOffres ? 900 : 720 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#1e5090] text-white text-xs">
                <th className="px-2 py-2 text-left font-semibold w-8"></th>
                <th className="px-2 py-2 text-left font-semibold w-20">N°</th>
                <th className="px-2 py-2 text-left font-semibold">Désignation</th>
                <th className="px-2 py-2 text-center font-semibold w-16">Unité</th>
                {showQte && <th className="px-2 py-2 text-right font-semibold w-24">Quantité</th>}
                <th className="px-2 py-2 text-right font-semibold w-28">P.U. HT (€)</th>
                {showLettres && <th className="px-2 py-2 text-left font-semibold w-64">P.U. en lettres</th>}
                {showMontant && <th className="px-2 py-2 text-right font-semibold w-28">Montant HT (€)</th>}
                {showOffres && offres.map(o => (
                  <th key={o.id} className="px-2 py-2 text-right font-semibold w-28 truncate" title={o.entrepriseNom}>
                    {o.entrepriseNom}
                  </th>
                ))}
                {showOffres && <th className="px-2 py-2 text-right font-semibold w-24">Moins-disant</th>}
                <th className="px-2 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {flatRows.map(row => {
                const rKey = rowKey(row);
                const isDropTarget = dropTarget === rKey;

                if (row.kind === 'lot') {
                  const t = row.lot.trancheId ? trancheById.get(row.lot.trancheId) : undefined;
                  return (
                    <tr key={rKey} data-lot-id={row.lot.id}
                        className={`border-b border-[#9ab0cb] ${isDropTarget ? 'bg-blue-100' : 'bg-[#c8d8ec] dark:bg-blue-900/30'} font-bold`}>
                      <td className="px-2 py-2">
                        <button onClick={() => toggleLot(row.lot.id)} className="text-zinc-600">
                          {expandedLots.has(row.lot.id) ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        </button>
                      </td>
                      <td className="px-2 py-2"><EditableCell rKey={rKey} field="numero" value={row.lot.numero} /></td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <EditableCell rKey={rKey} field="titre" value={row.lot.titre} />
                          {t && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-200 text-zinc-700">{t.code}</span>}
                          {projectLots.length > 0 && (
                            <select
                              value={row.lot.projectLotId ?? ''}
                              onClick={e => e.stopPropagation()}
                              onChange={e => mutateLots(lots => lots.map((l, i) =>
                                i === row.lotIdx ? { ...l, projectLotId: e.target.value || undefined } : l))}
                              title="Lot du projet correspondant — requis pour verser au comparatif ACT"
                              className={`text-[10px] font-normal px-1 py-0.5 rounded border bg-white/70
                                ${row.lot.projectLotId ? 'border-zinc-300 text-zinc-600' : 'border-amber-300 text-amber-700'}`}
                            >
                              <option value="">Lot du projet…</option>
                              {projectLots.map(pl => (
                                <option key={pl.id} value={pl.id}>{pl.lot_number} — {pl.lot_title}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                      <td />
                      {showQte && <td />}
                      <td />
                      {showLettres && <td />}
                      {showMontant && <td className="px-2 py-2 text-right font-mono text-[#1e5090]">{formatCurrency(row.lot.sousTotal)}</td>}
                      {showOffres && offres.map(o => <td key={o.id} />)}
                      {showOffres && <td />}
                      <td className="px-1 py-2 text-right">
                        <button onClick={() => deleteLot(row.lotIdx)} className="text-red-400 hover:text-red-600 opacity-40 hover:opacity-100" title="Supprimer le lot">
                          <IconTrash size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                }

                if (row.kind === 'chapitre') {
                  return (
                    <tr key={rKey}
                        onClick={() => setSelectedChap({ lotIdx: row.lotIdx, chapIdx: row.chapIdx! })}
                        className={`bg-[#edf1f7] dark:bg-zinc-800/40 border-b border-zinc-200 cursor-pointer
                          ${isDropTarget ? 'ring-1 ring-blue-400' : ''}
                          ${showLibrary && selectedChap?.lotIdx === row.lotIdx && selectedChap?.chapIdx === row.chapIdx ? 'ring-1 ring-blue-500' : ''}`}
                        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropTarget(rKey); }}
                        onDragLeave={() => setDropTarget(null)}
                        onDrop={e => handleDrop(e, row)}>
                      <td className="px-2 py-1 pl-6">
                        <button onClick={() => toggleChap(row.chapitre!.id)} className="text-zinc-500">
                          {expandedChaps.has(row.chapitre!.id) ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                        </button>
                      </td>
                      <td className="px-2 py-1 text-xs text-zinc-500"><EditableCell rKey={rKey} field="numero" value={row.chapitre!.numero} /></td>
                      <td className="px-2 py-1 font-semibold text-xs text-zinc-700 dark:text-zinc-300" colSpan={nbCols - 3}>
                        <EditableCell rKey={rKey} field="titre" value={row.chapitre!.titre} />
                      </td>
                      <td className="px-1 py-1 text-right">
                        <button onClick={() => addLigne(row.lotIdx, row.chapIdx!)} className="text-blue-500 hover:text-blue-700 opacity-50 hover:opacity-100 mr-1" title="Ajouter un article">
                          <IconPlus size={12} />
                        </button>
                        <button onClick={() => deleteChapitre(row.lotIdx, row.chapIdx!)} className="text-red-400 hover:text-red-600 opacity-40 hover:opacity-100" title="Supprimer le chapitre">
                          <IconTrash size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                }

                // ── Article ──────────────────────────────────────────────
                const l = row.ligne!;
                const hasChildren = !!l.children?.length;
                const canAddChild = row.depth < MAX_ARTICLE_DEPTH;
                const nature = natureEffective(l);
                const isSelected = selectedRowKeys.has(rKey);
                const { valeurs, mini } = showOffres ? prixOffres(l.id) : { valeurs: [], mini: null };
                const lettres = l.prixUnitaireLettres ?? (l.prixUnitaire > 0 ? montantEnLettres(l.prixUnitaire) : '');

                return (
                  <tr key={rKey}
                      draggable={!hasChildren}
                      onDragStart={e => handleDragStart(e, l)}
                      onClick={e => toggleSelect(rKey, e.ctrlKey || e.metaKey)}
                      className={`border-b border-zinc-100 dark:border-zinc-800 cursor-pointer
                        ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-[#f0f6ff] dark:hover:bg-zinc-800/60'}
                        ${l.type === 'titre' ? 'bg-zinc-50 italic text-zinc-500' : ''}
                        ${l.type === 'commentaire' ? 'text-zinc-400' : ''}`}>
                    <td className="px-2 py-0.5" style={{ paddingLeft: 8 + row.depth * 12 }}>
                      {hasChildren && (
                        <button onClick={e => { e.stopPropagation(); toggleLigne(l.id); }} className="text-zinc-400">
                          {expandedLignes.has(l.id) ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-0.5 text-xs text-zinc-400"><EditableCell rKey={rKey} field="numero" value={l.numero} /></td>
                    <td className="px-2 py-0.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0"><EditableCell rKey={rKey} field="designation" value={l.designation} /></div>
                        {nature !== 'base' && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${NATURE_COLORS[nature]}`}>
                            {NATURE_LABELS[nature]}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-0.5 text-center text-xs"><EditableCell rKey={rKey} field="unite" value={l.unite} className="text-center" /></td>
                    {showQte && (
                      <td className="px-1 py-0.5">
                        {hasChildren ? null : <EditableCell rKey={rKey} field="quantite" value={l.quantite} numeric />}
                      </td>
                    )}
                    <td className="px-1 py-0.5">
                      {hasChildren ? null : <EditableCell rKey={rKey} field="prixUnitaire" value={l.prixUnitaire} numeric />}
                    </td>
                    {showLettres && (
                      <td className="px-1 py-0.5 text-[11px] text-zinc-500 italic">
                        <EditableCell rKey={rKey} field="prixUnitaireLettres" value={lettres} />
                      </td>
                    )}
                    {showMontant && (
                      <td className="px-1 py-0.5 text-right font-mono text-[#1e5090] font-medium">
                        {hasChildren
                          ? <span className="px-1 text-sm text-zinc-500 italic">{formatCurrency(sumLigne(l))}</span>
                          : <EditableCell rKey={rKey} field="prixTotal" value={l.prixTotal} numeric />}
                      </td>
                    )}
                    {showOffres && valeurs.map(({ offre, prix }) => (
                      <td key={offre.id}
                          className={`px-2 py-0.5 text-right font-mono text-xs
                            ${prix != null && mini != null && prix === mini ? 'bg-green-50 text-green-700 font-semibold' : ''}
                            ${prix == null ? 'text-zinc-300' : ''}`}
                          title={prix == null ? 'Non chiffré' : undefined}>
                        {prix == null ? '—' : fmt2(prix)}
                      </td>
                    ))}
                    {showOffres && (
                      <td className="px-2 py-0.5 text-right font-mono text-xs text-green-700">
                        {mini != null ? fmt2(mini) : ''}
                      </td>
                    )}
                    <td className="px-1 py-0.5 text-right whitespace-nowrap">
                      <NatureMenu current={nature} onPick={n => patchLigneAt(rKey, { nature: n })} />
                      {canAddChild && (
                        <button onClick={e => { e.stopPropagation(); addSubLigne(row.lotIdx, row.chapIdx!, row.lignePath!); }}
                                className="text-blue-500 hover:text-blue-700 opacity-40 hover:opacity-100 ml-0.5" title="Ajouter un sous-article">
                          <IconPlus size={11} />
                        </button>
                      )}
                      <button onClick={e => { e.stopPropagation(); deleteLigne(row.lotIdx, row.chapIdx!, row.lignePath!); }}
                              className="text-red-400 hover:text-red-600 opacity-40 hover:opacity-100 ml-0.5" title="Supprimer">
                        <IconX size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* ── Pieds de table ────────────────────────────────────────── */}
              {showTotaux && (
                <>
                  {Object.entries(vent.parNature).filter(([n]) => n !== 'base').map(([n, montant]) => (
                    <tr key={n} className="bg-zinc-50 dark:bg-zinc-800/20 text-xs">
                      <td colSpan={nbCols - 2} className="px-4 py-1 text-right text-zinc-500">
                        dont {NATURE_LABELS[n as NatureArticle]} (hors offre de base)
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-zinc-500">{formatCurrency(montant)}</td>
                      <td />
                    </tr>
                  ))}
                  {bpu.tranches.map(t => (
                    <tr key={t.id} className="bg-zinc-50 dark:bg-zinc-800/20 text-xs">
                      <td colSpan={nbCols - 2} className="px-4 py-1 text-right text-zinc-500">
                        {t.code} — {t.libelle} ({t.type})
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-zinc-500">{formatCurrency(vent.parTranche[t.id] ?? 0)}</td>
                      <td />
                    </tr>
                  ))}
                  <tr className="bg-[#edf1f7] dark:bg-zinc-800/30">
                    <td colSpan={nbCols - 2} className="px-4 py-2 text-right text-sm text-zinc-600 font-semibold">TVA {bpu.TVA} %</td>
                    <td className="px-2 py-2 text-right font-mono text-zinc-600">{formatCurrency(grandTVA)}</td>
                    <td />
                  </tr>
                  <tr className="bg-[#1e5090] text-white font-bold">
                    <td colSpan={nbCols - 2} className="px-4 py-2 text-right text-sm">
                      {colSet === 'comparatif' ? 'TOTAL HT' : 'MONTANT ESTIMATIF HT'}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{formatCurrency(bpu.totalHT)}</td>
                    <td />
                  </tr>
                  <tr className="bg-[#1a4080] text-white font-bold">
                    <td colSpan={nbCols - 2} className="px-4 py-2 text-right text-sm">MONTANT ESTIMATIF TTC</td>
                    <td className="px-2 py-2 text-right font-mono">{formatCurrency(bpu.totalTTC)}</td>
                    <td />
                  </tr>
                  {showOffres && (
                    <tr className="bg-[#0f2d5c] text-white font-bold text-xs">
                      <td colSpan={4 + (showQte ? 1 : 0) + 1} className="px-4 py-2 text-right">TOTAL DE L'OFFRE</td>
                      {offres.map(o => (
                        <td key={o.id} className="px-2 py-2 text-right font-mono">{formatCurrency(totauxOffres.get(o.id) ?? 0)}</td>
                      ))}
                      <td /><td />
                    </tr>
                  )}
                </>
              )}

              {/* Le bordereau se termine sur une mention, pas sur un total. */}
              {!showTotaux && (
                <tr className="bg-[#edf1f7] dark:bg-zinc-800/30">
                  <td colSpan={nbCols} className="px-4 py-3 text-xs text-zinc-500 italic text-center">
                    Un bordereau de prix unitaires ne comporte pas de total : les travaux sont réglés
                    sur quantités réellement exécutées. Basculer sur le jeu de colonnes « DQE » pour
                    obtenir le montant estimatif.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {bpu.lots.length === 0 && (
            <div className="p-10 text-center text-sm text-zinc-400">
              Ce {mode === 'bpu' ? 'bordereau' : 'DQE'} est vide.
              {onInitFromDpgf && ' Vous pouvez l’initialiser depuis le DPGF du projet (onglet Marché du ruban),'}
              {onInitFromDpgf ? ' ou créer' : ' Créez'} un premier lot.
            </div>
          )}
        </div>

        {/* ── Bibliothèque de prix du cabinet ──────────────────────────────── */}
        {showLibrary && (
          <PriceLibraryPanel
            onClose={() => setShowLibrary(false)}
            onInsert={insererDepuisBibliotheque}
            canInsert={!!selectedChap}
            hintCible="Sélectionnez d’abord un chapitre dans le bordereau"
          />
        )}
      </div>
    </div>
  );
};

// ── Cadre du marché ───────────────────────────────────────────────────────────

const MarchePanel: React.FC<{ bpu: BPU; onPatch: (p: Partial<BPU>) => void; onClose: () => void }> = ({ bpu, onPatch, onClose }) => {
  const m = bpu.marche;
  const set = (patch: Partial<typeof m>) => onPatch({ marche: { ...m, ...patch } });
  const field = 'px-2 py-1 text-xs border border-zinc-300 rounded focus:ring-1 focus:ring-blue-400 outline-none w-full';
  const label = 'block text-[11px] font-semibold text-zinc-500 mb-1';

  // Durée maximale, reconductions comprises : la valeur qui plafonne le marché.
  const dureeMax = (m.dureeInitialeMois ?? 0) + (m.nbReconductions ?? 0) * (m.dureeReconductionMois ?? m.dureeInitialeMois ?? 0);

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700 bg-[#f9fafb] dark:bg-zinc-800/30 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Cadre du marché</h3>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700"><IconX size={14} /></button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className={label}>Type de marché</label>
          <select className={field} value={m.typeMarche} onChange={e => set({ typeMarche: e.target.value as any })}>
            {Object.entries(TYPE_MARCHE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className={label}>Objet</label>
          <input className={field} value={m.objet ?? ''} onChange={e => set({ objet: e.target.value })} />
        </div>
        <div>
          <label className={label}>Référence</label>
          <input className={field} value={m.referenceMarche ?? ''} onChange={e => set({ referenceMarche: e.target.value })} />
        </div>
        <div>
          <label className={label}>Pouvoir adjudicateur</label>
          <input className={field} value={m.pouvoirAdjudicateur ?? ''} onChange={e => set({ pouvoirAdjudicateur: e.target.value })} />
        </div>
        <div>
          <label className={label}>Montant minimum HT (€)</label>
          <input type="number" className={field} value={m.montantMiniHT ?? ''}
                 onChange={e => set({ montantMiniHT: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
        </div>
        <div>
          <label className={label}>Montant maximum HT (€)</label>
          <input type="number" className={field} value={m.montantMaxiHT ?? ''}
                 onChange={e => set({ montantMaxiHT: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
        </div>
        <div>
          <label className={label}>Durée initiale (mois)</label>
          <input type="number" className={field} value={m.dureeInitialeMois ?? ''}
                 onChange={e => set({ dureeInitialeMois: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })} />
        </div>
        <div>
          <label className={label}>Nombre de reconductions</label>
          <input type="number" className={field} value={m.nbReconductions ?? ''}
                 onChange={e => set({ nbReconductions: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })} />
        </div>
        <div>
          <label className={label}>Durée d'une reconduction (mois)</label>
          <input type="number" className={field} value={m.dureeReconductionMois ?? ''}
                 onChange={e => set({ dureeReconductionMois: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })} />
        </div>
        <div>
          <label className={label}>Durée maximale totale</label>
          <div className="px-2 py-1 text-xs text-zinc-600 bg-zinc-100 rounded border border-zinc-200">
            {dureeMax > 0 ? `${dureeMax} mois` : '—'}
          </div>
        </div>
        <div>
          <label className={label}>Révision des prix</label>
          <input className={field} value={m.revisionPrix ?? ''} placeholder="Formule ou index"
                 onChange={e => set({ revisionPrix: e.target.value })} />
        </div>
        <div>
          <label className={label}>Délai de paiement (jours)</label>
          <input type="number" className={field} value={m.delaiPaiementJours ?? ''}
                 onChange={e => set({ delaiPaiementJours: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })} />
        </div>
      </div>
    </div>
  );
};

// ── Tranches ──────────────────────────────────────────────────────────────────

const TranchesPanel: React.FC<{
  bpu: BPU;
  onAdd: () => void;
  onPatch: (id: string, p: Partial<Tranche>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}> = ({ bpu, onAdd, onPatch, onRemove, onClose }) => {
  const field = 'px-2 py-1 text-xs border border-zinc-300 rounded focus:ring-1 focus:ring-blue-400 outline-none';
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700 bg-[#f9fafb] dark:bg-zinc-800/30 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Tranches</h3>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700"><IconX size={14} /></button>
      </div>
      {bpu.tranches.length === 0 && (
        <p className="text-xs text-zinc-400 mb-2">
          Aucune tranche. Un marché sans tranche est entièrement ferme.
        </p>
      )}
      <div className="space-y-1.5">
        {bpu.tranches.map(t => (
          <div key={t.id} className="flex items-center gap-2">
            <input className={`${field} w-20`} value={t.code} onChange={e => onPatch(t.id, { code: e.target.value })} />
            <input className={`${field} flex-1`} value={t.libelle} onChange={e => onPatch(t.id, { libelle: e.target.value })} />
            <select className={`${field} w-32`} value={t.type} onChange={e => onPatch(t.id, { type: e.target.value as Tranche['type'] })}>
              <option value="ferme">Ferme</option>
              <option value="optionnelle">Optionnelle</option>
            </select>
            <button onClick={() => onRemove(t.id)} className="text-red-400 hover:text-red-600"><IconTrash size={13} /></button>
          </div>
        ))}
      </div>
      <button onClick={onAdd} className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
        <IconPlus size={13} /> Ajouter une tranche
      </button>
    </div>
  );
};

// ── Nature d'un article ───────────────────────────────────────────────────────

const NatureMenu: React.FC<{ current: NatureArticle; onPick: (n: NatureArticle) => void }> = ({ current, onPick }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className="text-zinc-400 hover:text-zinc-700 opacity-40 hover:opacity-100 text-[10px] font-bold px-1"
        title="Nature de l'article (base, PSE, variante, option)"
      >
        {current === 'base' ? '·' : NATURE_LABELS[current].charAt(0)}
      </button>
      {open && (
        <span className="absolute right-0 top-full mt-1 z-30 bg-white border border-zinc-200 rounded shadow-lg text-xs min-w-[110px]"
              onMouseLeave={() => setOpen(false)}>
          {(Object.keys(NATURE_LABELS) as NatureArticle[]).map(n => (
            <button key={n}
                    onClick={e => { e.stopPropagation(); onPick(n); setOpen(false); }}
                    className={`block w-full text-left px-2.5 py-1 hover:bg-blue-50 ${n === current ? 'font-semibold text-blue-700' : ''}`}>
              {NATURE_LABELS[n]}
            </button>
          ))}
        </span>
      )}
    </span>
  );
};
