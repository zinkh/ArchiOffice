// Phase 7 extraction — moved out of server.ts's Settings section, plus the
// neighboring POST /api/test-smtp (SMTP config verification, thematically
// part of Settings even though it never touches the settings table itself).
import type { Express } from 'express';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import { streamTenantExport } from '../tenantExport';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  requireTenantAdmin: (userId: string) => Promise<string>;
}

// Never echo these back to the browser: GET /api/settings is reachable by any
// tenant member, not just admins, and these columns hold live SMTP/OAuth/API
// credentials in plaintext.
const SECRET_COLS = new Set([
  'smtp_pass', 'zoho_client_secret', 'zoho_refresh_token', 'zoho_books_refresh_token', 'ragic_api_key',
  'odoo_api_key', 'superpdp_client_secret', 'chorus_pro_piste_client_secret',
  'chorus_pro_technical_password',
]);

// SMTP test emails can be triggered by any tenant admin config change attempt;
// cap it so the server can't be turned into an open mail relay probe.
const testSmtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Veuillez réessayer plus tard.' },
});

// camelCase (frontend) ↔ snake_case (Supabase settings table)
const toSnake: Record<string, string> = {
  agencyName: 'agency_name', vatNumber: 'vat_number',
  senderOption: 'sender_option', defaultEmailTemplate: 'default_email_template',
  logoUrl: 'logo_url', smtpHost: 'smtp_host', smtpPort: 'smtp_port',
  smtpUser: 'smtp_user', smtpPass: 'smtp_pass',
  numPrefixDevis: 'num_prefix_devis',
  numPrefixFacture: 'num_prefix_facture',
  numPrefixHonoraires: 'num_prefix_honoraires',
  numPrefixAffaire: 'num_prefix_affaire',
  numAffaireSepPrefix: 'num_affaire_sep_prefix',
  numAffaireSepSeq: 'num_affaire_sep_seq',
  numAffaireDigits: 'num_affaire_digits',
  onboardingCompletedAt: 'onboarding_completed_at',
  defaultLeaveDaysCongesPayes: 'default_leave_days_conges_payes',
  defaultLeaveDaysRtt: 'default_leave_days_rtt',
  architectName: 'architect_name', oaNumber: 'oa_number',
  notificationArchiveDays: 'notification_archive_days',
};
const toCamel: Record<string, string> = Object.fromEntries(Object.entries(toSnake).map(([k, v]) => [v, k]));

