// ── API des webhooks sortants (ArchiOffice → n8n, IFTTT Webhooks/Maker) ──
// CRUD des abonnements, envoi de test, journal d'envoi et rejeu d'une
// livraison en échec. Réservé aux administrateurs du cabinet, sur le même
// principe que les clés d'automatisation (automationApiKeys.ts) : une
// cible de webhook reçoit des données du cabinet à chaque évènement.
import type { Express } from 'express';
import crypto from 'crypto';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertPublicHttpUrl } from '../ssrfGuard';
import { encryptSecret } from '../secretsCrypto';
import { WEBHOOK_EVENT_TYPES, WEBHOOK_EVENT_CODES } from '../webhookEvents';
import { retryWebhookDelivery, sendTestPing } from '../webhookDispatch';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  requireTenantAdmin: (userId: string) => Promise<string>;
}

function validateEventTypes(input: unknown): string[] | null {
  if (!Array.isArray(input) || !input.length) return null;
  const types = input.map(String);
  if (!types.every(t => WEBHOOK_EVENT_CODES.has(t))) return null;
  return types;
}

function toPublicWebhook(row: any) {
  return {
    id: row.id,
    name: row.name,
    targetUrl: row.target_url,
    eventTypes: row.event_types,
    enabled: row.enabled,
    createdAt: row.created_at,
    lastTriggeredAt: row.last_triggered_at,
    lastStatus: row.last_status,
  };
}

export function registerWebhookRoutes(app: Express, { supabaseAdmin, requireTenantAdmin }: RouteDeps) {
  // GET /api/webhooks/event-types — catalogue affiché dans /settings.
  app.get('/api/webhooks/event-types', async (req: any, res: any) => {
    try {
      await requireTenantAdmin(req.user.id);
      res.json(WEBHOOK_EVENT_TYPES);
    } catch (e: any) {
      console.error('[GET /api/webhooks/event-types]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/webhooks — liste (le secret n'est jamais réchoué).
  app.get('/api/webhooks', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'webhooks')
        .select('*').order('created_at', { ascending: false });
      if (error) throw error;
      res.json((data || []).map(toPublicWebhook));
    } catch (e: any) {
      console.error('[GET /api/webhooks]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/webhooks — { name, targetUrl, eventTypes }. Le secret de
  // signature n'est rendu qu'à la création (comme la clé d'automatisation),
  // pour que l'architecte le copie dans son nœud n8n/IFTTT à cet instant.
  app.post('/api/webhooks', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Nom requis' });
      const eventTypes = validateEventTypes(req.body?.eventTypes);
      if (!eventTypes) return res.status(400).json({ error: 'eventTypes invalide' });
      let targetUrl: string;
      try {
        targetUrl = (await assertPublicHttpUrl(req.body?.targetUrl)).toString();
      } catch (err: any) {
        return res.status(err?.status || 400).json({ error: err?.message || 'URL invalide' });
      }

      const secret = crypto.randomBytes(24).toString('base64url');
      const id = crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'webhooks').insert({
        id, name, target_url: targetUrl, event_types: eventTypes, enabled: true,
        secret_encrypted: encryptSecret(secret), created_by: req.user.id,
      }).select().single();
      if (error) throw error;
      res.json({ ...toPublicWebhook(data), secret });
    } catch (e: any) {
      console.error('[POST /api/webhooks]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/webhooks/:id — { name?, targetUrl?, eventTypes?, enabled? }.
  app.put('/api/webhooks/:id', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (req.body?.name !== undefined) patch.name = String(req.body.name).trim();
      if (req.body?.enabled !== undefined) patch.enabled = !!req.body.enabled;
      if (req.body?.eventTypes !== undefined) {
        const eventTypes = validateEventTypes(req.body.eventTypes);
        if (!eventTypes) return res.status(400).json({ error: 'eventTypes invalide' });
        patch.event_types = eventTypes;
      }
      if (req.body?.targetUrl !== undefined) {
        try {
          patch.target_url = (await assertPublicHttpUrl(req.body.targetUrl)).toString();
        } catch (err: any) {
          return res.status(err?.status || 400).json({ error: err?.message || 'URL invalide' });
        }
      }
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'webhooks')
        .update(patch).eq('id', req.params.id).select().single();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Webhook introuvable' });
      res.json(toPublicWebhook(data));
    } catch (e: any) {
      console.error('[PUT /api/webhooks/:id]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/webhooks/:id
  app.delete('/api/webhooks/:id', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'webhooks').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/webhooks/:id]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/webhooks/:id/test — envoie un évènement ping factice, pour
  // vérifier la configuration côté n8n/IFTTT sans attendre un vrai évènement.
  app.post('/api/webhooks/:id/test', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const result = await sendTestPing(supabaseAdmin, tenantId, req.params.id);
      if (!result) return res.status(404).json({ error: 'Webhook introuvable' });
      res.json(result);
    } catch (e: any) {
      console.error('[POST /api/webhooks/:id/test]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/webhooks/:id/deliveries — journal d'envoi (20 dernières tentatives).
  app.get('/api/webhooks/:id/deliveries', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'webhook_deliveries')
        .select('id, event_type, status, http_status, last_error, attempt_count, delivered_at, created_at')
        .eq('webhook_id', req.params.id).order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      console.error('[GET /api/webhooks/:id/deliveries]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/webhooks/:id/deliveries/:deliveryId/retry
  app.post('/api/webhooks/:id/deliveries/:deliveryId/retry', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const result = await retryWebhookDelivery(supabaseAdmin, tenantId, req.params.deliveryId);
      if (!result) return res.status(404).json({ error: 'Livraison introuvable' });
      res.json(result);
    } catch (e: any) {
      console.error('[POST /api/webhooks/:id/deliveries/:deliveryId/retry]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
