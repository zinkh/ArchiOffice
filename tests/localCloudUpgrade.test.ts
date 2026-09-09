// Guard-clause coverage for server/localCloudUpgrade.ts — the route that
// lets an already-configured local-only install switch to cloud-linked
// without losing its data. The actual data migration (the raw-pg transaction
// remapping tenant_id/profile ids across the local schema) needs a real
// Postgres, which this sandbox can't run (see fakeSupabaseAdmin.ts's own
// header comment on why these tests use an in-memory fake instead) — so this
// file exercises everything that happens before that transaction: the
// guard clauses and inline local-JWT authentication, which mirror
// server/offlineGateway.ts's /auth/v1/user shim and are exactly the part
// that's easy to get subtly wrong (this router is mounted before the
// generic /api auth middleware in server.ts, so it must authenticate the
// caller itself — see the file's own header comment).
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';

let dataDir: string;
let app: express.Express;

async function setupApp() {
  const { createLocalCloudUpgradeRouter } = await import('../server/localCloudUpgrade');
  const supabaseAdmin = new FakeSupabaseAdmin() as any;
  const activateCloudSync = async () => {};
  const a = express();
  a.use(createLocalCloudUpgradeRouter(supabaseAdmin, activateCloudSync));
  return a;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-local-cloud-upgrade-'));
  process.env.OFFLINE_DATA_DIR = dataDir;
  delete process.env.OFFLINE_PG_URL;
  delete process.env.CLOUD_SUPABASE_URL;
  delete process.env.CLOUD_SUPABASE_ANON_KEY;
  app = await setupApp();
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('POST /cloud-link-upgrade', () => {
  it('rejects when no local account is configured on this install', async () => {
    const res = await request(app).post('/cloud-link-upgrade').send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects when the install is already cloud-linked', async () => {
    const { writeLocalAccount, signLocalJwt } = await import('../server/offlineAccount');
    const { writeCloudLinkState } = await import('../server/cloudLinkState');
    writeLocalAccount({ userId: 'u1', tenantId: 't1', email: 'local@archioffice.local', agencyName: 'AAZS', passwordHash: 'x' });
    writeCloudLinkState({
      tenantId: 't1', cloudUserId: 'cu1', email: 'a@b.test', linkedAt: new Date().toISOString(),
      importCompleted: true, initialWatermarkId: 0, installId: 'i1',
    });
    const token = signLocalJwt('u1');

    const res = await request(app)
      .post('/cloud-link-upgrade')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(409);
  });
});

describe('POST /cloud-link-upgrade — not yet linked', () => {
  beforeAll(async () => {
    // Fresh data dir: a local account exists, but no cloud-link.json.
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-local-cloud-upgrade-2-'));
    process.env.OFFLINE_DATA_DIR = dataDir;
    const { writeLocalAccount } = await import('../server/offlineAccount');
    writeLocalAccount({ userId: 'u2', tenantId: 't2', email: 'local@archioffice.local', agencyName: 'AAZS', passwordHash: 'x' });
  });

  it('rejects with no Authorization header', async () => {
    const res = await request(app).post('/cloud-link-upgrade').send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(401);
  });

  it("rejects a token that doesn't belong to this install's local account", async () => {
    const { signLocalJwt } = await import('../server/offlineAccount');
    const token = signLocalJwt('someone-else');
    const res = await request(app)
      .post('/cloud-link-upgrade')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(401);
  });

  it('rejects a valid session with no email/password', async () => {
    const { signLocalJwt } = await import('../server/offlineAccount');
    const token = signLocalJwt('u2');
    const res = await request(app)
      .post('/cloud-link-upgrade')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('reports a clear error when the cloud provider is not configured, without touching a database', async () => {
    // OFFLINE_PG_URL only needs to be non-empty to pass this route's own
    // presence check — it's never dialed before the cloud-config check below.
    process.env.OFFLINE_PG_URL = 'postgres://unused-in-this-test';
    const { signLocalJwt } = await import('../server/offlineAccount');
    const token = signLocalJwt('u2');
    const res = await request(app)
      .post('/cloud-link-upgrade')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/CLOUD_SUPABASE/);
    delete process.env.OFFLINE_PG_URL;
  });
});
