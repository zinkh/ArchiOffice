// ── BPU / DQE ────────────────────────────────────────────────────────────────
// Le BPU (Bordereau de Prix Unitaires) est le catalogue de prix d'un marché à
// prix unitaires ou à bons de commande : une désignation, une unité, un prix
// unitaire, et surtout PAS de quantités — les travaux se règlent sur quantités
// réellement constatées. Le DQE (Détail Quantitatif Estimatif) n'est pas un
// second document : c'est le même arbre d'articles auquel le maître d'œuvre
// porte des quantités estimatives pour rendre les offres comparables.
//
// Les types ci-dessous ÉTENDENT ceux du DPGF plutôt que de les dupliquer : un
// BPULigne reste assignable à Ligne, donc les helpers d'arbre de
// components/pro/treeOps.ts, la charge utile du glisser-déposer et les
// conversions DPGF<->BPU fonctionnent sans adaptateur. Le BPU est réellement le
// même arbre d'articles, c'est la prémisse de « le DQE est une vue ».
import type { Ligne, Chapitre, Lot } from './dpgf';

/**
 * Nature d'un article au sens du règlement de la consultation. Une PSE
 * (prestation supplémentaire éventuelle) ou une variante n'entre jamais dans
 * le montant de l'offre de base : les totaux sont donc des réductions filtrées
 * sur ce champ, et non un arbre parallèle.
 */
export type NatureArticle = 'base' | 'pse' | 'variante' | 'option';

export type TypeMarche = 'bons_de_commande' | 'prix_unitaires' | 'mixte';

export interface BPULigne extends Ligne {
  /**
   * Jeton court et stable (base 36, 3 à 5 caractères) porté par la colonne
   * « Réf. » des exports. Attribué au premier export et PERSISTÉ : une
   * référence régénérée à chaque export ne sert à rien pour rapprocher un
   * fichier renvoyé trois semaines plus tard. Distinct de `id` pour que la
   * forme des identifiants internes puisse changer sans invalider les
   * bordereaux déjà envoyés aux entreprises.
   */
  refBpu?: string;
  /** Montant en toutes lettres, dérivé du nombre mais surchargeable à la main. */
  prixUnitaireLettres?: string;
  /** Défaut 'base' quand le champ est absent. */
  nature?: NatureArticle;
  /** Surcharge la tranche héritée du chapitre puis du lot. */
  trancheId?: string;
  /** Provenance : articles_type.id, quand l'article vient de la bibliothèque. */
  articleTypeId?: string;
  /** Quantités mini/maxi d'un marché à bons de commande. */
  qteMini?: number;
  qteMaxi?: number;
  children?: BPULigne[];
}

export interface BPUChapitre extends Chapitre {
  lignes: BPULigne[];
  trancheId?: string;
}

export interface BPULot extends Lot {
  chapitres: BPUChapitre[];
  trancheId?: string;
  /** Rattachement à project_lots.id — requis pour verser au comparatif ACT. */
  projectLotId?: string;
}

/**
 * Les tranches sont un registre au niveau du document plus un attribut
 * `trancheId` hérité vers le bas (lot > chapitre > article), et NON un
 * quatrième niveau d'arbre : un niveau de plus obligerait à toucher FlatRow,
 * rowKey, MAX_ARTICLE_DEPTH et la passe d'aplatissement, c'est-à-dire le code
 * partagé avec l'éditeur DPGF en production.
 */
export interface Tranche {
  id: string;
  code: string;
  libelle: string;
  type: 'ferme' | 'optionnelle';
  ordre: number;
}

export interface MarcheHeader {
  typeMarche: TypeMarche;
  objet?: string;
  referenceMarche?: string;
  pouvoirAdjudicateur?: string;
  montantMiniHT?: number;
  montantMaxiHT?: number;
  dureeInitialeMois?: number;
  nbReconductions?: number;
  dureeReconductionMois?: number;
  /** Dérivée, mais stockée pour qu'un document déjà imprimé reste stable. */
  dureeMaxTotaleMois?: number;
  dateLimiteRemiseOffres?: string;
  /** Formule ou index de révision des prix, en texte libre. */
  revisionPrix?: string;
  delaiPaiementJours?: number;
}

