// ── Accords-cadres et marchés subséquents ────────────────────────────────────
// Logique pure (testée), partagée entre l'écran et le serveur : consommation du
// plafond, conditions d'émission d'un subséquent, contrôle des lignes de
// commande contre le bordereau de l'offre retenue. Pas d'accès réseau ici.
//
// Le contrôle définitif du plafond se fait en base, sous verrou
// (enregistrer_marche_subsequent) : ces fonctions servent à l'aperçu à l'écran
// et à la validation des lignes, jamais à autoriser une écriture seules.

import type { Lot, Ligne } from '../types/dpgf';

export type ModeExecution = 'bons_de_commande' | 'marches_subsequents' | 'mixte';
export type TypeMarche = 'marche' | 'accord_cadre' | 'subsequent';

/** Colonnes d'accord-cadre / de subséquent d'une ligne de marches_entreprises. */
export interface MarcheAccordCadreChamps {
  type_marche?: TypeMarche | null;
  parent_marche_id?: string | null;
  /** Accord-cadre à plusieurs titulaires : id de la ligne de tête qui porte les conditions communes. */
  accord_cadre_groupe_id?: string | null;
  numero_subsequent?: number | null;
  mode_execution?: ModeExecution | null;
  montant_mini_ht?: number | string | null;
  montant_maxi_ht?: number | string | null;
  date_fin_accord_cadre?: string | null;
  objet?: string | null;
  lignes_commande?: LigneCommande[] | null;
  date_notification?: string | null;
  statut?: string | null;
  statut_signature?: 'a_constituer' | 'a_signer' | 'signe' | null;
  mode_signature?: 'papier' | 'electronique' | null;
  date_signature?: string | null;
  offre_snapshot?: { prix?: Record<string, number | null> } | null;
}

/** Conditions d'un accord-cadre lues sur sa ligne de marché. */
export function conditionsDe(m: MarcheAccordCadreChamps): ConditionsAccordCadre {
  const lire = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    montantMiniHT: lire(m.montant_mini_ht),
    montantMaxiHT: lire(m.montant_maxi_ht),
    dateFin: m.date_fin_accord_cadre ? String(m.date_fin_accord_cadre).slice(0, 10) : null,
  };
}

/** Ligne de tête du groupe d'un accord-cadre (lui-même s'il est seul ou en tête). */
export function teteDuGroupe<T extends { id: string; accord_cadre_groupe_id?: string | null }>(m: T, tous: T[]): T {
  return m.accord_cadre_groupe_id ? tous.find(x => x.id === m.accord_cadre_groupe_id) ?? m : m;
}

/** Tous les titulaires d'un groupe (tête comprise), à partir de n'importe lequel d'entre eux. */
export function membresDuGroupe<T extends { id: string; type_marche?: TypeMarche | null; accord_cadre_groupe_id?: string | null }>(
  m: T, tous: T[],
): T[] {
  const teteId = m.accord_cadre_groupe_id ?? m.id;
  return tous.filter(x => x.type_marche === 'accord_cadre' && (x.id === teteId || x.accord_cadre_groupe_id === teteId));
}

/** Marchés subséquents émis par n'importe quel titulaire du groupe. */
export function subsequentsDuGroupe<T extends { parent_marche_id?: string | null }>(
  membres: { id: string }[], tous: T[],
): T[] {
  const ids = new Set(membres.map(x => x.id));
  return tous.filter(x => x.parent_marche_id && ids.has(x.parent_marche_id));
}

/** Article du bordereau d'un accord-cadre : un article du lot, au prix de l'offre retenue. */
export interface ArticleBordereau {
  articleId: string;
  numero: string;
  designation: string;
  unite: string;
  prixUnitaire: number;
}

/** Lot du DPGF qui correspond au numéro de lot d'un marché (« 2 » et « 02 » se valent). */
export function lotDuMarche(lots: Lot[] | undefined, lotNumero: string | null | undefined): Lot | undefined {
  const norme = (s: string) => s.trim().toUpperCase().replace(/^0+(?=\d)/, '');
  if (!lots || !lotNumero) return undefined;
  return lots.find(l => norme(l.numero) === norme(lotNumero));
}

