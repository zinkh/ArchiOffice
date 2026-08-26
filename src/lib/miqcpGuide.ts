// Barème officiel du Guide MIQCP ("Guide à l'intention des maîtres d'ouvrage
// publics pour la négociation des rémunérations de maîtrise d'œuvre", loi MOP
// 1994, actualisé 2019). Données transcrites depuis l'onglet "5-GUIDE MOP" et
// "3-Cc" d'un classeur Excel de référence utilisé par les cabinets pour
// calculer le taux d'honoraires sur les marchés publics.
//
// Méthode :
//  1) Taux de référence = interpolation linéaire du barème taux/montant des
//     travaux (MIQCP_RATE_POINTS) pour le montant HT du projet.
//  2) Coefficient de complexité (Cc) = les 27 critères (MIQCP_CRITERIA),
//     notés de -2 à +2, sont sommés (plage possible -54 à +54), normalisés en
//     % (0 à 1), puis interpolés dans la plage [bas, haut] propre au type
//     d'ouvrage sélectionné (MIQCP_OUVRAGES).
//  3) Taux applicable = Taux de référence × Cc.
//  4) Honoraires estimés = Montant des travaux HT × Taux applicable.

export interface MiqcpRatePoint {
  montantHT: number;
  tauxPct: number;
}

// Points (montant HT, taux %) du barème — l'interpolation se fait entre
// points consécutifs, comme dans le classeur source (colonnes A/B de
// l'onglet "5-GUIDE MOP" : le taux d'un point s'applique au montant "bas" de
// sa ligne, la colonne "haut" n'étant qu'indicative).
export const MIQCP_RATE_POINTS: MiqcpRatePoint[] = [
  { montantHT: 50000, tauxPct: 13 },
  { montantHT: 100000, tauxPct: 13 },
  { montantHT: 150000, tauxPct: 13 },
  { montantHT: 210000, tauxPct: 13 },
  { montantHT: 280000, tauxPct: 13 },
  { montantHT: 360000, tauxPct: 13 },
  { montantHT: 975600, tauxPct: 13 },
  { montantHT: 1300800, tauxPct: 12.25 },
  { montantHT: 1626000, tauxPct: 11.7 },
  { montantHT: 1951200, tauxPct: 11.4 },
  { montantHT: 2276399, tauxPct: 11.2 },
  { montantHT: 2601599, tauxPct: 11 },
  { montantHT: 2926799, tauxPct: 10.8 },
  { montantHT: 3251999, tauxPct: 10.65 },
  { montantHT: 4877999, tauxPct: 10.05 },
  { montantHT: 6503998, tauxPct: 9.7 },
  { montantHT: 8129998, tauxPct: 9.4 },
  { montantHT: 9755998, tauxPct: 9.2 },
  { montantHT: 11381997, tauxPct: 9 },
  { montantHT: 13007997, tauxPct: 8.85 },
  { montantHT: 14633996, tauxPct: 8.75 },
  { montantHT: 16259996, tauxPct: 8.7 },
  { montantHT: 24389994, tauxPct: 8.55 },
  { montantHT: 32519992, tauxPct: 8.5 },
  { montantHT: 48779988, tauxPct: 8.4 },
  { montantHT: 65039984, tauxPct: 8.35 },
  { montantHT: 81299980, tauxPct: 8.3 },
  { montantHT: 97559976, tauxPct: 8.28 },
  { montantHT: 113819971, tauxPct: 8.25 },
  { montantHT: 130079967, tauxPct: 8.24 },
  { montantHT: 146339963, tauxPct: 8.23 },
  { montantHT: 162599959, tauxPct: 8.22 },
];

export interface MiqcpOuvrage {
  domaineCode: string;
  domaineLabel: string;
  ouvrageCode: string;
  ouvrageLabel: string;
  complexiteBas: number;
  complexiteHaut: number;
}

