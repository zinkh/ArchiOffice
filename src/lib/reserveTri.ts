// Classement et filtres des réserves par lot (ReserveTracker, ReservePlanView). Logique pure, sans
// React : le tableau, la vue par plan et les menus de filtre lisent les mêmes règles.
//
// Une réserve ne porte que l'INTITULÉ de ses lots (`reserves.lots`, liste JSON), jamais le numéro :
// le numéro se retrouve par l'intitulé dans la liste des lots de l'affaire. Un lot que l'affaire ne
// connaît plus (renommé, supprimé) n'a pas de numéro et passe après les autres.
import { parseJsonList } from './jsonList';

export interface LotRef { lot_number?: string | null; lot_title: string }

/** Valeur du filtre « lot » pour les réserves qu'aucun lot ne rattache. */
export const SANS_LOT_FILTRE = '__sans_lot__';

/** Intitulé de groupe d'une réserve sans lot (clé et libellé, comme avant). */
export const GROUPE_SANS_LOT = 'Sans Lot / Entreprise';

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

/** Numéro de lot par intitulé normalisé (casse et accents ignorés). Un numéro vide n'est pas retenu. */
export function numerosParLot(lots: LotRef[] | undefined | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const lot of lots ?? []) {
    const numero = (lot.lot_number ?? '').trim();
    const cle = norm(lot.lot_title || '');
    if (numero && cle && !map.has(cle)) map.set(cle, numero);
  }
  return map;
}

/** Numéro d'un lot désigné par son intitulé, '' s'il n'est pas connu. */
export function numeroDuLot(titre: string, numeros: Map<string, string>): string {
  return numeros.get(norm(titre)) ?? '';
}

/**
 * Compare deux numéros de lot comme un humain : « 2 » avant « 10 », « 01 » avant « 01A » avant « 02 »,
 * « 01.2 » avant « 01.10 ». Un numéro vide passe après tous les autres.
 */
export function comparerNumerosLot(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
}

type AvecLots = { lots?: unknown; entreprises?: unknown };

/** Numéro du premier lot connu d'une réserve, '' sinon. */
export function numeroLotReserve(r: AvecLots, numeros: Map<string, string>): string {
  for (const lot of parseJsonList(r.lots)) {
    const numero = numeroDuLot(lot, numeros);
    if (numero) return numero;
  }
  return '';
}

/** Clé de regroupement du tableau : les lots, puis les entreprises en charge. Stable, sert à replier un groupe. */
export function cleGroupe(r: AvecLots): string {
  const lots = parseJsonList(r.lots);
  const entreprises = parseJsonList(r.entreprises);
  return lots.length > 0 ? `${lots.join(', ')} / ${entreprises.join(', ')}` : GROUPE_SANS_LOT;
}

/** Libellé affiché d'un groupe : « 03 · PLATRERIE / Entreprise Martin », sans barre finale quand aucune entreprise n'est désignée. */
export function libelleGroupe(r: AvecLots, numeros: Map<string, string>): string {
  const lots = parseJsonList(r.lots);
  if (lots.length === 0) return GROUPE_SANS_LOT;
  const entreprises = parseJsonList(r.entreprises);
  const titres = lots.map(lot => {
    const numero = numeroDuLot(lot, numeros);
    return numero ? `${numero} · ${lot}` : lot;
  }).join(', ');
  return entreprises.length > 0 ? `${titres} / ${entreprises.join(', ')}` : titres;
}

/** Les groupes du tableau (clé, lignes) dans l'ordre des numéros de lot ; les groupes sans numéro puis sans lot en dernier. */
export function trierGroupes<T extends AvecLots>(groupes: [string, T[]][], numeros: Map<string, string>): [string, T[]][] {
  const rang = (g: [string, T[]]) => {
    const premiere = g[1][0];
    return {
      sansLot: g[0] === GROUPE_SANS_LOT,
      numero: premiere ? numeroLotReserve(premiere, numeros) : '',
      libelle: premiere ? libelleGroupe(premiere, numeros) : g[0],
    };
  };
  return groupes
    .map(g => ({ g, r: rang(g) }))
    .sort((a, b) => {
      if (a.r.sansLot !== b.r.sansLot) return a.r.sansLot ? 1 : -1;
      return comparerNumerosLot(a.r.numero, b.r.numero) || a.r.libelle.localeCompare(b.r.libelle, 'fr', { numeric: true });
    })
    .map(x => x.g);
}

/** Classe des réserves par numéro de lot puis par numéro de réserve (liste à plat de la vue par plan). */
export function trierParLot<T extends AvecLots & { number?: number | null }>(rows: T[], numeros: Map<string, string>): T[] {
  return [...rows].sort((a, b) =>
    comparerNumerosLot(numeroLotReserve(a, numeros), numeroLotReserve(b, numeros))
    || (a.number || 0) - (b.number || 0));
}

/** Vrai quand la réserve relève du lot demandé (intitulé), ou n'en a aucun pour `SANS_LOT_FILTRE`. Sans filtre, toujours vrai. */
export function correspondAuLot(r: AvecLots, lot: string): boolean {
  if (!lot) return true;
  const lots = parseJsonList(r.lots);
  if (lot === SANS_LOT_FILTRE) return lots.length === 0;
  const cible = norm(lot);
  return lots.some(l => norm(l) === cible);
}

export interface ChoixLot { value: string; label: string; count: number }

/**
 * Les lots proposés par le filtre : ceux qui portent au moins une réserve, classés par numéro, avec leur
 * effectif. Un lot présent dans les réserves mais absent de la liste de l'affaire reste proposé (sans numéro,
 * en fin de liste) : le masquer rendrait ses réserves introuvables par le filtre.
 */
export function choixDeLots(reserves: AvecLots[], lots: LotRef[] | undefined | null): ChoixLot[] {
  const compte = new Map<string, { titre: string; count: number }>();
  for (const r of reserves) {
    for (const titre of new Set(parseJsonList(r.lots).map(l => l.trim()).filter(Boolean))) {
      const cle = norm(titre);
      const existant = compte.get(cle);
      if (existant) existant.count += 1; else compte.set(cle, { titre, count: 1 });
    }
  }
  const numeros = numerosParLot(lots);
  const officiel = new Map<string, string>();
  for (const lot of lots ?? []) officiel.set(norm(lot.lot_title || ''), lot.lot_title);
  return [...compte.entries()]
    .map(([cle, { titre, count }]) => {
      const intitule = officiel.get(cle) ?? titre;
      const numero = numeros.get(cle) ?? '';
      return { value: intitule, label: numero ? `${numero} · ${intitule}` : intitule, count, numero };
    })
    .sort((a, b) => comparerNumerosLot(a.numero, b.numero) || a.label.localeCompare(b.label, 'fr', { numeric: true }))
    .map(({ numero: _numero, ...choix }) => choix);
}

/**
 * La réserve voisine dans une liste ordonnée : `delta` -1 (précédente) ou +1 (suivante). Rend null aux
 * extrémités, et quand la réserve n'est pas dans la liste (filtrée entre-temps) : la position est alors inconnue.
 */
export function voisine<T extends { id: string }>(liste: T[], id: string | null | undefined, delta: -1 | 1): T | null {
  if (!id) return null;
  const index = liste.findIndex(r => r.id === id);
  if (index < 0) return null;
  return liste[index + delta] ?? null;
}
