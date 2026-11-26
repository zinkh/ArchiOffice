// Brouillon local d'un document de l'espace PRO (CCTP / DPGF, BPU) : ce qui a été saisi et n'est pas
// encore enregistré sur le serveur.
//
// Pourquoi un emplacement à part : la copie locale « miroir » (`lsKey`) est réécrite avec la version du
// serveur à chaque chargement. Quand l'enregistrement échouait ou restait en attente (jeton expiré,
// réseau, panne) puis qu'on rechargeait la page, la saisie non envoyée était donc écrasée sans rien dire.
// Le brouillon, lui, n'est effacé que par un enregistrement réussi ou par un choix explicite de la personne.
//
// Deux emplacements par document :
//  - `<lsKey>:brouillon` : la saisie en cours, écrite à chaque modification non enregistrée ;
//  - `<lsKey>:recupere`  : un brouillon retrouvé au chargement, mis à l'abri pour que la première
//    frappe suivante n'écrase pas le brouillon courant, en attendant le choix de la personne.
// Le stockage est injecté pour tester la logique sans navigateur.

export interface Brouillon<T> {
  /** Instant de la dernière écriture (ms depuis 1970). */
  enregistreLe: number;
  doc: T;
}

export interface Stockage {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
  removeItem(cle: string): void;
}

export const cleBrouillon = (lsKey: string): string => `${lsKey}:brouillon`;
export const cleRecupere = (lsKey: string): string => `${lsKey}:recupere`;

function stockageParDefaut(): Stockage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function lireBrouillon<T>(cle: string, stockage: Stockage | null = stockageParDefaut()): Brouillon<T> | null {
  if (!stockage) return null;
  try {
    const brut = stockage.getItem(cle);
    if (!brut) return null;
    const lu = JSON.parse(brut) as Partial<Brouillon<T>> | null;
    if (!lu || typeof lu !== 'object' || lu.doc == null || typeof lu.enregistreLe !== 'number') return null;
    return { enregistreLe: lu.enregistreLe, doc: lu.doc as T };
  } catch { return null; }
}

/**
 * Écrit le brouillon. `json` est le document déjà sérialisé (une seule sérialisation par modification :
 * le document d'un CCTP dépasse 300 Ko). Rend faux si le stockage est plein ou indisponible, pour que
 * l'appelant le sache au lieu de croire la saisie protégée.
 */
export function ecrireBrouillon(cle: string, json: string, maintenant: number = Date.now(), stockage: Stockage | null = stockageParDefaut()): boolean {
  if (!stockage) return false;
  try {
    stockage.setItem(cle, `{"enregistreLe":${maintenant},"doc":${json}}`);
    return true;
  } catch { return false; }
}

export function effacerBrouillon(cle: string, stockage: Stockage | null = stockageParDefaut()): void {
  try { stockage?.removeItem(cle); } catch { /* stockage indisponible */ }
}

export interface RapprochementBrouillons<T> {
  /** Le brouillon à proposer à la personne (le plus récent qui diffère du serveur), sinon null. */
  aProposer: Brouillon<T> | null;
  /** Les autres brouillons différents du serveur : à figer dans l'historique avant d'être oubliés. */
  ecartes: Brouillon<T>[];
}

/**
 * Compare les brouillons laissés par une session précédente à la version qui vient d'être lue sur le
 * serveur. Un brouillon identique au serveur ne contient rien à récupérer ; parmi les autres, le plus
 * récent est proposé, les plus anciens sont rendus pour être figés.
 */
export function rapprocherBrouillons<T>(serveurJson: string, brouillons: Array<Brouillon<T> | null>): RapprochementBrouillons<T> {
  const differents = brouillons
    .filter((b): b is Brouillon<T> => b !== null)
    .filter(b => JSON.stringify(b.doc) !== serveurJson)
    .sort((a, b) => b.enregistreLe - a.enregistreLe);
  return { aProposer: differents[0] ?? null, ecartes: differents.slice(1) };
}

/** Délai avant la nouvelle tentative après `echecs` échecs d'affilée : 5 s, 10 s, 20 s, puis 30 s au plus. */
export function delaiNouvelEssai(echecs: number): number {
  return Math.min(30_000, 5_000 * 2 ** Math.max(0, echecs - 1));
}
