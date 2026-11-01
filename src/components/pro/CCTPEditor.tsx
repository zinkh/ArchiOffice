import { useTranslation } from 'react-i18next';
import { canDemote, demoteHierarchy, duplicateHierarchy, canMove, moveHierarchy, promoteHierarchy, ligneAtPath, type HierarchySelection } from './hierarchyOps';
import { LotTitleInput } from './LotTitleInput';
import React, { useEffect, useRef, useState } from 'react';
import {
  IconPlus, IconTrash, IconChevronRight, IconChevronDown, IconTag, IconBuildingStore,
  IconBuildingCommunity, IconSparkles, IconCopy, IconStackPush, IconRowInsertBottom,
  IconSubtask, IconArrowBarToLeft, IconArrowBarToRight, IconArrowsMaximize, IconArrowsMinimize,
  IconLayoutSidebarLeftCollapse, IconDatabaseExport, IconCopyPlus, IconClipboard, IconAdjustmentsHorizontal,
} from '@tabler/icons-react';
import { useProToolbar, type ToolbarMenuEntry } from './toolbar/toolbarState';
import { ToolbarMenu } from './toolbar/ToolbarMenu';
import { hierarchyKey } from './hierarchyOps';
import { VARIABLES_CCTP, jeton, type ContexteCctp } from '../../lib/cctpVariables';
import { basculerBatimentEnMasse, batimentsParOrdre, etatBatimentSelection, aDesCiblesBatiments } from '../../lib/batimentsArticles';
import type { ProNotify } from './DPGFWorkspace';
import { IconChevronDown as IconChevronDownSmall, IconVariable } from '@tabler/icons-react';
import { SelectionBar, type SelectionAction } from './toolbar/SelectionBar';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { DPGF, Chapitre, Ligne, type ImageArticle } from '../../types/dpgf';
import { PriceLibraryPanel } from './PriceLibraryPanel';
import { DecoupagePanel, SelecteursDecoupage } from './DecoupagePanel';
import type { ArticleBibliotheque } from '../../types/library';
import { CctpGenerateDialog } from './CctpGenerateDialog';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import { lotsDepuisGeneration, type CctpGenerationEngine, type GeneratedLot } from '../../lib/cctpGeneration';
import { SignedImage } from '../SignedImage';
import { IconPhotoPlus, IconX } from '@tabler/icons-react';
import { useCibleRecherche } from '../../hooks/useCibleRecherche';
import type { CibleRecherche } from '../../lib/proRecherche';
import { legendeImage, localisationsConnues, nouvelleImage, retirerImage } from '../../lib/cctpImages';
import { envoyerIllustration } from '../../lib/cctpImagesUpload';
import { numeroDeChapitre } from '../../lib/chapitresParDefaut';
import { chargerEtatArbre, ouvertsSauf, repliesParmi, sauverEtatArbre } from '../../lib/cctpTreeState';
import { appliquerCouleur, basculerBalise, contientMiseEnForme, type BaliseRiche, type EditionTexte } from '../../lib/cctpRichText';
import { CctpRichPreview, CctpRichToolbar } from './CctpRichText';
import { CctpExportLibraryDialog } from './CctpExportLibraryDialog';
import { CctpDraftPosteDialog, type PosteARediger } from './CctpDraftPosteDialog';
import { ajouterClause, estClause, type ExportBibliotheque } from '../../lib/bibliothequeClauses';
import { takeLigneAtPath, insertLigneAtPath, renumeroterLignes, MAX_ARTICLE_DEPTH, childNumber, addChildToLigneAtPath, parseRowKey } from './treeOps';
import { collectSelectedLignes, deleteSelection, parseSelection, pasteLignes } from './selectionOps';
import { dupliquerSelection, modifierEnMasse, type PatchMasse } from './cctpBulkOps';
import { CctpBulkEditDialog } from './CctpBulkEditDialog';

interface CCTPEditorProps {
  /** Ouvre l'import d'un fichier qui remplit le CCTP (les lignes absentes deviennent des articles). */
  onImportDocument?: () => void;
  /** Trouvaille de la recherche à ouvrir et montrer. */
  searchTarget?: CibleRecherche | null;
  dpgf: DPGF;
  onChange: (dpgf: DPGF) => void;
  /** Volet de structure, piloté par le menu « ⋯ » de ProTab. */
  showTree?: boolean;
  onToggleTree?: () => void;
  /** Drop cross-panel : appelé quand une ligne est déposée depuis le panneau droit. */
  onDropExternal?: (ligne: Ligne) => void;
  projectName?: string;
  /** Données de l'opération pour les textes automatiques ({{adresse}}...). */
  contexte?: ContexteCctp;
  notify?: ProNotify;
}

let _uid = 0;
const uid = () => `cctp_${Date.now()}_${_uid++}`;

function flattenCctpLignes(lignes: Ligne[], prefix: number[] = [], depth = 0): Array<{ ligne: Ligne; path: number[]; depth: number }> {
  return lignes.flatMap((ligne, index) => [
    { ligne, path: [...prefix, index], depth },
    ...(ligne.children?.length ? flattenCctpLignes(ligne.children, [...prefix, index], depth + 1) : []),
  ]);
}

type Selection = HierarchySelection;

