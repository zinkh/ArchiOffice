import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

/** A read never presents a failure as an empty list or reuses another project's data. */
export function useStudyList<T>(url: string) {
  const [attempt, setAttempt] = useState(0);
  const key = `${url}:${attempt}`;
  const [result, setResult] = useState<{ key: string; status: 'loading' | 'success' | 'error'; data: T[] }>({ key, status: 'loading', data: [] });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (!active) return;
      active = false;
      controller.abort();
      setResult({ key, status: 'error', data: [] });
    }, 20_000);
    setResult({ key, status: 'loading', data: [] });
    apiFetch<T[]>(url, { signal: controller.signal }).then(data => {
      if (!Array.isArray(data)) throw new Error('Expected a list');
      if (active) setResult({ key, status: 'success', data });
    }).catch(() => {
      if (active) setResult({ key, status: 'error', data: [] });
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [url, key]);
  return {
    ...(result.key === key ? result : { status: 'loading' as const, data: [] as T[] }),
    retry: () => setAttempt(value => value + 1),
  };
}
