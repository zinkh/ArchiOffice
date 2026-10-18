/** A cache failure must never prevent a network read, nor hide fresh data. */
export type ProjectLoadState = 'loading' | 'ready' | 'offline' | 'error' | 'not-found' | 'forbidden';

export async function loadProjectDetail({ id, signal, readCache, writeCache, onData,
  request = fetch, isOnline = () => navigator.onLine, timeoutMs = 20000,
}: {
  id: string;
  signal: AbortSignal;
  readCache: (id: string) => Promise<any | null>;
  writeCache: (data: any) => Promise<void>;
  onData: (data: any) => void;
  request?: typeof fetch;
  isOnline?: () => boolean;
  timeoutMs?: number;
}): Promise<ProjectLoadState> {
  try {
    const cached = await readCache(id);
    if (signal.aborted) return 'error';
    if (cached) onData(cached);
  } catch { /* Private browsing/storage failure: still try the server. */ }
  if (signal.aborted) return 'error';
  if (!isOnline()) return 'offline';

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const res = await request(`/api/projects/${encodeURIComponent(id)}/full`, { signal: controller.signal });
    if (signal.aborted) return 'error';
    if (!res.ok) {
      if (res.status === 404) return 'not-found';
      if (res.status === 401 || res.status === 403) return 'forbidden';
      return 'error';
    }
    const data = await res.json();
    if (signal.aborted) return 'error';
    onData(data);
    // Writing a local snapshot is best effort; the displayed server data is valid.
    try { await writeCache(data); } catch { /* Storage full or unavailable. */ }
    return 'ready';
  } catch {
    return isOnline() ? 'error' : 'offline';
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
