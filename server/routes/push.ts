// Routes des notifications poussées : abonnements Web Push, préférences par
// personne, et la file que le client Electron vient vider (voir server/push.ts
// pour le raisonnement sur les deux transports).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { notifyUsers, webPushPublicKey, isWebPushConfigured } from '../push';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

// Une notification vieille de plusieurs jours n'a plus rien à annoncer : un
// poste rallumé après une semaine de congés ferait sinon apparaître d'un coup
// des dizaines de bulles système périmées.
const DESKTOP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DESKTOP_BATCH = 10;

export function registerPushRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // La clé publique VAPID est publique par construction (elle voyage dans
  // chaque requête d'abonnement). La servir ici plutôt que de l'injecter au
  // build évite de reconstruire le bundle pour la faire tourner, et laisse
  // une instance auto-hébergée fonctionner sans clé du tout.
  app.get('/api/push/config', (_req: any, res: any) => {
    res.json({ configured: isWebPushConfigured(), publicKey: webPushPublicKey() });
  });

  app.post('/api/push/subscribe', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { endpoint, keys } = req.body || {};
      if (typeof endpoint !== 'string' || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: 'Abonnement incomplet' });
      }
      // L'endpoint est appelé plus tard par le serveur : le contraindre à
      // https évite qu'un client fasse pointer le service d'envoi vers un
      // schéma arbitraire.
      let parsed: URL;
      try {
        parsed = new URL(endpoint);
      } catch {
        return res.status(400).json({ error: 'Endpoint invalide' });
      }
      if (parsed.protocol !== 'https:') {
        return res.status(400).json({ error: 'Endpoint invalide' });
      }

      // Conflit sur l'endpoint plutôt que sur (user, appareil) : c'est le
      // service de push qui en est propriétaire, et un même navigateur peut
      // changer de compte ArchiOffice. La ligne suit alors le dernier
      // utilisateur connecté sur cet appareil.
      const { error } = await supabaseAdmin
        .from('push_subscriptions')
        .upsert({
          tenant_id: tenantId,
          user_id: req.user.id,
          endpoint,
          p256dh: String(keys.p256dh),
          auth: String(keys.auth),
          user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
          created_at: new Date().toISOString(),
        }, { onConflict: 'endpoint' });
      if (error) throw error;

      res.status(201).json({ success: true });
    } catch (err: any) {
      console.error('[POST /api/push/subscribe]', err);
      res.status(500).json({ error: "Abonnement impossible" });
    }
  });

  app.post('/api/push/unsubscribe', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { endpoint } = req.body || {};
      if (typeof endpoint !== 'string') return res.status(400).json({ error: 'Endpoint requis' });
      // Scopé à l'utilisateur : un client ne peut désabonner que ses propres
      // appareils, pas ceux d'un collègue dont il devinerait l'endpoint.
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'push_subscriptions')
        .delete()
        .eq('user_id', req.user.id)
        .eq('endpoint', endpoint);
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      console.error('[POST /api/push/unsubscribe]', err);
      res.status(500).json({ error: "Désabonnement impossible" });
    }
  });

  app.get('/api/push/preferences', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const [{ data: profile }, { count }] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'profiles')
          .select('notification_prefs').eq('id', req.user.id).maybeSingle(),
        tenantScopedFrom(supabaseAdmin, tenantId, 'push_subscriptions')
          .select('id', { count: 'exact', head: true }).eq('user_id', req.user.id),
      ]);
      const prefs = (profile as any)?.notification_prefs || {};
      res.json({
        muted: Array.isArray(prefs.muted) ? prefs.muted : [],
        devices: count || 0,
        configured: isWebPushConfigured(),
      });
    } catch (err: any) {
      console.error('[GET /api/push/preferences]', err);
      res.status(500).json({ error: "Préférences illisibles" });
    }
  });

  app.put('/api/push/preferences', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const muted = Array.isArray(req.body?.muted)
        ? [...new Set(req.body.muted.map((c: unknown) => String(c)).filter(Boolean))].slice(0, 50)
        : [];
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles')
        .update({ notification_prefs: { muted } })
        .eq('id', req.user.id);
      if (error) throw error;
      res.json({ success: true, muted });
    } catch (err: any) {
      console.error('[PUT /api/push/preferences]', err);
      res.status(500).json({ error: "Enregistrement impossible" });
    }
  });

  // Sert à vérifier toute la chaîne depuis les réglages, sans attendre qu'une
  // alerte métier se déclenche d'elle-même.
  app.post('/api/push/test', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await notifyUsers(supabaseAdmin, tenantId, [req.user.id], {
        title: 'ArchiOffice',
        body: "Notification de test — la chaîne fonctionne.",
        url: '/notifications',
        tag: 'archioffice-test',
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error('[POST /api/push/test]', err);
      res.status(500).json({ error: "Envoi de test impossible" });
    }
  });

  // Le client Electron interroge cette route : il n'a pas de service de push
  // pour le réveiller, donc c'est lui qui vient chercher. Les lignes rendues
  // sont marquées livrées dans la foulée pour ne jamais sonner deux fois, y
  // compris si deux postes du même compte interrogent en même temps.
  app.get('/api/notifications/pending', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const since = new Date(Date.now() - DESKTOP_MAX_AGE_MS).toISOString();

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notification_outbox')
        .select('id, title, body, url, category, tag, created_at')
        .eq('user_id', req.user.id)
        .is('desktop_delivered_at', null)
        .gt('created_at', since)
        .order('created_at', { ascending: false })
        .limit(DESKTOP_BATCH);
      if (error) throw error;

      const rows = (data || []) as any[];
      if (rows.length) {
        await supabaseAdmin
          .from('notification_outbox')
          .update({ desktop_delivered_at: new Date().toISOString() })
          .in('id', rows.map(r => r.id));
      }
      res.json(rows);
    } catch (err: any) {
      console.error('[GET /api/notifications/pending]', err);
      res.json([]);
    }
  });
}
