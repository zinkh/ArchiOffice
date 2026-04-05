export interface Ligne {
  id: string;
  numero: string;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
  prixTotal: number;
  articleCctpId?: string;
  type: 'ouvrage' | 'sous-total' | 'titre' | 'commentaire';
}

export interface Chapitre {
  id: string;
  numero: string;
  titre: string;
  lignes: Ligne[];
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
