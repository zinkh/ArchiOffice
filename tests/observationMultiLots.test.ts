// Observation adressée à un lot, à plusieurs lots ou à tous (TCE) : colonnes lot_id / lot_ids / tce.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seed(tenantId: string) {
  const projectId = `p-${tenantId}`;
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'IUT' }]);
  fakeSupabaseAdmin.seed('project_lots', ['1', '2', '3'].map(n => ({ id: `l${n}-${tenantId}`, tenant_id: tenantId, project_id: projectId, lot_number: `0${n}`, lot_title: `Lot ${n}` })));
  return projectId;
}

const row = (id: string) => fakeSupabaseAdmin.getTable('observations').find((o: any) => o.id === id);

describe("attribution d'une observation à plusieurs lots ou à tous", () => {
  it('crée une observation multi-lots : lot_id = le premier, lot_ids = tous', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = seed(tenantId);

    const res = await request(app).post(`/api/projects/${projectId}/observations`).set(authHeader(token))
      .send({ id: 'obs-multi', texte: 'Reprendre les finitions', lot_ids: [`l2-${tenantId}`, `l3-${tenantId}`] });
    expect(res.status).toBe(200);
    expect(row('obs-multi')).toMatchObject({ lot_id: `l2-${tenantId}`, lot_ids: [`l2-${tenantId}`, `l3-${tenantId}`], tce: false });
  });

  it('passe une observation en TCE (sans lot), puis la ramène à un seul lot', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = seed(tenantId);
    fakeSupabaseAdmin.seed('observations', [{ id: 'o1', tenant_id: tenantId, project_id: projectId, lot_id: `l1-${tenantId}`, texte: 'X', statut: 'À faire', number: 1 }]);

    await request(app).put('/api/observations/o1').set(authHeader(token)).send({ tce: true }).expect(200);
    expect(row('o1')).toMatchObject({ tce: true, lot_id: null, lot_ids: [] });

    await request(app).put('/api/observations/o1').set(authHeader(token)).send({ tce: false, lot_ids: [`l3-${tenantId}`] }).expect(200);
    expect(row('o1')).toMatchObject({ tce: false, lot_id: `l3-${tenantId}`, lot_ids: [] });
  });

  it("refuse un lot d'un autre cabinet dans lot_ids", async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = seed(tenantId);
    const other = makeTenant();
    seed(other);
    fakeSupabaseAdmin.seed('observations', [{ id: 'o2', tenant_id: tenantId, project_id: projectId, texte: 'Y', statut: 'À faire', number: 1 }]);

    const res = await request(app).put('/api/observations/o2').set(authHeader(token)).send({ lot_ids: [`l1-${tenantId}`, `l2-${other}`] });
    expect(res.status).toBe(400);
    expect(row('o2')?.lot_ids).toBeUndefined();
  });

  it("ne touche pas aux lots quand le corps n'en parle pas", async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = seed(tenantId);
    fakeSupabaseAdmin.seed('observations', [{ id: 'o3', tenant_id: tenantId, project_id: projectId, lot_id: `l1-${tenantId}`, lot_ids: [], tce: false, texte: 'Z', statut: 'À faire', number: 1 }]);

    await request(app).put('/api/observations/o3').set(authHeader(token)).send({ texte: 'Z modifié' }).expect(200);
    expect(row('o3')).toMatchObject({ texte: 'Z modifié', lot_id: `l1-${tenantId}`, tce: false });
  });
});
