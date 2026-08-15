// Phase 7 batch 8: end-to-end Supertest coverage for the domains extracted
// into server/routes/{timeTracking,leave}.ts — confirms the extraction
// didn't change behavior and that tenantScopedFrom() still enforces tenant
// isolation, alongside the RBAC helpers (requireManagerOf/resolveReportIds/
// isAdmin/requireTenantAdmin) that stayed in server.ts and are now passed
// into these modules as dependencies.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function setManager(userId: string, managerId: string) {
  const profile = fakeSupabaseAdmin.getTable('profiles').find(p => p.id === userId);
  if (profile) profile.manager_id = managerId;
}

describe('Time Tracking — clock in/out', () => {
  it('clocks in, reports the open entry, then clocks out', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const clockedIn = await request(app).post('/api/time_entries/clock-in').set(authHeader(token)).send({});
    expect(clockedIn.status).toBe(201);

    const current = await request(app).get('/api/time_entries/current').set(authHeader(token));
    expect(current.body?.id).toBe(clockedIn.body.id);
    expect(current.body?.end_time).toBeFalsy();

    const dupe = await request(app).post('/api/time_entries/clock-in').set(authHeader(token)).send({});
    expect(dupe.status).toBe(409);

    const clockedOut = await request(app).post('/api/time_entries/clock-out').set(authHeader(token));
    expect(clockedOut.status).toBe(200);

    const currentAfter = await request(app).get('/api/time_entries/current').set(authHeader(token));
    expect(currentAfter.body).toBeNull();

    const dupeOut = await request(app).post('/api/time_entries/clock-out').set(authHeader(token));
    expect(dupeOut.status).toBe(404);
  });
});

