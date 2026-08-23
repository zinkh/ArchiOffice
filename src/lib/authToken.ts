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

// supabase-js's getSession()/refreshSession() can hang indefinitely (they
// serialize through a browser-wide exclusive Navigator LockManager lock and
// have no built-in timeout). Racing against a timeout keeps the app from being
// stuck behind an infinite spinner.
//
// 8s was too tight: a user on a corporate VPN hit this timeout on *every*
// getSession()/refreshSession() call, every time — not because the session was
// stuck, but because the VPN's added latency (plus queueing behind
// supabase-js's own internal auto-refresh, which serializes through the same
// Navigator Lock and makes a real network call to Supabase's Auth API) pushed
// otherwise-successful calls past 8s. 15s gives real (if slow) network
// conditions a realistic chance to complete instead of being cut off
// mid-flight.
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
// disproven in production: a user hit the exact same timeout on a *brand-new*
// session immediately after a fresh, successful login — the auto-wipe just
// forced them into a login loop. Don't wipe on a mere timeout — only clear the
// stored token when Supabase itself explicitly says the refresh token is dead
// (below), never on our own timeout budget running out.
let sessionDefinitelyGone = false;

/**
 * True only when Supabase itself answered and said the refresh token is dead
 * (expired/revoked). A timeout never sets this: a hung getSession() proves
 * nothing about whether the session is still valid.
 */
export function isSessionDefinitelyGone(): boolean {
  return sessionDefinitelyGone;
}

// Mirror of supabase-js's own in-memory session, kept current by the listener
// below. Reading the token from here costs nothing; calling getSession() takes
// the browser-wide exclusive Navigator LockManager lock on every single call,
// and a page load fires dozens of authenticated requests. supabase-js emits
// every session change (INITIAL_SESSION on boot, TOKEN_REFRESHED on each
// auto-refresh, SIGNED_IN/SIGNED_OUT), so the mirror stays in sync without us
// ever touching the lock in the steady state.
let mirroredSession: { access_token: string; expires_at?: number } | null = null;

// Treat a token expiring within the next minute as already stale, so a request
// can't go out with a token that dies in flight. supabase-js's own auto-refresh
// fires ~90s before expiry, so a live session refills the mirror before this
// margin is reached.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

function mirroredAccessToken(): string | null {
  if (!mirroredSession?.access_token) return null;
  if (mirroredSession.expires_at && mirroredSession.expires_at * 1000 < Date.now() + TOKEN_EXPIRY_MARGIN_MS) {
    return null;
  }
  return mirroredSession.access_token;
}

// Fallback path, for when the mirror above can't answer (before supabase-js has
// emitted its first session, or once the mirrored token is within its expiry
// margin): getAccessToken() is called independently by every apiFetch(), and a
// single page load routinely fires a dozen-plus concurrent authenticated
// requests (see Settings.tsx mounting: zoho/ragic/odoo/superpdp/chorus-pro
// status checks, project categories, tenant deletion, admin check, ...). Since
// getSession()/refreshSession() serialize through one browser-wide exclusive
// lock, a burst of concurrent callers each running their own check queues up
// behind that lock instead of running in parallel. Coalescing concurrent
// callers onto a single in-flight check, plus a short cache of the result, cuts
// a burst of N calls down to ~1 lock acquisition instead of N serialized ones.
let inFlightToken: Promise<string | null> | null = null;
let cachedToken: { value: string | null; expiresAt: number } | null = null;
const TOKEN_CACHE_MS = 3_000;

if (!isOfflineBuild()) {
  // IMPORTANT: this callback must stay synchronous. supabase-js invokes auth
  // state listeners *while holding* the exclusive Navigator LockManager lock,
  // so anything awaited in here keeps that lock held — and any Supabase call
  // made (directly or indirectly) from inside it deadlocks against the lock it
  // is itself blocking. See the comment in src/UserContext.tsx.
  supabase.auth.onAuthStateChange((_event, session) => {
    mirroredSession = session
      ? { access_token: session.access_token, expires_at: session.expires_at }
      : null;
    if (session) sessionDefinitelyGone = false;
    // The token just changed — the short cache above now holds a stale value.
    cachedToken = null;
  });
}

async function fetchAccessToken(): Promise<string | null> {
  let session: { access_token: string; expires_at?: number } | null = null;
  try {
    const result = await withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS);
    session = result.data.session;
  } catch {
    // getSession() hung rather than answering (slow network, a lock held by
    // another tab) — that's inconclusive, not proof the session is invalid.
    // Fail this one call without wiping a possibly-still-good token; forcing a
    // fresh login over a transient timeout is worse than letting the caller retry.
    return null;
  }

  const needsRefresh = !session?.access_token
    || (session.expires_at && session.expires_at * 1000 < Date.now() + TOKEN_EXPIRY_MARGIN_MS);
  if (needsRefresh) {
    try {
      const { data: refreshed, error } = await withTimeout(supabase.auth.refreshSession(), AUTH_TIMEOUT_MS);
      if (refreshed.session) {
        session = refreshed.session;
      } else if (error) {
        // Supabase actually responded and confirmed the refresh token itself
        // is dead (expired/revoked) — the session really is over.
        sessionDefinitelyGone = true;
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

/** Bearer token for the current session — branches offline (local JWT) vs cloud (Supabase). */
export async function getAccessToken(): Promise<string | null> {
  if (isOfflineBuild()) {
    return getStoredLocalSession()?.access_token ?? null;
  }

  // Steady state: answer from the mirrored session without taking the auth
  // lock at all, so a burst of requests costs zero lock acquisitions.
  const mirrored = mirroredAccessToken();
  if (mirrored) return mirrored;

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  if (inFlightToken) {
    return inFlightToken;
  }
  inFlightToken = fetchAccessToken()
    .then((token) => {
      cachedToken = { value: token, expiresAt: Date.now() + TOKEN_CACHE_MS };
      return token;
    })
    .finally(() => { inFlightToken = null; });
  return inFlightToken;
}

export { AUTH_TIMEOUT_MS };
