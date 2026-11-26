// Quantités liées : un poste suit la quantité d'un autre (menuiserie et volets roulants, doublage et
// peinture...), éventuellement multipliée par un coefficient.
//
// Fonctions pures, partagées par le CCTP, le DPGF, le BPU/DQE, l'estimation et le serveur (approbation d'une
// proposition de confrère). Le lien vit sur l'article qui SUIT (`Ligne.quantiteLiee`) et désigne sa source par
// son `id` : un identifiant est stable aux déplacements, aux renumérotations et aux copies de document, ce
// qu'une clé positionnelle (lot, chapitre, chemin) ne garantit pas.
//
// Un seul sens : la source ignore ses suiveurs, on les retrouve par `suiveursDe`. `propagerLiens` est le seul
// endroit où une quantité liée est calculée ; chaque écran l'appelle au moment d'enregistrer un changement.
//
// Par bâtiment : un suiveur réparti par bâtiment (`quantitesBatiments`) suit sa source bâtiment par bâtiment
// (la source l'est donc aussi), sur les SEULS bâtiments qu'il porte ; son total en est la somme. Un suiveur sans
// répartition suit le total de sa source, réparti ou non.
import { forEachLigne, recomputeLot, type LotLike } from '../components/pro/treeOps';
import type { Ligne } from '../types/dpgf';

/** Borne du coefficient, comme `VALEUR_MAX` de `quantites.ts` pour une quantité. */
export const COEFFICIENT_MAX = 1e6;

/** Un reste de calcul flottant (0,1 x 3 = 0.30000000000000004) n'est pas une quantité. */
const propre = (n: number) => Number(n.toFixed(10));

export interface LienQuantite {
  sourceId: string;
  /** Absent : 1 (la quantité est celle de la source). */
  coefficient?: number;
}

/** Le coefficient d'un lien : 1 sans valeur valable. */
export function coefficientDe(lien: LienQuantite | undefined): number {
  const c = lien?.coefficient;
  return typeof c === 'number' && Number.isFinite(c) && c > 0 && c <= COEFFICIENT_MAX ? c : 1;
}

/** Un article chiffrable sans sous-articles : seul un tel article porte une quantité qu'on peut suivre ou faire suivre. */
const porteUneQuantite = (l: Ligne): boolean => l.type === 'ouvrage' && !l.children?.length;

/** Un métré fixe la quantité : un article qui en a un ne peut pas aussi en suivre une. */
const aUnMetre = (l: Ligne): boolean => !!l.quantiteDetails?.length;

/** Quantité répartie par bâtiment (même table vide). */
const parBatiment = (l: Ligne): boolean => l.quantitesBatiments !== undefined;

function indexer(lots: readonly LotLike[]): Map<string, Ligne> {
  const index = new Map<string, Ligne>();
  forEachLigne(lots as LotLike[], (ligne: Ligne) => { index.set(ligne.id, ligne); });
  return index;
}

/** Index id -> article de tout le document, sous-articles compris (une seule passe pour un affichage de tableau). */
export const indexerLignes = indexer;

/** L'article d'identifiant donné, sous-articles compris. */
export const ligneParId = (lots: readonly LotLike[], id: string): Ligne | undefined => indexer(lots).get(id);

/** Les articles qui suivent directement `sourceId`. */
export function suiveursDe(lots: readonly LotLike[], sourceId: string): Ligne[] {
  const suiveurs: Ligne[] = [];
  forEachLigne(lots as LotLike[], (ligne: Ligne) => { if (ligne.quantiteLiee?.sourceId === sourceId) suiveurs.push(ligne); });
  return suiveurs;
}

/** La chaîne de sources au-dessus d'un article (sa source, la source de sa source...), sans boucle infinie. */
function chaineDeSources(index: Map<string, Ligne>, depart: Ligne): Ligne[] {
  const chaine: Ligne[] = [];
  const vus = new Set<string>([depart.id]);
  let courant: Ligne | undefined = depart;
  while (courant?.quantiteLiee) {
    const source: Ligne | undefined = index.get(courant.quantiteLiee.sourceId);
    if (!source || vus.has(source.id)) break;
    vus.add(source.id);
    chaine.push(source);
    courant = source;
  }
  return chaine;
}