/**
 * Articles commandables : les feuilles du lot dont l'offre figée donne un prix.
 * Les chapitres réservés au CCTP et les articles non chiffrés sont écartés.
 */
export function articlesDuBordereau(
  lot: Lot | undefined,
  prix: Record<string, number | null> | null | undefined,
): ArticleBordereau[] {
  if (!lot || !prix) return [];
  const resultat: ArticleBordereau[] = [];
  const parcourir = (lignes: Ligne[]) => {
    for (const l of lignes) {
      if (l.children?.length) { parcourir(l.children); continue; }
      const p = prix[l.id];
      if (typeof p !== 'number') continue;
      resultat.push({ articleId: l.id, numero: l.numero, designation: l.designation, unite: l.unite ?? '', prixUnitaire: p });
    }
  };
  for (const c of lot.chapitres) if (!c.cctpOnly) parcourir(c.lignes);
  return resultat;
}

export const LIBELLE_MODE_EXECUTION: Record<ModeExecution, string> = {
  bons_de_commande: 'Bons de commande',
  marches_subsequents: 'Marchés subséquents',
  mixte: 'Mixte (bons de commande et marchés subséquents)',
};

/** Seuil à partir duquel la consommation du plafond est signalée. */
export const SEUIL_PLAFOND_PROCHE_PCT = 80;

export interface ConditionsAccordCadre {
  montantMiniHT: number | null;
  montantMaxiHT: number | null;
  /** AAAA-MM-JJ */
  dateFin: string | null;
}

/** Ligne d'un marché subséquent : un article du bordereau, une quantité, le prix de l'offre. */
export interface LigneCommande {
  /** Identifiant de l'article, clé de `offre_snapshot.prix`. */
  articleId?: string;
  refBpu?: string;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
}

export interface SubsequentLu {
  montant_ht: number;
  statut?: string | null;
}

export type StatutConsommation = 'sans_plafond' | 'normal' | 'proche' | 'atteint' | 'depasse';

