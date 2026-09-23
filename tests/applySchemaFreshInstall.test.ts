// electron/applySchema.cjs bootstraps every Electron client's local Postgres
// by replaying the WHOLE supabase/*.sql history in one pass, on that
// client's very first launch — unlike the hosted Supabase project, where
// each migration applied incrementally as the schema evolved. Two real
// incidents (both only ever seen on an actual first launch, never caught by
// `npm test`'s FakeSupabaseAdmin-backed suite, which has no real Postgres to
// misbehave against):
//   - old migrations still referencing the `specifications` table after a
//     later migration dropped it (fixed: those statements removed/deleted),
//   - migrate_fix_boolean_type_drift.sql's NULLIF(col, '') on a column that
//     schema.sql itself now declares BOOLEAN from creation, which fails to
//     cast the text literal '' to boolean (fixed: NULLIF(col::text, '')).
//
// This test runs the exact same applyLocalSchema() against a real, freshly
// emptied Postgres — the only way to actually catch this class of bug,
// short of a real first launch. It requires a reachable Postgres and is
// gated on PGHOST so a contributor's plain `npm test` (no local Postgres)
// skips it instead of failing on a connection error; CI's ci.yml provisions
// a `postgres:` service and sets PGHOST for exactly this file.
import { describe, expect, it } from 'vitest';

const hasPostgres = !!process.env.PGHOST;

describe.skipIf(!hasPostgres)('applyLocalSchema — installation neuve contre un vrai Postgres', () => {
  it('rejoue tout l\'historique SQL sans erreur sur une base vide', async () => {
    const { Client } = await import('pg');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { applyLocalSchema } = require('../electron/applySchema.cjs');

    const client = new Client({
      host: process.env.PGHOST,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'postgres',
    });
    await client.connect();
    try {
      // Repart d'une base réellement vierge — c'est l'état exact d'un
      // premier lancement, que FakeSupabaseAdmin ne peut pas reproduire.
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const logLines: string[] = [];
      try {
        await applyLocalSchema(client, (msg: string) => logLines.push(msg));
      } catch (err: any) {
        // applyLocalSchema ne lève qu'un décompte ("N statement(s) failed
        // after retry") — le détail utile (fichier, message Postgres réel,
        // instruction) n'existe que dans les lignes de log poussées juste
        // avant ; les inclure dans l'échec évite d'avoir à rouvrir les logs
        // de CI pour savoir laquelle a échoué.
        throw new Error(`${err.message}\n${logLines.join('\n')}`);
      }
    } finally {
      await client.end();
    }
  }, 60000);
});
