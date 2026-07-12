// Local-only bookkeeping table for outbound sync (local edits → cloud).
// Deliberately NOT part of supabase/schema.sql / server/syncTables.ts — it
// only ever exists in the local embedded Postgres, created here directly via
// `pg` (PostgREST can't do DDL), and is never touched by the cloud schema
// migration or the initial import. Written by server/offlineGateway.ts's
// /rest/v1 proxy hook on every successful-looking local write, consumed by
// server/cloudSync.ts's outbound-replay loop.
import { Pool } from 'pg';

let pool: Pool | null = null;

function getPool(pgUrl: string): Pool {
  if (!pool) pool = new Pool({ connectionString: pgUrl });
  return pool;
}

export async function ensurePendingPushTable(pgUrl: string): Promise<void> {
  await getPool(pgUrl).query(`
    CREATE TABLE IF NOT EXISTS _local_pending_push (
      id BIGSERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      op TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      pushed_at TIMESTAMPTZ,
      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT
    )
  `);
}

export interface PendingPushEntry {
  id: number;
  table_name: string;
  row_id: string;
  op: string;
  attempts: number;
}

export async function recordPendingPush(pgUrl: string, tableName: string, rowId: string, op: string): Promise<void> {
  await getPool(pgUrl).query(
    'INSERT INTO _local_pending_push (table_name, row_id, op) VALUES ($1, $2, $3)',
    [tableName, rowId, op],
  );
}

export async function fetchPendingPushBatch(pgUrl: string, limit = 50): Promise<PendingPushEntry[]> {
  const { rows } = await getPool(pgUrl).query(
    'SELECT id, table_name, row_id, op, attempts FROM _local_pending_push WHERE pushed_at IS NULL ORDER BY id LIMIT $1',
    [limit],
  );
  return rows;
}

export async function markPendingPushProcessed(pgUrl: string, id: number): Promise<void> {
  await getPool(pgUrl).query('UPDATE _local_pending_push SET pushed_at = now() WHERE id = $1', [id]);
}

export async function markPendingPushFailed(pgUrl: string, id: number, error: string): Promise<void> {
  await getPool(pgUrl).query(
    'UPDATE _local_pending_push SET attempts = attempts + 1, last_error = $2 WHERE id = $1',
    [id, error],
  );
}

export async function countPendingPush(pgUrl: string): Promise<number> {
  const { rows } = await getPool(pgUrl).query('SELECT count(*)::int AS n FROM _local_pending_push WHERE pushed_at IS NULL');
  return rows[0]?.n ?? 0;
}
