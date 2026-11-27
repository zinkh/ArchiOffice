// Régions françaises (NUTS 2 de TED et départements du BOAMP), pour les listes déroulantes de la veille.

export interface FrenchRegion {
  id: string;
  label: string;
  /** Code NUTS 2 (TED) ; ses NUTS 3 commencent tous par ce code. */
  nuts: string;
  departements: string[];
}

export const FRENCH_REGIONS: FrenchRegion[] = [
  { id: 'ara', label: 'Auvergne-Rhône-Alpes', nuts: 'FRK', departements: ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'] },
  { id: 'bfc', label: 'Bourgogne-Franche-Comté', nuts: 'FRC', departements: ['21', '25', '39', '58', '70', '71', '89', '90'] },
  { id: 'bre', label: 'Bretagne', nuts: 'FRH', departements: ['22', '29', '35', '56'] },
  { id: 'cvl', label: 'Centre-Val de Loire', nuts: 'FRB', departements: ['18', '28', '36', '37', '41', '45'] },
  { id: 'cor', label: 'Corse', nuts: 'FRM', departements: ['2A', '2B'] },
  { id: 'ges', label: 'Grand Est', nuts: 'FRF', departements: ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'] },
  { id: 'hdf', label: 'Hauts-de-France', nuts: 'FRE', departements: ['02', '59', '60', '62', '80'] },
  { id: 'idf', label: 'Île-de-France', nuts: 'FR1', departements: ['75', '77', '78', '91', '92', '93', '94', '95'] },
  { id: 'nor', label: 'Normandie', nuts: 'FRD', departements: ['14', '27', '50', '61', '76'] },
  { id: 'naq', label: 'Nouvelle-Aquitaine', nuts: 'FRI', departements: ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'] },
  { id: 'occ', label: 'Occitanie', nuts: 'FRJ', departements: ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'] },
  { id: 'pdl', label: 'Pays de la Loire', nuts: 'FRG', departements: ['44', '49', '53', '72', '85'] },
  { id: 'paca', label: "Provence-Alpes-Côte d'Azur", nuts: 'FRL', departements: ['04', '05', '06', '13', '83', '84'] },
  { id: 'gua', label: 'Guadeloupe', nuts: 'FRY1', departements: ['971'] },
  { id: 'mar', label: 'Martinique', nuts: 'FRY2', departements: ['972'] },
  { id: 'guy', label: 'Guyane', nuts: 'FRY3', departements: ['973'] },
  { id: 'reu', label: 'La Réunion', nuts: 'FRY4', departements: ['974'] },
  { id: 'may', label: 'Mayotte', nuts: 'FRY5', departements: ['976'] },
];

const sameSet = (a: string[], b: string[]) => a.length === b.length && b.every(x => a.includes(x));

/** Région dont les départements saisis sont exactement ceux ; '' sinon (saisie libre ou vide). */
export function regionIdForDepartements(codes: string[]): string {
  return FRENCH_REGIONS.find(r => sameSet(codes, r.departements))?.id ?? '';
}

/** Région dont le code NUTS saisi est exactement celui ; '' sinon. */
export function regionIdForNuts(codes: string[]): string {
  return codes.length === 1 ? FRENCH_REGIONS.find(r => r.nuts === codes[0])?.id ?? '' : '';
}
