// Planning prévisionnel d'une proposition réglé à la main : durées des missions et décalages.
// Stocké en JSON dans `proposals.planning` ; NULL = enchaînement par défaut (voir
// `planifierCalendrier`). L'écran (ProposalGantt) et l'export PDF lisent le même réglage.

export interface PlanningOverride {
  /** Durée de la mission, en jours. */
  duree?: number;
  /** Jour de démarrage imposé (0 = premier jour), au lieu de la fin de la mission précédente. */
  debut?: number;
}

export interface ProposalPlanning {
  /** Affiche les flèches de dépendance entre missions dans le diagramme de l'écran. */
  showDependencies: boolean;
  /** Réglages par identifiant de mission (sans le préfixe « c_ » des lignes du calendrier). */
  items: Record<string, PlanningOverride>;
}

export const EMPTY_PLANNING: ProposalPlanning = { showDependencies: true, items: {} };

const wholeDays = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;

/** Lit le JSON enregistré sans jamais lever : une valeur illisible redonne le planning par défaut. */
export function parsePlanning(raw: string | null | undefined): ProposalPlanning {
  if (!raw) return { ...EMPTY_PLANNING, items: {} };
  try {
    const data = JSON.parse(raw);
    const items: Record<string, PlanningOverride> = {};
    for (const [id, o] of Object.entries((data && typeof data.items === 'object' && data.items) || {})) {
      const duree = wholeDays((o as PlanningOverride)?.duree);
      const debut = wholeDays((o as PlanningOverride)?.debut);
      if (duree !== undefined || debut !== undefined) {
        items[id] = { ...(duree !== undefined && duree > 0 ? { duree } : {}), ...(debut !== undefined ? { debut } : {}) };
      }
    }
    return { showDependencies: data?.showDependencies !== false, items };
  } catch {
    return { ...EMPTY_PLANNING, items: {} };
  }
}

/** Planning par défaut (rien de réglé, flèches affichées) : on n'enregistre alors rien. */
export function serializePlanning(p: ProposalPlanning): string | null {
  if (p.showDependencies && Object.keys(p.items).length === 0) return null;
  return JSON.stringify(p);
}

/** Retourne un nouveau planning avec le réglage de la mission modifié (undefined retire la clé). */
export function withOverride(p: ProposalPlanning, missionId: string, patch: PlanningOverride): ProposalPlanning {
  const next: PlanningOverride = { ...p.items[missionId], ...patch };
  if (next.duree === undefined) delete next.duree;
  if (next.debut === undefined) delete next.debut;
  const items = { ...p.items };
  if (Object.keys(next).length === 0) delete items[missionId];
  else items[missionId] = next;
  return { ...p, items };
}
