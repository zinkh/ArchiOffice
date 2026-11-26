// supabase/migrate_zz_tenant_composite_fks_4.sql (quatrième lot : infrastructure et messagerie, issue
// #245) contre un VRAI Postgres. Même règle que tenantCompositeFks.pg.test.ts : ignoré sans PGHOST,
// exécuté par la CI.
//
// Ce lot a UNE différence avec les précédents, et c'est elle que ce test verrouille : un RESTRICT
// ENTRE DEUX TABLES (agent_missions.coordinator_agent_id vers agents) devient NO ACTION différable,
// car un RESTRICT n'est pas différable et ferait échouer la mise à niveau d'un poste local, quel que
// soit l'ordre des réécritures de tenant_id. Un RESTRICT AUTO-RÉFÉRENT reste un vrai RESTRICT.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hasPostgres = !!process.env.PGHOST;
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';

const SCHEMA = `
  CREATE TABLE tenants (id uuid PRIMARY KEY);
  CREATE TABLE agents (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id));
  -- RESTRICT ENTRE DEUX TABLES, comme en production (coordinator_agent_id), et SET NULL sur l'autre lien.
  CREATE TABLE agent_missions (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    coordinator_agent_id text REFERENCES agents(id) ON DELETE RESTRICT,
    delegate_agent_id text REFERENCES agents(id) ON DELETE SET NULL);
  CREATE TABLE agent_mission_events (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    mission_id text REFERENCES agent_missions(id) ON DELETE CASCADE,
    agent_id text REFERENCES agents(id) ON DELETE SET NULL);
  CREATE TABLE settings (id text PRIMARY KEY, tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id),
    mail_triage_agent_id text REFERENCES agents(id));
  CREATE TABLE support_tickets (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id));
  CREATE TABLE support_messages (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    ticket_id text REFERENCES support_tickets(id) ON DELETE CASCADE);
  CREATE TABLE document_templates (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    source_template_id text REFERENCES document_templates(id) ON DELETE SET NULL);
  CREATE TABLE rag_documents (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id));
  CREATE TABLE rag_chunks (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    rag_document_id text REFERENCES rag_documents(id) ON DELETE CASCADE);
  -- Synthétique : un RESTRICT AUTO-RÉFÉRENT, qui doit rester un vrai RESTRICT non différable.
  CREATE TABLE feed_posts (id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
    reply_to text REFERENCES feed_posts(id) ON DELETE RESTRICT);
`;

