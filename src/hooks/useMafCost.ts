import { useMemo } from 'react';
import type { MafCostResult, MafIntercalaire } from '../types';
import { computeMafCost, computePartInteret } from '../lib/mafUtils';

// Structural subset shared by Project and Proposal — lets this hook be used
// from either a project or an in-progress devis without casting.
interface MafCostSource {
  categorie_projet?: string;
  taux_mission?: number;
  part_interet?: number;
  surface_plancher?: string;
  maf_intercalaire?: MafIntercalaire;
  construction_cost?: number;
  remuneration?: number;
}

interface MafFeeSource {
  fee_distribution?: string;
  amount?: number;
}

interface UseMafCostParams {
  project: MafCostSource | null | undefined;
  proposal?: MafFeeSource | null;
  mafEnabled?: boolean;
  tauxContratPermil?: number;
  montantCumulFinAnnee?: number;
  montantCumulAnneePrecedente?: number;
}

const INTERCALAIRES_HONORAIRES: MafIntercalaire[] = ['violet', 'orange_clair', 'orange_fonce', 'bleu', 'rose', 'tabac', 'gris', 'puc'];

export function useMafCost(params: UseMafCostParams): MafCostResult | null {
  const { project, proposal, mafEnabled, tauxContratPermil = 0, montantCumulFinAnnee, montantCumulAnneePrecedente } = params;

  return useMemo(() => {
    if (!mafEnabled || !project) return null;

    const tauxMission = project.taux_mission ?? 100;

    // Le type de mission choisi explicitement sur le projet (ou hérité du devis)
    // prime toujours sur la déduction heuristique ci-dessous.
    let intercalaire: MafIntercalaire;
    if (project.maf_intercalaire) {
      intercalaire = project.maf_intercalaire;
    } else {
      // Déduire l'intercalaire depuis le type de bâtiment et la mission
      const cat = (project.categorie_projet ?? '').toLowerCase();
      const isMaisonInd = cat.includes('maison') && cat.includes('individuelle');
      const isPermisOnly = tauxMission === 30;

      intercalaire = 'jaune';
      if (isMaisonInd && isPermisOnly) intercalaire = 'vert';
      else if (isMaisonInd && tauxMission >= 60) intercalaire = 'ami';
    }

    // Part d'intérêt : depuis fee_distribution si disponible, sinon depuis project
    const partFromFee = computePartInteret(proposal?.fee_distribution ?? null);
    const partInteret = partFromFee ?? project.part_interet ?? 100;

    const A = montantCumulFinAnnee ?? project.construction_cost ?? 0;
    const B = montantCumulAnneePrecedente ?? 0;
    const honorairesHt = proposal?.amount ?? project.remuneration ?? 0;

    return computeMafCost({
      intercalaire,
      montantCumulFinAnnee: A,
      montantCumulAnneePrecedente: B,
      tauxMission,
      partInteret,
      surfacePlancher: project.surface_plancher,
      categorieProjet: project.categorie_projet,
      honorairesHt: INTERCALAIRES_HONORAIRES.includes(intercalaire) ? honorairesHt : undefined,
      tauxContratPermil,
    });
  }, [project, proposal, mafEnabled, tauxContratPermil, montantCumulFinAnnee, montantCumulAnneePrecedente]);
}
