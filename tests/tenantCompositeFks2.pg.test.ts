// supabase/migrate_zz_tenant_composite_fks_2.sql (deuxième lot de parents, issue #245) contre un
// VRAI Postgres, jouée APRÈS la première migration comme sur une installation réelle. Même règle que
// tenantCompositeFks.pg.test.ts : ignoré sans PGHOST, exécuté par la CI.
//
// Le schéma réduit reprend les cas délicats de ce lot : un lien RESTRICT auto-référent
// (marches_entreprises, non différable), SET NULL, CASCADE, et les exclusions volontaires
// (site_reports : indices de colonne PostgREST ; les tables d'infrastructure).
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
  CREATE TABLE proposals (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id));
  CREATE TABLE tenders (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id));
  CREATE TABLE meetings (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id text REFERENCES projects(id) ON DELETE CASCADE,
    proposal_id text REFERENCES proposals(id) ON DELETE CASCADE,
    tender_id text REFERENCES tenders(id) ON DELETE CASCADE);
  -- Lien auto-référent en RESTRICT, comme en production : la clé composite n'est pas différable.
  CREATE TABLE marches_entreprises (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id text REFERENCES projects(id) ON DELETE CASCADE,
    parent_marche_id text REFERENCES marches_entreprises(id) ON DELETE RESTRICT);
  CREATE TABLE situations (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    marche_id text REFERENCES marches_entreprises(id));
  CREATE TABLE invoices (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id text REFERENCES projects(id) ON DELETE CASCADE);
  CREATE TABLE notes_honoraires (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    invoice_id text REFERENCES invoices(id) ON DELETE SET NULL);
  -- site_reports : EXCLU (observations.ts joint par indice de colonne).
  CREATE TABLE site_reports (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id text REFERENCES projects(id) ON DELETE CASCADE);
  CREATE TABLE observations (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    created_report_id text REFERENCES site_reports(id) ON DELETE SET NULL);
  -- Tables d'infrastructure : hors de ce lot.
  CREATE TABLE agents (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id));
  CREATE TABLE agent_missions (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    agent_id text REFERENCES agents(id) ON DELETE CASCADE);
