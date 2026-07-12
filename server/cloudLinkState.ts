// Persists whether/how this install is linked to a cloud tenant. Follows
// the same file-storage pattern as server/offlineAccount.ts (small JSON
// files under OFFLINE_DATA_DIR), kept in a separate file from
// local-account.json since cloud-link is a distinct concern (an install can
// have a local account without ever being cloud-linked).
import fs from 'fs';
import path from 'path';
import { getDataDir } from './offlineAccount';

export interface CloudLinkState {
  tenantId: string;
  cloudUserId: string;
  email: string;
  linkedAt: string;
  /** Set once server/initialImport.ts finishes; gates whether cloudSync.ts's
   *  background loop starts and whether Login.tsx re-offers the first-run choice. */
  importCompleted: boolean;
  /** sync_log.id captured at the START of the initial import (before any
   *  rows were fetched) — the inbound-pull watermark seed, so nothing that
   *  changed on the cloud mid-import is missed. */
  initialWatermarkId: number | null;
  /** Generated once via crypto.randomUUID() at link time, reused to tag
   *  this install's own pushes for anti-echo suppression (server/cloudSync.ts). */
  installId: string;
}

function cloudLinkStatePath(): string {
  return path.join(getDataDir(), 'cloud-link.json');
}

/** Base64 ciphertext from server/ipcCrypto.ts's encryptForStorage() (which
 *  bridges to Electron's safeStorage, DPAPI-backed on Windows). This module
 *  only handles the file I/O; it never sees the plaintext refresh token. */
function cloudSessionPath(): string {
  return path.join(getDataDir(), 'cloud-session.enc');
}

export function readCloudLinkState(): CloudLinkState | null {
  const p = cloudLinkStatePath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeCloudLinkState(state: CloudLinkState): void {
  fs.writeFileSync(cloudLinkStatePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function readEncryptedCloudSession(): string | null {
  const p = cloudSessionPath();
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

export function writeEncryptedCloudSession(ciphertext: string): void {
  fs.writeFileSync(cloudSessionPath(), ciphertext, { mode: 0o600, encoding: 'utf8' });
}
