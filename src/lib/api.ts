import { supabase } from './supabase';

export const baseFetchJson = async <T = any>(url: string, options?: RequestInit): Promise<T> => {
  const fetchFn = (window as any)._originalFetch || window.fetch;
  const res = await fetchFn(url, options);

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await res.text();
    if (text.includes('Please wait while your application starts')) {
      throw new Error('Server is still starting. Please wait a moment and refresh.');
    }
    throw new Error(`Expected JSON response from ${url} but received ${contentType || 'unknown content type'}`);
  }

  return res.json();
};

export const fetchJson = async <T = any>(url: string, options?: RequestInit): Promise<T> => {
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return baseFetchJson<T>(url, { ...options, headers });
};

// Authenticated fetch — injecte automatiquement le JWT Supabase
// Tente un refresh de session si le token est absent ou expiré, puis réessaie une fois.
export const apiFetch = async <T = any>(url: string, options?: RequestInit): Promise<T> => {
  let { data: { session } } = await supabase.auth.getSession();

  // If no session or token is close to expiry, try a silent refresh first
  if (!session?.access_token || (session.expires_at && session.expires_at * 1000 < Date.now() + 60_000)) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed.session) session = refreshed.session;
  }

  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return baseFetchJson<T>(url, { ...options, headers });
};
