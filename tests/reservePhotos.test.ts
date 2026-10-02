// Photos et commentaire des réserves (OPR et GPA) : voir server/reservePhotos.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

// En-tête PNG valide (8 octets de signature + un chunk IHDR minimal), assez
// pour passer sniffImageMime ; le traitement sharp est mocké côté test par
// resizeImage qui rend le tampon tel quel s'il ne sait pas le lire.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('Photos de réserves', () => {
  for (const { apiBase, table, kind } of [
    { apiBase: '/api/reserves', table: 'reserves', kind: 'opr' },
    { apiBase: '/api/gpa-reserves', table: 'gpa_reserves', kind: 'gpa' },
  ]) {
    it(`${apiBase} : une photo se rattache à la réserve, ressort dans la liste et part avec la réserve`, async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);

      const created = await request(app).post(apiBase).set(authHeader(token))
        .send({ project_id: 'p1', title: 'Fissure', description: 'Reprise enduit à prévoir' });
      expect(created.status).toBe(200);
      expect(created.body.description).toBe('Reprise enduit à prévoir');
      expect(created.body.photos).toEqual([]);
      const id = created.body.id;

      const upload = await request(app).post(`${apiBase}/${id}/photos`).set(authHeader(token))
        .field('caption', 'Vue générale')
        .attach('file', PNG, 'chantier.png');
      expect(upload.status).toBe(201);
      expect(upload.body.reserve_id).toBe(id);
      expect(upload.body.reserve_kind).toBe(kind);
      expect(upload.body.caption).toBe('Vue générale');
      expect(upload.body.file_url).toContain('/reserve-photos/');
      expect(upload.body.file_url).toContain(`${tenantId}/${id}/`);

      const refused = await request(app).post(`${apiBase}/${id}/photos`).set(authHeader(token))
        .attach('file', Buffer.from('<html>pas une image</html>'), 'page.html');
      expect(refused.status).toBe(400);

      const listed = await request(app).get(apiBase).query({ project_id: 'p1' }).set(authHeader(token));
      const row = listed.body.find((r: any) => r.id === id);
      expect(row.photos).toHaveLength(1);
      expect(row.photos[0].id).toBe(upload.body.id);

      const only = await request(app).get(`${apiBase}/${id}/photos`).set(authHeader(token));
      expect(only.body).toHaveLength(1);

      const edited = await request(app).put(`${apiBase}/${id}`).set(authHeader(token))
        .send({ title: 'Fissure', status: 'En cours', description: 'Enduit repris, peinture à faire' });
      expect(edited.status).toBe(200);
      expect(fakeSupabaseAdmin.getTable(table).find(r => r.id === id)?.description).toBe('Enduit repris, peinture à faire');

      const deleted = await request(app).delete(`${apiBase}/${id}`).set(authHeader(token));
      expect(deleted.status).toBe(200);
      expect(fakeSupabaseAdmin.getTable('reserve_photos').some(p => p.reserve_id === id)).toBe(false);
    });

    it(`${apiBase} : une réserve d'un autre cabinet ne reçoit ni ne montre de photo`, async () => {
      const tenantB = makeTenant();
      fakeSupabaseAdmin.seed(table, [{ id: `r-${kind}-b`, tenant_id: tenantB, project_id: 'pb', title: 'Secret', number: 1 }]);
      const tenantA = makeTenant();
      const { token } = makeUser(tenantA);

      const upload = await request(app).post(`${apiBase}/r-${kind}-b/photos`).set(authHeader(token)).attach('file', PNG, 'x.png');
      expect(upload.status).toBe(404);
      const listed = await request(app).get(`${apiBase}/r-${kind}-b/photos`).set(authHeader(token));
      expect(listed.status).toBe(404);
    });
  }

  it('supprimer une photo retire la ligne et laisse la réserve intacte', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);
    const created = await request(app).post('/api/reserves').set(authHeader(token)).send({ project_id: 'p1', title: 'Porte' });
    const id = created.body.id;
    const upload = await request(app).post(`/api/reserves/${id}/photos`).set(authHeader(token)).attach('file', PNG, 'a.png');
    expect(upload.status).toBe(201);

    const del = await request(app).delete(`/api/reserves/${id}/photos/${upload.body.id}`).set(authHeader(token));
    expect(del.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('reserve_photos').some(p => p.id === upload.body.id)).toBe(false);
    expect(fakeSupabaseAdmin.getTable('reserves').some(r => r.id === id)).toBe(true);

    const again = await request(app).delete(`/api/reserves/${id}/photos/${upload.body.id}`).set(authHeader(token));
    expect(again.status).toBe(404);
  });
});
