// server/initialImport.ts's cousin on the write side: electron/applySchema.cjs
// bootstraps every Electron client's local Postgres by replaying
// supabase/schema.sql + every supabase/migrate_*.sql file (minus
// SKIP_FILES) in one pass, on that client's very first launch. Unlike the
// hosted Supabase project, where each migration was applied incrementally
// as the schema evolved, a fresh local database sees the WHOLE history at
// once — so an old migration that references a table a LATER migration
// drops (e.g. `specifications`, see migrate_drop_specifications.sql) fails
// with "relation does not exist" on every brand-new install, even though
// the same file worked fine historically against the hosted project. This
// reproduced for real (a fresh Windows install stuck at "Préparation de la
// base") and blocked every first launch until the offending statements were
// removed from migrate_add_project_scoped_indexes.sql,
// migrate_add_sync_infra.sql and migrate_specifications_require_project.sql
// (the last one deleted outright — its only statement targeted the table).
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { transformSql } from '../electron/schemaTransform.cjs';

const SUPABASE_DIR = path.join(__dirname, '..', 'supabase');
// Mirrors electron/applySchema.cjs's SKIP_FILES — migrate_add_tenant_id.sql
// is never applied locally, so a dangling reference there is harmless.
const SKIP_FILES = new Set(['migrate_add_tenant_id.sql']);

function orderedSqlFiles(): string[] {
  const migrations = fs
    .readdirSync(SUPABASE_DIR)
    .filter((f) => f.startsWith('migrate_') && f.endsWith('.sql'))
    .filter((f) => !SKIP_FILES.has(f))
    .sort();
  return ['schema.sql', 'fix_trigger_and_email.sql', ...migrations];
}

describe('bootstrap Electron local schema — aucune table déjà supprimée n\'est référencée', () => {
  it('DROP TABLE specifications ne laisse aucune instruction exécutable la référencer ailleurs', () => {
    const files = orderedSqlFiles();
    const offenders: string[] = [];
    for (const file of files) {
      const sql = fs.readFileSync(path.join(SUPABASE_DIR, file), 'utf8');
      for (const stmt of transformSql(sql)) {
        // `specifications` utilisé comme identifiant SQL non quoté (nom de
        // table après TABLE/INTO/UPDATE/FROM, ou suivi de parenthèses comme
        // dans `ON specifications(...)`) — jamais une mention entre
        // guillemets dans un commentaire ou une valeur JSON/ARRAY de données
        // (ex. les permissions par défaut d'un agent), qui ne fait échouer
        // aucune requête sur une base sans cette table.
        const isStaticReference = /\b(TABLE|INTO|UPDATE|FROM)\s+specifications\b|\bspecifications\s*\(/i.test(stmt)
          && !/DROP\s+TABLE\s+IF\s+EXISTS\s+specifications/i.test(stmt);
        // migrate_add_sync_infra.sql's trigger-attachment loop is the other
        // real failure mode found in production: `FOREACH t IN ARRAY [...,
        // 'specifications', ...] LOOP EXECUTE format('ALTER TABLE %I ...', t)`
        // builds the table name at runtime, so a static grep for
        // "TABLE specifications" never sees it — only 'specifications' as a
        // quoted array element next to a dynamic EXECUTE format(...) call
        // does.
        const isDynamicLoopReference = /EXECUTE\s+format/i.test(stmt) && /'specifications'/i.test(stmt);
        if (isStaticReference || isDynamicLoopReference) {
          offenders.push(`${file}: ${stmt.trim().slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
