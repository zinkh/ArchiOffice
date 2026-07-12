// Background two-way sync engine for a cloud-linked offline install. Started
// once from server.ts, only when server/cloudLinkState.ts shows a completed
// link. Two directions, both driven off one periodic interval:
//   - outbound: replay server/localPendingPush.ts entries (captured by
//     server/offlineGateway.ts's /rest/v1 proxy hook) up to the cloud.
//   - inbound: pull supabase's sync_log (added by
//     supabase/migrate_add_sync_infra.sql) for this tenant since the last
//     watermark, apply locally.
// Conflict resolution is last-write-wins by each side's own DB-assigned
// updated_at (never a client-supplied timestamp — see the migration's
// touch_updated_at trigger), compared fresh at the moment of sync.
import type { SupabaseClient } from '@supabase/supabase-js';
import { CloudLinkState } from './cloudLinkState';
import { readCloudSyncState, writeCloudSyncState, CloudSyncState } from './cloudSyncState';
import { createCloudSupabaseClient, restoreCloudSession } from './cloudSyncClient';
import { decryptFromStorage } from './ipcCrypto';
import { readEncryptedCloudSession } from './cloudLinkState';
import {
  ensurePendingPushTable,
  fetchPendingPushBatch,
  markPendingPushProcessed,
  markPendingPushFailed,
  countPendingPush,
} from './localPendingPush';
import { SYNC_TABLES, JUNCTION_TABLES } from './syncTables';

const POLL_INTERVAL_MS = 30000;
const BACKOFF_STEPS_MS = [30000, 60000, 120000, 300000];
const RECENTLY_PUSHED_TTL_MS = 5 * 60 * 1000;

export interface CloudSyncStatus {
  linked: true;
  lastSyncAt: string | null;
  pendingPushCount: number;
  isOnline: boolean;
  lastError: string | null;
}

export interface CloudSyncHandle {
  triggerNow(): void;
  getStatus(): Promise<CloudSyncStatus>;
  stop(): void;
}

function junctionTablesFor(parentTable: string) {
  return JUNCTION_TABLES.filter((j) => j.parentTable === parentTable);
}

