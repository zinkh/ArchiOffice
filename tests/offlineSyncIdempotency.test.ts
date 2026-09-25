// Idempotence des créations « suivi de chantier » (réunions, réserves
// OPR/GPA, observations) et de leurs photos : rejouer la même requête avec
// le même id, comme le fait src/lib/offlineQueue.ts après une coupure
// réseau, ne doit jamais créer une seconde ligne. Voir CLAUDE.md
// « fiabiliser la synchro hors-ligne ».
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('Idempotence des créations hors-ligne', () => {
  it('POST /api/meetings avec le même id rejoué ne crée qu’une réunion', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);
    const id = 'client-meeting-1';

    const first = await request(app).post('/api/meetings').set(authHeader(token))
      .send({ id, project_id: 'p1', title: 'Réunion de chantier', date: '2026-09-01', notes: 'RAS' });
    expect(first.status).toBe(201);
    expect(first.body.id).toBe(id);

    const replay = await request(app).post('/api/meetings').set(authHeader(token))
      .send({ id, project_id: 'p1', title: 'Réunion de chantier', date: '2026-09-01', notes: 'RAS' });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(id);

    expect(fakeSupabaseAdmin.getTable('meetings').filter(m => m.id === id)).toHaveLength(1);
  });

  it('POST /api/meetings/:id/photos avec le même id rejoué ne crée qu’une photo', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);
    const created = await request(app).post('/api/meetings').set(authHeader(token))
      .send({ project_id: 'p1', title: 'Réunion', date: '2026-09-01' });
    const meetingId = created.body.id;
    const photoId = 'client-photo-1';

    const first = await request(app).post(`/api/meetings/${meetingId}/photos`).set(authHeader(token))
      .field('id', photoId).attach('file', PNG, 'a.png');
    expect(first.status).toBe(201);
    expect(first.body.id).toBe(photoId);

    const replay = await request(app).post(`/api/meetings/${meetingId}/photos`).set(authHeader(token))
      .field('id', photoId).attach('file', PNG, 'a.png');
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(photoId);

    expect(fakeSupabaseAdmin.getTable('meeting_photos').filter(p => p.id === photoId)).toHaveLength(1);
  });

  for (const { apiBase, table } of [
    { apiBase: '/api/reserves', table: 'reserves' },
    { apiBase: '/api/gpa-reserves', table: 'gpa_reserves' },
  ]) {
    it(`POST ${apiBase} avec le même id rejoué ne crée qu’une réserve et ne consomme pas de numéro`, async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);
      const id = `client-reserve-${table}`;

      const first = await request(app).post(apiBase).set(authHeader(token))
        .send({ id, project_id: 'p1', title: 'Fissure' });
      expect(first.status).toBe(200);
      expect(first.body.number).toBe(1);

      const replay = await request(app).post(apiBase).set(authHeader(token))
        .send({ id, project_id: 'p1', title: 'Fissure' });
      expect(replay.status).toBe(200);
      expect(replay.body.number).toBe(1);

      expect(fakeSupabaseAdmin.getTable(table).filter(r => r.id === id)).toHaveLength(1);
    });

    it(`POST ${apiBase}/:id/photos avec le même id rejoué ne crée qu’une photo`, async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);
      const created = await request(app).post(apiBase).set(authHeader(token)).send({ project_id: 'p1', title: 'Porte' });
      const reserveId = created.body.id;
      const photoId = `client-reserve-photo-${table}`;

      const first = await request(app).post(`${apiBase}/${reserveId}/photos`).set(authHeader(token))
        .field('id', photoId).attach('file', PNG, 'a.png');
      expect(first.status).toBe(201);

      const replay = await request(app).post(`${apiBase}/${reserveId}/photos`).set(authHeader(token))
        .field('id', photoId).attach('file', PNG, 'a.png');
      expect(replay.status).toBe(200);

      expect(fakeSupabaseAdmin.getTable('reserve_photos').filter(p => p.id === photoId)).toHaveLength(1);
    });
  }

  it('POST /api/projects/:projectId/observations avec le même id rejoué ne crée qu’une observation et ne consomme pas de numéro', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);
    const id = 'client-observation-1';

    const first = await request(app).post('/api/projects/p1/observations').set(authHeader(token))
      .send({ id, texte: 'Fissure façade nord' });
    expect(first.status).toBe(200);
    expect(first.body.number).toBe(1);

    const replay = await request(app).post('/api/projects/p1/observations').set(authHeader(token))
      .send({ id, texte: 'Fissure façade nord' });
    expect(replay.status).toBe(200);
    expect(replay.body.number).toBe(1);

    expect(fakeSupabaseAdmin.getTable('observations').filter(o => o.id === id)).toHaveLength(1);
  });

  it('POST /api/observations/:id/photos avec le même id rejoué ne double pas la photo dans le tableau', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);
    const created = await request(app).post('/api/projects/p1/observations').set(authHeader(token)).send({ texte: 'Fissure' });
    const observationId = created.body.id;
    const photoId = 'client-observation-photo-1';

    const first = await request(app).post(`/api/observations/${observationId}/photos`).set(authHeader(token))
      .field('id', photoId).attach('file', PNG, 'a.png');
    expect(first.status).toBe(201);
    expect(first.body.photos).toHaveLength(1);

    const replay = await request(app).post(`/api/observations/${observationId}/photos`).set(authHeader(token))
      .field('id', photoId).attach('file', PNG, 'a.png');
    expect(replay.status).toBe(200);
    expect(replay.body.photos).toHaveLength(1);
  });
});