`;

describe.skipIf(!hasPostgres)('migrate_zz_tenant_composite_fks_2 : deuxième lot sur un vrai Postgres', () => {
  it('convertit les parents du lot après la première migration, garde RESTRICT, exclut site_reports et l\'infrastructure, et reste rejouable', async () => {
    const { Client, Pool } = await import('pg');
    const base = {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    };
    const dbName = `compfk2_test_${process.pid}_${Date.now()}`;

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
        INSERT INTO proposals VALUES ('qa', '${A}'), ('qb', '${B}');
        INSERT INTO tenders VALUES ('ta', '${A}'), ('tb', '${B}');
        INSERT INTO marches_entreprises VALUES ('ma', '${A}', 'pa', NULL), ('mb', '${B}', 'pb', NULL);
        INSERT INTO invoices VALUES ('ia', '${A}', 'pa'), ('ib', '${B}', 'pb');
        INSERT INTO site_reports VALUES ('sa', '${A}', 'pa'), ('sb', '${B}', 'pb');
      `);

      const run = async (file: string) => {
        const client = await pool.connect();
        const notices: string[] = [];
        client.on('notice', n => notices.push(n.message ?? ''));
        try { await client.query(readFileSync(join(__dirname, '../supabase', file), 'utf8')); } finally { client.release(); }
        return notices.join(' | ');
      };

      // Dans l'ordre alphabétique réel : la première migration, puis la deuxième.
      const files = ['migrate_zz_tenant_composite_fks.sql', 'migrate_zz_tenant_composite_fks_2.sql'];
      expect([...files].sort()).toEqual(files);

      // Premier lot : projects. Quatre liens (meetings, marches_entreprises, invoices, site_reports).
      expect(await run(files[0])).toMatch(/4 clé\(s\) composite\(s\) posée\(s\), 0 ignorée\(s\)/);
      // Deuxième lot : meetings (proposal, tender), marches_entreprises (parent), situations, notes_honoraires.
      expect(await run(files[1])).toMatch(/migrate_zz_tenant_composite_fks_2 : 5 clé\(s\) composite\(s\) posée\(s\), 0 ignorée\(s\)/);

      const fks = async (table: string) => (await pool.query(
        `SELECT conname, condeferrable FROM pg_constraint WHERE contype = 'f' AND conrelid = $1::regclass ORDER BY conname`, [table],
      )).rows as { conname: string; condeferrable: boolean }[];
      const names = async (table: string) => (await fks(table)).map(r => r.conname);

      expect(await names('meetings')).toEqual(expect.arrayContaining(['meetings_proposal_id_tenant_fkey', 'meetings_tender_id_tenant_fkey']));
      expect(await names('meetings')).not.toContain('meetings_proposal_id_fkey');
      expect(await names('notes_honoraires')).toContain('notes_honoraires_invoice_id_tenant_fkey');
      // Exclusions volontaires : site_reports (indices de colonne PostgREST) et l'infrastructure.
      expect(await names('observations')).toContain('observations_created_report_id_fkey');
      expect(await names('agent_missions')).toContain('agent_missions_agent_id_fkey');
      // RESTRICT n'est pas différable ; CASCADE et NO ACTION le sont.
      const marche = (await fks('marches_entreprises')).find(r => r.conname === 'marches_entreprises_parent_marche_id_tenant_fkey');
      expect(marche?.condeferrable).toBe(false);
      expect((await fks('meetings')).find(r => r.conname === 'meetings_tender_id_tenant_fkey')?.condeferrable).toBe(true);

      // ── Un parent d'un autre cabinet est refusé ──────────────────────────────────────
      const refused = async (text: string, params: unknown[] = []) => {
        try { await pool.query(text, params); return null; } catch (e: any) { return e.code; }
      };
      expect(await refused(`INSERT INTO meetings (id, tenant_id, proposal_id) VALUES ('x1', $1, 'qb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO meetings (id, tenant_id, tender_id) VALUES ('x2', $1, 'tb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO situations (id, tenant_id, marche_id) VALUES ('x3', $1, 'mb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO notes_honoraires (id, tenant_id, invoice_id) VALUES ('x4', $1, 'ib')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO marches_entreprises (id, tenant_id, parent_marche_id) VALUES ('x5', $1, 'mb')`, [A])).toBe('23503');
      // site_reports reste exclu : sa clé simple ne contrôle pas le cabinet (limite documentée).
      expect(await refused(`INSERT INTO observations (id, tenant_id, created_report_id) VALUES ('x6', $1, 'sb')`, [A])).toBeNull();
      await pool.query(`DELETE FROM observations WHERE id = 'x6'`);

      // ── Le même cabinet passe ────────────────────────────────────────────────────────
      await pool.query(`INSERT INTO meetings (id, tenant_id, project_id, proposal_id, tender_id) VALUES ('m1', $1, 'pa', 'qa', 'ta')`, [A]);
      await pool.query(`INSERT INTO marches_entreprises (id, tenant_id, project_id, parent_marche_id) VALUES ('ma2', $1, 'pa', 'ma')`, [A]);
      await pool.query(`INSERT INTO situations (id, tenant_id, marche_id) VALUES ('sit1', $1, 'ma')`, [A]);
      await pool.query(`INSERT INTO notes_honoraires (id, tenant_id, invoice_id) VALUES ('n1', $1, 'ia')`, [A]);

      // ── Règles de suppression conservées ─────────────────────────────────────────────
      // RESTRICT : un marché qui a un subséquent ne se supprime pas (PostgreSQL signale aussi un
      // RESTRICT par 23503), et le contrôle n'est PAS différable : même après SET CONSTRAINTS ALL
      // DEFERRED, supprimer le parent avant l'enfant échoue sur-le-champ, ce que ferait réussir un
      // NO ACTION différable.
      expect(await refused(`DELETE FROM marches_entreprises WHERE id = 'ma'`)).toBe('23503');
      const restrictTx = await pool.connect();
      try {
        await restrictTx.query('BEGIN');
        await restrictTx.query('SET CONSTRAINTS ALL DEFERRED');
        await expect(restrictTx.query(`DELETE FROM marches_entreprises WHERE id = 'ma'`)).rejects.toMatchObject({ code: '23503' });
      } finally {
        await restrictTx.query('ROLLBACK').catch(() => {});
        restrictTx.release();
      }
      expect((await pool.query(`SELECT count(*)::int AS n FROM marches_entreprises WHERE id = 'ma'`)).rows[0].n).toBe(1);
      // SET NULL (colonne) : le lien tombe, le cabinet de la note ne bouge jamais.
      await pool.query(`DELETE FROM invoices WHERE id = 'ia'`);
      expect((await pool.query(`SELECT invoice_id, tenant_id FROM notes_honoraires WHERE id = 'n1'`)).rows[0])
        .toEqual({ invoice_id: null, tenant_id: A });
      // CASCADE : supprimer l'appel d'offres emporte sa réunion.
      await pool.query(`DELETE FROM tenders WHERE id = 'ta'`);
      expect((await pool.query(`SELECT count(*)::int AS n FROM meetings WHERE id = 'm1'`)).rows[0].n).toBe(0);

      // ── Rejouable ────────────────────────────────────────────────────────────────────
      const before = (await pool.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`)).rows[0].n;
      expect(await run(files[1])).toMatch(/0 clé\(s\) composite\(s\) posée\(s\), 0 ignorée\(s\)/);
      expect((await pool.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`)).rows[0].n).toBe(before);

      // ── Mise à niveau d'un poste local (server/localCloudUpgrade.ts) ─────────────────
      // tenant_id est réécrit table par table, enfants d'abord, y compris la table AUTO-RÉFÉRENTE
      // en RESTRICT (non différable) : son UPDATE touche parent et enfant dans la même instruction.
      await pool.query(`INSERT INTO meetings (id, tenant_id, project_id, proposal_id) VALUES ('m2', $1, 'pa', 'qa')`, [A]);
      await pool.query(`INSERT INTO invoices (id, tenant_id, project_id) VALUES ('ia2', $1, 'pa')`, [A]);
      await pool.query(`INSERT INTO notes_honoraires (id, tenant_id, invoice_id) VALUES ('n2', $1, 'ia2')`, [A]);
      const upgrade = await pool.connect();
      try {
        await upgrade.query('BEGIN');
        await upgrade.query('SET CONSTRAINTS ALL DEFERRED');
        for (const t of ['situations', 'notes_honoraires', 'meetings', 'marches_entreprises', 'invoices', 'site_reports', 'observations',
                         'agent_missions', 'agents', 'projects', 'proposals', 'tenders']) {
          await upgrade.query(`UPDATE ${t} SET tenant_id = $1 WHERE tenant_id = $2`, [C, A]);
        }
        await upgrade.query('COMMIT');
      } catch (e) {
        await upgrade.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        upgrade.release();
      }
      expect((await pool.query(`SELECT count(*)::int AS n FROM marches_entreprises WHERE tenant_id = $1`, [C])).rows[0].n).toBe(2);
      expect((await pool.query(`SELECT count(*)::int AS n FROM projects WHERE tenant_id = $1`, [A])).rows[0].n).toBe(0);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);
});
