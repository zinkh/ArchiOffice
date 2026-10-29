import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { addMembership, authHeader, getTestApp, makeUser, tenantHeader } from './testServer';
import { API, makeDriveTenant } from './desktopSyncSupport';
const { local } = vi.hoisted(() => ({ local: {
  connect: vi.fn(), refresh: vi.fn(), capability: vi.fn(), devices: vi.fn(), disconnect: vi.fn(),
} }));
vi.mock('../server/desktop/localDriveRuntime', () => ({ localDrive: local, startLocalDriveRefresh: vi.fn() }));
let app: Express;
beforeAll(async () => { app = await getTestApp(); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('uses the authenticated local identity without accepting a host, token or key from the renderer', async () => {
  vi.stubEnv('OFFLINE_MODE', 'true');
  const tenantId = makeDriveTenant(); const user = makeUser(tenantId);
  local.connect.mockResolvedValue({ enabled: true, local: true });
  const res = await request(app).post(`${API}/local/connect`).set({ ...authHeader(user.token), ...tenantHeader(tenantId) })
    .send({ tenantId: 'forged', userId: 'forged', cloudOrigin: 'https://attacker.test', token: 'forged' });
  expect(res.status).toBe(200);
  expect(local.connect).toHaveBeenCalledWith({ userId: user.userId, tenantId });
});
it('checks the signed local capability on guarded routes and preserves personal device management', async () => {
  vi.stubEnv('OFFLINE_MODE', 'true');
  const tenantId = makeDriveTenant(); const user = makeUser(tenantId);
  const headers = { ...authHeader(user.token), ...tenantHeader(tenantId) };
  local.capability.mockResolvedValue({ enabled: false, local: true, code: 'DRIVE_LICENSE_EXPIRED', message: 'expired' });
  expect((await request(app).get(`${API}/nodes/tenant:${tenantId}`).set(headers)).status).toBe(402);
  local.devices.mockResolvedValue([{ id: 'dev_local', name: 'Atelier' }]);
  expect((await request(app).get(`${API}/devices`).set(headers)).body).toEqual([{ id: 'dev_local', name: 'Atelier' }]);
  local.disconnect.mockResolvedValue({ success: true, remoteRevocationPending: true });
  expect((await request(app).delete(`${API}/devices/dev_local`).set(headers)).body.remoteRevocationPending).toBe(true);
  expect(local.disconnect).toHaveBeenCalledWith({ userId: user.userId, tenantId }, 'dev_local');
});
it('does not expose local activation on the cloud server', async () => {
  const user = makeUser(makeDriveTenant());
  expect((await request(app).post(`${API}/local/connect`).set(authHeader(user.token)).send({})).status).toBe(404);
  expect(local.connect).not.toHaveBeenCalled();
});

it('keeps the linked root visible when the user has another unlinked cabinet', async () => {
  vi.stubEnv('OFFLINE_MODE', 'true');
  const linked = makeDriveTenant(); const other = makeDriveTenant(); const user = makeUser(linked);
  addMembership(user.userId, other);
  local.capability.mockImplementation(async ({ tenantId }: { tenantId: string }) => {
    if (tenantId === other) throw Object.assign(new Error('unlinked'), { status: 403, code: 'DRIVE_CLOUD_LINK_REQUIRED' });
    return { enabled: true, local: true };
  });
  const res = await request(app).get(`${API}/roots`).set(authHeader(user.token));
  expect(res.status).toBe(200); expect(res.body.map((r: any) => r.tenantId)).toEqual([linked]);
});