describe('Time Tracking — manual entries', () => {
  it('creates, lists, updates, and deletes a manual entry', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/time_entries').set(authHeader(token)).send({
      entry_date: '2026-03-02', start_time: '2026-03-02T09:00:00Z', end_time: '2026-03-02T17:00:00Z', description: 'Chantier',
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const listed = await request(app).get('/api/time_entries').query({ start_date: '2026-03-01', end_date: '2026-03-03' }).set(authHeader(token));
    expect(listed.body.some((e: any) => e.id === id)).toBe(true);

    const updated = await request(app).put(`/api/time_entries/${id}`).set(authHeader(token)).send({
      entry_date: '2026-03-02', start_time: '2026-03-02T09:00:00Z', end_time: '2026-03-02T18:00:00Z', description: 'Chantier (prolongé)',
    });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('time_entries').find(e => e.id === id)?.description).toBe('Chantier (prolongé)');

    const deleted = await request(app).delete(`/api/time_entries/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('time_entries').find(e => e.id === id)).toBeUndefined();
  });

  it('rejects an entry with missing fields or end_time before start_time', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const missing = await request(app).post('/api/time_entries').set(authHeader(token)).send({ entry_date: '2026-03-02' });
    expect(missing.status).toBe(400);

    const backwards = await request(app).post('/api/time_entries').set(authHeader(token)).send({
      entry_date: '2026-03-02', start_time: '2026-03-02T17:00:00Z', end_time: '2026-03-02T09:00:00Z',
    });
    expect(backwards.status).toBe(400);
  });

  it('computes weekly-summary total hours correctly', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    await request(app).post('/api/time_entries').set(authHeader(token)).send({
      entry_date: '2026-03-02', start_time: '2026-03-02T09:00:00Z', end_time: '2026-03-02T17:00:00Z',
    });

    const res = await request(app).get('/api/time_entries/weekly-summary').query({ week_start: '2026-03-02' }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.total_hours).toBe(8);
  });

  it('lets a manager edit a direct report\'s entry, but not an unrelated employee\'s', async () => {
    const tenantId = makeTenant();
    const { userId: managerId, token: managerToken } = makeUser(tenantId);
    const { userId: reportId, token: reportToken } = makeUser(tenantId);
    const { token: strangerToken } = makeUser(tenantId);
    setManager(reportId, managerId);

    const created = await request(app).post('/api/time_entries').set(authHeader(reportToken)).send({
      entry_date: '2026-03-02', start_time: '2026-03-02T09:00:00Z', end_time: '2026-03-02T17:00:00Z',
    });
    const entryId = created.body.id;

    const byManager = await request(app).put(`/api/time_entries/${entryId}`).set(authHeader(managerToken)).send({
      entry_date: '2026-03-02', start_time: '2026-03-02T09:00:00Z', end_time: '2026-03-02T16:00:00Z', description: 'Ajusté par le manager',
    });
    expect(byManager.status).toBe(200);

    const byStranger = await request(app).put(`/api/time_entries/${entryId}`).set(authHeader(strangerToken)).send({
      entry_date: '2026-03-02', start_time: '2026-03-02T09:00:00Z', end_time: '2026-03-02T10:00:00Z',
    });
    expect(byStranger.status).toBe(403);
  });
});

describe('Time Tracking — admin/manager-only aggregate endpoints', () => {
  it('rejects team-summary and team-schedule for a caller with no reports and no admin role', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const summary = await request(app).get('/api/time_entries/team-summary').query({ week_start: '2026-03-02' }).set(authHeader(token));
    expect(summary.status).toBe(403);

    const schedule = await request(app).get('/api/time_entries/team-schedule').query({ week_start: '2026-03-02' }).set(authHeader(token));
    expect(schedule.status).toBe(403);
  });

  it('rejects admin-matrix and monthly-summary for a non-admin', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const matrix = await request(app).get('/api/time_entries/admin-matrix').query({ start_date: '2026-03-01', end_date: '2026-03-31' }).set(authHeader(token));
    expect(matrix.status).toBe(403);

    const monthly = await request(app).get('/api/time_entries/monthly-summary').query({ month: '2026-03' }).set(authHeader(token));
    expect(monthly.status).toBe(403);
  });

  it('lets an admin fetch the monthly-summary for the whole tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const res = await request(app).get('/api/time_entries/monthly-summary').query({ month: '2026-03' }).set(authHeader(token));
    expect(res.status).toBe(200);
  });
});

describe('Leave requests', () => {
  it('creates a leave request with computed business_days', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/leave_requests').set(authHeader(token)).send({
      leave_type: 'conges_payes', start_date: '2026-03-02', end_date: '2026-03-06',
    });
    expect(res.status).toBe(201);
    expect(res.body.business_days).toBe(5); // Mon–Fri
  });

  it('rejects an invalid leave_type or end_date before start_date', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const badType = await request(app).post('/api/leave_requests').set(authHeader(token)).send({ leave_type: 'vacances', start_date: '2026-03-02', end_date: '2026-03-03' });
    expect(badType.status).toBe(400);

    const badRange = await request(app).post('/api/leave_requests').set(authHeader(token)).send({ leave_type: 'rtt', start_date: '2026-03-06', end_date: '2026-03-02' });
    expect(badRange.status).toBe(400);
  });

  // businessDaysBetween used to walk the range one day at a time with no
  // upper bound — a multi-century span would block the event loop for the
  // life of the request. Also covers the unparseable-date branch.
  it('rejects a leave request spanning an implausible number of years', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/leave_requests').set(authHeader(token)).send({
      leave_type: 'rtt', start_date: '1900-01-01', end_date: '2900-01-01',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a leave request with an unparseable date', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const res = await request(app).post('/api/leave_requests').set(authHeader(token)).send({
      leave_type: 'rtt', start_date: 'not-a-date', end_date: '2026-03-02',
    });
    expect(res.status).toBe(400);
  });

  it('lets a manager approve a direct report\'s request, and rejects a second decision on the same request', async () => {
    const tenantId = makeTenant();
    const { userId: managerId, token: managerToken } = makeUser(tenantId);
    const { userId: reportId, token: reportToken } = makeUser(tenantId);
    setManager(reportId, managerId);

    const created = await request(app).post('/api/leave_requests').set(authHeader(reportToken)).send({
      leave_type: 'rtt', start_date: '2026-03-02', end_date: '2026-03-02',
    });
    const requestId = created.body.id;

    const approved = await request(app).patch(`/api/leave_requests/${requestId}/status`).set(authHeader(managerToken)).send({ status: 'approved' });
    expect(approved.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('leave_requests').find(r => r.id === requestId)?.status).toBe('approved');

    const decidedAgain = await request(app).patch(`/api/leave_requests/${requestId}/status`).set(authHeader(managerToken)).send({ status: 'rejected' });
    expect(decidedAgain.status).toBe(404);
  });

  it('never lets an unrelated employee decide on someone else\'s leave request', async () => {
    const tenantId = makeTenant();
    const { userId: reportId, token: reportToken } = makeUser(tenantId);
    const { token: strangerToken } = makeUser(tenantId);

    const created = await request(app).post('/api/leave_requests').set(authHeader(reportToken)).send({
      leave_type: 'rtt', start_date: '2026-03-02', end_date: '2026-03-02',
    });

    const res = await request(app).patch(`/api/leave_requests/${created.body.id}/status`).set(authHeader(strangerToken)).send({ status: 'approved' });
    expect(res.status).toBe(403);
  });

  it('lets the requester cancel their own pending request but not once it\'s already decided', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const created = await request(app).post('/api/leave_requests').set(authHeader(token)).send({
      leave_type: 'rtt', start_date: '2026-03-02', end_date: '2026-03-02',
    });

    const cancelled = await request(app).delete(`/api/leave_requests/${created.body.id}`).set(authHeader(token));
    expect(cancelled.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('leave_requests').find(r => r.id === created.body.id)?.status).toBe('cancelled');

    const created2 = await request(app).post('/api/leave_requests').set(authHeader(token)).send({
      leave_type: 'rtt', start_date: '2026-03-09', end_date: '2026-03-09',
    });
    fakeSupabaseAdmin.getTable('leave_requests').find(r => r.id === created2.body.id)!.status = 'approved';
    const cancelApproved = await request(app).delete(`/api/leave_requests/${created2.body.id}`).set(authHeader(token));
    expect(cancelApproved.status).toBe(400);
  });

  it('never lists another tenant\'s leave requests', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('leave_requests', [{ id: 'lr-b', tenant_id: tenantB, user_id: 'victim', leave_type: 'rtt', status: 'pending', start_date: '2026-03-02', end_date: '2026-03-02', business_days: 1 }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);
    const res = await request(app).get('/api/leave_requests').query({ user_id: 'victim' }).set(authHeader(token));
    // requireManagerOf looks up 'victim' scoped to tenantA and finds nothing, so this
    // acts as an unrelated employee and is rejected — never leaks tenant B's request.
    expect(res.status).toBe(403);
  });
});

describe('Leave balances', () => {
  it('computes remaining days from tenant defaults minus approved requests', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, default_leave_days_conges_payes: 25, default_leave_days_rtt: 10 }]);
    fakeSupabaseAdmin.seed('leave_requests', [{ id: 'lr1', tenant_id: tenantId, user_id: userId, leave_type: 'conges_payes', business_days: 5, start_date: '2026-01-10', status: 'approved' }]);

    const res = await request(app).get('/api/leave_balances').query({ year: 2026 }).set(authHeader(token));
    expect(res.status).toBe(200);
    const conges = res.body.find((b: any) => b.leave_type === 'conges_payes');
    expect(conges.allocated_days).toBe(25);
    expect(conges.used_days).toBe(5);
    expect(conges.remaining_days).toBe(20);
  });

  it('requires admin for leave_balances/all and for setting an override', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const all = await request(app).get('/api/leave_balances/all').query({ year: 2026 }).set(authHeader(token));
    expect(all.status).toBe(403);

    const put = await request(app).put('/api/leave_balances').set(authHeader(token)).send({ user_id: 'x', year: 2026, leave_type: 'rtt', allocated_days: 12 });
    expect(put.status).toBe(403);
  });

  it('lets an admin set and then update a balance override (upsert)', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId, 'admin');

    const created = await request(app).put('/api/leave_balances').set(authHeader(token)).send({ user_id: userId, year: 2026, leave_type: 'rtt', allocated_days: 12 });
    expect(created.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('leave_balances').filter(b => b.user_id === userId && b.year === 2026 && b.leave_type === 'rtt')).toHaveLength(1);

    const updated = await request(app).put('/api/leave_balances').set(authHeader(token)).send({ user_id: userId, year: 2026, leave_type: 'rtt', allocated_days: 15 });
    expect(updated.status).toBe(200);
    const rows = fakeSupabaseAdmin.getTable('leave_balances').filter(b => b.user_id === userId && b.year === 2026 && b.leave_type === 'rtt');
    expect(rows).toHaveLength(1);
    expect(rows[0].allocated_days).toBe(15);
  });
});
