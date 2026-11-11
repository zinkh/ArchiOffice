// supabase/migrate_zz_tenant_composite_fks.sql contre un VRAI Postgres (issue #245) : une clé
// étrangère composite (colonne, tenant_id) est un comportement du moteur, le faux Supabase des
// autres tests ne peut pas la reproduire. Même règle que documentSequences.pg.test.ts : ignoré
// sans PGHOST, exécuté par la CI (ci.yml fournit un service postgres).
//
// La migration est jouée dans une base jetable, créée puis supprimée ici.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hasPostgres = !!process.env.PGHOST;
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const U1 = '11111111-1111-1111-1111-111111111111';
const N1 = '33333333-3333-3333-3333-333333333333';

// Un schéma réduit, mais avec les VRAIS types et règles de suppression de production : id et
// colonnes de liaison en texte, tenant_id en UUID, `contrat_id` en UUID, SET NULL / CASCADE.
const SCHEMA = `
  CREATE TABLE tenants (id uuid PRIMARY KEY);
  CREATE TABLE projects (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id));
  CREATE TABLE contacts (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    company_contact_id text REFERENCES contacts(id) ON DELETE SET NULL);
  CREATE TABLE contrats_moe (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id text REFERENCES projects(id) ON DELETE SET NULL,
    client_id text REFERENCES contacts(id) ON DELETE SET NULL);
  CREATE TABLE invoices (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id text REFERENCES projects(id) ON DELETE CASCADE,
    client_id text REFERENCES contacts(id) ON DELETE SET NULL);
  -- tenant_id NULLABLE, comme en production : la migration doit le rendre obligatoire.
  CREATE TABLE notes_honoraires (id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id),
    project_id text REFERENCES projects(id) ON DELETE CASCADE,
    contrat_id uuid REFERENCES contrats_moe(id) ON DELETE SET NULL);
  -- tenant_id en TEXTE (c'est le cas de project_members en production) : types différents du
  -- parent, une clé composite est impossible, la table garde sa clé simple.
  CREATE TABLE project_members (id text PRIMARY KEY, tenant_id text NOT NULL,
    project_id text REFERENCES projects(id) ON DELETE CASCADE);
  -- Une ligne qui croise DÉJÀ deux cabinets : la table est ignorée avec un avertissement.
  CREATE TABLE legacy_crossed (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id text REFERENCES projects(id) ON DELETE CASCADE);
`;

