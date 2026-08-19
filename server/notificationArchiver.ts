// Auto-archivage du flux d'activité (activities, feed_posts) selon une durée
// de rétention réglable par catégorie (Paramètres > cabinet, colonne
// settings.notification_archive_days — voir server/routes/settings.ts).
// Même pattern setInterval-on-boot que server/tenantPurge.ts.
import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_CHECK_INTERVAL_HOURS = 6;

// Tenu en phase avec les libellés de catégorie utilisés par le flux (voir
// CATEGORY_COLORS dans src/components/ActivityFeed.tsx et CATEGORY_STYLES
// dans src/pages/Notifications.tsx). 'Messages' est la catégorie synthétique
// sous laquelle les feed_posts apparaissent toujours dans /api/feed.
const KNOWN_CATEGORIES = [
  'Projets', 'Factures', "Appels d'offres", 'Messages', 'Contacts', 'Documents',
  'CCTP', 'Devis', 'Réunions', 'Ordres de service', 'Tâches', 'Situations/DPGF',
  'Notes de site', 'Réserves/Observations', 'Intégrations',
];

type ArchiveConfig = Record<string, number>;

// Une entrée explicite pour la catégorie prime ; sinon on retombe sur
// `default` (réglage global du cabinet) ; sinon jamais d'archivage.
function effectiveDaysFor(category: string, config: ArchiveConfig): number {
  const explicit = config[category];
  if (typeof explicit === 'number' && explicit > 0) return explicit;
  const fallback = config.default;
  return typeof fallback === 'number' && fallback > 0 ? fallback : 0;
}

async function archiveForTenant(supabaseAdmin: SupabaseClient, tenantId: string, config: ArchiveConfig): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();

  for (const category of KNOWN_CATEGORIES) {
    const days = effectiveDaysFor(category, config);
    if (!days) continue;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

    if (category === 'Messages') {
      const { error } = await supabaseAdmin
        .from('feed_posts')
        .update({ archived_at: nowIso })
        .eq('tenant_id', tenantId)
        .is('archived_at', null)
        .lt('created_at', cutoff);
      if (error) console.error(`[notificationArchiver] feed_posts archive failed for tenant ${tenantId}:`, error.message);
    }

    const { error } = await supabaseAdmin
      .from('activities')
      .update({ archived_at: nowIso })
      .eq('tenant_id', tenantId)
      .eq('category', category)
      .is('archived_at', null)
      .lt('created_at', cutoff);
    if (error) console.error(`[notificationArchiver] activities archive failed for tenant ${tenantId}/${category}:`, error.message);
  }
}

export async function archiveExpiredNotifications(supabaseAdmin: SupabaseClient): Promise<void> {
  const { data: rows, error } = await supabaseAdmin
    .from('settings')
    .select('tenant_id, notification_archive_days')
    .not('notification_archive_days', 'is', null);
  if (error) {
    console.error('[notificationArchiver] Failed to list tenant archive settings:', error.message);
    return;
  }
  for (const row of (rows || []) as { tenant_id: string; notification_archive_days: ArchiveConfig | null }[]) {
    const config = row.notification_archive_days;
    if (!config || Object.keys(config).length === 0) continue;
    await archiveForTenant(supabaseAdmin, row.tenant_id, config);
  }
}

export function startNotificationArchiver(supabaseAdmin: SupabaseClient): void {
  const intervalHours = parseInt(process.env.NOTIFICATION_ARCHIVE_INTERVAL_HOURS || '', 10) || DEFAULT_CHECK_INTERVAL_HOURS;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  archiveExpiredNotifications(supabaseAdmin).catch(e => console.error('[notificationArchiver] Initial archive check failed:', e.message));
  setInterval(() => {
    archiveExpiredNotifications(supabaseAdmin).catch(e => console.error('[notificationArchiver] Archive cycle failed:', e.message));
  }, intervalMs);
}
