// ── Comparatif des prix unitaires (ACT, phase « Collecte des offres ») ───────
// Logique pure, sans React : elle lit un lot du document de référence (DPGF ou
// bordereau) et les offres des entreprises, et produit ce que l'écran affiche
// côte à côte, article par article, avec l'estimation du document.
//
// Deux modes de saisie par couple lot x entreprise :
//   - `total`  : l'architecte saisit le montant du lot (Offre.montant_base) ;
//   - `postes` : les prix unitaires sont saisis ou importés poste par poste
//                (OffreDocument.prix) et le total du lot EN DÉCOULE. Il n'est
//                jamais saisi : un total tapé et des prix tapés se
//                contrediraient sans que rien ne le dise.
import type { Lot, Ligne, OffreDocument, PosteAjoute } from '../types/dpgf';
import { versComparatif, type ComparatifLot } from './bpuToAct';
import { montantPoste } from './postesAjoutes';

export type ModeSaisie = 'total' | 'postes';

/** Écart (en %) au-delà duquel un prix unitaire est signalé par rapport à l'estimation. */
export const SEUIL_ECART_PCT = 15;
/** Seuil du filtre « écarts importants » de l'écran. */
export const SEUIL_FILTRE_PCT = 10;

/** Un prix : un nombre, `null` pour mémoire, `undefined` non chiffré. */
export type PrixSaisi = number | null | undefined;

export interface EntrepriseComparee {
  id: string;
  nom: string;
  mode: ModeSaisie;
  /** Montant saisi du lot (mode `total`). */
  totalSaisi: number;
}

export interface LigneComparee {
  id: string;
  code: string;
  titre: string;
  unite: string;
  quantite: number;
  /** Prix unitaire estimé du document de référence. */
  estimation: number;
  /** Hors base (option, PSE, variante) : comparée mais jamais comptée dans les totaux. */
  horsBase: boolean;
  prix: Record<string, PrixSaisi>;
  /** Plus bas prix unitaire chiffré (au moins deux entreprises en comparaison). */
  meilleur: number | null;
  mediane: number | null;
}

export interface ChapitreCompare {
  id: string;
  code: string;
  titre: string;
  lignes: LigneComparee[];
}

export interface AjoutCompare {
  id: string;
  code: string;
  titre: string;
  unite: string;
  quantite: number;
  entrepriseId: string;
  entrepriseNom: string;
  prixUnitaire: number | null;
  montant: number;
}

export interface LotCompare {
  chapitres: ChapitreCompare[];
  ajouts: AjoutCompare[];
  /** Total estimé du lot (base seulement). */
  estimationTotale: number;
  /** Total HT par entreprise ; null tant que rien n'est chiffré. */
  totaux: Record<string, number | null>;
  /** Postes « pour mémoire » non comptés, par entreprise. */
  pourMemoire: Record<string, number>;
  /** Rang par total croissant (1 = moins-disant) ; null sans total. */
  rangs: Record<string, number | null>;
}

// ── Lecture du document ──────────────────────────────────────────────────────

const estChiffrable = (l: Ligne) => l.type !== 'titre' && l.type !== 'commentaire' && l.type !== 'sous-total' && !l.cctpOnly;
const estHorsBase = (l: Ligne) => !!l.nature && l.nature !== 'base';

/** Articles feuilles chiffrables d'un lot, dans l'ordre du document, rangés par chapitre. */
export function chapitresDuLot(lot: Lot): { id: string; numero: string; titre: string; lignes: Ligne[] }[] {
  const feuilles = (lignes: Ligne[], horsBaseParent = false): Ligne[] => lignes.flatMap(l => {
    if (l.cctpOnly) return [];
    const hb = horsBaseParent || estHorsBase(l);
    if (l.children?.length) return feuilles(l.children, hb);
    if (!estChiffrable(l)) return [];
    // Une nature portée par un article parent vaut pour tout son contenu.
    return [hb && !estHorsBase(l) ? { ...l, nature: 'option' as const } : l];
  });
  return lot.chapitres
    .filter(c => !c.cctpOnly)
    .map(c => ({ id: c.id, numero: c.numero, titre: c.titre, lignes: feuilles(c.lignes) }))
    .filter(c => c.lignes.length > 0);
}

