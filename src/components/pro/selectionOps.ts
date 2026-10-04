// ── Opérations sur une sélection de lignes (DPGF, BPU/DQE) ───────────────────
// Les clés de ligne sont positionnelles (cf. treeOps.rowKey) : supprimer un
// élément décale tous ceux qui le suivent. Les fonctions ci-dessous traitent
// donc toujours la sélection du dernier élément vers le premier, et rendent un
// arbre neuf sans toucher à celui reçu.
import type { Ligne } from '../../types/dpgf';
import { MAX_ARTICLE_DEPTH, deleteLigneAtPath, insertLigneAtPath, parseRowKey, recomputeLot, renumeroterLignes, type LotLike, type ParsedRowKey } from './treeOps';
import { ligneAtPath } from './hierarchyOps';

type Parsed = NonNullable<ParsedRowKey>;

const tuple = (s: Parsed): number[] =>
  s.kind === 'lot' ? [s.lotIdx] : s.kind === 'chapitre' ? [s.lotIdx, s.chapIdx] : [s.lotIdx, s.chapIdx, ...s.lignePath];

/** Ordre du document ; un parent passe avant ses descendants. */
export function compareSelection(a: Parsed, b: Parsed): number {
  const ta = tuple(a);
  const tb = tuple(b);
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    if (ta[i] !== tb[i]) return ta[i] - tb[i];
  }
  return ta.length - tb.length;
}

/** Clés valides, sans doublon, dans l'ordre du document. */
export function parseSelection(keys: Iterable<string>): Parsed[] {
  const seen = new Set<string>();
  const out: Parsed[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed = parseRowKey(key);
    if (parsed) out.push(parsed);
  }
  return out.sort(compareSelection);
}

/**
 * Supprime lots, chapitres et articles sélectionnés. Du dernier au premier :
 * un descendant est retiré avant son parent, et aucune suppression ne décale
 * une clé qui reste à traiter.
 */
export function deleteSelection<L extends LotLike>(lots: L[], keys: Iterable<string>): L[] {
  const sel = parseSelection(keys).reverse();
  let next = lots.map(lot => ({ ...lot, chapitres: lot.chapitres.map((c: any) => ({ ...c, lignes: [...c.lignes] })) })) as L[];
  const touched = new Set<number>();
  for (const s of sel) {
    if (s.kind === 'lot') {
      next = next.filter((_, i) => i !== s.lotIdx);
      continue;
    }
    const lot = next[s.lotIdx];
    if (!lot) continue;
    touched.add(s.lotIdx);
    if (s.kind === 'chapitre') {
      next[s.lotIdx] = { ...lot, chapitres: lot.chapitres.filter((_: unknown, i: number) => i !== s.chapIdx) };
    } else {
      const chap = lot.chapitres[s.chapIdx];
      if (!chap) continue;
      const chapitres = [...lot.chapitres];
      chapitres[s.chapIdx] = { ...chap, lignes: deleteLigneAtPath([...chap.lignes], s.lignePath) };
      next[s.lotIdx] = { ...lot, chapitres };
    }
  }
  return next.map(lot => recomputeLot(lot));
}

/** Copie profonde des articles sélectionnés, dans l'ordre du document. */
export function collectSelectedLignes<G extends Ligne>(lots: LotLike[], keys: Iterable<string>): G[] {
  const sel = parseSelection(keys).filter((s): s is Extract<Parsed, { kind: 'ligne' }> => s.kind === 'ligne');
  // Un article dont le parent est aussi copié voyage déjà avec lui.
  const kept = sel.filter(s => !sel.some(o => o !== s && o.lotIdx === s.lotIdx && o.chapIdx === s.chapIdx
    && o.lignePath.length < s.lignePath.length && o.lignePath.every((n, i) => n === s.lignePath[i])));
  return kept
    .map(s => ligneAtPath(lots[s.lotIdx]?.chapitres[s.chapIdx]?.lignes ?? [], s.lignePath))
    .filter((l): l is Ligne => !!l)
    .map(l => structuredClone(l) as G);
}

function subtreeHeight(ligne: Ligne): number {
  return ligne.children?.length ? 1 + Math.max(...ligne.children.map(subtreeHeight)) : 0;
}

function withFreshIds<G extends Ligne>(ligne: G, newId: () => string): G {
  return { ...ligne, id: newId(), children: ligne.children?.map(c => withFreshIds(c as G, newId)) ?? [] };
}

/**
 * Colle des articles copiés : après l'article visé, au même niveau, ou à la
 * fin du chapitre visé. Rend aussi la position des articles collés pour que
 * l'écran les sélectionne.
 */
export function pasteLignes<L extends LotLike, G extends Ligne>(
  lots: L[], target: Parsed | null, lignes: G[], newId: () => string,
): { lots: L[]; pasted: Parsed[] } | null {
  if (!target || target.kind === 'lot' || !lignes.length) return null;
  const lot = lots[target.lotIdx];
  const chap = lot?.chapitres[target.chapIdx];
  if (!chap) return null;
  let parentPath = target.kind === 'ligne' ? target.lignePath.slice(0, -1) : [];
  let start = target.kind === 'ligne' ? target.lignePath.at(-1)! + 1 : chap.lignes.length;
  // Coller un article qui a des sous-articles sous un article déjà profond
  // dépasserait la profondeur maximale : il va alors au premier niveau du
  // chapitre, juste après l'article de tête visé.
  const hauteur = Math.max(...lignes.map(subtreeHeight));
  if (target.kind === 'ligne' && parentPath.length + 1 + hauteur > MAX_ARTICLE_DEPTH - 1) {
    parentPath = [];
    start = target.lignePath[0] + 1;
  }
  let nextLignes = [...chap.lignes];
  lignes.forEach((ligne, i) => {
    nextLignes = insertLigneAtPath(nextLignes, parentPath, start + i, withFreshIds(ligne, newId));
  });
  nextLignes = renumeroterLignes(nextLignes, String(chap.numero || target.chapIdx + 1));
  const chapitres = [...lot.chapitres];
  chapitres[target.chapIdx] = { ...chap, lignes: nextLignes };
  const next = [...lots];
  next[target.lotIdx] = recomputeLot({ ...lot, chapitres });
  const pasted = lignes.map((_, i) => ({ kind: 'ligne' as const, lotIdx: target.lotIdx, chapIdx: target.chapIdx, lignePath: [...parentPath, start + i] }));
  return { lots: next, pasted };
}

/**
 * Totaux recalculés depuis les articles, jamais lus tels qu'ils ont été
 * enregistrés : un document importé ou réparé à la main peut porter un
 * `totalHT` ou un `sousTotal` qui ne correspond plus à ses lignes.
 */
export function totauxDocument(lots: LotLike[], tva: number): { sousTotaux: number[]; totalHT: number; montantTVA: number; totalTTC: number } {
  const sousTotaux = lots.map(lot => recomputeLot(lot).sousTotal);
  const totalHT = sousTotaux.reduce((s, n) => s + n, 0);
  const montantTVA = totalHT * (Number(tva) || 0) / 100;
  return { sousTotaux, totalHT, montantTVA, totalTTC: totalHT + montantTVA };
}
