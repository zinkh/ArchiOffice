// Liaison d'un jalon du planning de chantier avec un jalon de mission de l'affaire.
//
// Les jalons de mission sont les lignes de la table `milestones` (un jalon par mission incluse du contrat
// MOE : ESQ, APS, ..., DET, AOR) avec leur échéance. Un jalon du planning (`jalon: true`) peut y renvoyer par
// `jalonMission`. La liaison est une RÉFÉRENCE : rien ne se synchronise tout seul. L'écran et le PDF montrent
// l'écart entre les deux dates, et deux gestes explicites permettent de les aligner dans un sens ou dans l'autre.
// Logique pure, sans réseau.
import { estDateIso, joursEntre, type TachePlanning } from './planningChantier';

export interface JalonMission {
  id: string;
  title: string;
  /** AAAA-MM-JJ (la date d'une échéance enregistrée avec une heure est ramenée au jour). */
  due_date: string;
  completed: boolean;
}

/** Jalons de mission lisibles dans une réponse d'API : identifiant, intitulé et échéance valides, le reste est écarté. */
export function jalonsMissionDepuisApi(brut: unknown): JalonMission[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const jalons: JalonMission[] = [];
  for (const entree of brut) {
    if (!entree || typeof entree !== 'object') continue;
    const m = entree as Record<string, unknown>;
    const jour = typeof m.due_date === 'string' ? m.due_date.slice(0, 10) : '';
    if (typeof m.id !== 'string' || !m.id || vus.has(m.id) || typeof m.title !== 'string' || !m.title.trim() || !estDateIso(jour)) continue;
    vus.add(m.id);
    jalons.push({ id: m.id, title: m.title.trim(), due_date: jour, completed: m.completed === true });
  }
  return jalons.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.title.localeCompare(b.title));
}

export interface EcartJalonMission {
  mission: JalonMission;
  /** Jours entre la date du jalon du planning et celle de la mission : positif si la mission est plus tard. */
  jours: number;
}

/** Jalon de mission lié à un jalon du planning, s'il existe encore ; `jours` vaut 0 quand les deux dates coïncident. */
export function ecartJalonMission(tache: Pick<TachePlanning, 'jalon' | 'jalonMission' | 'debut'>, missions: JalonMission[]): EcartJalonMission | null {
  if (!tache.jalon || !tache.jalonMission || !estDateIso(tache.debut)) return null;
  const mission = missions.find(m => m.id === tache.jalonMission);
  return mission ? { mission, jours: joursEntre(tache.debut, mission.due_date) } : null;
}

/** Corps complet d'un `PUT /api/milestones/:id` (la route réécrit tous les champs) avec la nouvelle échéance. */
export function jalonMissionAvecDate(brut: unknown, id: string, date: string): Record<string, unknown> | null {
  if (!estDateIso(date) || !Array.isArray(brut)) return null;
  const ligne = brut.find((m): m is Record<string, unknown> => !!m && typeof m === 'object' && (m as Record<string, unknown>).id === id);
  return ligne ? { ...ligne, due_date: date } : null;
}
