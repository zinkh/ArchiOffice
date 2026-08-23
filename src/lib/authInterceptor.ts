import { getAccessToken, isOfflineBuild, isSessionDefinitelyGone } from './authToken';
import { supabase } from './supabase';

/**
 * `window.fetch` as it was before this module wrapped it — i.e. without the
 * token injection below. Use it for requests that already carry their own
 * Authorization header: going through the wrapper would make them wait on the
 * Supabase auth lock for a token they don't need, and inside an auth state
 * callback (which supabase-js runs while holding that lock) that wait never
 * ends. See src/UserContext.tsx.
 */
export const rawFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : (input as Request).url;

  if (url.startsWith('/api/')) {
    const token = await getAccessToken();

    if (!token && !isOfflineBuild()) {
      // No token. Sign out only when Supabase actually told us the refresh
      // token is dead — so the auth state listener redirects to login. A null
      // token from a timeout is inconclusive, and signing out over one both
      // logs the user out of a still-valid session and (since signOut() takes
      // the same auth lock that just timed out) blocks this request behind it.
      // Fire and forget: never await a lock-taking call on the request path.
      if (isSessionDefinitelyGone()) {
        void supabase.auth.signOut();
      }
    } else if (token) {
      const headers = new Headers(init?.headers);
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return rawFetch(input, { ...init, headers });
    }
  }

  return rawFetch(input, init);
};
