// One-time full copy of a cloud tenant's data into the local Postgres,
// triggered right after a successful cloud-link (server/cloudLinkRoutes.ts).
// Runs in-process (same Node process as the rest of server.ts) so it can
// write storage files directly via server/offlineAccount.ts's storageDir()
// instead of round-tripping through HTTP.
import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SYNC_TABLES, JUNCTION_TABLES } from './syncTables';
import { storageDir } from './offlineAccount';

const PAGE_SIZE = 500;
const STORAGE_BUCKETS = ['documents', 'logos', 'meeting-photos'];

export interface ImportJobStatus {
  status: 'running' | 'done' | 'error';
  tablesDone: number;
  tablesTotal: number;
  currentTable: string | null;
  rowsDone: number;
  filesDone: number;
  error: string | null;
  /** sync_log.id captured before any table was read — seeds the inbound watermark. */
  initialWatermarkId: number | null;
}

const jobs = new Map<string, ImportJobStatus>();

export function getImportJob(jobId: string): ImportJobStatus | null {
  return jobs.get(jobId) || null;
}

async function fetchAllRows(cloudClient: SupabaseClient, table: string, tenantId: string): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await cloudClient
      .from(table)
      .select('*')
      .eq('tenant_id', tenantId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

async function upsertRows(supabaseAdmin: SupabaseClient, table: string, rows: any[]): Promise<any[]> {
  if (rows.length === 0) return [];
  const failed: any[] = [];
  // Batch upserts to keep individual PostgREST payloads reasonable.
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await supabaseAdmin.from(table).upsert(batch, { onConflict: 'id' });
    if (error) failed.push(...batch);
  }
  return failed;
}

async function importJunctionRows(
  cloudClient: SupabaseClient,
  supabaseAdmin: SupabaseClient,
  parentTable: string,
  parentIds: string[],
) {
  if (parentIds.length === 0) return;
  const relevant = JUNCTION_TABLES.filter((j) => j.parentTable === parentTable);
  for (const { table, parentIdColumn } of relevant) {
    for (let i = 0; i < parentIds.length; i += 100) {
      const chunk = parentIds.slice(i, i + 100);
      const { data, error } = await cloudClient.from(table).select('*').in(parentIdColumn, chunk);
      if (error || !data) continue;
      if (data.length > 0) {
        await supabaseAdmin.from(table).upsert(data);
      }
    }
  }
}

async function importStorageFolder(
  cloudClient: SupabaseClient,
  bucket: string,
  cloudPrefix: string,
  localBaseDir: string,
  onFile: () => void,
) {
  const { data: entries, error } = await cloudClient.storage.from(bucket).list(cloudPrefix, { limit: 1000 });
  if (error || !entries) return;

  for (const entry of entries) {
    const cloudPath = cloudPrefix ? `${cloudPrefix}/${entry.name}` : entry.name;
    // Supabase Storage's list() marks directories with a null id/metadata —
    // files always have metadata (size, mimetype, etc.).
    const isFolder = entry.id === null;
    if (isFolder) {
      await importStorageFolder(cloudClient, bucket, cloudPath, localBaseDir, onFile);
      continue;
    }
    const { data: blob, error: dlErr } = await cloudClient.storage.from(bucket).download(cloudPath);
    if (dlErr || !blob) continue;
    const localPath = path.join(localBaseDir, cloudPath);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    const buf = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(localPath, buf);
    onFile();
  }
}

export async function runInitialImport(
  jobId: string,
  cloudClient: SupabaseClient,
  supabaseAdmin: SupabaseClient,
  tenantId: string,
): Promise<void> {
  const job: ImportJobStatus = {
    status: 'running',
    tablesDone: 0,
    tablesTotal: SYNC_TABLES.length,
    currentTable: null,
    rowsDone: 0,
    filesDone: 0,
    error: null,
    initialWatermarkId: null,
  };
  jobs.set(jobId, job);

  try {
    // Capture the watermark BEFORE reading any table, so anything that
    // changes on the cloud mid-import gets picked up by the ongoing
    // inbound-sync job afterwards rather than silently missed.
    const { data: watermarkRow } = await cloudClient
      .from('sync_log')
      .select('id')
      .eq('tenant_id', tenantId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    job.initialWatermarkId = watermarkRow?.id ?? 0;

    const projectIds: string[] = [];
    const observationIds: string[] = [];
    const pendingRetry: { table: string; rows: any[] }[] = [];

    for (const table of SYNC_TABLES) {
      job.currentTable = table;
      const rows = await fetchAllRows(cloudClient, table, tenantId);
      const failed = await upsertRows(supabaseAdmin, table, rows);
      if (failed.length > 0) pendingRetry.push({ table, rows: failed });

      if (table === 'projects') projectIds.push(...rows.map((r) => r.id));
      if (table === 'observations') observationIds.push(...rows.map((r) => r.id));

      job.rowsDone += rows.length;
      job.tablesDone += 1;
    }

    // Same 2-pass retry pattern already used by electron/applySchema.cjs for
    // ordinary forward-reference issues (a table referencing another one
    // that happened to be imported later) — avoids hand-maintaining a full
    // FK dependency graph across 44 tables.
    for (const { table, rows } of pendingRetry) {
      const stillFailed = await upsertRows(supabaseAdmin, table, rows);
      if (stillFailed.length > 0) {
        throw new Error(`${table}: ${stillFailed.length} row(s) failed to import after retry`);
      }
    }

    job.currentTable = 'project_categories_junction / project_team';
    await importJunctionRows(cloudClient, supabaseAdmin, 'projects', projectIds);
    job.currentTable = 'observation_reports';
    await importJunctionRows(cloudClient, supabaseAdmin, 'observations', observationIds);

    job.currentTable = 'storage';
    for (const bucket of STORAGE_BUCKETS) {
      const localDir = storageDir(bucket);
      await importStorageFolder(cloudClient, bucket, tenantId, localDir, () => {
        job.filesDone += 1;
      });
    }

    job.status = 'done';
    job.currentTable = null;
  } catch (err: any) {
    job.status = 'error';
    job.error = err?.message || String(err);
  }
}
