// RGPD — purge automatisée des cabinets dont la fermeture a été demandée
// (Settings > Zone dangereuse, server/routes/settings.ts's
// /api/settings/tenant-deletion). A tenant admin sets tenants.deletion_requested_at
// and gets a 30-day grace period to cancel; once elapsed, this job hard-deletes
// the tenant permanently: its auth users (cascades their profiles row per
// `profiles.id REFERENCES auth.users(id) ON DELETE CASCADE`), its storage
// files, then the tenants row itself — which cascades essentially every
// business table via their `tenant_id ... ON DELETE CASCADE` foreign key.
// Same setInterval-on-boot pattern as server/tenderRssPoller.ts.
import type { SupabaseClient } from '@supabase/supabase-js';

const GRACE_PERIOD_DAYS = 30;
const DEFAULT_CHECK_INTERVAL_HOURS = 24;
// Buckets whose files are namespaced by `${tenantId}/...` (see server.ts's
// uploadToStorage call sites) — best-effort cleanup, not privacy-critical
// once the referencing rows are gone, but avoids leaving orphaned files.
const TENANT_PREFIXED_BUCKETS = ['documents', 'plans', 'cv', 'message-attachments', 'feed-attachments', 'meeting-photos', 'logos', 'support-attachments'];

async function purgeStorageForTenant(supabaseAdmin: SupabaseClient, tenantId: string): Promise<void> {
  for (const bucket of TENANT_PREFIXED_BUCKETS) {
    try {
      const { data: entries, error } = await supabaseAdmin.storage.from(bucket).list(tenantId, { limit: 1000 });
      if (error || !entries?.length) continue;
      const paths = entries.filter(e => e.id !== null).map(e => `${tenantId}/${e.name}`);
      if (paths.length) await supabaseAdmin.storage.from(bucket).remove(paths);
    } catch (e: any) {
      console.error(`[tenantPurge] Storage cleanup failed for ${bucket}/${tenantId}:`, e.message);
    }
  }
}

async function purgeTenant(supabaseAdmin: SupabaseClient, tenantId: string): Promise<void> {
  const { data: profiles } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', tenantId);
  for (const profile of (profiles || []) as { id: string }[]) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(profile.id);
    if (error) console.error(`[tenantPurge] Failed to delete auth user ${profile.id}:`, error.message);
  }

  await purgeStorageForTenant(supabaseAdmin, tenantId);

  // Cascades every table with `tenant_id UUID REFERENCES tenants(id) ON
  // DELETE CASCADE` (projects, invoices, documents, contacts, ... — see
  // supabase/schema.sql) — this is the actual purge of all professional data.
  const { error } = await supabaseAdmin.from('tenants').delete().eq('id', tenantId);
  if (error) {
    console.error(`[tenantPurge] Failed to delete tenant ${tenantId}:`, error.message);
    return;
  }
  console.log(`[tenantPurge] Purged tenant ${tenantId} (deletion grace period elapsed)`);
}

export async function purgeExpiredTenants(supabaseAdmin: SupabaseClient): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .not('deletion_requested_at', 'is', null)
    .lte('deletion_requested_at', cutoff);
  if (error) {
    console.error('[tenantPurge] Failed to list tenants pending deletion:', error.message);
    return;
  }
  for (const tenant of (data || []) as { id: string }[]) {
    await purgeTenant(supabaseAdmin, tenant.id);
  }
}

export function startTenantPurge(supabaseAdmin: SupabaseClient): void {
  const intervalHours = parseInt(process.env.TENANT_PURGE_INTERVAL_HOURS || '', 10) || DEFAULT_CHECK_INTERVAL_HOURS;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  purgeExpiredTenants(supabaseAdmin).catch(e => console.error('[tenantPurge] Initial purge check failed:', e.message));
  setInterval(() => {
    purgeExpiredTenants(supabaseAdmin).catch(e => console.error('[tenantPurge] Purge cycle failed:', e.message));
  }, intervalMs);
}