export async function startCloudSync(supabaseAdmin: SupabaseClient, linkState: CloudLinkState): Promise<CloudSyncHandle> {
  const pgUrl = process.env.OFFLINE_PG_URL;
  if (!pgUrl) throw new Error('OFFLINE_PG_URL not set — cloud sync requires a direct local Postgres connection.');
  await ensurePendingPushTable(pgUrl);

  const encrypted = readEncryptedCloudSession();
  if (!encrypted) throw new Error('No stored cloud session found — cloud-link must be redone.');
  const refreshToken = await decryptFromStorage(encrypted);

  const cloudClient = createCloudSupabaseClient();
  await restoreCloudSession(cloudClient, refreshToken);

  const tenantId = linkState.tenantId;
  let syncState: CloudSyncState = readCloudSyncState(linkState.initialWatermarkId ?? 0);
  let isOnline = true;
  let lastError: string | null = null;
  let backoffIndex = 0;
  const recentlyPushed = new Map<string, number>();

  function markRecentlyPushed(table: string, rowId: string, updatedAt: string) {
    recentlyPushed.set(`${table}:${rowId}:${updatedAt}`, Date.now() + RECENTLY_PUSHED_TTL_MS);
  }
  function wasRecentlyPushed(table: string, rowId: string, updatedAt: string): boolean {
    const key = `${table}:${rowId}:${updatedAt}`;
    const expiry = recentlyPushed.get(key);
    if (!expiry) return false;
    if (expiry < Date.now()) {
      recentlyPushed.delete(key);
      return false;
    }
    return true;
  }

  async function syncJunctionRows(parentTable: string, parentId: string) {
    for (const { table, parentIdColumn } of junctionTablesFor(parentTable)) {
      const { data: cloudRows } = await cloudClient.from(table).select('*').eq(parentIdColumn, parentId);
      if (cloudRows) await supabaseAdmin.from(table).upsert(cloudRows);
    }
  }

  async function runOutboundBatch() {
    const entries = await fetchPendingPushBatch(pgUrl!, 50);
    for (const entry of entries) {
      try {
        if (entry.op === 'DELETE') {
          await cloudClient.from(entry.table_name).delete().eq('id', entry.row_id);
          await markPendingPushProcessed(pgUrl!, entry.id);
          continue;
        }

        const { data: localRow } = await supabaseAdmin.from(entry.table_name).select('*').eq('id', entry.row_id).maybeSingle();
        if (!localRow) {
          // The row is gone locally (deleted after this push was queued, or
          // the original write failed) — nothing to push, done either way.
          await markPendingPushProcessed(pgUrl!, entry.id);
          continue;
        }

        const { data: cloudRow } = await cloudClient.from(entry.table_name).select('updated_at').eq('id', entry.row_id).maybeSingle();
        if (!cloudRow || !cloudRow.updated_at || new Date(localRow.updated_at) >= new Date(cloudRow.updated_at)) {
          await cloudClient.from(entry.table_name).upsert(localRow);
          markRecentlyPushed(entry.table_name, entry.row_id, localRow.updated_at);
          if (entry.table_name === 'projects') await syncJunctionRows('projects', entry.row_id);
          if (entry.table_name === 'observations') await syncJunctionRows('observations', entry.row_id);
        }
        // else: cloud is newer — skip pushing, the inbound pull below will
        // bring the newer cloud version down instead (LWW favors cloud).
        await markPendingPushProcessed(pgUrl!, entry.id);
      } catch (err: any) {
        await markPendingPushFailed(pgUrl!, entry.id, err?.message || String(err));
      }
    }
  }

  async function runInboundBatch() {
    const { data: entries, error } = await cloudClient
      .from('sync_log')
      .select('*')
      .eq('tenant_id', tenantId)
      .gt('id', syncState.watermark)
      .order('id', { ascending: true })
      .limit(200);
    if (error || !entries) return;

    for (const entry of entries) {
      const updatedAt = entry.row_data?.updated_at;
      if (!wasRecentlyPushed(entry.table_name, entry.row_id, updatedAt)) {
        if (entry.op === 'DELETE') {
          await supabaseAdmin.from(entry.table_name).delete().eq('id', entry.row_id);
        } else if (SYNC_TABLES.includes(entry.table_name)) {
          const { data: localRow } = await supabaseAdmin.from(entry.table_name).select('updated_at').eq('id', entry.row_id).maybeSingle();
          if (!localRow || !localRow.updated_at || new Date(updatedAt) >= new Date(localRow.updated_at)) {
            await supabaseAdmin.from(entry.table_name).upsert(entry.row_data);
            if (entry.table_name === 'projects') await syncJunctionRows('projects', entry.row_id);
            if (entry.table_name === 'observations') await syncJunctionRows('observations', entry.row_id);
          }
          // else: local has a newer, not-yet-pushed edit — keep it, the
          // outbound loop will push it up on its own next cycle.
        }
      }
      syncState = { ...syncState, watermark: entry.id };
    }
    writeCloudSyncState(syncState);
  }

  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function runCycle() {
    if (running) return;
    running = true;
    try {
      await runOutboundBatch();
      await runInboundBatch();
      isOnline = true;
      lastError = null;
      backoffIndex = 0;
      syncState = { ...syncState, lastSyncAt: new Date().toISOString(), lastError: null };
      writeCloudSyncState(syncState);
    } catch (err: any) {
      isOnline = false;
      lastError = err?.message || String(err);
      backoffIndex = Math.min(backoffIndex + 1, BACKOFF_STEPS_MS.length - 1);
      syncState = { ...syncState, lastError };
      writeCloudSyncState(syncState);
    } finally {
      running = false;
      scheduleNext();
    }
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer);
    const delay = isOnline ? POLL_INTERVAL_MS : BACKOFF_STEPS_MS[backoffIndex];
    timer = setTimeout(runCycle, delay);
  }

  scheduleNext();

  return {
    triggerNow() {
      backoffIndex = 0;
      void runCycle();
    },
    async getStatus(): Promise<CloudSyncStatus> {
      return {
        linked: true,
        lastSyncAt: syncState.lastSyncAt,
        pendingPushCount: await countPendingPush(pgUrl!),
        isOnline,
        lastError,
      };
    },
    stop() {
      if (timer) clearTimeout(timer);
    },
  };
}