export const CCTPEditor: React.FC<CCTPEditorProps> = ({ dpgf, onChange, showTree: showTreeProp, onToggleTree, onDropExternal, projectName, contexte, notify, onImportDocument, searchTarget }) => {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [localShowTree, setLocalShowTree] = useState(true);
  const showTree = showTreeProp ?? localShowTree;
  const toggleTree = onToggleTree ?? (() => setLocalShowTree(v => !v));
  // L'arbre se rouvre comme on l'a laissé (voir lib/cctpTreeState) : on relit
  // ce qui était replié, tout le reste est ouvert.
  const [arbreInitial] = useState(() => chargerEtatArbre(dpgf.projectId));
  const [expandedLots, setExpandedLots] = useState<Set<string>>(
    () => ouvertsSauf(dpgf.lots.map(l => l.id), arbreInitial.lots)
  );
  const [expandedChaps, setExpandedChaps] = useState<Set<string>>(
    () => ouvertsSauf(dpgf.lots.flatMap(l => l.chapitres.map(c => c.id)), arbreInitial.chapitres)
  );
  // Éléments déjà vus : un lot ou un chapitre qui apparaît ensuite (ajout, import,
  // IA, DPGF) s'ouvre ; un élément connu que l'on a replié le reste.
  const elementsConnus = useRef(new Set<string>([
    ...dpgf.lots.map(l => l.id), ...dpgf.lots.flatMap(l => l.chapitres.map(c => c.id)),
  ]));
  useEffect(() => {
    const lotIds = dpgf.lots.map(l => l.id);
    const chapIds = dpgf.lots.flatMap(l => l.chapitres.map(c => c.id));
    const nouveauxLots = lotIds.filter(id => !elementsConnus.current.has(id));
    const nouveauxChaps = chapIds.filter(id => !elementsConnus.current.has(id));
    [...nouveauxLots, ...nouveauxChaps].forEach(id => elementsConnus.current.add(id));
    if (nouveauxLots.length) setExpandedLots(prev => new Set([...prev, ...nouveauxLots]));
    if (nouveauxChaps.length) setExpandedChaps(prev => new Set([...prev, ...nouveauxChaps]));
    sauverEtatArbre(dpgf.projectId, {
      lots: repliesParmi(lotIds, new Set([...expandedLots, ...nouveauxLots])),
      chapitres: repliesParmi(chapIds, new Set([...expandedChaps, ...nouveauxChaps])),
    });
  }, [dpgf.lots, dpgf.projectId, expandedLots, expandedChaps]);
  const [selection, setSelection] = useState<Selection | null>(null);

  // Trouvaille choisie dans la recherche : dépliée, sélectionnée (son texte
  // s'ouvre dans l'éditeur), puis montrée dans l'arbre.
  useCibleRecherche(searchTarget, c => {
    setExpandedLots(prev => new Set([...prev, c.lotId]));
    if (c.chapId) setExpandedChaps(prev => new Set([...prev, c.chapId!]));
    setSelection(c.kind === 'lot' ? { kind: 'lot', lotIdx: c.lotIdx }
      : c.kind === 'chapitre' ? { kind: 'chapitre', lotIdx: c.lotIdx, chapIdx: c.chapIdx! }
        : { kind: 'ligne', lotIdx: c.lotIdx, chapIdx: c.chapIdx!, lignePath: c.lignePath! });
  });
  const [showLibrary, setShowLibrary] = useState(false);
  const [showDecoupage, setShowDecoupage] = useState(false);
  const [dragSource, setDragSource] = useState<{ lotIdx: number; chapIdx: number; path: number[] } | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showExportLibrary, setShowExportLibrary] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  // Chapitre visé par une insertion : celui sélectionné, ou celui de
  // l'article sélectionné — on écrit rarement un CCTP en repartant du titre.
  const chapitreVise = selection && selection.kind !== 'lot'
    ? { lotIdx: selection.lotIdx, chapIdx: selection.chapIdx }
    : null;

  // ── Mutation helper ───────────────────────────────────────────────────────
  const mutateDPGF = (fn: (d: DPGF) => void) => {
    const copy: DPGF = JSON.parse(JSON.stringify(dpgf));
    fn(copy);
    onChange(copy);
  };

  const toggleLot = (id: string) => setExpandedLots(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });
  const toggleChap = (id: string) => setExpandedChaps(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });

  // ── Add items (visible in DPGF by default; mark "CCTP uniquement" via the toggle) ──
  const addCCTPChapitre = (lotIdx: number) => {
    const lot = dpgf.lots[lotIdx];
    const newChap: Chapitre = {
      id: uid(),
      numero: numeroDeChapitre(lot.chapitres.length),
      titre: 'Nouveau chapitre',
      lignes: [],
      cctpOnly: false,
      cctpDescription: '',
    };
    mutateDPGF(d => d.lots[lotIdx].chapitres.push(newChap));
    setExpandedLots(prev => new Set([...prev, lot.id]));
    setSelection({ kind: 'chapitre', lotIdx, chapIdx: lot.chapitres.length });
  };

  const addCCTPLigne = (lotIdx: number, chapIdx: number) => {
    const chap = dpgf.lots[lotIdx].chapitres[chapIdx];
    const newLigne: Ligne = {
      id: uid(),
      numero: `${chap.numero}.${chap.lignes.length + 1}`,
      designation: 'Nouvel article',
      unite: '',
      quantite: 0,
      prixUnitaire: 0,
      prixTotal: 0,
      type: 'ouvrage',
      cctpOnly: false,
      cctpDescription: '',
      children: [],
    };
    mutateDPGF(d => d.lots[lotIdx].chapitres[chapIdx].lignes.push(newLigne));
    setExpandedChaps(prev => new Set([...prev, chap.id]));
    setSelection({ kind: 'ligne', lotIdx, chapIdx, lignePath: [chap.lignes.length] });
  };

  // ── Bibliothèque d'ouvrages ───────────────────────────────────────────────
  // La description technique de l'article de bibliothèque devient le texte du
  // CCTP : c'est précisément ce qu'on vient y chercher. La désignation, l'unité
  // et le prix suivent, pour que le même article serve aussi au DPGF sans
  // ressaisie, et `articleTypeId` garde le lien vers la bibliothèque.
  const insererDepuisBibliotheque = (articles: ArticleBibliotheque[]): boolean | void => {
    // Une clause générale n'est pas un article : son texte s'ajoute à la
    // description de l'élément sélectionné (lot, chapitre ou article).
    const clauses = articles.filter(estClause);
    articles = articles.filter(a => !estClause(a));
    if (clauses.length) {
      if (!selection || !selData) return false;
      let texte = selData.description;
      let nb = 0;
      for (const c of clauses) {
        const r = ajouterClause(texte, c.description ?? '');
        texte = r.texte;
        if (r.ajoute) nb++;
      }
      if (nb) updateDescription(texte);
      notify?.(nb ? t('pro_cctp_clause_added', { count: nb, cible: selData.name }) : t('pro_cctp_clause_present', { cible: selData.name }),
        { type: nb ? 'success' : 'error' });
    }
    if (!articles.length) return;
    if (!chapitreVise) {
      notify?.(t('pro_cctp_library_need_chapter'), { type: 'error' });
      return false;
    }
    const { lotIdx, chapIdx } = chapitreVise;
    const chap = dpgf.lots[lotIdx].chapitres[chapIdx];
    const base = chap.lignes.length;
    const nouvelles: Ligne[] = articles.map((a, i) => ({
      id: uid(),
      numero: a.code || `${chap.numero}.${base + i + 1}`,
      designation: a.designation,
      unite: a.unite || '',
      quantite: 0,
      prixUnitaire: Number(a.prix_unitaire) || 0,
      prixTotal: 0,
      type: 'ouvrage',
      cctpOnly: false,
      cctpDescription: a.description ?? '',
      children: [],
      articleTypeId: a.id,
    }));
    mutateDPGF(d => { d.lots[lotIdx].chapitres[chapIdx].lignes.push(...nouvelles); });
    setExpandedChaps(prev => new Set([...prev, chap.id]));
    setSelection({ kind: 'ligne', lotIdx, chapIdx, lignePath: [base] });
  };

  // ── Génération par IA ─────────────────────────────────────────────────────
  // Les lots proposés s'ajoutent après les lots existants, jamais à leur
  // place : un CCTP déjà rédigé ne doit pas être écrasé par une proposition.
  const insererGeneration = (generated: GeneratedLot[], engine: CctpGenerationEngine) => {
    const nouveaux = lotsDepuisGeneration(generated, dpgf.lots.length, engine, uid);
    mutateDPGF(d => { d.lots.push(...nouveaux); });
    setExpandedLots(prev => new Set([...prev, ...nouveaux.map(l => l.id)]));
    setExpandedChaps(prev => new Set([...prev, ...nouveaux.flatMap(l => l.chapitres.map(c => c.id))]));
    setSelection({ kind: 'lot', lotIdx: dpgf.lots.length });
    setShowGenerate(false);
  };

  // ── Delete CCTP-only items ────────────────────────────────────────────────
  const deleteCCTPChapitre = (lotIdx: number, chapIdx: number) => {
    mutateDPGF(d => d.lots[lotIdx].chapitres.splice(chapIdx, 1));
    setSelection(null);
  };

  const deleteCCTPLigne = (lotIdx: number, chapIdx: number, path: number[]) => {
    mutateDPGF(d => { const chap = d.lots[lotIdx].chapitres[chapIdx]; chap.lignes = takeLigneAtPath(chap.lignes, path).lignes; });
    setSelection(null);
  };

  // ── Toggle DPGF visibility ────────────────────────────────────────────────
  const toggleDpgfVisibility = () => {
    if (!selection || selection.kind === 'lot') return;
    mutateDPGF(d => {
      if (selection.kind === 'chapitre') {
        const chap = d.lots[selection.lotIdx].chapitres[selection.chapIdx];
        chap.cctpOnly = !chap.cctpOnly;
      } else {
        const ligne = ligneAtPath(d.lots[selection.lotIdx].chapitres[selection.chapIdx].lignes, selection.lignePath)!;
        ligne.cctpOnly = !ligne.cctpOnly;
      }
    });
  };

  // ── Update description ────────────────────────────────────────────────────
  const updateDescription = (desc: string) => {
    if (!selection) return;
    mutateDPGF(d => {
      if (selection.kind === 'lot') {
        (d.lots[selection.lotIdx] as any).cctpDescription = desc;
      } else if (selection.kind === 'chapitre') {
        d.lots[selection.lotIdx].chapitres[selection.chapIdx].cctpDescription = desc;
      } else {
        ligneAtPath(d.lots[selection.lotIdx].chapitres[selection.chapIdx].lignes, selection.lignePath)!.cctpDescription = desc;
      }
    });
  };

  // ── Update name (CCTP-only items only) ───────────────────────────────────
  const updateName = (name: string) => {
    if (!selection) return;
    mutateDPGF(d => {
      if (selection.kind === 'chapitre') {
        d.lots[selection.lotIdx].chapitres[selection.chapIdx].titre = name;
      } else if (selection.kind === 'ligne') {
        ligneAtPath(d.lots[selection.lotIdx].chapitres[selection.chapIdx].lignes, selection.lignePath)!.designation = name;
      }
    });
  };

  // ── Bâtiment / phase / localisation ───────────────────────────────────────
  // Même registre document + attribut hérité que le DPGF et le BPU (voir
  // DecoupageDocument dans types/dpgf.ts) : le CCTP partage le même dpgf.lots.
  const updateBatimentPhase = (champ: 'batimentId' | 'phaseId', valeur: string | undefined) => {
    if (!selection) return;
    mutateDPGF(d => {
      if (selection.kind === 'lot') {
        (d.lots[selection.lotIdx] as any)[champ] = valeur;
      } else if (selection.kind === 'chapitre') {
        (d.lots[selection.lotIdx].chapitres[selection.chapIdx] as any)[champ] = valeur;
      } else {
        (ligneAtPath(d.lots[selection.lotIdx].chapitres[selection.chapIdx].lignes, selection.lignePath)! as any)[champ] = valeur;
      }
    });
  };

  const updateLocalisation = (localisation: string) => {
    if (!selection || selection.kind !== 'ligne') return;
    mutateDPGF(d => {
      ligneAtPath(d.lots[selection.lotIdx].chapitres[selection.chapIdx].lignes, selection.lignePath)!.localisation = localisation;
    });
  };

  // ── Illustrations de l'article ────────────────────────────────────────────
  const [envoiImages, setEnvoiImages] = useState(false);
  const [erreurImages, setErreurImages] = useState<string | null>(null);
  const localisations = localisationsConnues(dpgf);

  const mutateImages = (fn: (ligne: Ligne) => void) => {
    if (!selection || selection.kind !== 'ligne') return;
    mutateDPGF(d => fn(ligneAtPath(d.lots[selection.lotIdx].chapitres[selection.chapIdx].lignes, selection.lignePath)!));
  };
  const ajouterImages = async (fichiers: FileList | null) => {
    if (!fichiers?.length || !selection || selection.kind !== 'ligne') return;
    const ligne = ligneAtPath(dpgf.lots[selection.lotIdx].chapitres[selection.chapIdx].lignes, selection.lignePath);
    if (!ligne) return;
    setEnvoiImages(true);
    setErreurImages(null);
    const ajoutees: ImageArticle[] = [];
    try {
      for (const fichier of Array.from(fichiers)) {
        ajoutees.push(nouvelleImage(await envoyerIllustration(dpgf.projectId, fichier), ligne));
      }
    } catch (e: any) {
      setErreurImages(e?.message || "Échec de l'envoi de l'image.");
    } finally {
      // Les images déjà envoyées sont gardées même si une suivante échoue.
      if (ajoutees.length) mutateImages(l => { l.images = [...(l.images ?? []), ...ajoutees]; });
      setEnvoiImages(false);
    }
  };

  // ── Export vers la bibliothèque ───────────────────────────────────────────
  const exportInitial = (sel: Selection, data: NonNullable<ReturnType<typeof getSelectedData>>): ExportBibliotheque => {
    if (sel.kind === 'ligne' && data.ligne) {
      return {
        type: 'ouvrage', designation: data.ligne.designation, unite: data.ligne.unite,
        prix_unitaire: data.ligne.prixUnitaire, description: data.description,
      };
    }
    const lot = dpgf.lots[sel.lotIdx];
    const titre = sel.kind === 'chapitre' ? lot?.chapitres[sel.chapIdx]?.titre : lot?.titre;
    return { type: 'clause', designation: titre ?? '', description: data.description };
  };

  // ── Rédaction IA d'un poste ───────────────────────────────────────────────
  const posteARediger = (sel: Selection, data: NonNullable<ReturnType<typeof getSelectedData>>): PosteARediger => {
    const lot = dpgf.lots[sel.lotIdx];
    const base = { lotTitre: lot?.titre ?? '', chapitreTitre: '', unite: '', localisation: '', texteExistant: data.description };
    if (sel.kind === 'lot') {
      return { ...base, kind: 'lot', titre: lot.titre, numero: lot.numero, voisins: dpgf.lots.filter((_, i) => i !== sel.lotIdx).map(l => l.titre) };
    }
    const chap = lot.chapitres[sel.chapIdx];
    if (sel.kind === 'chapitre') {
      return { ...base, kind: 'chapitre', titre: chap.titre, numero: chap.numero, voisins: lot.chapitres.filter((_, i) => i !== sel.chapIdx).map(c => c.titre) };
    }
    const ligne = data.ligne!;
    const parent = sel.lignePath.length > 1 ? ligneAtPath(chap.lignes, sel.lignePath.slice(0, -1)) : null;
    const freres = (parent ? parent.children ?? [] : chap.lignes).filter(l => l.id !== ligne.id);
    return {
      ...base, kind: 'article', titre: ligne.designation, numero: ligne.numero, chapitreTitre: chap.titre,
      unite: ligne.unite, localisation: ligne.localisation ?? '', voisins: freres.map(l => l.designation),
    };
  };
  // Un seul enregistrement : deux mutateDPGF successifs partent chacun du même
  // document et le second effacerait le premier.
  const appliquerRedaction = (texte: string, mode: 'remplacer' | 'ajouter') => {
    if (!selection || !selData) return;
    const nouveau = mode === 'remplacer' ? texte : ajouterClause(selData.description, texte).texte;
    mutateDPGF(d => {
      const lot = d.lots[selection.lotIdx];
      if (selection.kind === 'lot') (lot as any).cctpDescription = nouveau;
      else if (selection.kind === 'chapitre') lot.chapitres[selection.chapIdx].cctpDescription = nouveau;
      else {
        const l = ligneAtPath(lot.chapitres[selection.chapIdx].lignes, selection.lignePath)!;
        l.cctpDescription = nouveau;
        // Repère « IA » de l'arbre : un texte rédigé par l'IA se relit avant d'être assumé.
        l.genereParIa = l.genereParIa ?? 'llm';
      }
    });
    setShowDraft(false);
  };

  // ── Derive selected data ──────────────────────────────────────────────────
  const getSelectedData = () => {
    if (!selection) return null;
    if (selection.kind === 'lot') {
      const lot = dpgf.lots[selection.lotIdx];
      return {
        label: 'Lot', name: `${lot.numero} — ${lot.titre}`, cctpOnly: false,
        description: (lot as any).cctpDescription ?? '', ligne: null,
        batimentId: lot.batimentId, phaseId: lot.phaseId,
      };
    }
    if (selection.kind === 'chapitre') {
      const chap = dpgf.lots[selection.lotIdx]?.chapitres[selection.chapIdx];
      if (!chap) return null;
      return {
        label: 'Chapitre', name: `${chap.numero} — ${chap.titre}`, cctpOnly: !!chap.cctpOnly,
        description: chap.cctpDescription ?? '', ligne: null,
        batimentId: chap.batimentId, phaseId: chap.phaseId,
      };
    }
    const chap = dpgf.lots[selection.lotIdx]?.chapitres[selection.chapIdx];
    const ligne = chap && ligneAtPath(chap.lignes, selection.lignePath);
    if (!ligne) return null;
    return {
      label: 'Article', name: `${ligne.numero} — ${ligne.designation}`, cctpOnly: !!ligne.cctpOnly,
      description: ligne.cctpDescription ?? '', ligne,
      batimentId: ligne.batimentId, phaseId: ligne.phaseId,
    };
  };

  const selData = getSelectedData();
  const isSelCctpOnly = selData?.cctpOnly ?? false;

  const applyHierarchy = (result: ReturnType<typeof moveHierarchy>) => {
    const totalHT = result.lots.reduce((sum, lot) => sum + lot.sousTotal, 0);
    onChange({ ...dpgf, lots: result.lots, totalHT, totalTTC: totalHT * (1 + dpgf.TVA / 100) });
    setSelection(result.selection);
    // Seul le chemin de l'élément déplacé s'ouvre : le reste de l'arbre garde son état.
    const sel = result.selection;
    const lot = sel && result.lots[sel.lotIdx];
    if (lot) {
      setExpandedLots(prev => new Set([...prev, lot.id]));
      if (sel.kind !== 'lot' && lot.chapitres[sel.chapIdx]) setExpandedChaps(prev => new Set([...prev, lot.chapitres[sel.chapIdx].id]));
    }
  };
  const moveSelected = (direction: -1 | 1) => {
    if (selection) applyHierarchy(moveHierarchy(dpgf.lots, selection, direction));
  };
  const addSelectedChild = () => {
    if (selection?.kind !== 'ligne' || 1 + selection.lignePath.length >= MAX_ARTICLE_DEPTH) return;
    const chap = dpgf.lots[selection.lotIdx].chapitres[selection.chapIdx];
    const parent = ligneAtPath(chap.lignes, selection.lignePath);
    if (!parent) return;
    const index = parent.children?.length ?? 0;
    const child: Ligne = { id: uid(), numero: childNumber(parent.numero, index, 2 + selection.lignePath.length), designation: t('pro_new_article'), unite: '', quantite: 0, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', cctpOnly: parent.cctpOnly };
    mutateDPGF(d => { const target = d.lots[selection.lotIdx].chapitres[selection.chapIdx]; target.lignes = addChildToLigneAtPath(target.lignes, selection.lignePath, child); });
    setSelection({ ...selection, lignePath: [...selection.lignePath, index] });
  };
  const promoteSelected = () => {
    if (selection) applyHierarchy(promoteHierarchy(dpgf.lots, selection, uid));
  };
  // ── Sélection multiple, copier / coller, dupliquer, modifier en masse ──────
  // `selection` reste l'élément affiché dans l'éditeur ; `multiKeys` porte la
  // sélection groupée (Ctrl/⌘ + clic, Maj + clic, cases à cocher). Elle ne vaut
  // que tant que l'élément affiché en fait partie, et elle est abandonnée dès
  // que la structure de l'arbre change (clés positionnelles, voir treeOps).
  const [multiKeys, setMultiKeys] = useState<Set<string>>(new Set());
  const [ancre, setAncre] = useState<string | null>(null);
  const [presse, setPresse] = useState<Ligne[]>([]);
  const [showBulk, setShowBulk] = useState(false);
  const arbreRef = useRef<HTMLDivElement>(null);
  const signatureArbre = dpgf.lots.map(l => `${l.id}:${l.chapitres.map(c => `${c.id}[${flattenCctpLignes(c.lignes).map(x => x.ligne.id).join(',')}]`).join('|')}`).join('/');
  useEffect(() => { setMultiKeys(prev => (prev.size ? new Set() : prev)); setAncre(null); }, [signatureArbre]);

  const clePrimaire = selection ? hierarchyKey(selection) : null;
  const multi = multiKeys.size > 1 && !!clePrimaire && multiKeys.has(clePrimaire);
  const clesActives: string[] = multi ? [...multiKeys] : clePrimaire ? [clePrimaire] : [];
  const estSel = (cle: string) => (multi ? multiKeys.has(cle) : cle === clePrimaire);
  const totauxDe = (lots: typeof dpgf.lots) => {
    const totalHT = lots.reduce((sum, lot) => sum + lot.sousTotal, 0);
    return { totalHT, totalTTC: totalHT * (1 + dpgf.TVA / 100) };
  };

  const clesVisibles = (): string[] => dpgf.lots.flatMap((lot, li) => [
    `lot-${li}`,
    ...(expandedLots.has(lot.id) ? lot.chapitres.flatMap((c, ci) => [
      `chap-${li}-${ci}`,
      ...(expandedChaps.has(c.id) ? flattenCctpLignes(c.lignes).map(x => `ligne-${li}-${ci}-${x.path.join('-')}`) : []),
    ]) : []),
  ]);
  const basculer = (sel: Selection) => {
    const cle = hierarchyKey(sel);
    const base = new Set(multi ? multiKeys : clePrimaire ? [clePrimaire] : []);
    if (base.has(cle)) base.delete(cle); else base.add(cle);
    setMultiKeys(base);
    setAncre(cle);
    setSelection(base.has(cle) ? sel : base.size ? (parseRowKey([...base].at(-1)!) as Selection) : null);
  };
  const cliquer = (sel: Selection, e: React.MouseEvent) => {
    // Le focus passe à l'arbre pour que Ctrl+C, V et D répondent aussitôt.
    arbreRef.current?.focus({ preventScroll: true });
    if (e.metaKey || e.ctrlKey) { basculer(sel); return; }
    const cle = hierarchyKey(sel);
    if (e.shiftKey && ancre) {
      const cles = clesVisibles();
      const a = cles.indexOf(ancre);
      const b = cles.indexOf(cle);
      if (a >= 0 && b >= 0) {
        setMultiKeys(new Set(cles.slice(Math.min(a, b), Math.max(a, b) + 1)));
        setSelection(sel);
        return;
      }
    }
    setMultiKeys(new Set([cle]));
    setAncre(cle);
    setSelection(sel);
  };

  const noeudDe = (s: Selection): any => {
    const lot = dpgf.lots[s.lotIdx];
    if (!lot) return undefined;
    return s.kind === 'lot' ? lot : s.kind === 'chapitre' ? lot.chapitres[s.chapIdx] : ligneAtPath(lot.chapitres[s.chapIdx]?.lignes ?? [], s.lignePath);
  };
  const libelleDe = (s: Selection): string => {
    const lot = dpgf.lots[s.lotIdx];
    if (!lot) return '';
    if (s.kind === 'lot') return `${lot.numero} — ${lot.titre}`;
    const chap = lot.chapitres[s.chapIdx];
    if (s.kind === 'chapitre') return `${chap?.numero ?? ''} — ${chap?.titre ?? ''}`;
    const l = ligneAtPath(chap?.lignes ?? [], s.lignePath);
    return `${l?.numero ?? ''} — ${l?.designation ?? ''}`;
  };
  const selectionsActives = parseSelection(clesActives);
  const resume = {
    lots: selectionsActives.filter(s => s.kind === 'lot').length,
    chapitres: selectionsActives.filter(s => s.kind === 'chapitre').length,
    articles: selectionsActives.filter(s => s.kind === 'ligne').length,
  };

  const copier = () => {
    const lignes = collectSelectedLignes<Ligne>(dpgf.lots, clesActives);
    if (!lignes.length) { notify?.(t('pro_copy_articles_only'), { type: 'error' }); return; }
    setPresse(lignes);
    notify?.(t('pro_cctp_copied', { count: lignes.length }), { type: 'success' });
  };
  const peutColler = presse.length > 0 && !!selection && selection.kind !== 'lot';
  const coller = () => {
    const r = pasteLignes(dpgf.lots, selection, presse, uid);
    if (!r) { notify?.(t('pro_cctp_paste_target'), { type: 'error' }); return; }
    onChange({ ...dpgf, lots: r.lots, ...totauxDe(r.lots) });
    const premier = r.pasted[0];
    if (premier && premier.kind !== 'lot') {
      setSelection(premier);
      const chapId = dpgf.lots[premier.lotIdx]?.chapitres[premier.chapIdx]?.id;
      if (chapId) setExpandedChaps(prev => new Set([...prev, chapId]));
    }
    notify?.(t('pro_cctp_pasted', { count: r.pasted.length }), { type: 'success' });
  };
  const dupliquer = () => {
    if (!multi) { if (selection) applyHierarchy(duplicateHierarchy(dpgf.lots, selection, uid)); return; }
    const r = dupliquerSelection(dpgf.lots, clesActives, uid);
    onChange({ ...dpgf, lots: r.lots, ...totauxDe(r.lots) });
    setSelection(null);
    notify?.(t('pro_cctp_duplicated', { count: r.copies }), { type: 'success' });
  };
  const appliquerMasse = (patch: PatchMasse) => {
    const r = modifierEnMasse(dpgf.lots, clesActives, patch);
    setShowBulk(false);
    if (!r.modifies) { notify?.(t('pro_cctp_bulk_none'), { type: 'error' }); return; }
    onChange({ ...dpgf, lots: r.lots });
    notify?.(t('pro_cctp_bulk_done', { count: r.modifies }), { type: 'success' });
  };
  const surClavierArbre = (e: React.KeyboardEvent) => {
    const cible = e.target as HTMLElement;
    if (cible.tagName === 'TEXTAREA' || cible.tagName === 'SELECT' || (cible instanceof HTMLInputElement && cible.type !== 'checkbox')) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const touche = e.key.toLowerCase();
    if (touche === 'c') { e.preventDefault(); copier(); }
    else if (touche === 'v' && peutColler) { e.preventDefault(); coller(); }
    else if (touche === 'd') { e.preventDefault(); dupliquer(); }
  };

  // ── Barre d'outils et barre de sélection ──────────────────────────────────
  const selectedLot = selection ? dpgf.lots[selection.lotIdx] : null;
  const canDeleteSelection = multi
    ? selectionsActives.every(s => s.kind !== 'lot' && !!noeudDe(s)?.cctpOnly)
    : !!selection && selection.kind !== 'lot' && isSelCctpOnly;
  const deleteSelected = () => {
    if (multi) {
      if (!canDeleteSelection) return;
      onChange({ ...dpgf, lots: deleteSelection(dpgf.lots, clesActives), ...totauxDe(deleteSelection(dpgf.lots, clesActives)) });
      setSelection(null);
      return;
    }
    if (!selection || selection.kind === 'lot') return;
    if (selection.kind === 'chapitre') deleteCCTPChapitre(selection.lotIdx, selection.chapIdx);
    else deleteCCTPLigne(selection.lotIdx, selection.chapIdx, selection.lignePath);
  };
  // ── Bâtiments du CCTP ──────────────────────────────────────────────────────
  const batimentsCctp = dpgf.multiBatiments ? batimentsParOrdre(dpgf.batiments) : [];
  const batimentEntries = (key: string): ToolbarMenuEntry[] => {
    // Les bâtiments se portent par les articles : sans article, cocher ne ferait rien.
    if (!aDesCiblesBatiments(dpgf.lots, [key])) {
      return [{ id: 'bat-no-article', label: t('pro_buildings_no_article'), disabled: true, onClick: () => {} }];
    }
    return batimentsCctp.map(b => {
    const etat = etatBatimentSelection(dpgf.lots, [key], b.id);
    return {
      id: `bat-${b.id}`, label: b.libelle ? `${b.code} · ${b.libelle}` : b.code, keepOpen: true,
      checked: etat === 'tous' ? true : etat === 'certains' ? 'mixed' as const : false,
      onClick: () => {
        const lots = basculerBatimentEnMasse(dpgf.lots, [key], b.id, etat !== 'tous');
        const totalHT = lots.reduce((s, l) => s + l.sousTotal, 0);
        onChange({ ...dpgf, lots, totalHT, totalTTC: totalHT * (1 + dpgf.TVA / 100) });
      },
    };
    });
  };
  // ── Textes automatiques ────────────────────────────────────────────────────
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const insererVariable = (cle: string) => {
    const el = descriptionRef.current;
    const actuel = selData?.description ?? '';
    const debut = el?.selectionStart ?? actuel.length;
    const fin = el?.selectionEnd ?? actuel.length;
    updateDescription(actuel.slice(0, debut) + jeton(cle) + actuel.slice(fin));
    const pos = debut + jeton(cle).length;
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos); });
  };
  // ── Mise en forme (gras, italique, souligné, couleur) ──────────────────────
  // La sélection du champ est lue au moment du clic, puis rétablie après la
  // mise à jour du texte : sans cela le curseur sauterait en fin de champ.
  const editerSelection = (fn: (texte: string, debut: number, fin: number) => EditionTexte) => {
    const el = descriptionRef.current;
    if (!el) return;
    const r = fn(selData?.description ?? '', el.selectionStart, el.selectionEnd);
    updateDescription(r.texte);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.debut, r.fin); });
  };
  const formaterBalise = (code: BaliseRiche) => editerSelection((t0, d, f) => basculerBalise(t0, d, f, code));
  const formaterCouleur = (hex: string | null) => editerSelection((t0, d, f) => appliquerCouleur(t0, d, f, hex));
  const raccourciFormat = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const code = ({ b: 'b', i: 'i', u: 'u' } as const)[e.key.toLowerCase() as 'b' | 'i' | 'u'];
    if (!code) return;
    e.preventDefault();
    formaterBalise(code);
  };
  const GROUPES_VARIABLES = [
    ['operation', 'pro_cctp_variables_operation'],
    ['arbre', 'pro_cctp_variables_tree'],
    ['divers', 'pro_cctp_variables_other'],
  ] as const;
  const variableEntries = (): ToolbarMenuEntry[] => GROUPES_VARIABLES.flatMap(([groupe, cleTitre]) => [
    { id: `var-h-${groupe}`, heading: t(cleTitre) } as ToolbarMenuEntry,
    ...VARIABLES_CCTP.filter(v => v.groupe === groupe).map(v => ({
      id: `var-${v.cle}`, label: v.libelle, shortcut: jeton(v.cle), onClick: () => insererVariable(v.cle),
    })),
  ]);
  const resumeBatiments = (key: string) => {
    const etats = batimentsCctp.map(b => [b.code, etatBatimentSelection(dpgf.lots, [key], b.id)] as const);
    const codes = etats.filter(([, e]) => e === 'tous').map(([c]) => c);
    const partiel = etats.some(([, e]) => e === 'certains');
    return codes.length || partiel ? `${codes.join(', ')}${partiel ? (codes.length ? ', …' : '…') : ''}` : t('pro_buildings_none');
  };

  useProToolbar([
    {
      kind: 'menu', id: 'cctp-add', label: t('pro_add'), icon: <IconPlus size={16} />, accent: true, mobile: true,
      entries: [
        { id: 'cctp-add-chap', label: t('pro_add_chapter'), icon: <IconStackPush size={16} />, onClick: () => selection && addCCTPChapitre(selection.lotIdx), disabled: !selectedLot, hint: selectedLot ? undefined : t('pro_cctp_select_lot_first') },
        { id: 'cctp-add-art', label: t('pro_add_article'), icon: <IconRowInsertBottom size={16} />, onClick: () => chapitreVise && addCCTPLigne(chapitreVise.lotIdx, chapitreVise.chapIdx), disabled: !chapitreVise, hint: chapitreVise ? undefined : t('pro_cctp_select_chapter_first') },
        { id: 'cctp-add-sub', label: t('pro_add_sub_article'), icon: <IconSubtask size={16} />, onClick: addSelectedChild, disabled: selection?.kind !== 'ligne' || 1 + selection.lignePath.length >= MAX_ARTICLE_DEPTH, hint: t('pro_add_sub_article_hint') },
      ],
    },
    { kind: 'button', id: 'cctp-generate', label: t('pro_cctp_generate'), icon: <IconSparkles size={16} />, hint: t('pro_cctp_generate_hint'), onClick: () => setShowGenerate(true) },
    { kind: 'button', id: 'cctp-library', label: t('pro_library'), icon: <IconBuildingStore size={16} />, pressed: showLibrary, onClick: () => setShowLibrary(v => !v) },
    { kind: 'button', id: 'cctp-decoupage', label: t('pro_buildings_phases'), icon: <IconBuildingCommunity size={16} />, pressed: showDecoupage, badge: !!(dpgf.multiBatiments || dpgf.multiPhases), onClick: () => setShowDecoupage(v => !v) },
  ]);
  const selectionActions: SelectionAction[] = [
    { id: 'up', label: t('pro_move_up'), icon: <IconArrowUp size={16} />, mobile: true, onClick: () => moveSelected(-1), disabled: multi || !canMove(dpgf.lots, selection, -1) },
    { id: 'down', label: t('pro_move_down'), icon: <IconArrowDown size={16} />, mobile: true, onClick: () => moveSelected(1), disabled: multi || !canMove(dpgf.lots, selection, 1) },
    { id: 'promote', label: t('pro_promote'), icon: <IconArrowBarToLeft size={16} />, iconOnly: true, onClick: promoteSelected, disabled: multi || selection?.kind !== 'ligne' },
    { id: 'demote', label: t('pro_demote'), icon: <IconArrowBarToRight size={16} />, iconOnly: true, onClick: () => selection && applyHierarchy(demoteHierarchy(dpgf.lots, selection, uid)), disabled: multi || !canDemote(dpgf.lots, selection) },
    { id: 'bulk', label: t('pro_cctp_bulk_title'), icon: <IconAdjustmentsHorizontal size={16} />, mobile: true, groupStart: true, onClick: () => setShowBulk(true), disabled: !multi, hint: multi ? undefined : t('pro_cctp_bulk_hint_select') },
    { id: 'copy', label: t('pro_copy'), icon: <IconCopy size={16} />, shortcut: 'Ctrl+C', onClick: copier, disabled: !selection, hint: t('pro_copy_articles_only') },
    { id: 'paste', label: t('pro_paste'), icon: <IconClipboard size={16} />, iconOnly: true, shortcut: 'Ctrl+V', onClick: coller, disabled: !peutColler },
    { id: 'export-library', label: t('pro_cctp_export_library'), icon: <IconDatabaseExport size={16} />, onClick: () => setShowExportLibrary(true), disabled: !selection || multi },
    { id: 'duplicate', label: t('pro_duplicate'), icon: <IconCopyPlus size={16} />, shortcut: 'Ctrl+D', mobile: true, onClick: dupliquer, disabled: !selection },
    { id: 'delete', label: t('pro_delete'), icon: <IconTrash size={16} />, danger: true, mobile: true, groupStart: true, onClick: deleteSelected, disabled: !canDeleteSelection, hint: canDeleteSelection ? undefined : t('pro_cctp_delete_hint') },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-zinc-900">

      {showGenerate && (
        <CctpGenerateDialog
          projectId={dpgf.projectId}
          onClose={() => setShowGenerate(false)}
          onGenerated={insererGeneration}
        />
      )}

      {showBulk && multi && (
        <CctpBulkEditDialog doc={dpgf} resume={resume} onClose={() => setShowBulk(false)} onApply={appliquerMasse} />
      )}

      {showDraft && selection && selData && (
        <CctpDraftPosteDialog
          projectId={dpgf.projectId}
          poste={posteARediger(selection, selData)}
          onClose={() => setShowDraft(false)}
          onApply={appliquerRedaction}
        />
      )}

      {showExportLibrary && selection && selData && (
        <CctpExportLibraryDialog
          peutEtreOuvrage={selection.kind === 'ligne'}
          initial={exportInitial(selection, selData)}
          onClose={() => setShowExportLibrary(false)}
          onDone={(article, type) => {
            setShowExportLibrary(false);
            // L'ouvrage exporté est lié à son article : les prix d'offres
            // pourront remonter vers lui, comme pour un article inséré.
            if (type === 'ouvrage' && selection.kind === 'ligne') {
              mutateDPGF(d => {
                const l = ligneAtPath(d.lots[selection.lotIdx].chapitres[selection.chapIdx].lignes, selection.lignePath);
                if (l && !l.articleTypeId) l.articleTypeId = article.id;
              });
            }
            notify?.(t(type === 'clause' ? 'pro_cctp_export_library_done_clause' : 'pro_cctp_export_library_done_ouvrage', { nom: article.designation }), { type: 'success' });
          }}
        />
      )}

      {showDecoupage && (
        <DecoupagePanel
          doc={dpgf}
          onPatch={patch => mutateDPGF(d => Object.assign(d, patch))}
          onClose={() => setShowDecoupage(false)}
        />
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left tree panel ────────────────────────────────────────────── */}
        {showTree && (
          <div
            ref={arbreRef}
            tabIndex={0}
            onKeyDown={surClavierArbre}
            aria-label={t('pro_structure')}
            className="w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-700 overflow-y-auto bg-[#f5f7fa] dark:bg-zinc-800/50 text-sm select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--tblr-primary)]">
            <div className="flex items-center gap-0.5 pl-3 pr-1 py-1.5 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
              <span className="flex-1 text-xs font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('pro_structure')}</span>
              {[
                { label: t('pro_expand_all'), icon: <IconArrowsMaximize size={14} />, onClick: () => { setExpandedLots(new Set(dpgf.lots.map(l => l.id))); setExpandedChaps(new Set(dpgf.lots.flatMap(l => l.chapitres.map(c => c.id)))); } },
                { label: t('pro_collapse_all'), icon: <IconArrowsMinimize size={14} />, onClick: () => { setExpandedLots(new Set()); setExpandedChaps(new Set()); } },
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
                {/* Lot row */}
                <div
                  data-search-id={lot.id}
                  onClick={e => cliquer({ kind: 'lot', lotIdx: li }, e)}
                  className={`group flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-blue-50 dark:hover:bg-zinc-700 transition-colors ${
                    estSel(`lot-${li}`)
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                      : 'text-zinc-700 dark:text-zinc-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={t('pro_cctp_select_row', { nom: lot.titre })}
                    checked={estSel(`lot-${li}`)}
                    onClick={e => e.stopPropagation()}
                    onChange={() => basculer({ kind: 'lot', lotIdx: li })}
                    className={`shrink-0 w-3.5 h-3.5 accent-blue-600 cursor-pointer ${multi || estSel(`lot-${li}`) ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100'}`}
                  />
                  <button
                    className="shrink-0 text-zinc-500"
                    onClick={e => { e.stopPropagation(); toggleLot(lot.id); }}
                  >
                    {expandedLots.has(lot.id) ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  </button>
                  <span className="font-bold text-zinc-500 text-xs mr-1">{lot.numero}</span>
                  <span className="truncate text-xs font-semibold flex-1">{lot.titre || 'Lot sans titre'}</span>
                </div>

                {expandedLots.has(lot.id) && (
                  <>
                    {lot.chapitres.map((chap, ci) => (
                      <div key={chap.id}>
                        {/* Chapitre row */}
                        <div
                          data-search-id={chap.id}
                          onClick={e => cliquer({ kind: 'chapitre', lotIdx: li, chapIdx: ci }, e)}
                          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                          onDrop={e => { e.preventDefault(); if (!dragSource) { const raw = e.dataTransfer.getData('application/json'); if (raw && onDropExternal) { try { onDropExternal(JSON.parse(raw) as Ligne); } catch {} } return; } const next = JSON.parse(JSON.stringify(dpgf)) as DPGF; const source = next.lots[dragSource.lotIdx].chapitres[dragSource.chapIdx]; const dest = next.lots[li].chapitres[ci]; const taken = takeLigneAtPath(source.lignes, dragSource.path); if (taken.ligne) { source.lignes = taken.lignes; dest.lignes = renumeroterLignes([...dest.lignes, taken.ligne], String(dest.numero || ci + 1)); source.lignes = renumeroterLignes(source.lignes, String(source.numero || dragSource.chapIdx + 1)); onChange(next); } setDragSource(null); }}
                          className={`group flex items-center gap-1 pl-6 pr-2 py-1 cursor-pointer hover:bg-blue-50 dark:hover:bg-zinc-700 transition-colors ${
                            estSel(`chap-${li}-${ci}`)
                              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                              : 'text-zinc-600 dark:text-zinc-300'
                          } ${chap.cctpOnly ? 'italic' : ''}`}
                        >
                          <input
                    type="checkbox"
                    aria-label={t('pro_cctp_select_row', { nom: chap.titre })}
                    checked={estSel(`chap-${li}-${ci}`)}
                    onClick={e => e.stopPropagation()}
                    onChange={() => basculer({ kind: 'chapitre', lotIdx: li, chapIdx: ci })}
                    className={`shrink-0 w-3.5 h-3.5 accent-blue-600 cursor-pointer ${multi || estSel(`chap-${li}-${ci}`) ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100'}`}
                  />
                  <button
                            className="shrink-0 text-zinc-400"
                            onClick={e => { e.stopPropagation(); toggleChap(chap.id); }}
                          >
                            {expandedChaps.has(chap.id) ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                          </button>
                          <span className="font-medium text-zinc-400 text-xs mr-1">{chap.numero}</span>
                          <span className="truncate text-xs flex-1">{chap.titre || 'Sans titre'}</span>
                          {chap.cctpOnly && (
                            <span className="shrink-0 ml-1 text-[0.6875rem] px-1 py-0.5 bg-violet-100 dark:bg-violet-900/40 text-violet-600 rounded font-bold uppercase">
                              CCTP
                            </span>
                          )}
                          {chap.cctpOnly && (
                            <button
                              onClick={e => { e.stopPropagation(); deleteCCTPChapitre(li, ci); }}
                              className="shrink-0 ml-1 text-zinc-300 hover:text-red-500 transition-colors"
                              title="Supprimer"
                            >
                              <IconTrash size={11} />
                            </button>
                          )}
                        </div>

                        {expandedChaps.has(chap.id) && (
                          <>
                            {flattenCctpLignes(chap.lignes).map(({ ligne, path, depth }) => (
                              <div
                                key={ligne.id}
                                data-search-id={ligne.id}
                                draggable={!ligne.children?.length}
                                onDragStart={e => { const s = { lotIdx: li, chapIdx: ci, path }; setDragSource(s); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-archioffice-row', JSON.stringify(s)); e.dataTransfer.setData('application/json', JSON.stringify(ligne)); }}
                                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                                onDrop={e => { e.preventDefault(); if (!dragSource) { const raw = e.dataTransfer.getData('application/json'); if (raw && onDropExternal) { try { onDropExternal(JSON.parse(raw) as Ligne); } catch {} } return; } const next = JSON.parse(JSON.stringify(dpgf)) as DPGF; const source = next.lots[dragSource.lotIdx].chapitres[dragSource.chapIdx]; const dest = next.lots[li].chapitres[ci]; const taken = takeLigneAtPath(source.lignes, dragSource.path); if (taken.ligne) { source.lignes = taken.lignes; dest.lignes = insertLigneAtPath(dest.lignes, path.slice(0, -1), path[path.length - 1], taken.ligne); source.lignes = renumeroterLignes(source.lignes, String(source.numero || dragSource.chapIdx + 1)); if (source !== dest) dest.lignes = renumeroterLignes(dest.lignes, String(dest.numero || ci + 1)); onChange(next); } setDragSource(null); }}
                                onClick={e => cliquer({ kind: 'ligne', lotIdx: li, chapIdx: ci, lignePath: path }, e)}
                                style={{ paddingLeft: `${3 + depth * 1.1}rem` }}
                                className={`group flex items-center gap-1 pr-2 py-0.5 cursor-pointer hover:bg-blue-50 dark:hover:bg-zinc-700 transition-colors ${
                                  estSel(`ligne-${li}-${ci}-${path.join('-')}`)
                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                    : 'text-zinc-500 dark:text-zinc-400'
                                } ${ligne.cctpOnly ? 'italic' : ''}`}
                              >
                                <input
                    type="checkbox"
                    aria-label={t('pro_cctp_select_row', { nom: ligne.designation })}
                    checked={estSel(`ligne-${li}-${ci}-${path.join('-')}`)}
                    onClick={e => e.stopPropagation()}
                    onChange={() => basculer({ kind: 'ligne', lotIdx: li, chapIdx: ci, lignePath: path })}
                    className={`shrink-0 w-3.5 h-3.5 accent-blue-600 cursor-pointer ${multi || estSel(`ligne-${li}-${ci}-${path.join('-')}`) ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100'}`}
                  />
                  <span className="font-medium text-zinc-400 text-[0.6875rem] mr-1 shrink-0">{ligne.numero}</span>
                                <span className="truncate text-[0.6875rem] flex-1">{ligne.designation}</span>
                                {/* Repère de provenance : article issu de la
                                    bibliothèque d'ouvrages du cabinet. */}
                                {ligne.articleTypeId && (
                                  <span
                                    title="Article issu de la bibliothèque d’ouvrages"
                                    className="shrink-0 ml-1 text-[0.6875rem] px-1 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded font-bold"
                                  >
                                    BIB
                                  </span>
                                )}
                                {/* Repère de provenance : article proposé par
                                    « Générer », à relire avant de l'assumer. */}
                                {ligne.genereParIa && (
                                  <span
                                    title={ligne.genereParIa === 'nomic' ? 'Article proposé par Nomic, à relire' : 'Article proposé par l’IA, à relire'}
                                    className="shrink-0 ml-1 text-[0.6875rem] px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 rounded font-bold"
                                  >
                                    IA
                                  </span>
                                )}
                                {ligne.cctpOnly && (
                                  <span className="shrink-0 ml-1 text-[0.6875rem] px-1 py-0.5 bg-violet-100 dark:bg-violet-900/40 text-violet-600 rounded font-bold uppercase">
                                    CCTP
                                  </span>
                                )}
                                {ligne.cctpOnly && (
                                  <button
                                    onClick={e => { e.stopPropagation(); deleteCCTPLigne(li, ci, path); }}
                                    className="shrink-0 ml-1 text-zinc-300 hover:text-red-500 transition-colors"
                                    title="Supprimer"
                                  >
                                    <IconTrash size={10} />
                                  </button>
                                )}
                              </div>
                            ))}

                            {/* Add a new article under this chapter (visible in DPGF by default) */}
                            <button
                              onClick={() => addCCTPLigne(li, ci)}
                              className="w-full flex items-center gap-1 pl-12 pr-2 py-0.5 text-[0.6875rem] text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                            >
                              <IconPlus size={10} />
                              <span>Nouvel article</span>
                            </button>
                          </>
                        )}
                      </div>
                    ))}

                    {/* Add a new chapter under this lot (visible in DPGF by default) */}
                    <button
                      onClick={() => addCCTPChapitre(li)}
                      className="w-full flex items-center gap-1 pl-6 pr-2 py-1 text-[0.6875rem] text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                    >
                      <IconPlus size={10} />
                      <span>Nouveau chapitre</span>
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Right content panel ─────────────────────────────────────────── */}
        <div className="relative flex-1 min-w-0 flex flex-col">
        {selection && selData && (
          <SelectionBar
            label={multi ? t('pro_cctp_n_selected', { count: clesActives.length }) : `${selData.label} ${selData.name.split(' — ')[0]}`}
            actions={selectionActions}
            onClear={() => { setSelection(null); setMultiKeys(new Set()); }}
            isMobile={isMobile}
          />
        )}
        <div className={`flex-1 overflow-y-auto ${selection ? 'pb-20' : ''}`}>
          {!selection || !selData ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-400 dark:text-zinc-500">
              <span className="text-5xl">📋</span>
              <p className="text-sm font-medium">Sélectionnez un élément dans l'arbre</p>
              <p className="text-xs">Lot, chapitre ou article pour saisir sa description CCTP</p>
            </div>
          ) : multi ? (
            <div className="max-w-3xl mx-auto p-6 space-y-5">
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('pro_cctp_n_selected', { count: clesActives.length })}</h3>
                <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_multi_composition', resume)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary inline-flex items-center gap-2" onClick={() => setShowBulk(true)}>
                  <IconAdjustmentsHorizontal size={16} aria-hidden />{t('pro_cctp_bulk_title')}
                </button>
                <button type="button" className="btn inline-flex items-center gap-2" onClick={copier}><IconCopy size={16} aria-hidden />{t('pro_copy')}</button>
                <button type="button" className="btn inline-flex items-center gap-2" onClick={dupliquer}><IconCopyPlus size={16} aria-hidden />{t('pro_duplicate')}</button>
                <button type="button" className="btn" onClick={() => { setSelection(null); setMultiKeys(new Set()); }}>{t('pro_cctp_deselect')}</button>
              </div>
              <ul className="rounded-lg border divide-y text-sm" style={{ borderColor: 'var(--tblr-border)' }}>
                {selectionsActives.slice(0, 20).map(s => (
                  <li key={hierarchyKey(s)} className="px-3 py-1.5 truncate" style={{ color: 'var(--tblr-text)', borderColor: 'var(--tblr-border)' }}>{libelleDe(s)}</li>
                ))}
                {selectionsActives.length > 20 && (
                  <li className="px-3 py-1.5 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_multi_more', { count: selectionsActives.length - 20 })}</li>
                )}
              </ul>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto p-6 space-y-6">

              {/* Item header */}
              <div className="border-b border-zinc-200 dark:border-zinc-700 pb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[0.6875rem] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
                    {selData.label}
                  </span>
                  {isSelCctpOnly && (
                    <span className="flex items-center gap-1 text-[0.6875rem] px-2 py-0.5 bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 rounded-full font-bold uppercase">
                      <IconTag size={9} />
                      CCTP uniquement
                    </span>
                  )}

                  {/* DPGF visibility toggle — not applicable to lots */}
                  {selection && selection.kind !== 'lot' && (
                    <label className="ml-auto flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!isSelCctpOnly}
                        onChange={toggleDpgfVisibility}
                        className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        Visible dans le DPGF
                      </span>
                    </label>
                  )}
                </div>

                {selection && selection.kind === 'lot' ? (
                  <LotTitleInput value={dpgf.lots[selection.lotIdx].titre} onCommit={titre => mutateDPGF(d => { d.lots[selection.lotIdx].titre = titre; })} />
                ) : selection ? (
                  <input
                    type="text"
                    value={
                      selection.kind === 'chapitre'
                        ? dpgf.lots[selection.lotIdx]?.chapitres[selection.chapIdx]?.titre ?? ''
                        : ligneAtPath(dpgf.lots[selection.lotIdx]?.chapitres[selection.chapIdx]?.lignes ?? [], selection.lignePath)?.designation ?? ''
                    }
                    onChange={e => updateName(e.target.value)}
                    className="text-xl font-bold w-full bg-transparent border-b-2 border-zinc-200 dark:border-zinc-600 focus:border-blue-500 outline-none pb-1 text-zinc-900 dark:text-white transition-colors"
                    placeholder="Titre…"
                  />
                ) : null}

                {/* DPGF article info badge */}
                {selection.kind === 'ligne' && !isSelCctpOnly && (() => {
                  const l = ligneAtPath(dpgf.lots[selection.lotIdx]?.chapitres[selection.chapIdx]?.lignes ?? [], selection.lignePath);
                  if (!l) return null;
                  return (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {l.unite && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs text-zinc-500">
                          Unité : <strong>{l.unite}</strong>
                        </span>
                      )}
                      {l.quantite > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs text-zinc-500">
                          Qté : <strong>{l.quantite}</strong>
                        </span>
                      )}
                      {l.prixUnitaire > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs text-zinc-500">
                          P.U. HT : <strong>{l.prixUnitaire.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</strong>
                        </span>
                      )}
                    </div>
                  );
                })()}
                {/* Bâtiment / phase / localisation */}
                {(dpgf.multiBatiments || dpgf.multiPhases || selection.kind === 'ligne') && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {dpgf.multiBatiments && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('pro_buildings')} :</span>
                        <ToolbarMenu
                          entries={() => batimentEntries(hierarchyKey(selection))}
                          onSelect={entry => entry.onClick()}
                          ariaLabel={t('pro_buildings_of', { numero: selData.name })}
                          triggerClassName="inline-flex items-center gap-1 h-7 px-2 rounded border text-xs outline-none hover:bg-[var(--tblr-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]"
                          triggerStyle={{ borderColor: 'var(--tblr-border)' }}
                          trigger={<>{resumeBatiments(hierarchyKey(selection))}<IconChevronDownSmall size={12} aria-hidden /></>}
                        />
                      </div>
                    )}
                    {dpgf.multiPhases && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400">{t('pro_col_phase')} :</span>
                        <SelecteursDecoupage
                          doc={{ ...dpgf, multiBatiments: false }}
                          batimentId={selData.batimentId}
                          phaseId={selData.phaseId}
                          onBatimentChange={v => updateBatimentPhase('batimentId', v)}
                          onPhaseChange={v => updateBatimentPhase('phaseId', v)}
                        />
                      </div>
                    )}
                    {selection.kind === 'ligne' && selData.ligne && (
                      <div className="flex items-center gap-1.5">
                        <label className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400" htmlFor="cctp-localisation">
                          Localisation (pièce, ouvrage) :
                        </label>
                        <input
                          id="cctp-localisation"
                          type="text"
                          value={selData.ligne.localisation || ''}
                          onChange={e => updateLocalisation(e.target.value)}
                          list="cctp-localisations"
                          autoComplete="off"
                          placeholder="Ex : SdB étage, façade nord…"
                          className="px-2 py-1 text-xs border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <datalist id="cctp-localisations">
                          {localisations.map(loc => <option key={loc} value={loc} />)}
                        </datalist>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Description CCTP */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="cctp-description" className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
                    Description technique
                  </label>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button
                      type="button" onClick={() => setShowDraft(true)}
                      className="inline-flex items-center gap-1 h-7 px-2 rounded border text-xs outline-none hover:bg-[var(--tblr-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)] pointer-coarse:h-11"
                      style={{ borderColor: 'var(--tblr-border)' }}
                    >
                      <IconSparkles size={14} aria-hidden />{t('pro_cctp_draft_title')}
                    </button>
                    <CctpRichToolbar onBalise={formaterBalise} onCouleur={formaterCouleur} />
                    <ToolbarMenu
                      entries={variableEntries}
                      onSelect={entry => entry.onClick()}
                      ariaLabel={t('pro_cctp_variables')}
                      triggerClassName="inline-flex items-center gap-1 h-7 px-2 rounded border text-xs outline-none hover:bg-[var(--tblr-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]"
                      triggerStyle={{ borderColor: 'var(--tblr-border)' }}
                      align="end"
                      trigger={<><IconVariable size={14} aria-hidden />{t('pro_cctp_variables')}<IconChevronDownSmall size={12} aria-hidden /></>}
                    />
                  </div>
                </div>
                <textarea
                  id="cctp-description"
                  ref={descriptionRef}
                  value={selData.description}
                  onChange={e => updateDescription(e.target.value)}
                  onKeyDown={raccourciFormat}
                  rows={16}
                  placeholder={`Rédigez ici la description technique de ce ${selData.label.toLowerCase()}…\n\nEx : matériaux, mise en œuvre, prescriptions, normes applicables (NF EN…), conditions d'exécution, essais, réception…`}
                  className="w-full px-4 py-3 text-sm border border-zinc-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y leading-relaxed font-sans"
                />
                {contientMiseEnForme(selData.description) && (
                  <div className="rounded-xl border p-3 space-y-1" style={{ borderColor: 'var(--tblr-border)' }}>
                    <span className="block text-[0.6875rem] font-bold uppercase tracking-widest" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_format_preview')}</span>
                    <CctpRichPreview texte={selData.description} />
                  </div>
                )}
                <p className="text-[0.6875rem] text-zinc-400">
                  Ce texte apparaît uniquement dans le document CCTP, pas dans le DPGF. Les variables {'{{…}}'} sont remplacées à l'export.
                </p>
              </div>

              {/* Illustrations de l'article */}
              {selection.kind === 'ligne' && selData.ligne && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
                      Illustrations
                    </span>
                    <label className={`inline-flex items-center gap-1.5 h-8 px-3 rounded border text-xs cursor-pointer hover:bg-[var(--tblr-surface-2)] ${envoiImages ? 'opacity-60 pointer-events-none' : ''}`} style={{ borderColor: 'var(--tblr-border)' }}>
                      <IconPhotoPlus size={14} aria-hidden />
                      {envoiImages ? 'Envoi…' : 'Ajouter des images'}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="sr-only"
                        onChange={e => { void ajouterImages(e.target.files); e.target.value = ''; }}
                      />
                    </label>
                  </div>
                  {erreurImages && <p className="text-xs text-red-600" role="alert">{erreurImages}</p>}
                  {(selData.ligne.images ?? []).length > 0 ? (
                    <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {(selData.ligne.images ?? []).map(img => (
                        <li key={img.id} className="relative rounded border p-1.5 space-y-1.5" style={{ borderColor: 'var(--tblr-border)' }}>
                          <SignedImage src={img.fileUrl} alt={img.legende || 'Illustration'} className="w-full h-28 object-cover rounded" />
                          <input
                            type="text"
                            value={img.legende}
                            onChange={e => mutateImages(l => { l.images = legendeImage(l.images, img.id, e.target.value); })}
                            placeholder="Légende"
                            aria-label="Légende de l'illustration"
                            className="w-full px-1.5 py-1 text-xs border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          <button
                            type="button"
                            onClick={() => mutateImages(l => { l.images = retirerImage(l.images, img.id); })}
                            aria-label="Retirer l'illustration"
                            className="absolute top-2.5 right-2.5 w-6 h-6 inline-flex items-center justify-center rounded-full bg-black/60 text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]"
                          >
                            <IconX size={12} aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[0.6875rem] text-zinc-400">
                      Photos de l'existant, détails ou plans : elles sont imprimées sous le texte de l'article, avec leur légende.
                    </p>
                  )}
                  <p className="text-[0.6875rem] text-zinc-400">
                    Les fichiers sont aussi rangés dans les documents de l'affaire (catégorie « CCTP - illustrations »).
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        </div>

        {/* ── Bibliothèque d'ouvrages du cabinet ────────────────────────────── */}
        {showLibrary && (
          <PriceLibraryPanel
            onClose={() => setShowLibrary(false)}
            onInsert={insererDepuisBibliotheque}
            canInsert={!!selection}
            avecClauses
            hintCible="Sélectionnez d’abord un élément dans l’arbre"
          />
        )}
      </div>
    </div>
  );
};
