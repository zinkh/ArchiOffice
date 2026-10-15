// Dossier de références pour les candidatures aux marchés publics : modèle de
// données partagé par la résolution (data.ts), le gabarit HTML (template.ts)
// et la route. Toute donnée absente reste `null` : le gabarit l'affiche « NC »,
// jamais une valeur inventée.
export type DossierOrientation = 'landscape' | 'portrait';

export interface SheetImage {
  id: string;
  /** Image déjà réduite, en data URL : le rendu Chromium n'a besoin d'aucun accès réseau. */
  dataUrl: string;
}

export interface ReferenceSheetData {
  /** `project:<id>` ou `manual:<id>`. */
  key: string;
  name: string;
  nature: string | null;
  city: string | null;
  department: string | null;
  programme: string | null;
  labels: string | null;
  maitreOuvrage: string | null;
  maitreOeuvre: string | null;
  mission: string | null;
  phase: string | null;
  surface: number | null;
  /** Texte libre prioritaire sur `amount` (ex. « 10 889 185 € HT travaux »). */
  amountText: string | null;
  amount: number | null;
  year: string | null;
  /** L'image principale est la première. */
  images: SheetImage[];
}

export interface DossierAgency {
  name: string;
  acronym: string;
  manager: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  siret: string | null;
  oaNumber: string | null;
  vatNumber: string | null;
  logoDataUrl: string | null;
}

export interface DossierInput {
  agency: DossierAgency;
  references: ReferenceSheetData[];
  orientation: DossierOrientation;
  /** Sections à produire (tout par défaut). */
  includeCover?: boolean;
  includeList?: boolean;
}
