// Les dossiers libres de la GED (document_folders) existent aussi chez le fournisseur de stockage :
//   <racine>/<code> - <affaire>/<phase>/<dossier>/<sous-dossier>/<fichier>
// Dépôt, nouvelle version et classement passent par documents.ts (voir supabase/migrate_document_folders.sql).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage } from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => { memoryDrive.reset(); });

function setup() {
  const tenantId = makeTenant();
  const { token } = makeUser(tenantId, 'admin');
  connectExternalStorage(tenantId);
  fakeSupabaseAdmin.seed('projects', [{ id: 'a', tenant_id: tenantId, project_code: '26014', name: 'Villa Martin' }]);
  const folder = async (body: Record<string, unknown>) =>
    (await request(app).post('/api/document-folders').set(authHeader(token)).send({ project_id: 'a', ...body })).body;
  const upload = (extra: Record<string, string> = {}) => {
    const req = request(app).post('/api/documents').set(authHeader(token))
      .field('name', 'Plan').field('category', 'Other').field('phase', 'PRO').field('project_id', 'a');
    for (const [k, v] of Object.entries(extra)) req.field(k, v);
    return req.attach('file', Buffer.from('%PDF-fake'), 'plan.pdf');
  };
  const put = (id: string, body: Record<string, unknown>) =>
    request(app).put(`/api/documents/${id}`).set(authHeader(token)).send({ name: 'Plan', category: 'Other', phase: 'PRO', project_id: 'a', ...body });
  const newVersion = (id: string, extra: Record<string, string> = {}) => {
    const req = request(app).put(`/api/documents/${id}`).set(authHeader(token))
      .field('name', 'Plan').field('category', 'Other').field('phase', 'PRO');
    for (const [k, v] of Object.entries(extra)) req.field(k, v);
    return req.attach('file', Buffer.from('%PDF-fake v2'), 'plan-v2.pdf');
  };
  return { tenantId, token, folder, upload, put, newVersion };
}

describe('dossiers libres et espace de stockage du cabinet', () => {
  it('dépose le fichier dans le dossier et le sous-dossier choisis', async () => {
    const { folder, upload } = setup();
    const plans = await folder({ phase: 'PRO', name: 'Plans' });
    const structure = await folder({ phase: 'PRO', parent_id: plans.id, name: 'Structure' });
    const res = await upload({ folder_id: structure.id });
    expect(res.status).toBeLessThan(300);
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/PRO/Plans/Structure/plan.pdf']);
  });

  it('sans dossier, le fichier reste à la racine de la phase', async () => {
    const { upload } = setup();
    await upload();
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/PRO/plan.pdf']);
  });

  it('déplace le fichier chez le fournisseur quand on le range dans un dossier, puis quand on l’en sort', async () => {
    const { folder, upload, put } = setup();
    const plans = await folder({ phase: 'PRO', name: 'Plans' });
    const created = await upload();

    expect((await put(created.body.id, { folder_id: plans.id })).status).toBe(200);
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/PRO/Plans/plan.pdf']);
    expect(memoryDrive.moveCalls).toBe(1);

    expect((await put(created.body.id, { folder_id: '' })).status).toBe(200);
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/PRO/plan.pdf']);
    expect(memoryDrive.moveCalls).toBe(2);
  });

  it('un changement de phase sort le fichier du dossier, chez le fournisseur comme en base', async () => {
    const { folder, upload, put } = setup();
    const plans = await folder({ phase: 'PRO', name: 'Plans' });
    const created = await upload({ folder_id: plans.id });
    expect((await put(created.body.id, { phase: 'DCE' })).status).toBe(200);
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/DCE/plan.pdf']);
    expect(fakeSupabaseAdmin.getTable('documents').find((d: any) => d.id === created.body.id)!.folder_id).toBeNull();
  });

  it('ne déplace rien quand le dossier ne change pas', async () => {
    const { folder, upload, put } = setup();
    const plans = await folder({ phase: 'PRO', name: 'Plans' });
    const created = await upload({ folder_id: plans.id });
    await put(created.body.id, { folder_id: plans.id, description: 'x' });
    expect(memoryDrive.moveCalls).toBe(0);
  });

  it('si le fournisseur refuse le déplacement, le document reste dans son dossier', async () => {
    const { folder, upload, put } = setup();
    const plans = await folder({ phase: 'PRO', name: 'Plans' });
    const notes = await folder({ phase: 'PRO', name: 'Notes' });
    const created = await upload({ folder_id: plans.id });
    memoryDrive.failNextMoveWith(new Error('drive injoignable'));

    expect((await put(created.body.id, { folder_id: notes.id })).status).toBeGreaterThanOrEqual(500);
    expect(fakeSupabaseAdmin.getTable('documents').find((d: any) => d.id === created.body.id)!.folder_id).toBe(plans.id);
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/PRO/Plans/plan.pdf']);
  });

  it('une nouvelle version rejoint le dossier du document', async () => {
    const { folder, upload, newVersion } = setup();
    const plans = await folder({ phase: 'PRO', name: 'Plans' });
    const created = await upload({ folder_id: plans.id });
    expect((await newVersion(created.body.id)).status).toBe(200);
    const paths = memoryDrive.livePaths();
    expect(paths.length).toBeGreaterThanOrEqual(1);
    expect(paths.every(p => p.startsWith('ArchiOffice/26014 - Villa Martin/PRO/Plans/'))).toBe(true);
  });
});
