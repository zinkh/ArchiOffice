// Libellés et couleurs partagés par les lignes du compte-rendu de chantier.
// « À lever » est la nature `reserve` en base : le mot « réserve » est réservé
// à l'AOR (OPR), voir server/observationToReserve.ts.
export const TYPE_LABELS: Record<string, string> = {
  observation: 'REMARQUE',
  reserve: 'À LEVER',
  a_faire: 'TRAVAIL À FAIRE',
};

export const TYPE_COLORS: Record<string, string> = {
  observation: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  reserve: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  a_faire: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

export const URGENCE_LABELS: Record<string, string> = {
  normal: '',
  urgent: 'URGENT',
  bloquant: 'BLOQUANT',
};

// Mêmes statuts et couleurs que le tableau de l'onglet Observations.
export const OBSERVATION_STATUTS = ['À faire', 'En cours', 'Levée', 'Urgent', 'Refusée'] as const;

export const STATUT_COLORS: Record<string, string> = {
  'À faire': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'En cours': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'Levée': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'Urgent': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  'Refusée': 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};
