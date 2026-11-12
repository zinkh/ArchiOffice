// supabase/migrate_zz_tenant_composite_fks_3.sql (troisième lot : site_reports, issue #245) contre un
// VRAI Postgres, jouée APRÈS les deux premières comme sur une installation réelle. Même règle que
// tenantCompositeFks.pg.test.ts : ignoré sans PGHOST, exécuté par la CI.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hasPostgres = !!process.env.PGHOST;
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';

const SCHEMA = `
  CREATE TABLE tenants (id uuid PRIMARY KEY);
  CREATE TABLE projects (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id));
  CREATE TABLE site_reports (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id text REFERENCES projects(id) ON DELETE CASCADE, report_number int);
  -- Deux liens vers la même table, tous deux SET NULL : ce que joignait observations.ts par indice de colonne.
  CREATE TABLE observations (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    created_report_id text REFERENCES site_reports(id) ON DELETE SET NULL,
    resolved_report_id text REFERENCES site_reports(id) ON DELETE SET NULL);
  CREATE TABLE site_report_notes (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    report_id text REFERENCES site_reports(id) ON DELETE CASCADE);
`;

describe.skipIf(!hasPostgres)('migrate_zz_tenant_composite_fks_3 : site_reports sur un vrai Postgres', () => {
  it('convertit les trois liens vers site_reports, garde SET NULL et CASCADE, refuse un compte rendu d\'un autre cabinet, et reste rejouable', async () => {
    const { Client, Pool } = await import('pg');
    const base = {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    };
    const dbName = `compfk3_test_${process.pid}_${Date.now()}`;

    const admin = new Client({ ...base, database: process.env.PGDATABASE || 'postgres' });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);

    const pool = new Pool({ ...base, database: dbName, max: 4 });
    pool.on('error', () => {});
    pool.on('connect', client => { client.on('error', () => {}); });
    try {
      await pool.query(SCHEMA);
      await pool.query(`
        INSERT INTO tenants VALUES ('${A}'), ('${B}'), ('${C}');
        INSERT INTO projects VALUES ('pa', '${A}'), ('pb', '${B}');
        INSERT INTO site_reports VALUES ('cr1', '${A}', 'pa', 1), ('cr2', '${A}', 'pa', 2), ('crb', '${B}', 'pb', 9);
      `);

      const run = async (file: string) => {
        const client = await pool.connect();
        const notices: string[] = [];
        client.on('notice', n => notices.push(n.message ?? ''));
        try { await client.query(readFileSync(join(__dirname, '../supabase', file), 'utf8')); } finally { client.release(); }
        return notices.join(' | ');
      };

      const files = ['migrate_zz_tenant_composite_fks.sql', 'migrate_zz_tenant_composite_fks_2.sql', 'migrate_zz_tenant_composite_fks_3.sql'];
      expect([...files].sort()).toEqual(files);

      expect(await run(files[0])).toMatch(/1 clé\(s\) composite\(s\) posée\(s\), 0 ignorée\(s\)/);   // site_reports.project_id
      expect(await run(files[1])).toMatch(/_2 : 0 clé\(s\) composite\(s\) posée\(s\), 0 ignorée\(s\)/); // rien dans ce schéma
      expect(await run(files[2])).toMatch(/_3 : 3 clé\(s\) composite\(s\) posée\(s\), 0 ignorée\(s\)/);

      const names = async (table: string) => (await pool.query(
        `SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid = $1::regclass ORDER BY conname`, [table],
      )).rows.map((r: any) => r.conname as string);
      expect(await names('observations')).toEqual(expect.arrayContaining(['observations_created_report_id_tenant_fkey', 'observations_resolved_report_id_tenant_fkey']));
      expect(await names('site_report_notes')).toContain('site_report_notes_report_id_tenant_fkey');
      expect(await names('observations')).not.toContain('observations_created_report_id_fkey'); // jamais deux relations

      // ── Un compte rendu d'un autre cabinet est refusé, sur chacun des trois liens ────
      const refused = async (text: string, params: unknown[] = []) => {
        try { await pool.query(text, params); return null; } catch (e: any) { return e.code; }
      };
      expect(await refused(`INSERT INTO observations (id, tenant_id, created_report_id) VALUES ('x1', $1, 'crb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO observations (id, tenant_id, resolved_report_id) VALUES ('x2', $1, 'crb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO site_report_notes (id, tenant_id, report_id) VALUES ('x3', $1, 'crb')`, [A])).toBe('23503');

      // ── Le même cabinet, et sans compte rendu, passe ─────────────────────────────────
      await pool.query(`INSERT INTO observations (id, tenant_id, created_report_id, resolved_report_id) VALUES ('o1', $1, 'cr1', 'cr2')`, [A]);
      await pool.query(`INSERT INTO observations (id, tenant_id) VALUES ('o2', $1)`, [A]);
      await pool.query(`INSERT INTO site_report_notes (id, tenant_id, report_id) VALUES ('n1', $1, 'cr1')`, [A]);

      // ── SET NULL (colonne) : le lien tombe, ni l'autre lien ni le cabinet ne bougent ─
      await pool.query(`DELETE FROM site_reports WHERE id = 'cr2'`);
      expect((await pool.query(`SELECT created_report_id, resolved_report_id, tenant_id FROM observations WHERE id = 'o1'`)).rows[0])
        .toEqual({ created_report_id: 'cr1', resolved_report_id: null, tenant_id: A });
      // ── CASCADE : supprimer le compte rendu emporte ses rubriques ────────────────────
      await pool.query(`DELETE FROM site_reports WHERE id = 'cr1'`);
      expect((await pool.query(`SELECT count(*)::int AS n FROM site_report_notes WHERE id = 'n1'`)).rows[0].n).toBe(0);
      expect((await pool.query(`SELECT created_report_id, tenant_id FROM observations WHERE id = 'o1'`)).rows[0])
        .toEqual({ created_report_id: null, tenant_id: A });

      // ── Rejouable ────────────────────────────────────────────────────────────────────
      const before = (await pool.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`)).rows[0].n;
      expect(await run(files[2])).toMatch(/_3 : 0 clé\(s\) composite\(s\) posée\(s\), 0 ignorée\(s\)/);
      expect((await pool.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`)).rows[0].n).toBe(before);

      // ── Mise à niveau d'un poste local : tenant_id réécrit table par table ───────────
      await pool.query(`INSERT INTO site_reports VALUES ('cr3', $1, 'pa', 3)`, [A]);
      await pool.query(`INSERT INTO observations (id, tenant_id, created_report_id) VALUES ('o3', $1, 'cr3')`, [A]);
      const upgrade = await pool.connect();
      try {
        await upgrade.query('BEGIN');
        await upgrade.query('SET CONSTRAINTS ALL DEFERRED');
        for (const t of ['site_report_notes', 'observations', 'site_reports', 'projects']) {
          await upgrade.query(`UPDATE ${t} SET tenant_id = $1 WHERE tenant_id = $2`, [C, A]);
        }
        await upgrade.query('COMMIT');
      } catch (e) {
        await upgrade.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        upgrade.release();
      }
      expect((await pool.query(`SELECT count(*)::int AS n FROM observations WHERE tenant_id = $1`, [C])).rows[0].n).toBe(3);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);
});
