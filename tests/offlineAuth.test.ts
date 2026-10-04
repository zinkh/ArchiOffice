import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOfflineAuthSnapshot,
  getValidOfflineAuthSnapshot,
  OFFLINE_AUTH_VALIDITY_MS,
  saveOfflineAuthSnapshot,
} from '../src/lib/offlineAuth';

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function save(now = 1_000) {
  return saveOfflineAuthSnapshot({
    user: {
      id: 'user-1',
      email: 'architecte@example.test',
      name: 'Architecte',
      system_role: 'admin',
      role: 'admin',
      tenantId: 'tenant-1',
      tenants: [{ tenantId: 'tenant-1', name: 'Agence', isActive: true }],
    } as any,
    aal: 'aal2',
    billing: {
      plan: 'pro',
      trialEndsAt: null,
      isTrialExpired: false,
    },
    now,
  });
}

describe('offline auth snapshot', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorage());
  });

  it('restores a fully validated identity for the same user', () => {
    const snapshot = save();
    expect(snapshot?.mfaSatisfied).toBe(true);
    expect(snapshot?.aal).toBe('aal2');

    const restored = getValidOfflineAuthSnapshot('user-1', 2_000);
    expect(restored?.profile.email).toBe('architecte@example.test');
    expect(restored?.activeTenantId).toBe('tenant-1');
    expect(restored?.billing.plan).toBe('pro');
  });

  it('never serializes an access or refresh token into the offline grant', () => {
    save();
    const serialized = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return key ? localStorage.getItem(key) : null;
    }).join(' ');

    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('refresh_token');
  });

  it('refuses an expired grant', () => {
    save();
    expect(getValidOfflineAuthSnapshot('user-1', 1_000 + OFFLINE_AUTH_VALIDITY_MS + 1)).toBeNull();
  });

  it('refuses a grant belonging to another account', () => {
    save();
    expect(getValidOfflineAuthSnapshot('user-2', 2_000)).toBeNull();
  });

  it('does not clear another user grant when an expected id is supplied', () => {
    save();
    clearOfflineAuthSnapshot('user-2');
    expect(getValidOfflineAuthSnapshot('user-1', 2_000)).not.toBeNull();

    clearOfflineAuthSnapshot('user-1');
    expect(getValidOfflineAuthSnapshot('user-1', 2_000)).toBeNull();
  });
});
