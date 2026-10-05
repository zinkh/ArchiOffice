// ── Négociation des offres (module ACT) : logique pure ───────────────────────
// Ce que le maître d'œuvre fait APRÈS l'ouverture des plis : vérifier les
// prix, négocier tour par tour avec chaque entreprise, comparer à l'estimation
// et mesurer le dépassement de l'opération. Rien ici ne touche à React ni au
// réseau : tout se déduit des données de la consultation (jsonb, sans
// migration), comme `actEntreprises.ts`.
//
// Principe directeur : on SAISIT peu, on DÉDUIT le reste. Un total, un écart,
// un statut ne s'écrivent jamais à la main (le tableau Excel d'origine cassait
// dès qu'une formule pointait une cellule déplacée).

/** Clé de la ligne « base » dans les dictionnaires de montants. */
export const BASE_KEY = 'base';

export type LigneKind = 'option' | 'variante';

/**
 * Une option ou une variante d'une offre. La base n'est pas une ligne : c'est
 * `Offre.montant_base`, qui reste l'unique source du prix de base.
 */
export interface LigneOffre {
  id: string;
  kind: LigneKind;
  libelle: string;
  /** Prix remis à l'ouverture des plis. */
  montant_ouverture: number;
}

export interface TourNegociation {
  id: string;
  /** AAAA-MM-JJ. */
  date: string;
  /** Prix proposé par ligne (BASE_KEY, id d'option ou de variante). Une ligne absente n'a pas bougé. */
  montants: Record<string, number>;
  remarque?: string;
  auteur?: string;
  /** « Offre finale » : l'entreprise ne descendra plus. */
  finale?: boolean;
}

export interface Negociation {
  lot_id: string;
  entreprise_id: string;
  lignes: LigneOffre[];
  /** Les prix ont été contrôlés (opérations, quantités, erreurs de calcul). */
  verifie?: boolean;
  /** Prix vérifié par ligne, quand il diffère de l'ouverture (erreur de calcul corrigée). */
  montants_verifies?: Record<string, number>;
  remarque_verification?: string;
  /** Objectif de négociation par ligne. */
  objectifs?: Record<string, number>;
  tours: TourNegociation[];
  /** Offre écartée de la négociation (hors prix, incomplète...). */
  ecartee?: boolean;
}

export type StatutNegociation =
  | 'ecartee'
  | 'retenue'
  | 'a_verifier'
  | 'a_negocier'
  | 'en_negociation'
  | 'offre_finale';

/** Vue minimale d'une offre de la phase « Collecte », pour ne pas dépendre d'ACTModule. */
export interface OffreMontant {
  lot_id: string;
  entreprise_id: string;
  montant_base: number;
  conforme?: boolean;
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

export function negociationVide(lot_id: string, entreprise_id: string): Negociation {
  return { lot_id, entreprise_id, lignes: [], tours: [] };
}

export function trouverNegociation(
  negociations: Negociation[] | undefined, lot_id: string, entreprise_id: string,
): Negociation | undefined {
  return negociations?.find(n => n.lot_id === lot_id && n.entreprise_id === entreprise_id);
}

/** Remplace (ou ajoute) la négociation d'un couple lot × entreprise, sans muter la liste reçue. */
export function remplacerNegociation(negociations: Negociation[] | undefined, next: Negociation): Negociation[] {
  const liste = negociations ?? [];
  const existe = liste.some(n => n.lot_id === next.lot_id && n.entreprise_id === next.entreprise_id);
  return existe
    ? liste.map(n => (n.lot_id === next.lot_id && n.entreprise_id === next.entreprise_id ? next : n))
    : [...liste, next];
}

// ── Montants ──────────────────────────────────────────────────────────────────

/** Les clés de montant d'une offre : la base, puis chaque option et variante. */
export function clesLignes(neg: Negociation | undefined): string[] {
  return [BASE_KEY, ...(neg?.lignes ?? []).map(l => l.id)];
}

/** Prix remis à l'ouverture pour une ligne. */
export function montantOuverture(offre: OffreMontant | undefined, neg: Negociation | undefined, cle: string): number {
  if (cle === BASE_KEY) return offre?.montant_base || 0;
  return neg?.lignes.find(l => l.id === cle)?.montant_ouverture || 0;
}

/** Prix retenu pour la vérification : l'ouverture, sauf correction explicite. */
export function montantVerifie(offre: OffreMontant | undefined, neg: Negociation | undefined, cle: string): number {
  const corrige = neg?.montants_verifies?.[cle];
  return corrige != null ? corrige : montantOuverture(offre, neg, cle);
}

/** Les tours, du plus ancien au plus récent (les dates égales gardent l'ordre de saisie). */
export function toursOrdonnes(neg: Negociation | undefined): TourNegociation[] {
  return [...(neg?.tours ?? [])]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.date || '').localeCompare(b.t.date || '') || a.i - b.i)
    .map(x => x.t);
}

