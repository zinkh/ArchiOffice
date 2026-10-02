// Guard-clause coverage for server/cloudLinkRoutes.ts's
// POST /cloud-link-retry-import — the route added so a failed initial
// import (server/initialImport.ts) doesn't strand the user on a dead-end
// screen (src/pages/CloudImportProgress.tsx). Like tests/localCloudUpgrade.test.ts,
// this exercises everything up to the point a real cloud Supabase project
// or the Electron IPC bridge (server/ipcCrypto.ts) would be required —
// those aren't available in this sandbox.
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
  const { createCloudLinkRouter } = await import('../server/cloudLinkRoutes');
  const supabaseAdmin = new FakeSupabaseAdmin() as any;
  const activateCloudSync = async () => {};
  const a = express();
  a.use(createCloudLinkRouter(supabaseAdmin, activateCloudSync));
  return a;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-cloud-link-'));
  process.env.OFFLINE_DATA_DIR = dataDir;
  delete process.env.CLOUD_SUPABASE_URL;
  delete process.env.CLOUD_SUPABASE_ANON_KEY;
  app = await setupApp();
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('POST /cloud-link-retry-import', () => {
  it('refuse quand ce poste n\'est relié à aucun compte cloud', async () => {
    const res = await request(app).post('/cloud-link-retry-import').send({});
    expect(res.status).toBe(400);
  });

  it('refuse sans en-tête Authorization, une fois le poste lié', async () => {
    const { writeLocalAccount } = await import('../server/offlineAccount');
    const { writeCloudLinkState } = await import('../server/cloudLinkState');
    writeLocalAccount({ userId: 'u1', tenantId: 't1', email: 'a@b.test', agencyName: 'AAZS', passwordHash: 'x' });
    writeCloudLinkState({
      tenantId: 't1', cloudUserId: 'cu1', email: 'a@b.test', linkedAt: new Date().toISOString(),
      importCompleted: false, initialWatermarkId: null, installId: 'i1',
    });

    const res = await request(app).post('/cloud-link-retry-import').send({});
    expect(res.status).toBe(401);
  });

  it('refuse un jeton local qui ne correspond pas au compte de ce poste', async () => {
    const { signLocalJwt } = await import('../server/offlineAccount');
    const token = signLocalJwt('un-autre-utilisateur');

    const res = await request(app)
      .post('/cloud-link-retry-import')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('refuse la relance sans session cloud stockée', async () => {
    const { signLocalJwt } = await import('../server/offlineAccount');
    const token = signLocalJwt('u1');

    const res = await request(app)
      .post('/cloud-link-retry-import')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(409);
  });

  it('échoue proprement (pas de crash) quand la session cloud stockée est illisible', async () => {
    const { signLocalJwt } = await import('../server/offlineAccount');
    const { writeEncryptedCloudSession } = await import('../server/cloudLinkState');
    // encryptForStorage() passe par le pont IPC Electron, absent ici — un
    // chiffré arbitraire suffit à exercer le chemin d'échec de la relance.
    writeEncryptedCloudSession('chiffre-de-test-non-dechiffrable');
    const token = signLocalJwt('u1');

    const res = await request(app)
      .post('/cloud-link-retry-import')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(401);
    expect(String(res.body.error)).toMatch(/session cloud/i);
  });
});
