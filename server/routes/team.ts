// Phase 7 extraction — moved out of server.ts's Team + "join-requests"
// section, plus the neighboring GET /api/me. The RBAC helpers this section
// used to define (requireTenantAdmin, isAdmin, requireManagerOf,
// resolveReportIds, businessDaysBetween) stay in server.ts, since
// timeTracking.ts and leave.ts already depend on them being injected the
// same way (same dependency-injection approach established at lot 8) —
// moving the routes doesn't require moving those helpers.
import type { Express } from 'express';
import nodemailer from 'nodemailer';
import { validateBody } from '../../src/lib/validateRequest';
import { createTeamMemberSchema, updateTeamMemberRoleSchema } from '../../src/schemas/team.schema';
import { isSuperAdmin } from '../superAdminAuth';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  requireTenantAdmin: (userId: string) => Promise<string>;
  checkQuota: (tenantId: string, resource: 'projects' | 'users' | 'documents') => Promise<void>;
}

export function registerTeamRoutes(app: Express, { supabaseAdmin, getTenantId, requireTenantAdmin, checkQuota }: RouteDeps) {
  app.get("/api/team", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('profiles').select('id, name, email, role, system_role, manager_id, avatar, sender_option, default_email_template, phone, address, job_title, department').eq('tenant_id', tenantId);
      if (error) throw error;
      res.json((data || []).map((p: any) => ({
        ...p,
        senderOption: p.sender_option,
        defaultEmailTemplate: p.default_email_template,
        jobTitle: p.job_title,
      })));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch team" }); }
  });

  app.get("/api/me", async (req: any, res: any) => {
    try {
      const { data, error } = await supabaseAdmin.from('profiles').select('id, tenant_id, name, email, role, system_role, manager_id, avatar, sender_option, default_email_template, phone, address, job_title, department').eq('id', req.user.id).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (!data) return res.json(null);
      res.json({
        ...data,
        tenantId: data.tenant_id,
        senderOption: data.sender_option,
        defaultEmailTemplate: data.default_email_template,
        jobTitle: data.job_title,
        // Platform back-office access — an orthogonal, cross-tenant concept
        // from system_role (see server/superAdminAuth.ts). Drives whether the
        // frontend renders the /admin back-office link at all.
        isSuperAdmin: await isSuperAdmin(supabaseAdmin, req.user),
      });
    } catch (e: any) {
      console.error("[GET /api/me]", e); res.status(500).json({ error: "Failed to fetch profile" }); }
  });

  app.put("/api/team/:id", async (req: any, res: any) => {
    try {
      // Self-service profile edit — anyone else's profile requires admin rights
      const tenantId = req.params.id === req.user.id
        ? await getTenantId(req.user.id)
        : await requireTenantAdmin(req.user.id);
      const { senderOption, defaultEmailTemplate, phone, address, jobTitle, department, avatar } = req.body;
      const { data, error } = await supabaseAdmin.from('profiles').update({
        sender_option: senderOption,
        default_email_template: defaultEmailTemplate,
        phone: phone || null,
        address: address || null,
        job_title: jobTitle || null,
        department: department || null,
        ...(avatar !== undefined ? { avatar: avatar || null } : {}),
      }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error("[PUT /api/team/:id]", e); res.status(e.status || 500).json({ error: e.status ? e.message : "Failed to update profile: " + e.message }); }
  });

  app.post("/api/team", validateBody(createTeamMemberSchema), async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      await checkQuota(tenantId, 'users');
      const { name, email, role, system_role } = req.body;
      // Check if user already exists in this tenant
      const { data: existing } = await supabaseAdmin.from('profiles').select('id').eq('email', email).eq('tenant_id', tenantId).maybeSingle();
      if (existing) return res.status(400).json({ error: "User with this email already exists" });
      const password = Math.random().toString(36).slice(-8);
      // Create Supabase Auth user
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({ email, password, user_metadata: { name }, email_confirm: true });
      if (authErr || !authData?.user) return res.status(500).json({ error: authErr?.message || "Failed to create auth user" });
      const id = authData.user.id;
      await supabaseAdmin.from('profiles').upsert({ id, tenant_id: tenantId, name, email, role: role || 'Member', system_role: system_role || 'user' });
      // Send email
      let emailSent = false;
      let emailError: string | null = null;
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      // Tenant's own SMTP first (raw snake_case columns — this is NOT the camelCase
      // shape /api/settings returns), falling back to the platform's SMTP env vars
      // so invites still go out for a brand-new tenant that hasn't configured SMTP yet.
      const smtpHost = (settings as any)?.smtp_host || process.env.SMTP_HOST;
      const smtpPort = (settings as any)?.smtp_port || process.env.SMTP_PORT || '587';
      const smtpUser = (settings as any)?.smtp_user || process.env.SMTP_USER;
      const smtpPass = (settings as any)?.smtp_pass || process.env.SMTP_PASS;

      console.log(`[Team Creation] Attempting to send email to ${email} using host ${smtpHost}:${smtpPort}`);

      if (smtpHost && smtpUser && smtpPass) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(String(smtpPort)),
            secure: String(smtpPort) === '465',
            auth: {
              user: smtpUser,
              pass: smtpPass,
            },
          });

          const appUrl = process.env.APP_URL || 'http://localhost:3000';

          await transporter.sendMail({
            from: `"ArchiOffice" <${smtpUser}>`,
            to: email,
            subject: "Your ArchiOffice Credentials",
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #2563eb;">Welcome to ArchiOffice</h2>
                <p>Hello ${name},</p>
                <p>An account has been created for you on ArchiOffice. Here are your credentials to access the application:</p>
                <div style="background: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
                  <p style="margin: 0;"><strong>Login URL:</strong> <a href="${appUrl}">${appUrl}</a></p>
                  <p style="margin: 10px 0 0 0;"><strong>Email:</strong> ${email}</p>
                  <p style="margin: 5px 0 0 0;"><strong>Temporary Password:</strong> ${password}</p>
                </div>
                <p>Please change your password after your first login.</p>
                <p style="color: #64748b; font-size: 14px; margin-top: 30px;">Best regards,<br>The ArchiOffice Team</p>
              </div>
            `
          });
          console.log(`Credentials email sent to ${email}`);
          emailSent = true;
        } catch (err: any) {
          console.error("[Team Creation] Failed to send credentials email:", err);
          emailError = err.message;
        }
      } else {
        const missing: string[] = [];
        if (!smtpHost) missing.push('smtpHost');
        if (!smtpUser) missing.push('smtpUser');
        if (!smtpPass) missing.push('smtpPass');
        console.warn(`[Team Creation] SMTP settings missing (${missing.join(', ')}), skipping credentials email.`);
        emailError = `Configuration SMTP manquante : ${missing.join(', ')}`;
      }

      res.status(201).json({ id, name, email, role, system_role, emailSent, emailError });
    } catch (error: any) {
      console.error("Error creating team member:", error);
      res.status(error.status || 500).json({ error: error.message || "Failed to create team member" });
    }
  });

  app.put("/api/team/:id/role", validateBody(updateTeamMemberRoleSchema), async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { id } = req.params;
      const { role } = req.body;
      const { error } = await supabaseAdmin.from('profiles').update({ system_role: role }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error updating user role:", e);
      res.status(e.status || 500).json({ error: e.status ? e.message : "Failed to update role" });
    }
  });

  app.put("/api/team/:id/manager", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { id } = req.params;
      const { manager_id } = req.body;
      const { error } = await supabaseAdmin.from('profiles').update({ manager_id: manager_id || null }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error updating user manager:", e);
      res.status(e.status || 500).json({ error: e.status ? e.message : "Failed to update manager" });
    }
  });

  app.get("/api/team/join-requests", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('join_requests')
        .select('id, email, name, created_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      console.error("[GET /api/team/join-requests]", e); res.status(e.status || 500).json({ error: e.message }); }
  });

  app.post("/api/team/join-requests/:id/approve", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { data: request } = await supabaseAdmin.from('join_requests').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).eq('status', 'pending').single();
      if (!request) return res.status(404).json({ error: 'Demande introuvable' });

      await checkQuota(tenantId, 'users');

      const { data: existingProfile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', request.user_id).single();
      if (existingProfile?.tenant_id) return res.status(409).json({ error: 'Cet utilisateur est déjà rattaché à une agence' });

      const { error: profileErr } = await supabaseAdmin.from('profiles').update({
        tenant_id: tenantId, email: request.email, name: request.name, role: 'Member', system_role: 'user',
      }).eq('id', request.user_id);
      if (profileErr) return res.status(500).json({ error: profileErr.message });

      await supabaseAdmin.from('join_requests').update({ status: 'approved', decided_at: new Date().toISOString(), decided_by: req.user.id }).eq('id', request.id);
      res.json({ success: true });
    } catch (e: any) {
      console.error("[POST /api/team/join-requests/:id/approve]", e); res.status(e.status || 500).json({ error: e.message }); }
  });

  app.post("/api/team/join-requests/:id/reject", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('join_requests')
        .update({ status: 'rejected', decided_at: new Date().toISOString(), decided_by: req.user.id })
        .eq('id', req.params.id).eq('tenant_id', tenantId).eq('status', 'pending')
        .select().single();
      if (error || !data) return res.status(404).json({ error: 'Demande introuvable' });
      res.json({ success: true });
    } catch (e: any) {
      console.error("[POST /api/team/join-requests/:id/reject]", e); res.status(e.status || 500).json({ error: e.message }); }
  });
}
