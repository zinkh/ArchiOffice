// ── Opérations sur une sélection de lignes (DPGF, BPU/DQE) ───────────────────
// Les clés de ligne sont positionnelles (cf. treeOps.rowKey) : supprimer un
// élément décale tous ceux qui le suivent. Les fonctions ci-dessous traitent
// donc toujours la sélection du dernier élément vers le premier, et rendent un
// arbre neuf sans toucher à celui reçu.
import { NATURES_HORS_BASE, type Ligne, type NatureArticle, type NatureHorsBase } from '../../types/dpgf';
import { MAX_ARTICLE_DEPTH, forEachLigne, deleteLigneAtPath, insertLigneAtPath, mutateLigneAtPath, parseRowKey, recomputeLot, estHorsBase, renumeroterLignes, sousTotalNature, type LotLike, type ParsedRowKey } from './treeOps';
import { ligneAtPath } from './hierarchyOps';
import { adapterLiensCopie, indexerLignes, type ModeLiens } from '../../lib/quantitesLiees';

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

function withFreshIds<G extends Ligne>(ligne: G, newId: () => string, correspondance?: Map<string, string>): G {
  const id = newId();
  correspondance?.set(ligne.id, id);
  return { ...ligne, id, children: ligne.children?.map(c => withFreshIds(c as G, newId, correspondance)) ?? [] };
}

/**
 * Colle des articles copiés : après l'article visé, au même niveau, ou à la
 * fin du chapitre visé. Rend aussi la position des articles collés pour que
 * l'écran les sélectionne.
 */
