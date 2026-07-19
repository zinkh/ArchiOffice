import { getAccessToken } from './authToken';

export const baseFetchJson = async <T = any>(url: string, options?: RequestInit): Promise<T> => {
  const fetchFn = (window as any)._originalFetch || window.fetch;
  const res = await fetchFn(url, options);

  if (!res.ok) {
    // Most endpoints reply with a JSON body ({ error: "..." }) describing what
    // actually went wrong server-side — surface that instead of a bare status
    // code, which by itself gives no way to tell a 500 apart from another.
    let message = `Failed to fetch ${url}: ${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      else if (body?.message) message = body.message;
    } catch {
      // Body wasn't JSON (e.g. an HTML error page) — keep the generic message.
    }
    const err: any = new Error(message);
    err.status = res.status;
    throw err;
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

// Authenticated fetch — injecte automatiquement le JWT (Supabase en ligne, local hors-ligne)
export const apiFetch = async <T = any>(url: string, options?: RequestInit): Promise<T> => {
  const token = await getAccessToken();

  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return baseFetchJson<T>(url, { ...options, headers });
};
