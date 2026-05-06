import { Table } from 'dexie';
import { enqueueMutation } from '../services/syncService';

export async function getOfflineFirst<T>(
  table: Table<T>,
  apiUrl: string,
  setter: (data: T[]) => void
) {
  const localData = await table.toArray();
  if (localData.length > 0) {
    setter(localData);
  }

  if (navigator.onLine) {
    try {
      const response = await fetch(apiUrl);
      const remoteData = await response.json();
      await table.clear();
      await table.bulkPut(remoteData);
      setter(remoteData);
    } catch (error) {
      console.error(`Failed to fetch from ${apiUrl}:`, error);
    }
  }
}

// Offline-safe mutation: writes to Dexie first, syncs to server if online,
// otherwise enqueues for later replay via syncService.
export async function offlineMutate<T>(
  table: Table<T>,
  tableKey: string,
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  data: T
): Promise<T> {
  const id = (data as any)?.id;

  if (method === 'DELETE') {
    await table.delete(id);
  } else if (id) {
    // Only write to Dexie pre-emptively if we have a primary key
    await table.put(data);
  }

  if (navigator.onLine) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method !== 'DELETE' ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (method !== 'DELETE') {
      const result: T = await res.json();
      await table.put(result);
      return result;
    }
  } else if (id) {
    await enqueueMutation(tableKey, method, data, url);
  }

  return data;
}
