// server/initialImport.ts : une ligne qu'aucune des deux passes de retry
// n'arrive à importer (typiquement une clé étrangère orpheline côté cloud,
// voir contrats_moe.project_id) ne doit plus faire échouer tout l'import —
// SYNC_TABLES est une liste alphabétique, pas un ordre de dépendances, donc
// quelques lignes en échec tôt dans cette liste (ex. contrats_moe, avant
// projects) bloquaient auparavant tout ce qui suit : projects lui-même, les
// tables de jonction, et le stockage. Elles deviennent désormais un
// avertissement non bloquant, et l'import se termine en 'done'.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SYNC_TABLES } from '../server/syncTables';

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-initial-import-'));
  process.env.OFFLINE_DATA_DIR = dataDir;
  process.env.OFFLINE_STORAGE_DIR = path.join(dataDir, 'storage');
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Minimal cloud client: every table but `contrats_moe` (one row) and
 *  `projects` (one row) returns no rows, and pagination stops immediately
 *  since a full page is never reached. */
function makeFakeCloudClient() {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                order() { return this; },
                limit() { return this; },
                maybeSingle: async () => ({ data: null, error: null }),
                range: async (offset: number) => {
                  if (offset > 0) return { data: [], error: null };
                  if (table === 'contrats_moe') return { data: [{ id: 'contrat1', tenant_id: 't1', project_id: 'missing-project' }], error: null };
                  if (table === 'projects') return { data: [{ id: 'p1', tenant_id: 't1' }], error: null };
                  return { data: [], error: null };
                },
              };
            },
            in() { return { data: [], error: null }; },
          };
        },
      };
    },
    storage: {
      from() {
        return { list: async () => ({ data: [], error: null }) };
      },
    },
  } as any;
}

/** Minimal local admin: contrats_moe upserts always fail (simulates the
 *  foreign-key violation against a project the cloud tenant no longer has),
 *  everything else succeeds. */
function makeFakeSupabaseAdmin() {
  const written: Record<string, any[]> = {};
  return {
    admin: {
      from(table: string) {
        return {
          upsert: async (rows: any[]) => {
            if (table === 'contrats_moe') {
              return { error: { message: 'insert or update on table "contrats_moe" violates foreign key constraint "contrats_moe_project_id_fkey"' } };
            }
            written[table] = (written[table] || []).concat(rows);
            return { error: null };
          },
        };
      },
    },
    written,
  };
}

describe('runInitialImport — ligne définitivement en échec après les deux passes', () => {
  it('se termine en "done" avec un avertissement, sans bloquer les tables suivantes', async () => {
    const { runInitialImport, getImportJob } = await import('../server/initialImport');
    const cloudClient = makeFakeCloudClient();
    const { admin, written } = makeFakeSupabaseAdmin();

    await runInitialImport('job1', cloudClient, admin as any, 't1');
    const job = getImportJob('job1')!;

    expect(job.status).toBe('done');
    expect(job.error).toBeNull();
    expect(job.warnings).toHaveLength(1);
    expect(job.warnings[0]).toMatchObject({ table: 'contrats_moe', rowCount: 1 });
    expect(job.warnings[0].message).toContain('foreign key constraint');

    // 'projects' vient après 'contrats_moe' dans SYNC_TABLES (ordre
    // alphabétique) — avant ce correctif, l'échec de contrats_moe
    // interrompait la boucle de retry avant que 'projects' n'y soit rejoué,
    // et surtout avant que les tables de jonction et le stockage ne
    // s'exécutent jamais.
    expect(SYNC_TABLES.indexOf('projects')).toBeGreaterThan(SYNC_TABLES.indexOf('contrats_moe'));
    expect(written['projects']).toEqual([{ id: 'p1', tenant_id: 't1' }]);
  });
});
