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

describe('PUT /api/invoices/:id — sent-invoice content lock and project attachment', () => {
  let app: Express;

  beforeAll(async () => {
    app = await getTestApp();
  });

  it('rejects a content change on a Sent invoice with 409 and a French explanation', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    fakeSupabaseAdmin.seed('invoices', [{
      id: 'inv-sent', tenant_id: tenantId, invoice_number: 'FAC-001', status: 'Sent',
      amount: 1000, description: 'Honoraires phase 1', due_date: '2026-01-01',
    }]);

    const res = await request(app)
      .put('/api/invoices/inv-sent')
      .set(authHeader(token))
      .send({ amount: 2000 });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('déjà été envoyée');
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-sent')?.amount).toBe(1000);
  });

  it('allows a status-only update on a Sent invoice without wiping its amount/description (partial-update merge)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    fakeSupabaseAdmin.seed('invoices', [{
      id: 'inv-sent-2', tenant_id: tenantId, invoice_number: 'FAC-002', status: 'Sent',
      amount: 1500, description: 'Honoraires phase 2', due_date: '2026-02-01',
    }]);

    const res = await request(app)
      .put('/api/invoices/inv-sent-2')
      .set(authHeader(token))
      .send({ status: 'Paid' });

    expect(res.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-sent-2');
    expect(row?.status).toBe('Paid');
    expect(row?.amount).toBe(1500);
    expect(row?.description).toBe('Honoraires phase 2');
  });

  it('attaches a Zoho-imported (project-less) invoice to a project without touching its amount', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-1', tenant_id: tenantId, name: 'Villa Dupont', project_code: '26014' }]);
    fakeSupabaseAdmin.seed('invoices', [{
      id: 'inv-zoho', tenant_id: tenantId, invoice_number: 'ZOHO-9', status: 'Sent',
      project_id: null, amount: 800, description: 'Zoho import', zoho_invoice_id: 'z-9',
    }]);

    const res = await request(app)
      .put('/api/invoices/inv-zoho')
      .set(authHeader(token))
      .send({ project_id: 'proj-1' });

    expect(res.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-zoho');
    expect(row?.project_id).toBe('proj-1');
    expect(row?.amount).toBe(800);
  });

  it('assigns a local affaire_invoice_number, independent of Zoho, when attaching an acompte invoice to a project', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-2', tenant_id: tenantId, name: 'Extension Martin', project_code: '26020' }]);
    // One acompte invoice already exists on the project — the new local
    // number must account for it (sequence continues at 02).
    fakeSupabaseAdmin.seed('invoices', [
      { id: 'inv-existing-aco', tenant_id: tenantId, project_id: 'proj-2', invoice_type: 'acompte', status: 'Paid', amount: 500 },
      { id: 'inv-draft-aco', tenant_id: tenantId, status: 'Draft', invoice_type: 'acompte', amount: 300, project_id: null },
    ]);

    const res = await request(app)
      .put('/api/invoices/inv-draft-aco')
      .set(authHeader(token))
      .send({ project_id: 'proj-2' });

    expect(res.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-draft-aco');
    expect(row?.project_id).toBe('proj-2');
    expect(row?.affaire_invoice_number).toBe('26020-ACO-02');
  });

  it('allows recategorizing a Sent invoice as acompte (local billing) without unlocking its amount', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-3', tenant_id: tenantId, name: 'Rénovation Petit', project_code: '26030' }]);
    fakeSupabaseAdmin.seed('invoices', [{
      id: 'inv-sent-zoho', tenant_id: tenantId, status: 'Sent', invoice_type: 'standard',
      amount: 600, description: 'Zoho import', project_id: null,
    }]);

    const res = await request(app)
      .put('/api/invoices/inv-sent-zoho')
      .set(authHeader(token))
      .send({ project_id: 'proj-3', invoice_type: 'acompte' });

    expect(res.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-sent-zoho');
    expect(row?.invoice_type).toBe('acompte');
    expect(row?.project_id).toBe('proj-3');
    expect(row?.affaire_invoice_number).toBe('26030-ACO-01');
    expect(row?.amount).toBe(600);
  });
});
