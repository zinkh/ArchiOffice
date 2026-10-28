// Nature d'une réserve d'OPR (épreuves, travaux, malfaçons, installations, pose) : écriture,
// lecture, vocabulaire fermé, mise à jour partielle et route dédiée.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function cabinet() {
  const tenantId = makeTenant();
  const { token } = makeUser(tenantId);
  fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);
  return { tenantId, token };
}

const ligne = (id: string) => fakeSupabaseAdmin.getTable('reserves').find(r => r.id === id);

describe('nature d\'une réserve', () => {
  it('se pose à la création, se relit, et reste facultative', async () => {
    const { token } = cabinet();
    const avec = await request(app).post('/api/reserves').set(authHeader(token)).send({ project_id: 'p1', title: 'Essai', nature: 'epreuves' });
    const sans = await request(app).post('/api/reserves').set(authHeader(token)).send({ project_id: 'p1', title: 'Peinture' });
    expect(avec.status).toBe(200);
    expect(ligne(avec.body.id)?.nature).toBe('epreuves');
    expect(sans.status).toBe(200);
    expect(ligne(sans.body.id)?.nature ?? null).toBeNull();
    const liste = await request(app).get('/api/reserves').query({ project_id: 'p1' }).set(authHeader(token));
    expect(liste.body.find((r: any) => r.id === avec.body.id).nature).toBe('epreuves');
  });

  it('refuse une nature hors vocabulaire, à la création comme à la mise à jour', async () => {
    const { token } = cabinet();
    expect((await request(app).post('/api/reserves').set(authHeader(token)).send({ project_id: 'p1', title: 'x', nature: 'peinture' })).status).toBe(400);
    const id = (await request(app).post('/api/reserves').set(authHeader(token)).send({ project_id: 'p1', title: 'x' })).body.id;
    expect((await request(app).put(`/api/reserves/${id}`).set(authHeader(token)).send({ title: 'x', nature: 'peinture' })).status).toBe(400);
    expect((await request(app).put(`/api/reserves/${id}/nature`).set(authHeader(token)).send({ nature: 'peinture' })).status).toBe(400);
  });

  it('le PUT d\'une réserve ne l\'efface pas quand le corps ne la porte pas', async () => {
    const { token } = cabinet();
    const id = (await request(app).post('/api/reserves').set(authHeader(token)).send({ project_id: 'p1', title: 'Joint', nature: 'malfacons' })).body.id;
    const statut = await request(app).put(`/api/reserves/${id}`).set(authHeader(token)).send({ title: 'Joint', status: 'En cours' });
    expect(statut.status).toBe(200);
    expect(ligne(id)?.nature).toBe('malfacons');
    // Un corps qui la porte la change, et null l'efface.
    await request(app).put(`/api/reserves/${id}`).set(authHeader(token)).send({ title: 'Joint', status: 'En cours', nature: 'travaux' });
    expect(ligne(id)?.nature).toBe('travaux');
    await request(app).put(`/api/reserves/${id}`).set(authHeader(token)).send({ title: 'Joint', status: 'En cours', nature: null });
    expect(ligne(id)?.nature).toBeNull();
  });

  it('la route dédiée ne change que la nature, sans réécrire les autres champs', async () => {
    const { token } = cabinet();
    const id = (await request(app).post('/api/reserves').set(authHeader(token)).send({ project_id: 'p1', title: 'Enduit', local: 'Façade', description: 'À reprendre' })).body.id;
    const res = await request(app).put(`/api/reserves/${id}/nature`).set(authHeader(token)).send({ nature: 'installations' });
    expect(res.status).toBe(200);
    expect(ligne(id)).toMatchObject({ nature: 'installations', title: 'Enduit', local: 'Façade', description: 'À reprendre' });
    expect((await request(app).put(`/api/reserves/${id}/nature`).set(authHeader(token)).send({ nature: null })).status).toBe(200);
    expect(ligne(id)?.nature).toBeNull();
    expect((await request(app).put(`/api/reserves/${id}/nature`).set(authHeader(token)).send({})).status).toBe(400);
  });

  it('ne touche jamais la réserve d\'un autre cabinet', async () => {
    const a = cabinet();
    const b = cabinet();
    const id = (await request(app).post('/api/reserves').set(authHeader(b.token)).send({ project_id: 'p1', title: 'Chez B' })).body.id;
    expect((await request(app).put(`/api/reserves/${id}/nature`).set(authHeader(a.token)).send({ nature: 'pose' })).status).toBe(404);
    expect(ligne(id)?.nature ?? null).toBeNull();
  });

  it('une affaire archivée refuse le changement de nature', async () => {
    const { tenantId, token } = cabinet();
    fakeSupabaseAdmin.seed('projects', [{ id: 'p-archive', tenant_id: tenantId, archived_at: '2026-10-01T00:00:00Z' }]);
    fakeSupabaseAdmin.seed('reserves', [{ id: 'r-archive', tenant_id: tenantId, project_id: 'p-archive', title: 'x' }]);
    const res = await request(app).put('/api/reserves/r-archive/nature').set(authHeader(token)).send({ nature: 'pose' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
  });
});
