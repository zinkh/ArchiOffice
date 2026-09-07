// ── DPGF, et le découpage commun aux quatre documents ────────────────────────
// Le CCTP travaille sur cet arbre, et les types du BPU/DQE l'étendent : ce qui
// est défini ici vaut donc pour les quatre documents.

/** Bâtiment d'une opération qui en compte plusieurs. */
export interface Batiment {
  id: string;
  code: string;      // « A », « B1 »
  libelle: string;
  ordre: number;
}

/** Phase d'une opération menée en plusieurs temps. */
export interface PhaseOperation {
  id: string;
  code: string;      // « PH1 »
  libelle: string;
  ordre: number;
}

/**
 * Bâtiments et phases sont un REGISTRE au niveau du document plus un attribut
 * hérité vers le bas (lot > chapitre > article), et non deux niveaux d'arbre
 * supplémentaires — même parti que les tranches du BPU, et pour la même
 * raison : deux niveaux de plus obligeraient à toucher FlatRow, rowKey,
 * MAX_ARTICLE_DEPTH et la passe d'aplatissement, c'est-à-dire le code partagé
 * par les trois éditeurs en production.
 *
 * L'héritage règle aussi le cas réel : un lot entier appartient souvent au
 * bâtiment A, avec quelques articles au bâtiment B. On pose l'attribut haut et
 * on ne surcharge que les exceptions, au lieu de le répéter article par article.
 *
 * Tout est OPTIONNEL : des DPGF et des BPU sont déjà enregistrés sans ces
 * champs (le document est un blob JSON), et les relire ne doit pas planter.
 * `decoupageDe()` plus bas rend les valeurs sûres.
 */
export interface DecoupageDocument {
  /** Coché, l'opération compte plusieurs bâtiments : colonnes et sélecteurs apparaissent. */
  multiBatiments?: boolean;
  /** Idem pour les phases. */
  multiPhases?: boolean;
  batiments?: Batiment[];
  phases?: PhaseOperation[];
}

/** Attributs de découpage portés par un lot, un chapitre ou un article. */
export interface DecoupageNoeud {
  batimentId?: string;
  phaseId?: string;
}

export interface Ligne extends DecoupageNoeud {
  id: string;
  numero: string;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
  prixTotal: number;
  articleCctpId?: string;
  /**
   * Provenance : articles_type.id, quand l'article vient de la bibliothèque
   * d'ouvrages. Porté ici et non sur le seul BPULigne parce que c'est ce fil
   * qui referme la boucle des prix : sans lui, un bordereau chiffré renvoyé
   * par une entreprise ne se rattache à aucun article de la bibliothèque et
   * son prix ne peut pas y remonter. Il sert aussi à signaler dans le DPGF et
   * le CCTP les articles issus du fonds du cabinet.
   */
  articleTypeId?: string;
  /**
   * Où l'ouvrage se situe : une pièce (« Chambre 2 »), un ouvrage (« Toiture
   * terrasse ») ou un niveau. Texte libre à dessein — la nomenclature des
   * locaux varie d'une opération à l'autre, et l'imposer par une liste fermée
   * ferait ressaisir chaque projet dans un vocabulaire qui n'est pas le sien.
   */
  localisation?: string;
  type: 'ouvrage' | 'sous-total' | 'titre' | 'commentaire';
  children?: Ligne[];
  cctpOnly?: boolean;
  cctpDescription?: string;
}

export interface Chapitre extends DecoupageNoeud {
  id: string;
  numero: string;
  titre: string;
  lignes: Ligne[];
  cctpOnly?: boolean;
  cctpDescription?: string;
}

export interface Lot extends DecoupageNoeud {
  id: string;
  numero: string;
  titre: string;
  lotCctpId?: string;
  /**
   * Rattachement à project_lots.id. Posé ici, sur le type de base, et non
   * plus seulement sur BPULot : un DPGF verse maintenant lui aussi ses offres
   * au comparatif ACT (voir OffreDocument et lib/documentToAct.ts plus bas),
   * et cette même clé de rattachement lui sert exactement de la même façon.
   */
  projectLotId?: string;
  chapitres: Chapitre[];
  sousTotal: number;
}

export interface DPGF extends DecoupageDocument {
  id: string;
  projectId: string;
  cctpId?: string;
  titre: string;
  version: string;
  dateCreation: string;
  statut: 'draft' | 'final';
  lots: Lot[];
  totalHT: number;
  TVA: number;
  totalTTC: number;
}

// ── Helpers de découpage ─────────────────────────────────────────────────────

/** Registres sûrs, y compris pour un document enregistré avant ces champs. */
export function decoupageDe(doc: DecoupageDocument | null | undefined) {
  return {
    multiBatiments: !!doc?.multiBatiments,
    multiPhases: !!doc?.multiPhases,
    batiments: doc?.batiments ?? [],
    phases: doc?.phases ?? [],
  };
}

/** Bâtiment effectif d'un article : article > chapitre > lot. */
export function batimentEffectif(
  lot: DecoupageNoeud, chap?: DecoupageNoeud, ligne?: DecoupageNoeud,
): string | undefined {
  return ligne?.batimentId ?? chap?.batimentId ?? lot.batimentId;
}

/** Phase effective, même cascade. */
export function phaseEffective(
  lot: DecoupageNoeud, chap?: DecoupageNoeud, ligne?: DecoupageNoeud,
): string | undefined {
  return ligne?.phaseId ?? chap?.phaseId ?? lot.phaseId;
}

/**
 * Critère de regroupement du DPGF. « lot » est l'arbre éditable habituel ; les
 * autres sont des vues de lecture qui réordonnent les mêmes articles.
 */
export type GroupementDpgf = 'lot' | 'batiment' | 'phase' | 'batiment-phase';

export const LIBELLES_GROUPEMENT: Record<GroupementDpgf, string> = {
  lot: 'Par lot',
  batiment: 'Par bâtiment',
  phase: 'Par phase',
  'batiment-phase': 'Par bâtiment et phase',
};

// ── Offres reçues des entreprises ────────────────────────────────────────────
// Un DPGF (avec quantités) et un BPU/DQE (sans, ou estimatives) partagent le
// même arbre lots > chapitres > articles — c'est toute la prémisse du module
// BPU (« le DQE est une vue »). Une offre importée s'y rapporte donc de la
// même façon dans les deux cas, d'où UN SEUL type au lieu d'un par document :
// avant cette PR, seul le BPU en avait un (OffreBPU, resté en alias dans
// types/bpu.ts pour ne pas casser les imports existants).
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

/**
 * Offre reçue d'une entreprise, issue du réimport de son bordereau chiffré.
 * Stockée dans une colonne SÉPARÉE du document (`bpu_data.offres`,
 * `dpgfs.offres`) : l'autosauvegarde débouncée de l'éditeur réécrit le
 * document entier, et une offre logée dans le même blob serait effacée par
 * la première sauvegarde suivant son import.
 */
export interface OffreDocument {
  id: string;
  /** Renvoie vers act_data.consultation.entreprises[].id quand elle existe. */
  entrepriseId?: string;
  entrepriseNom: string;
  lotIds?: string[];
  dateReception: string;
  fichierNom: string;
  importedAt: string;
  importedBy?: string;
  /** Version du DPGF ou du BPU au moment de l'import, pour détecter un décalage. */
  documentVersion: string;
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
