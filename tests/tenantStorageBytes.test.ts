// Mesure du stockage d'un cabinet : exacte quand la fonction SQL existe, repli
// sur les versions de documents sinon. Clients factices, aucun réseau.
import { describe, it, expect, vi } from 'vitest';
import { tenantSupabaseStorageBytes } from '../server/externalStorage/storageUsage';

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

function client(rpc: () => Promise<RpcResult>, versions: Array<{ size_bytes: number }> = []) {
  return {
    rpc: async () => rpc(),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: versions, error: null }),
        }),
      }),
    }),
  } as any;
}

const MB = 1024 * 1024;
const versions = [{ size_bytes: 10 * MB }, { size_bytes: 5 * MB }];

describe('tenantSupabaseStorageBytes', () => {
  it('rend la mesure exacte de tous les buckets quand la fonction existe', async () => {
    const supabase = client(async () => ({ data: 93 * MB, error: null }), versions);
    expect(await tenantSupabaseStorageBytes(supabase, 'tenant-1')).toBe(93 * MB);
  });

  it('lit un bigint renvoyé en texte', async () => {
    const supabase = client(async () => ({ data: String(93 * MB), error: null }), versions);
    expect(await tenantSupabaseStorageBytes(supabase, 'tenant-1')).toBe(93 * MB);
  });

  it('garde un cabinet vide à zéro sans retomber sur le repli', async () => {
    const supabase = client(async () => ({ data: 0, error: null }), versions);
    expect(await tenantSupabaseStorageBytes(supabase, 'tenant-1')).toBe(0);
  });

  it('retombe sur les versions de documents quand la fonction est absente (instance non migrée)', async () => {
    const supabase = client(async () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }), versions);
    expect(await tenantSupabaseStorageBytes(supabase, 'tenant-1')).toBe(15 * MB);
  });

  it('retombe sur les versions quand la fonction rend NULL (Postgres local sans schéma storage)', async () => {
    const supabase = client(async () => ({ data: null, error: null }), versions);
    expect(await tenantSupabaseStorageBytes(supabase, 'tenant-1')).toBe(15 * MB);
  });

  it('retombe sur les versions et signale toute autre erreur, sans refuser le dépôt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const supabase = client(async () => ({ data: null, error: { code: '57014', message: 'timeout' } }), versions);

    expect(await tenantSupabaseStorageBytes(supabase, 'tenant-1')).toBe(15 * MB);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('retombe sur les versions quand l\'appel lève', async () => {
    const supabase = client(async () => { throw new Error('fetch failed'); }, versions);
    expect(await tenantSupabaseStorageBytes(supabase, 'tenant-1')).toBe(15 * MB);
  });
});
