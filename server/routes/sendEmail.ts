// Phase 7 extraction — moved out of server.ts's single "/api/send-email"
// route. Uses the tenant's own SMTP settings (falling back to platform env
// vars), distinct from server/routes/registration.ts's sendPlatformMail
// (used before a tenant/its settings exist at all).
import type { Express } from 'express';
import nodemailer from 'nodemailer';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerSendEmailRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.post("/api/send-email", async (req: any, res: any) => {
    try {
      const { to, subject, text, html, attachments, userEmail } = req.body;

      // Get settings from Supabase
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!settings) {
        return res.status(500).json({ error: "Settings not found" });
      }

      const smtpHost = (settings as any).smtpHost || process.env.SMTP_HOST;
      const smtpPort = (settings as any).smtpPort || process.env.SMTP_PORT || '587';
      const smtpUser = (settings as any).smtpUser || process.env.SMTP_USER;
      const smtpPass = (settings as any).smtpPass || process.env.SMTP_PASS;

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

      const from = (settings as any).senderOption === 'personal' ? userEmail : (settings as any).email;
      const cc = (settings as any).senderOption === 'personal' ? (settings as any).email : undefined;

      await transporter.sendMail({
        from,
        to,
        cc,
        subject,
        text,
        html,
        attachments
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: "Failed to send email: " + error.message });
    }
  });
}