/** Prix actuel d'une ligne : le dernier tour qui l'a modifiée, sinon le prix vérifié. */
export function montantCourant(offre: OffreMontant | undefined, neg: Negociation | undefined, cle: string): number {
  const tours = toursOrdonnes(neg);
  for (let i = tours.length - 1; i >= 0; i--) {
    const m = tours[i].montants[cle];
    if (m != null) return m;
  }
  return montantVerifie(offre, neg, cle);
}

export type Etage = 'ouverture' | 'verifie' | 'courant';

const lecteur = (etage: Etage) =>
  etage === 'ouverture' ? montantOuverture : etage === 'verifie' ? montantVerifie : montantCourant;

/** Base d'une offre à un stade de la négociation. */
export function baseA(offre: OffreMontant | undefined, neg: Negociation | undefined, etage: Etage): number {
  return lecteur(etage)(offre, neg, BASE_KEY);
}

/** Somme des options (jamais des variantes, qui sont des offres de substitution). */
export function optionsA(offre: OffreMontant | undefined, neg: Negociation | undefined, etage: Etage): number {
  const lire = lecteur(etage);
  return arrondi((neg?.lignes ?? []).filter(l => l.kind === 'option').reduce((s, l) => s + lire(offre, neg, l.id), 0));
}

/** Base + options : la valeur comparée à l'estimation « PRO + options ». */
export function totalA(offre: OffreMontant | undefined, neg: Negociation | undefined, etage: Etage): number {
  return arrondi(baseA(offre, neg, etage) + optionsA(offre, neg, etage));
}

/** Objectif de négociation d'une offre : base + options, repli sur le prix vérifié d'une ligne sans objectif. */
export function objectifTotal(offre: OffreMontant | undefined, neg: Negociation | undefined): number {
  const obj = neg?.objectifs ?? {};
  const cles = [BASE_KEY, ...(neg?.lignes ?? []).filter(l => l.kind === 'option').map(l => l.id)];
  return arrondi(cles.reduce((s, k) => s + (obj[k] != null ? obj[k] : montantVerifie(offre, neg, k)), 0));
}

/** Reste à obtenir pour atteindre l'objectif (positif : le prix actuel est encore au-dessus). */
export function resteAObtenir(offre: OffreMontant | undefined, neg: Negociation | undefined): number {
  return arrondi(totalA(offre, neg, 'courant') - objectifTotal(offre, neg));
}

/** Gain obtenu depuis l'ouverture (positif : le prix a baissé). */
export function gainObtenu(offre: OffreMontant | undefined, neg: Negociation | undefined): number {
  return arrondi(totalA(offre, neg, 'ouverture') - totalA(offre, neg, 'courant'));
}

export function pourcentage(valeur: number, reference: number): number | null {
  return reference > 0 ? valeur / reference : null;
}

// ── Statut ────────────────────────────────────────────────────────────────────

export function statutNegociation(
  neg: Negociation | undefined, offre: OffreMontant | undefined, attribue: boolean,
): StatutNegociation {
  if (attribue) return 'retenue';
  if (neg?.ecartee || offre?.conforme === false) return 'ecartee';
  const tours = toursOrdonnes(neg);
  if (tours.length > 0) return tours[tours.length - 1].finale ? 'offre_finale' : 'en_negociation';
  return neg?.verifie ? 'a_negocier' : 'a_verifier';
}

export const STATUT_LIBELLES: Record<StatutNegociation, string> = {
  ecartee: 'Écartée',
  retenue: 'Retenue',
  a_verifier: 'À vérifier',
  a_negocier: 'À négocier',
  en_negociation: 'En négociation',
  offre_finale: 'Offre finale',
};

