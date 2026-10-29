import crypto from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { signOfflineLicense, verifyOfflineLicense, MAX_OFFLINE_SECONDS } from '../server/desktop/offlineLicense';
import { getTestApp, authHeader, fakeSupabaseAdmin } from './testServer';
import { API, makeActor, makeDriveTenant } from './desktopSyncSupport';
const keys = crypto.generateKeyPairSync('ed25519');
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const identity = { userId: 'user', tenantId: 'tenant', deviceId: 'device' };
const now = Date.parse('2026-10-29T10:00:00Z');
const tenant = { plan: 'pro', trial_ends_at: new Date(now + 7 * 86400000).toISOString() };
function setup() { vi.stubEnv('DRIVE_LICENSE_PRIVATE_KEY', privateKey); vi.stubEnv('DRIVE_LICENSE_KEY_ID', 'key1'); }
afterEach(() => vi.unstubAllEnvs());

describe('Offline signed grants', () => {
  it('bounds a valid grant to 72 hours and exposes no private key', () => {
    setup(); const grant = signOfflineLicense(identity, tenant, now);
    const claims = verifyOfflineLicense(grant.license, identity, { key1: publicKey }, now);
    expect(claims?.exp).toBe(now / 1000 + MAX_OFFLINE_SECONDS);
    expect(JSON.stringify(grant)).not.toContain('PRIVATE');
    expect(verifyOfflineLicense(grant.license, identity, { key1: publicKey }, now + MAX_OFFLINE_SECONDS * 1000)).toBeNull();
  });
  it('never exceeds the paid-through date and refuses an expired plan', () => {
    setup(); const short = { ...tenant, trial_ends_at: new Date(now + 3600000).toISOString() };
    expect(signOfflineLicense(identity, short, now).expiresAt).toBe(short.trial_ends_at);
    expect(() => signOfflineLicense(identity, { ...tenant, plan: 'trial' }, now)).toThrow();
    expect(() => signOfflineLicense(identity, { ...tenant, trial_ends_at: new Date(now).toISOString() }, now)).toThrow();
  });
  it.each(['userId', 'tenantId', 'deviceId'])('rejects replay to another %s', field => {
    setup(); const grant = signOfflineLicense(identity, tenant, now);
    expect(verifyOfflineLicense(grant.license, { ...identity, [field]: 'other' }, { key1: publicKey }, now)).toBeNull();
  });
  it('rejects altered claims, unknown keys, future issuance and clock rollback', () => {
    setup(); const { license } = signOfflineLicense(identity, tenant, now);
    const [h,p,s] = license.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()); payload.exp += 10000;
    expect(verifyOfflineLicense(`${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`, identity, { key1: publicKey }, now)).toBeNull();
    expect(verifyOfflineLicense(license, identity, {}, now)).toBeNull();
    expect(verifyOfflineLicense(license, identity, { key1: publicKey }, now - 1000)).toBeNull();
    expect(verifyOfflineLicense(license, identity, { key1: publicKey }, now, now + 1000)).toBeNull();
    const wrong = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verifyOfflineLicense(license, identity, { key1: wrong }, now)).toBeNull();
  });
  it('requires configured signing keys and never creates an implicit key', () => {
    vi.stubEnv('DRIVE_LICENSE_PRIVATE_KEY', ''); vi.stubEnv('DRIVE_LICENSE_KEY_ID', '');
    expect(() => signOfflineLicense(identity, tenant, now)).toThrow('pas configurée');
    vi.stubEnv('DRIVE_LICENSE_PRIVATE_KEY', 'invalid'); vi.stubEnv('DRIVE_LICENSE_KEY_ID', 'key1');
    expect(() => signOfflineLicense(identity, tenant, now)).toThrow('pas configurée');
  });
});

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
describe('Grant issuance API', () => {
  it('requires a device token and derives identity from authentication', async () => {
    setup(); const tenantId = makeDriveTenant(); const actor = await makeActor(app, tenantId);
    const jwt = await request(app).post(`${API}/offline-license`).set(authHeader(actor.jwt)).send({});
    expect(jwt.status).toBe(403); expect(jwt.body.code).toBe('DEVICE_TOKEN_REQUIRED');
    const response = await request(app).post(`${API}/offline-license`).set(actor.headers).send({ tenantId: 'forged', deviceId: 'forged' });
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    const device = fakeSupabaseAdmin.getTable('desktop_devices').find(d => d.user_id === actor.userId)!;
    expect(verifyOfflineLicense(response.body.license, { userId: actor.userId, tenantId, deviceId: device.id }, { key1: publicKey })).toBeTruthy();
    fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)!.trial_ends_at = new Date(0).toISOString();
    const expired = await request(app).post(`${API}/offline-license`).set(actor.headers).send({});
    expect(expired.status).toBe(402);
  });
  it('reports missing signing configuration and refuses revoked devices', async () => {
    const tenantId = makeDriveTenant(); const actor = await makeActor(app, tenantId);
    vi.stubEnv('DRIVE_LICENSE_PRIVATE_KEY', ''); vi.stubEnv('DRIVE_LICENSE_KEY_ID', '');
    const missing = await request(app).post(`${API}/offline-license`).set(actor.headers).send({});
    expect(missing.status).toBe(503); expect(missing.body.code).toBe('DRIVE_LICENSE_UNAVAILABLE');
    const device = fakeSupabaseAdmin.getTable('desktop_devices').find(d => d.user_id === actor.userId)!;
    device.revoked_at = new Date().toISOString(); setup();
    const revoked = await request(app).post(`${API}/offline-license`).set(actor.headers).send({});
    expect(revoked.status).toBe(401); expect(revoked.body.code).toBe('DEVICE_REVOKED');
  });

});
