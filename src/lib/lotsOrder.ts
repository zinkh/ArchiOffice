/**
 * Ordre et numérotation des lots.
 *
 * La liste des lots du projet (`project_lots`) fait foi : son ordre décide de
 * celui des lots du DPGF, du CCTP (même document) et du bordereau, et son
 * numéro (« 01 », « 02 »...) est reporté sur eux. Fonctions pures, sans
 * accès réseau, pour rester testables.
 */

import { chapitresParDefaut, numeroDeChapitre } from './chapitresParDefaut';

export interface LotProjet { id: string; lot_number: string; lot_title: string }

/** Numéro attribué au rang `index` (0-based) : « 01 » à « 99 », puis « 100 ». */
export const numeroDeLot = (index: number): string => String(index + 1).padStart(2, '0');

export const NUMERO_LOT_MAX = 12;

export type NumeroLotValide = { ok: true; numero: string } | { ok: false; error: string };

/**
 * Un numéro de lot est libre : « 00 », « 01 », « 01A », « 01B » (lot scindé en
 * deux), « 01.1 »... Les chapitres sont numérotés « 1 », « 2 » dans chaque lot et
 * ne reprennent pas le numéro du lot : le point n'y est donc plus ambigu.
 */
export function validerNumeroDeLot(brut: unknown): NumeroLotValide {
  const numero = typeof brut === 'string' ? brut.trim() : '';
  if (!numero) return { ok: false, error: 'Le numéro du lot ne peut pas être vide.' };
  if (numero.length > NUMERO_LOT_MAX) return { ok: false, error: `Le numéro du lot est limité à ${NUMERO_LOT_MAX} caractères.` };
  if (/\s|[/\\]/.test(numero)) return { ok: false, error: 'Le numéro du lot ne peut contenir ni espace, ni barre oblique.' };
  if (/^\.|\.$|\.\./.test(numero)) return { ok: false, error: 'Le point sépare des niveaux : « 01.1 » est valide, « .01 », « 01. » et « 01..1 » ne le sont pas.' };
  return { ok: true, numero };
}

/** Un autre lot du projet porte déjà ce numéro (sans tenir compte de la casse : « 01a » = « 01A »). */
export const numeroDeLotPris = (numero: string, lots: { id: string; lot_number: string }[], sauf?: string): boolean =>
  lots.some(l => l.id !== sauf && (l.lot_number ?? '').trim().toLowerCase() === numero.trim().toLowerCase());

/**
 * Numéros après un changement d'ordre (monter / descendre un lot).
 * - Numérotation standard (que des nombres : « 00 », « 01 », « 02 »...) :
 *   automatique, le premier numéro de la série est conservé (« 00 » reste le
 *   premier) et les suivants se renumérotent à la suite, sans trou.
 * - Dès qu'un numéro est personnalisé (« 01A », « 01.2 »...) : la série
 *   existante est redistribuée telle quelle dans le nouvel ordre, rien n'est
 *   écrasé.
 * Série incomplète ou en double : retour à « 01 », « 02 »...
 */
export function numerosPourOrdre(lots: { id: string; lot_number: string }[], idsOrdre: string[]): Map<string, string> {
  const serie = lots.map(l => (l.lot_number ?? '').trim());
  const exploitable = serie.every(Boolean) && new Set(serie.map(n => n.toLowerCase())).size === serie.length;
  let pool: string[];
  if (!exploitable) pool = idsOrdre.map((_, i) => numeroDeLot(i));
  else if (serie.every(n => /^\d+$/.test(n))) {
    const debut = Math.min(...serie.map(Number));
    const largeur = Math.max(2, ...serie.map(n => n.length));
    pool = idsOrdre.map((_, i) => String(debut + i).padStart(largeur, '0'));
  } else pool = [...serie].sort(comparerNumerosDeLot);
  return new Map(idsOrdre.map((id, i) => [id, pool[i]]));
}

/** Tri naturel par numéro (« 2 » avant « 10 »), utilisé quand aucun ordre explicite n'existe. */
export const comparerNumerosDeLot = (a: string, b: string): number =>
  (a ?? '').localeCompare(b ?? '', 'fr', { numeric: true });

const norm = (s: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

interface LigneNumerotee { numero?: string; children?: LigneNumerotee[] }
interface ChapitreNumerote { numero?: string; lignes?: LigneNumerotee[] }
export interface LotDocument {
  id: string; numero: string; titre: string; projectLotId?: string;
  chapitres?: ChapitreNumerote[];
}

/** Remplace le préfixe « ancien. » d'un numéro par « nouveau. » ; un numéro sans ce préfixe (code de bibliothèque) est laissé tel quel. */
const changerPrefixe = (numero: string | undefined, ancien: string, nouveau: string): string | undefined => {
  if (!numero || ancien === nouveau) return numero;
  if (numero === ancien) return nouveau;
  return numero.startsWith(`${ancien}.`) ? `${nouveau}${numero.slice(ancien.length)}` : numero;
};

const renumeroterLignes = (lignes: LigneNumerotee[] | undefined, ancien: string, nouveau: string): LigneNumerotee[] | undefined =>
  lignes?.map(l => ({
    ...l,
    numero: changerPrefixe(l.numero, ancien, nouveau),
    children: renumeroterLignes(l.children, ancien, nouveau),
  }));

/** Un lot « vide » ne porte aucun article ni aucun texte : le retirer ne fait rien perdre. */
export const lotEstVide = (l: LotDocument & { cctpDescription?: string }): boolean =>
  !(l.cctpDescription ?? '').trim() &&
  (l.chapitres ?? []).every((c: any) =>
    !(c.cctpDescription ?? '').trim() && !(c.lignes?.length));

/** Intitulés proches : l'un contient l'autre (« Charpente » / « CHARPENTE BOIS »). */
const intitulesProches = (a: string, b: string): boolean => {
  const x = norm(a), y = norm(b);
  return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x));
};

