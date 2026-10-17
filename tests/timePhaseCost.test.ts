// Temps par phase, temps facturable, coût horaire par membre et rentabilité
// par phase (server/routes/timeTracking.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seedProject(tenantId: string) {
  const id = `proj-${Math.random().toString(36).slice(2)}`;
  fakeSupabaseAdmin.seed('projects', [{ id, tenant_id: tenantId, name: 'Villa' }]);
  return id;
}

const manual = (extra: Record<string, any> = {}) => ({
  entry_date: '2026-10-01', start_time: '2026-10-01T08:00:00.000Z', end_time: '2026-10-01T10:00:00.000Z', ...extra,
});

describe('Temps par phase et facturable', () => {
  it('enregistre la phase et le caractère facturable d’une saisie manuelle', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = seedProject(tenantId);
    const res = await request(app).post('/api/time_entries').set(authHeader(token))
      .send(manual({ project_id: projectId, phase: 'aps', billable: false }));
    expect(res.status).toBe(201);
    const row = fakeSupabaseAdmin.getTable('time_entries').find(r => r.id === res.body.id);
    expect(row?.phase).toBe('APS');
    expect(row?.billable).toBe(false);
  });

  it('facturable par défaut, sans phase par défaut', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/time_entries').set(authHeader(token)).send(manual());
    const row = fakeSupabaseAdmin.getTable('time_entries').find(r => r.id === res.body.id);
    expect(row?.phase).toBeNull();
    expect(row?.billable).toBe(true);
  });

  it('refuse une phase inconnue et un facturable qui n’est pas un booléen', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const badPhase = await request(app).post('/api/time_entries').set(authHeader(token)).send(manual({ phase: 'Zorglub' }));
    expect(badPhase.status).toBe(400);
    const badFlag = await request(app).post('/api/time_entries').set(authHeader(token)).send(manual({ billable: 'oui' }));
    expect(badFlag.status).toBe(400);
  });

  it('garde la phase enregistrée quand une modification ne la mentionne pas', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const created = await request(app).post('/api/time_entries').set(authHeader(token)).send(manual({ phase: 'DET' }));
    const put = await request(app).put(`/api/time_entries/${created.body.id}`).set(authHeader(token)).send(manual({ description: 'maj' }));
    expect(put.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('time_entries').find(r => r.id === created.body.id)?.phase).toBe('DET');
  });

  it('enregistre la phase au pointage', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/time_entries/clock-in').set(authHeader(token)).send({ phase: 'PRO', billable: false });
    expect(res.status).toBe(201);
    const row = fakeSupabaseAdmin.getTable('time_entries').find(r => r.id === res.body.id);
    expect(row).toMatchObject({ phase: 'PRO', billable: false });
  });
});

describe('Coût horaire', () => {
  it('est réservé aux administrateurs', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'manager');
    expect((await request(app).get('/api/hourly-costs').set(authHeader(token))).status).toBe(403);
  });

  it('s’écrit en euros et se stocke en centimes sur l’adhésion', async () => {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    const member = makeUser(tenantId, 'user');
    const put = await request(app).put(`/api/hourly-costs/${member.userId}`).set(authHeader(admin.token)).send({ hourly_cost_eur: 45.5 });
    expect(put.status).toBe(200);
    expect(put.body.hourly_cost_cents).toBe(4550);
    const list = await request(app).get('/api/hourly-costs').set(authHeader(admin.token));
    expect(list.body.costs[member.userId]).toBe(4550);
  });

  it('refuse un coût négatif et un membre d’un autre cabinet', async () => {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    const outsider = makeUser(makeTenant(), 'user');
    expect((await request(app).put(`/api/hourly-costs/${admin.userId}`).set(authHeader(admin.token)).send({ hourly_cost_eur: -1 })).status).toBe(400);
    expect((await request(app).put(`/api/hourly-costs/${outsider.userId}`).set(authHeader(admin.token)).send({ hourly_cost_eur: 10 })).status).toBe(404);
  });
});

describe('Rentabilité par phase', () => {
  it('agrège heures et coût par phase pour les administrateurs', async () => {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    const projectId = seedProject(tenantId);
    await request(app).put(`/api/hourly-costs/${admin.userId}`).set(authHeader(admin.token)).send({ hourly_cost_eur: 50 });
    await request(app).post('/api/time_entries').set(authHeader(admin.token)).send(manual({ project_id: projectId, phase: 'APS' }));
    await request(app).post('/api/time_entries').set(authHeader(admin.token)).send(manual({ project_id: projectId, phase: 'APS', billable: false }));
    const res = await request(app).get(`/api/projects/${projectId}/time-by-phase`).set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.by_phase.APS).toEqual({ hours: 4, billableHours: 2, costCents: 20000 });
    expect(res.body.unrated_user_ids).toEqual([]);
  });

  it('signale les membres sans coût horaire', async () => {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    const projectId = seedProject(tenantId);
    await request(app).post('/api/time_entries').set(authHeader(admin.token)).send(manual({ project_id: projectId, phase: 'ESQ' }));
    const res = await request(app).get(`/api/projects/${projectId}/time-by-phase`).set(authHeader(admin.token));
    expect(res.body.unrated_user_ids).toEqual([admin.userId]);
  });

  it('est fermé aux collaborateurs et aux affaires d’un autre cabinet', async () => {
    const tenantId = makeTenant();
    const user = makeUser(tenantId, 'user');
    const admin = makeUser(tenantId, 'admin');
    const projectId = seedProject(tenantId);
    expect((await request(app).get(`/api/projects/${projectId}/time-by-phase`).set(authHeader(user.token))).status).toBe(403);
    const foreign = seedProject(makeTenant());
    expect((await request(app).get(`/api/projects/${foreign}/time-by-phase`).set(authHeader(admin.token))).status).toBe(404);
  });
});
