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

  it('rejects creating a proposal against another tenant\'s client_id', async () => {
    const otherTenant = makeTenant();
    fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-other', tenant_id: otherTenant, first_name: 'Autre', last_name: 'Cabinet' }]);
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/proposals').set(authHeader(token)).send({ title: 'Devis suspect', client_id: 'contact-other' });

    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('proposals').some(pr => pr.client_id === 'contact-other')).toBe(false);
  });

  it('rejects re-attaching a proposal to another tenant\'s client_id on update', async () => {
    const otherTenant = makeTenant();
    fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-other-2', tenant_id: otherTenant, first_name: 'Autre', last_name: 'Cabinet' }]);
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('proposals', [{ id: 'p-reparent', tenant_id: tenantId, title: 'Devis', status: 'Draft' }]);

    const res = await request(app).put('/api/proposals/p-reparent').set(authHeader(token)).send({ title: 'Devis', client_id: 'contact-other-2' });

    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('proposals').find(pr => pr.id === 'p-reparent')?.client_id).not.toBe('contact-other-2');
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
  it('lists invoices with the project name but not the line items (see GET /api/invoices/:id)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj1', tenant_id: tenantId, name: 'Villa' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv1', tenant_id: tenantId, project_id: 'proj1', invoice_number: 'FAC-001', projects: { name: 'Villa' } }]);
    fakeSupabaseAdmin.seed('invoice_items', [{ id: 'it1', tenant_id: tenantId, invoice_id: 'inv1', description: 'Honoraires', quantity: 1, unit_price: 1000 }]);

    const res = await request(app).get('/api/invoices').set(authHeader(token));
    expect(res.status).toBe(200);
    const inv = res.body.find((i: any) => i.id === 'inv1');
    expect(inv.project_name).toBe('Villa');
    // The list dropped the `invoice_items(*)` fan-out (see CLAUDE.md,
    // "pagination et fan-out") — items live only on the per-invoice detail
    // route now, checked below.
    expect(inv.items).toBeUndefined();
    expect(fakeSupabaseAdmin.getTable('invoice_items').some(i => i.invoice_id === 'inv1')).toBe(true);
  });

  it('GET /api/invoices/:id returns the single invoice with its items', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj1', tenant_id: tenantId, name: 'Villa' }]);
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv1', tenant_id: tenantId, project_id: 'proj1', invoice_number: 'FAC-001', projects: { name: 'Villa' } }]);
    fakeSupabaseAdmin.seed('invoice_items', [{ id: 'it1', tenant_id: tenantId, invoice_id: 'inv1', description: 'Honoraires', quantity: 1, unit_price: 1000 }]);

    const res = await request(app).get('/api/invoices/inv1').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.project_name).toBe('Villa');
    // Not asserting on res.body.items — same embedded-relation limitation as
    // the list test above (the fake doesn't resolve `invoice_items(*)`).
    expect(fakeSupabaseAdmin.getTable('invoice_items').some(i => i.invoice_id === 'inv1')).toBe(true);
  });

  it('never returns another tenant\'s invoice on GET /api/invoices/:id', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-detail-b', tenant_id: tenantB, invoice_number: 'SECRET' }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).get('/api/invoices/inv-detail-b').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('paginates the invoice list with an opaque cursor when limit is passed', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('invoices', [
      { id: 'inv-page-a', tenant_id: tenantId, invoice_number: 'A', created_at: '2026-01-01T00:00:00Z' },
      { id: 'inv-page-b', tenant_id: tenantId, invoice_number: 'B', created_at: '2026-01-02T00:00:00Z' },
      { id: 'inv-page-c', tenant_id: tenantId, invoice_number: 'C', created_at: '2026-01-03T00:00:00Z' },
    ]);

    const page1 = await request(app).get('/api/invoices?limit=2').set(authHeader(token));
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app).get(`/api/invoices?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`).set(authHeader(token));
    expect(page2.status).toBe(200);
    const ids1 = page1.body.data.map((i: any) => i.id);
    const ids2 = page2.body.data.map((i: any) => i.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
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

  // invoices.client_id (supabase/migrate_invoice_client_link.sql) — the
  // Maître d'Ouvrage a facture is billed to, independent of project_id (see
  // CLAUDE.md's "Le Maître d'Ouvrage d'une facture").
  describe('client_id (Maître d\'Ouvrage)', () => {
    it('defaults an invoice\'s client_id from its project when none is supplied', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('projects', [{ id: 'proj-c1', tenant_id: tenantId, name: 'Villa', client_id: 'contact-c1' }]);
      fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-c1', tenant_id: tenantId, first_name: 'Jean', last_name: 'Dupont', siret: '12345678900011' }]);

      const res = await request(app).post('/api/invoices').set(authHeader(token)).send({ project_id: 'proj-c1', amount: 100 });
      expect(res.status).toBe(201);
      expect(res.body.client_id).toBe('contact-c1');
    });

    it('an explicitly supplied client_id wins over the project\'s own client', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('projects', [{ id: 'proj-c2', tenant_id: tenantId, name: 'Villa', client_id: 'contact-project' }]);
      fakeSupabaseAdmin.seed('contacts', [
        { id: 'contact-project', tenant_id: tenantId, first_name: 'Projet', last_name: 'Client' },
        { id: 'contact-chosen', tenant_id: tenantId, first_name: 'Choisi', last_name: 'Manuellement' },
      ]);

      const res = await request(app).post('/api/invoices').set(authHeader(token)).send({ project_id: 'proj-c2', client_id: 'contact-chosen', amount: 100 });
      expect(res.status).toBe(201);
      expect(res.body.client_id).toBe('contact-chosen');
    });

    it('rejects a client_id belonging to another tenant, on create and on update', async () => {
      const otherTenant = makeTenant();
      fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-other', tenant_id: otherTenant, first_name: 'Autre', last_name: 'Cabinet' }]);
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-client-guard', tenant_id: tenantId, amount: 100 }]);

      const created = await request(app).post('/api/invoices').set(authHeader(token)).send({ amount: 100, client_id: 'contact-other' });
      expect(created.status).toBe(400);

      const updated = await request(app).put('/api/invoices/inv-client-guard').set(authHeader(token)).send({ client_id: 'contact-other' });
      expect(updated.status).toBe(400);
      expect(fakeSupabaseAdmin.getTable('invoices').find(i => i.id === 'inv-client-guard')?.client_id).not.toBe('contact-other');
    });

    it('client_id stays editable even once the invoice is locked (Sent) — same rationale as project_id', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-fix', tenant_id: tenantId, first_name: 'Bon', last_name: 'Contact' }]);
      fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-locked-client', tenant_id: tenantId, status: 'Sent', amount: 500, description: 'Facture envoyée' }]);

      const res = await request(app).put('/api/invoices/inv-locked-client').set(authHeader(token)).send({ client_id: 'contact-fix' });
      expect(res.status).toBe(200);
      expect(res.body.client_id).toBe('contact-fix');
    });

    it('GET /api/invoices/:id joins the client\'s legal details (name, SIRET, address, phone)', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('contacts', [{
        id: 'contact-full', tenant_id: tenantId, first_name: '', last_name: '', company_name: 'SCI Duval',
        siret: '98765432100019', address: '10 rue de la Paix', city: 'Paris', zip: '75002', phone: '0102030405', email: 'contact@sciduval.fr',
      }]);
      fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-with-client', tenant_id: tenantId, client_id: 'contact-full', invoice_number: 'FAC-100' }]);

      const res = await request(app).get('/api/invoices/inv-with-client').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.client).toMatchObject({
        name: 'SCI Duval', siret: '98765432100019', address: '10 rue de la Paix',
        city: 'Paris', zip: '75002', phone: '0102030405', email: 'contact@sciduval.fr',
      });
    });

    it('GET /api/invoices/:id returns a null client when the invoice has no project and no client_id', async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('invoices', [{ id: 'inv-no-client', tenant_id: tenantId, invoice_number: 'FAC-101' }]);

      const res = await request(app).get('/api/invoices/inv-no-client').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.client).toBeNull();
    });
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
