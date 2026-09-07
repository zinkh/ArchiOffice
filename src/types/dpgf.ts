export interface Ligne {
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
  type: 'ouvrage' | 'sous-total' | 'titre' | 'commentaire';
  children?: Ligne[];
  cctpOnly?: boolean;
  cctpDescription?: string;
}

export interface Chapitre {
  id: string;
  numero: string;
  titre: string;
  lignes: Ligne[];
  cctpOnly?: boolean;
  cctpDescription?: string;
}

export interface Lot {
  id: string;
  numero: string;
  titre: string;
  lotCctpId?: string;
  chapitres: Chapitre[];
  sousTotal: number;
}

export interface DPGF {
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
