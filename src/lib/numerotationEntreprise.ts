// Numérotation PAR ENTREPRISE des ordres de service et des fiches de travaux
// modificatifs (FTM) : chaque entreprise a sa propre suite (OS 001, 002... pour
// Durand, OS 001... pour Petit). Un OS ou une FTM adressé à plusieurs entreprises
// porte un numéro dans la suite de CHACUNE (`numeros_entreprises`), et la colonne
// texte (`os_number`, `numero`) en est le résumé affichable (« 002 / 001 »).
// Partagé par le serveur (attribution) et l'écran (aperçu).

export interface NumeroEntreprise {
  marche_id: string;
  /** Numéro du lot du marché visé (« 01 »), repris dans le numéro des FTM. */
  lot?: string;
  /** Clé stable de l'entreprise : fiche contact, à défaut son nom normalisé. */
  cle: string;
  entreprise: string;
  numero: number;
}

export interface MarcheEntreprise {
  id: string;
  lot_numero?: string | null;
  contact_id?: string | null;
  entreprise_nom?: string | null;
}

/** Une ligne déjà numérotée (OS ou FTM), lue telle qu'en base. */
export interface LigneNumerotee {
  marche_id?: string | null;
  marche_ids?: unknown;
  numeros_entreprises?: unknown;
}

/** Clé d'une entreprise : sa fiche contact, sinon son nom (casse, accents et espaces ignorés). */
export function cleEntreprise(m: Pick<MarcheEntreprise, 'contact_id' | 'entreprise_nom'>): string {
  if (m.contact_id) return `c:${m.contact_id}`;
  const nom = String(m.entreprise_nom ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `n:${nom}`;
}

/** Numéro de lot normalisé pour un numéro de FTM : « 1 » devient « 01 », « 01A » reste « 01A », absent « 00 ». */
export function lotPourNumero(lot?: string | null): string {
  const l = String(lot ?? '').trim().replace(/[^A-Za-z0-9.]/g, '');
  if (!l) return '00';
  return /^\d+$/.test(l) ? l.padStart(2, '0') : l.toUpperCase();
}

/** Clé d'une suite par entreprise ET par lot (FTM) : FTM-01-01 pour le lot 01, FTM-02-01 pour le lot 02. */
export function cleEntrepriseLot(m: Pick<MarcheEntreprise, 'contact_id' | 'entreprise_nom' | 'lot_numero'>): string {
  return `${cleEntreprise(m)}|${lotPourNumero(m.lot_numero)}`;
}

export const CLE_SANS_ENTREPRISE = 'aucune';

/** Les entreprises distinctes d'une liste de marchés, dans l'ordre : deux lots d'une même entreprise n'en font qu'une. */
export function entreprisesDistinctes(
  marches: MarcheEntreprise[],
  cleDe: (m: MarcheEntreprise) => string = cleEntreprise,
): Array<{ marche_id: string; lot: string; cle: string; entreprise: string }> {
  const vues = new Set<string>();
  const out: Array<{ marche_id: string; lot: string; cle: string; entreprise: string }> = [];
  for (const m of marches) {
    const cle = cleDe(m);
    if (vues.has(cle)) continue;
    vues.add(cle);
    out.push({ marche_id: m.id, lot: lotPourNumero(m.lot_numero), cle, entreprise: String(m.entreprise_nom ?? '') });
  }
  return out;
}

const lireNumeros = (v: unknown): NumeroEntreprise[] =>
  Array.isArray(v) ? v.filter((x: any) => x && typeof x.cle === 'string' && Number.isFinite(Number(x.numero))).map((x: any) => ({ ...x, numero: Number(x.numero) })) : [];

/**
 * Plus grand numéro déjà attribué à une entreprise. Une ligne sans `numeros_entreprises`
 * (antérieure à ce mode) compte pour chacune des entreprises de ses marchés, avec son
 * numéro unique (`numeroHerite`, lu dans sa colonne texte).
 */
export function numeroMaxEntreprise(
  lignes: LigneNumerotee[],
  cle: string,
  cleDuMarche: (marcheId: string) => string | undefined,
  numeroHerite: (ligne: LigneNumerotee) => number,
): number {
  let max = 0;
  for (const l of lignes) {
    const numeros = lireNumeros(l.numeros_entreprises);
    if (numeros.length) {
      for (const n of numeros) if (n.cle === cle && n.numero > max) max = n.numero;
      continue;
    }
    const ids = [l.marche_id, ...(Array.isArray(l.marche_ids) ? l.marche_ids : [])].filter((x): x is string => typeof x === 'string' && !!x);
    if (ids.some(id => cleDuMarche(id) === cle)) max = Math.max(max, numeroHerite(l) || 0);
  }
  return max;
}

/** Le numéro suivant de chaque entreprise visée (une seule entrée par entreprise). */
export function attribuerNumeros(
  lignes: LigneNumerotee[],
  entreprises: Array<{ marche_id: string; lot?: string; cle: string; entreprise: string }>,
  cleDuMarche: (marcheId: string) => string | undefined,
  numeroHerite: (ligne: LigneNumerotee) => number,
): NumeroEntreprise[] {
  return entreprises.map(e => ({ ...e, numero: numeroMaxEntreprise(lignes, e.cle, cleDuMarche, numeroHerite) + 1 }));
}

/** Résumé affichable : « 002 » pour une entreprise, « 002 / 001 » pour plusieurs (même ordre que les noms). */
export function resumeNumeros(numeros: NumeroEntreprise[], formater: (n: number, entree: NumeroEntreprise) => string): string {
  return numeros.map(n => formater(n.numero, n)).join(' / ');
}

/** « 01-002 » : lot 01, deuxième OS de l'entreprise sur ce lot. Sans lot connu (aperçu à l'affaire) : « 002 ». */
export const formatNumeroOs = (n: number, entree?: Pick<NumeroEntreprise, 'lot'>): string =>
  entree ? `${lotPourNumero(entree.lot)}-${String(n).padStart(3, '0')}` : String(n).padStart(3, '0');
/** « FTM-01-02 » : lot 01, deuxième fiche de ce lot (sans lot : « FTM-00-02 »). */
export const formatNumeroFtm = (n: number, entree?: Pick<NumeroEntreprise, 'lot'>): string =>
  `FTM-${lotPourNumero(entree?.lot)}-${String(n).padStart(2, '0')}`;

/** Numéro lu dans la colonne texte d'un OS : dernier groupe de chiffres du premier numéro (« 004 » : 4, « 01-002 / 02-001 » : 2). */
export const numeroHeriteOs = (l: LigneNumerotee & { os_number?: unknown }): number => {
  const m = String(l.os_number ?? '').split('/')[0].match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
};
/** Numéro lu dans la colonne texte d'une FTM : le dernier groupe de chiffres du premier numéro (« FTM-01-02 » : 2). */
export const numeroHeriteFtm = (l: LigneNumerotee & { numero?: unknown }): number => {
  const premier = String(l.numero ?? '').split('/')[0];
  const m = premier.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
};
