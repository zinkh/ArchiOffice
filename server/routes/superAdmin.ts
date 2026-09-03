// Phase 7 extraction — moved out of server.ts's "─── Super-Admin Dashboard
// ───" section. Unlike every other extracted module, this one deliberately
// does NOT use tenantScopedFrom/getTenantId: it's the platform operator's
// cross-tenant admin panel (managing every tenant, not scoped to one), so
// "no tenant filter" is correct here, not a bug. Access is gated by
// requireSuperAdmin — see server/superAdminAuth.ts for the real, DB-backed
// check (platform_admins table, with SUPER_ADMIN_EMAIL as bootstrap
// fallback). Every mutating route logs to admin_audit_log via
// server/adminAudit.ts.
import type { Express } from 'express';
import { isSuperAdmin } from '../superAdminAuth';
import { logAdminAction } from '../adminAudit';
import { sendPlatformMail } from '../mailer';

export interface RouteDeps {
  supabaseAdmin: any;
}

export function registerSuperAdminRoutes(app: Express, { supabaseAdmin }: RouteDeps) {
  async function requireSuperAdmin(req: any, res: any, next: any) {
    if (!(await isSuperAdmin(supabaseAdmin, req.user))) {
      return res.status(403).json({ error: 'Accès réservé au super-administrateur' });
    }
    next();
  }

  app.get('/api/admin/is-admin', async (req: any, res: any) => {
    res.json({ isAdmin: await isSuperAdmin(supabaseAdmin, req.user) });
  });

  app.get('/api/admin/stats', requireSuperAdmin, async (_req: any, res: any) => {
    try {
      const [{ data: tenants }, { data: revenue }, { data: aiRevenue }] = await Promise.all([
        supabaseAdmin.from('tenants').select('id, plan, trial_ends_at'),
        supabaseAdmin.from('billing_events').select('amount, created_at, event_type').eq('status', 'paid'),
        supabaseAdmin.from('billing_events').select('amount, created_at').eq('status', 'paid').eq('event_type', 'credit_topup_created'),
      ]);
      const now = Date.now();
      const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 7);
      const planRevenue = (revenue ?? []).filter((e: any) => e.event_type !== 'credit_topup_created');
      const stats = {
        total:      tenants?.length ?? 0,
        trial:      tenants?.filter(t => t.plan === 'trial').length ?? 0,
        starter:    tenants?.filter(t => t.plan === 'starter').length ?? 0,
        pro:        tenants?.filter(t => t.plan === 'pro').length ?? 0,
        enterprise: tenants?.filter(t => t.plan === 'enterprise').length ?? 0,
        expired:    tenants?.filter(t => t.plan === 'trial' && t.trial_ends_at && new Date(t.trial_ends_at).getTime() < now).length ?? 0,
        totalRevenue:    (planRevenue.reduce((s: number, e: any) => s + (e.amount ?? 0), 0) / 100),
        totalAiRevenue:  ((aiRevenue ?? []).reduce((s, e) => s + (e.amount ?? 0), 0) / 100),
        aiRevenueThisMonth: ((aiRevenue ?? []).filter((e: any) => (e.created_at as string).slice(0, 7) === thisMonth).reduce((s, e) => s + (e.amount ?? 0), 0) / 100),
      };
      const monthlyRevenue: Record<string, number> = {};
      for (const e of planRevenue) {
        const month = (e.created_at as string).slice(0, 7);
        monthlyRevenue[month] = (monthlyRevenue[month] ?? 0) + (e.amount ?? 0) / 100;
      }
      res.json({ stats, monthlyRevenue });
    } catch (e: any) {
      console.error("[GET /api/admin/stats]", e); res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/tenants', requireSuperAdmin, async (_req: any, res: any) => {
    try {
      const { data: tenants, error } = await supabaseAdmin
        .from('tenants')
        .select('id, slug, name, plan, trial_ends_at, created_at, ai_credit_balance_eur_cents')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const enriched = await Promise.all((tenants ?? []).map(async (t) => {
        const [profilesRes, projectsRes, ownerRes] = await Promise.all([
          supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id),
          supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id),
          supabaseAdmin.from('profiles').select('email, name').eq('tenant_id', t.id).eq('system_role', 'admin').limit(1),
        ]);
        const owner = ownerRes.data?.[0];
        return {
          ...t,
          user_count: profilesRes.count ?? 0,
          project_count: projectsRes.count ?? 0,
          owner_email: owner?.email ?? null,
          owner_name: owner?.name ?? null,
        };
      }));
      res.json(enriched);
    } catch (e: any) {
      console.error("[GET /api/admin/tenants]", e); res.status(500).json({ error: e.message }); }
  });

  // Fiche cabinet — drill-down utilisé par la page /admin/tenants/:id.
  app.get('/api/admin/tenants/:id', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { data: tenant, error } = await supabaseAdmin
        .from('tenants')
        .select('id, slug, name, plan, trial_ends_at, created_at, ai_credit_balance_eur_cents, internal_notes')
        .eq('id', id)
        .single();
      if (error || !tenant) return res.status(404).json({ error: 'Cabinet introuvable' });

      const [membersRes, projectsRes, billingRes, auditRes] = await Promise.all([
        supabaseAdmin.from('profiles').select('id, name, email, role, system_role, created_at').eq('tenant_id', id).order('created_at', { ascending: true }),
        supabaseAdmin.from('projects').select('id, name, status, created_at').eq('tenant_id', id).order('created_at', { ascending: false }).limit(20),
        supabaseAdmin.from('billing_events').select('id, event_type, plan_id, amount, status, created_at').eq('tenant_id', id).order('created_at', { ascending: false }).limit(50),
        supabaseAdmin.from('admin_audit_log').select('id, actor_email, action, details, created_at').eq('target_tenant_id', id).order('created_at', { ascending: false }).limit(50),
      ]);
      const members = membersRes.data ?? [];
      const owner = members.find((m: any) => m.system_role === 'admin');

      res.json({
        ...tenant,
        user_count: members.length,
        project_count: (projectsRes.data ?? []).length,
        owner_email: owner?.email ?? null,
        owner_name: owner?.name ?? null,
        members,
        recent_projects: projectsRes.data ?? [],
        billing_events: billingRes.data ?? [],
        audit_log: auditRes.data ?? [],
      });
    } catch (e: any) {
      console.error("[GET /api/admin/tenants/:id]", e); res.status(500).json({ error: e.message }); }
  });

  // Framed impersonation — mints a one-time magic-sign-in link for a specific
  // tenant member, for support purposes. The browser opening the link
  // authenticates AS that user (supabase-js's default detectSessionInUrl
  // handles this automatically, see src/lib/supabase.ts); we redirect it to
  // ?impersonating=1 so src/components/ImpersonationBanner.tsx can pick that
  // up and show a persistent "you are impersonating" banner. Every start is
  // audit-logged — there is deliberately no "impersonation session" state
  // tracked server-side beyond that log entry (ending it is just: sign out).
  app.post('/api/admin/tenants/:id/impersonate', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { id: tenantId } = req.params;
      const { user_id } = req.body;
      if (!user_id) return res.status(400).json({ error: 'user_id requis' });
      const { data: member } = await supabaseAdmin.from('profiles').select('id, email, name').eq('id', user_id).eq('tenant_id', tenantId).maybeSingle();
      if (!member || !(member as any).email) return res.status(404).json({ error: 'Membre introuvable dans ce cabinet' });

      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: (member as any).email,
        options: { redirectTo: `${appUrl}/?impersonating=1` },
      });
      if (error || !linkData?.properties?.action_link) {
        return res.status(502).json({ error: error?.message || 'Impossible de générer le lien de connexion' });
      }

      await logAdminAction(supabaseAdmin, req.user, 'tenant.impersonated', tenantId, {
        impersonated_user_id: user_id, impersonated_email: (member as any).email,
      });

      res.json({ action_link: linkData.properties.action_link, impersonated_email: (member as any).email });
    } catch (e: any) {
      console.error("[POST /api/admin/tenants/:id/impersonate]", e); res.status(500).json({ error: e.message }); }
  });

  // Free-form email from the platform team to a tenant — either one named
  // member or every member of the cabinet. Distinct from the automated
  // lifecycle/dunning notices (server/lifecycleEmails.ts, server/dunning.ts):
  // this one is operator-authored, one-off, and always audit-logged.
  app.post('/api/admin/tenants/:id/send-email', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { id: tenantId } = req.params;
      const { recipient, user_id, subject, message } = req.body;
      if (!subject?.trim() || !message?.trim()) return res.status(400).json({ error: 'Sujet et message requis' });
      if (!['member', 'tenant'].includes(recipient)) return res.status(400).json({ error: 'Destinataire invalide' });

      let recipients: string[];
      if (recipient === 'member') {
        if (!user_id) return res.status(400).json({ error: 'user_id requis' });
        const { data: member } = await supabaseAdmin.from('profiles').select('email').eq('id', user_id).eq('tenant_id', tenantId).maybeSingle();
        if (!(member as any)?.email) return res.status(404).json({ error: 'Membre introuvable dans ce cabinet' });
        recipients = [(member as any).email];
      } else {
        const { data: members } = await supabaseAdmin.from('profiles').select('email').eq('tenant_id', tenantId);
        recipients = ((members || []) as { email: string | null }[]).map(m => m.email).filter(Boolean) as string[];
        if (!recipients.length) return res.status(404).json({ error: 'Aucun membre avec une adresse email dans ce cabinet' });
      }

      const html = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <p>${message.trim().replace(/\n/g, '<br>')}</p>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px;">Message envoyé par l'équipe ArchiOffice.</p>
      </div>`;
      const sent = await sendPlatformMail(recipients.join(','), subject.trim(), html);
      if (!sent) return res.status(502).json({ error: "Échec de l'envoi (SMTP non configuré ou erreur d'envoi)" });

      await logAdminAction(supabaseAdmin, req.user, 'tenant.email_sent', tenantId, {
        recipient_type: recipient,
        user_id: recipient === 'member' ? user_id : undefined,
        recipient_count: recipients.length,
        subject: subject.trim(),
      });

      res.json({ ok: true, recipient_count: recipients.length });
    } catch (e: any) {
      console.error("[POST /api/admin/tenants/:id/send-email]", e); res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/admin/tenants/:id/notes', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { notes } = req.body;
      const { error } = await supabaseAdmin.from('tenants').update({ internal_notes: notes ?? null }).eq('id', req.params.id);
      if (error) throw error;
      await logAdminAction(supabaseAdmin, req.user, 'tenant.notes_updated', req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[PATCH /api/admin/tenants/:id/notes]", e); res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/admin/tenants/:id/plan', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { plan } = req.body;
      if (!['trial', 'starter', 'pro', 'enterprise'].includes(plan)) {
        return res.status(400).json({ error: 'Plan invalide' });
      }
      const { error } = await supabaseAdmin.from('tenants').update({ plan }).eq('id', req.params.id);
      if (error) throw error;
      await logAdminAction(supabaseAdmin, req.user, 'tenant.plan_changed', req.params.id, { plan });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[PATCH /api/admin/tenants/:id/plan]", e); res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/admin/tenants/:id/trial', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { days } = req.body;
      if (typeof days !== 'number' || days < 1 || days > 365) {
        return res.status(400).json({ error: 'Durée invalide (1-365 jours)' });
      }
      const newDate = new Date(Date.now() + days * 86_400_000).toISOString();
      const { error } = await supabaseAdmin.from('tenants').update({ trial_ends_at: newDate, plan: 'trial' }).eq('id', req.params.id);
      if (error) throw error;
      await logAdminAction(supabaseAdmin, req.user, 'tenant.trial_extended', req.params.id, { days, trial_ends_at: newDate });
      res.json({ ok: true, trial_ends_at: newDate });
    } catch (e: any) {
      console.error("[PATCH /api/admin/tenants/:id/trial]", e); res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/admin/tenants/:id/ai-credit', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { amount_cents } = req.body;
      if (typeof amount_cents !== 'number' || !Number.isFinite(amount_cents) || Math.round(amount_cents) === 0) {
        return res.status(400).json({ error: 'Montant invalide' });
      }
      const { error: rpcErr } = await supabaseAdmin.rpc('increment_ai_credits', { p_tenant_id: req.params.id, p_amount_cents: Math.round(amount_cents) });
      if (rpcErr) throw rpcErr;
      const { data: tenant, error } = await supabaseAdmin.from('tenants').select('ai_credit_balance_eur_cents').eq('id', req.params.id).single();
      if (error) throw error;
      await logAdminAction(supabaseAdmin, req.user, 'tenant.ai_credit_adjusted', req.params.id, { amount_cents: Math.round(amount_cents) });
      res.json({ ok: true, balance_eur_cents: (tenant as any).ai_credit_balance_eur_cents });
    } catch (e: any) {
      console.error("[PATCH /api/admin/tenants/:id/ai-credit]", e); res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/tenants', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { name, slug, adminEmail, adminName, plan = 'trial' } = req.body;
      if (!name || !slug || !adminEmail || !adminName) {
        return res.status(400).json({ error: 'name, slug, adminEmail et adminName sont requis' });
      }
      const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const { data: existing } = await supabaseAdmin.from('tenants').select('id').eq('slug', cleanSlug).maybeSingle();
      if (existing) return res.status(400).json({ error: `Le slug "${cleanSlug}" est déjà utilisé` });

      const tenantId = crypto.randomUUID();
      const trialEndsAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
      const { error: tenantErr } = await supabaseAdmin.from('tenants').insert({ id: tenantId, slug: cleanSlug, name, plan, trial_ends_at: trialEndsAt });
      if (tenantErr) throw tenantErr;

      const tempPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-4).toUpperCase() + '!';
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: adminEmail, password: tempPassword, user_metadata: { name: adminName }, email_confirm: true,
      });
      if (authErr || !authData?.user) throw authErr ?? new Error('Création utilisateur échouée');

      await supabaseAdmin.from('profiles').upsert({
        id: authData.user.id, tenant_id: tenantId, name: adminName, email: adminEmail,
        role: 'Admin', system_role: 'admin',
      });

      await logAdminAction(supabaseAdmin, req.user, 'tenant.created', tenantId, { name, slug: cleanSlug, plan, adminEmail });
      res.status(201).json({ tenantId, slug: cleanSlug, tempPassword });
    } catch (e: any) {
      console.error("[POST /api/admin/tenants]", e); res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/tenants/:id', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { data: tenant } = await supabaseAdmin.from('tenants').select('name, slug').eq('id', id).maybeSingle();
      const { data: profiles } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', id);
      for (const p of profiles ?? []) {
        await supabaseAdmin.auth.admin.deleteUser(p.id).catch(() => {});
      }
      const { error } = await supabaseAdmin.from('tenants').delete().eq('id', id);
      if (error) throw error;
      // Logged after the tenant row is gone — admin_audit_log.target_tenant_id
      // is ON DELETE SET NULL, so this row survives as an orphaned record of
      // the deletion itself (name/slug captured in details since the FK will
      // no longer resolve).
      await logAdminAction(supabaseAdmin, req.user, 'tenant.deleted', null, { tenant_id: id, name: (tenant as any)?.name, slug: (tenant as any)?.slug });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[DELETE /api/admin/tenants/:id]", e); res.status(500).json({ error: e.message }); }
  });

  // ─── Platform admins (superadmin role management) ─────────────────────────

  // ─── Fournisseur IA de la plateforme ────────────────────────────────────
  // Le couple fournisseur/modèle se réglait uniquement par AI_PROVIDER /
  // AI_MODEL, donc au prix d'un redémarrage. Ces deux routes le rendent
  // modifiable à chaud. Les CLÉS d'API restent, elles, dans l'environnement
  // et ne transitent jamais par ici : ce switch choisit parmi les
  // fournisseurs déjà approvisionnés en clé, il n'en configure aucun.
  app.get('/api/admin/ai-provider', requireSuperAdmin, async (_req: any, res: any) => {
    try {
      const { listProviderAvailability, describeLlmSelection, getPlatformAiConfig } =
        await import('@zinkh/archioffice-agents/server/llm');
      const stored = await getPlatformAiConfig(supabaseAdmin);
      const selection = describeLlmSelection(stored);
      res.json({
        current: {
          ...selection,
          // describeLlmSelection ne connaît que « override » ; ici la source
          // de cet override est connue : c'est platform_settings.
          source: selection.source === 'override' ? 'database' : selection.source,
        },
        providers: listProviderAvailability(),
      });
    } catch (e: any) {
      console.error('[GET /api/admin/ai-provider]', e); res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/ai-provider', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { provider, model } = req.body ?? {};
      if (typeof provider !== 'string' || typeof model !== 'string' || !provider || !model) {
        return res.status(400).json({ error: 'provider et model sont requis' });
      }

      const { listProviderAvailability, setPlatformAiConfig } =
        await import('@zinkh/archioffice-agents/server/llm');
      const available = listProviderAvailability();

      // Trois refus, dans cet ordre : un fournisseur inconnu, un fournisseur
      // sans clé (basculer dessus mettrait toute l'IA en 503), un modèle hors
      // catalogue (nous ne savons pas le facturer). Mieux vaut un 400 ici
      // qu'une plateforme cassée par une faute de frappe.
      const target = available.find(p => p.provider === provider);
      if (!target) {
        return res.status(400).json({ error: `Fournisseur inconnu : ${provider}` });
      }
      if (!target.configured) {
        return res.status(400).json({
          error: `Aucune clé API configurée pour ${target.label}. Renseignez ${target.envKey} avant de basculer dessus.`,
        });
      }
      if (!target.models.some(m => m.model === model)) {
        return res.status(400).json({ error: `Modèle inconnu pour ${target.label} : ${model}` });
      }

      await setPlatformAiConfig(supabaseAdmin, { provider, model }, req.user?.id);
      await logAdminAction(supabaseAdmin, req.user, 'platform.ai_provider_changed', null, { provider, model });
      res.json({ ok: true, provider, model });
    } catch (e: any) {
      console.error('[PUT /api/admin/ai-provider]', e); res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/platform-admins', requireSuperAdmin, async (_req: any, res: any) => {
    try {
      const { data, error } = await supabaseAdmin.from('platform_admins').select('user_id, email, created_at').order('created_at', { ascending: true });
      if (error) throw error;
      res.json(data ?? []);
    } catch (e: any) {
      console.error("[GET /api/admin/platform-admins]", e); res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/platform-admins', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const email = String(req.body?.email || '').trim();
      if (!email) return res.status(400).json({ error: 'Email requis' });
      // Resolves through profiles rather than the Auth admin API — every real
      // user already has a profile row, and this avoids a listUsers() scan.
      const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
      if (!profile) return res.status(404).json({ error: "Aucun utilisateur avec cet email — l'intéressé doit d'abord avoir un compte ArchiOffice." });
      const { error } = await supabaseAdmin.from('platform_admins').upsert({ user_id: (profile as any).id, email });
      if (error) throw error;
      await logAdminAction(supabaseAdmin, req.user, 'platform_admin.granted', null, { email });
      res.status(201).json({ ok: true });
    } catch (e: any) {
      console.error("[POST /api/admin/platform-admins]", e); res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/platform-admins/:userId', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { userId } = req.params;
      const { data: target } = await supabaseAdmin.from('platform_admins').select('email').eq('user_id', userId).maybeSingle();
      const { error } = await supabaseAdmin.from('platform_admins').delete().eq('user_id', userId);
      if (error) throw error;
      await logAdminAction(supabaseAdmin, req.user, 'platform_admin.revoked', null, { email: (target as any)?.email, user_id: userId });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[DELETE /api/admin/platform-admins/:userId]", e); res.status(500).json({ error: e.message }); }
  });
}
