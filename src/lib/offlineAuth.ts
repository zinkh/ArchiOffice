import type { TeamMember as UserProfile, TenantMembership } from '../types';

const OFFLINE_AUTH_STORAGE_KEY = 'archioffice_offline_auth_v1';
export const OFFLINE_AUTH_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

export interface OfflineAuthBillingSnapshot {
  plan: string;
  trialEndsAt: string | null;
  isTrialExpired: boolean;
}

export interface OfflineAuthSnapshot {
  version: 1;
  userId: string;
  profile: UserProfile;
  tenants: TenantMembership[];
  activeTenantId: string | null;
  aal: 'aal1' | 'aal2';
  mfaSatisfied: boolean;
  validatedAt: number;
  validUntil: number;
  billing: OfflineAuthBillingSnapshot;
}

interface SaveOfflineAuthSnapshotInput {
  user: UserProfile;
  aal: 'aal1' | 'aal2';
  billing: OfflineAuthBillingSnapshot;
  now?: number;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function normalizeAal(value: unknown): 'aal1' | 'aal2' {
  return value === 'aal2' ? 'aal2' : 'aal1';
}

/**
 * Persists only the identity/profile state needed to reopen the already-cached
 * workspace while the cloud is unreachable. No access token or refresh token
 * is copied here; Supabase remains the authority as soon as connectivity is
 * available again.
 */
export function saveOfflineAuthSnapshot({
  user,
  aal,
  billing,
  now = Date.now(),
}: SaveOfflineAuthSnapshotInput): OfflineAuthSnapshot | null {
  const target = storage();
  if (!target || !user?.id) return null;

  const tenants = Array.isArray(user.tenants) ? user.tenants : [];
  const activeTenantId =
    tenants.find((tenant) => tenant.isActive)?.tenantId ??
    user.tenantId ??
    null;

  const snapshot: OfflineAuthSnapshot = {
    version: 1,
    userId: user.id,
    profile: { ...user, tenants },
    tenants,
    activeTenantId,
    aal: normalizeAal(aal),
    // This function is called only after UserContext has completed its online
    // AAL gate. If MFA was required but not satisfied, it never reaches here.
    mfaSatisfied: true,
    validatedAt: now,
    validUntil: now + OFFLINE_AUTH_VALIDITY_MS,
    billing,
  };

  try {
    target.setItem(OFFLINE_AUTH_STORAGE_KEY, JSON.stringify(snapshot));
    return snapshot;
  } catch {
    return null;
  }
}

export function getValidOfflineAuthSnapshot(
  expectedUserId?: string | null,
  now = Date.now(),
): OfflineAuthSnapshot | null {
  const target = storage();
  if (!target) return null;

  let parsed: OfflineAuthSnapshot;
  try {
    const raw = target.getItem(OFFLINE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw) as OfflineAuthSnapshot;
  } catch {
    return null;
  }

  if (
    parsed?.version !== 1 ||
    !parsed.userId ||
    !parsed.profile ||
    parsed.profile.id !== parsed.userId ||
    !parsed.mfaSatisfied ||
    !Number.isFinite(parsed.validatedAt) ||
    !Number.isFinite(parsed.validUntil) ||
    parsed.validUntil <= now
  ) {
    return null;
  }

  if (expectedUserId && parsed.userId !== expectedUserId) return null;

  return {
    ...parsed,
    aal: normalizeAal(parsed.aal),
    tenants: Array.isArray(parsed.tenants) ? parsed.tenants : [],
    billing: {
      plan: parsed.billing?.plan || 'trial',
      trialEndsAt: parsed.billing?.trialEndsAt ?? null,
      isTrialExpired: !!parsed.billing?.isTrialExpired,
    },
  };
}

export function clearOfflineAuthSnapshot(expectedUserId?: string | null): void {
  const target = storage();
  if (!target) return;

  try {
    if (expectedUserId) {
      const current = getValidOfflineAuthSnapshot(null, Number.NEGATIVE_INFINITY);
      if (current && current.userId !== expectedUserId) return;
    }
    target.removeItem(OFFLINE_AUTH_STORAGE_KEY);
  } catch {
    // A failed cleanup must never make sign-out itself fail.
  }
}

/**
 * Best-effort request for durable origin storage. Home-screen PWAs can be
 * granted persistent storage by the browser; refusal is harmless.
 */
export async function requestPersistentOfflineStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