// Table des domaines de construction / types d'ouvrage et de leur plage de
// complexité [Bas, Haut] (colonnes E-I de l'onglet "5-GUIDE MOP").
export const MIQCP_OUVRAGES: MiqcpOuvrage[] = [
  { domaineCode: 'A', domaineLabel: "10- LE DOMAINE DU LOGEMENT ET DE L'HEBERGEMENT", ouvrageCode: '11', ouvrageLabel: '11- Maisons individuelles', complexiteBas: 0.6, complexiteHaut: 1.1 },
  { domaineCode: 'A', domaineLabel: "10- LE DOMAINE DU LOGEMENT ET DE L'HEBERGEMENT", ouvrageCode: '12', ouvrageLabel: '12- Logements collectifs', complexiteBas: 0.7, complexiteHaut: 1.2 },
  { domaineCode: 'A', domaineLabel: "10- LE DOMAINE DU LOGEMENT ET DE L'HEBERGEMENT", ouvrageCode: '13', ouvrageLabel: '13- Hôtellerie et hébergement', complexiteBas: 0.8, complexiteHaut: 1.3 },
  { domaineCode: 'B', domaineLabel: '20- LE DOMAINE TERTIAIRE ET COMMERCIAL', ouvrageCode: '21', ouvrageLabel: '21- Bureaux', complexiteBas: 0.6, complexiteHaut: 1.5 },
  { domaineCode: 'B', domaineLabel: '20- LE DOMAINE TERTIAIRE ET COMMERCIAL', ouvrageCode: '22', ouvrageLabel: '22- Locaux commerciaux', complexiteBas: 0.7, complexiteHaut: 1.4 },
  { domaineCode: 'C', domaineLabel: '30- LE DOMAINE DE LA SANTE', ouvrageCode: '31', ouvrageLabel: '31- Maisons de retraite ou de cures', complexiteBas: 0.8, complexiteHaut: 1.3 },
  { domaineCode: 'C', domaineLabel: '30- LE DOMAINE DE LA SANTE', ouvrageCode: '32', ouvrageLabel: '32- Dispensaires et centres médicaux', complexiteBas: 0.9, complexiteHaut: 1.4 },
  { domaineCode: 'C', domaineLabel: '30- LE DOMAINE DE LA SANTE', ouvrageCode: '33', ouvrageLabel: '33- Cliniques et hôpitaux généraux', complexiteBas: 1.1, complexiteHaut: 1.6 },
  { domaineCode: 'C', domaineLabel: '30- LE DOMAINE DE LA SANTE', ouvrageCode: '34', ouvrageLabel: '34- CHU et hôpitaux régionaux', complexiteBas: 1.3, complexiteHaut: 1.8 },
  { domaineCode: 'D', domaineLabel: "40- LE DOMAINE DE L'ENSEIGNEMENT RECHERCHE", ouvrageCode: '41', ouvrageLabel: "41- Etablissements d'enseignement 1ier degré", complexiteBas: 0.7, complexiteHaut: 1.3 },
  { domaineCode: 'D', domaineLabel: "40- LE DOMAINE DE L'ENSEIGNEMENT RECHERCHE", ouvrageCode: '42', ouvrageLabel: "42- Etablissements d'enseignement 2è degré", complexiteBas: 0.8, complexiteHaut: 1.4 },
  { domaineCode: 'D', domaineLabel: "40- LE DOMAINE DE L'ENSEIGNEMENT RECHERCHE", ouvrageCode: '43', ouvrageLabel: "43- Etablissements d'enseignement supérieur", complexiteBas: 0.9, complexiteHaut: 1.5 },
  { domaineCode: 'D', domaineLabel: "40- LE DOMAINE DE L'ENSEIGNEMENT RECHERCHE", ouvrageCode: '44', ouvrageLabel: '44- Etablissements de recherche', complexiteBas: 1.3, complexiteHaut: 1.8 },
  { domaineCode: 'E', domaineLabel: '50- LE DOMAINE SOCIO-CULTUREL', ouvrageCode: '51', ouvrageLabel: '51- Equipements de proximité', complexiteBas: 0.7, complexiteHaut: 1.1 },
  { domaineCode: 'E', domaineLabel: '50- LE DOMAINE SOCIO-CULTUREL', ouvrageCode: '52', ouvrageLabel: '52- Foyers et salles polyvalentes', complexiteBas: 0.6, complexiteHaut: 1.4 },
  { domaineCode: 'E', domaineLabel: '50- LE DOMAINE SOCIO-CULTUREL', ouvrageCode: '53', ouvrageLabel: '53- Bibliothèques et médiathèques', complexiteBas: 0.8, complexiteHaut: 1.6 },
  { domaineCode: 'E', domaineLabel: '50- LE DOMAINE SOCIO-CULTUREL', ouvrageCode: '54', ouvrageLabel: '54- Spectacle-concert-culture-musées', complexiteBas: 1, complexiteHaut: 1.8 },
  { domaineCode: 'E', domaineLabel: '50- LE DOMAINE SOCIO-CULTUREL', ouvrageCode: '55', ouvrageLabel: "55- Ensembles d'expositions et de congrès", complexiteBas: 0.9, complexiteHaut: 1.8 },
  { domaineCode: 'F', domaineLabel: '60- LE DOMAINE DES EQUIPEMENTS', ouvrageCode: '61', ouvrageLabel: '61- Bâtiments liés à la sécurité', complexiteBas: 0.8, complexiteHaut: 1.4 },
  { domaineCode: 'F', domaineLabel: '60- LE DOMAINE DES EQUIPEMENTS', ouvrageCode: '62', ouvrageLabel: '62- Bâtiments administratifs simples', complexiteBas: 0.7, complexiteHaut: 1.2 },
  { domaineCode: 'F', domaineLabel: '60- LE DOMAINE DES EQUIPEMENTS', ouvrageCode: '63', ouvrageLabel: '63- Equipements administr. complexité moyenne', complexiteBas: 0.9, complexiteHaut: 1.4 },
  { domaineCode: 'F', domaineLabel: '60- LE DOMAINE DES EQUIPEMENTS', ouvrageCode: '64', ouvrageLabel: '64- Equipements administr. majeurs et complexes', complexiteBas: 1, complexiteHaut: 1.8 },
  { domaineCode: 'G', domaineLabel: '70- LE DOMAINE SPORTIF ET DES LOISIRS', ouvrageCode: '71', ouvrageLabel: '71- Salles de sport de proximité', complexiteBas: 0.6, complexiteHaut: 1 },
  { domaineCode: 'G', domaineLabel: '70- LE DOMAINE SPORTIF ET DES LOISIRS', ouvrageCode: '72', ouvrageLabel: '72- Equipements omnisports', complexiteBas: 0.8, complexiteHaut: 1.4 },
  { domaineCode: 'G', domaineLabel: '70- LE DOMAINE SPORTIF ET DES LOISIRS', ouvrageCode: '73', ouvrageLabel: '73- Ensembles importants ou spécialisés', complexiteBas: 1, complexiteHaut: 1.6 },
  { domaineCode: 'H', domaineLabel: '80- LE DOMAINE DE LA PRODUCTION OU DU STOCKAGE', ouvrageCode: '81', ouvrageLabel: '81- Entreposage', complexiteBas: 0.6, complexiteHaut: 1.2 },
  { domaineCode: 'H', domaineLabel: '80- LE DOMAINE DE LA PRODUCTION OU DU STOCKAGE', ouvrageCode: '82', ouvrageLabel: '82- Garages et parkings', complexiteBas: 0.6, complexiteHaut: 1 },
  { domaineCode: 'H', domaineLabel: '80- LE DOMAINE DE LA PRODUCTION OU DU STOCKAGE', ouvrageCode: '83', ouvrageLabel: '83- Bâtiments à caractère technique', complexiteBas: 0.8, complexiteHaut: 1.6 },
  { domaineCode: 'H', domaineLabel: '80- LE DOMAINE DE LA PRODUCTION OU DU STOCKAGE', ouvrageCode: '84', ouvrageLabel: '84- Gares et aérogares', complexiteBas: 0.6, complexiteHaut: 1.8 },
];

