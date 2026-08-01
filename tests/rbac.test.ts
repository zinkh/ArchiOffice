// Regression tests for Phase 4: DELETE /api/projects/:id used to trust a
// client-supplied `x-user-role` header instead of a database-verified role —
// any authenticated caller could delete another project in their own tenant
// (cascading to project_team/milestones/specifications/project_cotraitants)
// by simply adding that header. It's now gated by the requireRole('admin')
// middleware, which only ever reads profiles.system_role. Also covers a
// route already protected by the pre-existing requireTenantAdmin() helper,
// as a non-regression check.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('DELETE /api/projects/:id — requireRole(admin), not the x-user-role header', () => {
  it('rejects a non-admin caller even if they send x-user-role: admin', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    const projectId = 'project-1';
    fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa Dupont' }]);

    const res = await request(app)
      .delete(`/api/projects/${projectId}`)
      .set(authHeader(token))
      .set('x-user-role', 'admin') // forged — must not matter anymore
      .send();

    expect(res.status).toBe(403);
    expect(fakeSupabaseAdmin.getTable('projects').find(p => p.id === projectId)).toBeDefined();
  });

  it('allows a real admin (verified via profiles.system_role) to delete the project', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const projectId = 'project-2';
    fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa Martin' }]);

    const res = await request(app).delete(`/api/projects/${projectId}`).set(authHeader(token)).send();

    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('projects').find(p => p.id === projectId)).toBeUndefined();
  });

  it('still rejects a non-admin with no forged header at all', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'manager');
    const projectId = 'project-3';
    fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa Bernard' }]);

    const res = await request(app).delete(`/api/projects/${projectId}`).set(authHeader(token)).send();

    expect(res.status).toBe(403);
    expect(fakeSupabaseAdmin.getTable('projects').find(p => p.id === projectId)).toBeDefined();
  });
});

describe('PUT /api/settings — requireTenantAdmin (pre-existing, non-regression check)', () => {
  it('rejects a non-admin caller', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');

    const res = await request(app).put('/api/settings').set(authHeader(token)).send({});

    expect(res.status).toBe(403);
  });

  it('allows an admin caller', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');

    const res = await request(app).put('/api/settings').set(authHeader(token)).send({});

    expect(res.status).toBe(200);
  });
});
