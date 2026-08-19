// Shared cache for GET /api/feed, used by both the Dashboard's ActivityFeed
// widget and the standalone Notifications page. Lets whichever mounts second
// render the already-fetched data immediately instead of a blank/loading
// state, and — since fetch() dedupes an in-flight request — keeps both from
// firing their own network call when their 30s polling ticks overlap.
import { apiFetch } from './api';

type Listener<T> = (items: T[]) => void;

class FeedCache<T> {
  private items: T[] | null = null;
  private listeners = new Set<Listener<T>>();
  private inFlight: Promise<T[]> | null = null;

  getSnapshot(): T[] | null {
    return this.items;
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async fetch(url: string): Promise<T[]> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = apiFetch<T[]>(url)
      .then(data => {
        this.items = data;
        this.listeners.forEach(l => l(data));
        return data;
      })
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  // Local-only update (e.g. after posting/liking) — bypasses the network but
  // still propagates to every mounted consumer.
  setItems(items: T[]): void {
    this.items = items;
    this.listeners.forEach(l => l(items));
  }
}

export const activeFeedCache = new FeedCache<any>();
export const archivedFeedCache = new FeedCache<any>();
