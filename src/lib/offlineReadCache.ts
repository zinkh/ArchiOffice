import type { Table } from 'dexie';
import { db } from '../db';

/**
 * Lecture « cache d'abord » pour une liste scopée (les réunions d'une
 * affaire, les réserves d'un projet, les observations d'un compte rendu…).
 *
 * Volontairement différent d'un simple `table.clear()` + `bulkPut()` : ces
 * tables Dexie portent les données de PLUSIEURS affaires à la fois (on
 * navigue d'un projet à l'autre sans jamais tout recharger), donc vider la
 * table entière à chaque appel effacerait le cache de toutes les autres
 * affaires déjà consultées. `scopeFilter` désigne le sous-ensemble
 * concerné : seules ces lignes sont remplacées.
 *
 * Réseau indisponible : les données déjà en cache restent affichées telles
 * quelles, sans effacement — c'est tout l'intérêt du cache hors-ligne.
 */
export async function cachedListFirst<T extends { id: string }>(
  table: Table<T, string>,
  scopeFilter: (row: T) => boolean,
  apiUrl: string,
  setter: (data: T[]) => void,
): Promise<{ hadLocalData: boolean; synced: boolean }> {
  let local: T[] = [];
  try {
    local = (await table.toArray()).filter(scopeFilter);
  } catch {
    // IndexedDB indisponible (navigation privée, quota…) : pas de cache,
    // on retombe simplement sur le réseau ci-dessous.
  }
  if (local.length > 0) setter(local);

  if (!navigator.onLine) return { hadLocalData: local.length > 0, synced: false };

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote: T[] = await response.json();
    setter(remote);

    const remoteIds = new Set(remote.map(r => r.id));
    const staleIds = local.filter(r => !remoteIds.has(r.id)).map(r => r.id);
    await db.transaction('rw', table, async () => {
      if (staleIds.length > 0) await table.bulkDelete(staleIds);
      if (remote.length > 0) await table.bulkPut(remote);
    });
    return { hadLocalData: local.length > 0, synced: true };
  } catch {
    // Le réseau a échoué après le rendu optimiste depuis le cache : on
    // garde ce qui est déjà affiché plutôt que de vider l'écran.
    return { hadLocalData: local.length > 0, synced: false };
  }
}
