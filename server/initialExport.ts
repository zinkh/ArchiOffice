// One-time full copy of a local install's tenant data UP to its newly-linked
// cloud tenant — the mirror image of server/initialImport.ts, run right
// after server/localCloudUpgrade.ts has remapped every local row onto the
// cloud tenant/profile ids. Source and destination are swapped throughout:
// reads come from the local `supabaseAdmin`, writes go to `cloudClient`.
//
// Differs from initialImport.ts in one important way: a table that still
// fails after the retry pass does NOT abort the whole job. The local copy of
// that data is safe either way (it already lived here before this job ran),
// so a handful of rows colliding with something the cloud tenant already has
// (e.g. a same-named project_categories/contact_categories row — the only
// realistic collision, see UNIQUE(tenant_id, name) in supabase/schema.sql)
// must not block the other ~40 tables from reaching the cloud. Those rows
// are reported back as job.conflicts instead.
import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SYNC_TABLES, JUNCTION_TABLES } from './syncTables';
import { storageDir } from './offlineAccount';

const PAGE_SIZE = 500;
const STORAGE_BUCKETS = ['documents', 'logos', 'meeting-photos'];

export interface ExportConflict {
  table: string;
  rowCount: number;
  error: string;
}

export interface ExportJobStatus {
  status: 'running' | 'done' | 'error';
  tablesDone: number;
  tablesTotal: number;
  currentTable: string | null;
  rowsDone: number;
  filesDone: number;
  error: string | null;
  conflicts: ExportConflict[];
}

const jobs = new Map<string, ExportJobStatus>();

export function getExportJob(jobId: string): ExportJobStatus | null {
  return jobs.get(jobId) || null;
}

async function fetchAllRows(supabaseAdmin: SupabaseClient, table: string, tenantId: string): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
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

async function upsertRows(cloudClient: SupabaseClient, table: string, rows: any[]): Promise<any[]> {
  if (rows.length === 0) return [];
  const failed: any[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await cloudClient.from(table).upsert(batch, { onConflict: 'id' });
    if (error) failed.push(...batch);
  }
  return failed;
}

async function exportJunctionRows(
  supabaseAdmin: SupabaseClient,
  cloudClient: SupabaseClient,
  parentTable: string,
  parentIds: string[],
) {
  if (parentIds.length === 0) return;
  const relevant = JUNCTION_TABLES.filter((j) => j.parentTable === parentTable);
  for (const { table, parentIdColumn } of relevant) {
    for (let i = 0; i < parentIds.length; i += 100) {
      const chunk = parentIds.slice(i, i + 100);
      const { data, error } = await supabaseAdmin.from(table).select('*').in(parentIdColumn, chunk);
      if (error || !data) continue;
      if (data.length > 0) {
        await cloudClient.from(table).upsert(data);
      }
    }
  }
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

async function exportStorageFolder(
  cloudClient: SupabaseClient,
  bucket: string,
  tenantId: string,
  localBaseDir: string,
  onFile: () => void,
) {
  const tenantDir = path.join(localBaseDir, tenantId);
  const files = listFilesRecursive(tenantDir);
  for (const filePath of files) {
    const relPath = path.relative(localBaseDir, filePath).split(path.sep).join('/');
    const buf = fs.readFileSync(filePath);
    const { error } = await cloudClient.storage.from(bucket).upload(relPath, buf, { upsert: true });
    if (!error) onFile();
  }
}

export async function runInitialExport(
  jobId: string,
  supabaseAdmin: SupabaseClient,
  cloudClient: SupabaseClient,
  tenantId: string,
): Promise<void> {
  const job: ExportJobStatus = {
    status: 'running',
    tablesDone: 0,
    tablesTotal: SYNC_TABLES.length,
    currentTable: null,
    rowsDone: 0,
    filesDone: 0,
    error: null,
    conflicts: [],
  };
  jobs.set(jobId, job);

  try {
    const projectIds: string[] = [];
    const observationIds: string[] = [];
    const pendingRetry: { table: string; rows: any[] }[] = [];

    for (const table of SYNC_TABLES) {
      job.currentTable = table;
      const rows = await fetchAllRows(supabaseAdmin, table, tenantId);
      const failed = await upsertRows(cloudClient, table, rows);
      if (failed.length > 0) pendingRetry.push({ table, rows: failed });

      if (table === 'projects') projectIds.push(...rows.map((r) => r.id));
      if (table === 'observations') observationIds.push(...rows.map((r) => r.id));

      job.rowsDone += rows.length;
      job.tablesDone += 1;
    }

    // Same 2-pass retry as initialImport.ts (a table referencing another one
    // imported later) — but a row still failing here is a real conflict
    // (most likely a UNIQUE(tenant_id, name) collision with data the cloud
    // tenant already had), not just an ordering issue. Reported, not thrown.
    for (const { table, rows } of pendingRetry) {
      const stillFailed = await upsertRows(cloudClient, table, rows);
      if (stillFailed.length > 0) {
        job.conflicts.push({
          table,
          rowCount: stillFailed.length,
          error: `${stillFailed.length} ligne(s) déjà en conflit avec des données existantes côté cloud`,
        });
      }
    }

    job.currentTable = 'project_categories_junction / project_team';
    await exportJunctionRows(supabaseAdmin, cloudClient, 'projects', projectIds);
    job.currentTable = 'observation_reports';
    await exportJunctionRows(supabaseAdmin, cloudClient, 'observations', observationIds);

    job.currentTable = 'storage';
    for (const bucket of STORAGE_BUCKETS) {
      const localDir = storageDir(bucket);
      await exportStorageFolder(cloudClient, bucket, tenantId, localDir, () => {
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
