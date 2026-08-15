// Phase 7 extraction — moved out of server.ts's "─── Stancer Billing ───"
// section. This is the tenant's own SaaS subscription billing (plan
// checkout, AI credit top-ups, the Stancer payment webhook) — a different
// concern from the client-facing Invoices domain (Factur-X invoices billed
// to a project's client), which stays deferred. PLAN_LIMITS/
// PLAN_AI_MONTHLY_CREDIT_CENTS/AI_CREDIT_PACKS stay defined in server.ts
// (createApp()) since they're also used by quota checks, the AI credit
// refresh helper, and the Agents IA package registration — passed in here
// as dependencies rather than duplicated.
import type { Express } from 'express';
import express from 'express';
import crypto from 'crypto';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { billingWebhookLimiter } from '../rateLimit';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  PLAN_LIMITS: Record<string, { projects: number; users: number; documents: number }>;
  PLAN_AI_MONTHLY_CREDIT_CENTS: Record<string, number>;
  AI_CREDIT_PACKS: Record<string, { amount_cents: number; label: string }>;
}

const STANCER_API_BASE = 'https://api.stancer.com/v2';

// Post-payment return URL base. Prefer the configured APP_URL so the redirect
// target can't be steered by a spoofed X-Forwarded-Host header; fall back to
// the request Host, which the app's Host-header allow-list middleware has
// already validated (X-Forwarded-Host is deliberately not trusted here).
function appBaseUrl(req: any): string {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.headers.host}`;
}

function stancerAuthHeader(): string {
  const key = process.env.STANCER_SECRET_KEY || '';
  return 'Basic ' + Buffer.from(key + ':').toString('base64');
}

async function stancerFetch(path: string, opts: { method?: string; body?: any } = {}): Promise<any> {
  const res = await fetch(`${STANCER_API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: stancerAuthHeader(),
      'Content-Type': 'application/json',
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  return res.json();
}

