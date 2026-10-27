// merge_contacts contre un VRAI Postgres : rattachement des clés étrangères, des liens
// polymorphes et des références jsonb, conflits d'unicité, atomicité, isolation par
// cabinet. Même règle que documentSequences.pg.test.ts : ignoré sans PGHOST, exécuté
// par la CI (ci.yml fournit un service postgres). Base jetable créée puis supprimée ici.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hasPostgres = !!process.env.PGHOST;
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

async function withDb(run: (q: (sql: string, params?: any[]) => Promise<any[]>) => Promise<void>) {
  const { Client, Pool } = await import('pg');
  const base = {
    host: process.env.PGHOST,
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
  };
  const dbName = `contactmerge_test_${process.pid}_${Date.now()}`;
  const admin = new Client({ ...base, database: process.env.PGDATABASE || 'postgres' });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const pool = new Pool({ ...base, database: dbName, max: 4 });
  pool.on('error', () => {});
  pool.on('connect', client => { client.on('error', () => {}); });
  try {
    // Sous-ensemble du schéma : la fonction ignore les tables absentes (instance non migrée).
    await pool.query(`
      CREATE FUNCTION my_tenant_id() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
      CREATE TABLE tenants (id uuid PRIMARY KEY);
      CREATE TABLE contacts (
        id text PRIMARY KEY, tenant_id uuid NOT NULL, first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '',
        company_name text, email text, phone text, siret text, address text, city text, notes text, tags text,
        ca_amount numeric, ragic_id text, odoo_id integer, google_resource_name text, corps_etat jsonb);
      CREATE TABLE invoices (id text PRIMARY KEY, tenant_id uuid, client_id text, billing_contact_id text);
      CREATE TABLE projects (id text PRIMARY KEY, tenant_id uuid, client_id text);
      CREATE TABLE meeting_attendees (id text PRIMARY KEY, tenant_id uuid, meeting_id text, contact_id text, UNIQUE (meeting_id, contact_id));
      CREATE TABLE contact_qualifications (id text PRIMARY KEY, tenant_id uuid, contact_id text, organisme text, reference text, UNIQUE (contact_id, organisme, reference));
      CREATE TABLE email_links (id text PRIMARY KEY, tenant_id uuid, local_type text, local_id text, connection_id text, external_message_id text);
      CREATE UNIQUE INDEX email_links_unique_idx ON email_links (local_type, local_id, connection_id, external_message_id);
      CREATE TABLE documents (id text PRIMARY KEY, tenant_id uuid, contact_id text, resource_type text, resource_id text);
      CREATE TABLE notes_honoraires (id text PRIMARY KEY, tenant_id uuid, cotraitants_facturation jsonb);
      CREATE TABLE act_data (id text PRIMARY KEY, tenant_id uuid, consultation jsonb);
      INSERT INTO tenants VALUES ('${A}'), ('${B}');
    `);
    await pool.query(readFileSync(join(__dirname, '../supabase/migrate_merge_contacts.sql'), 'utf8'));
    await run(async (sql, params) => (await pool.query(sql, params)).rows);
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
}

const merge = (q: any, primary: string, dups: string[], patch: object = {}, tenant = A) =>
  q('SELECT merge_contacts($1::uuid, $2::text, $3::text[], $4::jsonb, $5::text) AS r', [tenant, primary, dups, JSON.stringify(patch), 'user-1']);

describe.skipIf(!hasPostgres)('merge_contacts : vrai Postgres', () => {
  it('rattache tout ce qui pointait vers les doublons, dédoublonne, applique les valeurs choisies et journalise', async () => {
    await withDb(async q => {
      await q(`INSERT INTO contacts (id, tenant_id, company_name, email, siret, ca_amount, odoo_id, corps_etat) VALUES
        ('p', '${A}', 'Selia Association', 'contact@selia.example', '82345678900012', 100, NULL, '["maçonnerie"]'),
        ('d1', '${A}', 'SELIA ASSOC.', 'compta@selia.example', NULL, 50, 77, '["peinture"]'),
        ('d2', '${A}', 'Selia', NULL, NULL, 25, NULL, NULL),
        ('x', '${A}', 'Autre', NULL, NULL, NULL, NULL, NULL)`);
      await q(`INSERT INTO invoices VALUES ('i1', '${A}', 'd1', 'd2'), ('i2', '${A}', 'p', NULL), ('i3', '${A}', 'x', NULL)`);
      await q(`INSERT INTO projects VALUES ('pr1', '${A}', 'd2')`);
      // Même réunion : le doublon et la fiche conservée y figurent tous deux (contrainte unique).
      await q(`INSERT INTO meeting_attendees VALUES ('m1', '${A}', 'mt1', 'p'), ('m2', '${A}', 'mt1', 'd1'), ('m3', '${A}', 'mt2', 'd1'), ('m4', '${A}', 'mt2', 'd2')`);
      await q(`INSERT INTO contact_qualifications VALUES ('q1', '${A}', 'p', 'Qualibat', '123'), ('q2', '${A}', 'd1', 'Qualibat', '123'), ('q3', '${A}', 'd1', 'RGE', '9')`);
      await q(`INSERT INTO email_links VALUES ('e1', '${A}', 'contact', 'p', 'c1', 'msg1'), ('e2', '${A}', 'contact', 'd1', 'c1', 'msg1'), ('e3', '${A}', 'contact', 'd1', 'c1', 'msg2'), ('e4', '${A}', 'project', 'd1', 'c1', 'msg9')`);
      await q(`INSERT INTO documents VALUES ('dc1', '${A}', 'd1', 'projects', 'pr1'), ('dc2', '${A}', NULL, 'contacts', 'd2'), ('dc3', '${A}', NULL, 'projects', 'd2')`);
      await q(`INSERT INTO notes_honoraires VALUES ('n1', '${A}', '[{"contact_id": "d1", "nom": "Selia"}, {"contact_id": "x"}]')`);
      await q(`INSERT INTO act_data VALUES ('a1', '${A}', '{"entreprises": [{"contact_id": "d2"}, {"contact_id": "d1x"}]}')`);

      const [{ r }] = await merge(q, 'p', ['d1', 'd2'], { email: 'contact@selia.example', phone: '03 83 00 00 01', notes: 'fusionné', corps_etat: ['maçonnerie', 'peinture'], id: 'pirate', tenant_id: B });

      expect(r.primary_id).toBe('p');
      expect(r.merged_ids.sort()).toEqual(['d1', 'd2']);

      // Clés étrangères.
      expect((await q(`SELECT id, client_id, billing_contact_id FROM invoices ORDER BY id`))).toEqual([
        { id: 'i1', client_id: 'p', billing_contact_id: 'p' },
        { id: 'i2', client_id: 'p', billing_contact_id: null },
        { id: 'i3', client_id: 'x', billing_contact_id: null },
      ]);
      expect((await q(`SELECT client_id FROM projects`))[0].client_id).toBe('p');
      // Unicité : une seule ligne par réunion, une seule qualification identique.
      expect((await q(`SELECT meeting_id, contact_id FROM meeting_attendees ORDER BY meeting_id`))).toEqual([
        { meeting_id: 'mt1', contact_id: 'p' }, { meeting_id: 'mt2', contact_id: 'p' },
      ]);
      expect((await q(`SELECT organisme, reference, contact_id FROM contact_qualifications ORDER BY organisme`))).toEqual([
        { organisme: 'Qualibat', reference: '123', contact_id: 'p' }, { organisme: 'RGE', reference: '9', contact_id: 'p' },
      ]);
      // Liens polymorphes : seuls les liens « contact » bougent.
      expect((await q(`SELECT id, local_type, local_id FROM email_links ORDER BY id`)).map((x: any) => `${x.id}:${x.local_type}:${x.local_id}`))
        .toEqual(['e1:contact:p', 'e3:contact:p', 'e4:project:d1']);
      expect((await q(`SELECT id, contact_id, resource_id FROM documents ORDER BY id`))).toEqual([
        { id: 'dc1', contact_id: 'p', resource_id: 'pr1' },
        { id: 'dc2', contact_id: null, resource_id: 'p' },
        { id: 'dc3', contact_id: null, resource_id: 'd2' }, // resource_type 'projects' : intact
      ]);
      // jsonb : valeur exacte seulement (« d1x » n'est pas « d1 »).
      expect((await q(`SELECT cotraitants_facturation AS c FROM notes_honoraires`))[0].c).toEqual([{ contact_id: 'p', nom: 'Selia' }, { contact_id: 'x' }]);
      expect((await q(`SELECT consultation AS c FROM act_data`))[0].c).toEqual({ entreprises: [{ contact_id: 'p' }, { contact_id: 'd1x' }] });

      // Fiche conservée : valeurs choisies, identifiant Odoo repris, CA cumulé, id et cabinet intouchés.
      const [p] = await q(`SELECT * FROM contacts WHERE id = 'p'`);
      expect(p).toMatchObject({ tenant_id: A, email: 'contact@selia.example', phone: '03 83 00 00 01', notes: 'fusionné', odoo_id: 77, company_name: 'Selia Association', siret: '82345678900012' });
      expect(Number(p.ca_amount)).toBe(175);
      expect(p.corps_etat).toEqual(['maçonnerie', 'peinture']);
      expect((await q(`SELECT id FROM contacts ORDER BY id`)).map((x: any) => x.id)).toEqual(['p', 'x']);

      const log = await q(`SELECT primary_id, primary_name, merged, moved, merged_by FROM contact_merge_log`);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ primary_id: 'p', primary_name: 'Selia Association', merged_by: 'user-1' });
      expect(log[0].merged.map((m: any) => m.id).sort()).toEqual(['d1', 'd2']);
      expect(log[0].moved['invoices.client_id']).toBe(1);
    });
  });

  it('refuse sans rien modifier : contact introuvable, doublon identique à la fiche conservée, autre cabinet', async () => {
    await withDb(async q => {
      await q(`INSERT INTO contacts (id, tenant_id, company_name) VALUES ('p', '${A}', 'P'), ('d', '${A}', 'D'), ('o', '${B}', 'Autre cabinet')`);
      await q(`INSERT INTO invoices VALUES ('i1', '${A}', 'd', NULL)`);

      await expect(merge(q, 'p', ['d', 'inconnu'])).rejects.toThrow(/introuvable/);
      await expect(merge(q, 'p', ['p'])).rejects.toThrow(/au moins un doublon/);
      await expect(merge(q, 'p', ['o'])).rejects.toThrow(/introuvable/); // contact d'un autre cabinet
      await expect(merge(q, 'p', ['d'], {}, B)).rejects.toThrow(/introuvable/); // mauvais cabinet appelant

      expect((await q(`SELECT client_id FROM invoices`))[0].client_id).toBe('d');
      expect((await q(`SELECT count(*)::int AS n FROM contacts`))[0].n).toBe(3);
      expect((await q(`SELECT count(*)::int AS n FROM contact_merge_log`))[0].n).toBe(0);
    });
  });

  it('ne touche jamais aux lignes d\'un autre cabinet qui portent le même identifiant', async () => {
    await withDb(async q => {
      await q(`INSERT INTO contacts (id, tenant_id, company_name) VALUES ('p', '${A}', 'P'), ('d', '${A}', 'D')`);
      await q(`INSERT INTO invoices VALUES ('ia', '${A}', 'd', NULL), ('ib', '${B}', 'd', NULL)`);
      await merge(q, 'p', ['d']);
      expect((await q(`SELECT id, client_id FROM invoices ORDER BY id`))).toEqual([
        { id: 'ia', client_id: 'p' }, { id: 'ib', client_id: 'd' },
      ]);
    });
  });
});
