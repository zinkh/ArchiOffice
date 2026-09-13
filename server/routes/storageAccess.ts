// Exchanges a stored "public URL"-shaped storage reference (see
// server/storagePaths.ts) for a short-lived signed URL, after checking the
// caller's own tenant actually owns that object. Every upload route in this
// app namespaces its storage path as `${tenantId}/...` (confirmed across
// documents.ts, plans.ts, profile.ts, messaging.ts, activityFeed.ts,
// visas.ts, meetings.ts), so that prefix is what's checked here — there's no
// per-object ACL table, this *is* the authorization boundary.
//
// Depuis l'arrivée du stockage sur l'espace du cabinet (Google Drive, Dropbox,
// Nextcloud, kDrive), un `file_url` peut aussi être une référence
// `archioffice+external://...`. Le contrat rendu au client ne change pas — une
// URL ouvrable pendant une heure — mais elle pointe alors sur notre propre
// origine, et c'est un jeton signé qui l'autorise (voir externalTicket.ts) :
// `openSignedUrl()` ouvre par `window.open()` et `<SignedImage>` pose l'URL
// dans un `src`, deux navigations nues qui ne peuvent porter aucun JWT.
import type { Express } from 'express';
import { PRIVATE_STORAGE_BUCKETS, parseStorageRef } from '../storagePaths';
import { isSuperAdmin } from '../superAdminAuth';
import { isExternalRef, parseExternalRef } from '../externalStorage/externalRef';
import { getConnectionById } from '../externalStorage/externalConnection';
import { createProvider } from '../externalStorage/providerFactory';
import {
  EXTERNAL_TICKET_TTL_SECONDS,
  signExternalTicket,
  verifyExternalTicket,
} from '../externalStorage/externalTicket';

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

      // ── Fichier hébergé sur l'espace de stockage du cabinet ──────────────
      if (isExternalRef(fileUrl)) {
        const ref = parseExternalRef(fileUrl);
        if (!ref) return res.status(400).json({ error: 'Référence de stockage invalide' });

        // Le mode hors ligne sert déjà les fichiers depuis le poste ; un drive
        // distant n'y est ni joignable ni pertinent. On le dit, plutôt que de
        // laisser échouer un téléchargement sans explication.
        if (process.env.OFFLINE_MODE === 'true') {
          return res.status(503).json({
            error: "Ce fichier est hébergé sur l'espace de stockage de votre cabinet et n'est pas disponible hors ligne.",
          });
        }

        // Le bypass superadmin de la branche Supabase n'est délibérément PAS
        // étendu ici : un administrateur de la plateforme n'a pas à pouvoir se
        // forger un lien vers le Drive privé d'un cabinet. Son besoin légitime
        // (les pièces jointes de support) reste couvert, ce bucket restant chez
        // nous par construction.
        const tenantId = await getTenantId(req.user.id);
        // Faute de préfixe `${tenantId}/` dans le chemin, c'est l'appartenance
        // de la CONNEXION au cabinet qui fait ici frontière d'autorisation.
        const connection = await getConnectionById(supabaseAdmin, tenantId, ref.connectionId);
        if (!connection) return res.status(403).json({ error: 'Accès refusé' });

        const ticket = signExternalTicket({ t: tenantId, c: ref.connectionId, e: ref.externalId, n: ref.fileName });
        return res.json({
          url: `/api/storage/external/${encodeURIComponent(ticket)}`,
          expiresIn: EXTERNAL_TICKET_TTL_SECONDS,
        });
      }

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

  // Sert un fichier hébergé sur l'espace du cabinet. Inscrite dans AUTH_EXEMPT
  // (server.ts) : c'est le jeton qui authentifie, pas le JWT — voir plus haut.
  app.get('/api/storage/external/:ticket', async (req: any, res: any) => {
    try {
      const payload = verifyExternalTicket(req.params.ticket);
      if (!payload) return res.status(401).json({ error: 'Lien expiré ou invalide' });

      const connection = await getConnectionById(supabaseAdmin, payload.t, payload.c);
      if (!connection) return res.status(403).json({ error: 'Accès refusé' });

      const provider = createProvider(connection);

      // Quand le fournisseur sait produire un lien temporaire (Dropbox), on
      // redirige : aucun octet ne transite par le serveur. Ce lien est propre au
      // porteur et de courte durée — il n'élargit PAS le partage du fichier dans
      // l'espace du cabinet, ce qu'on se refuse à faire en son nom.
      const link = await provider.getTemporaryLink(payload.e);
      if (link) return res.redirect(302, link);

      const stream = await provider.openReadStream(payload.e, req.headers.range as string | undefined);
      res.status(stream.status);
      res.setHeader('Content-Type', stream.contentType || 'application/octet-stream');
      if (stream.contentLength !== null) res.setHeader('Content-Length', String(stream.contentLength));
      if (stream.contentRange) res.setHeader('Content-Range', stream.contentRange);
      // pdf.js (src/components/PlanAnnotator.tsx) ne demande des plages que s'il
      // voit cet en-tête ; sans lui il retélécharge le plan entier à chaque page.
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, no-store');
      if (payload.n) {
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(payload.n)}`);
      }
      stream.body.pipe(res);
    } catch (e: any) {
      console.error('[GET /api/storage/external]', e);
      if (res.headersSent) return res.end();
      res.status(e.status || 502).json({ error: e.message || 'Fichier indisponible' });
    }
  });
}
