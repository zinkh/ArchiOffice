// Covers server/initialExport.ts — the local→cloud push half of
// server/localCloudUpgrade.ts's "switch a local-only install to cloud
// without losing data" flow. Unlike server/initialImport.ts (its mirror
// image), a table that still fails after the retry pass must NOT abort the
// whole job: the local copy of that data is safe regardless, so a collision
// on one table (typically a UNIQUE(tenant_id, name) clash with something the
// cloud tenant already has) must not block the other ~40 tables from
// reaching the cloud. That's the behavior these tests exist to pin down.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';

let dataDir: string;

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-initial-export-'));
  process.env.OFFLINE_DATA_DIR = dataDir;
});

describe('runInitialExport', () => {
  it('pushes local rows for the given tenant up to the cloud client', async () => {
    const { runInitialExport, getExportJob } = await import('../server/initialExport');
    const local = new FakeSupabaseAdmin() as any;
    const cloud = new FakeSupabaseAdmin() as any;
    const tenantId = 'tenant-push';

    local.seed('projects', [{ id: 'proj-1', tenant_id: tenantId, name: 'Villa Martin' }]);
    local.seed('contacts', [{ id: 'contact-1', tenant_id: tenantId, name: 'Jean Dupont' }]);
    // A different tenant's row must never leak into the push.
    local.seed('projects', [{ id: 'proj-other', tenant_id: 'other-tenant', name: 'Not mine' }]);

    const jobId = 'job-push';
    await runInitialExport(jobId, local, cloud, tenantId);

    const job = getExportJob(jobId)!;
    expect(job.status).toBe('done');
    expect(job.conflicts).toEqual([]);

    const pushedProjects = cloud.getTable('projects');
    expect(pushedProjects).toHaveLength(1);
    expect(pushedProjects[0]).toMatchObject({ id: 'proj-1', tenant_id: tenantId, name: 'Villa Martin' });
    expect(cloud.getTable('contacts')).toHaveLength(1);
  });

  it('collects a persistently-failing table as a conflict instead of aborting the job', async () => {
    const { runInitialExport, getExportJob } = await import('../server/initialExport');
    const local = new FakeSupabaseAdmin() as any;
    const cloud = new FakeSupabaseAdmin() as any;
    const tenantId = 'tenant-conflict';

    local.seed('tasks', [{ id: 'task-1', tenant_id: tenantId, title: 'Coulage dalle' }]);
    local.seed('projects', [{ id: 'proj-2', tenant_id: tenantId, name: 'Extension Dupont' }]);
    // Simulates a table where every upsert keeps failing (e.g. a real
    // UNIQUE(tenant_id, name) collision on the cloud side) — this fake has
    // no constraint enforcement of its own, so breakTable() stands in for it.
    cloud.breakTable('tasks');

    const jobId = 'job-conflict';
    await runInitialExport(jobId, local, cloud, tenantId);

    const job = getExportJob(jobId)!;
    // The job as a whole still finishes — one blocked table is not fatal.
    expect(job.status).toBe('done');
    expect(job.conflicts).toHaveLength(1);
    expect(job.conflicts[0]).toMatchObject({ table: 'tasks', rowCount: 1 });

    // The other 43 tables, including the one right after 'tasks' in
    // SYNC_TABLES, still made it through.
    expect(cloud.getTable('projects')).toHaveLength(1);
  });

  it('uploads local storage files under the tenant prefix to the cloud bucket', async () => {
    const { runInitialExport, getExportJob } = await import('../server/initialExport');
    const local = new FakeSupabaseAdmin() as any;
    const cloud = new FakeSupabaseAdmin() as any;
    const tenantId = 'tenant-storage';

    const tenantDir = path.join(dataDir, 'storage', 'documents', tenantId);
    fs.mkdirSync(tenantDir, { recursive: true });
    fs.writeFileSync(path.join(tenantDir, 'devis.pdf'), 'fake pdf bytes');

    const jobId = 'job-storage';
    await runInitialExport(jobId, local, cloud, tenantId);

    const job = getExportJob(jobId)!;
    expect(job.status).toBe('done');
    expect(job.filesDone).toBe(1);

    const { data: listed } = await cloud.storage.from('documents').list(tenantId);
    expect(listed.map((e: any) => e.name)).toContain('devis.pdf');
  });
});
