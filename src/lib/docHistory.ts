// Historique « annuler / rétablir » d'un document : logique pure, sans React.
//
// Le document du DPGF et du CCTP (un seul arbre) est remplacé EN ENTIER à chaque modification : l'historique
// garde donc des instantanés, par référence. Cela suppose que les éditeurs ne modifient jamais un document
// déjà remis (ils clonent avant de modifier), ce qu'ils font tous.
//
// Les instantanés ne vivent qu'en mémoire : fermer l'espace PRO ou changer d'affaire repart de zéro, et
// l'enregistrement automatique n'en sait rien (une annulation est une modification comme une autre).

/** Nombre maximal d'étapes gardées : au-delà, les plus anciennes sont oubliées. */
export const HISTORIQUE_LIMITE = 50;
/**
 * Des modifications rapprochées (frappe dans un champ, rafale de clics) ne forment qu'UNE étape : on garde
 * l'état d'avant la première. Sans cela, annuler un texte tapé reviendrait lettre par lettre.
 */
export const FENETRE_REGROUPEMENT_MS = 800;

export interface Historique<T> {
  /** États antérieurs, le plus ancien d'abord. */
  readonly passe: readonly T[];
  /** États annulés, que « rétablir » rejoue, le plus proche d'abord. */
  readonly futur: readonly T[];
  /** Date de la dernière modification enregistrée (0 : la prochaine ouvre toujours une étape). */
  readonly instant: number;
}

export const historiqueVide = <T>(): Historique<T> => ({ passe: [], futur: [], instant: 0 });

/**
 * Enregistre une modification de `avant` vers `apres`. Une nouvelle modification efface ce qui pouvait être
 * rétabli. Rien n'est enregistré si le document n'a pas changé (même référence).
 */
export function enregistrer<T>(h: Historique<T>, avant: T, apres: T, maintenant: number): Historique<T> {
  if (avant === apres) return h;
  if (h.passe.length && h.futur.length === 0 && maintenant - h.instant < FENETRE_REGROUPEMENT_MS) {
    return { ...h, instant: maintenant };
  }
  return { passe: [...h.passe, avant].slice(-HISTORIQUE_LIMITE), futur: [], instant: maintenant };
}

/** Annule la dernière étape : l'état à restaurer et l'historique qui en découle, `null` s'il n'y a rien à annuler. */
export function annuler<T>(h: Historique<T>, courant: T): { cible: T; historique: Historique<T> } | null {
  if (!h.passe.length) return null;
  return {
    cible: h.passe[h.passe.length - 1],
    historique: { passe: h.passe.slice(0, -1), futur: [courant, ...h.futur], instant: 0 },
  };
}

/** Rejoue la dernière étape annulée, `null` s'il n'y en a pas. */
export function retablir<T>(h: Historique<T>, courant: T): { cible: T; historique: Historique<T> } | null {
  if (!h.futur.length) return null;
  return {
    cible: h.futur[0],
    historique: { passe: [...h.passe, courant].slice(-HISTORIQUE_LIMITE), futur: h.futur.slice(1), instant: 0 },
  };
}
