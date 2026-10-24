// Routes du client de bureau pour les fichiers (server/routes/desktopStorage.ts),
// à travers la vraie application Express.
//
// Ce qui compte : ces routes n'existent QUE dans le client de bureau, la clé de
// stockage n'est rendue que pour un fichier du cabinet de l'appelant, et copier ou
// supprimer des fichiers demande un administrateur ET une confirmation explicite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
let storageRoot: string;
let dataDir: string;
const previous: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined) {
  if (!(key in previous)) previous[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(async () => {
  app = await getTestApp();
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-desktop-storage-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-desktop-data-'));
  setEnv('OFFLINE_STORAGE_DIR', storageRoot);
  setEnv('OFFLINE_DATA_DIR', dataDir);
});

afterAll(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  setEnv('OFFLINE_MODE', 'true');
});

const refOf = (bucket: string, p: string) =>
  `https://fake.supabase.test/storage/v1/object/public/${bucket}/${p.split('/').map(encodeURIComponent).join('/')}`;

function putFile(bucket: string, rel: string, content: string) {
  const file = path.join(storageRoot, bucket, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

async function untilDone(token: string): Promise<any> {
  for (let i = 0; i < 100; i += 1) {
    const res = await request(app).get('/api/storage/tree-migration').set(authHeader(token));
    if (res.body.job && res.body.job.status !== 'running') return res.body.job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('La migration ne se termine pas');
}

describe('hors du client de bureau', () => {
  it('répond 404 partout, y compris pour un administrateur', async () => {
    setEnv('OFFLINE_MODE', undefined);
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const auth = authHeader(token);

    expect((await request(app).get('/api/storage/local-file').query({ url: 'x' }).set(auth)).status).toBe(404);
    expect((await request(app).get('/api/storage/tree-migration').set(auth)).status).toBe(404);
    expect((await request(app).post('/api/storage/tree-migration/preview').set(auth)).status).toBe(404);
    expect((await request(app).post('/api/storage/tree-migration/start').set(auth).send({ confirm: true })).status).toBe(404);
    expect((await request(app).post('/api/storage/tree-migration/purge').set(auth).send({ dryRun: false, confirm: true })).status).toBe(404);
  });
});

describe('GET /api/storage/local-file', () => {
  it('rend la clé de stockage d\'un fichier du cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    const rel = `${tenantId}/26014 - Villa Martin/DCE/CCTP.pdf`;
    putFile('documents', rel, 'cctp');

    const res = await request(app).get('/api/storage/local-file')
      .query({ url: refOf('documents', rel) }).set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, bucket: 'documents', path: rel });
  });

  it('dit « indisponible » quand le fichier n\'est plus sur le disque', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    const res = await request(app).get('/api/storage/local-file')
      .query({ url: refOf('documents', `${tenantId}/absent.pdf`) }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
  });

  it('refuse le fichier d\'un autre cabinet', async () => {
    const tenantId = makeTenant();
    const otherTenant = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    const rel = `${otherTenant}/Affaire/DCE/secret.pdf`;
    putFile('documents', rel, 'secret');

    const res = await request(app).get('/api/storage/local-file')
      .query({ url: refOf('documents', rel) }).set(authHeader(token));

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('secret.pdf');
  });

  it('refuse un chemin qui tente de sortir du dossier de stockage', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    fs.writeFileSync(path.join(storageRoot, 'hors-bucket.txt'), 'x');
    const res = await request(app).get('/api/storage/local-file')
      .query({ url: `https://fake.supabase.test/storage/v1/object/public/documents/${tenantId}/..%2F..%2Fhors-bucket.txt` })
      .set(authHeader(token));
    // Le préfixe est respecté mais le chemin résolu sort du bucket : jamais « disponible ».
    expect(res.body.available).not.toBe(true);
  });

  it('ne propose rien pour une référence externe ou étrangère', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    for (const url of ['archioffice+external://webdav/c1/YWJj', 'https://example.test/x.pdf']) {
      const res = await request(app).get('/api/storage/local-file').query({ url }).set(authHeader(token));
      expect(res.body).toEqual({ available: false });
    }
  });

  it('exige le paramètre url', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    expect((await request(app).get('/api/storage/local-file').set(authHeader(token))).status).toBe(400);
  });
});

