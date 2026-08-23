import * as React from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import type { TeamMember as UserProfile } from './types';
import { supabase } from './lib/supabase';
import { isOfflineBuild, getStoredLocalSession, clearLocalSession, AUTH_TIMEOUT_MS } from './lib/authToken';
import { rawFetch } from './lib/authInterceptor';

// Structurally compatible with both a real Supabase Session/User and our
// locally-signed offline session (src/lib/authToken.ts) — the functions below
// only ever read these fields, from whichever source is active.
interface MinimalUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, any>;
  app_metadata?: Record<string, any>;
}
interface MinimalSession {
  access_token: string;
  expires_at?: number;
  user: MinimalUser;
}

interface UserContextType {
  currentUser: UserProfile | null;
  setCurrentUser: (user: UserProfile | null) => void;
  allUsers: UserProfile[];
  isLoading: boolean;
  headerTitle: string;
  setHeaderTitle: (title: string) => void;
  signOut: () => Promise<void>;
  tenantPlan: string;
  trialEndsAt: string | null;
  isTrialExpired: boolean;
  refreshBillingStatus: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

function mapSupabaseUser(user: MinimalUser): UserProfile {
  return {
    id: user.id,
    email: user.email ?? '',
    name: user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'Utilisateur',
    system_role: (user.app_metadata?.system_role as UserProfile['system_role']) ?? 'admin',
    role: user.user_metadata?.role ?? 'admin',
    avatar: user.user_metadata?.avatar_url,
    // Unknown until /api/me responds — treated as "loading", not "no tenant".
    tenantId: undefined,
  };
}

async function loadFullProfile(session: MinimalSession): Promise<UserProfile> {
  const base = mapSupabaseUser(session.user);
  try {
    // rawFetch, not window.fetch: we already hold the access token, so there is
    // nothing for the auth interceptor to add — and going through it would make
    // this call wait on the Supabase auth lock for no reason.
    const res = await rawFetch('/api/me', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return base;
    const profile = await res.json();
    if (!profile) return base;
    return {
      ...base,
      // Authoritative role lives in `profiles` (DB), not Supabase Auth
      // app_metadata — without this override every user falls back to the
      // `?? 'admin'` default in mapSupabaseUser above, since app_metadata.system_role
      // is never actually set on the auth user.
      system_role: profile.system_role ?? base.system_role,
      role: profile.role ?? base.role,
      // Custom avatar overrides OAuth avatar if set
      avatar: profile.avatar || base.avatar,
      phone: profile.phone ?? undefined,
      address: profile.address ?? undefined,
      jobTitle: profile.jobTitle ?? undefined,
      department: profile.department ?? undefined,
      senderOption: profile.senderOption ?? undefined,
      defaultEmailTemplate: profile.defaultEmailTemplate ?? undefined,
      // null = confirmed no agency yet (drives the /agency-setup redirect below);
      // offline builds have no /api/me tenantId field, so this stays undefined there.
      tenantId: profile.tenantId ?? null,
      isSuperAdmin: profile.isSuperAdmin ?? false,
    };
  } catch {
    return base;
  }
}

async function loadBillingStatus(session: MinimalSession): Promise<{ plan: string; trial_ends_at: string | null; is_expired: boolean }> {
  try {
    const res = await rawFetch('/api/billing/status', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return { plan: 'trial', trial_ends_at: null, is_expired: false };
    const data = await res.json();
    return {
      plan: data.plan || 'trial',
      trial_ends_at: data.trial_ends_at ?? null,
      is_expired: !!data.is_expired,
    };
  } catch {
    return { plan: 'trial', trial_ends_at: null, is_expired: false };
  }
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [headerTitle, setHeaderTitle] = useState('Dashboard');
  const [tenantPlan, setTenantPlan] = useState('trial');
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [isTrialExpired, setIsTrialExpired] = useState(false);
  const sessionRef = React.useRef<MinimalSession | null>(null);

  const refreshBillingStatus = React.useCallback(async () => {
    if (!sessionRef.current) return;
    const billing = await loadBillingStatus(sessionRef.current);
    setTenantPlan(billing.plan);
    setTrialEndsAt(billing.trial_ends_at);
    setIsTrialExpired(billing.is_expired);
  }, []);

  useEffect(() => {
    if (isOfflineBuild()) {
      // No Supabase Auth involved offline — the local session (see src/lib/localAuth.ts
      // and src/lib/authToken.ts) is read once on mount; login/setup force a full
      // page reload afterward so this effect re-runs and picks it up.
      const local = getStoredLocalSession();
      if (local) {
        sessionRef.current = local;
        Promise.all([loadFullProfile(local), loadBillingStatus(local)]).then(([user, billing]) => {
          setCurrentUser(user);
          setTenantPlan(billing.plan);
          setTrialEndsAt(billing.trial_ends_at);
          setIsTrialExpired(billing.is_expired);
          setIsLoading(false);
        });
      } else {
        setCurrentUser(null);
        setIsLoading(false);
      }
      return;
    }

    let cancelled = false;
    let bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
    // Which user's profile/billing this listener has already fetched, so the
    // repeat events for one signed-in user (INITIAL_SESSION then SIGNED_IN, and
    // TOKEN_REFRESHED on every auto-refresh — roughly hourly) don't re-fetch a
    // profile we already have.
    let loadedUserId: string | null = null;

    const applySession = async (session: MinimalSession | null) => {
      if (cancelled) return;
      sessionRef.current = session;
      clearTimeout(bootstrapTimer);
      if (!session) {
        loadedUserId = null;
        setCurrentUser(null);
        setIsLoading(false);
        return;
      }
      if (loadedUserId === session.user.id) {
        setIsLoading(false);
        return;
      }
      loadedUserId = session.user.id;
      const [user, billing] = await Promise.all([loadFullProfile(session), loadBillingStatus(session)]);
      if (cancelled) return;
      setCurrentUser(user);
      setTenantPlan(billing.plan);
      setTrialEndsAt(billing.trial_ends_at);
      setIsTrialExpired(billing.is_expired);
      setIsLoading(false);
    };

    // supabase-js emits INITIAL_SESSION to every new subscriber once it has
    // read the persisted session, so this listener alone bootstraps the app —
    // no separate getSession() call, and therefore one less acquisition of the
    // browser-wide auth lock during the busiest moment of the page load.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Session temporaire créée par le lien de réinitialisation de mot de passe —
        // ne pas authentifier automatiquement l'utilisateur dans l'app, la page
        // /reset-password gère ce flux séparément.
        return;
      }
      // This callback MUST stay synchronous, and must not await anything.
      // supabase-js awaits auth state listeners *inside* its exclusive
      // Navigator LockManager lock, so an `async` callback holds that lock
      // until it settles. This one used to await /api/me and
      // /api/billing/status, which went through the patched window.fetch
      // (src/lib/authInterceptor.ts) -> getAccessToken() -> getSession().
      // getSession() then hit GoTrueClient._acquireLock's reentrant branch
      // (`if (this.lockAcquired)`), which waits on the queued operation that is
      // itself waiting on this callback — a circular wait, and one that its own
      // 5s lockAcquireTimeout never covers because that branch never goes near
      // navigator.locks. The outer `finally` that resets `lockAcquired` then
      // never ran, so *every* later getSession()/refreshSession() in the tab
      // took the same poisoned branch and hung until our 15s auth-timeout —
      // permanently, until a reload. That is the state the console shows:
      // `auth-timeout` on every call plus `Acquiring an exclusive Navigator
      // LockManager lock "lock:sb-...-auth-token" immediately failed` from the
      // auto-refresh tick. Supabase documents the underlying bug:
      // https://supabase.com/docs/guides/troubleshooting/why-is-my-supabase-api-call-not-returning-PGzXw0
      // Deferring to a macrotask lets supabase-js release the lock first.
      setTimeout(() => { void applySession(session); }, 0);
    });

    // Safety net: if supabase-js never emits (e.g. its own bootstrap is wedged
    // on a network stall), stop showing the spinner and fall back to the login
    // screen instead of hanging forever. Doesn't wipe the stored token — a
    // timeout says nothing about whether the session is still valid, and the
    // listener above still applies the session if it arrives late.
    bootstrapTimer = setTimeout(() => {
      setIsLoading(false);
    }, AUTH_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(bootstrapTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    if (isOfflineBuild()) {
      clearLocalSession();
      setCurrentUser(null);
      return;
    }
    await supabase.auth.signOut();
    setCurrentUser(null);
  };

  return (
    <UserContext.Provider value={{
      currentUser,
      setCurrentUser,
      allUsers: currentUser ? [currentUser] : [],
      isLoading,
      headerTitle,
      setHeaderTitle,
      signOut,
      tenantPlan,
      trialEndsAt,
      isTrialExpired,
      refreshBillingStatus,
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