// ── Moins-disant et moyenne d'un lot ─────────────────────────────────────────

export interface RepereLot {
  /** Offre conforme, non écartée, de base la plus basse à l'étape demandée. */
  moinsDisantId: string | null;
  base: number | null;
  total: number | null;
  /** Moyenne des bases des offres comparables (≥ 1 offre chiffrée), ou null. */
  moyenneBase: number | null;
  nbOffres: number;
}

/** Une offre entre dans la comparaison si elle est conforme, non écartée et chiffrée. */
export function offresComparables(
  offres: OffreMontant[], negociations: Negociation[] | undefined, lot_id: string,
): { offre: OffreMontant; neg: Negociation | undefined }[] {
  return offres
    .filter(o => o.lot_id === lot_id && o.conforme !== false && o.montant_base > 0)
    .map(offre => ({ offre, neg: trouverNegociation(negociations, lot_id, offre.entreprise_id) }))
    .filter(x => !x.neg?.ecartee);
}

export function reperesLot(
  offres: OffreMontant[], negociations: Negociation[] | undefined, lot_id: string, etage: Etage,
): RepereLot {
  const comparables = offresComparables(offres, negociations, lot_id);
  if (comparables.length === 0) {
    return { moinsDisantId: null, base: null, total: null, moyenneBase: null, nbOffres: 0 };
  }
  const chiffrees = comparables.map(({ offre, neg }) => ({
    id: offre.entreprise_id, base: baseA(offre, neg, etage), total: totalA(offre, neg, etage),
  }));
  const meilleure = chiffrees.reduce((m, c) => (c.base < m.base ? c : m));
  const moyenne = chiffrees.reduce((s, c) => s + c.base, 0) / chiffrees.length;
  return {
    moinsDisantId: meilleure.id, base: meilleure.base, total: meilleure.total,
    moyenneBase: arrondi(moyenne), nbOffres: chiffrees.length,
  };
}

// ── Pièces de candidature et d'offre ─────────────────────────────────────────

export interface PieceAttendue { id: string; nom: string }

/** Pièces de l'offre (en plus des pièces administratives de la consultation). */
export const PIECES_OFFRE_DEFAUT: PieceAttendue[] = [
  { id: 'rc', nom: 'RC signé' },
  { id: 'ae', nom: 'Acte d\'engagement (AE / DC3)' },
  { id: 'cctp', nom: 'CCTP signé' },
  { id: 'dpgf', nom: 'DPGF chiffré' },
  { id: 'memoire', nom: 'Mémoire technique' },
  { id: 'visite', nom: 'Attestation de visite' },
];

/** Pièces reçues : entreprise → identifiants de pièces cochées. */
export type PiecesRecues = Record<string, string[]>;

export function piecesManquantes(
  attendues: PieceAttendue[], recues: PiecesRecues | undefined, entreprise_id: string,
): PieceAttendue[] {
  const ok = new Set(recues?.[entreprise_id] ?? []);
  return attendues.filter(p => !ok.has(p.id));
}

export function basculerPiece(
  recues: PiecesRecues | undefined, entreprise_id: string, piece_id: string,
): PiecesRecues {
  const actuel = recues?.[entreprise_id] ?? [];
  const next = actuel.includes(piece_id) ? actuel.filter(p => p !== piece_id) : [...actuel, piece_id];
  return { ...(recues ?? {}), [entreprise_id]: next };
}

// ── Synthèse économique de l'opération ───────────────────────────────────────

export type DecisionLot = 'a_negocier' | 'attribution' | 'estimation' | 'non_retenue';

export const DECISION_LIBELLES: Record<DecisionLot, string> = {
  a_negocier: 'À négocier',
  attribution: 'Attribution',
  estimation: 'Estimation',
  non_retenue: 'Non retenue',
};

/** Saisie propre à un lot dans la synthèse : estimations, décision, observation. */
export interface SyntheseLotSaisie {
  estimation_apd?: number;
  estimation_pro_base?: number;
  estimation_pro_options?: number;
  /** Objectif imposé à la main ; sinon somme des objectifs de l'offre moins-disante. */
  objectif?: number;
  decision?: DecisionLot;
  observation?: string;
}

