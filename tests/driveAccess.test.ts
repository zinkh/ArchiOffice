import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { addMembership, authHeader, fakeSupabaseAdmin, getTestApp, makeTenant, makeUser, tenantHeader } from './testServer';
import { API, makeActor, makeDriveTenant, seedDocument, seedProject, sha256 } from './desktopSyncSupport';
import { driveCapability, hasActiveDriveSubscription } from '../server/desktop/driveAccess';
let app: Express;
beforeAll(async () => { app = await getTestApp(); });
const future = () => new Date(Date.now() + 86400000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

describe('Drive subscription authority', () => {
  it.each(['starter', 'pro', 'enterprise'])('accepts an unexpired %s contract', plan => {
    expect(hasActiveDriveSubscription({ plan, trial_ends_at: future() })).toBe(true);
  });
  it.each(['trial', 'expired', 'unknown', null])('rejects %s regardless of its date', plan => {
    expect(hasActiveDriveSubscription({ plan, trial_ends_at: future() })).toBe(false);
  });
  it.each([null, '', 'invalid', '2000-01-01'])('rejects a paid plan with invalid/expired date %s', trial_ends_at => {
    expect(hasActiveDriveSubscription({ plan: 'pro', trial_ends_at })).toBe(false);
  });
  it('denies suspended and locally asserted subscriptions', async () => {
    expect(hasActiveDriveSubscription({ plan: 'pro', trial_ends_at: future(), suspended_at: past() })).toBe(false);
    vi.stubEnv('OFFLINE_MODE', 'true');
    try { expect(await driveCapability(null, 'local')).toMatchObject({ enabled: false, code: 'DRIVE_ONLINE_VERIFICATION_REQUIRED' }); }
    finally { vi.unstubAllEnvs(); }
  });
  it('fails closed on subscription database errors', async () => {
    const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ error: { message: 'down' } }) }) }) }) };
    await expect(driveCapability(db, 'tenant')).rejects.toMatchObject({ status: 503, code: 'DRIVE_ENTITLEMENT_UNAVAILABLE' });
  });
});

describe('Drive API paid access', () => {
  it('denies free activation, exposes capability, preserves ordinary documents', async () => {
    const tenantId = makeTenant({ plan: 'trial', trial_ends_at: future() });
    const { token } = makeUser(tenantId);
    const headers = authHeader(token);
    const activation = await request(app).post(`${API}/devices`).set(headers).send({ name: 'PC', platform: 'windows' });
    expect(activation.status).toBe(402);
    expect(activation.body.code).toBe('DRIVE_SUBSCRIPTION_REQUIRED');
    expect((await request(app).get(`${API}/capabilities`).set(headers)).body.enabled).toBe(false);
    expect((await request(app).get('/api/documents').set(headers)).status).toBe(200);
    expect((await request(app).get(`${API}/devices`).set(headers)).status).toBe(200);
  });
  it('isolates entitlement by tenant even with an already issued device token', async () => {
    const paid = makeDriveTenant();
    const free = makeTenant({ plan: 'trial', trial_ends_at: future() });
    const actor = await makeActor(app, paid);
    addMembership(actor.userId, free);
    const roots = await request(app).get(`${API}/roots`).set(actor.headers);
    expect(roots.body.map((r: any) => r.tenantId)).toEqual([paid]);
    const res = await request(app).get(`${API}/nodes/tenant:${free}`).set({ ...actor.headers, ...tenantHeader(free) });
    expect(res.status).toBe(402);
    expect((await request(app).get(`${API}/nodes/tenant:${paid}`).set(actor.headers)).status).toBe(200);
  });
  it('stops reads, chunks and completion after expiry without deleting local work or server upload', async () => {
    const tenantId = makeDriveTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1' });
    const data = Buffer.from('pending work');
    const opened = await request(app).post(`${API}/uploads`).set(actor.headers).send({
      target: { documentId: 'd1' }, baseVersion: 1, name: 'Plan.pdf', size: data.length, sha256: sha256(data),
    });
    expect(opened.status).toBe(201);
    const uploadId = opened.body.uploadId;
    const lock = await request(app).post(`${API}/nodes/doc:d1/lock`).set(actor.headers).send({});
    expect(lock.status).toBe(200);
    const tenant = fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)!;
    tenant.trial_ends_at = past();
    for (const path of ['/nodes/doc:d1', '/nodes/doc:d1/content', '/changes', `/uploads/${uploadId}`]) {
      expect((await request(app).get(`${API}${path}`).set(actor.headers)).status).toBe(402);
    }
    expect((await request(app).put(`${API}/uploads/${uploadId}`).set(actor.headers).set('Content-Type', 'application/octet-stream').send(data)).status).toBe(402);
    expect((await request(app).post(`${API}/uploads/${uploadId}/complete`).set(actor.headers).send({})).status).toBe(402);
    expect(fakeSupabaseAdmin.getTable('desktop_uploads').some(r => r.id === uploadId)).toBe(true);
    expect((await request(app).delete(`${API}/nodes/doc:d1/lock`).set(actor.headers)).status).toBe(200);
    const devices = await request(app).get(`${API}/devices`).set(authHeader(actor.jwt));
    expect(devices.status).toBe(200);
    expect((await request(app).delete(`${API}/devices/${devices.body[0].id}`).set(authHeader(actor.jwt))).status).toBe(200);
  });
  it('keeps access during a scheduled cancellation until paid-through expiry', async () => {
    const tenantId = makeDriveTenant({ pending_plan: 'trial', plan_change_requested_at: new Date().toISOString() });
    const actor = await makeActor(app, tenantId);
    expect((await request(app).get(`${API}/capabilities`).set(actor.headers)).body.enabled).toBe(true);
  });
});
