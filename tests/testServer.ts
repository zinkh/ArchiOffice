// Shared Supertest harness: mocks @supabase/supabase-js so createApp() (see
// server.ts) wires up against an in-memory FakeSupabaseAdmin instead of a
// real Supabase/PostgREST backend — see fakeSupabaseAdmin.ts for why.
import { vi } from 'vitest';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';

export const fakeSupabaseAdmin = new FakeSupabaseAdmin();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => fakeSupabaseAdmin,
}));

let appPromise: Promise<import('express').Express> | null = null;

// Vitest isolates each test file's module registry by default, so this
// module-level singleton gives one shared app (and one shared fake DB) per
// test *file*, not across files — tests within a file should use distinct
// tenant/user ids (see makeTenant()/makeUser() below) rather than relying on
// a reset between tests.
export async function getTestApp() {
  if (!appPromise) {
    appPromise = (async () => {
      process.env.SUPABASE_URL ||= 'https://fake.supabase.test';
      process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fake-service-role-key';
      const mod = await import('../server');
      const { app } = await mod.createApp();
      return app;
    })();
  }
  return appPromise;
}

let counter = 0;
function uniqueId(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

/** Seeds a tenant and returns its id. */
export function makeTenant(overrides: Record<string, any> = {}) {
  const id = uniqueId('tenant');
  fakeSupabaseAdmin.seed('tenants', [{ id, name: id, slug: id, ...overrides }]);
  return id;
}

/** Seeds a profile row + auth token for a user belonging to `tenantId`, and returns { userId, token }. */
export function makeUser(tenantId: string, systemRole: 'admin' | 'manager' | 'pm' | 'user' = 'user') {
  const userId = uniqueId('user');
  const email = `${userId}@example.test`;
  const token = uniqueId('token');
  fakeSupabaseAdmin.seed('profiles', [{ id: userId, tenant_id: tenantId, email, system_role: systemRole }]);
  fakeSupabaseAdmin.registerUser(token, { id: userId, email });
  return { userId, token };
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
