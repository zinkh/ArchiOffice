import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import trust from '../../electron/driveTrust.json';
import { getDataDir } from '../offlineAccount';
import { readCloudLinkState, readEncryptedCloudSession, writeEncryptedCloudSession } from '../cloudLinkState';
import { encryptForStorage, decryptFromStorage } from '../ipcCrypto';
import { createCloudSupabaseClient, restoreCloudSession } from '../cloudSyncClient';
import { createLocalDrive, type LocalDriveState } from './localDrive';

const unavailable = () => Object.assign(new Error('Le stockage sécurisé Drive est indisponible. Aucun accès hors connexion n’est accordé.'),
  { status: 503, code: 'DRIVE_SECURE_STORAGE_UNAVAILABLE' });
const statePath = () => path.join(getDataDir(), 'drive-state.enc');
export async function readDriveState(): Promise<LocalDriveState | null> {
  try {
    let encrypted: string;
    try { encrypted = await fs.readFile(statePath(), 'utf8'); }
    catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
    if (encrypted.length > 65536) throw unavailable();
    const s = JSON.parse(await decryptFromStorage(encrypted));
    if (!s || !['userId', 'tenantId', 'deviceId', 'deviceToken', 'name'].every(k => typeof s[k] === 'string')
      || !['windows', 'macos'].includes(s.platform) || !Number.isFinite(s.lastSeenAt)
      || typeof s.denied !== 'boolean' || typeof s.disconnectPending !== 'boolean'
      || (s.license !== null && typeof s.license !== 'string')) throw unavailable();
    return s;
  } catch { throw unavailable(); }
}
export async function writeDriveState(state: LocalDriveState): Promise<void> {
  const tmp = `${statePath()}.${crypto.randomUUID()}.tmp`;
  try {
    const ciphertext = await encryptForStorage(JSON.stringify(state));
    await fs.writeFile(tmp, ciphertext, { mode: 0o600, flag: 'wx' });
    await fs.rename(tmp, statePath());
  } catch { throw unavailable(); }
  finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
}

function configuredOrigin(): string | null {
  try {
    const url = new URL(trust.cloudOrigin || '');
    return url.protocol === 'https:' && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}
const origin = configuredOrigin();
const trustedKeys: Record<string, string> = trust.publicKeys;
const keysValid = Object.keys(trustedKeys).length > 0 && Object.entries(trustedKeys).every(([kid, pem]) => {
  try { return /^[a-zA-Z0-9_-]{1,64}$/.test(kid) && crypto.createPublicKey(pem).asymmetricKeyType === 'ed25519'; }
  catch { return false; }
});
const manager = createLocalDrive({
  configured: !!origin && keysValid && ['win32', 'darwin'].includes(process.platform),
  trustedKeys,
  linkedIdentity: () => { const link = readCloudLinkState(); return link?.importCompleted ? { userId: link.cloudUserId, tenantId: link.tenantId } : null; },
  read: readDriveState, write: writeDriveState, now: Date.now, monotonic: () => performance.now(),
  platform: process.platform === 'darwin' ? 'macos' : 'windows', name: os.hostname().slice(0, 80) || 'ArchiOffice',
  cloudSession: async () => {
    let client: ReturnType<typeof createCloudSupabaseClient> | undefined;
    try {
      const encrypted = readEncryptedCloudSession(); if (!encrypted) throw new Error();
      client = createCloudSupabaseClient();
      const session = await restoreCloudSession(client, await decryptFromStorage(encrypted));
      if (!session) throw new Error();
      const link = readCloudLinkState();
      if (!link || session.user.id !== link.cloudUserId) throw new Error();
      // Persist the rotated refresh token before any subsequent cloud operation.
      writeEncryptedCloudSession(await encryptForStorage(session.refresh_token));
      return session.access_token;
    } catch { throw Object.assign(new Error('Reconnectez le compte cloud de ce poste pour activer Drive.'), { status: 401, code: 'DRIVE_CLOUD_SESSION_REQUIRED' }); }
    finally { await client?.auth.stopAutoRefresh(); }
  },
  request: async (route, token, tenantId, body, method = 'POST') => {
    // Origin is shipped with the client; no URL or public key is accepted from a request.
    if (!origin) throw Object.assign(new Error('Service Drive non configuré.'), { status: 503, code: 'DRIVE_TRUST_UNCONFIGURED' });
    let response: Response;
    try {
      response = await fetch(`${origin}/api/desktop/v1${route}`, { method, redirect: 'error',
        signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`,
          ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw Object.assign(new Error('Service Drive injoignable. L’autorisation existante reste bornée à son échéance.'), { status: 503, code: 'DRIVE_NETWORK_UNAVAILABLE' }); }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error('Le service Drive a refusé la demande. Vérifiez votre compte et votre abonnement.'), { status: response.status, code: 'DRIVE_REMOTE_REFUSAL' });
    }
    // Small JSON responses only; never retain an unbounded response from a proxy.
    const reader = response.body?.getReader(); let text = ''; let bytes = 0;
    if (!reader) throw new Error('Réponse Drive vide.');
    const decoder = new TextDecoder();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break;
      bytes += value.length; if (bytes > 32768) throw new Error('Réponse Drive trop volumineuse.');
      text += decoder.decode(value, { stream: true }); }
      return JSON.parse(text + decoder.decode());
    } finally { await reader.cancel().catch(() => {}); }
  },
});
export const localDrive = manager;

/** No automatic enrollment. Refresh only an existing encrypted registration. */
export function startLocalDriveRefresh(): void {
  const tick = async () => {
    try { const link = readCloudLinkState();
      if (origin && link?.importCompleted) await manager.refresh({ userId: link.cloudUserId, tenantId: link.tenantId });
    } catch { /* safe failure: no token logging and no file deletion */ }
  };
  void tick(); setInterval(() => void tick(), 15 * 60 * 1000).unref();
}
