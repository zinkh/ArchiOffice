import { getAccessToken, isOfflineBuild } from './authToken';
import { supabase } from './supabase';

const originalFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : (input as Request).url;

  if (url.startsWith('/api/')) {
    const token = await getAccessToken();

    if (!token && !isOfflineBuild()) {
      // Stale/invalid refresh token — clear it so the auth state listener can redirect to login
      await supabase.auth.signOut();
    } else if (token) {
      const headers = new Headers(init?.headers);
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return originalFetch(input, { ...init, headers });
    }
  }

  return originalFetch(input, init);
};
