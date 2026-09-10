import { db } from '../db';
import { Table } from 'dexie';

export async function getOfflineFirst<T>(
  table: Table<T>,
  apiUrl: string,
  setter: (data: T[]) => void
) {
  // 1. Load from IndexedDB
  const localData = await table.toArray();
  if (localData.length > 0) {
    setter(localData);
  }

  // 2. Fetch from API
  if (navigator.onLine) {
    try {
      const response = await fetch(apiUrl);
      const remoteData = await response.json();
      
      // 3. Update IndexedDB
      await table.clear();
      await table.bulkPut(remoteData);
      
      // 4. Update UI
      setter(remoteData);
    } catch (error) {
      console.error(`Failed to fetch from ${apiUrl}:`, error);
    }
  }
}

/**
 * Vide le cache hors-ligne (IndexedDB).
 *
 * Appelé à la bascule d'un cabinet à l'autre : les tables Dexie ci-dessus
 * gardent projets, contacts, factures... sans mention du cabinet dont ils
 * viennent. Sans ce nettoyage, le premier rendu après la bascule afficherait
 * les affaires du cabinet précédent, le temps que l'API réponde — et
 * durablement si la connexion est coupée.
 */
export async function clearOfflineCache(): Promise<void> {
  try {
    await Promise.all(db.tables.map(table => table.clear()));
  } catch (error) {
    // Un cache qu'on n'a pas pu vider ne doit pas empêcher la bascule :
    // l'application repart de toute façon sur les données de l'API.
    console.error('[offline] Vidage du cache impossible :', error);
  }
}
