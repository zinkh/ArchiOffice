// Phase 7 extraction — moved out of server.ts's "─── Agency setup (compte
// authentifié sans tenant — création OAuth ou en attente de rattachement)
// ───" section. Reached by an authenticated user whose profile has no
// tenant_id yet (e.g. just signed up via Google OAuth) — they either create
// a brand-new cabinet or request to join an existing one (approved via the
// still-inline team/join-requests routes, deliberately left with the rest
// of the deferred auth/team cluster).
import type { Express } from 'express';
import nodemailer from 'nodemailer';

export interface RouteDeps {
  supabaseAdmin: any;
}

async function bestEffortNotifyAdmins(supabaseAdmin: any, tenantId: string, subject: string, html: string) {
  try {
    const { data: admins } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('system_role', 'admin');
    const recipients = (admins || []).map((a: any) => a.email).filter(Boolean);
    if (!recipients.length) return;
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpHost || !smtpUser || !smtpPass) return;
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(String(process.env.SMTP_PORT || '587')),
      secure: String(process.env.SMTP_PORT) === '465',
      auth: { user: smtpUser, pass: smtpPass },
    });
    await transporter.sendMail({ from: `"ArchiOffice" <${smtpUser}>`, to: recipients.join(','), subject, html });
  } catch (e: any) {
    console.error('[agency-setup] Notification email failed:', e.message);
  }
}

export function registerAgencySetupRoutes(app: Express, { supabaseAdmin }: RouteDeps) {
  app.get("/api/agency-setup/status", async (req: any, res: any) => {
    try {
      const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', req.user.id).single();
      if (profile?.tenant_id) return res.json({ hasTenant: true, pendingRequest: null });

      const { data: pending } = await supabaseAdmin
        .from('join_requests')
        .select('id, tenant_id, created_at, tenants(name)')
        .eq('user_id', req.user.id)
        .eq('status', 'pending')
        .maybeSingle();

      res.json({
        hasTenant: false,
        pendingRequest: pending ? { id: pending.id, tenantName: (pending as any).tenants?.name, createdAt: pending.created_at } : null,
      });
    } catch (e: any) {
      console.error("[GET /api/agency-setup/status]", e); res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agency-setup/search", async (req: any, res: any) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) return res.json([]);
      const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('id, name')
        .ilike('name', `%${q}%`)
        .order('name')
        .limit(10);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      console.error("[GET /api/agency-setup/search]", e); res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agency-setup/create", async (req: any, res: any) => {
    try {
      const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', req.user.id).single();
      if (profile?.tenant_id) return res.status(409).json({ error: 'Ce compte est déjà rattaché à une agence' });

      const agencyName = String(req.body?.agencyName || '').trim();
      if (!agencyName) return res.status(400).json({ error: "Le nom de l'agence est requis" });
      const address = req.body?.address ? String(req.body.address) : null;
      const phone = req.body?.phone ? String(req.body.phone) : null;
      const email = req.body?.email ? String(req.body.email) : null;

      const base = agencyName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'cabinet';
      const slug = base + '-' + Date.now().toString(36);

      const { data: tenant, error: tenantErr } = await supabaseAdmin
        .from('tenants')
        .insert({ slug, name: agencyName })
        .select()
        .single();
      if (tenantErr || !tenant) return res.status(500).json({ error: tenantErr?.message || 'Erreur création agence' });

      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(req.user.id);
      const displayName = authUser?.user?.user_metadata?.name || req.user.email?.split('@')[0] || agencyName;

      const { error: profileErr } = await supabaseAdmin.from('profiles').upsert({
        id: req.user.id, tenant_id: tenant.id, name: displayName, email: req.user.email, role: 'admin', system_role: 'admin',
      });
      if (profileErr) return res.status(500).json({ error: profileErr.message });

      if (address || phone || email) {
        await supabaseAdmin.from('settings').upsert({ tenant_id: tenant.id, agency_name: agencyName, address, phone, email });
      }

      // Une éventuelle demande de rattachement en attente devient sans objet.
      await supabaseAdmin.from('join_requests').delete().eq('user_id', req.user.id).eq('status', 'pending');

      res.json({ success: true, tenantId: tenant.id });
    } catch (e: any) {
      console.error("[POST /api/agency-setup/create]", e); res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agency-setup/join", async (req: any, res: any) => {
    try {
      const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', req.user.id).single();
      if (profile?.tenant_id) return res.status(409).json({ error: 'Ce compte est déjà rattaché à une agence' });

      const tenantId = String(req.body?.tenantId || '');
      if (!tenantId) return res.status(400).json({ error: 'Agence requise' });
      const { data: tenant } = await supabaseAdmin.from('tenants').select('id, name').eq('id', tenantId).single();
      if (!tenant) return res.status(404).json({ error: 'Agence introuvable' });

      // Une seule demande en attente à la fois : on remplace l'ancienne si elle vise une autre agence.
      await supabaseAdmin.from('join_requests').delete().eq('user_id', req.user.id).eq('status', 'pending');

      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(req.user.id);
      const name = authUser?.user?.user_metadata?.name || req.user.email?.split('@')[0] || '';

      const { data: request, error } = await supabaseAdmin.from('join_requests').insert({
        tenant_id: tenantId, user_id: req.user.id, email: req.user.email, name,
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });

      bestEffortNotifyAdmins(
        supabaseAdmin,
        tenantId,
        'Nouvelle demande de rattachement — ArchiOffice',
        `<p>${name || req.user.email} (${req.user.email}) demande à rejoindre votre agence <strong>${tenant.name}</strong> sur ArchiOffice.</p><p>Rendez-vous sur la page Équipe pour approuver ou refuser cette demande.</p>`
      );

      res.json({ success: true, requestId: request.id, tenantName: tenant.name });
    } catch (e: any) {
      console.error("[POST /api/agency-setup/join]", e); res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/agency-setup/join", async (req: any, res: any) => {
    try {
      await supabaseAdmin.from('join_requests').delete().eq('user_id', req.user.id).eq('status', 'pending');
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/agency-setup/join]", e); res.status(500).json({ error: e.message }); }
  });
}