export interface BPU {
  id: string;
  projectId: string;
  /** DPGF d'origine, quand le BPU a été initialisé depuis lui. */
  dpgfId?: string;
  titre: string;
  version: string;
  dateCreation: string;
  statut: 'draft' | 'final';
  marche: MarcheHeader;
  tranches: Tranche[];
  lots: BPULot[];
  /** Rend la colonne « P.U. en lettres » dans l'éditeur et les exports. */
  prixEnLettres: boolean;
  /**
   * ATTENTION : totalHT est l'ESTIMATION DQE, jamais un montant de marché. Le
   * jeu de colonnes 'bpu' ne doit jamais l'afficher — un bordereau de prix
   * unitaires n'a pas de total, c'est ce qui le distingue d'un DPGF.
   */
  totalHT: number;
  TVA: number;
  totalTTC: number;
}

/**
 * Offre reçue d'une entreprise, issue du réimport de son bordereau chiffré.
 * Stockée dans la colonne bpu_data.offres, SÉPARÉE du document : l'autosave
 * débouncée de ProTab réécrit le document entier, et une offre logée dans le
 * même blob serait effacée par la première sauvegarde suivant l'import.
 */
export interface OffreBPU {
  id: string;
  /** Renvoie vers act_data.consultation.entreprises[].id quand elle existe. */
  entrepriseId?: string;
  entrepriseNom: string;
  lotIds?: string[];
  dateReception: string;
  fichierNom: string;
  importedAt: string;
  importedBy?: string;
  /** Version du document au moment de l'import, pour détecter un décalage. */
  bpuVersion: string;
  /**
   * articleId -> P.U. HT remis. `null` signifie « non chiffré » ou « pour
   * mémoire » : surtout pas 0, qui est un prix et changerait le classement.
   * Table plate et non tableau : la comparaison lit en O(1) et survit à une
   * réorganisation de l'arbre après l'import.
   */
  prix: Record<string, number | null>;
  anomalies: OffreAnomalie[];
  /** Mis en cache pour la liste des offres. */
  totalOffreHT?: number;
  statut: 'brouillon' | 'validee' | 'ecartee';
  motifEcart?: string;
}

export interface OffreAnomalie {
  articleId?: string;
  rowIndex?: number;
  code:
    | 'pu_manquant'
    | 'pu_zero'
    | 'pu_aberrant'
    | 'unite_differente'
    | 'designation_modifiee'
    | 'quantite_modifiee'
    | 'ligne_ajoutee'
    | 'ligne_supprimee';
  message: string;
}

/** Ligne complète telle que renvoyée par GET /api/projects/:projectId/bpu. */
export interface BPURow {
  id: string;
  project_id: string;
  document: BPU;
  offres: OffreBPU[];
  updated_at: string;
}

// ── Garde-fou de compatibilité ───────────────────────────────────────────────
// Les helpers d'arbre partagés sont typés sur Lot/Chapitre/Ligne. Si une
// évolution de types/dpgf.ts rompait l'assignabilité, ces lignes échoueraient
// au `tsc --noEmit` plutôt que de laisser la rupture se découvrir à l'exécution.
const _assignableLot: Lot[] = [] as BPULot[];
const _assignableChapitre: Chapitre[] = [] as BPUChapitre[];
const _assignableLigne: Ligne[] = [] as BPULigne[];
void _assignableLot;
void _assignableChapitre;
void _assignableLigne;

// ── Valeurs par défaut ───────────────────────────────────────────────────────

export const EMPTY_MARCHE: MarcheHeader = { typeMarche: 'bons_de_commande' };

export const EMPTY_BPU = (projectId: string): BPU => ({
  id: 'new',
  projectId,
  titre: 'BPU',
  version: '1.0',
  dateCreation: new Date().toISOString(),
  statut: 'draft',
  marche: { ...EMPTY_MARCHE },
  tranches: [],
  lots: [],
  prixEnLettres: false,
  totalHT: 0,
  TVA: 20,
  totalTTC: 0,
});

/** Tranche effective d'un article : article > chapitre > lot. */
export function trancheEffective(lot: BPULot, chap?: BPUChapitre, ligne?: BPULigne): string | undefined {
  return ligne?.trancheId ?? chap?.trancheId ?? lot.trancheId;
}

/** Nature effective : 'base' quand rien n'est précisé. */
export function natureEffective(ligne: BPULigne): NatureArticle {
  return ligne.nature ?? 'base';
}
