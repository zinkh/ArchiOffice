export interface Article {
  id: string;
  numero: string;
  designation: string;
  description: string;
  unite: string;
  prescriptionsTechniques: string;
  normes: string;
}

export interface Chapitre {
  id: string;
  numero: string;
  titre: string;
  articles: Article[];
}

export interface Lot {
  id: string;
  numero: string;
  titre: string;
  description: string;
  chapitres: Chapitre[];
}

export interface CCTP {
  id: string;
  projectId: string;
  titre: string;
  version: string;
  dateCreation: string;
  statut: 'draft' | 'final';
  lots: Lot[];
}
