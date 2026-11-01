// ── État d'ouverture de l'arbre du CCTP ──────────────────────────────────────
// L'arbre (lots > chapitres) se rouvre comme on l'a laissé : changer d'onglet,
// recharger la page ou revenir plus tard ne le déplie plus en entier. On garde
// ce qui est REPLIÉ et non ce qui est ouvert : un lot ou un chapitre créé
// ailleurs (DPGF, import, IA) arrive ouvert, sans que l'état enregistré ait à
// le connaître. Propre au poste (localStorage) : une préférence d'affichage,
// pas une donnée du projet. Tout accès est protégé, le stockage pouvant être
// absent (navigation privée) ou plein : l'arbre reste alors tout ouvert.

export interface EtatArbre {
  /** Identifiants des lots repliés. */
  lots: Set<string>;
  /** Identifiants des chapitres repliés. */
  chapitres: Set<string>;
}

export const cleEtatArbre = (projectId: string) => `cctp:tree:${projectId}`;

const ids = (v: unknown): Set<string> =>
  new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function lireStockage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function chargerEtatArbre(projectId: string | undefined, stockage: Pick<Storage, 'getItem'> | null = lireStockage()): EtatArbre {
  const vide: EtatArbre = { lots: new Set(), chapitres: new Set() };
  if (!projectId || !stockage) return vide;
  try {
    const brut = stockage.getItem(cleEtatArbre(projectId));
    if (!brut) return vide;
    const json = JSON.parse(brut);
    return { lots: ids(json?.lots), chapitres: ids(json?.chapitres) };
  } catch {
    return vide;
  }
}

export function sauverEtatArbre(projectId: string | undefined, etat: EtatArbre, stockage: Pick<Storage, 'setItem' | 'removeItem'> | null = lireStockage()): void {
  if (!projectId || !stockage) return;
  try {
    if (!etat.lots.size && !etat.chapitres.size) {
      stockage.removeItem(cleEtatArbre(projectId));
      return;
    }
    stockage.setItem(cleEtatArbre(projectId), JSON.stringify({ lots: [...etat.lots], chapitres: [...etat.chapitres] }));
  } catch {
    // Stockage plein ou refusé : l'état n'est simplement pas gardé.
  }
}

/** Tous les identifiants sauf ceux repliés : l'état « ouvert » d'un jeu d'éléments. */
export function ouvertsSauf(tous: string[], replies: Set<string>): Set<string> {
  return new Set(tous.filter(id => !replies.has(id)));
}

/** Ce qui est replié parmi les éléments connus ; un élément disparu n'est pas gardé. */
export function repliesParmi(connus: string[], ouverts: Set<string>): Set<string> {
  return new Set(connus.filter(id => !ouverts.has(id)));
}
