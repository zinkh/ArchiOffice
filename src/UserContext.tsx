import * as React from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import type { TeamMember as UserProfile } from './types';
import { supabase } from './lib/supabase';
import { isOfflineBuild, getStoredLocalSession, clearLocalSession, AUTH_TIMEOUT_MS } from './lib/authToken';
import { rawFetch } from './lib/authInterceptor';
import { getActiveTenantId, setActiveTenantId } from './lib/activeTenant';
import { apiFetch } from './lib/api';
import { clearOfflineCache } from './lib/offline';
import { clearOfflineAuthSnapshot, getValidOfflineAuthSnapshot, requestPersistentOfflineStorage, saveOfflineAuthSnapshot } from './lib/offlineAuth';
import type { TenantMembership } from './types';

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
  /**
   * True once a password/OAuth sign-in has succeeded (Supabase issued a
   * session) but the account has TOTP MFA enrolled and the session hasn't
   * cleared the second-factor challenge yet ("aal1", not "aal2"). While
   * true, currentUser stays null on purpose — completing the challenge
   * (src/pages/Login.tsx's MfaChallengeForm) is what's supposed to flip
   * this to false and populate currentUser, not any earlier point in the
   * sign-in flow. This is what keeps a not-yet-verified session out of the
   * app for BOTH sign-in paths (password and Google OAuth) without
   * needing a check duplicated in each: OAuth's redirectTo lands straight
   * on "/", which ProtectedLayout guards with `if (!currentUser) redirect
   * to /login` — currentUser staying null here is what makes that existing
   * guard also cover the OAuth path for free.
   */
  mfaRequired: boolean;
  /**
   * Les cabinets où la personne exerce. Presque toujours un seul ; deux ou
   * plus pour un architecte associé à plusieurs structures (voir
   * supabase/migrate_tenant_memberships.sql). Le sélecteur de cabinet ne
   * s'affiche qu'au-delà d'un.
   */
  tenants: TenantMembership[];
  /** Le cabinet sur lequel cette session travaille. */
  activeTenantId: string | null;
  /**
   * Bascule de cabinet : enregistre le choix, vide le cache hors-ligne et
   * recharge l'application. Le rechargement n'est pas une facilité — chaque
   * écran garde en mémoire les affaires, contacts et réglages du cabinet
   * quitté, et il n'existe pas d'endroit unique où les invalider.
   */
  switchTenant: (tenantId: string) => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const AUTH_BOOTSTRAP_NETWORK_TIMEOUT_MS = 3_000;

async function withBootstrapTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('auth-bootstrap-timeout')), AUTH_BOOTSTRAP_NETWORK_TIMEOUT_MS);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function isBackendReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_BOOTSTRAP_NETWORK_TIMEOUT_MS);
  try {
    // rawFetch deliberately bypasses authInterceptor: /api/health is public,
    // and a connectivity probe must never wait on the Supabase auth lock.
    const response = await rawFetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** L'en-tête de cabinet, pour les appels qui n'empruntent pas l'intercepteur. */
function tenantHeader(): Record<string, string> {
  const tenantId = getActiveTenantId();
  return tenantId ? { 'X-Tenant-Id': tenantId } : {};
}

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
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        // rawFetch court-circuite l'intercepteur : le cabinet actif doit
        // être posé à la main, sinon /api/me décrirait le cabinet par défaut
        // alors que le reste de l'application travaille sur l'autre.
        ...tenantHeader(),
      },
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
      showPersonalContacts: profile.showPersonalContacts ?? true,
      mailSignature: profile.mailSignature ?? '',
      mailSenderEmail: profile.mailSenderEmail ?? '',
      // null = confirmed no agency yet (drives the /agency-setup redirect below);
      // offline builds have no /api/me tenantId field, so this stays undefined there.
      tenantId: profile.tenantId ?? null,
      isSuperAdmin: profile.isSuperAdmin ?? false,
      tenants: Array.isArray(profile.tenants) ? profile.tenants : [],
    };
  } catch {
    return base;
  }
}

