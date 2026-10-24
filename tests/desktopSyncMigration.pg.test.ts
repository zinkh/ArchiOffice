// supabase/migrate_desktop_sync.sql contre un VRAI Postgres : déclencheurs du journal de
// changements, purge, suppression en cascade d'un cabinet, rejeu de la migration.
// Le faux Supabase des autres tests n'exécute ni déclencheur ni contrainte.
//
// Même règle que documentSequences.pg.test.ts : ignoré sans PGHOST, exécuté par la CI.
// La migration est jouée dans une base jetable créée puis supprimée ici.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hasPostgres = !!process.env.PGHOST;
const TENANT_A = '00000000-0000-0000-0000-00000000000a';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';

describe.skipIf(!hasPostgres)('migrate_desktop_sync.sql : déclencheurs et purge', () => {
  it('journalise documents, verrous et affaires, purge, et supporte la fermeture d\'un cabinet', async () => {
    const { Client, Pool } = await import('pg');
    const base = {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    };
    const dbName = `desktopsync_test_${process.pid}_${Date.now()}`;

    const admin = new Client({ ...base, database: process.env.PGDATABASE || 'postgres' });
    admin.on('error', () => {});
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);

    const pool = new Pool({ ...base, database: dbName, max: 4 });
    pool.on('error', () => {});
    pool.on('connect', client => { client.on('error', () => {}); });
    try {
      await pool.query(`
        CREATE TABLE tenants (id uuid PRIMARY KEY);
        CREATE TABLE projects (id text PRIMARY KEY, tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE, name text, project_code text);
        CREATE TABLE documents (
          id text PRIMARY KEY, tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
          project_id text, name text NOT NULL, category text NOT NULL, phase text,
          version integer DEFAULT 1, file_url text NOT NULL, uploaded_at text NOT NULL,
          resource_type text NOT NULL DEFAULT 'projects', resource_id text
        );
        CREATE TABLE settings (tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE);
        INSERT INTO tenants VALUES ('${TENANT_A}'), ('${TENANT_B}');
        INSERT INTO settings VALUES ('${TENANT_A}');
        INSERT INTO projects VALUES ('p1', '${TENANT_A}', 'Villa Martin', '26014');
      `);

      const sql = readFileSync(join(__dirname, '../supabase/migrate_desktop_sync.sql'), 'utf8');
      await pool.query(sql);
      // Rejouable : la migration est lancée à chaque démarrage d'un poste Electron.
      await pool.query(sql);

      const events = async (tenant = TENANT_A) =>
        (await pool.query('SELECT type, node_id FROM desktop_changes WHERE tenant_id = $1 ORDER BY seq', [tenant])).rows;
      const reset = async () => { await pool.query('DELETE FROM desktop_changes'); };

      // Réglage du cabinet : défaut et contrainte.
      expect((await pool.query('SELECT desktop_lock_mode FROM settings')).rows[0].desktop_lock_mode).toBe('advisory');
      await expect(pool.query(`UPDATE settings SET desktop_lock_mode = 'x'`)).rejects.toThrow();

      // Un document d'affaire est journalisé, une pièce jointe d'une autre fiche non.
      await pool.query(`INSERT INTO documents (id, tenant_id, project_id, name, category, file_url, uploaded_at) VALUES ('d1', '${TENANT_A}', 'p1', 'Plan.pdf', 'Plans', 'u', 'now')`);
      await pool.query(`INSERT INTO documents (id, tenant_id, name, category, file_url, uploaded_at, resource_type, resource_id) VALUES ('d2', '${TENANT_A}', 'Devis.pdf', 'Devis', 'u', 'now', 'proposals', 'x')`);
      expect(await events()).toEqual([{ type: 'upsert', node_id: 'doc:d1' }]);

      // Une modification fait avancer updated_at et journalise un upsert.
      const before = (await pool.query(`SELECT updated_at FROM documents WHERE id = 'd1'`)).rows[0].updated_at;
      await new Promise(r => setTimeout(r, 15));
      await pool.query(`UPDATE documents SET name = 'Plan RDC.pdf' WHERE id = 'd1'`);
      const after = (await pool.query(`SELECT updated_at FROM documents WHERE id = 'd1'`)).rows[0].updated_at;
      expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
      expect((await events()).at(-1)).toEqual({ type: 'upsert', node_id: 'doc:d1' });

      // Suppression logique puis restauration puis suppression définitive.
      await reset();
      await pool.query(`UPDATE documents SET deleted_at = now() WHERE id = 'd1'`);
      await pool.query(`UPDATE documents SET deleted_at = NULL WHERE id = 'd1'`);
      await pool.query(`DELETE FROM documents WHERE id = 'd1'`);
      expect((await events()).map(e => e.type)).toEqual(['delete', 'upsert', 'delete']);

      // Verrous : pose, renouvellement, libération.
      await pool.query(`INSERT INTO documents (id, tenant_id, project_id, name, category, file_url, uploaded_at) VALUES ('d3', '${TENANT_A}', 'p1', 'Coupe.dwg', 'Plans', 'u', 'now')`);
      await reset();
      await pool.query(`INSERT INTO document_locks (document_id, tenant_id, user_id, expires_at) VALUES ('d3', '${TENANT_A}', 'u1', now() + interval '8 hours')`);
      await pool.query(`UPDATE document_locks SET expires_at = now() + interval '9 hours' WHERE document_id = 'd3'`);
      await pool.query(`DELETE FROM document_locks WHERE document_id = 'd3'`);
      expect((await events()).map(e => e.type)).toEqual(['lock', 'lock', 'unlock']);

      // Affaire : un changement de nom ou de code est un événement scope, pas un autre champ.
      await reset();
      await pool.query(`UPDATE projects SET name = 'Villa Martin (extension)' WHERE id = 'p1'`);
      await pool.query(`UPDATE projects SET tenant_id = tenant_id WHERE id = 'p1'`);
      expect(await events()).toEqual([{ type: 'scope', node_id: 'prj:p1' }]);
      // Archivage : la colonne n'existait pas au départ, le déclencheur ne doit pas s'en plaindre.
      await pool.query(`ALTER TABLE projects ADD COLUMN archived_at timestamptz`);
      await reset();
      await pool.query(`UPDATE projects SET archived_at = now() WHERE id = 'p1'`);
      expect(await events()).toEqual([{ type: 'scope', node_id: 'prj:p1' }]);

      // Purge : seuls les événements anciens partent, le plancher monte.
      await reset();
      await pool.query(`INSERT INTO desktop_changes (tenant_id, type, node_id, created_at) VALUES ('${TENANT_A}', 'upsert', 'doc:old', now() - interval '40 days')`);
      await pool.query(`INSERT INTO desktop_changes (tenant_id, type, node_id) VALUES ('${TENANT_A}', 'upsert', 'doc:new')`);
      const oldSeq = (await pool.query(`SELECT seq FROM desktop_changes WHERE node_id = 'doc:old'`)).rows[0].seq;
      const deleted = (await pool.query(`SELECT desktop_changes_prune(interval '30 days') AS n`)).rows[0].n;
      expect(Number(deleted)).toBe(1);
      expect((await events()).map(e => e.node_id)).toEqual(['doc:new']);
      expect(Number((await pool.query(`SELECT value FROM desktop_sync_state WHERE key = 'floor_seq'`)).rows[0].value)).toBe(Number(oldSeq));
      // Une purge sans rien d'ancien ne touche pas au plancher.
      expect(Number((await pool.query(`SELECT desktop_changes_prune(interval '30 days') AS n`)).rows[0].n)).toBe(0);

      // Fermer un cabinet supprime ses documents en cascade : les déclencheurs écrivent alors
      // dans le journal pour un cabinet en cours de suppression, ce qui ne doit pas échouer.
      await pool.query(`INSERT INTO documents (id, tenant_id, project_id, name, category, file_url, uploaded_at) VALUES ('d9', '${TENANT_B}', NULL, 'x.pdf', 'Autre', 'u', 'now')`);
      await pool.query(`DELETE FROM tenants WHERE id = '${TENANT_B}'`);
      expect((await pool.query(`SELECT count(*)::int AS n FROM documents WHERE tenant_id = '${TENANT_B}'`)).rows[0].n).toBe(0);
      expect((await events(TENANT_B)).map(e => e.type)).toContain('delete');
    } finally {
      await pool.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
    }
  }, 60000);
});
