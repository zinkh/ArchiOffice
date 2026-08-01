// Phase 7 batch 18: end-to-end Supertest coverage for the domain extracted
// into server/routes/team.ts — team roster, self-service profile edit,
// admin-only member creation/role/manager changes, and join-request
// approval/rejection. The RBAC helpers (requireTenantAdmin, checkQuota)
// stay defined in server.ts and are injected exactly like leave.ts/
// timeTracking.ts already do.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Team roster and self-profile', () => {
  it('lists the tenant\'s team with camelCased aliases', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('profiles', [{ id: 'colleague', tenant_id: tenantId, name: 'Colleague', email: 'c@example.test', job_title: 'Architecte' }]);

    const res = await request(app).get('/api/team').set(authHeader(token));
    expect(res.status).toBe(200);
    const colleague = res.body.find((p: any) => p.id === 'colleague');
    expect(colleague.jobTitle).toBe('Architecte');
  });

  it('never lists another tenant\'s team members', async () => {
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('profiles', [{ id: 'secret', tenant_id: tenantB, name: 'Secret', email: 's@example.test' }]);

    const res = await request(app).get('/api/team').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.id === 'secret')).toBe(false);
  });

  it('returns the caller\'s own profile from /api/me', async () => {
    const tenantId = makeTenant();
    const { token, userId } = makeUser(tenantId);
    const res = await request(app).get('/api/me').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(userId);
    expect(res.body.tenantId).toBe(tenantId);
  });

  it('lets a user edit their own profile fields without admin rights', async () => {
    const tenantId = makeTenant();
    const { token, userId } = makeUser(tenantId, 'user');
    const res = await request(app).put(`/api/team/${userId}`).set(authHeader(token)).send({ phone: '0102030405', jobTitle: 'Dessinateur' });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === userId)?.phone).toBe('0102030405');
  });

  it('blocks a non-admin from editing someone else\'s profile', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    fakeSupabaseAdmin.seed('profiles', [{ id: 'victim', tenant_id: tenantId, name: 'Victim', email: 'v@example.test' }]);

    const res = await request(app).put('/api/team/victim').set(authHeader(token)).send({ phone: '000' });
    expect(res.status).toBe(403);
    expect(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === 'victim')?.phone).toBeUndefined();
  });
});

describe('Team member creation', () => {
  it('lets an admin create a new team member', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const { token } = makeUser(tenantId, 'admin');

    const res = await request(app).post('/api/team').set(authHeader(token)).send({ name: 'Nouveau', email: 'nouveau@example.test', role: 'Member', system_role: 'user' });
    expect(res.status).toBe(201);
    const created = fakeSupabaseAdmin.getTable('profiles').find(p => p.email === 'nouveau@example.test');
    expect(created?.tenant_id).toBe(tenantId);
    expect(created?.system_role).toBe('user');
  });

  it('rejects creation by a non-admin', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const { token } = makeUser(tenantId, 'user');

    const res = await request(app).post('/api/team').set(authHeader(token)).send({ name: 'X', email: 'x@example.test', role: 'Member', system_role: 'user' });
    expect(res.status).toBe(403);
  });

  it('refuses a duplicate email within the same tenant', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const { token } = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('profiles', [{ id: 'existing', tenant_id: tenantId, email: 'dup@example.test' }]);

    const res = await request(app).post('/api/team').set(authHeader(token)).send({ name: 'Dup', email: 'dup@example.test', role: 'Member', system_role: 'user' });
    expect(res.status).toBe(400);
  });

  it('enforces the plan\'s user quota', async () => {
    const tenantId = makeTenant({ plan: 'trial' }); // trial allows only 1 user
    const { token } = makeUser(tenantId, 'admin'); // already the 1st user

    const res = await request(app).post('/api/team').set(authHeader(token)).send({ name: 'Trop', email: 'trop@example.test', role: 'Member', system_role: 'user' });
    expect(res.status).toBe(402);
  });
});