export interface ParametresEconomiques {
  tva_pct: number;
  /** Taux de tolérance du CCAP : dépassement admis sur l'estimation actualisée (%). */
  tolerance_pct: number;
  /** Dernier indice connu (BT01 ou autre) à la date des offres. */
  indice_connu?: number;
  /** Indice à la date de l'estimation. */
  indice_estimation?: number;
}

export const PARAMETRES_DEFAUT: ParametresEconomiques = { tva_pct: 20, tolerance_pct: 7 };

export interface SyntheseLotLigne {
  lot_id: string;
  estimation_apd: number | null;
  estimation_pro_base: number | null;
  estimation_pro_options: number | null;
  /** Écart PRO base + options contre APD, en € et en rapport. */
  evolution: number | null;
  evolution_pct: number | null;
  moinsDisantId: string | null;
  moinsDisantBase: number | null;
  moinsDisantTotal: number | null;
  ecart_base: number | null;
  ecart_base_pct: number | null;
  ecart_total: number | null;
  ecart_total_pct: number | null;
  objectif: number | null;
  decision: DecisionLot;
  observation: string;
  /** Aucune offre exploitable : le lot est valorisé à l'estimation dans les totaux. */
  valoriseALEstimation: boolean;
  attribueId: string | null;
}

export interface LotRef { id: string }

/**
 * Estimation PRO d'un lot : saisie, sinon l'estimatif du sous-total du DPGF
 * versé au comparatif (le chiffrage de la maîtrise d'œuvre y est déjà).
 */
export function estimationParDefaut(estimatifDpgf: number | undefined): number | null {
  return estimatifDpgf && estimatifDpgf > 0 ? estimatifDpgf : null;
}

export function syntheseLot(args: {
  lot: LotRef;
  saisie?: SyntheseLotSaisie;
  estimatifDpgf?: number;
  offres: OffreMontant[];
  negociations?: Negociation[];
  attributionEntrepriseId?: string | null;
  etage: Etage;
}): SyntheseLotLigne {
  const { lot, saisie, offres, negociations, attributionEntrepriseId, etage } = args;
  const repere = reperesLot(offres, negociations, lot.id, etage);
  const proBase = saisie?.estimation_pro_base ?? estimationParDefaut(args.estimatifDpgf);
  const proOptions = saisie?.estimation_pro_options ?? proBase;
  const apd = saisie?.estimation_apd ?? null;

  const moinsDisant = repere.moinsDisantId
    ? offres.find(o => o.lot_id === lot.id && o.entreprise_id === repere.moinsDisantId)
    : undefined;
  const negMd = moinsDisant ? trouverNegociation(negociations, lot.id, moinsDisant.entreprise_id) : undefined;
  const objectifAuto = moinsDisant ? objectifTotal(moinsDisant, negMd) : null;
  const objectif = saisie?.objectif != null ? saisie.objectif : objectifAuto;

  const ecartBase = repere.base != null && proBase != null ? arrondi(repere.base - proBase) : null;
  const ecartTotal = repere.total != null && proOptions != null ? arrondi(repere.total - proOptions) : null;

  return {
    lot_id: lot.id,
    estimation_apd: apd,
    estimation_pro_base: proBase,
    estimation_pro_options: proOptions,
    evolution: proOptions != null && apd != null ? arrondi(proOptions - apd) : null,
    evolution_pct: proOptions != null && apd != null ? pourcentage(proOptions - apd, apd) : null,
    moinsDisantId: repere.moinsDisantId,
    moinsDisantBase: repere.base,
    moinsDisantTotal: repere.total,
    ecart_base: ecartBase,
    ecart_base_pct: ecartBase != null && proBase != null ? pourcentage(ecartBase, proBase) : null,
    ecart_total: ecartTotal,
    ecart_total_pct: ecartTotal != null && proOptions != null ? pourcentage(ecartTotal, proOptions) : null,
    objectif,
    decision: saisie?.decision ?? (attributionEntrepriseId ? 'attribution' : repere.moinsDisantId ? 'a_negocier' : 'estimation'),
    observation: saisie?.observation ?? '',
    valoriseALEstimation: repere.moinsDisantId == null,
    attribueId: attributionEntrepriseId ?? null,
  };
}

