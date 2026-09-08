// CRUD for email_links — shared by every mail provider (Gmail, IMAP/
// Infomaniak, and any future one) so the "attach this email to this
// project/contact" action and the "already linked" list aren't duplicated
// per provider. Providers themselves (server/routes/gmailSync.ts,
// server/routes/imapMailSync.ts) only ever produce the metadata that gets
// POSTed here — they never read from or depend on this table directly.
import type { Express } from 'express';
import { tenantScopedFrom } from './tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const LOCAL_TYPES = new Set(['project', 'contact', 'tender', 'proposal']);

export function registerMailLinkRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // POST /api/mail/links — attach an external message to a local record.
  app.post('/api/mail/links', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const {
        provider, connection_id, local_type, local_id, external_message_id, external_thread_id,
        subject, snippet, from_address, to_addresses, message_date,
      } = req.body;

      if (!provider || !local_type || !local_id || !external_message_id) {
        return res.status(400).json({ error: 'provider, local_type, local_id et external_message_id requis' });
      }
      if (!LOCAL_TYPES.has(local_type)) {
        return res.status(400).json({ error: 'local_type invalide' });
      }

      // connection_id désambiguïse deux comptes du même provider (support
      // multi-comptes, migrate_multi_mail_calendar.sql) — optionnel pour ne
      // pas casser un appelant qui ne le connaîtrait pas encore, mais alors
      // deux comptes du même fournisseur pourraient se marcher dessus sur le
      // même external_message_id (Postgres traite les NULL comme distincts,
      // donc ces liens-là restent simplement libres de se répéter).
      //
      // tenantScopedFrom has no upsert() (see server/tenantScopedFrom.ts) —
      // call supabaseAdmin directly here, setting tenant_id ourselves.
      const { data, error } = await supabaseAdmin
        .from('email_links')
        .upsert({
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          user_id: req.user.id,
          provider,
          connection_id: connection_id || null,
          local_type,
          local_id,
          external_message_id,
          external_thread_id: external_thread_id || null,
          subject: subject || null,
          snippet: snippet || null,
          from_address: from_address || null,
          to_addresses: to_addresses || null,
          message_date: message_date || null,
        }, { onConflict: 'local_type,local_id,connection_id,external_message_id', ignoreDuplicates: true })
        .select()
        .maybeSingle();

      if (error) throw error;
      res.json(data || { success: true });
    } catch (error: any) {
      console.error('[POST /api/mail/links]', error.message);
      res.status(500).json({ error: error.message || "Échec du rattachement de l'email" });
    }
  });

  // GET /api/mail/links?local_type=project&local_id=... — already-linked
  // emails for one record, across every provider. No network call.
  app.get('/api/mail/links', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { local_type, local_id } = req.query as { local_type?: string; local_id?: string };
      if (!local_type || !local_id) {
        return res.status(400).json({ error: 'local_type et local_id requis' });
      }
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_links')
        .select('*')
        .eq('local_type', local_type)
        .eq('local_id', local_id)
        .order('message_date', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (error: any) {
      console.error('[GET /api/mail/links]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la récupération des emails liés' });
    }
  });

  // DELETE /api/mail/links/:id
  app.delete('/api/mail/links/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'email_links').delete().eq('id', req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE /api/mail/links/:id]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la suppression du lien' });
    }
  });
}
