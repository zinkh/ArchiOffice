import { supabase } from './supabase';

const originalFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : (input as Request).url;

  if (url.startsWith('/api/')) {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      // Stale refresh token — clear it so the auth state listener can redirect to login
      supabase.auth.signOut();
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
