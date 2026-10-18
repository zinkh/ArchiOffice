import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export interface GlobalSearchItem {
  id: string;
  _label?: string;
  client?: string;
  email?: string;
}
export interface GlobalSearchResults {
  projects: GlobalSearchItem[];
  contacts: GlobalSearchItem[];
  tenders: GlobalSearchItem[];
  invoices: GlobalSearchItem[];
}
export type GlobalSearchStatus = 'idle' | 'loading' | 'success' | 'error';
const emptyResults: GlobalSearchResults = { projects: [], contacts: [], tenders: [], invoices: [] };
const groups = ['projects', 'contacts', 'tenders', 'invoices'] as const;
type SearchRequest = (url: string, options: RequestInit) => Promise<GlobalSearchResults>;

/** A response belongs to one query, retry and cabinet/user context. */
export function useGlobalSearch(query: string, scopeKey: string, request: SearchRequest = apiFetch) {
  const normalizedQuery = query.trim();
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([scopeKey, normalizedQuery, attempt]);
  const [state, setState] = useState<{ key: string; status: GlobalSearchStatus; results: GlobalSearchResults }>({
    key: '', status: 'idle', results: emptyResults,
  });
  const retry = useCallback(() => setAttempt(n => n + 1), []);

  useEffect(() => {
    if (normalizedQuery.length < 2) {
      setState({ key, status: 'idle', results: emptyResults });
      return;
    }
    let active = true;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setState({ key, status: 'loading', results: emptyResults });
    const debounce = setTimeout(async () => {
      timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const data = await request(`/api/search?q=${encodeURIComponent(normalizedQuery)}`, { signal: controller.signal });
        if (!active) return;
        if (controller.signal.aborted || !data || groups.some(group => !Array.isArray(data[group]))) throw new Error('Search not confirmed');
        setState({ key, status: 'success', results: data });
      } catch {
        if (active) setState({ key, status: 'error', results: emptyResults });
      } finally {
        clearTimeout(timeout);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(debounce);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [key, normalizedQuery, request]);

  // Hide a previous query/context synchronously, before the effect cleans up.
  const current = state.key === key ? state : {
    key, status: normalizedQuery.length < 2 ? 'idle' as const : 'loading' as const, results: emptyResults,
  };
  return { ...current, retry, query: normalizedQuery, isSearching: current.status === 'loading' };
}
