// Modèle de données partagé par la résolution (…Data.ts), les gabarits HTML et les routes.
// Toute donnée absente reste null / vide : un panneau n'imprime que ce qui est connu.
import type { DossierAgency } from '../referencesDossier/types';
import type { PageSpec } from './pageSpec';

export interface PanelLogo {
  dataUrl: string;
  widthPx: number | null;
  heightPx: number | null;
}

export interface PanelParty {
  /** Clé stable pour masquer la ligne : `moa`, `amo`, `moe`, `cot:<id>`, `int:<id>`. */
  key: string;
  role: string;
  name: string;
  address: string[];
  logo: PanelLogo | null;
  contactId: string | null;
}

export interface PanelLot {
  /** `lot:<project_lots.id>` */
  key: string;
  number: string;
  title: string;
  company: string | null;
  address: string[];
  logo: PanelLogo | null;
  contactId: string | null;
}

export interface PanelFact {
  label: string;
  value: string;
}

export interface ChantierPanelData {
  agency: DossierAgency;
  projectName: string;
  kicker: string;
  facts: PanelFact[];
  image: { id: string; dataUrl: string; widthPx: number | null } | null;
  maitriseOuvrage: PanelParty[];
  maitriseOeuvre: PanelParty[];
  lots: PanelLot[];
  warnings: string[];
}

export interface ChantierPanelOptions {
  page: PageSpec;
  /** Logos des entreprises et intervenants affichés (vrai par défaut). */
  logos: boolean;
  /** Logos laissés en couleur au lieu des niveaux de gris de la charte. */
  colorLogos: boolean;
  /** Clés de lignes masquées (lots, entreprises, intervenants). */
  hidden: ReadonlySet<string>;
  /** Clés dont on masque seulement le logo. */
  hiddenLogos: ReadonlySet<string>;
  /** Titre libre remplaçant le nom de l'affaire. */
  title?: string | null;
}

export type PermisEtat = 'brouillon' | 'definitif';

export interface PermisPanelData {
  agency: DossierAgency;
  permitType: 'PC' | 'DP';
  etat: PermisEtat;
  beneficiaire: string | null;
  architecte: string | null;
  numero: string | null;
  dateDelivrance: string | null;
  natureProjet: string | null;
  adresseTerrain: string | null;
  superficieTerrainM2: number | null;
  surfacePlancherM2: number | null;
  nombreLogements: number | null;
  hauteurM: number | null;
  mairieNom: string | null;
  mairieAdresse: string | null;
  /** Champs obligatoires de la version définitive encore vides. */
  missingRequired: string[];
  warnings: string[];
}