export function registerSettingsRoutes(app: Express, { supabaseAdmin, getTenantId, requireTenantAdmin }: RouteDeps) {
  app.get("/api/settings", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!settings) { res.json({ tenant_id: tenantId }); return; }
      // Return camelCase keys expected by the frontend, minus stored secrets
      // (only whether one is set, so the UI can show "configured").
      const out: any = {};
      for (const [k, v] of Object.entries(settings)) {
        if (SECRET_COLS.has(k)) {
          out[`${toCamel[k] ?? k}Set`] = v != null && v !== '';
          continue;
        }
        out[toCamel[k] ?? k] = v;
      }
      res.json(out);
    } catch (error) {
      console.error("[GET /api/settings]", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.put("/api/settings", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const data = req.body;
      // Convert camelCase → snake_case
      const snakeData: any = {};
      for (const [k, v] of Object.entries(data)) {
        const col = toSnake[k] ?? k;
        snakeData[col] = v;
      }
      // Only keep valid table columns (exclude id — managed separately)
      const validCols = new Set([
        'agency_name', 'address', 'phone', 'email', 'siret', 'ape', 'vat_number',
        'currency', 'language', 'sender_option', 'default_email_template', 'logo_url',
        'seller_iban', 'seller_bic',
        'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass',
        'zoho_client_id', 'zoho_client_secret', 'zoho_org_id', 'zoho_data_center', 'zoho_refresh_token',
        'zoho_books_org_id',
        'num_prefix_devis', 'num_prefix_facture', 'num_prefix_honoraires', 'num_prefix_affaire',
        'num_affaire_sep_prefix', 'num_affaire_sep_seq', 'num_affaire_digits',
        'onboarding_completed_at',
        'maf_enabled', 'maf_numero_adherent', 'maf_taux_contrat_permil', 'maf_declaration_year',
        'ragic_api_key', 'ragic_account',
        'ragic_sheet_contacts', 'ragic_sheet_projects', 'ragic_sheet_invoices', 'ragic_sheet_proposals',
        'odoo_url', 'odoo_db', 'odoo_username', 'odoo_api_key',
        'superpdp_client_id', 'superpdp_client_secret', 'superpdp_sandbox',
        'chorus_pro_piste_client_id', 'chorus_pro_piste_client_secret',
        'chorus_pro_technical_login', 'chorus_pro_technical_password', 'chorus_pro_sandbox',
        'default_leave_days_conges_payes', 'default_leave_days_rtt',
        'architect_name', 'oa_number',
        'notification_archive_days',
        'tender_boamp_enabled', 'tender_ted_enabled',
      ]);
      const numericCols = new Set(['maf_taux_contrat_permil', 'maf_declaration_year', 'default_leave_days_conges_payes', 'default_leave_days_rtt', 'num_affaire_digits']);
      const filteredData: any = Object.fromEntries(
        Object.entries(snakeData)
          .filter(([k]) => validCols.has(k))
          // GET no longer echoes secret values back to the client (see SECRET_COLS),
          // so the round-tripped form submits them blank on every save unless the
          // admin is deliberately setting a new one — an empty secret must not
          // clobber the value already stored.
          .filter(([k, v]) => !(SECRET_COLS.has(k) && (v === '' || v == null)))
          .map(([k, v]) => [k, numericCols.has(k) && v === '' ? null : v])
      );

      if (Object.keys(filteredData).length === 0) { res.json({ success: true }); return; }

      // Check if row already exists for this tenant
      const { data: existing } = await supabaseAdmin
        .from('settings')
        .select('id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      // A column can be in validCols (known to this server build) but still missing from
      // the DB if its migration hasn't been applied there yet (has happened before — see
      // PR #55). Rather than hard-failing the whole save, drop the offending column(s)
      // reported by Postgres and retry, so unrelated fields still get saved.
      const droppedCols: string[] = [];
      let saveError: any;
      for (let attempt = 0; attempt < 20 && Object.keys(filteredData).length > 0; attempt++) {
        if (existing) {
          const { error } = await supabaseAdmin
            .from('settings')
            .update(filteredData)
            .eq('tenant_id', tenantId);
          saveError = error;
        } else {
          const { error } = await supabaseAdmin
            .from('settings')
            .insert({ ...filteredData, id: crypto.randomUUID(), tenant_id: tenantId });
          saveError = error;
        }
        if (!saveError) break;
        const missingCol = saveError.code === '42703' ? /column "([^"]+)"/.exec(saveError.message)?.[1] : undefined;
        if (!missingCol || !(missingCol in filteredData)) break;
        delete filteredData[missingCol];
        droppedCols.push(missingCol);
      }
      if (droppedCols.length) {
        console.warn(`[Settings] Column(s) missing in DB, migration likely pending — dropped from save: ${droppedCols.join(', ')}`);
      }

      if (saveError) throw saveError;
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating settings:", error);
      res.status(error.status || 500).json({ error: error.status ? error.message : "Failed to update settings: " + error.message });
    }
  });

  // Archivage — export complet et exploitable de toute l'activité du cabinet
  // (données + fichiers) en une archive ZIP téléchargeable. À utiliser avant
  // une demande de fermeture de cabinet (ci-dessous) pour conserver ce que
  // la loi impose (comptabilité : 10 ans) ou ce que le cabinet souhaite garder.
  app.get("/api/settings/tenant-export", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { data: tenant } = await supabaseAdmin.from('tenants').select('name').eq('id', tenantId).single();
      await streamTenantExport(supabaseAdmin, tenantId, (tenant as any)?.name || 'cabinet', res);
    } catch (error: any) {
      console.error("[GET /api/settings/tenant-export]", error);
      if (!res.headersSent) {
        res.status(error.status || 500).json({ error: error.status ? error.message : "Failed to export tenant data" });
      }
    }
  });

  // RGPD — fermeture de cabinet (droit à l'effacement au niveau du tenant) :
  // demande réversible avec délai de grâce de 30 jours avant purge
  // automatisée définitive de tout le tenant (server/tenantPurge.ts).
  app.get("/api/settings/tenant-deletion", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { data } = await supabaseAdmin.from('tenants').select('deletion_requested_at').eq('id', tenantId).single();
      res.json({ deletion_requested_at: (data as any)?.deletion_requested_at || null, grace_period_days: 30 });
    } catch (error: any) {
      console.error("[GET /api/settings/tenant-deletion]", error);
      res.status(error.status || 500).json({ error: error.status ? error.message : "Failed to fetch deletion status" });
    }
  });

  app.post("/api/settings/tenant-deletion", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const now = new Date().toISOString();
      const { error } = await supabaseAdmin.from('tenants').update({ deletion_requested_at: now, deletion_requested_by: req.user.id }).eq('id', tenantId);
      if (error) throw error;
      res.json({ success: true, deletion_requested_at: now });
    } catch (error: any) {
      console.error("[POST /api/settings/tenant-deletion]", error);
      res.status(error.status || 500).json({ error: error.status ? error.message : "Failed to request tenant deletion" });
    }
  });

  app.delete("/api/settings/tenant-deletion", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { error } = await supabaseAdmin.from('tenants').update({ deletion_requested_at: null, deletion_requested_by: null }).eq('id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (error: any) {
      console.error("[DELETE /api/settings/tenant-deletion]", error);
      res.status(error.status || 500).json({ error: error.status ? error.message : "Failed to cancel tenant deletion" });
    }
  });

  app.post("/api/test-smtp", testSmtpLimiter, async (req: any, res) => {
    try {
      await requireTenantAdmin(req.user.id);
      const { smtpHost, smtpPort, smtpUser, smtpPass } = req.body;

      if (!smtpHost || !smtpUser || !smtpPass) {
        return res.status(400).json({ error: "Missing SMTP configuration" });
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(String(smtpPort) || '587'),
        secure: String(smtpPort) === '465',
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await transporter.sendMail({
        from: `"ArchiOffice Test" <${smtpUser}>`,
        to: smtpUser,
        subject: "ArchiOffice SMTP Test",
        text: "This is a test email from ArchiOffice to verify your SMTP configuration.",
        html: "<b>This is a test email from ArchiOffice to verify your SMTP configuration.</b>"
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("SMTP Test Error:", error);
      res.status(error.status || 500).json({ error: error.message });
    }
  });
}
