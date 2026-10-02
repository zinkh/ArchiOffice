// Issue #247 — tenant-wide integrations are shared cabinet configuration.
// Members may read connection status, but only tenant admins may connect,
// disconnect, test, or launch a bulk synchronization.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

const integrations = [
  { name: 'Zoho Invoice', status: '/api/zoho/status', mutate: '/api/zoho/disconnect', method: 'delete' },
  { name: 'Zoho Books', status: '/api/zoho-books/status', mutate: '/api/zoho-books/disconnect', method: 'delete' },
  { name: 'Odoo', status: '/api/odoo/status', mutate: '/api/odoo/disconnect', method: 'delete' },
  { name: 'Ragic', status: '/api/ragic/status', mutate: '/api/ragic/disconnect', method: 'delete' },
  { name: 'Super PDP', status: '/api/superpdp/status', mutate: '/api/superpdp/disconnect', method: 'delete' },
  { name: 'Chorus Pro', status: '/api/chorus-pro/status', mutate: '/api/chorus-pro/disconnect', method: 'delete' },
] as const;

describe('tenant-wide integration RBAC', () => {
  it.each(integrations)('$name: allows a member to read status', async ({ status }) => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId }]);

    const res = await request(app).get(status).set(authHeader(token));

    expect(res.status).toBe(200);
  });

  it.each(integrations)('$name: rejects a non-admin disconnect without changing settings', async ({ mutate, method }) => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    const marker = `keep-${tenantId}`;
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, company_name: marker }]);

    const res = await (request(app) as any)[method](mutate).set(authHeader(token));

    expect(res.status).toBe(403);
    expect(fakeSupabaseAdmin.getTable('settings').find(row => row.tenant_id === tenantId)?.company_name).toBe(marker);
  });
});
