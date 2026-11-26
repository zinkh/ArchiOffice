// Croquis de réunion et de compte-rendu : server/routes/croquis.ts.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage,
} from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => { memoryDrive.reset(); });

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq += 1)}`;

function seedProject(tenantId: string, overrides: Record<string, any> = {}) {
  const id = nextId('proj');
  fakeSupabaseAdmin.seed('projects', [{ id, tenant_id: tenantId, project_code: '26014', name: 'Villa Martin', ...overrides }]);
  return id;
}
function seedMeeting(tenantId: string, projectId: string | null) {
  const id = nextId('meet');
  fakeSupabaseAdmin.seed('meetings', [{ id, tenant_id: tenantId, project_id: projectId, type: 'projet', title: 'Réunion 1', date: '2026-06-01T09:00:00Z' }]);
  return id;
}
function seedReport(tenantId: string, projectId: string) {
  const id = nextId('rep');
  fakeSupabaseAdmin.seed('site_reports', [{ id, tenant_id: tenantId, project_id: projectId, date: '2026-06-02', report_number: 1 }]);
  return id;
}

const rect = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'rect', x1: 0, y1: 0, x2: 100, y2: 60, k: 1, seed: 7, rough: true, color: '#141414', sw: 2.2, fill: 'none', angle: 45, gap: 7, ...extra,
});
const scene = (...elements: Record<string, unknown>[]) => ({ version: 1, elements });

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('x'.repeat(300))]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x'.repeat(300))]);

/** Chemin d'objet Supabase d'une référence `…/object/public/documents/<chemin>`. */
const objectPath = (fileUrl: string) => fileUrl.split('/object/public/documents/')[1];
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

async function create(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/croquis').set(authHeader(token)).send(body);
}
async function uploadBackground(token: string, id: string, buffer: Buffer = JPEG, dims: Record<string, string> = { width: '1200', height: '800' }) {
  const req = request(app).post(`/api/croquis/${id}/background`).set(authHeader(token));
  for (const [k, v] of Object.entries(dims)) req.field(k, v);
  return req.attach('file', buffer, { filename: 'fond.jpg', contentType: 'image/jpeg' });
}

describe('Création et lecture', () => {
  it('crée un croquis sur une réunion et le liste', async () => {
    const tenantId = makeTenant();
    const { token, userId } = makeUser(tenantId);
    const projectId = seedProject(tenantId);
    const meetingId = seedMeeting(tenantId, projectId);

    const res = await create(token, { id: 'croquis-0001aaaa', meeting_id: meetingId, title: '  Séjour  ', scene: scene(rect('r1')) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 'croquis-0001aaaa', tenant_id: tenantId, project_id: projectId, meeting_id: meetingId,
      site_report_id: null, title: 'Séjour', created_by: userId,
    });
    expect(res.body.scene.elements).toHaveLength(1);

    const list = await request(app).get('/api/croquis').query({ meeting_id: meetingId }).set(authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body.map((c: any) => c.id)).toEqual(['croquis-0001aaaa']);
  });

  it('crée un croquis sur un compte-rendu de chantier', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = seedProject(tenantId);
    const reportId = seedReport(tenantId, projectId);

    const res = await create(token, { site_report_id: reportId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ site_report_id: reportId, meeting_id: null, project_id: projectId, title: 'Croquis' });
    expect(res.body.scene).toEqual({ version: 1, elements: [] });

    const list = await request(app).get('/api/croquis').query({ site_report_id: reportId }).set(authHeader(token));
    expect(list.body).toHaveLength(1);
  });

  it("reprend l'affaire de la réunion, jamais celle du corps de la requête", async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const real = seedProject(tenantId);
    const other = seedProject(tenantId, { name: 'Autre' });
    const meetingId = seedMeeting(tenantId, real);

    const res = await create(token, { meeting_id: meetingId, project_id: other });
    expect(res.status).toBe(201);
    expect(res.body.project_id).toBe(real);
  });

  it('accepte une réunion sans affaire (devis, appel d\'offres)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const meetingId = seedMeeting(tenantId, null);
    const res = await create(token, { meeting_id: meetingId });
    expect(res.status).toBe(201);
    expect(res.body.project_id).toBeNull();
  });

  it('est idempotente : un rejeu rend la ligne déjà créée sans doublon', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const meetingId = seedMeeting(tenantId, seedProject(tenantId));
    const body = { id: 'croquis-rejeu0001', meeting_id: meetingId, title: 'Façade' };

    expect((await create(token, body)).status).toBe(201);
    const replay = await create(token, { ...body, title: 'Autre titre' });
    expect(replay.status).toBe(200);
    expect(replay.body.title).toBe('Façade');
    expect(fakeSupabaseAdmin.getTable('croquis').filter((r: any) => r.id === 'croquis-rejeu0001')).toHaveLength(1);
  });

  it('refuse un parent absent, double ou étranger au cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = seedProject(tenantId);
    const meetingId = seedMeeting(tenantId, projectId);
    const reportId = seedReport(tenantId, projectId);

    expect((await create(token, {})).status).toBe(400);
    expect((await create(token, { meeting_id: meetingId, site_report_id: reportId })).status).toBe(400);

    const foreignTenant = makeTenant();
    const foreignMeeting = seedMeeting(foreignTenant, seedProject(foreignTenant));
    const foreign = await create(token, { meeting_id: foreignMeeting });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toBe('Réunion introuvable pour ce cabinet.');
    expect((await create(token, { meeting_id: { $ne: null } })).status).toBe(400);
  });

  it('refuse un identifiant fourni qui n\'a pas la bonne forme', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const meetingId = seedMeeting(tenantId, null);
    expect((await create(token, { id: 'a/../b', meeting_id: meetingId })).status).toBe(400);
    expect((await create(token, { id: 'court', meeting_id: meetingId })).status).toBe(400);
  });

  it('plafonne le nombre de croquis par réunion', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const meetingId = seedMeeting(tenantId, null);
    fakeSupabaseAdmin.seed('croquis', Array.from({ length: 50 }, (_, i) => ({
      id: `plein-${meetingId}-${i}`, tenant_id: tenantId, meeting_id: meetingId, title: 'x',
      scene: scene(), created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    })));
    expect((await create(token, { meeting_id: meetingId })).status).toBe(400);
  });

  it('exige une réunion ou un compte-rendu pour lister', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    expect((await request(app).get('/api/croquis').set(authHeader(token))).status).toBe(400);
    expect((await request(app).get('/api/croquis').query({ meeting_id: 'inconnue' }).set(authHeader(token))).status).toBe(404);
  });
});

describe('Validation de la scène', () => {
  it('refuse une scène qui n\'a pas la forme attendue', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const meetingId = seedMeeting(tenantId, null);
    expect((await create(token, { meeting_id: meetingId, scene: 'texte' })).status).toBe(400);
    expect((await create(token, { meeting_id: meetingId, scene: { version: 9, elements: [] } })).status).toBe(400);
  });

  it('ignore les éléments invalides et arrondit les nombres', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const meetingId = seedMeeting(tenantId, null);
    const res = await create(token, {
      meeting_id: meetingId,
      scene: scene(rect('bon', { x1: 1.23456 }), { id: 'mauvais', type: 'cercle', x1: 0, y1: 0 }, rect('dup'), rect('dup')),
    });
    expect(res.status).toBe(201);
    expect(res.body.scene.elements.map((e: any) => e.id)).toEqual(['bon', 'dup']);
    expect(res.body.scene.elements[0].x1).toBe(1.23);
  });

  it('répond 413 à une scène trop volumineuse', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const meetingId = seedMeeting(tenantId, null);
    const pts = Array.from({ length: 100 }, (_, i) => [1000 + i, 2000 + i]);
    const elements = Array.from({ length: 5000 }, (_, i) => ({ ...rect(`p${i}`), type: 'pen', pts }));
    const res = await create(token, { meeting_id: meetingId, scene: scene(...elements) });
    expect(res.status).toBe(413);
  });
});

describe('Enregistrement', () => {
  async function seedOne(token: string, tenantId: string) {
    const meetingId = seedMeeting(tenantId, seedProject(tenantId));
    const id = nextId('croquis');
    await create(token, { id, meeting_id: meetingId, title: 'Départ', scene: scene(rect('r1')) });
    return id;
  }

  it('ne change que les champs présents dans le corps', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const id = await seedOne(token, tenantId);

    const renamed = await request(app).put(`/api/croquis/${id}`).set(authHeader(token)).send({ title: 'Plan RDC' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.title).toBe('Plan RDC');
    expect(renamed.body.scene.elements).toHaveLength(1);

    const drawn = await request(app).put(`/api/croquis/${id}`).set(authHeader(token)).send({ scene: scene(rect('r1'), rect('r2')) });
    expect(drawn.body.scene.elements).toHaveLength(2);
    expect(drawn.body.title).toBe('Plan RDC');
  });

  it('ramène l\'opacité du fond entre 0,05 et 1 et refuse une valeur illisible', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const id = await seedOne(token, tenantId);
    const put = (bg_opacity: unknown) => request(app).put(`/api/croquis/${id}`).set(authHeader(token)).send({ bg_opacity });

    expect((await put(0.5)).body.bg_opacity).toBe(0.5);
    expect((await put(4)).body.bg_opacity).toBe(1);
    expect((await put(0)).body.bg_opacity).toBe(0.05);
    expect((await put('beaucoup')).status).toBe(400);
  });

  it('ne laisse pas le corps réécrire le cabinet, l\'affaire ni les fichiers', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const id = await seedOne(token, tenantId);
    const before = fakeSupabaseAdmin.getTable('croquis').find((r: any) => r.id === id)!;

    const res = await request(app).put(`/api/croquis/${id}`).set(authHeader(token))
      .send({ title: 'Ok', tenant_id: 'autre-cabinet', project_id: 'autre', bg_path: 'http://x', preview_path: 'http://y', meeting_id: 'zzz' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tenant_id: tenantId, project_id: before.project_id, meeting_id: before.meeting_id });
    // Absente dans le double de base de données, `null` dans Postgres : dans les deux cas, aucun fichier référencé.
    expect(res.body.bg_path ?? null).toBeNull();
    expect(res.body.preview_path ?? null).toBeNull();
  });

  it('répond 404 pour un croquis inconnu', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    expect((await request(app).put('/api/croquis/inconnu00001').set(authHeader(token)).send({ title: 'x' })).status).toBe(404);
    expect((await request(app).get('/api/croquis/inconnu00001').set(authHeader(token))).status).toBe(404);
  });

  it('supprime un croquis, et la suppression rejouée réussit aussi', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const id = await seedOne(token, tenantId);
    expect((await request(app).delete(`/api/croquis/${id}`).set(authHeader(token))).status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('croquis').some((r: any) => r.id === id)).toBe(false);
    expect((await request(app).delete(`/api/croquis/${id}`).set(authHeader(token))).status).toBe(200);
  });
});

describe('Isolation entre cabinets', () => {
  it('n\'expose, ne modifie et ne supprime rien d\'un autre cabinet', async () => {
    const a = makeTenant(); const b = makeTenant();
    const userA = makeUser(a); const userB = makeUser(b);
    const meetingId = seedMeeting(a, seedProject(a));
    const id = nextId('croquis');
    await create(userA.token, { id, meeting_id: meetingId, title: 'Privé' });

    expect((await request(app).get('/api/croquis').query({ meeting_id: meetingId }).set(authHeader(userB.token))).status).toBe(404);
    expect((await request(app).get(`/api/croquis/${id}`).set(authHeader(userB.token))).status).toBe(404);
    expect((await request(app).put(`/api/croquis/${id}`).set(authHeader(userB.token)).send({ title: 'Piraté' })).status).toBe(404);
    expect((await uploadBackground(userB.token, id)).status).toBe(404);
    await request(app).delete(`/api/croquis/${id}`).set(authHeader(userB.token));
    expect(fakeSupabaseAdmin.getTable('croquis').find((r: any) => r.id === id)?.title).toBe('Privé');
  });
});

describe('Affaire archivée', () => {
  it('refuse de créer, modifier ou supprimer un croquis d\'une affaire archivée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const projectId = seedProject(tenantId);
    const meetingId = seedMeeting(tenantId, projectId);
    const id = nextId('croquis');
    expect((await create(token, { id, meeting_id: meetingId })).status).toBe(201);

    fakeSupabaseAdmin.getTable('projects').find((p: any) => p.id === projectId)!.archived_at = '2026-05-01T00:00:00Z';

    const created = await create(token, { meeting_id: meetingId });
    expect(created.status).toBe(409);
    expect(created.body.code).toBe('PROJECT_ARCHIVED');
    expect((await request(app).put(`/api/croquis/${id}`).set(authHeader(token)).send({ title: 'x' })).status).toBe(409);
    expect((await request(app).delete(`/api/croquis/${id}`).set(authHeader(token))).status).toBe(409);
    expect((await uploadBackground(token, id)).status).toBe(409);
    expect(fakeSupabaseAdmin.getTable('croquis').some((r: any) => r.id === id)).toBe(true);
  });
});

describe('Fond et aperçu', () => {
  async function seedOne(token: string, tenantId: string) {
    const meetingId = seedMeeting(tenantId, seedProject(tenantId));
    const id = nextId('croquis');
    await create(token, { id, meeting_id: meetingId, title: 'Plan RDC' });
    return id;
  }

  it('dépose un fond, le référence et retire l\'ancien quand on le remplace', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const id = await seedOne(token, tenantId);

    const first = await uploadBackground(token, id);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ bg_width: 1200, bg_height: 800 });
    const firstPath = objectPath(first.body.bg_path);
    expect(firstPath.startsWith(`${tenantId}/croquis/${id}/`)).toBe(true);
    expect(fakeSupabaseAdmin.hasObject('documents', firstPath)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await uploadBackground(token, id, PNG, { width: '900', height: '600' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ bg_width: 900, bg_height: 600 });
    await settle();
    expect(fakeSupabaseAdmin.hasObject('documents', objectPath(second.body.bg_path))).toBe(true);
    expect(fakeSupabaseAdmin.hasObject('documents', firstPath)).toBe(false);
  });

  it('refuse un fond qui n\'est pas une image, ou sans dimensions', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const id = await seedOne(token, tenantId);

    const notImage = await uploadBackground(token, id, Buffer.from('<html>pas une image</html>'));
    expect(notImage.status).toBe(400);
    expect((await uploadBackground(token, id, JPEG, {})).status).toBe(400);
    expect((await uploadBackground(token, id, JPEG, { width: '0', height: '800' })).status).toBe(400);
    expect((await uploadBackground(token, id, JPEG, { width: '99999', height: '800' })).status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('croquis').find((r: any) => r.id === id)!.bg_path ?? null).toBeNull();
  });

  it('revient à la feuille blanche et retire le fichier', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const id = await seedOne(token, tenantId);
    const uploaded = await uploadBackground(token, id);
    const path = objectPath(uploaded.body.bg_path);

    const cleared = await request(app).delete(`/api/croquis/${id}/background`).set(authHeader(token));
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ bg_path: null, bg_width: null, bg_height: null });
    await settle();
    expect(fakeSupabaseAdmin.hasObject('documents', path)).toBe(false);
  });

  it('dépose et remplace l\'aperçu PNG', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const id = await seedOne(token, tenantId);
    const send = () => request(app).post(`/api/croquis/${id}/preview`).set(authHeader(token))
      .attach('file', PNG, { filename: 'apercu.png', contentType: 'image/png' });

    const first = await send();
    expect(first.status).toBe(200);
    const firstPath = objectPath(first.body.preview_path);
    expect(fakeSupabaseAdmin.hasObject('documents', firstPath)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await send();
    await settle();
    expect(objectPath(second.body.preview_path)).not.toBe(firstPath);
    expect(fakeSupabaseAdmin.hasObject('documents', firstPath)).toBe(false);
  });

  it('range le fond dans le dossier « Croquis » de l\'affaire sur l\'espace du cabinet', async () => {
    const tenantId = makeTenant();
    connectExternalStorage(tenantId);
    const { token } = makeUser(tenantId);
    const id = await seedOne(token, tenantId);

    const res = await uploadBackground(token, id);
    expect(res.status).toBe(200);
    expect(res.body.bg_path).toMatch(/^archioffice\+external:\/\//);
    expect(memoryDrive.livePaths().some((p) => p.includes('26014 - Villa Martin/Croquis/Plan RDC - fond'))).toBe(true);
  });

  it('retire les fichiers avec le croquis', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const id = await seedOne(token, tenantId);
    const bg = await uploadBackground(token, id);
    const preview = await request(app).post(`/api/croquis/${id}/preview`).set(authHeader(token))
      .attach('file', PNG, { filename: 'apercu.png', contentType: 'image/png' });

    await request(app).delete(`/api/croquis/${id}`).set(authHeader(token));
    await settle();
    expect(fakeSupabaseAdmin.hasObject('documents', objectPath(bg.body.bg_path))).toBe(false);
    expect(fakeSupabaseAdmin.hasObject('documents', objectPath(preview.body.preview_path))).toBe(false);
  });

  it('retire les fichiers des croquis d\'une réunion supprimée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const meetingId = seedMeeting(tenantId, seedProject(tenantId));
    const id = nextId('croquis');
    await create(token, { id, meeting_id: meetingId });
    const bg = await uploadBackground(token, id);
    const path = objectPath(bg.body.bg_path);

    const deleted = await request(app).delete(`/api/meetings/${meetingId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    await settle();
    expect(fakeSupabaseAdmin.hasObject('documents', path)).toBe(false);
  });

  it('garde les fichiers quand la suppression de l\'affaire est refusée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId); // simple collaborateur : supprimer une affaire est réservé aux administrateurs
    const projectId = seedProject(tenantId);
    const meetingId = seedMeeting(tenantId, projectId);
    const id = nextId('croquis');
    await create(token, { id, meeting_id: meetingId });
    const path = objectPath((await uploadBackground(token, id)).body.bg_path);

    const refused = await request(app).delete(`/api/projects/${projectId}`).set(authHeader(token));
    expect(refused.status).toBe(403);
    await settle();
    expect(fakeSupabaseAdmin.hasObject('documents', path)).toBe(true);
  });

  it('retire les fichiers des croquis d\'une affaire supprimée par un administrateur', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const projectId = seedProject(tenantId);
    const meetingId = seedMeeting(tenantId, projectId);
    const id = nextId('croquis');
    await create(token, { id, meeting_id: meetingId });
    const path = objectPath((await uploadBackground(token, id)).body.bg_path);

    const deleted = await request(app).delete(`/api/projects/${projectId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    await settle();
    expect(fakeSupabaseAdmin.hasObject('documents', path)).toBe(false);
  });
});
