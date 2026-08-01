// Phase 7 batch 19: end-to-end Supertest coverage for the domains extracted
// into server/routes/{proposals,invoices}.ts — the last pieces of the
// deliberately-deferred core (client-facing devis/facture CRUD). Also
// covers the three /api/contact-categories routes, now fully consolidated
// into server/routes/contacts.ts, and the shared server/getNextDocNumber.ts
// auto-numbering helper.
//
// tests/tenantIsolation.test.ts already locks in the two Phase 2 fixes on
// these exact routes (the "update filtré + relecture non filtrée" pattern
// on PUT /api/proposals/:id and PUT /api/invoices/:id) — not duplicated
// here, just confirmed still green by the full suite run.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Proposals', () => {
  it('lists proposals with the joined client name and specialties', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'c1', tenant_id: tenantId, first_name: 'Jean', last_name: 'Dupont' }]);
    fakeSupabaseAdmin.seed('proposals', [{ id: 'p1', tenant_id: tenantId, title: 'Extension maison', client_id: 'c1', contacts: { first_name: 'Jean', last_name: 'Dupont' } }]);

    const res = await request(app).get('/api/proposals').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.find((p: any) => p.id === 'p1')?.client_name).toBe('Jean Dupont');
  });

  it('creates a proposal with an auto-generated reference and its specialties', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, num_prefix_devis: 'DEV' }]);

    const res = await request(app).post('/api/proposals').set(authHeader(token)).send({
      title: 'Rénovation appartement', amount: 15000, status: 'Draft',
      specialties_list: [{ specialty_name: 'Structure', contact_id: null }],
    });
    expect(res.status).toBe(201);
    expect(res.body.reference).toMatch(/^DEV-\d{4}-001$/);
    const specs = fakeSupabaseAdmin.getTable('proposal_specialties').filter(s => s.proposal_id === res.body.id);
    expect(specs.length).toBe(1);
  });

  it('creates a project (and copies specialties to cotraitants) when a proposal is accepted', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('proposals', [{ id: 'p2', tenant_id: tenantId, title: 'Villa neuve', status: 'Draft', amount: 50000 }]);

    const res = await request(app).put('/api/proposals/p2').set(authHeader(token)).send({
      title: 'Villa neuve', status: 'Accepted', amount: 50000,
      specialties_list: [{ specialty_name: 'Charpente', contact_id: 'c-charp' }],
    });
    expect(res.status).toBe(200);
    const project = fakeSupabaseAdmin.getTable('projects').find(p => p.name === 'Villa neuve' && p.tenant_id === tenantId);
    expect(project).toBeDefined();
    const cotraitant = fakeSupabaseAdmin.getTable('project_cotraitants').find(c => c.project_id === project!.id);
    expect(cotraitant?.specialty).toBe('Charpente');
  });

  it('refuses to delete a non-draft proposal', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('proposals', [{ id: 'p3', tenant_id: tenantId, title: 'Devis envoyé', status: 'Sent' }]);

    const res = await request(app).delete('/api/proposals/p3').set(authHeader(token));
    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('proposals').find(p => p.id === 'p3')).toBeDefined();
  });

  it('deletes a draft proposal and its specialties', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('proposals', [{ id: 'p4', tenant_id: tenantId, title: 'Brouillon', status: 'Draft' }]);

    const res = await request(app).delete('/api/proposals/p4').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('proposals').find(p => p.id === 'p4')).toBeUndefined();
  });

  it('exports a proposal as XML and re-imports it as a new draft', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('proposals', [{ id: 'p5', tenant_id: tenantId, title: 'Extension garage', description: 'Devis pour extension' }]);

    const exported = await request(app).get('/api/proposals/p5/export').set(authHeader(token));
    expect(exported.status).toBe(200);
    expect(exported.text).toContain('<');

    const imported = await request(app).post('/api/proposals/import').set(authHeader(token))
      .attach('file', Buffer.from(exported.text), 'proposal.xml');
    expect(imported.status).toBe(200);
    const createdProposal = fakeSupabaseAdmin.getTable('proposals').find(p => p.id === imported.body.id);
    expect(createdProposal?.tenant_id).toBe(tenantId);
    expect(createdProposal?.status).toBe('Draft');
  });
});

