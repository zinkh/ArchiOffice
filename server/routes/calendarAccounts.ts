// Point d'entrée du multi-comptes/multi-calendriers Google Calendar —
// jumeau de server/routes/mailAccounts.ts. googleCalendarSync.ts garde les
// routes de connexion (OAuth) et de sync (pull/push) ; celles-ci gèrent la
// liste des calendriers d'un compte et lequel sert de cible d'écriture.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { resolveCalendarConnection, listCalendarAccounts, setDefaultCalendar, refreshCalendarList } from '../calendarAccounts';
import { calendarAccessTokenCache } from '../mailTokenCache';
import { isInsufficientScopeError } from '../mailProviderErrors';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerCalendarAccountRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // GET /api/calendar/accounts — comptes connectés + leurs calendriers.
  app.get('/api/calendar/accounts', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      res.json(await listCalendarAccounts(supabaseAdmin, tenantId, req.user.id));
    } catch (error: any) {
      console.error('[GET /api/calendar/accounts]', error);
      res.status(500).json({ error: 'Failed to list calendar accounts' });
    }
  });

  // POST /api/calendar/accounts/:connectionId/refresh — interroge
  // calendarList chez Google et met calendar_calendars à jour (upsert par
  // external_calendar_id). Appelé automatiquement à la fin du callback OAuth,
  // et rejouable à la main si un agenda partagé a été ajouté depuis.
  app.post('/api/calendar/accounts/:connectionId/refresh', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await resolveCalendarConnection(supabaseAdmin, tenantId, req.user.id, req.params.connectionId);
      if (!connection) return res.status(404).json({ error: 'Compte introuvable' });

      await refreshCalendarList(supabaseAdmin, tenantId, req.user.id, connection);
      res.json(await listCalendarAccounts(supabaseAdmin, tenantId, req.user.id));
    } catch (error: any) {
      if (isInsufficientScopeError('google', error.status, error.data)) {
        return res.status(403).json({ error: 'Permissions insuffisantes — reconnectez ce compte.', code: 'INSUFFICIENT_SCOPE' });
      }
      console.error('[POST /api/calendar/accounts/:connectionId/refresh]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la récupération des calendriers' });
    }
  });

  // PUT /api/calendar/calendars/:id — afficher/masquer ce calendrier, le renommer, sa couleur.
  app.put('/api/calendar/calendars/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_calendars')
        .select('id, is_default').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Calendrier introuvable' });

      const patch: Record<string, unknown> = {};
      if (typeof req.body.displayName === 'string') patch.display_name = req.body.displayName.trim() || null;
      if (typeof req.body.color === 'string') patch.color = req.body.color || null;
      if (typeof req.body.syncEnabled === 'boolean') {
        // On ne peut pas masquer le calendrier qui sert de cible d'écriture
        // sans laisser le push sans destination.
        if (!req.body.syncEnabled && existing.is_default) {
          return res.status(400).json({ error: "Impossible de masquer le calendrier par défaut — choisissez d'abord un autre défaut." });
        }
        patch.sync_enabled = req.body.syncEnabled;
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
      await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_calendars').update(patch).eq('id', req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[PUT /api/calendar/calendars/:id]', error);
      res.status(500).json({ error: 'Failed to update calendar' });
    }
  });

  // POST /api/calendar/calendars/:id/default — désigne la cible d'écriture du push.
  app.post('/api/calendar/calendars/:id/default', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const ok = await setDefaultCalendar(supabaseAdmin, tenantId, req.user.id, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Calendrier introuvable' });
      res.json({ success: true });
    } catch (error: any) {
      console.error('[POST /api/calendar/calendars/:id/default]', error);
      res.status(500).json({ error: 'Failed to set default calendar' });
    }
  });

  // DELETE /api/calendar/accounts/:connectionId — déconnecte un compte
  // entier (et ses calendriers, via ON DELETE CASCADE).
  app.delete('/api/calendar/accounts/:connectionId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_connections')
        .select('id').eq('id', req.params.connectionId).eq('user_id', req.user.id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Compte introuvable' });
      await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_connections').delete().eq('id', req.params.connectionId);
      calendarAccessTokenCache.delete(req.params.connectionId);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE /api/calendar/accounts/:connectionId]', error);
      res.status(500).json({ error: 'Failed to disconnect calendar account' });
    }
  });
}
