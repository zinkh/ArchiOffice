// Phase 7 extraction — moved out of server.ts's single "/api/send-email"
// route. Uses the tenant's own SMTP settings (falling back to platform env
// vars), distinct from server/routes/registration.ts's sendPlatformMail
// (used before a tenant/its settings exist at all).
//
// Since the multi-comptes mail support (server/mailAccounts.ts), this route
// first tries the caller's own default connected mailbox (Gmail, Outlook, or
// IMAP with its own SMTP) before falling back to the cabinet's SMTP below —
// so a facture/devis/relance envoyée depuis /invoices, /proposals etc. part
// de l'adresse personnelle de l'utilisateur quand il en a connecté une,
// exactement comme s'il l'avait envoyée à la main depuis sa boîte.
// Attachments aren't supported on that path yet (nodemailer's `attachments`
// shape isn't normalized across providers) — a caller passing attachments
// still goes straight to the cabinet SMTP below, après avoir été réduites à de
// simples octets (server/emailAttachments.ts).
import type { Express } from 'express';
import nodemailer from 'nodemailer';
import { sendEmailLimiter } from '../rateLimit';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { sendViaAccount } from '../mailSend';
import { sanitizeEmailAttachments } from '../emailAttachments';
import { resolveEmailSender } from '../emailSender';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerSendEmailRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.post("/api/send-email", sendEmailLimiter, async (req: any, res: any) => {
    try {
      const { to, subject, text, html } = req.body;
      const hasCrlf = (v: unknown): boolean =>
        Array.isArray(v) ? v.some(hasCrlf) : typeof v === 'string' && /[\r\n]/.test(v);
      if (hasCrlf(to) || hasCrlf(subject)) {
        return res.status(400).json({ error: "Invalid characters in email fields" });
      }

      // Jamais de `attachments` brut vers nodemailer : il lirait `path`/`href`
      // (fichiers du serveur, réseau interne). Voir server/emailAttachments.ts.
      const safe = sanitizeEmailAttachments(req.body.attachments);
      if (!safe.ok) return res.status(400).json({ error: safe.error });
      const attachments = safe.attachments;

      const tenantId = await getTenantId(req.user.id);

      if (!attachments.length) {
        const { data: defaultAccount } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
          .select('*').eq('user_id', req.user.id).eq('is_default', true).maybeSingle();
        if (defaultAccount) {
          try {
            const result = await sendViaAccount(supabaseAdmin, defaultAccount, { to, subject, text, html });
            return res.json({ success: true, id: result.id, via: defaultAccount.provider });
          } catch (err: any) {
            // Le compte par défaut ne peut pas envoyer (IMAP sans SMTP
            // propre, ou jeton révoqué) — repli sur le SMTP du cabinet
            // ci-dessous plutôt que de bloquer l'envoi du document.
            console.warn('[send-email] Envoi via le compte par défaut impossible, repli SMTP cabinet:', err.message);
          }
        }
      }

      // Get settings from Supabase
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!settings) {
        return res.status(500).json({ error: "Settings not found" });
      }

      // `settings` is a raw select('*') row — snake_case DB columns, not the
      // camelCase shape GET /api/settings maps them to for the frontend.
      const smtpHost = (settings as any).smtp_host || process.env.SMTP_HOST;
      const smtpPort = (settings as any).smtp_port || process.env.SMTP_PORT || '587';
      const smtpUser = (settings as any).smtp_user || process.env.SMTP_USER;
      const smtpPass = (settings as any).smtp_pass || process.env.SMTP_PASS;

      if (!smtpHost || !smtpUser || !smtpPass) {
        return res.status(500).json({ error: "Configuration SMTP manquante" });
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(String(smtpPort)),
        secure: String(smtpPort) === '465',
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      // L'expéditeur est résolu côté serveur (server/emailSender.ts) : l'adresse
      // personnelle propre à CE cabinet, jamais une adresse envoyée par le client.
      const sender = await resolveEmailSender(supabaseAdmin, { tenantId, userId: req.user.id, settings });

      await transporter.sendMail({
        from: sender.from,
        to,
        cc: sender.cc,
        replyTo: sender.replyTo,
        subject,
        text,
        html,
        attachments: attachments.length ? attachments : undefined,
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: "Failed to send email: " + error.message });
    }
  });
}
