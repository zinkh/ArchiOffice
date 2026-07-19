// Applies supabase/schema.sql + supabase/migrate_*.sql (transformed for a
// vanilla local Postgres, see schemaTransform.cjs) against a running Postgres
// connection. Used once, on first launch of the offline desktop build.

const fs = require('fs');
const path = require('path');
const { transformSql } = require('./schemaTransform.cjs');

const SUPABASE_DIR = path.join(__dirname, '..', 'supabase');

// migrate_add_tenant_id.sql is an earlier draft superseded by schema.sql itself
// (same tenant_id/auth.users/RLS design, now consolidated) — applying it too
// would just re-attempt already-applied changes.
const SKIP_FILES = new Set(['migrate_add_tenant_id.sql']);

function orderedSqlFiles() {
  const migrations = fs
    .readdirSync(SUPABASE_DIR)
    .filter((f) => f.startsWith('migrate_') && f.endsWith('.sql'))
    .filter((f) => !SKIP_FILES.has(f))
    .sort();
  // fix_trigger_and_email.sql adds profiles.email (needed by local auth) — its
  // auth.users-touching statements are dropped by transformSql like everywhere else.
  return ['schema.sql', 'fix_trigger_and_email.sql', ...migrations];
}

// Tracks which of the files above have already been applied to *this*
// local Postgres data directory, so an app update that ships new
// migrate_*.sql files (added after a user's first launch — pgBootstrap.cjs
// only ever calls applyLocalSchema on that very first launch, and a local
// pgdata/ directory otherwise persists across every later app update) can
// still apply just the new ones on next startup, instead of the local DB
// silently drifting out of sync with server.ts forever — the exact class of
// bug found across several supabase/migrate_*.sql files never having been
// run against the production cloud project (fixed there directly; this is
// the same risk for every existing offline install). Deliberately local-only
// bookkeeping (see server/localPendingPush.ts for the same pattern) — never
// part of the cloud schema, never synced.
async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _local_applied_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedFilenames(client) {
  const { rows } = await client.query('SELECT filename FROM _local_applied_migrations');
  return new Set(rows.map((r) => r.filename));
}

/**
 * Applies every SQL file from orderedSqlFiles() not yet recorded in
 * _local_applied_migrations. Safe to call on every app startup: a brand new
 * database applies everything (first launch); an existing one only applies
 * whatever's new since it was last opened.
 * @param {import('pg').Client} client
 * @param {(msg: string) => void} [log]
 */
async function applyLocalSchema(client, log = () => {}) {
  await ensureMigrationsTable(client);
  const applied = await getAppliedFilenames(client);
  const files = orderedSqlFiles().filter((f) => !applied.has(f));

  if (files.length === 0) {
    log('[applySchema] no new migrations to apply');
    return;
  }

  /** @type {{ file: string, stmt: string }[]} */
  const pending = [];

  for (const file of files) {
    const sql = fs.readFileSync(path.join(SUPABASE_DIR, file), 'utf8');
    for (const stmt of transformSql(sql)) {
      try {
        await client.query(stmt);
      } catch (err) {
        pending.push({ file, stmt });
      }
    }
  }

  // Some migration files reference tables created by a later file once sorted
  // alphabetically (filenames aren't a true dependency order) — a second pass
  // resolves ordinary forward references without hand-maintaining an order.
  const stillFailing = [];
  for (const { file, stmt } of pending) {
    try {
      await client.query(stmt);
    } catch (err) {
      stillFailing.push({ file, message: err.message, stmt: stmt.trim().slice(0, 200) });
    }
  }

  if (stillFailing.length > 0) {
    for (const f of stillFailing) {
      log(`[applySchema] ${f.file}: ${f.message} -- ${f.stmt}`);
    }
    throw new Error(`applyLocalSchema: ${stillFailing.length} statement(s) failed after retry`);
  }

  for (const file of files) {
    await client.query('INSERT INTO _local_applied_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
  }

  log(`[applySchema] applied ${files.length} new SQL file(s) successfully`);
}

module.exports = { applyLocalSchema, orderedSqlFiles };
