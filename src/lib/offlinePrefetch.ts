import { db } from '../db';
import { cachedListFirst } from './offlineReadCache';

/**
 * Préchargement en LECTURE SEULE des projets cochés « disponible hors
 * connexion » (`projects.offline_enabled`, voir
 * supabase/migrate_project_offline_enabled.sql).
 *
 * Différent des tables `*Cache` de offlineReadCache.ts, qui se remplissent
 * déjà « gratuitement » au fil de la navigation (ouvrir une fiche projet en
 * ligne la met en cache, quel que soit le réglage) : ce module sert à
 * PRÉ-remplir ce même cache pour un projet qu'on n'a pas encore ouvert
 * aujourd'hui — le cas réel visé, arriver sur un chantier déjà hors
 * connexion sans avoir d'abord consulté chaque onglet en ligne.
 *
 * Volontairement pas de nouvelle route serveur ni de synchro d'écriture :
 * seuls des GET déjà existants, rappelés en tâche de fond. Un cabinet qui ne
 * coche jamais cette case ne voit rien changer.
 */

export interface ProjectSnapshot {
  id: string;
  data: any;
  cachedAt: number;
}

/** Le même payload que `GET /api/projects/:id/full`, mis en cache tel quel. */
export async function cachedProjectSnapshot(projectId: string): Promise<any | null> {
  const row = await db.projectSnapshots.get(projectId);
  return row?.data ?? null;
}

async function prefetchProjectFull(projectId: string): Promise<void> {
  try {
    const response = await fetch(`/api/projects/${projectId}/full`);
    if (!response.ok) return;
    const data = await response.json();
    await db.projectSnapshots.put({ id: projectId, data, cachedAt: Date.now() });
  } catch {
    // Hors-ligne ou coupure en cours de préchargement : le cache existant
    // (le cas échéant, d'un précédent passage en ligne) reste en place.
  }
}

/**
 * Précharge les listes « suivi de chantier » d'un projet — les mêmes
 * entités déjà fiabilisées en écriture (voir CLAUDE.md « fiabiliser la
 * synchro hors-ligne ») : réunions du projet lui-même, réserves OPR/GPA,
 * observations. Les réunions liées à un devis/appel d'offres ne sont pas
 * préchargées ici (moins centrales à l'usage chantier) — elles se mettent
 * en cache normalement dès qu'on ouvre l'onglet Réunions en ligne.
 */
async function prefetchProjectChantier(projectId: string): Promise<void> {
  await Promise.all([
    cachedListFirst(
      db.meetingsCache,
      m => m.project_id === projectId && m.type === 'projet',
      `/api/meetings?project_id=${projectId}&type=projet`,
      () => {},
    ),
    cachedListFirst(db.reservesCache, r => r.project_id === projectId, `/api/reserves?project_id=${projectId}`, () => {}),
    cachedListFirst(db.gpaReservesCache, r => r.project_id === projectId, `/api/gpa-reserves?project_id=${projectId}`, () => {}),
    cachedListFirst(db.observationsCache, o => o.project_id === projectId, `/api/projects/${projectId}/observations`, () => {}),
  ]);
}

/** Précharge tout le nécessaire pour UN projet — appelé à la coche de la case, immédiatement. */
export async function prefetchProjectForOffline(projectId: string): Promise<void> {
  if (!navigator.onLine) return;
  await Promise.all([prefetchProjectFull(projectId), prefetchProjectChantier(projectId)]);
}

let refreshing = false;

/**
 * Rafraîchit en tâche de fond tous les projets cochés — appelé après le
 * chargement de la liste des projets (src/pages/Projects.tsx), pour que le
 * cache ne devienne pas périmé entre deux visites d'un chantier. Jamais
 * bloquant pour l'affichage, jamais deux passes en même temps.
 */
export async function refreshOfflineProjects(projects: { id: string; offline_enabled?: boolean }[]): Promise<void> {
  if (refreshing || !navigator.onLine) return;
  const flagged = projects.filter(p => p.offline_enabled).map(p => p.id);
  if (flagged.length === 0) return;
  refreshing = true;
  try {
    for (const projectId of flagged) {
      await prefetchProjectForOffline(projectId);
    }
  } finally {
    refreshing = false;
  }
}
