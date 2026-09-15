// Bot Telegram — voir server/telegramBot.ts pour le rationale et le schéma
// de liaison. Trois familles de routes :
//   - POST /api/telegram/webhook   appelée par Telegram à chaque message,
//     authentifiée par le secret de webhook (jamais un JWT — Telegram n'en a
//     pas), donc listée dans server.ts's AUTH_EXEMPT.
//   - POST /api/telegram/link-code sous /api normal (JWT de l'architecte
//     connecté) : génère le code à coller dans Telegram.
//   - GET/DELETE /api/telegram/connections : gestion depuis /settings.
import type { Express } from 'express';
import {
  createLinkCode, consumeLinkCode, resolveByChatId, listConnections, revokeConnection,
  sendTelegramMessage,
} from '../telegramBot';

export interface TelegramRouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  baseUrl: string;
}

const START_LINK_RE = /^\/start\s+([A-Z0-9]{4,12})$/i;

export function registerTelegramRoutes(app: Express, { supabaseAdmin, getTenantId, baseUrl }: TelegramRouteDeps): void {
  app.post('/api/telegram/webhook', async (req: any, res: any) => {
    // Toujours 200 : Telegram réessaie indéfiniment un webhook en échec, et
    // aucune erreur de notre côté (agent inactif, jeton révoqué) ne doit
    // déclencher cette avalanche de réessais pour un message qui ne sera de
    // toute façon jamais traitable.
    res.status(200).json({ ok: true });
    try {
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
      if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) return;

      const message = req.body?.message;
      const chatId: number | undefined = message?.chat?.id;
      const text: string | undefined = message?.text;
      if (!chatId || !text) return;

      const startMatch = text.trim().match(START_LINK_RE);
      if (startMatch) {
        const result = await consumeLinkCode(supabaseAdmin, startMatch[1], chatId);
        if ('error' in result) {
          const messages: Record<string, string> = {
            invalid: "Code invalide. Générez-en un nouveau depuis ArchiOffice (Réglages → Bot Telegram).",
            expired: "Ce code a expiré. Générez-en un nouveau depuis ArchiOffice (Réglages → Bot Telegram).",
            already_linked: "Cette conversation Telegram est déjà liée à un compte ArchiOffice.",
          };
          await sendTelegramMessage(chatId, messages[result.error] || 'Liaison impossible.');
          return;
        }
        await sendTelegramMessage(chatId, "Connecté à ArchiOffice ✅ Vous pouvez maintenant écrire ou dicter vos questions ici.");
        return;
      }

      const conn = await resolveByChatId(supabaseAdmin, chatId);
      if (!conn) {
        await sendTelegramMessage(chatId, "Ce chat n'est lié à aucun compte ArchiOffice. Depuis l'application, allez dans Réglages → Bot Telegram pour obtenir un code, puis envoyez /start <code> ici.");
        return;
      }

      // Rappelle l'API interne EXACTEMENT comme le fait le serveur MCP
      // (mcp/tools.ts) : le jeton de la liaison sert de credential Bearer,
      // reconnu par le repli du middleware /api (voir server.ts), et
      // X-Tenant-Id fixe le cabinet sans avoir à le redécouvrir ici.
      const chatResponse = await fetch(`${baseUrl}/api/agents/${conn.agentId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${conn.accessToken}`,
          'X-Tenant-Id': conn.tenantId,
        },
        body: JSON.stringify({ message: text }),
      });
      const data = await chatResponse.json().catch(() => null);
      if (!chatResponse.ok) {
        await sendTelegramMessage(chatId, data?.error || "L'agent n'a pas pu répondre pour le moment.");
        return;
      }
      await sendTelegramMessage(chatId, data?.reply || '(réponse vide)');
    } catch {
      // Best-effort — voir le 200 immédiat ci-dessus.
    }
  });

  app.post('/api/telegram/link-code', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { agent_id } = req.body || {};
      if (!agent_id) return res.status(400).json({ error: 'agent_id est requis.' });
      const { data: agent } = await supabaseAdmin.from('agents').select('id').eq('id', agent_id).eq('tenant_id', tenantId).eq('is_active', true).maybeSingle();
      if (!agent) return res.status(400).json({ error: 'Agent introuvable pour ce cabinet.' });
      const { code, expiresAt } = await createLinkCode(supabaseAdmin, { tenantId, userId: req.user.id, agentId: agent_id });
      res.json({ code, expires_at: expiresAt, bot_username: process.env.TELEGRAM_BOT_USERNAME || null });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/telegram/connections', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      res.json(await listConnections(supabaseAdmin, tenantId, req.user.id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/telegram/connections/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const ok = await revokeConnection(supabaseAdmin, tenantId, req.user.id, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Connexion introuvable' });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
