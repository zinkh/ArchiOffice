// Applies supabase/schema.sql + supabase/migrate_*.sql (transformed for a
// vanilla local Postgres, see schemaTransform.cjs) against a running Postgres
// connection. Used once, on first launch of the offline desktop build.

const fs = require('fs');
const path = require('path');
const { transformSql } = require('./schemaTransform.cjs');

const SUPABASE_DIR = path.join(__dirname, '..', 'supabase');

// migrate_add_tenant_id.sql is an earlier draft superseded by schema.sql itself
// (same tenant_id/auth.users/RLS design, now consolidated); fix_trigger_and_email.sql
// only patches the auth.users signup trigger we drop entirely locally.
const SKIP_FILES = new Set(['migrate_add_tenant_id.sql', 'fix_trigger_and_email.sql']);

function orderedSqlFiles() {
  const migrations = fs
    .readdirSync(SUPABASE_DIR)
    .filter((f) => f.startsWith('migrate_') && f.endsWith('.sql'))
    .filter((f) => !SKIP_FILES.has(f))
    .sort();
  return ['schema.sql', ...migrations];
}

/**
 * @param {import('pg').Client} client
 * @param {(msg: string) => void} [log]
 */
async function applyLocalSchema(client, log = () => {}) {
  const files = orderedSqlFiles();
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

  log(`[applySchema] applied ${files.length} SQL files successfully`);
}

module.exports = { applyLocalSchema, orderedSqlFiles };