export interface Consommation {
  cumulHT: number;
  /** Reste avant le maxi, jamais négatif ; `null` sans plafond. */
  resteMaxiHT: number | null;
  pctMaxi: number | null;
  /** Reste à commander pour atteindre le minimum (0 si atteint) ; `null` sans minimum. */
  resteAuMiniHT: number | null;
  miniAtteint: boolean | null;
  statut: StatutConsommation;
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

export function montantLigne(l: Pick<LigneCommande, 'quantite' | 'prixUnitaire'>): number {
  return arrondi((Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0));
}

export function totalLignes(lignes: LigneCommande[]): number {
  return arrondi(lignes.reduce((s, l) => s + montantLigne(l), 0));
}

/** Un subséquent résilié ne consomme plus le plafond. */
export function compteDansLePlafond(s: SubsequentLu): boolean {
  return (s.statut ?? 'en_cours') !== 'resilie';
}

export function consommation(c: ConditionsAccordCadre, subsequents: SubsequentLu[]): Consommation {
  const cumulHT = arrondi(subsequents.filter(compteDansLePlafond).reduce((s, m) => s + (Number(m.montant_ht) || 0), 0));
  const maxi = c.montantMaxiHT;
  const mini = c.montantMiniHT;
  const pctMaxi = maxi && maxi > 0 ? Math.round((cumulHT / maxi) * 1000) / 10 : null;
  let statut: StatutConsommation = 'sans_plafond';
  if (maxi !== null && maxi > 0) {
    if (cumulHT > maxi) statut = 'depasse';
    else if (cumulHT === maxi) statut = 'atteint';
    else if ((pctMaxi ?? 0) >= SEUIL_PLAFOND_PROCHE_PCT) statut = 'proche';
    else statut = 'normal';
  }
  return {
    cumulHT,
    resteMaxiHT: maxi === null ? null : arrondi(Math.max(maxi - cumulHT, 0)),
    pctMaxi,
    resteAuMiniHT: mini === null ? null : arrondi(Math.max(mini - cumulHT, 0)),
    miniAtteint: mini === null ? null : cumulHT >= mini,
    statut,
  };
}

export type CodeRefus =
  | 'ACCORD_CADRE_NON_SIGNE'
  | 'ACCORD_CADRE_ECHU'
  | 'PLAFOND_DEPASSE'
  | 'MONTANT_INVALIDE';

export const MESSAGE_REFUS: Record<CodeRefus, string> = {
  ACCORD_CADRE_NON_SIGNE: "L'accord-cadre doit être signé avant d'émettre un marché subséquent.",
  ACCORD_CADRE_ECHU: "La date de notification dépasse la fin de l'accord-cadre.",
  PLAFOND_DEPASSE: "Ce marché subséquent dépasse le montant maximum de l'accord-cadre. Relevez-le par avenant.",
  MONTANT_INVALIDE: 'Le montant du marché subséquent est invalide.',
};

export type Emission = { ok: true } | { ok: false; code: CodeRefus; message: string };

/**
 * Aperçu des conditions d'émission, dans l'ordre où la base les vérifie.
 * `cumulAutresHT` exclut, en modification, le montant du subséquent édité.
 */
export function verifierEmission(args: {
  signe: boolean;
  conditions: ConditionsAccordCadre;
  cumulAutresHT: number;
  montantHT: number;
  dateNotification: string;
}): Emission {
  const refus = (code: CodeRefus): Emission => ({ ok: false, code, message: MESSAGE_REFUS[code] });
  if (!args.signe) return refus('ACCORD_CADRE_NON_SIGNE');
  if (!Number.isFinite(args.montantHT) || args.montantHT < 0) return refus('MONTANT_INVALIDE');
  const { dateFin, montantMaxiHT } = args.conditions;
  if (dateFin && args.dateNotification > dateFin) return refus('ACCORD_CADRE_ECHU');
  if (montantMaxiHT !== null && arrondi(args.cumulAutresHT + args.montantHT) > montantMaxiHT) return refus('PLAFOND_DEPASSE');
  return { ok: true };
}

const TOLERANCE_PRIX = 0.005;

export interface ResultatLignes {
  ok: boolean;
  erreurs: string[];
}

/**
 * Contrôle des lignes d'un subséquent : quantités et prix positifs ou nuls et,
 * quand l'offre retenue est figée, prix inférieur ou égal à celui du bordereau (une remise
 * en concurrence peut faire baisser un prix, jamais l'augmenter). Une ligne
 * absente du bordereau est refusée : un subséquent ne crée pas de prix nouveau.
 * Sans bordereau figé (accord-cadre saisi à la main), les prix ne sont pas contrôlés.
 */
export function validerLignesCommande(
  lignes: LigneCommande[],
  prixBordereau: Record<string, number | null> | null | undefined,
): ResultatLignes {
  const erreurs: string[] = [];
  if (lignes.length === 0) erreurs.push('Au moins une ligne est requise.');
  const controle = !!prixBordereau && Object.keys(prixBordereau).length > 0;
  lignes.forEach((l, i) => {
    const nom = l.designation?.trim() || `ligne ${i + 1}`;
    if (!l.designation?.trim()) erreurs.push(`Ligne ${i + 1} : désignation manquante.`);
    if (!Number.isFinite(l.quantite) || l.quantite < 0) erreurs.push(`« ${nom} » : quantité invalide.`);
    if (!Number.isFinite(l.prixUnitaire) || l.prixUnitaire < 0) erreurs.push(`« ${nom} » : prix unitaire invalide.`);
    if (!controle) return;
    const prix = l.articleId ? prixBordereau![l.articleId] : undefined;
    if (prix === undefined || prix === null) erreurs.push(`« ${nom} » : article absent du bordereau de l'accord-cadre.`);
    else if (l.prixUnitaire - prix > TOLERANCE_PRIX) erreurs.push(`« ${nom} » : prix supérieur au bordereau (${prix} € HT).`);
  });
  return { ok: erreurs.length === 0, erreurs };
}

/**
 * Désignation d'un marché dans une pièce jointe de facture (Chorus Pro, Super PDP) :
 * « Dupont SARL, lot 02 », et pour un marché subséquent l'accord-cadre dont il relève,
 * afin que le maître d'ouvrage rattache la facture au bon marché.
 */
export function mentionMarche(m: {
  type_marche?: TypeMarche | null;
  numero_subsequent?: number | null;
  lot_numero?: string | null;
  entreprise_nom?: string | null;
}): string {
  const base = [m.entreprise_nom, m.lot_numero ? `lot ${m.lot_numero}` : ''].filter(Boolean).join(', ');
  return m.type_marche === 'subsequent'
    ? `${base}, marché subséquent n°${m.numero_subsequent ?? '?'} de l'accord-cadre`
    : base;
}

/** Libellé court d'un marché pour les sélecteurs (OS, situations) : « AC lot 02 / MS n°3 ». */
export function libelleMarche(m: {
  type_marche?: TypeMarche | null;
  lot_numero?: string | null;
  numero_subsequent?: number | null;
  entreprise_nom?: string;
}): string {
  const lot = m.lot_numero ? `lot ${m.lot_numero}` : '';
  if (m.type_marche === 'accord_cadre') return ['AC', lot, m.entreprise_nom].filter(Boolean).join(' ');
  if (m.type_marche === 'subsequent') return ['MS', `n°${m.numero_subsequent ?? '?'}`, lot, m.entreprise_nom].filter(Boolean).join(' ');
  return [lot, m.entreprise_nom].filter(Boolean).join(' ');
}

// ── Remise en concurrence entre titulaires ───────────────────────────────────

export interface LigneConsultation {
  articleId: string;
  refBpu?: string;
  designation: string;
  unite: string;
  quantite: number;
}

export interface OffreConcurrence {
  /** Ligne d'accord-cadre du titulaire consulté. */
  marche_id: string;
  prix: Record<string, number | null>;
  delai_jours?: number | null;
  remarques?: string;
  recue_le?: string | null;
  declinee?: boolean;
}

/** Total HT d'une offre ; `null` tant qu'une ligne n'est pas chiffrée. */
export function totalOffre(lignes: LigneConsultation[], offre: OffreConcurrence): number | null {
  if (offre.declinee || lignes.length === 0) return null;
  let total = 0;
  for (const l of lignes) {
    const p = offre.prix[l.articleId];
    if (typeof p !== 'number' || !Number.isFinite(p)) return null;
    total += montantLigne({ quantite: l.quantite, prixUnitaire: p });
  }
  return arrondi(total);
}

/** Offres complètes classées du moins-disant au plus cher (à égalité, délai le plus court). */
export function classerOffres(lignes: LigneConsultation[], offres: OffreConcurrence[]) {
  return offres
    .map(o => ({ offre: o, total: totalOffre(lignes, o) }))
    .filter((x): x is { offre: OffreConcurrence; total: number } => x.total !== null)
    .sort((a, b) => a.total - b.total || (a.offre.delai_jours ?? Infinity) - (b.offre.delai_jours ?? Infinity));
}

/** Une offre ne peut dépasser le prix du bordereau du titulaire, article par article. */
export function verifierOffre(
  lignes: LigneConsultation[],
  prix: Record<string, number | null>,
  bordereau: Record<string, number | null> | null | undefined,
): ResultatLignes {
  const erreurs: string[] = [];
  for (const l of lignes) {
    const p = prix[l.articleId];
    if (p === undefined || p === null) continue;
    if (!Number.isFinite(p) || p < 0) { erreurs.push(`« ${l.designation} » : prix invalide.`); continue; }
    const ref = bordereau?.[l.articleId];
    if (typeof ref === 'number' && p - ref > TOLERANCE_PRIX) erreurs.push(`« ${l.designation} » : prix supérieur au bordereau (${ref} € HT).`);
  }
  return { ok: erreurs.length === 0, erreurs };
}

/** Lignes de commande du subséquent, aux prix de l'offre retenue. */
export function lignesCommandeDepuisOffre(lignes: LigneConsultation[], offre: OffreConcurrence): LigneCommande[] {
  return lignes.map(l => ({
    articleId: l.articleId, refBpu: l.refBpu, designation: l.designation, unite: l.unite,
    quantite: l.quantite, prixUnitaire: Number(offre.prix[l.articleId]),
  }));
}