describe.skipIf(!hasPostgres)('migrate_zz_tenant_composite_fks : clés composites sur un vrai Postgres', () => {
  it('refuse un parent d\'un autre cabinet, garde les règles de suppression, ignore ce qu\'elle ne peut pas convertir, et reste rejouable', async () => {
    const { Client, Pool } = await import('pg');
    const base = {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    };
    const dbName = `compfk_test_${process.pid}_${Date.now()}`;

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
        INSERT INTO projects VALUES ('pa', '${A}'), ('pb', '${B}'), ('pa2', '${A}');
        INSERT INTO contacts (id, tenant_id) VALUES ('ca', '${A}'), ('cb', '${B}'), ('ca2', '${A}');
        INSERT INTO legacy_crossed VALUES ('lc1', '${A}', 'pb');
      `);

      const sql = readFileSync(join(__dirname, '../supabase/migrate_zz_tenant_composite_fks.sql'), 'utf8');
      const runMigration = async () => {
        const client = await pool.connect();
        const notices: string[] = [];
        client.on('notice', n => notices.push(n.message ?? ''));
        try { await client.query(sql); } finally { client.release(); }
        return notices;
      };

      // ── Première exécution ────────────────────────────────────────────────────────────
      const first = await runMigration();
      // 7 = contrats_moe (2) + invoices (2) + notes_honoraires (2) + contacts.company_contact_id.
      expect(first.join(' | ')).toMatch(/7 clé\(s\) composite\(s\) posée\(s\), 1 ignorée\(s\)/);
      expect(first.join(' | ')).toMatch(/legacy_crossed\.project_id/);

      const fks = async (table: string) => (await pool.query(
        `SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid = $1::regclass ORDER BY conname`, [table],
      )).rows.map((r: any) => r.conname);
      expect(await fks('invoices')).toEqual(expect.arrayContaining(['invoices_project_id_tenant_fkey', 'invoices_client_id_tenant_fkey']));
      expect(await fks('invoices')).not.toContain('invoices_project_id_fkey'); // jamais deux relations (jointures PostgREST)
      expect(await fks('project_members')).toContain('project_members_project_id_fkey'); // types différents : inchangée
      expect(await fks('legacy_crossed')).toContain('legacy_crossed_project_id_fkey');   // ligne croisée : inchangée
      expect((await pool.query(
        `SELECT attnotnull FROM pg_attribute WHERE attrelid = 'notes_honoraires'::regclass AND attname = 'tenant_id'`,
      )).rows[0].attnotnull).toBe(true);

      // ── Un parent d'un autre cabinet est refusé, par la base elle-même ──────────────
      const refused = async (text: string, params: unknown[]) => {
        try { await pool.query(text, params); return null; } catch (e: any) { return e.code; }
      };
      expect(await refused(`INSERT INTO invoices (id, tenant_id, project_id) VALUES ('x1', $1, 'pb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO invoices (id, tenant_id, client_id) VALUES ('x2', $1, 'cb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO contrats_moe (id, tenant_id, client_id) VALUES ($1, $2, 'cb')`, [U1, A])).toBe('23503');
      expect(await refused(`INSERT INTO contacts (id, tenant_id, company_contact_id) VALUES ('cx', $1, 'cb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO notes_honoraires (id, tenant_id, project_id) VALUES ($1, $2, 'pb')`, [N1, A])).toBe('23503');
      // tenant_id devenu obligatoire : plus de ligne de note sans cabinet.
      expect(await refused(`INSERT INTO notes_honoraires (id, project_id) VALUES ($1, 'pa')`, [N1])).toBe('23502');

      // ── Les écritures du même cabinet, et sans relation, passent ─────────────────────
      await pool.query(`INSERT INTO invoices (id, tenant_id, project_id, client_id) VALUES ('i1', $1, 'pa2', 'ca2'), ('i2', $1, 'pa', 'ca')`, [A]);
      await pool.query(`INSERT INTO invoices (id, tenant_id) VALUES ('i3', $1)`, [A]);                     // aucun lien : permis
      await pool.query(`INSERT INTO contrats_moe (id, tenant_id, project_id) VALUES ($1, $2, 'pa2')`, [U1, A]);
      await pool.query(`INSERT INTO notes_honoraires (id, tenant_id, project_id, contrat_id) VALUES ($1, $2, 'pa2', $3)`, [N1, A, U1]);
      await pool.query(`INSERT INTO contacts (id, tenant_id, company_contact_id) VALUES ('ca3', $1, 'ca')`, [A]); // lien vers un contact du même cabinet

      // ── Règles de suppression conservées ─────────────────────────────────────────────
      // SET NULL (colonne) : le lien est effacé, le cabinet de la ligne ne bouge JAMAIS.
      await pool.query(`DELETE FROM contacts WHERE id = 'ca'`);
      const i2 = (await pool.query(`SELECT client_id, tenant_id FROM invoices WHERE id = 'i2'`)).rows[0];
      expect(i2.client_id).toBeNull();
      expect(i2.tenant_id).toBe(A);
      expect((await pool.query(`SELECT company_contact_id, tenant_id FROM contacts WHERE id = 'ca3'`)).rows[0])
        .toEqual({ company_contact_id: null, tenant_id: A });
      // CASCADE : la suppression du projet emporte ses factures.
      await pool.query(`DELETE FROM projects WHERE id = 'pa'`);
      expect((await pool.query(`SELECT count(*)::int AS n FROM invoices WHERE id = 'i2'`)).rows[0].n).toBe(0);

      // ── Rejouable : aucune clé de plus, aucune erreur ────────────────────────────────
      const before = (await pool.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`)).rows[0].n;
      const second = await runMigration();
      expect(second.join(' | ')).toMatch(/0 clé\(s\) composite\(s\) posée\(s\), 1 ignorée\(s\)/);
      expect((await pool.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`)).rows[0].n).toBe(before);

      // ── Mise à niveau d'un poste local vers le cloud (server/localCloudUpgrade.ts) ───
      // Elle réécrit tenant_id table par table. Sans différer les contrôles, le premier
      // UPDATE casse : le parent est déjà dans le cabinet C, ses enfants encore dans A.
      expect(await refused(`UPDATE projects SET tenant_id = $1 WHERE tenant_id = $2`, [C, A])).toBe('23503');

      const upgrade = await pool.connect();
      try {
        await upgrade.query('BEGIN');
        await upgrade.query('SET CONSTRAINTS ALL DEFERRED');
        // Volontairement ENFANTS D'ABORD, puis parents : l'ordre ne doit pas compter.
        for (const t of ['invoices', 'notes_honoraires', 'contrats_moe', 'contacts', 'projects']) {
          await upgrade.query(`UPDATE ${t} SET tenant_id = $1 WHERE tenant_id = $2`, [C, A]);
        }
        await upgrade.query('COMMIT');
      } catch (e) {
        await upgrade.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        upgrade.release();
      }
      expect((await pool.query(`SELECT count(*)::int AS n FROM invoices WHERE tenant_id = $1`, [C])).rows[0].n).toBeGreaterThan(0);
      expect((await pool.query(`SELECT count(*)::int AS n FROM projects WHERE tenant_id = $1`, [A])).rows[0].n).toBe(0);

      // Et si la réécriture laisse un état final incohérent, le COMMIT le refuse.
      const broken = await pool.connect();
      try {
        await broken.query('BEGIN');
        await broken.query('SET CONSTRAINTS ALL DEFERRED');
        await broken.query(`UPDATE projects SET tenant_id = $1 WHERE id = 'pa2'`, [B]); // enfants restés dans C
        await expect(broken.query('COMMIT')).rejects.toMatchObject({ code: '23503' });
      } finally {
        await broken.query('ROLLBACK').catch(() => {});
        broken.release();
      }
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);
});

describe('migrate_zz_tenant_composite_fks : garde de version', () => {
  it('ne fait rien sur PostgreSQL < 15 : le garde précède toute modification', () => {
    // Un Postgres 14 n'est pas disponible ici : on vérifie par lecture du fichier que le garde
    // est la première chose exécutée, avant toute boucle ou instruction ALTER du bloc.
    const sql = readFileSync(join(__dirname, '../supabase/migrate_zz_tenant_composite_fks.sql'), 'utf8');
    const block = sql.slice(sql.indexOf('DO $$'));
    const guard = block.indexOf("server_version_num')::int < 150000");
    expect(guard).toBeGreaterThan(-1);
    expect(block.slice(guard, guard + 400)).toContain('RETURN;');
    expect(guard).toBeLessThan(block.indexOf('FOREACH v_parent'));
    expect(guard).toBeLessThan(block.indexOf('ALTER TABLE'));
  });
});
