import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createLocalDrive, type LocalDriveDeps, type LocalDriveState } from '../server/desktop/localDrive';
import { signOfflineLicense } from '../server/desktop/offlineLicense';
const pair = crypto.generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const publicKey = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const identity = { userId: 'user1', tenantId: 'tenant1' };
let now: number; let mono: number; let state: LocalDriveState | null;
let deps: LocalDriveDeps; let api: Mock<LocalDriveDeps['request']>; let sequence: number;
beforeEach(() => {
  vi.stubEnv('DRIVE_LICENSE_PRIVATE_KEY', privateKey); vi.stubEnv('DRIVE_LICENSE_KEY_ID', 'key1');
  now = Date.parse('2026-10-29T10:00:00Z'); mono = 0; state = null; sequence = 0;
  api = vi.fn<LocalDriveDeps['request']>(async (path: string) => {
    if (path === '/devices') return { deviceId: `dev_${++sequence}`, token: `ds_at_secret${sequence}` };
    if (path.startsWith('/devices/')) return { success: true };
    return signOfflineLicense(state!, { plan: 'pro', trial_ends_at: new Date(now + 7 * 86400000).toISOString() }, now);
  });
  deps = { linkedIdentity: () => identity, read: async () => state && structuredClone(state),
    write: async s => { state = structuredClone(s); }, trustedKeys: { key1: publicKey }, configured: true,
    now: () => now, monotonic: () => mono, platform: 'windows', name: 'Atelier',
    cloudSession: async () => 'cloud-jwt', request: api };
});
afterEach(() => vi.unstubAllEnvs());

describe('Local Drive licensing lifecycle', () => {
  it('enrolls once, keeps tokens internal and accepts a signed grant after restart', async () => {
    const manager = createLocalDrive(deps);
    expect(await manager.capability(identity)).toMatchObject({ enabled: false });
    const result = await manager.connect(identity);
    expect(result.enabled).toBe(true); expect(JSON.stringify(result)).not.toContain('ds_at_');
    expect(JSON.parse(Buffer.from(state!.license!.split('.')[1], 'base64url').toString())).not.toHaveProperty('deviceToken');
    expect(JSON.stringify(await manager.devices(identity))).not.toContain('ds_at_');
    expect(api.mock.calls[0]).toEqual(['/devices', 'cloud-jwt', 'tenant1', { name: 'Atelier', platform: 'windows' }]);
    const restarted = createLocalDrive(deps);
    expect((await restarted.capability(identity)).enabled).toBe(true);
    await restarted.connect(identity);
    expect(api.mock.calls.filter(([p]) => p === '/devices')).toHaveLength(1);
  });
  it('serializes concurrent activation so no duplicate devices are created', async () => {
    const manager = createLocalDrive(deps);
    await Promise.all([manager.connect(identity), manager.connect(identity)]);
    expect(api.mock.calls.filter(([p]) => p === '/devices')).toHaveLength(1);
  });
  it('does not enroll automatically during background refresh', async () => {
    expect((await createLocalDrive(deps).refresh(identity)).enabled).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });
  it('keeps a valid grant on network failure but never extends its original expiry', async () => {
    const manager = createLocalDrive(deps); const grant = await manager.connect(identity);
    api.mockRejectedValueOnce(Object.assign(new Error('network'), { status: 503 }));
    await expect(manager.refresh(identity)).rejects.toThrow('network');
    expect(await manager.capability(identity)).toMatchObject({ enabled: true, expiresAt: grant.expiresAt });
    now += 72 * 3600000; mono += 72 * 3600000;
    expect((await manager.capability(identity)).enabled).toBe(false);
  });
  it.each([401, 402, 403, 404])('invalidates the cached grant immediately on HTTP %s', async status => {
    const manager = createLocalDrive(deps); await manager.connect(identity);
    api.mockRejectedValueOnce(Object.assign(new Error('refused'), { status }));
    await expect(manager.refresh(identity)).rejects.toThrow();
    expect((await manager.capability(identity)).enabled).toBe(false);
    expect(state!.license).toBeNull();
  });
  it('rejects forged or corrupted licenses instead of falling back to an old grant', async () => {
    const manager = createLocalDrive(deps); await manager.connect(identity);
    api.mockResolvedValueOnce({ license: 'forged' });
    await expect(manager.refresh(identity)).rejects.toMatchObject({ code: 'DRIVE_INVALID_LICENSE' });
    expect((await manager.capability(identity)).enabled).toBe(false);
  });
  it('requires the linked cloud identity and rejects a state belonging to another cabinet', async () => {
    const manager = createLocalDrive(deps); await manager.connect(identity);
    await expect(manager.capability({ ...identity, tenantId: 'other' })).rejects.toMatchObject({ status: 403 });
    state!.userId = 'other';
    await expect(manager.capability(identity)).rejects.toMatchObject({ code: 'DRIVE_IDENTITY_MISMATCH' });
  });
  it('detects rollback after restart and refuses frozen-clock extensions within a process', async () => {
    const manager = createLocalDrive(deps); await manager.connect(identity);
    now += 60000; mono += 60000; await manager.capability(identity);
    now -= 30000;
    expect(await createLocalDrive(deps).capability(identity)).toMatchObject({ enabled: false, code: 'DRIVE_CLOCK_ROLLBACK' });
    now += 30000; mono += 73 * 3600000;
    expect((await manager.capability(identity)).enabled).toBe(false);
  });
  it('disables locally before remote revocation and retries the pending operation after restart', async () => {
    const manager = createLocalDrive(deps); await manager.connect(identity);
    const deviceId = state!.deviceId;
    api.mockRejectedValueOnce(new Error('offline'));
    expect(await manager.disconnect(identity, deviceId)).toMatchObject({ success: true, remoteRevocationPending: true });
    expect(state!.license).toBeNull(); expect((await manager.capability(identity)).enabled).toBe(false);
    const restarted = createLocalDrive(deps); await restarted.refresh(identity);
    expect(state!.disconnectPending).toBe(false); expect(state!.deviceToken).toBe('');
    expect(api.mock.calls.some(([p]) => p === `/devices/${deviceId}`)).toBe(true);
  });
  it('fails closed when secure storage is unavailable and does not connect without pinned trust', async () => {
    deps.read = async () => { throw new Error('secure storage failed'); };
    await expect(createLocalDrive(deps).capability(identity)).rejects.toThrow();
    deps.configured = false;
    expect(await createLocalDrive(deps).capability(identity)).toMatchObject({ enabled: false, code: 'DRIVE_TRUST_UNCONFIGURED' });
    expect(api).not.toHaveBeenCalled();
  });
});
it('rechecks a grant before giving a credential to the private agent bridge', async () => {
  const manager = createLocalDrive(deps);
  await expect(manager.authorize(identity)).rejects.toMatchObject({status:402});
  await manager.connect(identity);
  expect(await manager.authorize(identity)).toMatchObject({userId:'user1',tenantId:'tenant1',token:'ds_at_secret1'});
  now += 73 * 3600000; mono += 73 * 3600000;
  await expect(manager.authorize(identity)).rejects.toMatchObject({status:402});
});