let _compteurLot = 0;
const nouvelId = () => `lot_${Date.now()}_${_compteurLot++}`;

export interface OptionsAlignement {
  /** Rapproche aussi les intitulés proches (« Charpente » / « CHARPENTE BOIS »). */
  rapprocher?: boolean;
  /** Retire les lots du document absents du projet (geste explicite, jamais par défaut). */
  retirerHorsProjet?: boolean;
  /** Un lot créé dans le document reçoit les trois chapitres par défaut (CCTP / DPGF, pas le bordereau). */
  chapitresParDefaut?: boolean;
}

/**
 * Le document et la liste des lots du projet divergent : au moins un lot du
 * document n'est pas rattaché à un lot existant du projet. Un document sans
 * lot ne diverge pas, il se remplit simplement depuis la liste.
 */
export const lotsDivergent = (doc: { lots: any[] } | null | undefined, lotsProjet: LotProjet[]): boolean => {
  if (!doc?.lots?.length) return false;
  const ids = new Set(lotsProjet.map(p => p.id));
  return (doc.lots as LotDocument[]).some(l => !l.projectLotId || !ids.has(l.projectLotId));
};

/**
 * Range les lots d'un document (DPGF/CCTP ou BPU) dans l'ordre des lots du
 * projet et leur donne EXACTEMENT leur numéro et leur intitulé, chapitres et
 * articles compris. Rattachement : `projectLotId`, à défaut intitulé identique
 * (sans casse ni accents), puis proche si `rapprocher`. Un lot du projet absent
 * du document y est créé, vide. Un lot du document sans équivalent est conservé
 * après les autres, jamais supprimé sauf `retirerHorsProjet`.
 */
export function appliquerOrdreLots<D extends { lots: any[] }>(doc: D, lotsProjet: LotProjet[], opts: OptionsAlignement = {}): D {
  const restants = [...(doc.lots as LotDocument[])];
  const pris = new Set<string>();
  const ordonnes: LotDocument[] = [];

  const prendre = (predicat: (l: LotDocument) => boolean): LotDocument | undefined => {
    const l = restants.find(x => !pris.has(x.id) && predicat(x));
    if (l) pris.add(l.id);
    return l;
  };

  // D'abord les rattachements explicites, pour qu'un intitulé identique ne les vole pas.
  const explicites = new Map<string, LotDocument>();
  for (const p of lotsProjet) {
    const l = prendre(x => x.projectLotId === p.id);
    if (l) explicites.set(p.id, l);
  }
  for (const [index, p] of lotsProjet.entries()) {
    const numero = p.lot_number || numeroDeLot(index);
    const l = explicites.get(p.id)
      ?? prendre(x => !x.projectLotId && norm(x.titre) === norm(p.lot_title))
      ?? (opts.rapprocher ? prendre(x => !x.projectLotId && intitulesProches(x.titre, p.lot_title)) : undefined);
    if (!l) {
      ordonnes.push({
        id: nouvelId(), numero, titre: p.lot_title, projectLotId: p.id,
        chapitres: opts.chapitresParDefaut ? chapitresParDefaut(nouvelId) : [], sousTotal: 0,
      } as LotDocument);
      continue;
    }
    ordonnes.push({
      ...l,
      projectLotId: p.id,
      numero,
      titre: p.lot_title || l.titre,
      // Chapitres « 1 », « 2 »... propres au lot, jamais préfixés par son numéro ;
      // un document ancien (« 01.1 ») est ramené à cette forme, articles compris.
      chapitres: l.chapitres?.map((c, ci) => {
        const nouveau = numeroDeChapitre(ci);
        return { ...c, numero: nouveau, lignes: renumeroterLignes(c.lignes, c.numero ?? '', nouveau) };
      }),
    });
  }
  const horsProjet = opts.retirerHorsProjet ? [] : restants.filter(l => !pris.has(l.id));
  return { ...doc, lots: [...ordonnes, ...horsProjet] };
}

export interface LotAImporter { lotDocId: string; projectLotId?: string; numero: string; titre: string }

/**
 * Sens inverse : la liste des lots se remplit depuis un document (cas d'un
 * CCTP rédigé avant d'avoir saisi les lots). Chaque lot du document, dans son
 * ordre, reprend un lot existant du projet (rattachement, intitulé identique,
 * puis proche) dont le numéro et l'intitulé deviennent ceux du document, ou
 * donne un nouveau lot. Un numéro absent ou en double reçoit le rang suivant.
 */
export function planImportLots(doc: { lots: any[] }, lotsProjet: LotProjet[]): LotAImporter[] {
  const utilises = new Set<string>();
  const libre = (p: LotProjet) => !utilises.has(p.id);
  const numeros = new Set<string>();
  return (doc.lots as LotDocument[]).map((l, index) => {
    const existant =
      lotsProjet.find(p => libre(p) && p.id === l.projectLotId)
      ?? lotsProjet.find(p => libre(p) && norm(p.lot_title) === norm(l.titre))
      ?? lotsProjet.find(p => libre(p) && intitulesProches(p.lot_title, l.titre));
    if (existant) utilises.add(existant.id);
    let numero = (l.numero ?? '').trim();
    if (!numero || numeros.has(numero)) numero = numeroDeLot(index);
    numeros.add(numero);
    return { lotDocId: l.id, projectLotId: existant?.id, numero, titre: l.titre };
  });
}
