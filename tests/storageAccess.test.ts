// Covers GET /api/storage/signed-url (server/routes/storageAccess.ts) — the
// resolver that exchanges a stored file_url/attachment_url reference for a
// short-lived signed URL now that the documents/plans/cv/message-attachments/
// feed-attachments buckets are private (see server/storagePaths.ts and the
// security audit's "buckets métier publics" finding).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('GET /api/storage/signed-url', () => {
  it('resolves a document belonging to the caller\'s own tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const uploaded = await request(app).post('/api/documents').set(authHeader(token))
      .field('project_id', 'p1').field('name', 'CCTP Lot 01').field('category', 'CCTP')
      .attach('file', Buffer.from('%PDF-fake'), 'cctp.pdf');
    expect(uploaded.status).toBe(201);
    const doc = fakeSupabaseAdmin.getTable('documents').find(d => d.id === uploaded.body.id);
    expect(doc?.file_url).toContain('/object/public/documents/');

    const res = await request(app).get('/api/storage/signed-url').set(authHeader(token)).query({ url: doc!.file_url });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/object/sign/documents/');
  });

  it('resolves a meeting photo belonging to the caller\'s own tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

    const uploaded = await request(app).post('/api/meetings/m1/photos').set(authHeader(token))
      .attach('file', pngBytes, 'photo.png');
    expect(uploaded.status).toBe(201);
    const photo = fakeSupabaseAdmin.getTable('meeting_photos').find(p => p.id === uploaded.body.id);
    expect(photo?.file_url).toContain('/object/public/meeting-photos/');

    const res = await request(app).get('/api/storage/signed-url').set(authHeader(token)).query({ url: photo!.file_url });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/object/sign/meeting-photos/');
  });

  it('refuses to resolve another tenant\'s document', async () => {
    const tenantA = makeTenant();
    const { token: tokenA } = makeUser(tenantA);
    const uploaded = await request(app).post('/api/documents').set(authHeader(tokenA))
      .field('project_id', 'p1').field('name', 'Secret').field('category', 'CCTP')
      .attach('file', Buffer.from('%PDF-fake'), 'secret.pdf');
    const doc = fakeSupabaseAdmin.getTable('documents').find(d => d.id === uploaded.body.id);

    const tenantB = makeTenant();
    const { token: tokenB } = makeUser(tenantB);
    const res = await request(app).get('/api/storage/signed-url').set(authHeader(tokenB)).query({ url: doc!.file_url });
    expect(res.status).toBe(403);
  });

  it('rejects a URL for a bucket that is not one of the private business-document buckets (e.g. logos)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const foreignUrl = `https://fake.supabase.test/storage/v1/object/public/logos/${tenantId}/logo/1.png`;
    const res = await request(app).get('/api/storage/signed-url').set(authHeader(token)).query({ url: foreignUrl });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed/foreign url', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/storage/signed-url').set(authHeader(token)).query({ url: 'https://evil.example.test/not-a-storage-url' });
    expect(res.status).toBe(400);
  });

  it('requires the url parameter', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/storage/signed-url').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/storage/signed-url').query({ url: 'https://fake.supabase.test/storage/v1/object/public/documents/x/y.pdf' });
    expect(res.status).toBe(401);
  });
});
