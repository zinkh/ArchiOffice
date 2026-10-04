import type { Lot, Ligne } from '../../types/dpgf';
import { MAX_ARTICLE_DEPTH, type ParsedRowKey, moveLigneSibling, renumeroterLignes, takeLigneAtPath, insertLigneAtPath, mutateLigneAtPath, recomputeLot } from './treeOps';

export type HierarchySelection = NonNullable<ParsedRowKey>;
export function ligneAtPath(lignes: Ligne[], path: number[]): Ligne | undefined {
  let node: Ligne | undefined;
  for (const index of path) { node = lignes[index]; if (!node) return; lignes = node.children || []; }
  return node;
}
export function hierarchyKey(s: HierarchySelection): string {
  return s.kind === 'lot' ? `lot-${s.lotIdx}` : s.kind === 'chapitre' ? `chap-${s.lotIdx}-${s.chapIdx}` : `ligne-${s.lotIdx}-${s.chapIdx}-${s.lignePath.join('-')}`;
}
export function canMove(lots: Lot[], s: ParsedRowKey, direction: -1 | 1): boolean {
  if (!s || s.kind === 'lot') return false;
  const chapters = lots[s.lotIdx]?.chapitres;
  if (!chapters) return false;
  if (s.kind === 'chapitre') return !!chapters[s.chapIdx] && !!chapters[s.chapIdx + direction];
  const lines = chapters[s.chapIdx]?.lignes;
  if (!lines || !s.lignePath.length) return false;
  const siblings = s.lignePath.length === 1 ? lines : ligneAtPath(lines, s.lignePath.slice(0, -1))?.children;
  const index = s.lignePath.at(-1)!;
  return !!siblings?.[index] && !!siblings[index + direction];
}
function renumber<L extends Lot>(lot: L): L {
  return recomputeLot({ ...lot, chapitres: lot.chapitres.map((chapter, i) => {
    const numero = `${lot.numero}.${i + 1}`;
    return { ...chapter, numero, lignes: renumeroterLignes(chapter.lignes, numero) };
  }) });
}

function subtreeHeight(line: Ligne): number {
  return line.children?.length ? 1 + Math.max(...line.children.map(subtreeHeight)) : 0;
}

type Assignments = { batimentId?: string; phaseId?: string; trancheId?: string; cctpOnly?: boolean };
// Les exports consultent aussi directement les feuilles : figer l'héritage sur
// tout le sous-arbre avant de changer de chapitre ou de parent.
function preserveAssignments(line: Ligne & Assignments, inherited: Assignments): Ligne {
  const moved = {
    ...line,
    batimentId: line.batimentId ?? inherited.batimentId ?? '',
    phaseId: line.phaseId ?? inherited.phaseId ?? '',
    trancheId: line.trancheId ?? inherited.trancheId ?? '',
    cctpOnly: line.cctpOnly || inherited.cctpOnly,
  };
  return { ...moved, children: line.children?.map(child => preserveAssignments(child, moved)) };
}

/** Le premier élément n'a pas de frère précédent sous lequel se placer. */
export function canDemote(lots: Lot[], s: ParsedRowKey): boolean {
  if (!s || s.kind === 'lot') return false;
  const chapter = lots[s.lotIdx]?.chapitres[s.chapIdx];
  if (!chapter) return false;
  if (s.kind === 'chapitre') {
    const previous = lots[s.lotIdx].chapitres[s.chapIdx - 1];
    return !!previous && (!previous.cctpOnly || !!chapter.cctpOnly)
      && chapter.lignes.every(line => 3 + subtreeHeight(line) <= MAX_ARTICLE_DEPTH);
  }
  const siblings = s.lignePath.length === 1 ? chapter.lignes
    : ligneAtPath(chapter.lignes, s.lignePath.slice(0, -1))?.children;
  const index = s.lignePath.at(-1)!;
  const line = siblings?.[index];
  const previous = siblings?.[index - 1];
  return !!line && !!previous && (!previous.cctpOnly || !!line.cctpOnly)
    && 2 + s.lignePath.length + subtreeHeight(line) <= MAX_ARTICLE_DEPTH;
}

/** Descend le sous-arbre complet sous son frère précédent, sans perdre les prix.
 * Une feuille chiffrable d'accueil devient un groupe avec sa ligne de prix intacte.
 */
