// Détecte si la fiche affaire porte des modifications pas encore enregistrées.
//
// La fiche (aperçu, fiche complète, champs HONOS) s'enregistre seule
// (useProjectAutosave) : ce repère dit s'il reste quelque chose à envoyer, et
// la garde de sortie s'appuie dessus quand l'enregistrement a échoué.

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

/**
 * Listes rattachées que la fiche affaire n'édite pas (les lots se gèrent dans
 * l'onglet PRO, par leurs propres routes). Les renvoyer à chaque
 * enregistrement automatique réécrirait ces tables pour rien : le serveur ne
 * les touche que si le corps de la requête les porte.
 */
const LIST_FIELDS = ['lots_list', 'cotraitants_list', 'stakeholders_list', 'categories_list'] as const;

/** Corps envoyé par l'enregistrement automatique de la fiche. */
export function projectSavePayload<T extends Record<string, unknown>>(project: T): Partial<T> {
  const payload: Record<string, unknown> = { ...project };
  for (const field of LIST_FIELDS) delete payload[field];
  return payload as Partial<T>;
}

/** Une fiche sans nom ne peut pas être enregistrée (le serveur la refuse). */
export function canAutosaveProject(project: { name?: unknown } | null | undefined): boolean {
  return !!project && typeof project.name === 'string' && project.name.trim().length > 0;
}