export interface TotauxOperation {
  estimation_apd: number;
  estimation_pro_base: number;
  estimation_pro_options: number;
  evolution: number;
  evolution_pct: number | null;
  /** Offres moins-disantes, lots sans offre valorisés à l'estimation. */
  offres_base: number;
  offres_total: number;
  objectif: number;
  ecart_base: number;
  ecart_base_pct: number | null;
  ecart_total: number;
  ecart_total_pct: number | null;
  tva_total: number;
  ttc_estimation_pro_options: number;
  ttc_offres_total: number;
}

export function totauxOperation(lignes: SyntheseLotLigne[], params: ParametresEconomiques): TotauxOperation {
  const somme = (f: (l: SyntheseLotLigne) => number) => arrondi(lignes.reduce((s, l) => s + f(l), 0));
  const apd = somme(l => l.estimation_apd ?? 0);
  const proBase = somme(l => l.estimation_pro_base ?? 0);
  const proOptions = somme(l => l.estimation_pro_options ?? 0);
  // Un lot sans offre pèse son estimation : sans cela le total « offres » serait
  // artificiellement bas et le dépassement, faussé en faveur du projet.
  const offresBase = somme(l => (l.moinsDisantBase ?? (l.valoriseALEstimation ? l.estimation_pro_base ?? 0 : 0)));
  const offresTotal = somme(l => (l.moinsDisantTotal ?? (l.valoriseALEstimation ? l.estimation_pro_options ?? 0 : 0)));
  const objectif = somme(l => l.objectif ?? l.moinsDisantTotal ?? l.estimation_pro_options ?? 0);
  const tva = params.tva_pct / 100;
  return {
    estimation_apd: apd,
    estimation_pro_base: proBase,
    estimation_pro_options: proOptions,
    evolution: arrondi(proOptions - apd),
    evolution_pct: pourcentage(proOptions - apd, apd),
    offres_base: offresBase,
    offres_total: offresTotal,
    objectif,
    ecart_base: arrondi(offresBase - proBase),
    ecart_base_pct: pourcentage(offresBase - proBase, proBase),
    ecart_total: arrondi(offresTotal - proOptions),
    ecart_total_pct: pourcentage(offresTotal - proOptions, proOptions),
    tva_total: arrondi(offresTotal * tva),
    ttc_estimation_pro_options: arrondi(proOptions * (1 + tva)),
    ttc_offres_total: arrondi(offresTotal * (1 + tva)),
  };
}

// ── Actualisation et tolérance du CCAP ───────────────────────────────────────

/** Coefficient d'actualisation (indice connu / indice à la date de l'estimation), ou 1 sans indices. */
export function coefficientActualisation(params: ParametresEconomiques): number {
  const { indice_connu: connu, indice_estimation: estimation } = params;
  return connu && estimation && connu > 0 && estimation > 0 ? connu / estimation : 1;
}

export interface ControleTolerance {
  coefficient: number;
  estimation_actualisee: number;
  /** Plafond admis : estimation actualisée majorée de la tolérance. */
  plafond: number;
  depassement: number;
  depassement_pct: number | null;
  /** « ok » sous l'estimation, « tolere » dans la tolérance du CCAP, « depasse » au-delà. */
  niveau: 'ok' | 'tolere' | 'depasse';
}

/**
 * Compare une valeur (offres en base + options, ou espoir de négociation) à
 * l'estimation actualisée et à la tolérance du CCAP.
 */
export function controleTolerance(
  valeur: number, estimation: number, params: ParametresEconomiques,
): ControleTolerance {
  const coefficient = coefficientActualisation(params);
  const actualisee = arrondi(estimation * coefficient);
  const plafond = arrondi(actualisee * (1 + params.tolerance_pct / 100));
  const depassement = arrondi(valeur - actualisee);
  return {
    coefficient,
    estimation_actualisee: actualisee,
    plafond,
    depassement,
    depassement_pct: pourcentage(depassement, actualisee),
    niveau: valeur <= actualisee ? 'ok' : valeur <= plafond ? 'tolere' : 'depasse',
  };
}

// ── Mises en forme communes aux écrans et aux exports ────────────────────────

