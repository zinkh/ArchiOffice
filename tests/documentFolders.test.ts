// Dossiers libres sous les phases : server/routes/documentFolders.ts et folder_id de /api/documents.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function setup(projectId = 'pf1') {
  const tenantId = makeTenant();
  const { token } = makeUser(tenantId);
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status: 'Planning' }]);
  const post = (body: object) => request(app).post('/api/document-folders').set(authHeader(token)).send(body);
  return { tenantId, token, projectId, post };
}

describe('Dossiers de la GED', () => {
  it('crée un dossier sous une phase, puis un sous-dossier, et les relit', async () => {
    const { token, projectId, post } = setup('pf1');
    const plans = await post({ project_id: projectId, phase: 'PRO', name: '  Plans   RDC ' });
    expect(plans.status).toBe(201);
    expect(plans.body).toMatchObject({ phase: 'PRO', name: 'Plans RDC', parent_id: null });

    const child = await post({ project_id: projectId, phase: 'PRO', parent_id: plans.body.id, name: 'Structure' });
    expect(child.status).toBe(201);

    const list = await request(app).get(`/api/document-folders?project_id=${projectId}`).set(authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body.map((f: any) => f.name).sort()).toEqual(['Plans RDC', 'Structure']);
  });

  it('refuse un nom vide ou interdit, une phase inconnue et un doublon (casse et accents ignorés)', async () => {
    const { projectId, post } = setup('pf2');
    expect((await post({ project_id: projectId, phase: 'PRO', name: '   ' })).status).toBe(400);
    expect((await post({ project_id: projectId, phase: 'PRO', name: 'a/b' })).status).toBe(400);
    expect((await post({ project_id: projectId, phase: 'XYZ', name: 'Plans' })).status).toBe(400);
    expect((await post({ project_id: projectId, phase: 'PRO', name: 'Pièces écrites' })).status).toBe(201);
    expect((await post({ project_id: projectId, phase: 'PRO', name: 'PIECES ECRITES' })).status).toBe(409);
    // Même nom dans une autre phase : autorisé.
    expect((await post({ project_id: projectId, phase: 'DCE', name: 'Pièces écrites' })).status).toBe(201);
  });

  it('limite la profondeur à trois niveaux et refuse un parent d’une autre phase', async () => {
    const { projectId, post } = setup('pf3');
    const a = (await post({ project_id: projectId, phase: 'PRO', name: 'A' })).body;
    const b = (await post({ project_id: projectId, phase: 'PRO', parent_id: a.id, name: 'B' })).body;
    const c = await post({ project_id: projectId, phase: 'PRO', parent_id: b.id, name: 'C' });
    expect(c.status).toBe(201);
    expect((await post({ project_id: projectId, phase: 'PRO', parent_id: c.body.id, name: 'D' })).status).toBe(400);
    expect((await post({ project_id: projectId, phase: 'DCE', parent_id: a.id, name: 'E' })).status).toBe(400);
  });

  it('ne crée pas de dossier dans l’affaire d’un autre cabinet', async () => {
    const other = setup('pf4-autre');
    const mine = setup('pf4');
    const res = await mine.post({ project_id: other.projectId, phase: 'PRO', name: 'Plans' });
    expect(res.status).toBe(404);
    const list = await request(app).get('/api/document-folders').set(authHeader(mine.token));
    expect(list.body).toEqual([]);
  });

  it('renomme un dossier sans créer de doublon', async () => {
    const { token, projectId, post } = setup('pf5');
    const a = (await post({ project_id: projectId, phase: 'PRO', name: 'Plans' })).body;
    await post({ project_id: projectId, phase: 'PRO', name: 'Notes' });
    const rename = (name: string) => request(app).put(`/api/document-folders/${a.id}`).set(authHeader(token)).send({ name });
    expect((await rename('Plans de structure')).status).toBe(200);
    expect((await rename('notes')).status).toBe(409);
  });

  it('range un document dans un dossier de sa propre affaire et phase, et le retire quand il change de phase', async () => {
    const { tenantId, token, projectId, post } = setup('pf6');
    const folder = (await post({ project_id: projectId, phase: 'PRO', name: 'Plans' })).body;
    const otherPhase = (await post({ project_id: projectId, phase: 'DCE', name: 'DCE' })).body;
    fakeSupabaseAdmin.seed('documents', [{ id: 'd1', tenant_id: tenantId, project_id: projectId, name: 'Plan RDC.pdf', category: 'Other', phase: 'PRO', version: 1, file_url: 'x' }]);
    const put = (body: object) => request(app).put('/api/documents/d1').set(authHeader(token)).send({ name: 'Plan RDC.pdf', category: 'Other', ...body });

    expect((await put({ phase: 'PRO', project_id: projectId, folder_id: otherPhase.id })).status).toBe(400);
    expect((await put({ phase: 'PRO', project_id: projectId, folder_id: folder.id })).status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('documents').find((d: any) => d.id === 'd1')!.folder_id).toBe(folder.id);

    // Changer de phase sans préciser de dossier le retire.
    expect((await put({ phase: 'DCE', project_id: projectId })).status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('documents').find((d: any) => d.id === 'd1')!.folder_id).toBeNull();
  });

  it('refuse de supprimer un dossier qui contient un document ou un sous-dossier', async () => {
    const { tenantId, token, projectId, post } = setup('pf7');
    const parent = (await post({ project_id: projectId, phase: 'PRO', name: 'Parent' })).body;
    const child = (await post({ project_id: projectId, phase: 'PRO', parent_id: parent.id, name: 'Enfant' })).body;
    fakeSupabaseAdmin.seed('documents', [{ id: 'd2', tenant_id: tenantId, project_id: projectId, name: 'a.pdf', category: 'Other', phase: 'PRO', version: 1, file_url: 'x', folder_id: child.id }]);
    const del = (id: string) => request(app).delete(`/api/document-folders/${id}`).set(authHeader(token));

    expect((await del(parent.id)).status).toBe(409);
    expect((await del(child.id)).status).toBe(409);
    fakeSupabaseAdmin.getTable('documents').find((d: any) => d.id === 'd2')!.folder_id = null;
    expect((await del(child.id)).status).toBe(200);
    expect((await del(parent.id)).status).toBe(200);
  });
});
