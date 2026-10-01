/**
 * Ordre et numérotation des lots.
 *
 * La liste des lots du projet (`project_lots`) fait foi : son ordre décide de
 * celui des lots du DPGF, du CCTP (même document) et du bordereau, et son
 * numéro (« 01 », « 02 »...) est reporté sur eux. Fonctions pures, sans
 * accès réseau, pour rester testables.
 */

export interface LotProjet { id: string; lot_number: string; lot_title: string }

/** Numéro attribué au rang `index` (0-based) : « 01 » à « 99 », puis « 100 ». */
export const numeroDeLot = (index: number): string => String(index + 1).padStart(2, '0');

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
const lotEstVide = (l: LotDocument & { cctpDescription?: string }): boolean =>
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

/**
 * Range les lots d'un document (DPGF/CCTP ou BPU) dans l'ordre des lots du
 * projet et leur donne le numéro correspondant, chapitres et articles compris.
 * La liste des lots du projet fait foi :
 * - rattachement par `projectLotId`, à défaut par intitulé identique, puis
 *   par intitulé proche (sans casse ni accents) ; le rattachement est posé ;
 * - un lot du projet absent du document y est créé, vide ;
 * - un lot du document sans équivalent dans le projet est retiré s'il est
 *   vide ; s'il porte du contenu il est conservé après les autres, pour ne
 *   rien perdre en silence.
 */
export function appliquerOrdreLots<D extends { lots: any[] }>(doc: D, lotsProjet: LotProjet[]): D {
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
      ?? prendre(x => !x.projectLotId && intitulesProches(x.titre, p.lot_title));
    if (!l) {
      ordonnes.push({
        id: nouvelId(), numero, titre: p.lot_title, projectLotId: p.id,
        chapitres: [], sousTotal: 0,
      } as LotDocument);
      continue;
    }
    ordonnes.push({
      ...l,
      projectLotId: p.id,
      numero,
      titre: p.lot_title || l.titre,
      chapitres: l.chapitres?.map(c => ({
        ...c,
        numero: changerPrefixe(c.numero, l.numero, numero),
        lignes: renumeroterLignes(c.lignes, l.numero, numero),
      })),
    });
  }
  const horsProjet = restants.filter(l => !pris.has(l.id) && !lotEstVide(l));
  return { ...doc, lots: [...ordonnes, ...horsProjet] };
}