export type RefusLien = 'introuvable' | 'soi' | 'cycle' | 'source_invalide' | 'suiveur_invalide' | 'batiments_incompatibles';

/**
 * Un article peut-il suivre cette source ? Refusé : un article inconnu, lui-même, une source qui le suit déjà
 * (directement ou par une chaîne : A suit B qui suit A), une source qui n'est pas un ouvrage chiffrable ou qui
 * porte des sous-articles, un suiveur à sous-articles ou à métré (sa quantité vient déjà d'ailleurs), et un
 * suiveur réparti par bâtiment dont la source ne l'est pas (on ne saurait pas quel bâtiment reçoit quoi).
 */
export function peutSuivre(
  lots: readonly LotLike[], ligneId: string, sourceId: string,
): { ok: true } | { ok: false; raison: RefusLien } {
  const index = indexer(lots);
  const ligne = index.get(ligneId);
  const source = index.get(sourceId);
  if (!ligne || !source) return { ok: false, raison: 'introuvable' };
  if (ligne.id === source.id) return { ok: false, raison: 'soi' };
  if (!porteUneQuantite(source)) return { ok: false, raison: 'source_invalide' };
  if (!porteUneQuantite(ligne) || aUnMetre(ligne)) return { ok: false, raison: 'suiveur_invalide' };
  if (parBatiment(ligne) && !parBatiment(source)) return { ok: false, raison: 'batiments_incompatibles' };
  if (chaineDeSources(index, source).some(s => s.id === ligne.id)) return { ok: false, raison: 'cycle' };
  return { ok: true };
}

export interface CandidatSource {
  id: string;
  numero: string;
  designation: string;
  unite: string;
  quantite: number;
  lotNumero: string;
  lotTitre: string;
}

/**
 * Les articles que `ligneId` peut suivre, dans l'ordre du document : tous les ouvrages chiffrables sauf lui-même
 * et ceux qui le suivent (ils créeraient une boucle). Un article réparti par bâtiment ne se voit proposer que des
 * sources réparties aussi.
 */
export function candidatsSources(lots: readonly LotLike[], ligneId: string): CandidatSource[] {
  const index = indexer(lots);
  const suiveurParBatiment = !!index.get(ligneId) && parBatiment(index.get(ligneId)!);
  const candidats: CandidatSource[] = [];
  forEachLigne(lots as LotLike[], (ligne: Ligne, _chap: unknown, lot: LotLike & { numero?: string; titre?: string }) => {
    if (ligne.id === ligneId || !porteUneQuantite(ligne)) return;
    if (suiveurParBatiment && !parBatiment(ligne)) return;
    if (chaineDeSources(index, ligne).some(s => s.id === ligneId)) return;
    candidats.push({
      id: ligne.id, numero: ligne.numero, designation: ligne.designation, unite: ligne.unite, quantite: ligne.quantite,
      lotNumero: lot.numero ?? '', lotTitre: lot.titre ?? '',
    });
  });
  return candidats;
}

/** Les parts d'un suiveur par bâtiment : celles de la source, sur SES bâtiments, multipliées par le coefficient. */
function partsSuivies(suiveur: Ligne, partsSource: Record<string, number>, coefficient: number): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const id of Object.keys(suiveur.quantitesBatiments ?? {})) parts[id] = propre((partsSource[id] ?? 0) * coefficient);
  return parts;
}
const sommeDesParts = (parts: Record<string, number>): number => propre(Object.values(parts).reduce((s, v) => s + v, 0));

/**
 * Le correctif à fusionner dans l'article pour qu'il suive `source` : la quantité devient celle de la source
 * multipliée par le coefficient, le prix total suit (0 pour mémoire) et la formule mémorisée s'efface. Un article
 * réparti par bâtiment reçoit la part de la source pour chacun de SES bâtiments.
 * `null` si le coefficient n'est pas un nombre strictement positif dans la borne, ou si l'article est réparti par
 * bâtiment et pas sa source.
 */
