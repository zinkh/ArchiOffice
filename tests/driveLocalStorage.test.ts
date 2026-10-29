import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readDriveState, writeDriveState } from '../server/desktop/localDriveRuntime';
import type { LocalDriveState } from '../server/desktop/localDrive';
// Exercise the same encrypted I/O boundary as Electron without requiring a native GUI.
vi.mock('../server/ipcCrypto', async () => {
  const crypto = await import('node:crypto');
  const key = crypto.randomBytes(32);
  return {
    encryptForStorage: async (value: string) => {
      const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    },
    decryptFromStorage: async (value: string) => {
      const raw = Buffer.from(value, 'base64'); const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString();
    },
  };
});
let dir: string;
const state: LocalDriveState = { userId: 'u', tenantId: 't', deviceId: 'dev_1', deviceToken: 'ds_at_secret',
  name: 'Atelier', platform: 'windows', license: 'signed.secret.license', lastSeenAt: Date.now(), denied: false, disconnectPending: false };
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drive-secure-test-')); vi.stubEnv('OFFLINE_DATA_DIR', dir); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }); });
it('stores only ciphertext, atomically replaces state, and roundtrips through the crypto boundary', async () => {
  expect(await readDriveState()).toBeNull();
  await writeDriveState(state);
  const disk = await fs.readFile(path.join(dir, 'drive-state.enc'), 'utf8');
  expect(disk).not.toContain(state.deviceToken); expect(disk).not.toContain(state.license!);
  expect(await readDriveState()).toEqual(state);
  await writeDriveState({ ...state, denied: true });
  expect((await readDriveState())?.denied).toBe(true);
  expect(await fs.readdir(dir)).toEqual(['drive-state.enc']);
  if (process.platform !== 'win32') expect((await fs.stat(path.join(dir, 'drive-state.enc'))).mode & 0o777).toBe(0o600);
});
it('refuses corruption while leaving unrelated local work untouched', async () => {
  await fs.writeFile(path.join(dir, 'Plan.dwg'), 'local edits');
  await fs.writeFile(path.join(dir, 'drive-state.enc'), 'invalid');
  await expect(readDriveState()).rejects.toMatchObject({ code: 'DRIVE_SECURE_STORAGE_UNAVAILABLE' });
  expect(await fs.readFile(path.join(dir, 'Plan.dwg'), 'utf8')).toBe('local edits');
});