async function loadBillingStatus(session: MinimalSession): Promise<{ plan: string; trial_ends_at: string | null; is_expired: boolean }> {
  try {
    const res = await rawFetch('/api/billing/status', {
      headers: { Authorization: `Bearer ${session.access_token}`, ...tenantHeader() },
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
  const [mfaRequired, setMfaRequired] = useState(false);
  const [tenants, setTenants] = useState<TenantMembership[]>([]);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(getActiveTenantId());
  const sessionRef = React.useRef<MinimalSession | null>(null);

  // Le cabinet servi est celui que le serveur a retenu (/api/me), pas celui
  // gardé localement : le second peut être périmé (départ du cabinet, session
  // ouverte pour un autre compte sur ce navigateur). Le realigner ici évite
  // que le sélecteur affiche un cabinet et que l'API en serve un autre.
  const applyProfileTenants = React.useCallback((user: UserProfile | null) => {
    const list = user?.tenants ?? [];
    setTenants(list);
    const served = list.find(t => t.isActive)?.tenantId ?? user?.tenantId ?? null;
    setActiveTenantIdState(served);
    setActiveTenantId(list.length > 1 ? served : null);
  }, []);

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
          applyProfileTenants(user);
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

    const restoreOfflineSnapshot = (expectedUserId?: string | null): boolean => {
      const snapshot = getValidOfflineAuthSnapshot(expectedUserId);
      if (!snapshot) return false;
      setCurrentUser({ ...snapshot.profile, tenants: snapshot.tenants });
      setTenants(snapshot.tenants);
      setActiveTenantIdState(snapshot.activeTenantId);
      setActiveTenantId(snapshot.tenants.length > 1 ? snapshot.activeTenantId : null);
      setTenantPlan(snapshot.billing.plan);
      setTrialEndsAt(snapshot.billing.trialEndsAt);
      setIsTrialExpired(snapshot.billing.isTrialExpired);
      setMfaRequired(false);
      return true;
    };

    // iPadOS can relaunch an installed PWA with no network at all. In that
    // situation Supabase cannot refresh an expired access token, so waiting
    // for INITIAL_SESSION/MFA would wrongly send an already-authorized user to
    // /login. Restore the last fully-validated identity immediately; cloud
    // validation takes over again on the next online event.
    if (typeof navigator !== 'undefined' && navigator.onLine === false && restoreOfflineSnapshot()) {
      setIsLoading(false);
    }

    const applySession = async (session: MinimalSession | null) => {
      if (cancelled) return;
      const previousUserId = sessionRef.current?.user.id ?? null;
      sessionRef.current = session;
      clearTimeout(bootstrapTimer);

      if (!session) {
        loadedUserId = null;
        const reachable = await isBackendReachable();
        if (cancelled) return;
        if (!reachable && restoreOfflineSnapshot(previousUserId)) {
          setIsLoading(false);
          return;
        }
        if (previousUserId) clearOfflineAuthSnapshot(previousUserId);
        setCurrentUser(null);
        applyProfileTenants(null);
        setMfaRequired(false);
        setIsLoading(false);
        return;
      }

      // navigator.onLine is only a hint. Probe our own API before any network
      // auth call so a captive/isolated Wi-Fi on iPad does not stall startup.
      const reachable = await isBackendReachable();
      if (cancelled) return;
      if (!reachable) {
        if (restoreOfflineSnapshot(session.user.id)) {
          setIsLoading(false);
          return;
        }
        setCurrentUser(null);
        applyProfileTenants(null);
        setMfaRequired(false);
        setIsLoading(false);
        return;
      }

      // Gate on the second factor before treating this session as "logged
      // in". This call still needs Supabase, so it has a short bootstrap
      // timeout and falls back to the previously validated offline identity
      // instead of trapping the PWA on the login screen when connectivity
      // disappears between the health probe and the auth request.
      let aal: any = null;
      try {
        const result = await withBootstrapTimeout(
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(session.access_token),
        );
        aal = result.data;
      } catch {
        if (restoreOfflineSnapshot(session.user.id)) {
          setIsLoading(false);
          return;
        }
        setCurrentUser(null);
        applyProfileTenants(null);
        setMfaRequired(false);
        setIsLoading(false);
        return;
      }
      if (cancelled) return;

      if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
        // Never let a previous offline grant bypass a newly-required MFA
        // challenge. A fresh snapshot will be issued after the challenge.
        clearOfflineAuthSnapshot(session.user.id);
        loadedUserId = null;
        setCurrentUser(null);
        setMfaRequired(true);
        setIsLoading(false);
        return;
      }
      setMfaRequired(false);

      if (loadedUserId === session.user.id) {
        setIsLoading(false);
        return;
      }

      loadedUserId = session.user.id;
      const [user, billing] = await Promise.all([loadFullProfile(session), loadBillingStatus(session)]);
      if (cancelled) return;

      // /api/me marks tenantId as defined (string or null). If it could not be
      // reached after the auth check, keep the richer last-known local profile
      // instead of replacing it with the bare JWT-derived fallback.
      if (user.tenantId === undefined && restoreOfflineSnapshot(session.user.id)) {
        loadedUserId = null;
        setIsLoading(false);
        return;
      }

      setCurrentUser(user);
      applyProfileTenants(user);
      setTenantPlan(billing.plan);
      setTrialEndsAt(billing.trial_ends_at);
      setIsTrialExpired(billing.is_expired);

      if (user.tenantId !== undefined) {
        saveOfflineAuthSnapshot({
          user,
          aal: aal?.currentLevel === 'aal2' ? 'aal2' : 'aal1',
          billing: {
            plan: billing.plan,
            trialEndsAt: billing.trial_ends_at,
            isTrialExpired: billing.is_expired,
          },
        });
        void requestPersistentOfflineStorage();
      }

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
      // If Supabase itself is wedged during bootstrap, prefer a still-valid
      // local grant to a false logout. This does not extend the grant: expiry
      // is checked inside getValidOfflineAuthSnapshot().
      restoreOfflineSnapshot();
      setIsLoading(false);
    }, AUTH_TIMEOUT_MS);

    const onOnline = () => {
      // Re-establish cloud authority as soon as connectivity returns. Do not
      // await inside an auth listener; this handler runs independently.
      if (sessionRef.current) {
        loadedUserId = null;
        void applySession(sessionRef.current);
        return;
      }
      void supabase.auth.getSession()
        .then(({ data }) => applySession(data.session as MinimalSession | null))
        .catch(() => {});
    };
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      clearTimeout(bootstrapTimer);
      window.removeEventListener('online', onOnline);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    // Le cabinet sélectionné est oublié à la déconnexion : le compte suivant
    // sur ce navigateur n'a aucune raison d'en être membre, et le serveur
    // refuserait alors chacune de ses requêtes (403 TENANT_NOT_MEMBER).
    setActiveTenantId(null);
    setActiveTenantIdState(null);
    setTenants([]);
    if (isOfflineBuild()) {
      clearLocalSession();
      setCurrentUser(null);
      return;
    }
    clearOfflineAuthSnapshot(sessionRef.current?.user.id ?? currentUser?.id ?? null);
    try {
      await supabase.auth.signOut();
    } finally {
      // Signing out locally must succeed even if the cloud is unreachable.
      // The offline grant was already removed above, so a reload cannot
      // silently reopen the workspace.
      sessionRef.current = null;
      setCurrentUser(null);
    }
  };

  const switchTenant = React.useCallback(async (tenantId: string) => {
    if (!tenantId || tenantId === activeTenantId) return;
    setActiveTenantId(tenantId);
    try {
      // Enregistré comme cabinet par défaut, pour qu'un autre poste rouvre
      // l'application sur le même. Un échec ici ne doit pas empêcher la
      // bascule : l'en-tête posé juste au-dessus suffit à cette session.
      await apiFetch('/api/tenants/switch', {
        method: 'POST',
        body: JSON.stringify({ tenantId }),
      });
    } catch {
      // sans effet sur la suite — voir ci-dessus
    }
    await clearOfflineCache();
    // Retour à l'accueil plutôt que rechargement de la page courante :
    // l'adresse affichée vise souvent une affaire, une facture ou un document
    // du cabinet qu'on vient de quitter, introuvable dans l'autre.
    window.location.assign('/');
  }, [activeTenantId]);

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
      mfaRequired,
      tenants,
      activeTenantId,
      switchTenant,
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