export function lierPatch(ligne: Ligne, source: Ligne, coefficient = 1): Partial<Ligne> | null {
  if (!Number.isFinite(coefficient) || coefficient <= 0 || coefficient > COEFFICIENT_MAX) return null;
  let quantite = propre(source.quantite * coefficient);
  let parts: Record<string, number> | undefined;
  if (parBatiment(ligne)) {
    if (!parBatiment(source)) return null;
    parts = partsSuivies(ligne, source.quantitesBatiments ?? {}, coefficient);
    quantite = sommeDesParts(parts);
  }
  return {
    quantiteLiee: coefficient === 1 ? { sourceId: source.id } : { sourceId: source.id, coefficient },
    quantite,
    ...(parts ? { quantitesBatiments: parts } : {}),
    prixTotal: ligne.pourMemoire ? 0 : propre(quantite * ligne.prixUnitaire),
    quantiteFormule: undefined,
  };
}

/** Le correctif qui détache l'article de sa source : il garde la quantité qu'il a et redevient modifiable. */
export const delierPatch = (): Partial<Ligne> => ({ quantiteLiee: undefined });

const memesParts = (a: Record<string, number> | undefined, b: Record<string, number> | undefined): boolean => {
  if (!a || !b) return a === b;
  const cles = Object.keys(b);
  return Object.keys(a).length === cles.length && cles.every(k => a[k] === b[k]);
};

/**
 * Recalcule la quantité de chaque article qui en suit un autre, en cascade (la peinture suit le doublage, qui
 * suit les cloisons), puis le sous-total des lots touchés. Rend le MÊME tableau quand rien ne change, pour qu'un
 * appelant évite un enregistrement inutile.
 *
 * Un lien qui ne peut plus tenir est RETIRÉ et l'article garde sa dernière quantité (jamais remise à 0, jamais
 * une valeur périmée qui se ferait passer pour calculée) : source supprimée, boucle (des données importées ou
 * écrites par un outil), article devenu parent de sous-articles ou portant un métré, source devenue parent, ou
 * article réparti par bâtiment dont la source ne l'est plus.
 */
export function propagerLiens<L extends LotLike>(lots: L[]): L[] {
  const index = new Map<string, any>();
  let aDesLiens = false;
  forEachLigne(lots, (ligne: any) => { index.set(ligne.id, ligne); if (ligne.quantiteLiee) aDesLiens = true; });
  if (!aDesLiens) return lots;

  interface Valeurs { total: number; parts?: Record<string, number> }
  const memo = new Map<string, Valeurs | null>();
  const enCours = new Set<string>();
  const lienTient = (l: any): boolean => !!l.quantiteLiee && porteUneQuantite(l) && !aUnMetre(l);

  // Valeurs finales d'un article (total, et parts par bâtiment s'il en a), en suivant la chaîne jusqu'à une
  // quantité propre ; `null` si le lien ne tient pas.
  const valeursFinales = (ligne: any): Valeurs | null => {
    if (!lienTient(ligne)) return { total: ligne.quantite, parts: ligne.quantitesBatiments };
    if (memo.has(ligne.id)) return memo.get(ligne.id)!;
    if (enCours.has(ligne.id)) return null;
    enCours.add(ligne.id);
    const source = index.get(ligne.quantiteLiee.sourceId);
    const vs = source && source !== ligne && porteUneQuantite(source) ? valeursFinales(source) : null;
    const coefficient = coefficientDe(ligne.quantiteLiee);
    let resultat: Valeurs | null = null;
    if (vs) {
      if (parBatiment(ligne)) {
        if (vs.parts) {
          const parts = partsSuivies(ligne, vs.parts, coefficient);
          resultat = { total: sommeDesParts(parts), parts };
        }
      } else {
        resultat = { total: propre(vs.total * coefficient) };
      }
    }
    enCours.delete(ligne.id);
    memo.set(ligne.id, resultat);
    return resultat;
  };

  // Seuls les suiveurs dont la source tient encore sont recalculés ; les autres perdent leur lien.
  const resultats = new Map<string, Valeurs | null>();
  index.forEach(ligne => { if (ligne.quantiteLiee) resultats.set(ligne.id, lienTient(ligne) ? valeursFinales(ligne) : null); });

  const refaireLigne = (l: any): any => {
    let next = l;
    if (l.children?.length) {
      const enfants = l.children.map(refaireLigne);
      if (enfants.some((e: any, i: number) => e !== l.children[i])) next = { ...next, children: enfants };
    }
    if (!resultats.has(l.id)) return next;
    const valeurs = resultats.get(l.id);
    if (!valeurs) {
      const { quantiteLiee: _perdu, ...reste } = next;
      return reste;
    }
    const prixTotal = l.pourMemoire ? 0 : propre(valeurs.total * l.prixUnitaire);
    const partsChangent = !!valeurs.parts && !memesParts(l.quantitesBatiments, valeurs.parts);
    if (valeurs.total === l.quantite && prixTotal === l.prixTotal && !partsChangent) return next;
    return {
      ...next, quantite: valeurs.total, prixTotal, quantiteFormule: undefined,
      ...(valeurs.parts ? { quantitesBatiments: valeurs.parts } : {}),
    };
  };

  let change = false;
  const resultat = lots.map(lot => {
    let lotChange = false;
    const chapitres = lot.chapitres.map((chap: any) => {
      const lignes = chap.lignes.map(refaireLigne);
      if (!lignes.some((e: any, i: number) => e !== chap.lignes[i])) return chap;
      lotChange = true;
      return { ...chap, lignes };
    });
    if (!lotChange) return lot;
    change = true;
    return recomputeLot({ ...lot, chapitres });
  });
  return change ? resultat : lots;
}