describe.skipIf(!hasPostgres)('migrate_zz_tenant_composite_fks_4 : infrastructure et messagerie sur un vrai Postgres', () => {
  it('pose les liens du lot, transforme un RESTRICT entre deux tables en NO ACTION différable, garde le RESTRICT auto-référent, et reste rejouable', async () => {
    const { Client, Pool } = await import('pg');
    const base = {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    };
    const dbName = `compfk4_test_${process.pid}_${Date.now()}`;

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
        INSERT INTO agents VALUES ('ga', '${A}'), ('ga2', '${A}'), ('gb', '${B}');
        INSERT INTO support_tickets VALUES ('ta', '${A}'), ('tb', '${B}');
        INSERT INTO rag_documents VALUES ('da', '${A}'), ('db', '${B}');
        INSERT INTO document_templates VALUES ('tpl-a', '${A}', NULL);
        INSERT INTO feed_posts VALUES ('fp1', '${A}', NULL);
      `);

      const sql = readFileSync(join(__dirname, '../supabase/migrate_zz_tenant_composite_fks_4.sql'), 'utf8');
      const run = async () => {
        const client = await pool.connect();
        const notices: string[] = [];
        client.on('notice', n => notices.push(n.message ?? ''));
        try { await client.query(sql); } finally { client.release(); }
        return notices.join(' | ');
      };

      // coordinator, delegate, events.mission, events.agent, settings, support_messages, document_templates,
      // rag_chunks, feed_posts (auto-référent) = 9.
      expect(await run()).toMatch(/_4 : 9 clé\(s\) composite\(s\) posée\(s\), 0 ignorée\(s\)/);

      const fk = async (name: string) => (await pool.query(
        `SELECT confdeltype, condeferrable FROM pg_constraint WHERE conname = $1`, [name])).rows[0];
      // Le RESTRICT entre deux tables est devenu NO ACTION différable ; le SET NULL reste SET NULL.
      expect(await fk('agent_missions_coordinator_agent_id_tenant_fkey')).toEqual({ confdeltype: 'a', condeferrable: true });
      expect(await fk('agent_missions_delegate_agent_id_tenant_fkey')).toEqual({ confdeltype: 'n', condeferrable: true });
      // Le RESTRICT AUTO-RÉFÉRENT reste un vrai RESTRICT, non différable.
      expect(await fk('feed_posts_reply_to_tenant_fkey')).toEqual({ confdeltype: 'r', condeferrable: false });

      // ── Un parent d'un autre cabinet est refusé ──────────────────────────────────────
      const refused = async (text: string, params: unknown[] = []) => {
        try { await pool.query(text, params); return null; } catch (e: any) { return e.code; }
      };
      expect(await refused(`INSERT INTO agent_missions (id, tenant_id, coordinator_agent_id) VALUES ('x1', $1, 'gb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO agent_missions (id, tenant_id, delegate_agent_id) VALUES ('x2', $1, 'gb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO settings (id, tenant_id, mail_triage_agent_id) VALUES ('x3', $1, 'gb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO support_messages (id, tenant_id, ticket_id) VALUES ('x4', $1, 'tb')`, [A])).toBe('23503');
      expect(await refused(`INSERT INTO rag_chunks (id, tenant_id, rag_document_id) VALUES ('x5', $1, 'db')`, [A])).toBe('23503');

      // ── Le même cabinet passe ────────────────────────────────────────────────────────
      await pool.query(`INSERT INTO agent_missions (id, tenant_id, coordinator_agent_id, delegate_agent_id) VALUES ('m1', $1, 'ga', 'ga2')`, [A]);
      await pool.query(`INSERT INTO agent_mission_events (id, tenant_id, mission_id, agent_id) VALUES ('e1', $1, 'm1', 'ga2')`, [A]);
      await pool.query(`INSERT INTO settings (id, tenant_id, mail_triage_agent_id) VALUES ('s1', $1, 'ga')`, [A]);
      await pool.query(`INSERT INTO support_messages (id, tenant_id, ticket_id) VALUES ('sm1', $1, 'ta')`, [A]);
      await pool.query(`INSERT INTO rag_chunks (id, tenant_id, rag_document_id) VALUES ('c1', $1, 'da')`, [A]);
      await pool.query(`INSERT INTO document_templates (id, tenant_id, source_template_id) VALUES ('tpl-copy', $1, 'tpl-a')`, [A]);
      await pool.query(`INSERT INTO feed_posts (id, tenant_id, reply_to) VALUES ('fp2', $1, 'fp1')`, [A]);

      // ── Règles de suppression ────────────────────────────────────────────────────────
      // L'ex-RESTRICT : supprimer un coordinateur encore référencé est refusé sur-le-champ, comme avant.
      expect(await refused(`DELETE FROM agents WHERE id = 'ga'`)).toBe('23503');
      // SET NULL (colonne) : le délégué disparaît, le cabinet de la mission ne bouge pas.
      await pool.query(`DELETE FROM agents WHERE id = 'ga2'`);
      expect((await pool.query(`SELECT delegate_agent_id, tenant_id FROM agent_missions WHERE id = 'm1'`)).rows[0])
        .toEqual({ delegate_agent_id: null, tenant_id: A });
      expect((await pool.query(`SELECT agent_id, mission_id FROM agent_mission_events WHERE id = 'e1'`)).rows[0])
        .toEqual({ agent_id: null, mission_id: 'm1' });
      // CASCADE : supprimer le ticket emporte ses messages.
      await pool.query(`DELETE FROM support_tickets WHERE id = 'ta'`);
      expect((await pool.query(`SELECT count(*)::int AS n FROM support_messages WHERE id = 'sm1'`)).rows[0].n).toBe(0);
      // Le RESTRICT auto-référent est refusé même quand les contrôles sont différés.
      const tx = await pool.connect();
      try {
        await tx.query('BEGIN');
        await tx.query('SET CONSTRAINTS ALL DEFERRED');
        await expect(tx.query(`DELETE FROM feed_posts WHERE id = 'fp1'`)).rejects.toMatchObject({ code: '23503' });
      } finally {
        await tx.query('ROLLBACK').catch(() => {});
        tx.release();
      }

      // ── Rejouable ────────────────────────────────────────────────────────────────────
      const before = (await pool.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`)).rows[0].n;
      expect(await run()).toMatch(/_4 : 0 clé\(s\) composite\(s\) posée\(s\), 0 ignorée\(s\)/);
      expect((await pool.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f'`)).rows[0].n).toBe(before);

      // ── Mise à niveau d'un poste local : le PARENT (agents) est réécrit AVANT son enfant ─
      // C'est l'ordre qu'un RESTRICT non différable entre deux tables ne supporterait pas.
      const upgrade = await pool.connect();
      try {
        await upgrade.query('BEGIN');
        await upgrade.query('SET CONSTRAINTS ALL DEFERRED');
        for (const t of ['agents', 'agent_missions', 'agent_mission_events', 'settings', 'support_tickets', 'support_messages',
                         'document_templates', 'rag_documents', 'rag_chunks', 'feed_posts']) {
          await upgrade.query(`UPDATE ${t} SET tenant_id = $1 WHERE tenant_id = $2`, [C, A]);
        }
        await upgrade.query('COMMIT');
      } catch (e) {
        await upgrade.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        upgrade.release();
      }
      expect((await pool.query(`SELECT count(*)::int AS n FROM agent_missions WHERE tenant_id = $1`, [C])).rows[0].n).toBe(1);
      expect((await pool.query(`SELECT count(*)::int AS n FROM feed_posts WHERE tenant_id = $1`, [C])).rows[0].n).toBe(2);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);
});
