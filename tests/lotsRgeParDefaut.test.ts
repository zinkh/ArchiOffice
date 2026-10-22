// « RGE exigé » : valeur de départ des lots (isolation, chauffage) à la création,
// au renommage et à la mise à jour de la liste d'une affaire. Voir src/lib/rgeLots.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const lotsDe = (projectId: string) => fakeSupabaseAdmin.getTable('project_lots').filter(l => l.project_id === projectId);
const seedProject = (tenantId: string, id: string) =>
  fakeSupabaseAdmin.seed('projects', [{ id, tenant_id: tenantId, name: 'Villa', client: 'C', status: 'Planning' }]);

describe('RGE exigé : valeur de départ des lots', () => {
  it('un lot créé (liste ou import du CCTP) isolation ou chauffage est coché, les autres non', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'p1');
    for (const [n, t] of [['01', 'Isolation thermique'], ['02', 'Chauffage et ventilation'], ['03', 'Peintures'], ['04', 'Isolation phonique']]) {
      const res = await request(app).post('/api/projects/p1/lots').set(authHeader(token)).send({ lot_number: n, lot_title: t });
      expect(res.status).toBe(201);
    }
    expect(lotsDe('p1').map(l => [l.lot_title, l.rge_required])).toEqual([
      ['Isolation thermique', true], ['Chauffage et ventilation', true], ['Peintures', false], ['Isolation phonique', false],
    ]);
  });

  it('une valeur envoyée explicitement l\'emporte', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'p2');
    await request(app).post('/api/projects/p2/lots').set(authHeader(token)).send({ lot_number: '01', lot_title: 'Isolation', rge_required: false });
    expect(lotsDe('p2')[0].rge_required).toBe(false);
  });

  it('un lot existant renommé vers isolation ou chauffage (import du CCTP) est coché', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'p3');
    fakeSupabaseAdmin.seed('project_lots', [{ id: 'l1', tenant_id: tenantId, project_id: 'p3', lot_number: '05', lot_title: 'Lot 5', rge_required: false }]);
    const res = await request(app).put('/api/lots/l1').set(authHeader(token)).send({ lot_number: '05', lot_title: 'Chauffage' });
    expect(res.status).toBe(200);
    expect(lotsDe('p3')[0].rge_required).toBe(true);
  });

  it('une case décochée à la main n\'est pas recochée par un renommage dans la même famille', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'p4');
    fakeSupabaseAdmin.seed('project_lots', [{ id: 'l1', tenant_id: tenantId, project_id: 'p4', lot_number: '01', lot_title: 'Isolation', rge_required: false }]);
    await request(app).put('/api/lots/l1').set(authHeader(token)).send({ lot_title: 'Isolation des combles' });
    expect(lotsDe('p4')[0].rge_required).toBe(false);
  });

  it('une liste de lots envoyée à l\'affaire ne coche que les lots nouveaux', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'p5');
    fakeSupabaseAdmin.seed('project_lots', [{ id: 'l1', tenant_id: tenantId, project_id: 'p5', lot_number: '01', lot_title: 'Isolation', rge_required: false }]);
    const res = await request(app).put('/api/projects/p5').set(authHeader(token)).send({
      name: 'Villa', client: 'C',
      lots_list: [
        { id: 'l1', lot_number: '01', lot_title: 'Isolation' },
        { lot_number: '02', lot_title: 'Chauffage' },
        { lot_number: '03', lot_title: 'Peintures' },
      ],
    });
    expect(res.status).toBe(200);
    const lots = lotsDe('p5');
    expect(lots.find(l => l.lot_title === 'Isolation')!.rge_required).toBe(false);
    expect(lots.find(l => l.lot_title === 'Chauffage')!.rge_required).toBe(true);
    expect(lots.find(l => l.lot_title === 'Peintures')!.rge_required).toBe(false);
  });
});
