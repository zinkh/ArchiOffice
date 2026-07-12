// Inbound-sync watermark persistence — separate from server/cloudLinkState.ts
// (which is set once at link time and rarely changes) since this updates on
// every sync cycle. Same file-storage pattern as server/offlineAccount.ts.
import fs from 'fs';
import path from 'path';
import { getDataDir } from './offlineAccount';

export interface CloudSyncState {
  /** Last sync_log.id applied locally — cloudSync.ts's inbound pull resumes from here. */
  watermark: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

function cloudSyncStatePath(): string {
  return path.join(getDataDir(), 'cloud-sync-state.json');
}

export function readCloudSyncState(initialWatermark: number): CloudSyncState {
  const p = cloudSyncStatePath();
  if (!fs.existsSync(p)) {
    return { watermark: initialWatermark, lastSyncAt: null, lastError: null };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeCloudSyncState(state: CloudSyncState): void {
  fs.writeFileSync(cloudSyncStatePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
}
