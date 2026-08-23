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
const AUTH_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('auth-timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function fetchAccessToken(): Promise<string | null> {
  let session: { access_token: string; expires_at?: number } | null = null;
  try {
    const result = await withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS);
    session = result.data.session;
  } catch {
    // getSession() hung rather than answering (slow network, a stuck cross-tab
    // lock) — that's inconclusive, not proof the session is invalid. Fail this
    // one call without wiping a possibly-still-good token; forcing a fresh
    // login over a transient timeout is worse than letting the caller retry.
    return null;
  }

  const needsRefresh = !session?.access_token || (session.expires_at && session.expires_at * 1000 < Date.now() + 60_000);
  if (needsRefresh) {
    try {
      const { data: refreshed, error } = await withTimeout(supabase.auth.refreshSession(), AUTH_TIMEOUT_MS);
      if (refreshed.session) {
        session = refreshed.session;
      } else if (error) {
        // Supabase actually responded and confirmed the refresh token itself
        // is dead (expired/revoked) — the session really is over.
        clearSupabaseAuthStorage();
        return null;
      }
    } catch {
      // refreshSession() hung — same as above, inconclusive. Keep whatever
      // session we already had rather than forcing a re-login over it.
    }
  }

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
    return cachedToken.value;
  }
  if (!inFlightToken) {
    inFlightToken = fetchAccessToken()
      .then((token) => {
        cachedToken = { value: token, expiresAt: Date.now() + TOKEN_CACHE_MS };
        return token;
      })
      .finally(() => { inFlightToken = null; });
  }
  return inFlightToken;
}

export { withTimeout, AUTH_TIMEOUT_MS };