export function demoteHierarchy<L extends Lot>(lots: L[], s: HierarchySelection, newId: () => string): { lots: L[]; selection: HierarchySelection } {
  if (!canDemote(lots, s) || s.kind === 'lot') return { lots, selection: s };
  const lot = lots[s.lotIdx];
  const chapters = [...lot.chapitres];
  const chapter = chapters[s.chapIdx];
  let selection: HierarchySelection;
  if (s.kind === 'chapitre') {
    const previous = chapters[s.chapIdx - 1];
    const { lignes, titre, ...metadata } = chapter;
    const line: Ligne = {
      ...metadata, designation: titre, type: 'titre', unite: '',
      quantite: 0, prixUnitaire: 0, prixTotal: 0, children: lignes,
      batimentId: chapter.batimentId ?? lot.batimentId ?? '',
      phaseId: chapter.phaseId ?? lot.phaseId ?? '',
    };
    // Les champs propres au BPU restent portés par le nœud déplacé.
    if ('trancheId' in chapter || 'trancheId' in previous || 'trancheId' in lot) {
      (line as Ligne & { trancheId?: string }).trancheId = (chapter as any).trancheId ?? (lot as any).trancheId ?? '';
    }
    const moved = preserveAssignments(line, { ...lot, ...chapter });
    chapters[s.chapIdx - 1] = { ...previous, lignes: [...previous.lignes, moved] };
    chapters.splice(s.chapIdx, 1);
    selection = { kind: 'ligne', lotIdx: s.lotIdx, chapIdx: s.chapIdx - 1, lignePath: [previous.lignes.length] };
  } else {
    const parentPath = s.lignePath.slice(0, -1);
    const siblings = parentPath.length ? ligneAtPath(chapter.lignes, parentPath)!.children! : chapter.lignes;
    const index = s.lignePath.at(-1)!;
    const previous = siblings[index - 1];
    const line = siblings[index];
    let batimentId = chapter.batimentId ?? lot.batimentId;
    let phaseId = chapter.phaseId ?? lot.phaseId;
    let trancheId = (chapter as any).trancheId ?? (lot as any).trancheId;
    for (let depth = 1; depth <= parentPath.length; depth++) {
      const parent = ligneAtPath(chapter.lignes, parentPath.slice(0, depth))!;
      batimentId = parent.batimentId ?? batimentId;
      phaseId = parent.phaseId ?? phaseId;
      trancheId = (parent as any).trancheId ?? trancheId;
    }
    const moved = { ...line, batimentId: line.batimentId ?? batimentId ?? '', phaseId: line.phaseId ?? phaseId ?? '' };
    if ('trancheId' in line || 'trancheId' in previous || trancheId !== undefined) {
      (moved as Ligne & { trancheId?: string }).trancheId = (line as any).trancheId ?? trancheId ?? '';
    }
    const keepPrice = !previous.children?.length && (previous.type === 'ouvrage' || previous.prixTotal !== 0 || previous.prixUnitaire !== 0 || previous.quantite !== 0);
    const children = keepPrice ? [previous] : previous.children || [];
    const group: Ligne = keepPrice
      ? { id: newId(), numero: previous.numero, designation: previous.designation, type: 'titre', unite: '', quantite: 0, prixUnitaire: 0, prixTotal: 0, cctpOnly: previous.cctpOnly }
      : { ...previous };
    group.children = [...children, preserveAssignments(moved, { batimentId, phaseId, trancheId, cctpOnly: chapter.cctpOnly })];
    const previousPath = [...parentPath, index - 1];
    const lines = takeLigneAtPath(chapter.lignes, s.lignePath).lignes;
    chapters[s.chapIdx] = { ...chapter, lignes: mutateLigneAtPath(lines, previousPath, () => group) };
    selection = { ...s, lignePath: [...previousPath, children.length] };
  }
  return { lots: lots.map((l, i) => i === s.lotIdx ? renumber({ ...lot, chapitres: chapters }) : l), selection };
}
export function moveHierarchy<L extends Lot>(lots: L[], s: HierarchySelection, direction: -1 | 1): { lots: L[]; selection: HierarchySelection } {
  if (!canMove(lots, s, direction) || s.kind === 'lot') return { lots, selection: s };
  const lot = lots[s.lotIdx];
  const chapters = [...lot.chapitres];
  let selection: HierarchySelection;
  if (s.kind === 'chapitre') {
    [chapters[s.chapIdx], chapters[s.chapIdx + direction]] = [chapters[s.chapIdx + direction], chapters[s.chapIdx]];
    selection = { ...s, chapIdx: s.chapIdx + direction };
  } else {
    chapters[s.chapIdx] = { ...chapters[s.chapIdx], lignes: moveLigneSibling(chapters[s.chapIdx].lignes, s.lignePath, direction) };
    const path = [...s.lignePath]; path[path.length - 1] += direction;
    selection = { ...s, lignePath: path };
  }
  return { lots: lots.map((l, i) => i === s.lotIdx ? renumber({ ...lot, chapitres: chapters }) : l), selection };
}
/** Remonte un sous-article d'un niveau, ou transforme un article racine en chapitre.
 * Une feuille chiffrable reste sous le nouveau chapitre pour conserver son ID,
 * ses prix et les références des offres. Un groupe devient directement un chapitre.
 */
