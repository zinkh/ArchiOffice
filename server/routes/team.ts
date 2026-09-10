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
import {
  addMembership,
  findMembership,
  listMembershipsWithTenants,
  listTenantMemberIds,
  tenantMembershipsByUser,
  updateMembership,
} from '../tenantMemberships';

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
      // L'équipe d'un cabinet, ce sont ses adhésions — pas les profils dont
      // c'est le cabinet par défaut : une personne qui exerce dans deux
      // structures n'a qu'un profil, mais doit figurer dans les deux équipes.
      const [memberIds, memberships] = await Promise.all([
        listTenantMemberIds(supabaseAdmin, tenantId),
        tenantMembershipsByUser(supabaseAdmin, tenantId),
      ]);
      if (!memberIds.length) return res.json([]);
      const { data, error } = await supabaseAdmin.from('profiles').select('id, name, email, role, system_role, manager_id, avatar, sender_option, default_email_template, phone, address, job_title, department').in('id', memberIds);
      if (error) throw error;
      res.json((data || []).map((p: any) => {
        // Rôle et hiérarchie sont ceux tenus DANS ce cabinet ; les colonnes de
        // `profiles` ne servent que pour un compte qu'aucune adhésion ne
        // couvre encore.
        const membership = memberships.get(p.id);
        return {
          ...p,
          role: membership?.role ?? p.role,
          system_role: membership?.systemRole ?? p.system_role,
          manager_id: membership?.managerId ?? p.manager_id,
          senderOption: p.sender_option,
          defaultEmailTemplate: p.default_email_template,
          jobTitle: p.job_title,
        };
      }));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch team" }); }
  });

  app.get("/api/me", async (req: any, res: any) => {
    try {
      const { data, error } = await supabaseAdmin.from('profiles').select('id, tenant_id, name, email, role, system_role, manager_id, avatar, sender_option, default_email_template, phone, address, job_title, department').eq('id', req.user.id).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (!data) return res.json(null);

      // Les cabinets de la personne, et celui qui sert cette requête. Le
      // client s'en sert pour son sélecteur de cabinet et pour savoir quel
      // rôle afficher : on est souvent gérant du sien et collaborateur de
      // l'autre.
      const memberships = await listMembershipsWithTenants(supabaseAdmin, req.user.id);
      const activeTenantId = memberships.length
        ? (req.activeTenantId || memberships[0].tenantId)
        : null;
      const activeMembership = memberships.find(m => m.tenantId === activeTenantId) ?? null;

      res.json({
        ...data,
        // Le cabinet actif, pas celui par défaut : sans ça, une session
        // basculée sur le second cabinet continuerait d'afficher le rôle et
        // les garde-fous du premier.
        tenantId: activeTenantId ?? data.tenant_id,
        defaultTenantId: data.tenant_id,
        role: activeMembership?.role ?? data.role,
        system_role: activeMembership?.systemRole ?? data.system_role,
        tenants: memberships.map(m => ({
          tenantId: m.tenantId,
          name: m.tenantName,
          role: m.role,
          systemRole: m.systemRole,
          isDefault: m.isDefault,
          isActive: m.tenantId === activeTenantId,
        })),
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
      // La cible doit appartenir au cabinet courant. Le filtre
      // `.eq('tenant_id', ...)` d'avant ne le disait plus : il portait sur le
      // cabinet PAR DÉFAUT du profil, donc une personne exerçant dans deux
      // structures ne pouvait plus modifier son propre profil depuis la
      // seconde.
      if (!(await findMembership(supabaseAdmin, req.params.id, tenantId))) {
        return res.status(404).json({ error: 'Membre introuvable dans ce cabinet' });
      }
      const { senderOption, defaultEmailTemplate, phone, address, jobTitle, department, avatar } = req.body;
      const { data, error } = await supabaseAdmin.from('profiles').update({
        sender_option: senderOption,
        default_email_template: defaultEmailTemplate,
        phone: phone || null,
        address: address || null,
        job_title: jobTitle || null,
        department: department || null,
        ...(avatar !== undefined ? { avatar: avatar || null } : {}),
      }).eq('id', req.params.id).select().single();
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
      // Déjà membre de CE cabinet ? (la même adresse peut très bien exercer
      // dans un autre cabinet de l'instance : ce n'est pas un doublon.)
      const { data: existingProfile } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
      if (existingProfile && await findMembership(supabaseAdmin, (existingProfile as any).id, tenantId)) {
        return res.status(400).json({ error: "User with this email already exists" });
      }
      // Cette adresse a déjà un compte, dans un autre cabinet : on l'y
      // rattache en plus, sans créer un second compte. Créer un compte
      // d'authentification de plus échouerait de toute façon (l'adresse est
      // unique chez Supabase Auth), et c'est justement le cas d'un architecte
      // associé que cet ajout doit servir — il garde son mot de passe, ses
      // boîtes mail connectées, son profil.
      if (existingProfile) {
        const existingId = (existingProfile as any).id;
        await addMembership(supabaseAdmin, {
          userId: existingId, tenantId, role: role || 'Member', systemRole: system_role || 'user',
          // Son cabinet d'ouverture de session ne bouge pas : il basculera
          // lui-même quand il travaillera ici.
          makeDefault: false,
        });
        return res.status(201).json({
          id: existingId, name, email, role, system_role,
          // Aucun identifiant à envoyer : le compte existe déjà.
          existingAccount: true, emailSent: false, emailError: null,
        });
      }

      const password = Math.random().toString(36).slice(-8);
      // Create Supabase Auth user
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({ email, password, user_metadata: { name }, email_confirm: true });
      if (authErr || !authData?.user) return res.status(500).json({ error: authErr?.message || "Failed to create auth user" });
      const id = authData.user.id;
      await supabaseAdmin.from('profiles').upsert({ id, tenant_id: tenantId, name, email, role: role || 'Member', system_role: system_role || 'user' });
      // Le rattachement lui-même : c'est l'adhésion qui fait foi, le
      // `tenant_id` posé ci-dessus n'étant que le cabinet par défaut d'un
      // compte qui vient d'être créé et n'en a pas d'autre.
      await addMembership(supabaseAdmin, {
        userId: id, tenantId, role: role || 'Member', systemRole: system_role || 'user', makeDefault: true,
      });
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
      if (!(await findMembership(supabaseAdmin, id, tenantId))) {
        return res.status(404).json({ error: 'Membre introuvable dans ce cabinet' });
      }
      // Le rôle est celui tenu dans CE cabinet : le modifier ici ne doit rien
      // changer au rôle que la même personne tient dans l'autre.
      await updateMembership(supabaseAdmin, { userId: id, tenantId, systemRole: role });
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
      if (!(await findMembership(supabaseAdmin, id, tenantId))) {
        return res.status(404).json({ error: 'Membre introuvable dans ce cabinet' });
      }
      // Idem : le supérieur hiérarchique n'est pas la même personne d'un
      // cabinet à l'autre.
      await updateMembership(supabaseAdmin, { userId: id, tenantId, managerId: manager_id || null });
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

      // Un rattachement de plus, pas un remplacement : la personne peut déjà
      // exercer ailleurs. Seule une demande visant un cabinet dont elle est
      // DÉJÀ membre n'a plus d'objet.
      if (await findMembership(supabaseAdmin, request.user_id, tenantId)) {
        return res.status(409).json({ error: 'Cet utilisateur appartient déjà à ce cabinet' });
      }

      const { data: existingProfile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', request.user_id).single();
      const isFirstTenant = !existingProfile?.tenant_id;

      await addMembership(supabaseAdmin, {
        userId: request.user_id, tenantId, role: 'Member', systemRole: 'user',
        // Le premier cabinet devient le cabinet d'ouverture de session ; un
        // second rattachement ne déplace pas celui sur lequel la personne
        // travaille déjà.
        makeDefault: isFirstTenant,
      });

      const { error: profileErr } = await supabaseAdmin.from('profiles').update({
        email: request.email, name: request.name,
        ...(isFirstTenant ? { tenant_id: tenantId, role: 'Member', system_role: 'user' } : {}),
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