export function registerBillingRoutes(app: Express, { supabaseAdmin, getTenantId, PLAN_LIMITS, PLAN_AI_MONTHLY_CREDIT_CENTS, AI_CREDIT_PACKS }: RouteDeps) {
  // GET /api/billing/status
  app.get('/api/billing/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: tenant } = await supabaseAdmin.from('tenants')
        .select('plan, trial_ends_at, stancer_customer_id, ai_credit_balance_eur_cents').eq('id', tenantId).single();
      const [projectsRes, usersRes, docsRes] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('*', { count: 'exact', head: true }),
        tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('*', { count: 'exact', head: true }),
        tenantScopedFrom(supabaseAdmin, tenantId, 'documents').select('*', { count: 'exact', head: true }),
      ]);
      const plan = (tenant as any)?.plan || 'trial';
      const trial_ends_at = (tenant as any)?.trial_ends_at ?? null;
      const isTrial = plan === 'trial';
      const is_expired = isTrial && trial_ends_at && new Date(trial_ends_at) < new Date();
      const effectivePlan = is_expired ? 'expired' : plan;
      const limits = PLAN_LIMITS[effectivePlan] ?? PLAN_LIMITS.trial;
      res.json({
        plan: effectivePlan,
        trial_ends_at,
        is_expired: !!is_expired,
        usage: {
          projects:  { used: projectsRes.count ?? 0, limit: limits.projects },
          users:     { used: usersRes.count ?? 0, limit: limits.users },
          documents: { used: docsRes.count ?? 0, limit: limits.documents },
        },
        ai_credits: {
          balance_eur_cents: (tenant as any)?.ai_credit_balance_eur_cents ?? 0,
          included_monthly_cents: PLAN_AI_MONTHLY_CREDIT_CENTS[effectivePlan] ?? 0,
        },
      });
    } catch (e: any) {
      console.error("[GET /api/billing/status]", e); res.status(500).json({ error: e.message }); }
  });

  // POST /api/billing/checkout — create Stancer payment, return redirect URL
  app.post('/api/billing/checkout', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { plan_id } = req.body;
      const PLAN_PRICES: Record<string, number> = { starter: 2900, pro: 5900 };
      const PLAN_NAMES: Record<string, string> = { starter: 'Starter', pro: 'Pro' };
      const amount = PLAN_PRICES[plan_id];
      if (!amount) return res.status(400).json({ error: 'Plan invalide ou contact commercial requis' });

      const { data: tenant } = await supabaseAdmin.from('tenants').select('name, stancer_customer_id').eq('id', tenantId).single();

      // Create or reuse Stancer customer
      let customerId = (tenant as any)?.stancer_customer_id;
      if (!customerId) {
        const customer = await stancerFetch('/customers', {
          method: 'POST',
          body: { name: (tenant as any)?.name || 'Client', email: req.user.email },
        });
        customerId = customer.id;
        if (customerId) {
          await supabaseAdmin.from('tenants').update({ stancer_customer_id: customerId }).eq('id', tenantId);
        }
      }

      const returnUrl = `${appBaseUrl(req)}/billing?payment_status=success&plan=${plan_id}`;

      // Create payment
      const paymentBody: any = {
        amount,
        currency: 'eur',
        description: `ArchiOffice ${PLAN_NAMES[plan_id]} — Mensuel`,
        return_url: returnUrl,
      };
      if (customerId) paymentBody.customer = customerId;

      const payment = await stancerFetch('/payments', { method: 'POST', body: paymentBody });
      if (!payment.id) {
        console.error('[Stancer checkout]', payment);
        return res.status(502).json({ error: 'Erreur Stancer lors de la création du paiement' });
      }

      // Record pending payment
      await tenantScopedFrom(supabaseAdmin, tenantId, 'billing_events').insert({
        event_type: 'checkout_created',
        stancer_payment_id: payment.id,
        plan_id,
        amount,
        status: 'pending',
      });

      const pubKey = process.env.STANCER_PUBLIC_KEY || '';
      const paymentUrl = `https://payment.stancer.com/${pubKey}/${payment.id}`;

      res.json({ payment_id: payment.id, payment_url: paymentUrl });
    } catch (e: any) {
      console.error('[Billing checkout error]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/billing/webhook — Stancer event delivery (no JWT auth, see AUTH_EXEMPT in server.ts).
  // Stancer doesn't document a webhook payload signature we can verify here, so
  // the request body itself is never trusted: the only thing it supplies is a
  // payment id, which is then used to fetch the *authoritative* status straight
  // from the Stancer API using our own secret key. A forged POST with an
  // arbitrary/guessed id either fails that lookup or reflects a real payment's
  // real status — it can't inject a fake "captured" state. Rate-limited so the
  // endpoint can't be used to flood outbound calls to the Stancer API.
  app.post('/api/billing/webhook', billingWebhookLimiter, express.json(), async (req: any, res: any) => {
    try {
      const event = req.body;
      const paymentId = event.id || event.payment?.id;
      if (!paymentId) return res.json({ received: true });

      console.log('[Stancer webhook] event received, payment:', paymentId);

      // Verify by re-fetching from Stancer API
      const payment = await stancerFetch(`/payments/${paymentId}`);
      const status = payment?.status;

      if (status === 'captured' || status === 'authorized') {
        const { data: billingEvent } = await supabaseAdmin
          .from('billing_events')
          .select('*')
          .eq('stancer_payment_id', paymentId)
          .maybeSingle();

        if (billingEvent) {
          const { tenant_id, plan_id, event_type, credit_pack_id } = billingEvent as any;

          if (event_type === 'credit_topup_created') {
            // Credit top-up: add EUR cents to tenant balance
            const pack = AI_CREDIT_PACKS[credit_pack_id];
            if (pack) {
              await supabaseAdmin.rpc('increment_ai_credits', { p_tenant_id: tenant_id, p_amount_cents: pack.amount_cents });
              console.log(`[Stancer webhook] AI credits +${pack.amount_cents} cents for tenant ${tenant_id}`);
            }
            await supabaseAdmin.from('billing_events').update({ status: 'paid' }).eq('id', (billingEvent as any).id);
          } else {
            // Plan activation
            const renewalDate = new Date();
            renewalDate.setMonth(renewalDate.getMonth() + 1);
            await supabaseAdmin.from('tenants').update({
              plan: plan_id,
              trial_ends_at: renewalDate.toISOString(),
            }).eq('id', tenant_id);
            await supabaseAdmin.from('billing_events').update({ status: 'paid' }).eq('id', (billingEvent as any).id);
            console.log(`[Stancer webhook] Plan ${plan_id} activated for tenant ${tenant_id}`);
          }
        }
      }

      if (status === 'failed' || status === 'refused') {
        const { data: billingEvent } = await supabaseAdmin
          .from('billing_events')
          .select('id')
          .eq('stancer_payment_id', paymentId)
          .maybeSingle();
        if (billingEvent) {
          await supabaseAdmin.from('billing_events').update({ status: 'failed' }).eq('id', (billingEvent as any).id);
        }
      }

      res.json({ received: true });
    } catch (e: any) {
      console.error('[Stancer webhook error]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/billing/history — payment history for current tenant
  app.get('/api/billing/history', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'billing_events')
        .select('id, event_type, plan_id, amount, status, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      res.json(data || []);
    } catch (e: any) {
      console.error("[GET /api/billing/history]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/billing/credits/packs — available top-up packs
  app.get('/api/billing/credits/packs', (_req: any, res: any) => {
    res.json(Object.entries(AI_CREDIT_PACKS).map(([id, p]) => ({ id, amount_cents: p.amount_cents, label: p.label })));
  });

  // POST /api/billing/credits/checkout — buy a credit pack via Stancer
  app.post('/api/billing/credits/checkout', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { pack_id } = req.body;
      const pack = AI_CREDIT_PACKS[pack_id];
      if (!pack) return res.status(400).json({ error: 'Pack invalide' });

      const { data: tenant } = await supabaseAdmin.from('tenants').select('name, stancer_customer_id').eq('id', tenantId).single();

      let customerId = (tenant as any)?.stancer_customer_id;
      if (!customerId) {
        const customer = await stancerFetch('/customers', {
          method: 'POST',
          body: { name: (tenant as any)?.name || 'Client', email: req.user.email },
        });
        customerId = customer.id;
        if (customerId) {
          await supabaseAdmin.from('tenants').update({ stancer_customer_id: customerId }).eq('id', tenantId);
        }
      }

      const returnUrl = `${appBaseUrl(req)}/billing?payment_status=success&type=credit&pack=${pack_id}`;

      const paymentBody: any = {
        amount: pack.amount_cents,
        currency: 'eur',
        description: `ArchiOffice Crédits IA — ${pack.label}`,
        return_url: returnUrl,
      };
      if (customerId) paymentBody.customer = customerId;

      const payment = await stancerFetch('/payments', { method: 'POST', body: paymentBody });
      if (!payment.id) {
        console.error('[Stancer credits checkout]', payment);
        return res.status(502).json({ error: 'Erreur Stancer lors de la création du paiement' });
      }

      await tenantScopedFrom(supabaseAdmin, tenantId, 'billing_events').insert({
        event_type: 'credit_topup_created',
        stancer_payment_id: payment.id,
        credit_pack_id: pack_id,
        plan_id: null,
        amount: pack.amount_cents,
        status: 'pending',
      });

      const pubKey = process.env.STANCER_PUBLIC_KEY || '';
      res.json({ payment_id: payment.id, payment_url: `https://payment.stancer.com/${pubKey}/${payment.id}` });
    } catch (e: any) {
      console.error('[Credits checkout error]', e.message);
      res.status(500).json({ error: e.message });
    }
  });
}
