// ── Remise commerciale (module ACT) : logique pure ───────────────────────────
// Une entreprise peut consentir une remise sur son prix final, en pourcentage ou
// en montant. Elle s'applique au prix de base de l'offre (celui qui est comparé,
// noté et attribué) ; les options et variantes ne sont pas remisées. Rien ici ne
// touche à React ni au réseau, et rien n'est stocké en base : la remise vit dans
// le jsonb de la consultation (`Offre.remise`, `TourNegociation.remise`).

export type ModeRemise = 'pourcentage' | 'montant';

export interface RemiseCommerciale {
  mode: ModeRemise;
  /** Pourcentage (0 à 100) ou montant HT en euros, selon `mode`. */
  valeur: number;
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

/** Une remise sans valeur positive n'existe pas : elle ne s'affiche pas et ne se stocke pas. */
export function remiseActive(remise: RemiseCommerciale | undefined | null): remise is RemiseCommerciale {
  return !!remise && Number.isFinite(remise.valeur) && remise.valeur > 0;
}

/**
 * Montant déduit du prix brut. Jamais négatif et jamais au-dessus du brut : un pourcentage au-delà de 100 %
 * ou un montant supérieur au prix ne peut pas rendre l'offre négative.
 */
export function montantRemise(brut: number, remise: RemiseCommerciale | undefined | null): number {
  if (!remiseActive(remise) || !(brut > 0)) return 0;
  const brute = remise.mode === 'pourcentage' ? brut * Math.min(remise.valeur, 100) / 100 : remise.valeur;
  return arrondi(Math.min(Math.max(brute, 0), brut));
}

/** Prix final : le brut moins la remise. */
export function netApresRemise(brut: number, remise: RemiseCommerciale | undefined | null): number {
  return arrondi(brut - montantRemise(brut, remise));
}

/** Part du prix brut que représente la remise (0,03 pour 3 %), pour comparer un montant à un pourcentage. */
export function pourcentageEquivalent(brut: number, remise: RemiseCommerciale | undefined | null): number | null {
  return brut > 0 && remiseActive(remise) ? montantRemise(brut, remise) / brut : null;
}

/** Remise saisie : une valeur vide ou nulle retire la remise (renvoie undefined). */
export function remiseSaisie(mode: ModeRemise, valeur: number | undefined): RemiseCommerciale | undefined {
  return valeur != null && Number.isFinite(valeur) && valeur > 0 ? { mode, valeur } : undefined;
}

/** « 3 % » ou « 1 500 € » : la forme saisie, pour les écrans et les exports. */
export function libelleRemise(remise: RemiseCommerciale | undefined | null): string {
  if (!remiseActive(remise)) return '';
  const nombre = remise.valeur.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  return remise.mode === 'pourcentage' ? `${nombre} %` : `${nombre} €`;
}

/**
 * Champs à écrire sur une offre quand son prix brut est connu : le prix final (`montant_base`, celui que lit toute
 * l'analyse) et le brut, conservé seulement quand une remise s'applique. `undefined` efface un champ devenu inutile
 * (la sérialisation JSON ignore la clé).
 */
export function montantsAvecRemise(
  brut: number, remise: RemiseCommerciale | undefined | null,
): { montant_base: number; montant_brut: number | undefined; remise: RemiseCommerciale | undefined } {
  const retenue = remiseActive(remise) && montantRemise(brut, remise) > 0;
  return {
    montant_base: netApresRemise(brut, remise),
    montant_brut: retenue ? arrondi(brut) : undefined,
    // Une valeur 0 reste stockée : sinon le champ se viderait dès le premier « 0 » tapé (« 0,5 % » ne pourrait pas se saisir).
    remise: remise ?? undefined,
  };
}

/** Prix brut d'une offre : celui d'avant remise quand il est mémorisé, sinon le montant lui-même. */
export function brutDeOffre(offre: { montant_base: number; montant_brut?: number }): number {
  return offre.montant_brut ?? offre.montant_base;
}
