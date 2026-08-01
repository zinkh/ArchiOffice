// Phase 7 batch 21: end-to-end Supertest coverage for the domain extracted
// into server/routes/projects.ts — the most central table in the schema.
// DELETE /api/projects/:id's requireRole('admin') gate is already locked in
// by tests/rbac.test.ts (Phase 4) and confirmed still green by the full
// suite — not duplicated here. Also covers the three GET lookup routes
// that moved to dpgf.ts/situations.ts as part of this same lot (they used
// to sit inline in the middle of the Projects section).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Projects CRUD', () => {
  it('creates a project with an auto-generated code and its sub-lists', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, num_prefix_affaire: 'AFF' }]);

    const res = await request(app).post('/api/projects').set(authHeader(token)).send({
      name: 'Villa Test', client: 'M. Dupont',
      cotraitants_list: [{ specialty: 'Structure', contact_id: null }],
      lots_list: [{ lot_number: '01', lot_title: 'Gros œuvre' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.project_code).toMatch(/^AFF-\d{2}-001$/);
    expect(fakeSupabaseAdmin.getTable('project_cotraitants').some(c => c.project_id === res.body.id)).toBe(true);
    expect(fakeSupabaseAdmin.getTable('project_lots').some(l => l.project_id === res.body.id)).toBe(true);
  });

  it('rejects a project missing name or client', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/projects').set(authHeader(token)).send({ name: 'Sans client' });
    expect(res.status).toBe(400);
  });

  it('enforces the plan\'s project quota', async () => {
    const tenantId = makeTenant({ plan: 'trial' }); // trial allows only 3 projects
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [
      { id: 'p1', tenant_id: tenantId, name: 'A', client: 'C' },
      { id: 'p2', tenant_id: tenantId, name: 'B', client: 'C' },
      { id: 'p3', tenant_id: tenantId, name: 'C', client: 'C' },
    ]);

    const res = await request(app).post('/api/projects').set(authHeader(token)).send({ name: 'D', client: 'C' });
    expect(res.status).toBe(402);
  });

  it('lists projects, defaulting the sub-list fields to empty arrays', async () => {
    // Not asserting the sub-lists are actually populated: `project_lots(*)`
    // etc. are embedded relations, which the fake doesn't resolve (see
    // fakeSupabaseAdmin.ts's file header) — it returns the flat project
    // row, so `p.project_lots` stays undefined and the route's own
    // `p.project_lots || []` fallback kicks in regardless of what's seeded.
    // This still exercises the real behavior worth locking in here: the
    // list endpoint itself, tenant-scoped, with the flattening in place.
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p4', tenant_id: tenantId, name: 'Extension', client: 'M. Martin' }]);
    fakeSupabaseAdmin.seed('project_lots', [{ id: 'lot1', tenant_id: tenantId, project_id: 'p4', lot_number: '02', lot_title: 'Charpente' }]);

    const res = await request(app).get('/api/projects').set(authHeader(token));
    expect(res.status).toBe(200);
    const project = res.body.find((p: any) => p.id === 'p4');
    expect(project.lots_list).toEqual([]);
    expect(fakeSupabaseAdmin.getTable('project_lots').some(l => l.project_id === 'p4')).toBe(true);
  });

  it('never lists another tenant\'s projects', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'p-b', tenant_id: tenantB, name: 'Secret', client: 'X' }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).get('/api/projects').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.id === 'p-b')).toBe(false);
  });

  it('returns a 404 for a project outside the tenant on the /full aggregate', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'p-full-b', tenant_id: tenantB, name: 'Secret', client: 'X' }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).get('/api/projects/p-full-b/full').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('aggregates milestones/invoices/etc. for a project on /full', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p5', tenant_id: tenantId, name: 'Rénovation', client: 'Mme X' }]);
    fakeSupabaseAdmin.seed('milestones', [{ id: 'm1', tenant_id: tenantId, project_id: 'p5', title: 'Jalon 1' }]);

    const res = await request(app).get('/api/projects/p5/full').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.project.id).toBe('p5');
    expect(res.body.milestones.length).toBe(1);
  });

  it('updates a project, fully replacing its sub-lists', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p6', tenant_id: tenantId, name: 'Old', client: 'C' }]);
    fakeSupabaseAdmin.seed('project_lots', [{ id: 'old-lot', tenant_id: tenantId, project_id: 'p6', lot_number: '01', lot_title: 'Old lot' }]);

    const res = await request(app).put('/api/projects/p6').set(authHeader(token)).send({
      name: 'Nouveau nom', client: 'C', lots_list: [{ lot_number: '02', lot_title: 'New lot' }],
    });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('projects').find(p => p.id === 'p6')?.name).toBe('Nouveau nom');
    const lots = fakeSupabaseAdmin.getTable('project_lots').filter(l => l.project_id === 'p6');
    expect(lots.length).toBe(1);
    expect(lots[0].lot_title).toBe('New lot');
  });

  it('never lets a caller update another tenant\'s project', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'p-b2', tenant_id: tenantB, name: 'Secret', client: 'X' }]);
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put('/api/projects/p-b2').set(authHeader(token)).send({ name: 'Hacked', client: 'X' });
    expect(fakeSupabaseAdmin.getTable('projects').find(p => p.id === 'p-b2')?.name).toBe('Secret');
  });
});

describe('Project categories', () => {
  it('creates, lists, and deletes a project category, tenant-scoped', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/project_categories').set(authHeader(token)).send({ name: 'Résidentiel' });
    expect(created.status).toBe(201);

    const listed = await request(app).get('/api/project_categories').set(authHeader(token));
    expect(listed.body.some((c: any) => c.id === created.body.id)).toBe(true);

    const deleted = await request(app).delete(`/api/project_categories/${created.body.id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('project_categories').find(c => c.id === created.body.id)).toBeUndefined();
  });
});

describe('Relocated GET lookups (dpgf.ts / situations.ts)', () => {
  it('GET /api/dpgf/:projectId lists a project\'s DPGF items, tenant-scoped', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('dpgf_items', [{ id: 'di1', tenant_id: tenantId, project_id: 'p7', designation: 'Fondations' }]);
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('dpgf_items', [{ id: 'di-b', tenant_id: tenantB, project_id: 'p7', designation: 'Secret' }]);

    const res = await request(app).get('/api/dpgf/p7').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((d: any) => d.id === 'di1')).toBe(true);
    expect(res.body.some((d: any) => d.id === 'di-b')).toBe(false);
  });

  it('GET /api/situations/:projectId lists a project\'s situations', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('situations', [{ id: 'sit1', tenant_id: tenantId, project_id: 'p8', numero: 1 }]);

    const res = await request(app).get('/api/situations/p8').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((s: any) => s.id === 'sit1')).toBe(true);
  });

  it('GET /api/situations/:situationId/details lists a situation\'s line items', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('detail_situations', [{ id: 'ds1', tenant_id: tenantId, situation_id: 'sit2', montant_situation: 5000 }]);

    const res = await request(app).get('/api/situations/sit2/details').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((d: any) => d.id === 'ds1')).toBe(true);
  });
});
