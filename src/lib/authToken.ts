import { supabase } from './supabase';

export function isOfflineBuild(): boolean {
  return import.meta.env.VITE_OFFLINE_MODE === 'true';
}

const LOCAL_SESSION_KEY = 'archioffice_local_session';

export interface LocalSessionUser {
  id: string;
  email: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  created_at: string;
}

export interface LocalSession {
  access_token: string;
  user: LocalSessionUser;
}

export function getStoredLocalSession(): LocalSession | null {
  const raw = localStorage.getItem(LOCAL_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalSession;
  } catch {
    return null;
  }
}

export function storeLocalSession(session: LocalSession): void {
  localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
}

export function clearLocalSession(): void {
  localStorage.removeItem(LOCAL_SESSION_KEY);
}

/**
 * Removes the persisted Supabase auth token from localStorage directly (bypassing
 * the SDK, which may itself be stuck — see AUTH_TIMEOUT_MS below). A poisoned/stuck
 * token is the one state that survives a page reload, so this is the only way to
 * make a hung auth bootstrap self-heal instead of requiring the user to clear all
 * browsing data.
 */
export function clearSupabaseAuthStorage(): void {
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // localStorage unavailable (private browsing, etc.) — nothing to clear.
  }
}

// supabase-js's getSession()/refreshSession() can hang indefinitely (e.g. a stuck
// cross-tab navigator.locks request, or a stale/invalid refresh token that never
// resolves) with no built-in timeout. Racing against a timeout keeps the app from
// being stuck behind an infinite spinner.
//
// 8s was too tight: a user on a corporate VPN hit this timeout on *every*
// getSession()/refreshSession() call, every time — not because the session was
// stuck, but because the VPN's added latency (plus queueing behind
// supabase-js's own internal auto-refresh, which serializes through the same
// Navigator Lock and makes a real network call to Supabase's Auth API) pushed
// otherwise-successful calls past 8s. Confirmed not a corrupted-token problem:
// clearing storage and forcing a fresh login (see git history — a
// consecutive-failures auto-wipe briefly lived here) hit the exact same
// timeout again on the brand-new session, since the new session needs the
// same slow round-trip. 15s gives real (if slow) network conditions a
// realistic chance to complete instead of being cut off mid-flight.
const AUTH_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('auth-timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

// A prior revision wiped the local token and forced a reload after a couple of
// consecutive getSession()/refreshSession() timeouts, on the theory that
// repeated failure meant a permanently corrupted token. That theory was
// disproven in production: a user on a corporate VPN hit the exact same
// timeout on a *brand-new* session immediately after a fresh, successful
// login — proving the failures were network latency, not a corrupted token,
// and the auto-wipe just forced them into a login loop. Don't wipe on a mere
// timeout — only clear the stored token when Supabase itself explicitly says
// the refresh token is dead (below), never on our own timeout budget running out.
//
// TEMPORARY diagnostics (round 2) — the VPN theory doesn't fully hold either:
// the same user hit the same 45s save-timeout again after getting off the
// VPN. Logging real timings again, without the auto-wipe this time, so the
// next reproduction shows whether it's still getSession()/refreshSession()
// timing out (and if so, on a plain network — pointing at something other
// than VPN latency) or something new. Remove once the culprit is found.
const authLog = (...args: unknown[]) => console.log('[authToken]', `+${Date.now() - authLogStart}ms`, ...args);
let authLogStart = Date.now();

async function fetchAccessToken(): Promise<string | null> {
  authLogStart = Date.now();
  authLog('fetchAccessToken: calling getSession()');
  let session: { access_token: string; expires_at?: number } | null = null;
  try {
    const result = await withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS);
    session = result.data.session;
    authLog('getSession() resolved', { hasToken: !!session?.access_token, expiresAt: session?.expires_at });
  } catch (err) {
    // getSession() hung rather than answering (slow network, a stuck cross-tab
    // lock) — that's inconclusive, not proof the session is invalid. Fail this
    // one call without wiping a possibly-still-good token; forcing a fresh
    // login over a transient timeout is worse than letting the caller retry.
    authLog('getSession() failed/timed out', err);
    return null;
  }

  const needsRefresh = !session?.access_token || (session.expires_at && session.expires_at * 1000 < Date.now() + 60_000);
  authLog('needsRefresh =', needsRefresh);
  if (needsRefresh) {
    try {
      authLog('calling refreshSession()');
      const { data: refreshed, error } = await withTimeout(supabase.auth.refreshSession(), AUTH_TIMEOUT_MS);
      authLog('refreshSession() resolved', { hasSession: !!refreshed.session, error });
      if (refreshed.session) {
        session = refreshed.session;
      } else if (error) {
        // Supabase actually responded and confirmed the refresh token itself
        // is dead (expired/revoked) — the session really is over.
        clearSupabaseAuthStorage();
        return null;
      }
    } catch (err) {
      // refreshSession() hung — same as above, inconclusive. Keep whatever
      // session we already had rather than forcing a re-login over it.
      authLog('refreshSession() failed/timed out', err);
    }
  }

  authLog('fetchAccessToken done, returning', { hasToken: !!session?.access_token });
  return session?.access_token ?? null;
}

// getAccessToken() is called independently by every apiFetch() — a single page
// load routinely fires a dozen-plus concurrent authenticated requests (see
// Settings.tsx mounting: zoho/ragic/odoo/superpdp/chorus-pro status checks,
// project categories, tenant deletion, admin check, ...). supabase-js's
// getSession()/refreshSession() serialize through a single exclusive
// browser-wide lock (Navigator LockManager) keyed on the auth storage key, so
// a burst of concurrent callers each re-running getSession()/refreshSession()
// queues up behind that one lock instead of running in parallel — enough of a
// pile-up can make a request issued into that same burst (e.g. a Settings
// save) wait past a client-side deadline despite the backend and network
// being entirely healthy (confirmed via DigitalOcean metrics showing zero
// server-side trace of the request during such a stall). Coalescing concurrent
// callers onto one in-flight check, plus a short cache of the result, cuts a
// burst of N calls down to ~1 lock acquisition instead of N serialized ones.
let inFlightToken: Promise<string | null> | null = null;
let cachedToken: { value: string | null; expiresAt: number } | null = null;
const TOKEN_CACHE_MS = 3_000;

/** Bearer token for the current session — branches offline (local JWT) vs cloud (Supabase). */
export async function getAccessToken(): Promise<string | null> {
  if (isOfflineBuild()) {
    return getStoredLocalSession()?.access_token ?? null;
  }

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    console.log('[authToken] getAccessToken: cache hit');
    return cachedToken.value;
  }
  if (inFlightToken) {
    console.log('[authToken] getAccessToken: joining in-flight check');
    return inFlightToken;
  }
  console.log('[authToken] getAccessToken: starting fresh check');
  inFlightToken = fetchAccessToken()
    .then((token) => {
      cachedToken = { value: token, expiresAt: Date.now() + TOKEN_CACHE_MS };
      return token;
    })
    .finally(() => { inFlightToken = null; });
  return inFlightToken;
}

export { withTimeout, AUTH_TIMEOUT_MS };
