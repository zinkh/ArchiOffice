// Les dossiers libres de la GED (document_folders) dans l'arborescence desktop :
// nœud `fld:<id>`, enfants, chemins, déplacement (PATCH) et dépôt dans un dossier.
// Docs : docs/desktop-sync-contract.md, section « Dossiers libres ».
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { fakeSupabaseAdmin, getTestApp } from './testServer';
import {
  makeDriveTenant as makeTenant, API, makeActor, seedDocument, seedProject, sha256, type Actor,
} from './desktopSyncSupport';

let app: Express;
let tempDir: string;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archioffice-desktop-folders-'));
  process.env.DESKTOP_UPLOAD_DIR = tempDir;
  app = await getTestApp();
  fakeSupabaseAdmin.seed('desktop_sync_state', [{ key: 'floor_seq', value: 0 }]);
});
afterAll(() => {
  delete process.env.DESKTOP_UPLOAD_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const get = (actor: Actor, p: string) => request(app).get(`${API}${p}`).set(actor.headers);
const patch = (actor: Actor, p: string, body: object) => request(app).patch(`${API}${p}`).set(actor.headers).send(body);
const names = (body: any) => body.nodes.map((n: any) => n.name);

function seedFolder(tenantId: string, row: { id: string; project_id?: string; phase?: string; parent_id?: string | null; name: string }) {
  fakeSupabaseAdmin.seed('document_folders', [{ project_id: 'p1', phase: 'PRO', parent_id: null, ...row, tenant_id: tenantId }]);
  return row.id;
}
const docRow = (tenantId: string, id: string) =>
  fakeSupabaseAdmin.getTable('documents').find(d => d.id === id && d.tenant_id === tenantId)!;

describe('Dossiers libres dans l\'arborescence desktop', () => {
  it('liste les dossiers avant les fichiers sous la phase, puis le contenu de chaque dossier', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedFolder(tenantId, { id: 'f-plans', name: 'Plans' });
    seedFolder(tenantId, { id: 'f-struct', name: 'Structure', parent_id: 'f-plans' });
    seedDocument(tenantId, { id: 'd-racine', project_id: 'p1', phase: 'PRO', name: 'Notice.pdf' });
    seedDocument(tenantId, { id: 'd-plans', project_id: 'p1', phase: 'PRO', name: 'Plan RDC.pdf', folder_id: 'f-plans' });
    seedDocument(tenantId, { id: 'd-struct', project_id: 'p1', phase: 'PRO', name: 'Poutres.pdf', folder_id: 'f-struct' });

    const phase = await get(actor, '/nodes/phase:p1:PRO/children');
    expect(names(phase.body)).toEqual(['Plans', 'Notice.pdf']);
    expect(phase.body.nodes[0]).toMatchObject({
      id: 'fld:f-plans', kind: 'folder', parentId: 'phase:p1:PRO', path: '26014 - Villa Martin/PRO/Plans',
    });

    const plans = await get(actor, '/nodes/fld:f-plans/children');
    expect(names(plans.body)).toEqual(['Structure', 'Plan RDC.pdf']);
    expect(plans.body.nodes[0]).toMatchObject({ id: 'fld:f-struct', parentId: 'fld:f-plans', path: '26014 - Villa Martin/PRO/Plans/Structure' });
    expect(plans.body.nodes[1]).toMatchObject({
      id: 'doc:d-plans', parentId: 'fld:f-plans', path: '26014 - Villa Martin/PRO/Plans/Plan RDC.pdf',
    });

    const struct = await get(actor, '/nodes/fld:f-struct/children');
    expect(names(struct.body)).toEqual(['Poutres.pdf']);
    expect(struct.body.nodes[0].path).toBe('26014 - Villa Martin/PRO/Plans/Structure/Poutres.pdf');
  });

  it('une phase qui n\'a que des dossiers (vides) apparaît sous l\'affaire', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', phase: 'APD', name: 'a.pdf' });
    seedFolder(tenantId, { id: 'f-dce', phase: 'DCE', name: 'Pièces écrites' });

    const phases = await get(actor, '/nodes/prj:p1/children');
    expect(names(phases.body)).toEqual(['APD', 'DCE']);
    const dce = await get(actor, '/nodes/phase:p1:DCE/children');
    expect(names(dce.body)).toEqual(['Pièces écrites']);
    expect((await get(actor, '/nodes/fld:f-dce/children')).body.nodes).toEqual([]);
  });

  it('lit un dossier par son identifiant, jamais celui d\'un autre cabinet', async () => {
    const tenantId = makeTenant();
    const other = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedFolder(tenantId, { id: 'f-mien', name: 'Plans' });
    seedProject(other, 'p1');
    seedFolder(other, { id: 'f-autre', name: 'Secret' });

    const mine = await get(actor, '/nodes/fld:f-mien');
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ id: 'fld:f-mien', kind: 'folder', name: 'Plans' });
    expect((await get(actor, '/nodes/fld:f-autre')).status).toBe(404);
    expect((await get(actor, '/nodes/fld:f-autre/children')).status).toBe(404);
  });

  it('un document rangé dans un dossier a son dossier pour parent', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedFolder(tenantId, { id: 'f-plans', name: 'Plans' });
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', phase: 'PRO', name: 'Plan.pdf', folder_id: 'f-plans' });
    const node = await get(actor, '/nodes/doc:d1');
    expect(node.body).toMatchObject({ parentId: 'fld:f-plans', path: '26014 - Villa Martin/PRO/Plans/Plan.pdf' });
  });

  it('PATCH : déplacer un fichier dans un dossier, puis le remettre à la racine de sa phase', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedFolder(tenantId, { id: 'f-plans', name: 'Plans' });
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', phase: 'PRO', name: 'Plan.pdf' });

    const into = await patch(actor, '/nodes/doc:d1', { parentId: 'fld:f-plans', baseVersion: 1 });
    expect(into.status).toBe(200);
    expect(into.body).toMatchObject({ parentId: 'fld:f-plans', path: '26014 - Villa Martin/PRO/Plans/Plan.pdf' });
    expect(docRow(tenantId, 'd1').folder_id).toBe('f-plans');

    const out = await patch(actor, '/nodes/doc:d1', { parentId: 'phase:p1:PRO', baseVersion: 1 });
    expect(out.status).toBe(200);
    expect(out.body.parentId).toBe('phase:p1:PRO');
    expect(docRow(tenantId, 'd1').folder_id).toBeNull();
  });

  it('PATCH : un dossier d\'une autre affaire est refusé, et changer de phase sort le fichier du dossier', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedProject(tenantId, 'p2', { project_code: '26020', name: 'Château' });
    seedFolder(tenantId, { id: 'f-p2', project_id: 'p2', name: 'Plans' });
    seedFolder(tenantId, { id: 'f-p1', name: 'Plans' });
    seedDocument(tenantId, { id: 'd1', project_id: 'p1', phase: 'PRO', name: 'Plan.pdf', folder_id: 'f-p1' });

    const across = await patch(actor, '/nodes/doc:d1', { parentId: 'fld:f-p2', baseVersion: 1 });
    expect(across.status).toBe(400);
    expect(across.body.code).toBe('MOVE_ACROSS_PROJECTS');
    expect(docRow(tenantId, 'd1').folder_id).toBe('f-p1');

    const phase = await patch(actor, '/nodes/doc:d1', { parentId: 'phase:p1:DCE', baseVersion: 1 });
    expect(phase.status).toBe(200);
    expect(docRow(tenantId, 'd1')).toMatchObject({ phase: 'DCE', folder_id: null });
  });

  it('dépose un nouveau fichier directement dans un dossier libre', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    seedFolder(tenantId, { id: 'f-plans', name: 'Plans' });
    const data = Buffer.from('%PDF-1.4 contenu');
    const opened = await request(app).post(`${API}/uploads`).set(actor.headers).send({
      name: 'Coupe.pdf', size: data.length, sha256: sha256(data), mimeType: 'application/pdf',
      target: { create: { parentId: 'fld:f-plans' } },
    });
    expect(opened.status).toBe(201);
    const id = opened.body.uploadId;
    const sent = await request(app).put(`${API}/uploads/${id}`).set(actor.headers)
      .set('Content-Type', 'application/octet-stream').set('Content-Range', `bytes 0-${data.length - 1}/${data.length}`).send(data);
    expect(sent.status).toBe(204);
    const done = await request(app).post(`${API}/uploads/${id}/complete`).set(actor.headers).send({});
    expect(done.status).toBe(200);
    expect(done.body.node).toMatchObject({ parentId: 'fld:f-plans', path: '26014 - Villa Martin/PRO/Plans/Coupe.pdf' });
    expect(docRow(tenantId, done.body.node.id.replace('doc:', ''))).toMatchObject({ project_id: 'p1', phase: 'PRO', folder_id: 'f-plans' });
  });

  it('refuse un dépôt vers un dossier inconnu avant le premier octet', async () => {
    const tenantId = makeTenant();
    const actor = await makeActor(app, tenantId);
    seedProject(tenantId, 'p1');
    const res = await request(app).post(`${API}/uploads`).set(actor.headers).send({
      name: 'a.pdf', size: 3, sha256: sha256('abc'), target: { create: { parentId: 'fld:inconnu' } },
    });
    expect(res.status).toBe(404);
  });
});
