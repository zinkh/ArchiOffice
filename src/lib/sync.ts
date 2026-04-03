import { baseFetchJson } from './api';

interface PendingChange {
  id: string;
  url: string;
  method: string;
  body: any;
  timestamp: number;
}

const STORAGE_KEY = 'archimanager_pending_changes';

class SyncManager {
  private pendingChanges: PendingChange[] = [];
  private listeners: ((count: number) => void)[] = [];
  private originalFetch = typeof window !== 'undefined' ? window.fetch.bind(window) : null;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window !== 'undefined' && this.originalFetch) {
      this.loadPendingChanges();
      this.patchFetch();
      window.addEventListener('online', () => this.sync());
      // Periodically try to sync if online
      this.syncIntervalId = setInterval(() => this.sync(), 30000);
    }
  }

  destroy() {
    if (this.syncIntervalId !== null) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  private patchFetch() {
    if (typeof window === 'undefined' || !this.originalFetch) return;
    
    const self = this;
    const originalFetch = this.originalFetch;
    (window as any)._originalFetch = originalFetch;
    
    const patchedFetch = async function(input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      const method = init?.method || 'GET';
      
      // Only handle internal API calls that are NOT GET
      if (method === 'GET' || !url.startsWith('/api/')) {
        return originalFetch(input, init);
      }

      // If offline, save to localStorage
      if (!navigator.onLine) {
        console.log(`Offline: saving ${method} ${url} to localStorage`);
        const change: PendingChange = {
          id: `change-${Date.now()}`,
          url,
          method,
          body: init?.body ? JSON.parse(init.body as string) : null,
          timestamp: Date.now(),
        };
        self.pendingChanges.push(change);
        self.savePendingChanges();
        
        return new Response(JSON.stringify({ success: true, offline: true, id: change.id }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // If online, try to execute and sync
      try {
        const response = await originalFetch(input, init);
        if (response.ok) {
          self.sync();
        }
        return response;
      } catch (error) {
        // Network error, save for later
        console.error('Network error, saving to localStorage', error);
        const change: PendingChange = {
          id: `change-${Date.now()}`,
          url,
          method,
          body: init?.body ? JSON.parse(init.body as string) : null,
          timestamp: Date.now(),
        };
        self.pendingChanges.push(change);
        self.savePendingChanges();
        
        return new Response(JSON.stringify({ success: true, offline: true, id: change.id }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    };

    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
      if (descriptor && !descriptor.configurable) {
        console.warn('window.fetch is not configurable, skipping patch');
        return;
      }

      Object.defineProperty(window, 'fetch', {
        value: patchedFetch,
        configurable: true,
        writable: true,
        enumerable: true
      });
    } catch (e) {
      console.warn('Failed to patch window.fetch', e);
    }
  }

  private loadPendingChanges() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        this.pendingChanges = JSON.parse(stored);
        this.notify();
      } catch (e) {
        console.error('Failed to parse pending changes', e);
        this.pendingChanges = [];
      }
    }
  }

  private savePendingChanges() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.pendingChanges));
    this.notify();
  }

  private notify() {
    this.listeners.forEach(l => l(this.pendingChanges.length));
  }

  onPendingCountChange(listener: (count: number) => void) {
    this.listeners.push(listener);
    listener(this.pendingChanges.length);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  async sync() {
    if (!navigator.onLine || this.pendingChanges.length === 0) return;

    console.log(`Syncing ${this.pendingChanges.length} changes...`);
    const changesToSync = [...this.pendingChanges];
    this.pendingChanges = [];
    this.savePendingChanges();

    for (const change of changesToSync) {
      try {
        await baseFetchJson(change.url, {
          method: change.method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(change.body),
        });
        console.log(`Synced change ${change.id}`);
      } catch (error) {
        console.error(`Failed to sync change ${change.id}`, error);
        // Put it back if it failed
        this.pendingChanges.push(change);
        this.savePendingChanges();
      }
    }
  }
  
  getPendingCount() {
    return this.pendingChanges.length;
  }
}

export const syncManager = new SyncManager();
