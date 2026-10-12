import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const seedLots = (tenantId: string, numeros: string[]) => {
  const rows = numeros.map((n, i) => ({ id: `${tenantId}-l${i}`, tenant_id: tenantId, project_id: 'p1', lot_number: n, lot_title: `Lot ${i}` }));
  fakeSupabaseAdmin.seed('project_lots', rows);
  return rows;
};

describe('numéros de lot libres', () => {
  it('crée un lot « 00 » et un lot « 01A »', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    for (const n of ['00', '01A']) {
      const res = await request(app).post('/api/projects/p1/lots').set(authHeader(token)).send({ lot_number: n, lot_title: `Lot ${n}` });
      expect(res.status).toBe(201);
    }
    const listed = await request(app).get('/api/projects/p1/lots').set(authHeader(token));
    expect(listed.body.map((l: any) => l.lot_number)).toEqual(['00', '01A']);
  });

  it('refuse un numéro en double (409) et un numéro invalide (400)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedLots(tenantId, ['01']);
    const dup = await request(app).post('/api/projects/p1/lots').set(authHeader(token)).send({ lot_number: '01', lot_title: 'Autre' });
    expect(dup.status).toBe(409);
    const bad = await request(app).post('/api/projects/p1/lots').set(authHeader(token)).send({ lot_number: '01.1', lot_title: 'Autre' });
    expect(bad.status).toBe(400);
  });

  it('renumérote un lot en 01A / 01B pour le scinder, sans doublon possible', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const [a, b] = seedLots(tenantId, ['01', '02']);
    const ok = await request(app).put(`/api/lots/${a.id}`).set(authHeader(token)).send({ lot_number: '01A' });
    expect(ok.status).toBe(200);
    const clash = await request(app).put(`/api/lots/${b.id}`).set(authHeader(token)).send({ lot_number: '01a' });
    expect(clash.status).toBe(409);
    expect(fakeSupabaseAdmin.getTable('project_lots').find(l => l.id === a.id)?.lot_number).toBe('01A');
  });

  it('la réorganisation garde la série personnalisée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const [a, b, c] = seedLots(tenantId, ['00', '01A', '01B']);
    const res = await request(app).put('/api/projects/p1/lots/order').set(authHeader(token)).send({ ids: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);
    const num = (id: string) => fakeSupabaseAdmin.getTable('project_lots').find(l => l.id === id)?.lot_number;
    expect([num(c.id), num(a.id), num(b.id)]).toEqual(['00', '01A', '01B']);
  });
});
