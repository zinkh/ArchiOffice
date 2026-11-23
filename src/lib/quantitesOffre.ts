// ── Quantités d'une offre : lecture et base de comparaison (module sans dépendance) ──
// Les petites fonctions que partagent le comparatif, le versement vers l'ACT (`versComparatif`) et les
// exports. Elles vivent ici, sans aucun import de `comparatifPrix.ts`, pour ne pas fermer de cercle
// d'imports. La logique d'écarts et de totaux est dans `quantitesEntreprise.ts`.
import type { OffreDocument } from '../types/dpgf';

export type BaseQuantites = 'moe' | 'entreprise';

export const LIBELLE_BASE: Record<BaseQuantites, string> = {
  moe: 'Quantités du maître d\'œuvre',
  entreprise: 'Quantités de chaque entreprise',
};

/** Précision de comparaison : au-dessous, c'est du bruit de calcul flottant, pas une différence. */
const EPSILON = 1e-9;

/** Deux quantités diffèrent-elles ? À la virgule près : aucun seuil de tolérance. */
export function quantitesDifferent(a: number, b: number): boolean {
  return Math.abs(a - b) > EPSILON;
}

const retenue = (o: OffreDocument, entrepriseId: string) => o.entrepriseId === entrepriseId && o.statut !== 'ecartee';

/** Quantités d'une entreprise sur tout le document ; l'offre la plus récente l'emporte sur un même article. */
export function quantitesEntreprise(offres: OffreDocument[], entrepriseId: string): Record<string, number> {
  const out: Record<string, number> = {};
  const docs = offres.filter(o => retenue(o, entrepriseId)).sort((a, b) => (a.importedAt || '').localeCompare(b.importedAt || ''));
  for (const o of docs) for (const [id, q] of Object.entries(o.quantites ?? {})) {
    if (typeof q === 'number' && Number.isFinite(q)) out[id] = q;
  }
  return out;
}

/** Articles dont l'architecte a accepté la quantité de l'entreprise (au plus récent état de ses offres). */
export function quantitesAcceptees(offres: OffreDocument[], entrepriseId: string): Set<string> {
  const docs = offres.filter(o => retenue(o, entrepriseId)).sort((a, b) => (a.importedAt || '').localeCompare(b.importedAt || ''));
  const acceptees = new Set<string>();
  for (const o of docs) {
    // Une offre qui reçoit de nouvelles quantités redonne la main : seuls ses propres articles sont gérés.
    for (const id of Object.keys(o.quantites ?? {})) acceptees.delete(id);
    for (const id of o.quantitesAcceptees ?? []) acceptees.add(id);
  }
  return acceptees;
}

/** Quantité utilisée pour un article dans une base donnée. */
export function quantiteRetenue(
  base: BaseQuantites, quantiteMoe: number, articleId: string,
  quantites: Record<string, number>, acceptees: ReadonlySet<string>,
): number {
  const q = quantites[articleId];
  if (typeof q !== 'number') return quantiteMoe;
  return base === 'entreprise' || acceptees.has(articleId) ? q : quantiteMoe;
}
