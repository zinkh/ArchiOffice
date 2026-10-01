// ── API des clés d'automatisation (n8n, ou tout appelant HTTP externe) ──
// Gestion (émission, liste, révocation) des clés auto_at_ résolues par le
// middleware /api de server.ts (voir server/automationApiKeys.ts). Réservé
// aux administrateurs du cabinet — une clé d'API est un moyen d'agir avec
// les droits de la personne qui l'émet, au même titre qu'un mot de passe.
import type { Express } from 'express';
import { issueAutomationApiKey, listAutomationApiKeys, revokeAutomationApiKey } from '../automationApiKeys';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  requireTenantAdmin: (userId: string) => Promise<string>;
}

export function registerAutomationApiKeyRoutes(app: Express, { supabaseAdmin, requireTenantAdmin }: RouteDeps) {
  // GET /api/automation/api-keys — liste redactée (jamais la clé elle-même).
  app.get('/api/automation/api-keys', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      res.json(await listAutomationApiKeys(supabaseAdmin, tenantId));
    } catch (e: any) {
      console.error('[GET /api/automation/api-keys]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/automation/api-keys — { name }. La clé en clair n'est rendue
  // qu'à cet instant, jamais à nouveau ensuite.
  app.post('/api/automation/api-keys', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Nom requis' });
      const { id, key } = await issueAutomationApiKey(supabaseAdmin, tenantId, req.user.id, name);
      res.json({ id, key, name });
    } catch (e: any) {
      console.error('[POST /api/automation/api-keys]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/automation/api-keys/:id — révocation (la ligne reste, pour
  // l'historique, mais la clé cesse immédiatement de fonctionner).
  app.delete('/api/automation/api-keys/:id', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const ok = await revokeAutomationApiKey(supabaseAdmin, tenantId, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Clé introuvable' });
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/automation/api-keys/:id]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
