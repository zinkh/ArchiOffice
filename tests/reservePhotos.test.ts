// Photos et commentaire des réserves (OPR et GPA) : voir server/reservePhotos.ts.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Jimp, JimpMime } from 'jimp';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { parseStorageRef } from '../server/storagePaths';

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

  describe('miniature d\'affichage', () => {
    const BUCKET = 'reserve-photos';
    const pathOf = (url: string) => parseStorageRef(url)!.path;

    // Une photo d'iPad : plus large que les 1600 px que le serveur conserve, donc réduite, donc miniaturisable.
    const bigPhoto = async () => {
      const image = new Jimp({ width: 2000, height: 1000, color: 0xff8800ff });
      return image.getBuffer(JimpMime.png);
    };

    const setup = async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);
      const created = await request(app).post('/api/reserves').set(authHeader(token)).send({ project_id: 'p1', title: 'Garde-corps' });
      return { tenantId, token, reserveId: created.body.id as string };
    };

    it('une photo reçoit une miniature de 480 px à côté de la photo complète, qui reste la référence', async () => {
      const { token, reserveId } = await setup();
      const upload = await request(app).post(`/api/reserves/${reserveId}/photos`).set(authHeader(token)).attach('file', await bigPhoto(), 'ipad.png');
      expect(upload.status).toBe(201);

      expect(upload.body.thumb_url).toContain('-thumb.');
      expect(upload.body.file_url).not.toContain('-thumb.');
      expect(fakeSupabaseAdmin.hasObject(BUCKET, pathOf(upload.body.file_url))).toBe(true);
      expect(fakeSupabaseAdmin.hasObject(BUCKET, pathOf(upload.body.thumb_url))).toBe(true);

      // La photo complète garde les 1600 px, seule la miniature descend à 480 px.
      const full = await Jimp.read(fakeSupabaseAdmin.readObject(BUCKET, pathOf(upload.body.file_url))!);
      const thumb = await Jimp.read(fakeSupabaseAdmin.readObject(BUCKET, pathOf(upload.body.thumb_url))!);
      expect(Math.max(full.bitmap.width, full.bitmap.height)).toBe(1600);
      expect(Math.max(thumb.bitmap.width, thumb.bitmap.height)).toBe(480);

      const listed = await request(app).get('/api/reserves').query({ project_id: 'p1' }).set(authHeader(token));
      const photo = listed.body.find((r: any) => r.id === reserveId).photos[0];
      expect(photo.thumb_url).toBe(upload.body.thumb_url);
      expect(photo.file_url).toBe(upload.body.file_url);
    });

    it('une image déjà plus petite que la miniature n\'en reçoit pas : on affiche la photo elle-même', async () => {
      const { token, reserveId } = await setup();
      const upload = await request(app).post(`/api/reserves/${reserveId}/photos`).set(authHeader(token)).attach('file', PNG, 'petite.png');
      expect(upload.status).toBe(201);
      expect(upload.body.thumb_url).toBeUndefined();
      expect(fakeSupabaseAdmin.getTable('reserve_photos').find(p => p.id === upload.body.id)?.thumb_url).toBeUndefined();
    });

    it('supprimer une photo retire aussi sa miniature', async () => {
      const { token, reserveId } = await setup();
      const upload = await request(app).post(`/api/reserves/${reserveId}/photos`).set(authHeader(token)).attach('file', await bigPhoto(), 'a.png');
      const thumbPath = pathOf(upload.body.thumb_url);
      expect(fakeSupabaseAdmin.hasObject(BUCKET, thumbPath)).toBe(true);

      const del = await request(app).delete(`/api/reserves/${reserveId}/photos/${upload.body.id}`).set(authHeader(token));
      expect(del.status).toBe(200);
      await vi.waitFor(() => {
        expect(fakeSupabaseAdmin.hasObject(BUCKET, thumbPath)).toBe(false);
        expect(fakeSupabaseAdmin.hasObject(BUCKET, pathOf(upload.body.file_url))).toBe(false);
      });
    });

    it('supprimer la réserve retire les miniatures de toutes ses photos', async () => {
      const { token, reserveId } = await setup();
      const first = await request(app).post(`/api/reserves/${reserveId}/photos`).set(authHeader(token)).attach('file', await bigPhoto(), 'a.png');
      const second = await request(app).post(`/api/reserves/${reserveId}/photos`).set(authHeader(token)).attach('file', await bigPhoto(), 'b.png');

      const del = await request(app).delete(`/api/reserves/${reserveId}`).set(authHeader(token));
      expect(del.status).toBe(200);
      await vi.waitFor(() => {
        for (const body of [first.body, second.body]) {
          expect(fakeSupabaseAdmin.hasObject(BUCKET, pathOf(body.thumb_url))).toBe(false);
          expect(fakeSupabaseAdmin.hasObject(BUCKET, pathOf(body.file_url))).toBe(false);
        }
      });
    });

    it('une base sans la colonne thumb_url enregistre la photo sans miniature, et ne laisse pas de fichier orphelin', async () => {
      const { token, reserveId } = await setup();
      fakeSupabaseAdmin.dropColumn('reserve_photos', 'thumb_url');
      try {
        const upload = await request(app).post(`/api/reserves/${reserveId}/photos`).set(authHeader(token)).attach('file', await bigPhoto(), 'ancienne-base.png');
        expect(upload.status).toBe(201);
        expect(upload.body.thumb_url).toBeUndefined();
        expect(fakeSupabaseAdmin.getTable('reserve_photos').some(p => p.id === upload.body.id)).toBe(true);
        expect(fakeSupabaseAdmin.hasObject(BUCKET, pathOf(upload.body.file_url))).toBe(true);

        // La miniature déjà déposée est retirée : rien ne la référence.
        const orphan = pathOf(upload.body.file_url).replace(/-ancienne-base\.png$/, '-thumb.png');
        await vi.waitFor(() => expect(fakeSupabaseAdmin.hasObject(BUCKET, orphan)).toBe(false));

        // Supprimer reste possible : la lecture de la ligne ne nomme pas la colonne absente.
        const del = await request(app).delete(`/api/reserves/${reserveId}/photos/${upload.body.id}`).set(authHeader(token));
        expect(del.status).toBe(200);
      } finally {
        fakeSupabaseAdmin.restoreColumn('reserve_photos', 'thumb_url');
      }
    });
  });

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
