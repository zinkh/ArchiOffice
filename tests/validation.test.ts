// Phase 5: schema-level tests for the new Zod validation, plus Supertest
// coverage confirming the middleware is actually wired into the routes and
// rejects malformed payloads with 400 instead of letting them reach Supabase.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { invoiceSchema } from '../src/schemas/invoice.schema';
import { proposalSchema } from '../src/schemas/proposal.schema';
import { createTeamMemberSchema, updateTeamMemberRoleSchema } from '../src/schemas/team.schema';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

describe('invoiceSchema', () => {
  it('accepts a well-formed partial body', () => {
    expect(invoiceSchema.safeParse({ amount: 100, status: 'Draft', vat_rate: 20 }).success).toBe(true);
  });

  it('accepts an empty body (every field optional, matching the route\'s own defaults)', () => {
    expect(invoiceSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a non-numeric amount', () => {
    expect(invoiceSchema.safeParse({ amount: '100' }).success).toBe(false);
  });

  it('rejects a status outside the real enum', () => {
    expect(invoiceSchema.safeParse({ status: 'Cancelled' }).success).toBe(false);
  });

  it('rejects a negative line-item quantity', () => {
    const result = invoiceSchema.safeParse({ items: [{ description: 'x', quantity: -1, unit_price: 10, vat_rate: 20 }] });
    expect(result.success).toBe(false);
  });
});

describe('proposalSchema', () => {
  it('rejects a status outside the real enum', () => {
    expect(proposalSchema.safeParse({ status: 'Cancelled' }).success).toBe(false);
  });

  it('accepts a valid status', () => {
    expect(proposalSchema.safeParse({ status: 'Accepted', amount: 5000 }).success).toBe(true);
  });
});

describe('team schemas', () => {
  it('createTeamMemberSchema requires name and a valid email', () => {
    expect(createTeamMemberSchema.safeParse({ name: 'Alice', email: 'alice@example.test' }).success).toBe(true);
    expect(createTeamMemberSchema.safeParse({ name: '', email: 'alice@example.test' }).success).toBe(false);
    expect(createTeamMemberSchema.safeParse({ name: 'Alice', email: 'not-an-email' }).success).toBe(false);
    expect(createTeamMemberSchema.safeParse({ email: 'alice@example.test' }).success).toBe(false);
  });

  it('updateTeamMemberRoleSchema only accepts the four real system_role values', () => {
    for (const role of ['admin', 'manager', 'pm', 'user']) {
      expect(updateTeamMemberRoleSchema.safeParse({ role }).success).toBe(true);
    }
    expect(updateTeamMemberRoleSchema.safeParse({ role: 'superadmin' }).success).toBe(false);
    expect(updateTeamMemberRoleSchema.safeParse({}).success).toBe(false);
  });
});

describe('validation wired into the routes', () => {
  let app: Express;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it('PUT /api/team/:id/role rejects an invalid role with 400 before it ever reaches the DB', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const { userId: targetId } = makeUser(tenantId, 'user');

    const res = await request(app)
      .put(`/api/team/${targetId}/role`)
      .set(authHeader(token))
      .send({ role: 'superadmin' });

    expect(res.status).toBe(400);
    const target = fakeSupabaseAdmin.getTable('profiles').find(p => p.id === targetId);
    expect(target?.system_role).toBe('user');
  });

  it('PUT /api/team/:id/role accepts a real role and applies it', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const { userId: targetId } = makeUser(tenantId, 'user');

    const res = await request(app)
      .put(`/api/team/${targetId}/role`)
      .set(authHeader(token))
      .send({ role: 'manager' });

    expect(res.status).toBe(200);
    const target = fakeSupabaseAdmin.getTable('profiles').find(p => p.id === targetId);
    expect(target?.system_role).toBe('manager');
  });

  it('POST /api/invoices rejects a non-numeric amount with 400', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');

    const res = await request(app)
      .post('/api/invoices')
      .set(authHeader(token))
      .send({ amount: 'lots of money' });

    expect(res.status).toBe(400);
  });

  it('POST /api/proposals rejects a status outside the enum with 400', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');

    const res = await request(app)
      .post('/api/proposals')
      .set(authHeader(token))
      .send({ title: 'Extension maison', status: 'Cancelled' });

    expect(res.status).toBe(400);
  });
});
