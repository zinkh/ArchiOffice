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
