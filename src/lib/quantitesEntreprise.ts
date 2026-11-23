// ── Quantités proposées par les entreprises (colonne « quantité entreprise ») ──
// Une entreprise peut chiffrer sur d'autres quantités que celles du document de référence (DPGF ou
// DQE). Elle les remet dans son OFFRE (`OffreDocument.quantites`, article -> quantité) : le document
// n'est JAMAIS modifié, comme pour les prix. Rien n'est stocké quand l'entreprise reprend la quantité
// du maître d'œuvre : une absence veut dire « même quantité ».
//
// Deux bases de comparaison, au choix de l'architecte (`BaseQuantites`) :
//   - `moe`        : les quantités du maître d'œuvre, SAUF celles que l'architecte a ACCEPTÉES pour cette
//                    entreprise (la quantité acceptée modifie l'offre, pas le document) ;
//   - `entreprise` : les quantités de chaque entreprise telles qu'elle les a remises.
// L'alerte ne connaît aucun seuil : la moindre différence est signalée, à la virgule près (seul le bruit
// des nombres flottants est écarté).
//
// Une quantité ne se compare que sur un poste qui en porte une : un bordereau de prix (BPU) n'en a pas,
// le DQE (bordereau avec quantités estimatives) et le DPGF en ont.
import type { Lot, OffreDocument, PosteAjoute } from '../types/dpgf';
import {
  ajoutsEntreprise, chapitresDuLot, construireLot, estHorsBase, prixEntreprise,
  type EntrepriseComparee, type LotCompare, type PrixSaisi,
} from './comparatifPrix';
import { montantPoste } from './postesAjoutes';

export type BaseQuantites = 'moe' | 'entreprise';

export const LIBELLE_BASE: Record<BaseQuantites, string> = {
  moe: 'Quantités du maître d\'œuvre',
  entreprise: 'Quantités de chaque entreprise',
};

/** Précision de comparaison : au-dessous, c'est du bruit de calcul flottant, pas une différence. */
const EPSILON = 1e-9;

/** Deux quantités diffèrent-elles ? À la virgule près : aucun seuil de tolérance. */
export function quantitesDifferent(a: number, b: number): boolean {
  return Math.abs(a - b) > EPSILON;
}

const retenue = (o: OffreDocument, entrepriseId: string) => o.entrepriseId === entrepriseId && o.statut !== 'ecartee';

/** Quantités d'une entreprise sur tout le document ; l'offre la plus récente l'emporte sur un même article. */
export function quantitesEntreprise(offres: OffreDocument[], entrepriseId: string): Record<string, number> {
  const out: Record<string, number> = {};
  const docs = offres.filter(o => retenue(o, entrepriseId)).sort((a, b) => (a.importedAt || '').localeCompare(b.importedAt || ''));
  for (const o of docs) for (const [id, q] of Object.entries(o.quantites ?? {})) {
    if (typeof q === 'number' && Number.isFinite(q)) out[id] = q;
  }
  return out;
}

/** Articles dont l'architecte a accepté la quantité de l'entreprise (au plus récent état de ses offres). */
export function quantitesAcceptees(offres: OffreDocument[], entrepriseId: string): Set<string> {
  const docs = offres.filter(o => retenue(o, entrepriseId)).sort((a, b) => (a.importedAt || '').localeCompare(b.importedAt || ''));
  const acceptees = new Set<string>();
  for (const o of docs) {
    // Une offre qui reçoit de nouvelles quantités redonne la main : seuls ses propres articles sont gérés.
    for (const id of Object.keys(o.quantites ?? {})) acceptees.delete(id);
    for (const id of o.quantitesAcceptees ?? []) acceptees.add(id);
  }
  return acceptees;
}

/** Quantité utilisée pour un article dans une base donnée. */
export function quantiteRetenue(
  base: BaseQuantites, quantiteMoe: number, articleId: string,
  quantites: Record<string, number>, acceptees: ReadonlySet<string>,
): number {
  const q = quantites[articleId];
  if (typeof q !== 'number') return quantiteMoe;
  return base === 'entreprise' || acceptees.has(articleId) ? q : quantiteMoe;
}

export interface EcartQuantite {
  ligneId: string;
  code: string;
  titre: string;
  unite: string;
  quantiteMoe: number;
  quantiteEntreprise: number;
  /** quantité entreprise - quantité du MOE. */
  ecart: number;
  prixUnitaire: number | null;
  /** Effet sur le montant du lot : écart x prix unitaire ; null sans prix chiffré. Nul pour un poste hors base. */
  impact: number | null;
  horsBase: boolean;
  acceptee: boolean;
}

/**
 * Les quantités que l'entreprise a changées sur un lot, du plus lourd au plus léger en euros (les postes
 * sans prix en dernier). Un poste sans quantité au document n'est pas comparé.
 */
export function ecartsQuantites(
  lot: Lot, prix: Record<string, PrixSaisi>, quantites: Record<string, number>, acceptees: ReadonlySet<string>,
): EcartQuantite[] {
  const ecarts: EcartQuantite[] = [];
  for (const c of chapitresDuLot(lot)) {
    for (const l of c.lignes) {
      const q = quantites[l.id];
      const moe = l.quantite || 0;
      if (typeof q !== 'number' || moe <= 0 || !quantitesDifferent(q, moe)) continue;
      const pu = typeof prix[l.id] === 'number' ? (prix[l.id] as number) : null;
      const horsBase = estHorsBase(l);
      ecarts.push({
        ligneId: l.id, code: l.numero, titre: l.designation, unite: l.unite,
        quantiteMoe: moe, quantiteEntreprise: q, ecart: q - moe, prixUnitaire: pu,
        impact: pu != null && !horsBase ? (q - moe) * pu : null, horsBase, acceptee: acceptees.has(l.id),
      });
    }
  }
  return ecarts.sort((a, b) => {
    if ((a.impact == null) !== (b.impact == null)) return a.impact == null ? 1 : -1;
    return Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0) || a.code.localeCompare(b.code, 'fr', { numeric: true });
  });
}

