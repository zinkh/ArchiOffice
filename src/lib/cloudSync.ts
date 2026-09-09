import { storeLocalSession, LocalSession } from './authToken';
import { apiFetch } from './api';

export interface ExportConflict {
  table: string;
  rowCount: number;
  error: string;
}

export interface ExportJobStatus {
  status: 'running' | 'done' | 'error';
  tablesDone: number;
  tablesTotal: number;
  currentTable: string | null;
  rowsDone: number;
  filesDone: number;
  error: string | null;
  conflicts: ExportConflict[];
}

async function parseJsonOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

export async function checkCloudLinkStatus(): Promise<{ linked: boolean }> {
  const res = await fetch('/api/auth/cloud-link-status');
  return parseJsonOrThrow(res);
}

export async function cloudLink(email: string, password: string, localPassword: string): Promise<LocalSession & { importJobId: string }> {
  const res = await fetch('/api/auth/cloud-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, localPassword }),
  });
  const result = await parseJsonOrThrow(res);
  storeLocalSession({ access_token: result.access_token, user: result.user });
  return result;
}

export interface ImportJobStatus {
  status: 'running' | 'done' | 'error';
  tablesDone: number;
  tablesTotal: number;
  currentTable: string | null;
  rowsDone: number;
  filesDone: number;
  error: string | null;
}

export async function getImportProgress(jobId: string): Promise<ImportJobStatus> {
  const res = await fetch(`/api/auth/cloud-link-import/${jobId}`);
  return parseJsonOrThrow(res);
}

export interface SyncStatusResponse {
  linked: boolean;
  lastSyncAt: string | null;
  pendingPushCount: number;
  isOnline: boolean;
  lastError: string | null;
}

export async function getSyncStatus(): Promise<SyncStatusResponse> {
  try {
    return await apiFetch<SyncStatusResponse>('/api/sync/status');
  } catch {
    return { linked: false, lastSyncAt: null, pendingPushCount: 0, isOnline: false, lastError: null };
  }
}

export async function triggerSyncNow(): Promise<void> {
  await apiFetch('/api/sync/now', { method: 'POST' });
}

/**
 * Switches an already-configured local-only install (server/localAuthRoutes.ts)
 * to a cloud-linked one, keeping the data already captured locally — see
 * server/localCloudUpgrade.ts. Requires an active local session (unlike
 * cloudLink() above, which runs before any session exists).
 */
export async function upgradeToCloud(email: string, password: string): Promise<LocalSession & { exportJobId: string; importJobId: string }> {
  const result = await apiFetch<LocalSession & { exportJobId: string; importJobId: string }>('/api/auth/cloud-link-upgrade', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  storeLocalSession({ access_token: result.access_token, user: result.user });
  return result;
}

export async function getExportProgress(jobId: string): Promise<ExportJobStatus> {
  const res = await fetch(`/api/auth/cloud-link-upgrade-export/${jobId}`);
  return parseJsonOrThrow(res);
}
