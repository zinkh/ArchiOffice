// CRUD for email_folder_links (Phase 5 of Mailbox v2) — rattache un dossier
// entier (label Gmail, dossier Outlook, mailbox IMAP) à une fiche, sur le
// modèle de server/mailLinks.ts pour les messages individuels. Contrairement
// à email_links (visible par tout le tenant), la RLS ici est strictement
// personnelle : un folder_id n'est résolvable que via la connexion OAuth/
// IMAP de l'utilisateur qui l'a créé, donc chaque requête re-filtre
// explicitement par user_id — supabaseAdmin (clé service-role) contourne la
// RLS Postgres elle-même, voir server/tenantScopedFrom.ts.
import type { Express } from 'express';
import { tenantScopedFrom } from './tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const LOCAL_TYPES = new Set(['project', 'contact', 'tender', 'proposal']);
const PROVIDERS = new Set(['google', 'microsoft', 'infomaniak']);

export function registerMailFolderLinkRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // POST /api/mail/folder-links — link a whole folder/label/mailbox to a record.
  app.post('/api/mail/folder-links', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { connection_id, provider, folder_id, folder_name, local_type, local_id } = req.body;
      if (!connection_id || !provider || !folder_id || !folder_name || !local_type || !local_id) {
        return res.status(400).json({ error: 'connection_id, provider, folder_id, folder_name, local_type et local_id requis' });
      }
      if (!LOCAL_TYPES.has(local_type)) return res.status(400).json({ error: 'local_type invalide' });
      if (!PROVIDERS.has(provider)) return res.status(400).json({ error: 'provider invalide' });

      // The connection must actually belong to this user — otherwise a
      // crafted connection_id could later be resolved (the /messages proxy
      // below) into another user's mailbox token.
      const { data: connection } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
        .select('id').eq('id', connection_id).eq('user_id', req.user.id).eq('provider', provider).maybeSingle();
      if (!connection) return res.status(400).json({ error: 'Connexion introuvable.' });

      const { data, error } = await supabaseAdmin
        .from('email_folder_links')
        .upsert({
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          user_id: req.user.id,
          connection_id,
          provider,
          folder_id,
          folder_name,
          local_type,
          local_id,
        }, { onConflict: 'user_id,provider,folder_id,local_type,local_id', ignoreDuplicates: true })
        .select()
        .maybeSingle();

      if (error) throw error;
      res.json(data || { success: true });
    } catch (error: any) {
      console.error('[POST /api/mail/folder-links]', error.message);
      res.status(500).json({ error: error.message || 'Échec du rattachement du dossier' });
    }
  });

  // GET /api/mail/folder-links?local_type=project&local_id=... — folders
  // this user has linked to one record. Personal, not tenant-wide: a
  // colleague without their own connection to this mailbox wouldn't be
  // able to resolve the link anyway.
  app.get('/api/mail/folder-links', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { local_type, local_id } = req.query as { local_type?: string; local_id?: string };
      if (!local_type || !local_id) return res.status(400).json({ error: 'local_type et local_id requis' });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_folder_links')
        .select('*')
        .eq('user_id', req.user.id)
        .eq('local_type', local_type)
        .eq('local_id', local_id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (error: any) {
      console.error('[GET /api/mail/folder-links]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la récupération des dossiers liés' });
    }
  });

  // DELETE /api/mail/folder-links/:id
  app.delete('/api/mail/folder-links/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'email_folder_links').delete().eq('id', req.params.id).eq('user_id', req.user.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE /api/mail/folder-links/:id]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la suppression du lien' });
    }
  });

  // GET /api/mail/folder-links/:id/messages — resolves the link's own
  // provider/folder_id (never a client-supplied one) and 302s to that
  // provider's existing folder-scoped /messages endpoint (Phase 2) — no
  // provider-specific fetching logic duplicated here. Same-origin redirects
  // preserve the Authorization header per the fetch spec, so the browser's
  // normal apiFetch() call just works without special-casing this route.
  app.get('/api/mail/folder-links/:id/messages', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: link } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_folder_links')
        .select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
      if (!link) return res.status(404).json({ error: 'Lien introuvable.' });

      if (link.provider === 'google') return res.redirect(`/api/gmail/messages?labelId=${encodeURIComponent(link.folder_id)}`);
      if (link.provider === 'microsoft') return res.redirect(`/api/outlook/messages?folderId=${encodeURIComponent(link.folder_id)}`);
      return res.redirect(`/api/mail/imap/messages?folder=${encodeURIComponent(link.folder_id)}`);
    } catch (error: any) {
      console.error('[GET /api/mail/folder-links/:id/messages]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la résolution du dossier lié' });
    }
  });
}
