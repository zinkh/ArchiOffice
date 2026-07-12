// Distinct from server.ts's `supabaseAdmin` (service-role, points at the
// LOCAL Postgres in offline mode — see electron/main.cjs). This client
// talks to the REAL cloud Supabase project, using only the public anon key
// — never a service-role key for the cloud project, which would give
// anyone who extracted it from the desktop installer unrestricted access
// to every tenant's data, not just the logged-in user's own. All cloud
// access goes through a normal Supabase Auth session (the user's real
// email/password), so Row Level Security applies exactly as it does for
// the live web app itself (src/lib/supabase.ts uses the identical pattern).
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function createCloudSupabaseClient(): SupabaseClient {
  const url = process.env.CLOUD_SUPABASE_URL;
  const anonKey = process.env.CLOUD_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('CLOUD_SUPABASE_URL/CLOUD_SUPABASE_ANON_KEY not configured — cloud-link is unavailable in this build.');
  }
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: true, persistSession: false },
  });
  return client;
}

/**
 * Only the refresh token is ever persisted (server/cloudLinkState.ts) —
 * access tokens are short-lived and there's no point storing one. Uses
 * refreshSession() rather than setSession() since we don't have a (possibly
 * already-expired) access_token to pass alongside it.
 */
export async function restoreCloudSession(client: SupabaseClient, refreshToken: string) {
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw error;
  return data.session;
}
