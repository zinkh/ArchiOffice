import { useMemo } from 'react';
import type { Project, Proposal, MafCostResult, MafIntercalaire } from '../types';
import { computeMafCost, computePartInteret } from '../lib/mafUtils';

interface UseMafCostParams {
  project: Project | null | undefined;
  proposal?: Proposal | null;
  mafEnabled?: boolean;
  tauxContratPermil?: number;
  montantCumulFinAnnee?: number;
  montantCumulAnneePrecedente?: number;
}

export function useMafCost(params: UseMafCostParams): MafCostResult | null {
  const { project, proposal, mafEnabled, tauxContratPermil = 0, montantCumulFinAnnee, montantCumulAnneePrecedente } = params;

  return useMemo(() => {
    if (!mafEnabled || !project) return null;

    // Déduire l'intercalaire depuis le type de bâtiment et la mission
    const cat = (project.categorie_projet ?? '').toLowerCase();
    const isMaisonInd = cat.includes('maison') && cat.includes('individuelle');
    const tauxMission = project.taux_mission ?? 100;
    const isPermisOnly = tauxMission === 30;

    let intercalaire: MafIntercalaire = 'jaune';
    if (isMaisonInd && isPermisOnly) intercalaire = 'vert';
    else if (isMaisonInd && tauxMission >= 60) intercalaire = 'ami';

    // Part d'intérêt : depuis fee_distribution si disponible, sinon depuis project
    const partFromFee = computePartInteret(proposal?.fee_distribution ?? null);
    const partInteret = partFromFee ?? project.part_interet ?? 100;

    const A = montantCumulFinAnnee ?? project.construction_cost ?? 0;
    const B = montantCumulAnneePrecedente ?? 0;

    return computeMafCost({
      intercalaire,
      montantCumulFinAnnee: A,
      montantCumulAnneePrecedente: B,
      tauxMission,
      partInteret,
      surfacePlancher: project.surface_plancher,
      categorieProjet: project.categorie_projet,
      tauxContratPermil,
    });
  }, [project, proposal, mafEnabled, tauxContratPermil, montantCumulFinAnnee, montantCumulAnneePrecedente]);
}
