// Classer un document (autre affaire, autre phase) déplace aussi son fichier dans le
// drive du cabinet — storeBusinessFile.relocateBusinessFile, appelé par PUT /api/documents/:id.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage } from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => { memoryDrive.reset(); });

function seedProject(tenantId: string, id: string, code: string, name: string) {
  fakeSupabaseAdmin.seed('projects', [{ id, tenant_id: tenantId, project_code: code, name }]);
}
async function upload(token: string, projectId: string, phase: string) {
  return request(app).post('/api/documents').set(authHeader(token))
    .field('name', 'CCTP').field('category', 'CCTP').field('phase', phase).field('project_id', projectId)
    .attach('file', Buffer.from('%PDF-fake'), 'cctp.pdf');
}
const put = (token: string, id: string, body: Record<string, unknown>) =>
  request(app).put(`/api/documents/${id}`).set(authHeader(token)).send({ name: 'CCTP', category: 'CCTP', ...body });

describe('classement et espace de stockage du cabinet', () => {
  it('déplace le fichier vers la nouvelle affaire et la nouvelle phase', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'a', '26014', 'Villa Martin');
    seedProject(tenantId, 'b', '26020', 'Château');
    const created = await upload(token, 'a', 'DCE');
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/DCE/cctp.pdf']);

    const res = await put(token, created.body.id, { phase: 'PRO', project_id: 'b' });
    expect(res.status).toBe(200);
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26020 - Château/PRO/cctp.pdf']);
    expect(memoryDrive.moveCalls).toBe(1);
    const doc = fakeSupabaseAdmin.getTable('documents').find((d) => d.id === created.body.id)!;
    expect(doc.project_id).toBe('b');
    expect(doc.phase).toBe('PRO');
  });

  it('ne déplace rien quand le classement ne change pas', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'a', '26014', 'Villa Martin');
    const created = await upload(token, 'a', 'DCE');
    await put(token, created.body.id, { phase: 'DCE', project_id: 'a', description: 'x' });
    expect(memoryDrive.moveCalls).toBe(0);
  });

  it('si le fournisseur refuse, le document reste classé où il était', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    connectExternalStorage(tenantId);
    seedProject(tenantId, 'a', '26014', 'Villa Martin');
    seedProject(tenantId, 'b', '26020', 'Château');
    const created = await upload(token, 'a', 'DCE');
    memoryDrive.failNextMoveWith(new Error('drive injoignable'));

    const res = await put(token, created.body.id, { phase: 'PRO', project_id: 'b' });
    expect(res.status).toBeGreaterThanOrEqual(500);
    const doc = fakeSupabaseAdmin.getTable('documents').find((d) => d.id === created.body.id)!;
    expect(doc.project_id).toBe('a');
    expect(doc.phase).toBe('DCE');
    expect(memoryDrive.livePaths()).toEqual(['ArchiOffice/26014 - Villa Martin/DCE/cctp.pdf']);
  });

  it('un document stocké chez Supabase se reclasse sans appeler le drive', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    seedProject(tenantId, 'a', '26014', 'Villa Martin');
    seedProject(tenantId, 'b', '26020', 'Château');
    const created = await upload(token, 'a', 'DCE');
    const res = await put(token, created.body.id, { phase: 'PRO', project_id: 'b' });
    expect(res.status).toBe(200);
    expect(memoryDrive.moveCalls).toBe(0);
  });
});
