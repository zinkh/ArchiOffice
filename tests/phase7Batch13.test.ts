// Phase 7 batch 13: end-to-end Supertest coverage for the domain extracted
// into server/routes/billing.ts (the tenant's own SaaS subscription billing
// via Stancer — plan checkout, AI credit top-ups, and the payment webhook;
// distinct from the still-deferred client-facing Invoices domain).
//
// Checkout/webhook routes stub global.fetch to simulate the Stancer API
// (customer creation, payment creation, payment status lookup) so the real
// tenant-scoped billing_events/tenants writes are exercised end to end.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function mockStancerFetch(responses: Record<string, any>) {
  global.fetch = vi.fn(async (url: any) => {
    const path = String(url).replace('https://api.stancer.com/v2', '');
    const key = Object.keys(responses).find(p => path.startsWith(p));
    const body = key ? responses[key] : {};
    return { ok: true, json: async () => body } as any;
  }) as any;
}

describe('Billing status', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('reports plan, usage, and AI credit balance', async () => {
    const tenantId = makeTenant({ plan: 'starter', ai_credit_balance_eur_cents: 1200 });
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId, name: 'Villa' }]);

    const res = await request(app).get('/api/billing/status').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('starter');
    expect(res.body.usage.projects.used).toBe(1);
    expect(res.body.usage.projects.limit).toBe(10);
    expect(res.body.ai_credits.balance_eur_cents).toBe(1200);
  });
});

describe('Billing checkout', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('creates a Stancer customer and payment, recording a pending billing_event', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    mockStancerFetch({ '/customers': { id: 'cus_1' }, '/payments': { id: 'pay_1' } });

    const res = await request(app).post('/api/billing/checkout').set(authHeader(token)).send({ plan_id: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.payment_id).toBe('pay_1');
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.stancer_customer_id).toBe('cus_1');
    const event = fakeSupabaseAdmin.getTable('billing_events').find(e => e.stancer_payment_id === 'pay_1');
    expect(event?.tenant_id).toBe(tenantId);
    expect(event?.status).toBe('pending');
  });

  it('rejects an invalid plan', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/billing/checkout').set(authHeader(token)).send({ plan_id: 'gold' });
    expect(res.status).toBe(400);
  });
});

describe('Billing webhook', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('activates the plan when a checkout payment is captured', async () => {
    const tenantId = makeTenant({ plan: 'trial' });
    fakeSupabaseAdmin.seed('billing_events', [{ id: 'be1', tenant_id: tenantId, stancer_payment_id: 'pay_ok', event_type: 'checkout_created', plan_id: 'pro', status: 'pending' }]);
    mockStancerFetch({ '/payments/pay_ok': { id: 'pay_ok', status: 'captured' } });

    const res = await request(app).post('/api/billing/webhook').send({ id: 'pay_ok' });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.plan).toBe('pro');
    expect(fakeSupabaseAdmin.getTable('billing_events').find(e => e.id === 'be1')?.status).toBe('paid');
  });

  it('tops up AI credits when a credit-pack payment is captured', async () => {
    const tenantId = makeTenant({ ai_credit_balance_eur_cents: 0 });
    fakeSupabaseAdmin.seed('billing_events', [{ id: 'be2', tenant_id: tenantId, stancer_payment_id: 'pay_credit', event_type: 'credit_topup_created', credit_pack_id: 'pack_10', status: 'pending' }]);
    mockStancerFetch({ '/payments/pay_credit': { id: 'pay_credit', status: 'captured' } });

    const res = await request(app).post('/api/billing/webhook').send({ id: 'pay_credit' });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.ai_credit_balance_eur_cents).toBe(1000);
    expect(fakeSupabaseAdmin.getTable('billing_events').find(e => e.id === 'be2')?.status).toBe('paid');
  });

  it('marks a failed payment as failed without touching the plan', async () => {
    const tenantId = makeTenant({ plan: 'trial' });
    fakeSupabaseAdmin.seed('billing_events', [{ id: 'be3', tenant_id: tenantId, stancer_payment_id: 'pay_fail', event_type: 'checkout_created', plan_id: 'pro', status: 'pending' }]);
    mockStancerFetch({ '/payments/pay_fail': { id: 'pay_fail', status: 'failed' } });

    const res = await request(app).post('/api/billing/webhook').send({ id: 'pay_fail' });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('billing_events').find(e => e.id === 'be3')?.status).toBe('failed');
    expect(fakeSupabaseAdmin.getTable('tenants').find(t => t.id === tenantId)?.plan).toBe('trial');
  });
});

describe('Billing history and credit packs', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('lists only the caller\'s tenant billing history', async () => {
    const tenantA = makeTenant();
    fakeSupabaseAdmin.seed('billing_events', [{ id: 'ha', tenant_id: tenantA, event_type: 'checkout_created', status: 'paid', created_at: new Date().toISOString() }]);
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('billing_events', [{ id: 'hb', tenant_id: tenantB, event_type: 'checkout_created', status: 'paid', created_at: new Date().toISOString() }]);
    const { token } = makeUser(tenantA);

    const res = await request(app).get('/api/billing/history').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((e: any) => e.id === 'ha')).toBe(true);
    expect(res.body.some((e: any) => e.id === 'hb')).toBe(false);
  });

  it('lists the available credit packs', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/billing/credits/packs').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.id === 'pack_10' && p.amount_cents === 1000)).toBe(true);
  });

  it('buys a credit pack, recording a pending billing_event', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    mockStancerFetch({ '/customers': { id: 'cus_2' }, '/payments': { id: 'pay_2' } });

    const res = await request(app).post('/api/billing/credits/checkout').set(authHeader(token)).send({ pack_id: 'pack_25' });
    expect(res.status).toBe(200);
    const event = fakeSupabaseAdmin.getTable('billing_events').find(e => e.stancer_payment_id === 'pay_2');
    expect(event?.tenant_id).toBe(tenantId);
    expect(event?.credit_pack_id).toBe('pack_25');
    expect(event?.amount).toBe(2500);
  });

  it('rejects an invalid credit pack', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/billing/credits/checkout').set(authHeader(token)).send({ pack_id: 'pack_999' });
    expect(res.status).toBe(400);
  });
});
