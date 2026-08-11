// Covers the security fix in server/offlineGateway.ts: this router used to
// accept any request with zero authentication (see the security audit) —
// now every non-public route requires the same random per-launch secret
// `supabaseAdmin` itself sends (SUPABASE_SERVICE_ROLE_KEY in electron/main.cjs).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SECRET = 'test-service-role-secret';
let dataDir: string;
let app: express.Express;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-offline-gateway-'));
  process.env.OFFLINE_DATA_DIR = dataDir;

  const { createOfflineGateway } = await import('../server/offlineGateway');
  app = express();
  app.use(createOfflineGateway({
    postgrestUrl: 'http://127.0.0.1:1', // unreachable — /rest/v1 auth must reject before ever proxying
    serviceRoleKey: SECRET,
  }));
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('offline gateway auth', () => {
  it('rejects /rest/v1 requests with no Authorization header', async () => {
    const res = await request(app).get('/rest/v1/projects');
    expect(res.status).toBe(401);
  });

  it('rejects /rest/v1 requests with the wrong secret', async () => {
    const res = await request(app).get('/rest/v1/projects').set('Authorization', 'Bearer wrong-secret');
    expect(res.status).toBe(401);
  });

  it('rejects bucket creation and admin-user creation without the secret', async () => {
    const bucketRes = await request(app).post('/storage/v1/bucket').send({ id: 'documents' });
    expect(bucketRes.status).toBe(401);

    const adminRes = await request(app).post('/auth/v1/admin/users').send({ email: 'x@example.test' });
    expect(adminRes.status).toBe(401);
  });

  it('allows bucket creation and object writes with the correct secret, and serves the object publicly afterwards', async () => {
    const auth = { Authorization: `Bearer ${SECRET}` };

    const bucketRes = await request(app).post('/storage/v1/bucket').set(auth).send({ id: 'documents' });
    expect(bucketRes.status).toBe(200);

    const writeRes = await request(app)
      .post('/storage/v1/object/documents/hello.txt')
      .set(auth)
      .set('Content-Type', 'text/plain')
      .send('hello world');
    expect(writeRes.status).toBe(200);

    // Public reads are intentionally unauthenticated — the renderer loads
    // these directly as <img src>, which can't attach an Authorization header.
    const readRes = await request(app).get('/storage/v1/object/public/documents/hello.txt');
    expect(readRes.status).toBe(200);
    expect(readRes.text).toBe('hello world');
  });

  it('rejects object writes/deletes without the secret even once the bucket exists', async () => {
    const auth = { Authorization: `Bearer ${SECRET}` };
    await request(app).post('/storage/v1/bucket').set(auth).send({ id: 'plans' });

    const writeRes = await request(app).post('/storage/v1/object/plans/x.txt').send('nope');
    expect(writeRes.status).toBe(401);

    const deleteRes = await request(app).delete('/storage/v1/object/plans').send({ prefixes: ['x.txt'] });
    expect(deleteRes.status).toBe(401);
  });

  it('rejects a path-traversal attempt against object read/write', async () => {
    const auth = { Authorization: `Bearer ${SECRET}` };
    await request(app).post('/storage/v1/bucket').set(auth).send({ id: 'documents' });

    const writeRes = await request(app)
      .post('/storage/v1/object/documents/..%2f..%2f..%2fevil.txt')
      .set(auth)
      .send('pwned');
    expect([400, 404]).toContain(writeRes.status);

    const readRes = await request(app).get('/storage/v1/object/public/documents/..%2f..%2f..%2fetc%2fpasswd');
    expect(readRes.status).toBe(404);
  });
});
