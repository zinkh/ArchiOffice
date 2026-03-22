import { db } from '../db';

export const isOnline = () => navigator.onLine;

export const processSyncQueue = async () => {
  if (!isOnline()) return;

  const queue = await db.syncQueue.toArray();
  for (const item of queue) {
    try {
      const url = item.table === 'projects' ? `/api/projects${item.method === 'PUT' ? '/' + item.data.id : ''}` : '';
      if (!url) continue;

      const res = await fetch(url, {
        method: item.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.data)
      });

      if (res.ok) {
        await db.syncQueue.delete(item.id!);
      }
    } catch (err) {
      console.error('Failed to sync item:', item, err);
    }
  }
};

export const syncData = async () => {
  if (!isOnline()) return;
  await processSyncQueue();
};

// Listen for online event
window.addEventListener('online', syncData);
