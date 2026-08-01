// Phase 7 pilot: end-to-end Supertest coverage for the three route domains
// extracted out of server.ts into server/routes/*.ts (project templates,
// ACT data, DET data) — confirms the extraction didn't change behavior, and
// that tenantScopedFrom() (used internally by these routes instead of a
// hand-written `.eq('tenant_id', tenantId)`) still enforces tenant
// isolation end-to-end through the real app.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('project templates', () => {
  it('creates, lists, updates, and deletes a template within one tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/project-templates').set(authHeader(token)).send({ name: 'Maison individuelle' });
    expect(created.status).toBe(201);
    const templateId = created.body.id;

    const listed = await request(app).get('/api/project-templates').set(authHeader(token));
    expect(listed.status).toBe(200);
    expect(listed.body.some((t: any) => t.id === templateId)).toBe(true);

    const updated = await request(app).put(`/api/project-templates/${templateId}`).set(authHeader(token)).send({ name: 'Villa' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Villa');

    const deleted = await request(app).delete(`/api/project-templates/${templateId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('project_templates').find(t => t.id === templateId)).toBeUndefined();
  });

  it('never lists or lets a caller mutate another tenant\'s template', async () => {
    const tenantB = makeTenant();
    const templateId = 'template-b';
    fakeSupabaseAdmin.seed('project_templates', [{ id: templateId, tenant_id: tenantB, name: 'SECRET-TEMPLATE-B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const listed = await request(app).get('/api/project-templates').set(authHeader(token));
    expect(listed.body.some((t: any) => t.id === templateId)).toBe(false);

    await request(app).put(`/api/project-templates/${templateId}`).set(authHeader(token)).send({ name: 'Hacked' });
    expect(fakeSupabaseAdmin.getTable('project_templates').find(t => t.id === templateId)?.name).toBe('SECRET-TEMPLATE-B');

    await request(app).delete(`/api/project-templates/${templateId}`).set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('project_templates').find(t => t.id === templateId)).toBeDefined();
  });
});

describe('ACT data', () => {
  it('creates ACT data on first PUT, then updates the same row on the next PUT', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = 'project-1';

    const first = await request(app).put(`/api/projects/${projectId}/act`).set(authHeader(token)).send({ companies: ['Acme'] });
    expect(first.status).toBe(201);

    const second = await request(app).put(`/api/projects/${projectId}/act`).set(authHeader(token)).send({ companies: ['Acme', 'Beta'] });
    expect(second.status).toBe(200);

    const rows = fakeSupabaseAdmin.getTable('act_data').filter(r => r.project_id === projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].companies).toEqual(['Acme', 'Beta']);
  });

  it('does not let a caller overwrite another tenant\'s ACT data', async () => {
    const tenantB = makeTenant();
    const projectId = 'project-b';
    fakeSupabaseAdmin.seed('act_data', [{ id: 'act-b', tenant_id: tenantB, project_id: projectId, companies: ['Victim'] }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put(`/api/projects/${projectId}/act`).set(authHeader(token)).send({ companies: ['Attacker'] });

    // tenant A has no existing row for this project (it belongs to tenant B), so
    // the route inserts a brand-new tenant-A row rather than touching tenant B's.
    const victimRow = fakeSupabaseAdmin.getTable('act_data').find(r => r.id === 'act-b');
    expect(victimRow?.companies).toEqual(['Victim']);
  });
});

describe('DET data', () => {
  it('creates, updates, and deletes a compte-rendu within one tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = 'project-1';

    const created = await request(app).post(`/api/projects/${projectId}/det`).set(authHeader(token)).send({ info: { title: 'CR n°1' } });
    expect(created.status).toBe(201);
    const crId = created.body.id;

    const updated = await request(app).put(`/api/projects/${projectId}/det/${crId}`).set(authHeader(token)).send({ info: { title: 'CR n°1 (révisé)' } });
    expect(updated.status).toBe(200);

    const deleted = await request(app).delete(`/api/projects/${projectId}/det/${crId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('det_data').find(r => r.id === crId)).toBeUndefined();
  });

  it('never lets a caller mutate another tenant\'s compte-rendu', async () => {
    const tenantB = makeTenant();
    const crId = 'cr-b';
    fakeSupabaseAdmin.seed('det_data', [{ id: crId, tenant_id: tenantB, project_id: 'project-b', info: { title: 'SECRET-CR-B' } }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put(`/api/projects/project-b/det/${crId}`).set(authHeader(token)).send({ info: { title: 'Hacked' } });
    expect((fakeSupabaseAdmin.getTable('det_data').find(r => r.id === crId)?.info as any)?.title).toBe('SECRET-CR-B');

    await request(app).delete(`/api/projects/project-b/det/${crId}`).set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('det_data').find(r => r.id === crId)).toBeDefined();
  });
});
