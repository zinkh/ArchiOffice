import { db } from '../db';

export const isOnline = () => navigator.onLine;

// Maps a syncQueue entry to its API URL and HTTP method
function resolveRequest(item: { table: string; method: string; data: any; url?: string }): { url: string; method: string } | null {
  // If the original URL was stored, use it directly
  if (item.url) return { url: item.url, method: item.method };

  const { table, method, data } = item;
  const id = data?.id;

  const routes: Record<string, string> = {
    projects: '/api/projects',
    contacts: '/api/contacts',
    tenders: '/api/tenders',
    proposals: '/api/proposals',
    invoices: '/api/invoices',
    milestones: '/api/milestones',
    tasks: '/api/tasks',
    contactCategories: '/api/contact-categories',
    projectCategories: '/api/project_categories',
    settings: '/api/settings',
    ordresDeService: '/api/ordres_de_service',
    specifications: '/api/specifications',
    visas: '/api/visas',
    receptions: '/api/receptions',
    reserves: '/api/reserves',
    plans: '/api/plans',
    documents: '/api/documents',
  };

  const base = routes[table];
  if (!base) return null;

  // PUT/DELETE need the id in the path; POST and settings PUT use base
  if ((method === 'PUT' || method === 'DELETE') && id && table !== 'settings') {
    return { url: `${base}/${id}`, method };
  }

  return { url: base, method };
}

export const processSyncQueue = async () => {
  if (!isOnline()) return;

  const queue = await db.syncQueue.orderBy('timestamp').toArray();
  if (queue.length === 0) return;

  console.log(`[sync] Processing ${queue.length} queued mutations`);

  for (const item of queue) {
    const resolved = resolveRequest(item);
    if (!resolved) {
      // Unknown table — remove to avoid infinite retry
      await db.syncQueue.delete(item.id!);
      continue;
    }

    try {
      const res = await fetch(resolved.url, {
        method: resolved.method,
        headers: { 'Content-Type': 'application/json' },
        body: resolved.method !== 'DELETE' ? JSON.stringify(item.data) : undefined,
      });

      if (res.ok) {
        await db.syncQueue.delete(item.id!);
        console.log(`[sync] Synced ${resolved.method} ${resolved.url}`);
      } else {
        console.warn(`[sync] Server rejected ${resolved.method} ${resolved.url}: ${res.status}`);
      }
    } catch {
      // Network still down — stop and keep remaining items in queue
      console.warn('[sync] Network error, stopping queue processing');
      break;
    }
  }
};

// Enqueue a mutation for later sync (call this when writing to Dexie offline)
export const enqueueMutation = async (table: string, method: string, data: any, url?: string) => {
  await db.syncQueue.add({ table, method, data, url, timestamp: Date.now() });
};

export const syncData = async () => {
  if (!isOnline()) return;
  await processSyncQueue();
};

window.addEventListener('online', syncData);