/** Date du jour au format AAAA-MM-JJ (heure locale, jamais UTC : un tour saisi le soir reste du jour). */
export function aujourdhui(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formaterPourcent(r: number | null, signe = true): string {
  if (r == null) return '—';
  const v = (r * 100).toFixed(1).replace('.', ',');
  return `${signe && r > 0 ? '+' : ''}${v} %`;
}

/** Ajoute une option ou une variante, sans muter. */
export function ajouterLigne(neg: Negociation, kind: LigneKind, id: string): Negociation {
  const n = neg.lignes.filter(l => l.kind === kind).length + 1;
  return {
    ...neg,
    lignes: [...neg.lignes, { id, kind, libelle: kind === 'option' ? `Option ${n}` : `Variante ${n}`, montant_ouverture: 0 }],
  };
}

/** Retire une ligne ET ce qui s'y rapporte (prix vérifié, objectif, montants de chaque tour). */
export function retirerLigne(neg: Negociation, id: string): Negociation {
  const sans = (r: Record<string, number> | undefined) => {
    if (!r) return r;
    const { [id]: _retire, ...reste } = r;
    return reste;
  };
  return {
    ...neg,
    lignes: neg.lignes.filter(l => l.id !== id),
    montants_verifies: sans(neg.montants_verifies),
    objectifs: sans(neg.objectifs),
    tours: neg.tours.map(t => ({ ...t, montants: sans(t.montants) ?? {} })),
  };
}

// ── Assemblage depuis la consultation ────────────────────────────────────────

/** Ce que la consultation porte en plus pour la négociation (tout est facultatif : une consultation ancienne reste valide). */
export interface DonneesNegociation {
  negociations?: Negociation[];
  /** Pièces d'offre attendues ; à défaut `PIECES_OFFRE_DEFAUT`. */
  pieces_offre?: PieceAttendue[];
  pieces_recues?: PiecesRecues;
  synthese?: Record<string, SyntheseLotSaisie>;
  parametres?: ParametresEconomiques;
}

interface ComparatifMinimal {
  lot_id: string;
  articles: { is_subtotal?: boolean; estimatif?: number }[];
}

/** Estimatif du sous-total d'un lot dans le comparatif (versé depuis le DPGF ou le BPU). */
export function estimatifComparatif(comparatif: ComparatifMinimal[] | undefined, lot_id: string): number | undefined {
  const sousTotal = comparatif?.find(c => c.lot_id === lot_id)?.articles.find(a => a.is_subtotal);
  return sousTotal?.estimatif;
}

export function parametresDe(donnees: DonneesNegociation): ParametresEconomiques {
  return { ...PARAMETRES_DEFAUT, ...(donnees.parametres ?? {}) };
}

export function piecesOffreDe(donnees: DonneesNegociation): PieceAttendue[] {
  return donnees.pieces_offre ?? PIECES_OFFRE_DEFAUT;
}

/** Une ligne de synthèse par lot du projet, dans l'ordre des lots. */
export function lignesSynthese(
  lots: LotRef[],
  consultation: DonneesNegociation & {
    offres: OffreMontant[];
    attributions: { lot_id: string; entreprise_id: string }[];
    comparatif?: ComparatifMinimal[];
  },
  etage: Etage,
): SyntheseLotLigne[] {
  return lots.map(lot => syntheseLot({
    lot,
    saisie: consultation.synthese?.[lot.id],
    estimatifDpgf: estimatifComparatif(consultation.comparatif, lot.id),
    offres: consultation.offres,
    negociations: consultation.negociations,
    attributionEntrepriseId: consultation.attributions.find(a => a.lot_id === lot.id)?.entreprise_id ?? null,
    etage,
  }));
}

/**
 * Offres telles que les voient l'analyse, l'attribution et le RAO : le montant
 * de base est celui de la négociation en cours, pas celui de l'ouverture.
 */
export function offresAuPrixCourant<T extends OffreMontant>(
  offres: T[], negociations: Negociation[] | undefined,
): T[] {
  return offres.map(o => {
    const neg = trouverNegociation(negociations, o.lot_id, o.entreprise_id);
    return neg ? { ...o, montant_base: baseA(o, neg, 'courant') } : o;
  });
}

/** Montant d'une attribution : base + options au prix négocié. */
export function montantAttribution(offre: OffreMontant, negociations: Negociation[] | undefined): number {
  return totalA(offre, trouverNegociation(negociations, offre.lot_id, offre.entreprise_id), 'courant');
}
