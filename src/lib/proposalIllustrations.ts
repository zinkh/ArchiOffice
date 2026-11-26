// Plan et photos d'une proposition : extraits de cartes IGN et photos que l'architecte
// insère dans le document exporté (section « Plan et photos », voir
// src/components/proposal/ProposalIllustrations.tsx et ProposalExportModal.tsx).
// Même forme que les illustrations d'une rubrique d'étude de faisabilité, stockées en
// JSON (texte) dans `proposals.illustrations`. Logique pure, testée seule.
import { sanitizeIllustrations, type FeasibilityIllustration } from './feasibilityBlocks';

export type ProposalIllustration = FeasibilityIllustration;

/** Au-delà, le document n'est plus lisible : une page de plan, quelques pages de photos. */
export const MAX_PROPOSAL_ILLUSTRATIONS = 12;

/** Lit la colonne `illustrations` (texte JSON, ou déjà une liste) sans jamais lever d'exception. */
export function parseProposalIllustrations(raw: unknown): ProposalIllustration[] {
  if (Array.isArray(raw)) return sanitizeIllustrations(raw).slice(0, MAX_PROPOSAL_ILLUSTRATIONS);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    return sanitizeIllustrations(JSON.parse(raw)).slice(0, MAX_PROPOSAL_ILLUSTRATIONS);
  } catch {
    return [];
  }
}

export function serializeProposalIllustrations(list: ProposalIllustration[]): string {
  return JSON.stringify(sanitizeIllustrations(list).slice(0, MAX_PROPOSAL_ILLUSTRATIONS));
}

/** Les extraits de plan passent avant les photos, chaque groupe gardant l'ordre d'ajout. */
export function orderIllustrations(list: ProposalIllustration[]): ProposalIllustration[] {
  const plans = list.filter(i => i.layer !== 'photo');
  const photos = list.filter(i => i.layer === 'photo');
  return [...plans, ...photos];
}