export type MiqcpCriterionCategory = 'contexte' | 'programme' | 'contractuel';

export interface MiqcpCriterion {
  id: string;
  category: MiqcpCriterionCategory;
  order: number;
  label: string;
}

// Les 5 niveaux de l'échelle de notation (onglet "3-Cc") — le sens est celui
// du classeur source : une complexité "très supérieure à la moyenne" vaut +2.
export const MIQCP_SCALE_LABELS: Record<-2 | -1 | 0 | 1 | 2, string> = {
  2: 'Complexité très supérieure à la moyenne',
  1: 'Complexité supérieure à la moyenne',
  0: 'Complexité moyenne',
  [-1]: 'Complexité inférieure à la moyenne',
  [-2]: 'Complexité très inférieure à la moyenne',
};

// Les 27 critères de complexité, répartis en 3 catégories (onglet "3-Cc").
export const MIQCP_CRITERIA: MiqcpCriterion[] = [
  // 1. Contraintes physiques du contexte et insertion dans l'environnement (7)
  { id: 'contexte_1', category: 'contexte', order: 1, label: 'La qualité du sol et du sous-sol' },
  { id: 'contexte_2', category: 'contexte', order: 2, label: 'Les contraintes physiques' },
  { id: 'contexte_3', category: 'contexte', order: 3, label: "L'existence de nuisances" },
  { id: 'contexte_4', category: 'contexte', order: 4, label: "L'existence de risques" },
  { id: 'contexte_5', category: 'contexte', order: 5, label: 'La situation du terrain' },
  { id: 'contexte_6', category: 'contexte', order: 6, label: 'Le contexte urbain' },
  { id: 'contexte_7', category: 'contexte', order: 7, label: 'Le contexte réglementaire' },
  // 2. Nature du programme et spécificité du projet (8)
  { id: 'programme_1', category: 'programme', order: 1, label: "La multiplicité et l'imbrication des fonctions" },
  { id: 'programme_2', category: 'programme', order: 2, label: 'La typologie et la répétitivité' },
  { id: 'programme_3', category: 'programme', order: 3, label: "L'adaptabilité et la modularité" },
  { id: 'programme_4', category: 'programme', order: 4, label: "Le caractère d'innovation ou d'expérimentation" },
  { id: 'programme_5', category: 'programme', order: 5, label: 'Le niveau de performances des ouvrages' },
  { id: 'programme_6', category: 'programme', order: 6, label: 'La présence de difficultés techniques particulières' },
  { id: 'programme_7', category: 'programme', order: 7, label: 'La technicité des installations' },
  { id: 'programme_8', category: 'programme', order: 8, label: "L'étendue des compétences nécessaires" },
  // 3. Exigences contractuelles (12)
  { id: 'contractuel_1', category: 'contractuel', order: 1, label: "L'organisation de la maîtrise d'ouvrage" },
  { id: 'contractuel_2', category: 'contractuel', order: 2, label: 'La qualité du programme' },
  { id: 'contractuel_3', category: 'contractuel', order: 3, label: 'La demande de prestations supplémentaires' },
  { id: 'contractuel_4', category: 'contractuel', order: 4, label: 'Le phasage des études et des travaux' },
  { id: 'contractuel_5', category: 'contractuel', order: 5, label: "Délais d'études et de travaux" },
  { id: 'contractuel_6', category: 'contractuel', order: 6, label: 'Des exigences économiques performancielles' },
  { id: 'contractuel_7', category: 'contractuel', order: 7, label: 'Le taux de tolérance' },
  { id: 'contractuel_8', category: 'contractuel', order: 8, label: "L'emploi de méthodes ou d'outils particuliers" },
  { id: 'contractuel_9', category: 'contractuel', order: 9, label: 'Le mode de dévolution des travaux' },
  { id: 'contractuel_10', category: 'contractuel', order: 10, label: "La gestion des variantes d'appel d'offres" },
  { id: 'contractuel_11', category: 'contractuel', order: 11, label: 'Les sujétions particulières de chantier et déplacements' },
  { id: 'contractuel_12', category: 'contractuel', order: 12, label: 'Conditions contractuelles spéciales' },
];

