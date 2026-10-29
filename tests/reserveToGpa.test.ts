// Transformation d'une réserve AOR (OPR) en réserve GPA.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

async function seedReserve(tenantId: string, token: string, body: Record<string, unknown> = {}) {
  fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);
  const created = await request(app).post('/api/reserves').set(authHeader(token))
    .send({ project_id: 'p1', title: 'Fissure', lots: '02', status: 'Levée refusée par le MOE', ...body });
  return created.body.id as string;
}

describe('POST /api/reserves/:id/to-gpa', () => {
  it('déplace la réserve et ses photos vers la série GPA, numérotée à la suite', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const id = await seedReserve(tenantId, token, { reponse: undefined });
    // Une réserve GPA existe déjà sur l'affaire : la suivante prend le numéro 2.
    await request(app).post('/api/gpa-reserves').set(authHeader(token)).send({ project_id: 'p1', title: 'Existante' });
    fakeSupabaseAdmin.seed('reserve_photos', [{ id: 'ph1', tenant_id: tenantId, reserve_id: id, reserve_kind: 'opr', file_url: 'u' }]);

    const res = await request(app).post(`/api/reserves/${id}/to-gpa`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, title: 'Fissure', number: 2, lots: '02', status: 'Levée refusée par le MOE' });
    expect(res.body.photos.map((p: any) => p.id)).toEqual(['ph1']);
    expect(fakeSupabaseAdmin.getTable('reserves').some(r => r.id === id)).toBe(false);
    expect(fakeSupabaseAdmin.getTable('gpa_reserves').find(r => r.id === id)?.tenant_id).toBe(tenantId);
    expect(fakeSupabaseAdmin.getTable('reserve_photos').find(p => p.id === 'ph1')?.reserve_kind).toBe('gpa');

    const listed = await request(app).get('/api/reserves').query({ project_id: 'p1' }).set(authHeader(token));
    expect(listed.body.some((r: any) => r.id === id)).toBe(false);
  });

  it('refuse une réserve inconnue ou d’un autre cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const id = await seedReserve(tenantId, token);
    const other = makeUser(makeTenant());

    expect((await request(app).post('/api/reserves/inconnue/to-gpa').set(authHeader(token))).status).toBe(404);
    expect((await request(app).post(`/api/reserves/${id}/to-gpa`).set(authHeader(other.token))).status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('reserves').some(r => r.id === id)).toBe(true);
  });
});
