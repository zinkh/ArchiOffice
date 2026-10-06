import { createContext, useContext } from 'react';
import type { GroupementMember } from '../../lib/pdfLetterhead';

/**
 * Cotraitants du contrat MOE de l'affaire, mis à disposition des ateliers de
 * l'onglet PRO (CCTP, DPGF, estimation) pour que leurs exports PDF portent les
 * logos du groupement dans l'en-tête. Vide hors d'une affaire ou sans contrat.
 */
const GroupementContext = createContext<GroupementMember[]>([]);

export const GroupementProvider = GroupementContext.Provider;

export function useGroupementMembers(): GroupementMember[] {
  return useContext(GroupementContext);
}