export function promoteHierarchy<L extends Lot>(lots: L[], s: HierarchySelection, newId: () => string): { lots: L[]; selection: HierarchySelection } {
  if (s.kind !== 'ligne') return { lots, selection: s };
  const lot = lots[s.lotIdx];
  const chapter = lot?.chapitres[s.chapIdx];
  const ligne = chapter && ligneAtPath(chapter.lignes, s.lignePath);
  if (!ligne) return { lots, selection: s };
  const chapters = [...lot.chapitres];
  let lines = takeLigneAtPath(chapter.lignes, s.lignePath).lignes;
  let selection: HierarchySelection;
  // Matérialiser les affectations héritées avant de quitter le parent.
  let inherited = { batimentId: chapter.batimentId, phaseId: chapter.phaseId, trancheId: (chapter as any).trancheId, cctpOnly: chapter.cctpOnly };
  for (let depth = 1; depth < s.lignePath.length; depth++) {
    const parent = ligneAtPath(chapter.lignes, s.lignePath.slice(0, depth))!;
    inherited = { batimentId: parent.batimentId ?? inherited.batimentId, phaseId: parent.phaseId ?? inherited.phaseId, trancheId: (parent as any).trancheId ?? inherited.trancheId, cctpOnly: parent.cctpOnly || inherited.cctpOnly };
  }
  const moved = { ...ligne, batimentId: ligne.batimentId ?? inherited.batimentId, phaseId: ligne.phaseId ?? inherited.phaseId, trancheId: (ligne as any).trancheId ?? inherited.trancheId, cctpOnly: ligne.cctpOnly || inherited.cctpOnly };
  if (s.lignePath.length > 1) {
    const parentPath = s.lignePath.slice(0, -1);
    // Un groupe vidé ne doit pas réactiver son ancien montant de feuille.
    lines = mutateLigneAtPath(lines, parentPath, parent => parent.children?.length ? parent : { ...parent, quantite: 0, prixTotal: 0 });
    const path = [...parentPath]; path[path.length - 1]++;
    lines = insertLigneAtPath(lines, path.slice(0, -1), path.at(-1)!, moved);
    selection = { ...s, lignePath: path };
  } else {
    const hasChildren = !!ligne.children?.length;
    chapters.splice(s.chapIdx + 1, 0, {
      ...moved, id: hasChildren ? ligne.id : newId(), titre: ligne.designation,
      lignes: hasChildren ? ligne.children! : [moved],
    });
    selection = { kind: 'chapitre', lotIdx: s.lotIdx, chapIdx: s.chapIdx + 1 };
  }
  chapters[s.chapIdx] = { ...chapter, lignes: lines };
  return { lots: lots.map((l, i) => i === s.lotIdx ? renumber({ ...lot, chapitres: chapters }) : l), selection };
}

/** Copie profonde : aucun identifiant ni référence d'offre ne doit être partagé. */
export function duplicateHierarchy<L extends Lot>(lots: L[], s: HierarchySelection, newId: () => string): { lots: L[]; selection: HierarchySelection } {
  function cloneNode<T extends { id: string }>(node: T): T {
    const copy = JSON.parse(JSON.stringify(node));
    const visit = (n: any) => {
      n.id = newId(); delete n.refBpu;
      for (const key of ['chapitres', 'lignes', 'children']) n[key]?.forEach(visit);
    };
    visit(copy); return copy;
  }
  const lot = lots[s.lotIdx];
  if (!lot) return { lots, selection: s };
  const next = [...lots];
  if (s.kind === 'lot') {
    const copy = cloneNode(lot);
    // Le rattachement au lot projet doit être choisi pour ce nouveau lot.
    delete copy.projectLotId; delete copy.lotCctpId;
    next.splice(s.lotIdx + 1, 0, copy);
    return { lots: next.map((l, i) => renumber({ ...l, numero: String(i + 1).padStart(l.numero.length, '0') })), selection: { ...s, lotIdx: s.lotIdx + 1 } };
  }
  const chapters = [...lot.chapitres];
  const chapter = chapters[s.chapIdx];
  if (!chapter) return { lots, selection: s };
  let selection: HierarchySelection;
  if (s.kind === 'chapitre') {
    chapters.splice(s.chapIdx + 1, 0, cloneNode(chapter));
    selection = { ...s, chapIdx: s.chapIdx + 1 };
  } else {
    const line = ligneAtPath(chapter.lignes, s.lignePath);
    if (!line) return { lots, selection: s };
    const path = [...s.lignePath]; path[path.length - 1]++;
    chapters[s.chapIdx] = { ...chapter, lignes: insertLigneAtPath(chapter.lignes, path.slice(0, -1), path.at(-1)!, cloneNode(line)) };
    selection = { ...s, lignePath: path };
  }
  next[s.lotIdx] = renumber({ ...lot, chapitres: chapters });
  return { lots: next, selection };
}