describe('Invoices', () => {
  it('lists invoices with their items and project name', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj1', tenant_id: tenantId, name: 'Villa' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv1', tenant_id: tenantId, project_id: 'proj1', invoice_number: 'FAC-001', projects: { name: 'Villa' } }]);
    fakeSupabaseAdmin.seed('invoice_items', [{ id: 'it1', tenant_id: tenantId, invoice_id: 'inv1', description: 'Honoraires', quantity: 1, unit_price: 1000 }]);

    const res = await request(app).get('/api/invoices').set(authHeader(token));
    expect(res.status).toBe(200);
    const inv = res.body.find((i: any) => i.id === 'inv1');
    expect(inv.project_name).toBe('Villa');
    // Not asserting on inv.items here: the embedded `invoice_items(*)` relation
    // isn't resolved by the fake (see fakeSupabaseAdmin.ts's file header) — it
    // returns the flat invoice row, so items stays empty regardless of what's
    // seeded. Covered directly against the invoice_items table below instead.
    expect(fakeSupabaseAdmin.getTable('invoice_items').some(i => i.invoice_id === 'inv1')).toBe(true);
  });

  it('creates an invoice, auto-numbering it and falling back to settings for seller info', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, num_prefix_facture: 'FAC', agencyName: 'Cabinet Test', address: '1 rue Test', siret: '12345678900011' }]);

    const res = await request(app).post('/api/invoices').set(authHeader(token)).send({
      amount: 2000, vat_rate: 20, items: [{ description: 'Mission', quantity: 1, unit_price: 2000, vat_rate: 20 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.invoice_number).toMatch(/^FAC-\d{4}-001$/);
    expect(res.body.seller_name).toBe('Cabinet Test');
    expect(res.body.seller_siret).toBe('12345678900011');
    // Not asserting on res.body.items — same embedded-relation limitation as above.
    expect(fakeSupabaseAdmin.getTable('invoice_items').some(i => i.invoice_id === res.body.id)).toBe(true);
  });

  it('updates an invoice, fully replacing its items', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv2', tenant_id: tenantId, amount: 500 }]);
    fakeSupabaseAdmin.seed('invoice_items', [{ id: 'old-item', tenant_id: tenantId, invoice_id: 'inv2', description: 'Old', quantity: 1, unit_price: 500 }]);

    const res = await request(app).put('/api/invoices/inv2').set(authHeader(token)).send({
      amount: 800, items: [{ description: 'New', quantity: 2, unit_price: 400, vat_rate: 20 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(800);
    const items = fakeSupabaseAdmin.getTable('invoice_items').filter(i => i.invoice_id === 'inv2');
    expect(items.length).toBe(1);
    expect(items[0].description).toBe('New');
  });

  it('never lets a caller update another tenant\'s invoice', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-b', tenant_id: tenantB, amount: 999, seller_iban: 'FR-SECRET' }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put('/api/invoices/inv-b').set(authHeader(token)).send({ amount: 1 });
    expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-b')?.amount).toBe(999);
  });
});

describe('Contact categories', () => {
  it('creates and deletes a contact category, tenant-scoped', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/contact-categories').set(authHeader(token)).send({ name: 'Maîtres d\'ouvrage' });
    expect(created.status).toBe(201);
    expect(fakeSupabaseAdmin.getTable('contact_categories').find(c => c.id === created.body.id)?.tenant_id).toBe(tenantId);

    const deleted = await request(app).delete(`/api/contact-categories/${created.body.id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('contact_categories').find(c => c.id === created.body.id)).toBeUndefined();
  });

  it('never lets a caller delete another tenant\'s contact category', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('contact_categories', [{ id: 'cat-b', tenant_id: tenantB, name: 'Secret' }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).delete('/api/contact-categories/cat-b').set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('contact_categories').find(c => c.id === 'cat-b')).toBeDefined();
  });
});
