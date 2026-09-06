// Bibliothèque d'ouvrages : articles réutilisables dans les CCTP, DPGF et DQE,
// et les trois nomenclatures sur lesquelles ils se classent.
// Voir supabase/migrate_bibliotheque_ouvrages.sql pour les tables.

/** Élément d'ouvrage EU SfB plus : « (21) MURS EXTERIEURS », « (21/2) Mur ». */
export interface SfbElement {
  code: string;
  parent_code: string | null;
  niveau: 1 | 2;
  libelle: string;
  libelle_en: string | null;
  position: number;
}

/** Métier de la nomenclature FFB, regroupé en quatre familles. */
export interface CorpsEtat {
  code: string;
  famille: string;
  libelle: string;
  position: number;
}

/** NF DTU, XP DTU ou FD DTU, avec sa référence de norme AFNOR. */
export interface DtuReference {
  code: string;       // « NF DTU 13.1 »
  prefixe: string;    // NF DTU | XP DTU | FD DTU
  numero: string;     // « 13.1 »
  titre: string;
  norme: string | null;
  amendement: boolean;
}

/** Code NAF INSEE, section F et activités connexes du bâtiment. */
export interface NafCode {
  code: string;
  parent_code: string | null;
  niveau: number;     // 2 division, 3 groupe, 4 classe, 5 sous-classe
  libelle: string;
  section: string | null;
}

export interface Referentiels {
  sfb: SfbElement[];
  corpsEtat: CorpsEtat[];
  dtu: DtuReference[];
  naf: NafCode[];
  /** Un DTU relève parfois de deux métiers, d'où les deux sens de la relation. */
  dtuParCorpsEtat: Record<string, string[]>;
  corpsEtatParDtu: Record<string, string[]>;
}

/**
 * Provenance d'un article. C'est le repère qui distingue le fonds de référence
 * des articles créés par le cabinet, et qui les signale comme tels une fois
 * injectés dans un CCTP ou un DPGF.
 */
export type OrigineArticle = 'reference' | 'saisie' | 'bpu' | 'offre' | 'import';

export interface ArticleBibliotheque {
  id: string;
  designation: string;
  unite: string | null;
  prix_unitaire: number | null;
  code: string | null;
  categorie: string | null;
  lot_type: string | null;
  description: string | null;
  notes: string | null;
  source: string | null;
  date_prix: string | null;
  usage_count: number;
  last_used_at: string | null;
  favori: boolean;
  origine: OrigineArticle;
  created_by: string | null;
  created_at: string | null;
  // Classement sur les référentiels, tous facultatifs.
  sfb_code: string | null;
  dtu_code: string | null;
  corps_etat_code: string | null;
  naf_code: string | null;
}

/** Prix constaté à une date, sans écraser le prix courant de l'article. */
export interface PrixObservation {
  id: string;
  article_id: string;
  prix_ht: number;
  unite: string | null;
  date_observation: string;
  origine: 'saisie' | 'bpu' | 'offre' | 'marche' | 'import';
  entreprise: string | null;
  project_id: string | null;
  tender_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface PrixStats {
  nombre: number;
  min: number | null;
  max: number | null;
  /** Médiane, pas moyenne : une offre anormalement basse ne doit pas la tirer. */
  mediane: number | null;
}

export interface RepartitionBibliotheque {
  total: number;
  parCorpsEtat: Record<string, number>;
  parDtu: Record<string, number>;
  parOrigine: Record<string, number>;
}

// Les libellés des provenances vivent dans src/locales (clés
// `library_origin_*`) et non ici : les dupliquer en dur donnerait deux sources
// pour la même étiquette, et la version anglaise n'en aurait qu'une.