describe('migration : droits et confirmations', () => {
  it('est réservée aux administrateurs', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    const auth = authHeader(token);
    expect((await request(app).get('/api/storage/tree-migration').set(auth)).status).toBe(403);
    expect((await request(app).post('/api/storage/tree-migration/preview').set(auth)).status).toBe(403);
    expect((await request(app).post('/api/storage/tree-migration/start').set(auth).send({ confirm: true })).status).toBe(403);
    expect((await request(app).post('/api/storage/tree-migration/purge').set(auth).send({ dryRun: false, confirm: true })).status).toBe(403);
  });

  it('exige confirm: true pour lancer la copie et pour supprimer', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const auth = authHeader(token);
    expect((await request(app).post('/api/storage/tree-migration/start').set(auth).send({})).status).toBe(400);
    expect((await request(app).post('/api/storage/tree-migration/start').set(auth).send({ confirm: 'oui' })).status).toBe(400);
    expect((await request(app).post('/api/storage/tree-migration/purge').set(auth).send({ dryRun: false })).status).toBe(400);
  });
});

describe('migration : parcours complet', () => {
  it('simule, copie en tâche de fond, puis purge seulement sur confirmation', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const auth = authHeader(token);
    const legacy = `${tenantId}/p1/DCE/0a1b2c3d-1111-4222-8333-444455556666/Plan-RDC.pdf`;
    putFile('documents', legacy, 'octets-plan');
    fakeSupabaseAdmin.seed('projects', [
      ...fakeSupabaseAdmin.getTable('projects'),
      { id: 'p1', tenant_id: tenantId, project_code: '26014', name: 'Villa Martin' },
    ]);
    fakeSupabaseAdmin.seed('documents', [
      ...fakeSupabaseAdmin.getTable('documents'),
      { id: 'doc-flow', tenant_id: tenantId, project_id: 'p1', name: 'Plan RDC.pdf', category: 'Plans', phase: 'DCE',
        file_url: refOf('documents', legacy), uploaded_at: '2026-01-01' },
    ]);

    // 1. Simulation : rien ne bouge.
    const preview = await request(app).post('/api/storage/tree-migration/preview').set(auth);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ dryRun: true, aMigrer: 1, migres: 0 });
    expect(fakeSupabaseAdmin.getTable('documents').find((d) => d.id === 'doc-flow')!.file_url).toBe(refOf('documents', legacy));

    // 2. Lancement : accepté tout de suite, terminé en tâche de fond.
    const started = await request(app).post('/api/storage/tree-migration/start').set(auth).send({ confirm: true });
    expect(started.status).toBe(202);
    const job = await untilDone(token);
    expect(job.status).toBe('done');
    expect(job.report).toMatchObject({ migres: 1, erreurs: 0 });

    const target = `${tenantId}/26014 - Villa Martin/DCE/Plan RDC.pdf`;
    expect(fs.readFileSync(path.join(storageRoot, 'documents', ...target.split('/')), 'utf8')).toBe('octets-plan');
    expect(fs.existsSync(path.join(storageRoot, 'documents', ...legacy.split('/')))).toBe(true);

    // 3. Purge : simulation par défaut, suppression seulement confirmée.
    const dry = await request(app).post('/api/storage/tree-migration/purge').set(auth).send({});
    expect(dry.body).toMatchObject({ dryRun: true, supprimables: 1, supprimes: 0 });
    expect(fs.existsSync(path.join(storageRoot, 'documents', ...legacy.split('/')))).toBe(true);

    const real = await request(app).post('/api/storage/tree-migration/purge').set(auth).send({ dryRun: false, confirm: true });
    expect(real.body).toMatchObject({ dryRun: false, supprimes: 1 });
    expect(fs.existsSync(path.join(storageRoot, 'documents', ...legacy.split('/')))).toBe(false);
    expect(fs.existsSync(path.join(storageRoot, 'documents', ...target.split('/')))).toBe(true);
  });
});