/** Total HT d'une entreprise sur un lot dans une base de quantités (base + postes ajoutés, options exclues). */
export function totalLotQuantites(
  lot: Lot, prix: Record<string, PrixSaisi>, ajouts: PosteAjoute[],
  base: BaseQuantites, quantites: Record<string, number>, acceptees: ReadonlySet<string>,
): number | null {
  let total = 0;
  let chiffres = 0;
  for (const c of chapitresDuLot(lot)) {
    for (const l of c.lignes) {
      const pu = prix[l.id];
      if (typeof pu !== 'number') continue;
      chiffres++;
      if (!estHorsBase(l)) total += pu * quantiteRetenue(base, l.quantite || 0, l.id, quantites, acceptees);
    }
  }
  for (const p of ajouts) if (p.prixUnitaire != null) { chiffres++; total += montantPoste(p); }
  return chiffres > 0 ? total : null;
}

/**
 * Ne garde que les quantités qui DIFFÈRENT de celles du document : une quantité reprise à l'identique
 * n'est pas stockée (l'absence veut dire « même quantité »), et une quantité sur un poste sans quantité non plus.
 */
export function quantitesUtiles(
  saisies: Record<string, number | null | undefined>, quantiteMoeParArticle: ReadonlyMap<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, q] of Object.entries(saisies)) {
    const moe = quantiteMoeParArticle.get(id);
    if (typeof q !== 'number' || !Number.isFinite(q) || q < 0 || moe == null || moe <= 0) continue;
    if (quantitesDifferent(q, moe)) out[id] = q;
  }
  return out;
}

/** Synthèse d'une entreprise : combien de quantités changées, effet total, et lesquelles sont acceptées. */
export function syntheseEcarts(ecarts: EcartQuantite[]) {
  return {
    nombre: ecarts.length,
    acceptees: ecarts.filter(e => e.acceptee).length,
    impactTotal: ecarts.reduce((s, e) => s + (e.impact ?? 0), 0),
    sansPrix: ecarts.filter(e => e.impact == null && !e.horsBase).length,
  };
}

/** Le comparatif d'un lot, avec les deux totaux possibles et les quantités changées par chaque entreprise. */
export interface LotCompareQuantites extends LotCompare {
  base: BaseQuantites;
  /** Total HT par entreprise sur les quantités du MOE (sauf quantités acceptées) ; null sans prix. */
  totauxMoe: Record<string, number | null>;
  /** Total HT par entreprise sur ses propres quantités. */
  totauxEntreprise: Record<string, number | null>;
  /** Quantités changées par entreprise, du plus lourd en euros au plus léger. */
  ecarts: Record<string, EcartQuantite[]>;
  /** Par article, les quantités qui diffèrent du document (entreprise -> quantité). */
  quantitesParLigne: Record<string, Record<string, number>>;
}

/**
 * `construireLot` avec la base de quantités choisie : le total, donc le rang, d'une entreprise « poste par
 * poste » suit la base. Une entreprise saisie au total n'a pas de quantités et reste telle quelle.
 */
export function construireLotQuantites(
  lot: Lot, offres: OffreDocument[], entreprises: EntrepriseComparee[], base: BaseQuantites = 'moe',
): LotCompareQuantites {
  const data = construireLot(lot, offres, entreprises);
  const totauxMoe: Record<string, number | null> = { ...data.totaux };
  const totauxEntreprise: Record<string, number | null> = { ...data.totaux };
  const ecarts: Record<string, EcartQuantite[]> = {};
  const quantitesParLigne: Record<string, Record<string, number>> = {};

  for (const e of entreprises) {
    if (e.mode !== 'postes') continue;
    const prix = prixEntreprise(offres, e.id);
    const quantites = quantitesEntreprise(offres, e.id);
    const acceptees = quantitesAcceptees(offres, e.id);
    const ajouts = ajoutsEntreprise(offres, e.id, lot.id);
    totauxMoe[e.id] = totalLotQuantites(lot, prix, ajouts, 'moe', quantites, acceptees);
    totauxEntreprise[e.id] = totalLotQuantites(lot, prix, ajouts, 'entreprise', quantites, acceptees);
    ecarts[e.id] = ecartsQuantites(lot, prix, quantites, acceptees);
    for (const ec of ecarts[e.id]) (quantitesParLigne[ec.ligneId] ??= {})[e.id] = ec.quantiteEntreprise;
  }

  const totaux = base === 'entreprise' ? totauxEntreprise : totauxMoe;
  const classes = entreprises
    .filter(e => totaux[e.id] != null && (totaux[e.id] as number) > 0)
    .sort((a, b) => (totaux[a.id] as number) - (totaux[b.id] as number));
  const rangs: Record<string, number | null> = {};
  for (const e of entreprises) {
    const i = classes.findIndex(c => c.id === e.id);
    rangs[e.id] = i < 0 ? null : i + 1;
  }
  return { ...data, totaux, rangs, base, totauxMoe, totauxEntreprise, ecarts, quantitesParLigne };
}
