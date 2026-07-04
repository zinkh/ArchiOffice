import { supabase } from './supabase';

const originalFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : (input as Request).url;

  if (url.startsWith('/api/')) {
    let { data: { session }, error } = await supabase.auth.getSession();

    // Proactively refresh when the token is absent or close to expiry, so a
    // merely-stale token doesn't fall through as an unauthenticated request.
    if (!error && (!session?.access_token || (session.expires_at && session.expires_at * 1000 < Date.now() + 60_000))) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshed.session) {
        session = refreshed.session;
      } else if (refreshError) {
        error = refreshError;
      }
    }

    if (error) {
      // Stale/invalid refresh token — clear it so the auth state listener can redirect to login
      await supabase.auth.signOut();
    } else if (session?.access_token) {
      const headers = new Headers(init?.headers);
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
      return originalFetch(input, { ...init, headers });
    }
  }

  return originalFetch(input, init);
};
