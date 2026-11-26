// Instantanés automatiques du CCTP / DPGF : une copie du document figée toutes les 10 minutes pendant
// qu'on le modifie, dans l'historique du dossier (`dpgf_versions`, menu « ⋯ », Historique).
//
// Aucune migration : un instantané automatique est une version ordinaire dont le libellé est
// `LABEL_INSTANTANE_AUTO`, posé par le SERVEUR (le client ne choisit pas le libellé, il ne peut donc pas
// faire élaguer ses propres versions nommées). Partagé écran / serveur : le client déclenche, le serveur
// décide de la fréquence et du nombre conservé, pour que deux onglets ouverts ou un client qui s'emballe
// ne remplissent pas la table.

export const LABEL_INSTANTANE_AUTO = 'Instantané automatique';

/** Intervalle voulu côté client. */
export const INTERVALLE_INSTANTANE_MS = 10 * 60 * 1000;
/** Le serveur refuse un instantané si le précédent a moins de 9 minutes : marge pour l'horloge et le réseau. */
export const INTERVALLE_MINI_SERVEUR_MS = 9 * 60 * 1000;
/** Instantanés automatiques conservés par affaire : 48, soit 8 heures de travail continu. */
export const MAX_INSTANTANES_AUTO = 48;

export const estInstantaneAuto = (label: unknown): boolean => label === LABEL_INSTANTANE_AUTO;

/**
 * Le dernier instantané automatique est-il trop récent pour en figer un nouveau ? Une date illisible ou
 * absente ne bloque jamais : mieux vaut un instantané de trop qu'un historique qui ne se remplit plus.
 */
export function instantaneTropRecent(dernierCreeLe: string | null | undefined, maintenant: number): boolean {
  if (!dernierCreeLe) return false;
  const quand = Date.parse(dernierCreeLe);
  if (!Number.isFinite(quand)) return false;
  return maintenant - quand < INTERVALLE_MINI_SERVEUR_MS;
}

/** Les identifiants à supprimer pour ne garder que les `max` plus récents (liste triée du plus récent au plus ancien). */
export function instantanesAElaguer(recentsDabord: ReadonlyArray<{ id: string }>, max: number = MAX_INSTANTANES_AUTO): string[] {
  return recentsDabord.slice(max).map(v => v.id);
}
