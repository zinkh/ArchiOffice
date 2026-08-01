// Phase 7 batch 2: end-to-end Supertest coverage for the domains extracted
// into server/routes/{dpgf,situations,cctps,customReferences,
// projectMembers,projectPhaseHistory,globalSearch}.ts — confirms the
// extraction didn't change behavior and that tenantScopedFrom() still
// enforces tenant isolation through the real app.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('DPGF (items + parents)', () => {
  it('creates a DPGF and an item within one tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const dpgf = await request(app).post('/api/dpgfs').set(authHeader(token)).send({ project_id: 'p1', title: 'DPGF v1', version: '1' });
    expect(dpgf.status).toBe(201);

    const item = await request(app).post('/api/dpgf').set(authHeader(token)).send({ project_id: 'p1', dpgf_id: dpgf.body.id, description: 'Fouilles' });
    expect(item.status).toBe(201);
    expect(item.body.tenant_id).toBe(tenantId);
  });

  it('never lets a caller update or delete another tenant\'s DPGF', async () => {
    const tenantB = makeTenant();
    const dpgfId = 'dpgf-b';
    fakeSupabaseAdmin.seed('dpgfs', [{ id: dpgfId, tenant_id: tenantB, title: 'SECRET-DPGF-B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put(`/api/dpgfs/${dpgfId}`).set(authHeader(token)).send({ title: 'Hacked' });
    expect(fakeSupabaseAdmin.getTable('dpgfs').find(d => d.id === dpgfId)?.title).toBe('SECRET-DPGF-B');

    await request(app).delete(`/api/dpgfs/${dpgfId}`).set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('dpgfs').find(d => d.id === dpgfId)).toBeDefined();
  });
});

describe('Situations (+ detail lines)', () => {
  it('creates a situation and a detail line within one tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const situation = await request(app).post('/api/situations').set(authHeader(token)).send({ project_id: 'p1', numero: 1 });
    expect(situation.status).toBe(201);

    const detail = await request(app).post('/api/detail-situations').set(authHeader(token)).send({ situation_id: situation.body.id, quantite_realisee: 5 });
    expect(detail.status).toBe(201);
    expect(detail.body.tenant_id).toBe(tenantId);
  });

  it('never lets a caller delete another tenant\'s situation', async () => {
    const tenantB = makeTenant();
    const situationId = 'situation-b';
    fakeSupabaseAdmin.seed('situations', [{ id: situationId, tenant_id: tenantB, numero: 'SECRET-B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).delete(`/api/situations/${situationId}`).set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('situations').find(s => s.id === situationId)).toBeDefined();
  });
});

describe('CCTPs', () => {
  it('updates and deletes a CCTP within one tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const cctpId = 'cctp-1';
    fakeSupabaseAdmin.seed('cctps', [{ id: cctpId, tenant_id: tenantId, title: 'Lot 1' }]);

    const updated = await request(app).put(`/api/cctps/${cctpId}`).set(authHeader(token)).send({ title: 'Lot 1 (révisé)' });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('Lot 1 (révisé)');

    const deleted = await request(app).delete(`/api/cctps/${cctpId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('cctps').find(c => c.id === cctpId)).toBeUndefined();
  });

  it('never lets a caller update another tenant\'s CCTP', async () => {
    const tenantB = makeTenant();
    const cctpId = 'cctp-b';
    fakeSupabaseAdmin.seed('cctps', [{ id: cctpId, tenant_id: tenantB, title: 'SECRET-CCTP-B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put(`/api/cctps/${cctpId}`).set(authHeader(token)).send({ title: 'Hacked' });
    expect(fakeSupabaseAdmin.getTable('cctps').find(c => c.id === cctpId)?.title).toBe('SECRET-CCTP-B');
  });
});

describe('Custom References', () => {
  it('creates, lists, updates, and deletes a reference within one tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/references/custom').set(authHeader(token)).send({ name: 'Villa Dupont' });
    expect(created.status).toBe(201);
    const refId = created.body.id;

    const listed = await request(app).get('/api/references/custom').set(authHeader(token));
    expect(listed.body.some((r: any) => r.id === refId)).toBe(true);

    const updated = await request(app).put(`/api/references/custom/${refId}`).set(authHeader(token)).send({ name: 'Villa Martin' });
    expect(updated.body.name).toBe('Villa Martin');

    const deleted = await request(app).delete(`/api/references/custom/${refId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
  });

  it('bulk-imports references, all stamped with the caller\'s tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/references/custom/bulk').set(authHeader(token)).send({ items: [{ name: 'A' }, { name: 'B' }] });
    expect(res.status).toBe(200);
    expect(res.body.every((r: any) => r.tenant_id === tenantId)).toBe(true);
  });

  it('never lists another tenant\'s reference', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('custom_references', [{ id: 'ref-b', tenant_id: tenantB, name: 'SECRET-REF-B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const listed = await request(app).get('/api/references/custom').set(authHeader(token));
    expect(listed.body.some((r: any) => r.id === 'ref-b')).toBe(false);
  });
});

describe('Project Members', () => {
  it('adds and removes a member within one tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const added = await request(app).post('/api/projects/p1/members').set(authHeader(token)).send({ user_id: 'u1', role: 'lead' });
    expect(added.status).toBe(201);

    const listed = await request(app).get('/api/projects/p1/members').set(authHeader(token));
    expect(listed.body.some((m: any) => m.user_id === 'u1')).toBe(true);

    const removed = await request(app).delete('/api/projects/p1/members/u1').set(authHeader(token));
    expect(removed.status).toBe(200);
  });

  it('never removes another tenant\'s project member', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('project_members', [{ id: 'pm-b', tenant_id: tenantB, project_id: 'project-b', user_id: 'victim' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).delete('/api/projects/project-b/members/victim').set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('project_members').find(m => m.id === 'pm-b')).toBeDefined();
  });
});

describe('Project Phase History', () => {
  it('creates a phase entry, then transitions to a new phase on the next call', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId, name: 'Villa Dupont' }]);

    const first = await request(app).post('/api/projects/p1/phase').set(authHeader(token)).send({ phase: 'ESQ' });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/projects/p1/phase').set(authHeader(token)).send({ phase: 'APS' });
    expect(second.status).toBe(201);

    const history = fakeSupabaseAdmin.getTable('project_phase_history').filter(h => h.project_id === 'p1');
    expect(history).toHaveLength(2);
    expect(history[0].exited_at).not.toBeNull();
    expect(history[1].exited_at).toBeNull();
  });

  it('404s when the project belongs to another tenant', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'project-b', tenant_id: tenantB, name: 'Secret' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).post('/api/projects/project-b/phase').set(authHeader(token)).send({ phase: 'ESQ' });
    expect(res.status).toBe(404);
  });
});

describe('Global Search', () => {
  it('only returns results scoped to the caller\'s tenant', async () => {
    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    fakeSupabaseAdmin.seed('projects', [{ id: 'pA', tenant_id: tenantA, name: 'Villa Dupont' }]);

    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'pB', tenant_id: tenantB, name: 'Villa Dupont Bis' }]);

    const res = await request(app).get('/api/search').query({ q: 'Dupont' }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.projects.some((p: any) => p.id === 'pA')).toBe(true);
    expect(res.body.projects.some((p: any) => p.id === 'pB')).toBe(false);
  });
});