// Répartition indicative par phase de mission de base, proposée par le Guide
// (onglet "5-GUIDE MOP", lignes 48-56) — alternative aux répartitions
// personnalisées déjà proposées par défaut dans l'application.
export const MIQCP_PHASE_REPARTITION_GUIDE: { id: string; pct: number }[] = [
  { id: 'esquisse', pct: 5 },
  { id: 'aps', pct: 10 },
  { id: 'apd', pct: 17 },
  { id: 'projet', pct: 20 },
  { id: 'act', pct: 7 },
  { id: 'visa', pct: 9 },
  { id: 'det', pct: 26 },
  { id: 'aor', pct: 6 },
];

/** Interpolation linéaire du taux de référence pour un montant de travaux HT donné. */
export function getTauxReference(montantTravauxHT: number): number {
  const points = MIQCP_RATE_POINTS;
  if (!points.length) return 0;
  if (montantTravauxHT <= points[0].montantHT) return points[0].tauxPct;
  const last = points[points.length - 1];
  if (montantTravauxHT >= last.montantHT) return last.tauxPct;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (montantTravauxHT >= a.montantHT && montantTravauxHT <= b.montantHT) {
      if (b.montantHT === a.montantHT) return a.tauxPct;
      const ratio = (montantTravauxHT - a.montantHT) / (b.montantHT - a.montantHT);
      return a.tauxPct + ratio * (b.tauxPct - a.tauxPct);
    }
  }
  return last.tauxPct;
}

