// L'abonnement d'un poste lié au cloud : recopié du cloud, jamais deviné.
// Clients factices (aucun réseau) : seul le contrat de server/cloudTenantPlan.ts
// est vérifié.
import { describe, it, expect } from 'vitest';
import { readCloudTenantPlan, pullTenantPlan } from '../server/cloudTenantPlan';

type Result = { data: unknown; error: { message: string } | null };

function cloudStub(result: Result | (() => never)) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (typeof result === 'function' ? result() : result),
        }),
      }),
    }),
  } as any;
}

function localStub(writes: Array<{ values: unknown; id: unknown }>, error: { message: string } | null = null) {
  return {
    from: () => ({
      update: (values: unknown) => ({
        eq: async (_column: string, id: unknown) => {
          writes.push({ values, id });
          return { error };
        },
      }),
    }),
  } as any;
}

describe('readCloudTenantPlan', () => {
  it('rend le plan et la fin de période du cabinet', async () => {
    const cloud = cloudStub({ data: { plan: 'pro', trial_ends_at: '2026-11-25T00:00:00Z' }, error: null });
    expect(await readCloudTenantPlan(cloud, 'tenant-1')).toEqual({ plan: 'pro', trial_ends_at: '2026-11-25T00:00:00Z' });
  });

  it('garde une fin de période absente à null', async () => {
    const cloud = cloudStub({ data: { plan: 'enterprise', trial_ends_at: null }, error: null });
    expect(await readCloudTenantPlan(cloud, 'tenant-1')).toEqual({ plan: 'enterprise', trial_ends_at: null });
  });

  it('rend null sur une erreur de lecture', async () => {
    const cloud = cloudStub({ data: null, error: { message: 'JWT expired' } });
    expect(await readCloudTenantPlan(cloud, 'tenant-1')).toBeNull();
  });

  it('rend null sans plan lisible plutôt que de vider l\'état local', async () => {
    const cloud = cloudStub({ data: { plan: null, trial_ends_at: null }, error: null });
    expect(await readCloudTenantPlan(cloud, 'tenant-1')).toBeNull();
  });
});

describe('pullTenantPlan', () => {
  it('écrit l\'abonnement du cloud dans la base locale', async () => {
    const writes: Array<{ values: unknown; id: unknown }> = [];
    const cloud = cloudStub({ data: { plan: 'pro', trial_ends_at: '2026-11-25T00:00:00Z' }, error: null });

    expect(await pullTenantPlan(cloud, localStub(writes), 'tenant-1')).toBe(true);
    expect(writes).toEqual([{ values: { plan: 'pro', trial_ends_at: '2026-11-25T00:00:00Z' }, id: 'tenant-1' }]);
  });

  it('n\'écrit rien quand le cloud n\'est pas lisible (session expirée)', async () => {
    const writes: Array<{ values: unknown; id: unknown }> = [];
    const cloud = cloudStub({ data: null, error: { message: 'Invalid Refresh Token' } });

    expect(await pullTenantPlan(cloud, localStub(writes), 'tenant-1')).toBe(false);
    expect(writes).toEqual([]);
  });

  it('rend faux quand l\'écriture locale échoue', async () => {
    const cloud = cloudStub({ data: { plan: 'pro', trial_ends_at: null }, error: null });
    expect(await pullTenantPlan(cloud, localStub([], { message: 'boom' }), 'tenant-1')).toBe(false);
  });

  it('ne lève jamais : un échec réseau laisse l\'abonnement local en place', async () => {
    const cloud = cloudStub(() => { throw new Error('fetch failed'); });
    await expect(pullTenantPlan(cloud, localStub([]), 'tenant-1')).resolves.toBe(false);
  });
});
