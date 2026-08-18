// Google Calendar sync for the Calendrier page — distinct from the existing
// Google Contacts integration (server/routes/contactSync.ts): that flow is
// popup+PKCE with access_type=online and never requests/stores a refresh
// token (fine for a one-shot pull). Persistent, on-demand sync needs
// access_type=offline + a stored refresh token, so this follows the Zoho
// full-redirect pattern instead (server/routes/zohoInvoice.ts) — GET /auth
// returns { url } for an authenticated fetch to call (a bare navigation
// can't carry our JWT), the browser navigates there itself, and Google's
// redirect back to /callback (no JWT either) recovers who's connecting from
// the one-time state nonce (server/oauthState.ts).
//
// Unlike Zoho (one shared credential per tenant, in the `settings` table),
// each team member connects their own personal Google Calendar — so the
// connection lives in a new per-user table (calendar_connections), not
// `settings`. A second table (calendar_event_links) maps ArchiOffice
// milestones/tasks to the Google events pushed for them, so re-syncing
// updates the same event instead of creating duplicates.
//
// Sync is intentionally asymmetric:
//  - Pull (GET /events) is read-only and never persisted locally — it's
//    fetched live and merged into the Calendar page's view, with no
//    drag/edit/delete affordance attached (see Calendar.tsx). Zero risk to
//    ArchiOffice data.
//  - Push (POST /sync) treats pushed events as ArchiOffice-owned: editing a
//    pushed event directly in Google Calendar is overwritten on the next
//    sync, not merged. True two-way conflict resolution is out of scope —
//    this must stay visible in the UI copy, not just this comment.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { createOAuthState, consumeOAuthState } from '../oauthState';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function registerGoogleCalendarSyncRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  // Keyed by user_id, not a single module-level value — unlike Zoho's one
  // token per tenant, every connected user has their own.
  const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

  async function getConnection(tenantId: string, userId: string) {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_connections')
      .select('*').eq('user_id', userId).eq('provider', 'google').maybeSingle();
    return data as any;
  }

  async function getAccessToken(connection: any): Promise<string> {
    const now = Date.now();
    const cached = accessTokenCache.get(connection.user_id);
    if (cached && cached.expiresAt > now + 60000) return cached.token;

    const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID non configuré');

    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: connection.refresh_token,
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        grant_type: 'refresh_token',
      }).toString(),
    });
    const data: any = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Échec du rafraîchissement du token Google');
    accessTokenCache.set(connection.user_id, { token: data.access_token, expiresAt: now + (data.expires_in || 3600) * 1000 });
    return data.access_token;
  }

  function getRedirectUri(req: any): string {
    if (process.env.GOOGLE_CALENDAR_REDIRECT_URI) return process.env.GOOGLE_CALENDAR_REDIRECT_URI;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${proto}://${host}/api/google-calendar/callback`;
  }

  // GET /api/google-calendar/status
  app.get('/api/google-calendar/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      res.json({
        connected: !!connection,
        email: connection?.external_account_email || null,
        last_synced_at: connection?.last_synced_at || null,
      });
    } catch (error: any) {
      console.error('[GET /api/google-calendar/status]', error);
      res.status(500).json({ error: 'Failed to get Google Calendar status' });
    }
  });

  // GET /api/google-calendar/auth — returns the consent URL for an
  // authenticated fetch to call; the frontend navigates there itself.
  app.get('/api/google-calendar/auth', async (req: any, res: any) => {
    try {
      const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
      if (!clientId) return res.status(503).json({ error: 'VITE_GOOGLE_CLIENT_ID non configuré' });
      const tenantId = await getTenantId(req.user.id);
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', getRedirectUri(req));
      authUrl.searchParams.set('scope', `${GOOGLE_CALENDAR_SCOPE} email`);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('state', createOAuthState(tenantId, req.user.id));
      res.json({ url: authUrl.toString() });
    } catch (error: any) {
      console.error('[GET /api/google-calendar/auth]', error);
      res.status(500).json({ error: 'Erreur lors de la connexion à Google Calendar' });
    }
  });

  // GET /api/google-calendar/callback — no JWT on this request (Google's
  // redirect back is a bare browser navigation); tenant+user come from the
  // one-time state nonce. Registered in server.ts's AUTH_EXEMPT list.
  app.get('/api/google-calendar/callback', async (req: any, res: any) => {
    const { code, error: oauthError, state } = req.query as any;
    const consumed = consumeOAuthState(state);
    const tenantId = consumed?.tenantId;
    const userId = consumed?.userId;
    if (oauthError || !code || !tenantId || !userId) {
      return res.redirect('/calendar?google_calendar_error=1');
    }
    try {
      const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId as string,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          redirect_uri: getRedirectUri(req),
          grant_type: 'authorization_code',
        }).toString(),
      });
      const tokenData: any = await tokenResp.json();
      if (!tokenResp.ok || !tokenData.refresh_token) {
        // Google omits refresh_token on a repeat consent for an already-
        // authorized app unless prompt=consent forced a fresh grant (which
        // /auth above always sets) — so a missing token here means the
        // exchange itself failed, not a normal repeat-auth case.
        throw new Error(tokenData.error_description || tokenData.error || 'Pas de refresh_token dans la réponse Google');
      }

      let email: string | null = null;
      try {
        const userinfoResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (userinfoResp.ok) email = (await userinfoResp.json()).email || null;
      } catch { /* non-fatal — connection still works without the display email */ }

      accessTokenCache.delete(userId);
      const existing = await getConnection(tenantId, userId);
      if (existing) {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_connections').update({
          refresh_token: tokenData.refresh_token,
          access_token: tokenData.access_token,
          expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
          external_account_email: email,
          external_calendar_id: 'primary',
        }).eq('id', existing.id);
      } else {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_connections').insert({
          id: crypto.randomUUID(),
          user_id: userId,
          provider: 'google',
          refresh_token: tokenData.refresh_token,
          access_token: tokenData.access_token,
          expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
          external_account_email: email,
          external_calendar_id: 'primary',
          scopes: GOOGLE_CALENDAR_SCOPE,
        });
      }
      res.redirect('/calendar?google_calendar_connected=1');
    } catch (error: any) {
      console.error('[Google Calendar callback error]', error.message);
      res.redirect('/calendar?google_calendar_error=1');
    }
  });

  // DELETE /api/google-calendar/disconnect
  app.delete('/api/google-calendar/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      accessTokenCache.delete(req.user.id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_connections').delete().eq('user_id', req.user.id).eq('provider', 'google');
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion de Google Calendar', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE /api/google-calendar/disconnect]', error);
      res.status(500).json({ error: 'Failed to disconnect Google Calendar' });
    }
  });

  // GET /api/google-calendar/events?start=yyyy-MM-dd&end=yyyy-MM-dd — read
  // -only, fetched live from Google on every call, never persisted here.
  app.get('/api/google-calendar/events', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.json([]);
      const { start, end } = req.query as { start?: string; end?: string };
      if (!start || !end) return res.status(400).json({ error: 'start et end requis' });

      const accessToken = await getAccessToken(connection);
      const calendarId = connection.external_calendar_id || 'primary';
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('timeMin', new Date(`${start}T00:00:00Z`).toISOString());
      url.searchParams.set('timeMax', new Date(`${end}T23:59:59Z`).toISOString());
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '250');

      const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      const data: any = await resp.json();
      if (!resp.ok) throw new Error(data.error?.message || 'Échec de la récupération des événements Google');

      const events = ((data.items as any[]) || [])
        .filter(ev => ev.status !== 'cancelled')
        .map(ev => ({
          id: `google-${ev.id}`,
          title: ev.summary || '(Sans titre)',
          date: ev.start?.date || (ev.start?.dateTime ? ev.start.dateTime.slice(0, 10) : null),
        }))
        .filter(ev => !!ev.date);
      res.json(events);
    } catch (error: any) {
      console.error('[GET /api/google-calendar/events]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la récupération du calendrier Google' });
    }
  });

  // POST /api/google-calendar/sync — push only (ArchiOffice → Google), on
  // demand. Scope: milestones/tasks belonging to projects this user is a
  // member of (via project_members) — not every project in the tenant,
  // which would push unrelated colleagues' deadlines into this user's
  // personal calendar.
  app.post('/api/google-calendar/sync', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Google Calendar non connecté.' });
      const accessToken = await getAccessToken(connection);
      const calendarId = connection.external_calendar_id || 'primary';
      const eventsBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
      const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

      const { data: memberships } = await supabaseAdmin.from('project_members').select('project_id').eq('tenant_id', tenantId).eq('user_id', req.user.id);
      const projectIds: string[] = (memberships || []).map((m: any) => m.project_id);

      let pushed = 0, updated = 0, deleted = 0;
      const errors: string[] = [];

      const { data: links } = await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_event_links').select('*').eq('user_id', req.user.id).eq('provider', 'google');
      const linkByLocal = new Map<string, any>((links || []).map((l: any) => [`${l.local_type}-${l.local_id}`, l]));
      const seenLocalKeys = new Set<string>();

      if (projectIds.length > 0) {
        const [{ data: milestones }, { data: tasks }] = await Promise.all([
          supabaseAdmin.from('milestones').select('*').eq('tenant_id', tenantId).in('project_id', projectIds),
          supabaseAdmin.from('tasks').select('*').eq('tenant_id', tenantId).in('project_id', projectIds),
        ]);

        for (const m of (milestones || [])) {
          if (!m.due_date) continue;
          const localKey = `milestone-${m.id}`;
          seenLocalKeys.add(localKey);
          const body = { summary: m.title, start: { date: m.due_date }, end: { date: addOneDay(m.due_date) } };
          try {
            const link = linkByLocal.get(localKey);
            if (link) {
              const resp = await fetch(`${eventsBase}/${link.external_event_id}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
              if (!resp.ok) throw new Error((await resp.json())?.error?.message || 'PATCH failed');
              await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_event_links').update({ last_synced_at: new Date().toISOString() }).eq('id', link.id);
              updated++;
            } else {
              const resp = await fetch(eventsBase, { method: 'POST', headers, body: JSON.stringify(body) });
              const created: any = await resp.json();
              if (!resp.ok) throw new Error(created?.error?.message || 'POST failed');
              await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_event_links').insert({ id: crypto.randomUUID(), user_id: req.user.id, provider: 'google', local_type: 'milestone', local_id: m.id, external_event_id: created.id });
              pushed++;
            }
          } catch (err: any) {
            errors.push(`Jalon "${m.title}": ${err.message}`);
          }
        }

        for (const tsk of (tasks || [])) {
          if (!tsk.start_date || !tsk.end_date) continue;
          const localKey = `task-${tsk.id}`;
          seenLocalKeys.add(localKey);
          const body = { summary: tsk.title, start: { date: tsk.start_date }, end: { date: addOneDay(tsk.end_date) } };
          try {
            const link = linkByLocal.get(localKey);
            if (link) {
              const resp = await fetch(`${eventsBase}/${link.external_event_id}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
              if (!resp.ok) throw new Error((await resp.json())?.error?.message || 'PATCH failed');
              await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_event_links').update({ last_synced_at: new Date().toISOString() }).eq('id', link.id);
              updated++;
            } else {
              const resp = await fetch(eventsBase, { method: 'POST', headers, body: JSON.stringify(body) });
              const created: any = await resp.json();
              if (!resp.ok) throw new Error(created?.error?.message || 'POST failed');
              await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_event_links').insert({ id: crypto.randomUUID(), user_id: req.user.id, provider: 'google', local_type: 'task', local_id: tsk.id, external_event_id: created.id });
              pushed++;
            }
          } catch (err: any) {
            errors.push(`Tâche "${tsk.title}": ${err.message}`);
          }
        }
      }

      // Anything still linked but no longer present (deleted locally, or
      // its project left this user's membership) gets removed from Google
      // too, instead of leaving a stale event behind forever.
      for (const link of (links || [])) {
        const key = `${link.local_type}-${link.local_id}`;
        if (seenLocalKeys.has(key)) continue;
        try {
          await fetch(`${eventsBase}/${link.external_event_id}`, { method: 'DELETE', headers });
        } catch { /* event may already be gone on Google's side — proceed to drop the link either way */ }
        await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_event_links').delete().eq('id', link.id);
        deleted++;
      }

      await tenantScopedFrom(supabaseAdmin, tenantId, 'calendar_connections').update({ last_synced_at: new Date().toISOString() }).eq('id', connection.id);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Synchronisation Google Calendar (${pushed} créé(s), ${updated} mis à jour, ${deleted} supprimé(s))`, '', tenantId, 'integration', 'Intégrations');
      res.json({ pushed, updated, deleted, errors });
    } catch (error: any) {
      console.error('[POST /api/google-calendar/sync]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la synchronisation Google Calendar' });
    }
  });
}