// ── Copie, collage et duplication ────────────────────────────────────────────

/**
 * Ce que deviennent les liens des articles copiés. `tout` : un lien vers un article copié aussi suit la COPIE,
 * un lien vers un article resté en place continue de le suivre. `internes` : seuls les liens entre copies sont
 * gardés, les autres sont rompus. `rompre` : plus aucun lien, chaque copie garde sa quantité du moment.
 */
export type ModeLiens = 'tout' | 'internes' | 'rompre';

export interface LiensDeCopie {
  /** Les articles copiés qui en suivent un autre. */
  suiveurs: Ligne[];
  /** Leur source est elle aussi copiée. */
  internes: number;
  /** Leur source reste en place. */
  externes: number;
}

/** Les liens de quantité parmi des éléments qu'on s'apprête à copier (lots, chapitres ou articles, sous-éléments compris). */
export function liensDeCopie(racines: readonly unknown[]): LiensDeCopie {
  const ids = new Set<string>();
  const suiveurs: Ligne[] = [];
  const visiter = (n: any) => {
    if (typeof n?.id === 'string') ids.add(n.id);
    if (n?.quantiteLiee) suiveurs.push(n);
    for (const cle of ['chapitres', 'lignes', 'children']) n?.[cle]?.forEach(visiter);
  };
  racines.forEach(visiter);
  const internes = suiveurs.filter(s => ids.has(s.quantiteLiee!.sourceId)).length;
  return { suiveurs, internes, externes: suiveurs.length - internes };
}

/** Additionne les liens de plusieurs copies indépendantes (duplication de plusieurs éléments, une copie chacun). */
export const fusionnerLiensDeCopie = (liste: readonly LiensDeCopie[]): LiensDeCopie => ({
  suiveurs: liste.flatMap(l => l.suiveurs),
  internes: liste.reduce((s, l) => s + l.internes, 0),
  externes: liste.reduce((s, l) => s + l.externes, 0),
});

/**
 * Applique `mode` aux copies. `correspondance` donne, pour chaque identifiant d'origine copié, celui de sa copie.
 * Les copies sont MODIFIÉES sur place : l'appelant les a déjà dupliquées (copie profonde, ou objets neufs).
 */
export function adapterLiensCopie(racines: readonly unknown[], correspondance: ReadonlyMap<string, string>, mode: ModeLiens): void {
  const visiter = (n: any) => {
    const lien = n?.quantiteLiee;
    if (lien) {
      const copie = correspondance.get(lien.sourceId);
      if (mode === 'rompre' || (mode === 'internes' && copie === undefined)) delete n.quantiteLiee;
      else if (copie !== undefined) n.quantiteLiee = { ...lien, sourceId: copie };
    }
    for (const cle of ['chapitres', 'lignes', 'children']) n?.[cle]?.forEach(visiter);
  };
  racines.forEach(visiter);
}
