// Détecte si la fiche affaire porte des modifications non enregistrées.
//
// La fiche (aperçu, fiche complète, champs HONOS) n'est écrite en base que par
// le bouton Enregistrer de l'en-tête, alors que notes, avenants et jalons
// s'enregistrent seuls : sans ce repère, une observation saisie dans l'aperçu
// disparaissait au premier changement de page sans que rien ne le signale.

/**
 * Champs que la fiche reprend du contrat MOE lié (synchronisation
 * inconditionnelle, voir ProjectDetail) : ils ne sont pas une saisie de
 * l'utilisateur et ne doivent pas faire passer la fiche pour modifiée dès
 * son ouverture.
 */
const CONTRACT_DERIVED_FIELDS = ['remuneration', 'construction_cost'] as const;

function normalize(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = normalize((value as Record<string, unknown>)[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

/**
 * Empreinte stable d'une fiche : ordre des clés indifférent, et un champ
 * vidé (`''`) vaut un champ jamais rempli (`null`/absent), pour qu'effacer ce
 * qu'on vient de taper ramène la fiche à l'état « enregistré ».
 */
export function projectSignature(
  project: Record<string, unknown> | null | undefined,
  opts: { contractLinked?: boolean } = {},
): string {
  if (!project) return '';
  const copy: Record<string, unknown> = { ...project };
  if (opts.contractLinked) {
    for (const field of CONTRACT_DERIVED_FIELDS) delete copy[field];
  }
  return JSON.stringify(normalize(copy));
}

export function isProjectDirty(
  saved: Record<string, unknown> | null | undefined,
  current: Record<string, unknown> | null | undefined,
  opts: { contractLinked?: boolean } = {},
): boolean {
  if (!saved || !current) return false;
  return projectSignature(saved, opts) !== projectSignature(current, opts);
}
