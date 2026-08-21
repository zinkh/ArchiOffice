// Exchanges a stored "public URL"-shaped storage reference (see
// server/storagePaths.ts) for a short-lived signed URL, after checking the
// caller's own tenant actually owns that object. Every upload route in this
// app namespaces its storage path as `${tenantId}/...` (confirmed across
// documents.ts, plans.ts, profile.ts, messaging.ts, activityFeed.ts,
// visas.ts, meetings.ts), so that prefix is what's checked here — there's no
// per-object ACL table, this *is* the authorization boundary.
import type { Express } from 'express';
import { PRIVATE_STORAGE_BUCKETS, parseStorageRef } from '../storagePaths';
import { isSuperAdmin } from '../superAdminAuth';

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — long enough for a page view/download, short enough to bound a leaked link's lifetime.

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerStorageAccessRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/storage/signed-url', async (req: any, res: any) => {
    try {
      const fileUrl = req.query.url as string;
      if (!fileUrl) return res.status(400).json({ error: "Paramètre 'url' requis" });

      const ref = parseStorageRef(fileUrl);
      if (!ref || !PRIVATE_STORAGE_BUCKETS.has(ref.bucket)) {
        return res.status(400).json({ error: 'Référence de stockage invalide' });
      }
      // A platform superadmin has no tenant of their own (see
      // server/superAdminAuth.ts) but legitimately needs to resolve a
      // tenant's support-ticket attachment from /admin/support — they
      // already read arbitrary tenant data everywhere else via
      // supabaseAdmin, so this isn't a new privilege, just extending it here.
      if (!(await isSuperAdmin(supabaseAdmin, req.user))) {
        const tenantId = await getTenantId(req.user.id);
        if (!ref.path.startsWith(`${tenantId}/`)) {
          return res.status(403).json({ error: 'Accès refusé' });
        }
      }

      const { data, error } = await supabaseAdmin.storage
        .from(ref.bucket)
        .createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) {
        return res.status(404).json({ error: 'Fichier introuvable' });
      }
      res.json({ url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS });
    } catch (e: any) {
      console.error('[GET /api/storage/signed-url]', e);
      res.status(e.status || 500).json({ error: e.message || 'Échec de la résolution du fichier' });
    }
  });
}
