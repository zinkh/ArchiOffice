// Les trois connexions par mot de passe du client Electron vers le cloud
// (server/cloudLinkRoutes.ts : /cloud-link et /cloud-link-reconnect ;
// server/localCloudUpgrade.ts : /cloud-link-upgrade) relaient le jeton
// Turnstile produit par l'interface à Supabase Auth (options.captchaToken).
// Le client cloud est simulé : ni Supabase ni Cloudflare ne sont contactés.
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';

const signIn = vi.hoisted(() => vi.fn());

vi.mock('../server/cloudSyncClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../server/cloudSyncClient')>();
  return {
    ...original,
    createCloudSupabaseClient: () => ({ auth: { signInWithPassword: signIn } }) as any,
  };
});

const CAPTCHA_REFUSED = { data: { session: null }, error: { message: 'captcha verification process failed' } };

let dataDir: string;
let app: express.Express;

async function setupApp() {
  const { createCloudLinkRouter } = await import('../server/cloudLinkRoutes');
  const { createLocalCloudUpgradeRouter } = await import('../server/localCloudUpgrade');
  const supabaseAdmin = new FakeSupabaseAdmin() as any;
  const activate = async () => {};
  const a = express();
  a.use(createCloudLinkRouter(supabaseAdmin, activate));
  a.use(createLocalCloudUpgradeRouter(supabaseAdmin, activate));
  return a;
}

function useFreshDataDir() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-captcha-'));
  process.env.OFFLINE_DATA_DIR = dataDir;
}

beforeAll(async () => {
  useFreshDataDir();
  process.env.OFFLINE_PG_URL = 'postgres://invalide.test/db';
  app = await setupApp();
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  signIn.mockReset();
  signIn.mockResolvedValue(CAPTCHA_REFUSED);
});

describe('POST /cloud-link', () => {
  it('relaie le jeton Turnstile à signInWithPassword', async () => {
    useFreshDataDir();
    const res = await request(app).post('/cloud-link')
      .send({ email: 'a@b.test', password: 'pw', localPassword: 'longenough', captchaToken: 'tok-1' });
    expect(signIn).toHaveBeenCalledWith({ email: 'a@b.test', password: 'pw', options: { captchaToken: 'tok-1' } });
    expect(res.status).toBe(401);
  });

  it('traduit le refus du captcha en message français', async () => {
    useFreshDataDir();
    const res = await request(app).post('/cloud-link')
      .send({ email: 'a@b.test', password: 'pw', localPassword: 'longenough' });
    expect(res.body.error).toMatch(/vérification de sécurité/i);
  });

  it('ignore un jeton qui n\'est pas une chaîne', async () => {
    useFreshDataDir();
    await request(app).post('/cloud-link')
      .send({ email: 'a@b.test', password: 'pw', localPassword: 'longenough', captchaToken: { x: 1 } });
    expect(signIn.mock.calls[0][0].options).toEqual({ captchaToken: undefined });
  });
});

describe('POST /cloud-link-reconnect', () => {
  it('relaie le jeton Turnstile à signInWithPassword', async () => {
    useFreshDataDir();
    const { writeLocalAccount, signLocalJwt } = await import('../server/offlineAccount');
    const { writeCloudLinkState } = await import('../server/cloudLinkState');
    writeLocalAccount({ userId: 'u1', tenantId: 't1', email: 'a@b.test', agencyName: 'AAZS', passwordHash: 'x' });
    writeCloudLinkState({
      tenantId: 't1', cloudUserId: 'cu1', email: 'a@b.test', linkedAt: new Date().toISOString(),
      importCompleted: true, initialWatermarkId: 0, installId: 'i1',
    });

    const res = await request(app).post('/cloud-link-reconnect')
      .set('Authorization', `Bearer ${signLocalJwt('u1')}`)
      .send({ password: 'pw', captchaToken: 'tok-2' });
    expect(signIn).toHaveBeenCalledWith({ email: 'a@b.test', password: 'pw', options: { captchaToken: 'tok-2' } });
    expect(res.status).toBe(401);
  });
});

describe('POST /cloud-link-upgrade', () => {
  it('relaie le jeton Turnstile à signInWithPassword', async () => {
    useFreshDataDir();
    const { writeLocalAccount, signLocalJwt } = await import('../server/offlineAccount');
    writeLocalAccount({ userId: 'u2', tenantId: 't2', email: 'local@archioffice.local', agencyName: 'AAZS', passwordHash: 'x' });

    const res = await request(app).post('/cloud-link-upgrade')
      .set('Authorization', `Bearer ${signLocalJwt('u2')}`)
      .send({ email: 'a@b.test', password: 'pw', captchaToken: 'tok-3' });
    expect(signIn).toHaveBeenCalledWith({ email: 'a@b.test', password: 'pw', options: { captchaToken: 'tok-3' } });
    expect(res.status).toBe(401);
  });
});
