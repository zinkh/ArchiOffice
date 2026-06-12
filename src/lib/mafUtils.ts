import type { MafIntercalaire, MafCostResult } from '../types';
import type { ContratCotraitant } from '../types';

// ─── Taux fixes MAF 2025 (hors taxe d'assurance et fonds de solidarité) ───────
export const MAF_TAUX_FIXES: Partial<Record<MafIntercalaire, number>> = {
  violet: 0.3593,
  orange_clair: 1.3047,
  orange_fonce: 1.3047,
  bleu: 3.0065,
};

// Taux de cotisation MAF 2025 (constante de référence pour estimation)
export const MAF_TAUX_ANNEE = 2025;

export const MAF_COUT_MOYEN_MAISON_IND = 1714;   // €/m² surface plancher
export const MAF_COUT_MOYEN_IMMEUBLE_HAB = 1654;  // €/m² surface plancher

// ─── Labels intercalaires ──────────────────────────────────────────────────────
export const MAF_INTERCALAIRE_LABELS: Record<MafIntercalaire, string> = {
  jaune: 'Missions complètes ou partielles de maîtrise d\'œuvre',
  vert: 'Projet architectural (permis de construire)',
  ami: 'Accompagnement Maison Individuelle',
  grand_chantier: 'Grands Chantiers (> 30 M€)',
  violet: 'Missions sans exécution de travaux',
  orange_clair: 'AMO, relevés, états des lieux',
  orange_fonce: 'Missions avec convention spéciale',
  bleu: 'BIM Manager sans maîtrise d\'œuvre',
  rose: 'Ouvrages non soumis à obligation d\'assurance',
  tabac: 'Missions dossier autorisation (équipements professionnels)',
  gris: 'Missions VIR / Vente immeuble à construire',
  puc: 'Police Unique de Chantier (PUC)',
};

// ─── Calcul de la part d'intérêt pondérée depuis fee_distribution ─────────────

interface FeeDistributionMission {
  id: string;
  name?: string;
  amount?: number;
  percentages?: Record<string, number>;
}

interface FeeDistribution {
  missions?: FeeDistributionMission[];
}

/**
 * Calcule la part d'intérêt MAF pondérée de l'architecte (P)
 * depuis proposals.fee_distribution.missions[].percentages.architect
 * Formule : Σ(amount × architect_pct) / Σ(amount)
 */
export function computePartInteret(feeDistributionJson: string | null | undefined): number | null {
  if (!feeDistributionJson) return null;
  try {
    const fd: FeeDistribution = typeof feeDistributionJson === 'string'
      ? JSON.parse(feeDistributionJson)
      : feeDistributionJson;
    const missions = fd?.missions ?? [];
    if (!missions.length) return null;
    let sumWeighted = 0;
    let sumAmount = 0;
    for (const m of missions) {
      const amt = m.amount ?? 0;
      const pct = m.percentages?.['architect'] ?? 0;
      sumWeighted += amt * pct;
      sumAmount += amt;
    }
    if (sumAmount === 0) return null;
    return Math.round((sumWeighted / sumAmount) * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * Calcule la part d'intérêt depuis contrats_moe.cotraitants[].fee_pct
 * P = 100 - Σ(cotraitants[*].fee_pct)
 */
export function computePartInteretFromContrat(cotraitants: ContratCotraitant[]): number | null {
  if (!cotraitants?.length) return null;
  const sumCotraitants = cotraitants.reduce((s, c) => s + (c.fee_pct ?? 0), 0);
  const p = 100 - sumCotraitants;
  return Math.round(p * 100) / 100;
}

// ─── Calcul de l'assiette ──────────────────────────────────────────────────────

export function computeAssiette(params: {
  intercalaire: MafIntercalaire;
  montantCumulFinAnnee?: number;
  montantCumulAnneePrecedente?: number;
  tauxMission?: number;
  partInteret?: number;
  surfacePlancher?: number | string;
  categorieProjet?: string;
  honorairesHt?: number;
}): { montantM: number; assiette: number } {
  const {
    intercalaire,
    montantCumulFinAnnee = 0,
    montantCumulAnneePrecedente = 0,
    tauxMission = 100,
    partInteret = 100,
    surfacePlancher,
    categorieProjet,
    honorairesHt = 0,
  } = params;

  if (['violet', 'orange_clair', 'orange_fonce', 'bleu', 'rose', 'tabac', 'gris', 'puc'].includes(intercalaire)) {
    return { montantM: honorairesHt, assiette: honorairesHt };
  }

  let montantM = 0;

  if (intercalaire === 'vert') {
    const surface = parseFloat(String(surfacePlancher ?? 0));
    const coutM2 = (categorieProjet ?? '').toLowerCase().includes('maison')
      ? MAF_COUT_MOYEN_MAISON_IND
      : MAF_COUT_MOYEN_IMMEUBLE_HAB;
    montantM = coutM2 * surface;
  } else {
    montantM = montantCumulFinAnnee - montantCumulAnneePrecedente;
  }

  const assiette = montantM * (tauxMission / 100) * (partInteret / 100);
  return { montantM, assiette };
}

export function computeCotisation(assiette: number, tauxPermil: number): number {
  return (assiette * tauxPermil) / 1000;
}

// ─── Résultat complet pour un projet donné ────────────────────────────────────

export function computeMafCost(params: {
  intercalaire: MafIntercalaire;
  montantCumulFinAnnee?: number;
  montantCumulAnneePrecedente?: number;
  tauxMission?: number;
  partInteret?: number;
  surfacePlancher?: number | string;
  categorieProjet?: string;
  honorairesHt?: number;
  tauxContratPermil?: number;
}): MafCostResult {
  const { intercalaire, tauxContratPermil = 0 } = params;
  const tauxPermil = MAF_TAUX_FIXES[intercalaire] ?? tauxContratPermil;
  const { montantM, assiette } = computeAssiette(params);
  const cotisationEstimee = computeCotisation(assiette, tauxPermil);
  return {
    montantM,
    assiette,
    cotisationEstimee,
    intercalaire,
    label: MAF_INTERCALAIRE_LABELS[intercalaire],
    tauxPermil,
  };
}