describe('Role and manager changes', () => {
  it('lets an admin promote a team member to admin', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('profiles', [{ id: 'promotee', tenant_id: tenantId, system_role: 'user', email: 'p@example.test' }]);

    const res = await request(app).put('/api/team/promotee/role').set(authHeader(token)).send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === 'promotee')?.system_role).toBe('admin');
  });

  it('blocks a non-admin from changing roles', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    fakeSupabaseAdmin.seed('profiles', [{ id: 'target', tenant_id: tenantId, system_role: 'user' }]);

    const res = await request(app).put('/api/team/target/role').set(authHeader(token)).send({ role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('lets an admin assign a manager', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('profiles', [
      { id: 'manager1', tenant_id: tenantId, email: 'm@example.test' },
      { id: 'report1', tenant_id: tenantId, email: 'r@example.test' },
    ]);

    const res = await request(app).put('/api/team/report1/manager').set(authHeader(token)).send({ manager_id: 'manager1' });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === 'report1')?.manager_id).toBe('manager1');
  });
});

describe('Join requests', () => {
  it('lists only the tenant\'s own pending join requests', async () => {
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA, 'admin');
    fakeSupabaseAdmin.seed('join_requests', [{ id: 'jr-a', tenant_id: tenantA, user_id: 'u-a', email: 'a@example.test', name: 'A', status: 'pending', created_at: new Date().toISOString() }]);
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('join_requests', [{ id: 'jr-b', tenant_id: tenantB, user_id: 'u-b', email: 'b@example.test', name: 'B', status: 'pending', created_at: new Date().toISOString() }]);

    const res = await request(app).get('/api/team/join-requests').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((r: any) => r.id === 'jr-a')).toBe(true);
    expect(res.body.some((r: any) => r.id === 'jr-b')).toBe(false);
  });

  it('rejects listing by a non-admin', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'user');
    const res = await request(app).get('/api/team/join-requests').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('approves a join request, attaching the requester to the tenant', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const { token } = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('profiles', [{ id: 'requester1', tenant_id: null, email: 'req1@example.test' }]);
    fakeSupabaseAdmin.seed('join_requests', [{ id: 'jr1', tenant_id: tenantId, user_id: 'requester1', email: 'req1@example.test', name: 'Requester', status: 'pending' }]);

    const res = await request(app).post('/api/team/join-requests/jr1/approve').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === 'requester1')?.tenant_id).toBe(tenantId);
    expect(fakeSupabaseAdmin.getTable('join_requests').find(j => j.id === 'jr1')?.status).toBe('approved');
  });

  it('refuses to approve a request for a user already attached to a tenant', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const { token } = makeUser(tenantId, 'admin');
    const otherTenant = makeTenant();
    fakeSupabaseAdmin.seed('profiles', [{ id: 'requester2', tenant_id: otherTenant, email: 'req2@example.test' }]);
    fakeSupabaseAdmin.seed('join_requests', [{ id: 'jr2', tenant_id: tenantId, user_id: 'requester2', email: 'req2@example.test', name: 'Requester2', status: 'pending' }]);

    const res = await request(app).post('/api/team/join-requests/jr2/approve').set(authHeader(token));
    expect(res.status).toBe(409);
    expect(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === 'requester2')?.tenant_id).toBe(otherTenant);
  });

  it('rejects a join request', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('join_requests', [{ id: 'jr3', tenant_id: tenantId, user_id: 'requester3', email: 'req3@example.test', name: 'Requester3', status: 'pending' }]);

    const res = await request(app).post('/api/team/join-requests/jr3/reject').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('join_requests').find(j => j.id === 'jr3')?.status).toBe('rejected');
  });

  it('never lets an admin approve or reject another tenant\'s join request', async () => {
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA, 'admin');
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('join_requests', [{ id: 'jr-cross', tenant_id: tenantB, user_id: 'u-cross', email: 'x@example.test', name: 'X', status: 'pending' }]);

    const res = await request(app).post('/api/team/join-requests/jr-cross/approve').set(authHeader(token));
    expect(res.status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('join_requests').find(j => j.id === 'jr-cross')?.status).toBe('pending');
  });
});