export function mediane(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  const s = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Écart du prix à l'estimation, en %. Null sans estimation exploitable. */
export function ecartPct(prix: number, estimation: number): number | null {
  return estimation > 0 ? ((prix - estimation) / estimation) * 100 : null;
}

export type NiveauEcart = 'normal' | 'haut' | 'bas';
export function niveauEcart(pct: number | null, seuil = SEUIL_ECART_PCT): NiveauEcart {
  if (pct == null) return 'normal';
  if (pct > seuil) return 'haut';
  if (pct < -seuil) return 'bas';
  return 'normal';
}

// ── Prix d'une entreprise (plusieurs fichiers possibles) ─────────────────────

const retenue = (o: OffreDocument, entrepriseId: string) => o.entrepriseId === entrepriseId && o.statut !== 'ecartee';

/**
 * Prix d'une entreprise sur tout le document. Une entreprise peut avoir remis
 * plusieurs fichiers (un par lot, une correction) : on les superpose dans
 * l'ordre d'import, le plus récent l'emporte sur un même article.
 */
export function prixEntreprise(offres: OffreDocument[], entrepriseId: string): Record<string, PrixSaisi> {
  const out: Record<string, PrixSaisi> = {};
  const docs = offres.filter(o => retenue(o, entrepriseId))
    .sort((a, b) => (a.importedAt || '').localeCompare(b.importedAt || ''));
  for (const o of docs) for (const [id, pu] of Object.entries(o.prix ?? {})) out[id] = pu;
  return out;
}

export function ajoutsEntreprise(offres: OffreDocument[], entrepriseId: string, lotId: string): PosteAjoute[] {
  return offres.filter(o => retenue(o, entrepriseId)).flatMap(o => (o.postesAjoutes ?? []).filter(p => p.lotId === lotId));
}

/** Total HT d'une entreprise sur un lot, d'après ses prix unitaires (base + postes ajoutés). */
export function totalLotPostes(lot: Lot, prix: Record<string, PrixSaisi>, ajouts: PosteAjoute[] = []): number | null {
  let total = 0;
  let chiffres = 0;
  for (const c of chapitresDuLot(lot)) {
    for (const l of c.lignes) {
      const pu = prix[l.id];
      if (typeof pu !== 'number') continue;
      chiffres++;
      if (!estHorsBase(l)) total += pu * (l.quantite || 0);
    }
  }
  for (const p of ajouts) {
    if (p.prixUnitaire != null) { chiffres++; total += montantPoste(p); }
  }
  return chiffres > 0 ? total : null;
}

/**
 * Mode effectif d'un couple lot x entreprise. Un mode enregistré l'emporte ;
 * sans lui (consultation antérieure, bordereau reçu par le portail de dépôt),
 * un montant saisi veut dire « total », des prix reçus veulent dire « postes ».
 */
export function modeEffectif(
  enregistre: ModeSaisie | undefined,
  montantBase: number,
  aDesPrixSurLeLot: boolean,
): ModeSaisie {
  if (enregistre) return enregistre;
  if (montantBase > 0) return 'total';
  return aDesPrixSurLeLot ? 'postes' : 'total';
}

export function aDesPrix(lot: Lot, prix: Record<string, PrixSaisi>): boolean {
  return chapitresDuLot(lot).some(c => c.lignes.some(l => typeof prix[l.id] === 'number'));
}

// ── Construction du comparatif d'un lot ──────────────────────────────────────

export function construireLot(lot: Lot, offres: OffreDocument[], entreprises: EntrepriseComparee[]): LotCompare {
  const parEntreprise = new Map(entreprises.map(e => [e.id, prixEntreprise(offres, e.id)]));
  const enPostes = entreprises.filter(e => e.mode === 'postes');

  const chapitres: ChapitreCompare[] = chapitresDuLot(lot).map(c => ({
    id: c.id, code: c.numero, titre: c.titre,
    lignes: c.lignes.map(l => {
      const prix: Record<string, PrixSaisi> = {};
      const chiffres: number[] = [];
      for (const e of enPostes) {
        const pu = parEntreprise.get(e.id)?.[l.id];
        prix[e.id] = pu;
        if (typeof pu === 'number') chiffres.push(pu);
      }
      return {
        id: l.id, code: l.numero, titre: l.designation, unite: l.unite, quantite: l.quantite || 0,
        estimation: l.prixUnitaire || 0, horsBase: estHorsBase(l), prix,
        meilleur: chiffres.length > 1 ? Math.min(...chiffres) : null,
        mediane: chiffres.length > 1 ? mediane(chiffres) : null,
      };
    }),
  }));

  const ajouts: AjoutCompare[] = enPostes.flatMap(e =>
    ajoutsEntreprise(offres, e.id, lot.id).map(p => ({
      id: p.id, code: p.numero, titre: p.designation, unite: p.unite, quantite: p.quantite ?? 1,
      entrepriseId: e.id, entrepriseNom: e.nom, prixUnitaire: p.prixUnitaire, montant: montantPoste(p),
    })));

  const estimationTotale = chapitres.reduce(
    (s, c) => s + c.lignes.reduce((t, l) => t + (l.horsBase ? 0 : l.estimation * l.quantite), 0), 0);

  const totaux: Record<string, number | null> = {};
  const pourMemoire: Record<string, number> = {};
  for (const e of entreprises) {
    if (e.mode === 'total') { totaux[e.id] = e.totalSaisi > 0 ? e.totalSaisi : null; continue; }
    const prix = parEntreprise.get(e.id) ?? {};
    totaux[e.id] = totalLotPostes(lot, prix, ajoutsEntreprise(offres, e.id, lot.id));
    pourMemoire[e.id] = chapitres.reduce((s, c) => s + c.lignes.filter(l => !l.horsBase && prix[l.id] === null).length, 0);
  }

  const classes = entreprises
    .filter(e => totaux[e.id] != null && (totaux[e.id] as number) > 0)
    .sort((a, b) => (totaux[a.id] as number) - (totaux[b.id] as number));
  const rangs: Record<string, number | null> = {};
  for (const e of entreprises) {
    const i = classes.findIndex(c => c.id === e.id);
    rangs[e.id] = i < 0 ? null : i + 1;
  }

  return { chapitres, ajouts, estimationTotale, totaux, pourMemoire, rangs };
}

/** Une ligne qui sort du lot : un écart supérieur au seuil, ou un poste laissé pour mémoire. */
export function ligneEnEcart(l: LigneComparee, entreprises: EntrepriseComparee[], seuil = SEUIL_FILTRE_PCT): boolean {
  return entreprises.some(e => {
    if (e.mode !== 'postes') return false;
    const pu = l.prix[e.id];
    if (pu === null) return true;
    if (typeof pu !== 'number') return false;
    const pct = ecartPct(pu, l.estimation);
    return pct != null && Math.abs(pct) > seuil;
  });
}

// ── Passage au comparatif enregistré dans la consultation ────────────────────
// L'analyse, la négociation et l'export Excel lisent `consultation.comparatif`
// (des montants par article). Il se déduit désormais des offres : un lot
// rattaché au document en vient, un lot sans document garde sa saisie manuelle.

export function comparatifDepuisOffres(
  lotsDocument: Lot[],
  offres: OffreDocument[],
  /** Entreprises d'un lot du projet (project_lots.id), chacune avec son mode de saisie. */
  entreprisesDuLot: (projectLotId: string) => EntrepriseComparee[],
  existant: ComparatifLot[] = [],
): ComparatifLot[] {
  const sortie: ComparatifLot[] = [];
  const faits = new Set<string>();

  for (const lot of lotsDocument) {
    if (!lot.projectLotId) continue;
    const entreprises = entreprisesDuLot(lot.projectLotId);
    // Une entreprise saisie au total n'a pas de détail : ses fichiers éventuels ne comptent pas.
    const enPostes = new Set(entreprises.filter(e => e.mode === 'postes').map(e => e.id));
    const { comparatif } = versComparatif([lot], offres.filter(o => o.entrepriseId && enPostes.has(o.entrepriseId)));
    const c = comparatif[0];
    if (!c) continue;
    const articles = c.articles.map(a => (a.is_subtotal ? { ...a, prix: { ...a.prix } } : a));
    const sousTotal = articles.find(a => a.is_subtotal);
    if (sousTotal) {
      for (const e of entreprises) if (e.mode === 'total' && e.totalSaisi > 0) sousTotal.prix[e.id] = e.totalSaisi;
    }
    sortie.push({ ...c, articles });
    faits.add(c.lot_id);
  }
  for (const ancien of existant) if (!faits.has(ancien.lot_id)) sortie.push(ancien);
  return sortie;
}
