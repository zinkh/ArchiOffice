// Phase 7 extraction — moved out of server.ts's Settings section, plus the
// neighboring POST /api/test-smtp (SMTP config verification, thematically
// part of Settings even though it never touches the settings table itself).
import type { Express } from 'express';
import nodemailer from 'nodemailer';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  requireTenantAdmin: (userId: string) => Promise<string>;
}

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
  onboardingCompletedAt: 'onboarding_completed_at',
  defaultLeaveDaysCongesPayes: 'default_leave_days_conges_payes',
  defaultLeaveDaysRtt: 'default_leave_days_rtt',
  architectName: 'architect_name', oaNumber: 'oa_number',
};
const toCamel: Record<string, string> = Object.fromEntries(Object.entries(toSnake).map(([k, v]) => [v, k]));

export function registerSettingsRoutes(app: Express, { supabaseAdmin, getTenantId, requireTenantAdmin }: RouteDeps) {
  app.get("/api/settings", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!settings) { res.json({ tenant_id: tenantId }); return; }
      // Return camelCase keys expected by the frontend
      const out: any = {};
      for (const [k, v] of Object.entries(settings)) {
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
      ]);
      const numericCols = new Set(['maf_taux_contrat_permil', 'maf_declaration_year', 'default_leave_days_conges_payes', 'default_leave_days_rtt']);
      const filteredData: any = Object.fromEntries(
        Object.entries(snakeData)
          .filter(([k]) => validCols.has(k))
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

  app.post("/api/test-smtp", async (req, res) => {
    try {
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
      res.status(500).json({ error: error.message });
    }
  });
}
