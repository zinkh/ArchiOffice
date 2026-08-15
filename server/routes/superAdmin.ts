// Phase 7 extraction — moved out of server.ts's "─── Super-Admin Dashboard
// ───" section. Unlike every other extracted module, this one deliberately
// does NOT use tenantScopedFrom/getTenantId: it's the platform operator's
// cross-tenant admin panel (managing every tenant, not scoped to one), so
// "no tenant filter" is correct here, not a bug. Access is gated instead by
// requireSuperAdmin, matching the caller's email against SUPER_ADMIN_EMAIL.
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
}

export function registerSuperAdminRoutes(app: Express, { supabaseAdmin }: RouteDeps) {
  // Case/whitespace-insensitive so a differently-cased SUPER_ADMIN_EMAIL env
  // value (or an auth provider that doesn't lowercase emails) can't either
  // lock the real operator out or, worse, leave the comparison looking like
  // it matches when it silently doesn't.
  function isSuperAdminEmail(email: string | undefined): boolean {
    const adminEmail = process.env.SUPER_ADMIN_EMAIL;
    if (!adminEmail || !email) return false;
    return email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
  }

  function requireSuperAdmin(req: any, res: any, next: any) {
    if (!isSuperAdminEmail(req.user?.email)) {
      return res.status(403).json({ error: 'Accès réservé au super-administrateur' });
    }
    next();
  }

  app.get('/api/admin/is-admin', async (req: any, res: any) => {
    res.json({ isAdmin: isSuperAdminEmail(req.user?.email) });
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

  app.patch('/api/admin/tenants/:id/plan', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { plan } = req.body;
      if (!['trial', 'starter', 'pro', 'enterprise'].includes(plan)) {
        return res.status(400).json({ error: 'Plan invalide' });
      }
      const { error } = await supabaseAdmin.from('tenants').update({ plan }).eq('id', req.params.id);
      if (error) throw error;
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

      res.status(201).json({ tenantId, slug: cleanSlug, tempPassword });
    } catch (e: any) {
      console.error("[POST /api/admin/tenants]", e); res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/tenants/:id', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { data: profiles } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', id);
      for (const p of profiles ?? []) {
        await supabaseAdmin.auth.admin.deleteUser(p.id).catch(() => {});
      }
      const { error } = await supabaseAdmin.from('tenants').delete().eq('id', id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[DELETE /api/admin/tenants/:id]", e); res.status(500).json({ error: e.message }); }
  });
}
