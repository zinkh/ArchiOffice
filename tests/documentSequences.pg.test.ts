// next_document_number contre un VRAI Postgres, avec de vraies connexions
// parallèles : le faux Supabase des autres tests ne peut pas reproduire un verrou
// de ligne. Même règle que applySchemaFreshInstall.test.ts : ignoré sans PGHOST,
// exécuté par la CI (ci.yml fournit un service postgres).
//
// La migration est jouée dans une base jetable, créée puis supprimée ici, pour ne
// pas toucher à celle que d'autres fichiers de tests réinitialisent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hasPostgres = !!process.env.PGHOST;
const TENANT_A = '00000000-0000-0000-0000-00000000000a';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';
const PROJECT = '11111111-1111-1111-1111-111111111111';

describe.skipIf(!hasPostgres)('next_document_number : atomicité sur un vrai Postgres', () => {
  it('20 appels simultanés reçoivent 20 valeurs distinctes et consécutives, et la série s\'amorce sur l\'existant', async () => {
    const { Client, Pool } = await import('pg');
    const base = {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    };
    const dbName = `docseq_test_${process.pid}_${Date.now()}`;

    const admin = new Client({ ...base, database: process.env.PGDATABASE || 'postgres' });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);

    const pool = new Pool({ ...base, database: dbName, max: 20 });
    try {
      await pool.query(`
        CREATE TABLE tenants (id uuid PRIMARY KEY);
        CREATE TABLE invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, invoice_number text, project_id uuid, invoice_type text);
        CREATE TABLE proposals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, reference text);
        CREATE TABLE notes_honoraires (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, numero text);
        INSERT INTO tenants VALUES ('${TENANT_A}'), ('${TENANT_B}');
        INSERT INTO invoices (tenant_id, invoice_number, project_id, invoice_type) VALUES
          ('${TENANT_A}', 'FAC-2026-020', NULL, 'standard'),
          ('${TENANT_A}', 'Brouillon', NULL, 'standard'),
          ('${TENANT_A}', NULL, '${PROJECT}', 'acompte');
        INSERT INTO notes_honoraires (tenant_id, numero) VALUES ('${TENANT_B}', 'NH-01'), ('${TENANT_B}', 'NH-01'), ('${TENANT_B}', 'NH-01');
      `);
      await pool.query(readFileSync(join(__dirname, '../supabase/migrate_atomic_document_numbering.sql'), 'utf8'));

      const next = async (tenant: string, series: string, year = 2026) =>
        Number((await pool.query('SELECT next_document_number($1::uuid, $2::text, $3::int) AS n', [tenant, series, year])).rows[0].n);

      // Amorçage : plus grand suffixe de l'année (020), donc la suite commence à 21.
      expect(await next(TENANT_A, 'invoice')).toBe(21);
      // Une autre année repart de 1, quels que soient les numéros existants.
      expect(await next(TENANT_A, 'invoice', 2027)).toBe(1);
      // « NH-01 » (saisie à la main) n'est pas une séquence : la série démarre à 1.
      expect(await next(TENANT_B, 'note_honoraires')).toBe(1);
      // Un acompte existe sur l'affaire : la référence suivante est la 2e, quelle que soit l'année.
      expect(await next(TENANT_A, `acompte:${PROJECT}`)).toBe(2);
      expect(await next(TENANT_A, `acompte:${PROJECT}`, 2027)).toBe(3);

      // Vraie concurrence : 20 connexions en parallèle sur une même série.
      const values = await Promise.all(Array.from({ length: 20 }, () => next(TENANT_A, 'proposal')));
      expect(new Set(values).size).toBe(20);
      expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

      // Même scénario sur une série jamais amorcée : deux premiers appels simultanés.
      const first = await Promise.all(Array.from({ length: 10 }, () => next(TENANT_B, 'invoice')));
      expect([...first].sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));

      // Série inconnue : erreur franche, pas de valeur.
      await expect(next(TENANT_A, 'inconnue')).rejects.toThrow(/inconnue/);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);
});