export function pasteLignes<L extends LotLike, G extends Ligne>(
  lots: L[], target: Parsed | null, lignes: G[], newId: () => string, liens: ModeLiens = 'tout',
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
  // Chaque copie reçoit un identifiant neuf ; les liens de quantité suivent alors `liens` : un lien vers un article
  // collé en même temps suit sa copie, un lien vers un article resté en place est gardé ou rompu.
  const correspondance = new Map<string, string>();
  const fraiches = lignes.map(ligne => withFreshIds(ligne, newId, correspondance));
  adapterLiensCopie(fraiches, correspondance, liens);
  fraiches.forEach((ligne, i) => {
    nextLignes = insertLigneAtPath(nextLignes, parentPath, start + i, ligne);
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
export function totauxDocument(lots: LotLike[], tva: number): {
  sousTotaux: number[]; totalHT: number; montantTVA: number; totalTTC: number;
  /** PSE, options et variantes, comptées à part : jamais dans le total de base. */
  horsBase: Record<NatureHorsBase, { totalHT: number; nb: number }>;
} {
  const sousTotaux = lots.map(lot => recomputeLot(lot).sousTotal);
  const totalHT = sousTotaux.reduce((s, n) => s + n, 0);
  const montantTVA = totalHT * (Number(tva) || 0) / 100;
  const horsBase = Object.fromEntries(NATURES_HORS_BASE.map(nature => [nature, {
    totalHT: lots.reduce((s, lot) => s + sousTotalNature(lot, nature), 0),
    nb: lots.reduce((s, lot) => s + compterNature(lot.chapitres, nature), 0),
  }])) as Record<NatureHorsBase, { totalHT: number; nb: number }>;
  return { sousTotaux, totalHT, montantTVA, totalTTC: totalHT + montantTVA, horsBase };
}

/** Nombre d'articles (feuilles) d'une nature, pour un parent compris. */
function compterNature(chapitres: any[], nature: NatureHorsBase): number {
  const dans = (lignes: any[], actif: boolean): number => lignes.reduce((n: number, l: any) => {
    if (estHorsBase(l.nature) && l.nature !== nature) return n;
    const ici = actif || l.nature === nature;
    return n + (l.children?.length ? dans(l.children, ici) : ici ? 1 : 0);
  }, 0);
  return chapitres.reduce((n: number, c: any) => n + (c.cctpOnly ? 0 : dans(c.lignes, false)), 0);
}

/**
 * Pose (ou retire) la nature d'une prestation et/ou « pour mémoire » sur les
 * articles sélectionnés. Un lot ou un chapitre vise tous ses articles de
 * premier niveau, un article porte son propre statut (valable pour ses
 * sous-articles). `patch` à `undefined` retire la propriété.
 */
export function appliquerStatutLignes<L extends LotLike>(
  lots: L[], keys: Iterable<string>, patch: { nature?: NatureArticle | undefined; pourMemoire?: boolean | undefined },
): L[] {
  const sel = parseSelection(keys);
  const toucher = (ligne: any) => {
    const next = { ...ligne };
    if ('nature' in patch) { if (patch.nature && patch.nature !== 'base') next.nature = patch.nature; else delete next.nature; }
    if ('pourMemoire' in patch) {
      if (patch.pourMemoire) { next.pourMemoire = true; if (!ligne.children?.length) { next.prixUnitaire = 0; next.prixTotal = 0; } }
      else delete next.pourMemoire;
    }
    return next;
  };
  let next = lots.map(lot => ({ ...lot, chapitres: lot.chapitres.map((c: any) => ({ ...c, lignes: [...c.lignes] })) })) as L[];
  const touched = new Set<number>();
  for (const s of sel) {
    const lot = next[s.lotIdx];
    if (!lot) continue;
    const chapIdxs = s.kind === 'lot' ? lot.chapitres.map((_: unknown, i: number) => i) : [s.chapIdx];
    for (const ci of chapIdxs) {
      const chap = lot.chapitres[ci];
      if (!chap) continue;
      touched.add(s.lotIdx);
      if (s.kind === 'ligne') {
        chap.lignes = mutateLigneAtPath(chap.lignes, s.lignePath, toucher);
      } else {
        chap.lignes = chap.lignes.map((l: any) => (l.cctpOnly ? l : toucher(l)));
      }
    }
  }
  next = next.map((lot, i) => (touched.has(i) ? recomputeLot(lot) : lot));
  return next;
}

/** Ce qu'emporte une suppression : éléments retirés, sous-articles compris. */
export interface ResumeSuppression { lots: number; chapitres: number; articles: number }

const compterArticles = (lignes: Ligne[]): number =>
  lignes.reduce((s, l) => s + 1 + compterArticles(l.children ?? []), 0);

/**
 * Compte ce que `deleteSelection` retirerait : un élément déjà emporté par un
 * parent sélectionné (article d'un chapitre supprimé...) n'est pas compté deux fois.
 */
export function resumeSuppression(lots: LotLike[], keys: Iterable<string>): ResumeSuppression {
  const sel = parseSelection(keys);
  const resume: ResumeSuppression = { lots: 0, chapitres: 0, articles: 0 };
  const prefixe = (a: number[], b: number[]) => a.length < b.length && a.every((n, i) => n === b[i]);
  for (const s of sel) {
    const t = tuple(s);
    if (sel.some(o => o !== s && prefixe(tuple(o), t))) continue;
    const lot: any = lots[s.lotIdx];
    if (!lot) continue;
    if (s.kind === 'lot') {
      resume.lots += 1;
      resume.chapitres += lot.chapitres.length;
      resume.articles += lot.chapitres.reduce((n: number, c: any) => n + compterArticles(c.lignes), 0);
    } else if (s.kind === 'chapitre') {
      const chap = lot.chapitres[s.chapIdx];
      if (!chap) continue;
      resume.chapitres += 1;
      resume.articles += compterArticles(chap.lignes);
    } else {
      const l = ligneAtPath(lot.chapitres[s.chapIdx]?.lignes ?? [], s.lignePath);
      if (l) resume.articles += compterArticles([l as Ligne]);
    }
  }
  return resume;
}

/** Les identifiants de tous les articles qu'emporte la suppression de ces clés (sous-articles compris). */
function idsSupprimes(lots: LotLike[], keys: Iterable<string>): Set<string> {
  const supprimes = new Set<string>();
  const ajouter = (l: Ligne) => { supprimes.add(l.id); l.children?.forEach(ajouter); };
  for (const s of parseSelection(keys)) {
    const lot: any = lots[s.lotIdx];
    if (!lot) continue;
    if (s.kind === 'lot') lot.chapitres.forEach((c: any) => c.lignes.forEach(ajouter));
    else if (s.kind === 'chapitre') lot.chapitres[s.chapIdx]?.lignes.forEach(ajouter);
    else {
      const l = ligneAtPath(lot.chapitres[s.chapIdx]?.lignes ?? [], s.lignePath);
      if (l) ajouter(l as Ligne);
    }
  }
  return supprimes;
}

/** La clé de ligne (`ligne-lot-chapitre-chemin`) d'un article, ou `undefined` s'il n'est pas dans l'arbre. */
function cleDeLigne(lots: LotLike[], id: string): string | undefined {
  let cle: string | undefined;
  forEachLigne(lots, (ligne: Ligne, chap: unknown, lot: LotLike, path: number[]) => {
    if (ligne.id === id) cle = `ligne-${lots.indexOf(lot)}-${lot.chapitres.indexOf(chap)}-${path.join('-')}`;
  });
  return cle;
}

/**
 * Tous les articles à supprimer AUSSI pour que plus aucun article ne suive la quantité de ce qu'on supprime : les
 * suiveurs, puis les suiveurs de ces suiveurs, jusqu'au bout de la chaîne. Rend les articles et leurs clés de
 * ligne, à ajouter à la sélection (un parent supprimé emporte déjà ses sous-articles, `deleteSelection` accepte
 * qu'un descendant et son parent soient sélectionnés ensemble).
 */
export function suiveursEnCascade(lots: LotLike[], keys: Iterable<string>): { lignes: Ligne[]; cles: string[] } {
  const supprimes = idsSupprimes(lots, keys);
  if (!supprimes.size) return { lignes: [], cles: [] };
  const index = indexerLignes(lots);
  const lignes: Ligne[] = [];
  const ajouter = (l: Ligne) => { supprimes.add(l.id); l.children?.forEach(ajouter); };
  let nouveau = true;
  while (nouveau) {
    nouveau = false;
    index.forEach(l => {
      const sourceId = l.quantiteLiee?.sourceId;
      if (!sourceId || supprimes.has(l.id) || !supprimes.has(sourceId)) return;
      lignes.push(l);
      ajouter(l);
      nouveau = true;
    });
  }
  return { lignes, cles: lignes.map(l => cleDeLigne(lots, l.id)).filter((k): k is string => !!k) };
}

/** Un article supprimé qui servait de source à des articles restés dans le document. */
export interface LienRompu { source: Ligne; suiveurs: Ligne[] }

/**
 * Les articles qui suivent la quantité d'un article SUPPRIMÉ (lui-même, ou emporté avec son chapitre, son lot ou
 * son parent) sans être supprimés eux-mêmes. Ils gardent leur dernière quantité et redeviennent modifiables
 * (`propagerLiens` retire le lien d'une source disparue) : la fenêtre de confirmation le dit avant de supprimer.
 * Un suiveur supprimé avec sa source n'est pas compté.
 */
export function liensRompus(lots: LotLike[], keys: Iterable<string>): LienRompu[] {
  const supprimes = idsSupprimes(lots, keys);
  if (!supprimes.size) return [];
  const index = indexerLignes(lots);
  const parSource = new Map<string, LienRompu>();
  index.forEach(l => {
    const sourceId = l.quantiteLiee?.sourceId;
    if (!sourceId || supprimes.has(l.id) || !supprimes.has(sourceId)) return;
    const source = index.get(sourceId);
    if (!source) return;
    const entree = parSource.get(sourceId) ?? { source, suiveurs: [] };
    entree.suiveurs.push(l);
    parSource.set(sourceId, entree);
  });
  return [...parSource.values()];
}