export function getOuvrage(ouvrageCode: string): MiqcpOuvrage | undefined {
  return MIQCP_OUVRAGES.find(o => o.ouvrageCode === ouvrageCode);
}

export function getPlageComplexite(ouvrageCode: string): { bas: number; haut: number } | null {
  const ouvrage = getOuvrage(ouvrageCode);
  if (!ouvrage) return null;
  return { bas: ouvrage.complexiteBas, haut: ouvrage.complexiteHaut };
}

/**
 * Coefficient de complexité (Cc) : somme des 27 notes (plage -54 à +54),
 * normalisée en % (0 à 1), puis interpolée dans la plage [bas, haut] de
 * l'ouvrage. Cc = bas + normalise × (haut - bas) — reproduit la formule
 * "A×(C–B)+B" de l'onglet "3-Cc".
 */
export function computeComplexityCoefficient(scores: number[], plage: { bas: number; haut: number }): number {
  const totalCriteria = MIQCP_CRITERIA.length;
  const sum = scores.reduce((acc, s) => acc + s, 0);
  const maxRange = totalCriteria * 2; // 54
  const normalise = (sum + maxRange) / (maxRange * 2); // 0..1
  return plage.bas + normalise * (plage.haut - plage.bas);
}

export interface MiqcpComputeInput {
  montantTravauxHT: number;
  ouvrageCode: string;
  criteriaScores: number[]; // ordonné comme MIQCP_CRITERIA, une valeur -2..2 par critère
}

export interface MiqcpComputeResult {
  tauxReference: number;
  plageComplexite: { bas: number; haut: number } | null;
  coefficientComplexite: number;
  tauxApplicable: number;
  montantHonorairesEstime: number;
}

export function computeMiqcpResult(input: MiqcpComputeInput): MiqcpComputeResult {
  const tauxReference = getTauxReference(input.montantTravauxHT);
  const plageComplexite = getPlageComplexite(input.ouvrageCode);
  const coefficientComplexite = plageComplexite
    ? computeComplexityCoefficient(input.criteriaScores, plageComplexite)
    : 1;
  const tauxApplicable = tauxReference * coefficientComplexite;
  const montantHonorairesEstime = input.montantTravauxHT * (tauxApplicable / 100);
  return { tauxReference, plageComplexite, coefficientComplexite, tauxApplicable, montantHonorairesEstime };
}
