// Archivage des affaires : server/routes/projectArchive.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage } from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function seedProject(tenantId: string, id: string, status = 'Completed') {
  fakeSupabaseAdmin.seed('projects', [{ id, tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status }]);
}

/** Affaire sans aucune alerte : DOE visé, rien d'ouvert. */
function seedCleanProject(tenantId: string, id: string) {
  seedProject(tenantId, id);
  fakeSupabaseAdmin.seed('documents', [{ id: `${id}-visa`, tenant_id: tenantId, project_id: id, doc_type: 'DOE_VISA' }]);
}

describe('Archivage des affaires', () => {
  it('archive une affaire sans alerte et fixe la fin de conservation à 10 ans', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    seedCleanProject(tenantId, 'ar1');

    const res = await request(app).post('/api/projects/ar1/archive').set(authHeader(token)).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ archived: true, overridden: 0 });
    const year = new Date().getUTCFullYear();
    expect(res.body.retention_until).toMatch(new RegExp(`^${year + 10}-`));

    const row = fakeSupabaseAdmin.getTable('projects').find((p: any) => p.id === 'ar1')!;
    expect(row.archived_at).toBeTruthy();
    expect(row.archived_by).toBeTruthy();
  });

  it('clôture indicative : des alertes demandent un motif, puis passent', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'manager');
    seedProject(tenantId, 'ar2', 'In Progress');
    fakeSupabaseAdmin.seed('invoices', [{ id: 'ar2-inv', tenant_id: tenantId, project_id: 'ar2', status: 'Sent' }]);

    const refused = await request(app).post('/api/projects/ar2/archive').set(authHeader(token)).send({});
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('CHECKLIST_OVERRIDE_REQUIRED');
    expect(refused.body.checklist.some((i: any) => i.id === 'invoices' && i.state === 'warning')).toBe(true);
    expect(fakeSupabaseAdmin.getTable('projects').find((p: any) => p.id === 'ar2')?.archived_at).toBeFalsy();

    const passed = await request(app).post('/api/projects/ar2/archive').set(authHeader(token))
      .send({ override_reason: 'Facture réglée hors plateforme' });
    expect(passed.status).toBe(200);
    expect(passed.body.overridden).toBeGreaterThan(0);

    const log = fakeSupabaseAdmin.getTable('project_archive_log').filter((l: any) => l.project_id === 'ar2');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'archive', reason: 'Facture réglée hors plateforme' });
    expect(log[0].overridden_checks.length).toBeGreaterThan(0);
  });

  it('refuse d’archiver deux fois et réserve l’archivage aux administrateurs et managers', async () => {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    const member = makeUser(tenantId, 'user');
    seedCleanProject(tenantId, 'ar3');

    expect((await request(app).post('/api/projects/ar3/archive').set(authHeader(member.token)).send({})).status).toBe(403);
    expect((await request(app).post('/api/projects/ar3/archive').set(authHeader(admin.token)).send({})).status).toBe(200);
    const again = await request(app).post('/api/projects/ar3/archive').set(authHeader(admin.token)).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PROJECT_ARCHIVED');
  });

  it('met l’affaire archivée en lecture seule', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    seedCleanProject(tenantId, 'ar4');
    await request(app).post('/api/projects/ar4/archive').set(authHeader(token)).send({});

    const put = await request(app).put('/api/projects/ar4').set(authHeader(token)).send({ description: 'Modifiée' });
    expect(put.status).toBe(409);
    expect(put.body.code).toBe('PROJECT_ARCHIVED');
  });

  it('rouvre une affaire avec un motif, administrateurs seulement', async () => {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    const manager = makeUser(tenantId, 'manager');
    seedCleanProject(tenantId, 'ar5');
    await request(app).post('/api/projects/ar5/archive').set(authHeader(admin.token)).send({});

    expect((await request(app).post('/api/projects/ar5/unarchive').set(authHeader(manager.token)).send({ reason: 'Avenant' })).status).toBe(403);
    expect((await request(app).post('/api/projects/ar5/unarchive').set(authHeader(admin.token)).send({})).status).toBe(400);

    const ok = await request(app).post('/api/projects/ar5/unarchive').set(authHeader(admin.token)).send({ reason: 'Avenant au marché' });
    expect(ok.status).toBe(200);
    const row = fakeSupabaseAdmin.getTable('projects').find((p: any) => p.id === 'ar5')!;
    expect(row.archived_at).toBeNull();
    expect(row.retention_until).toBeNull();

    const log = await request(app).get('/api/projects/ar5/archive-log').set(authHeader(admin.token));
    expect(log.body.map((l: any) => l.action).sort()).toEqual(['archive', 'unarchive']);
  });

  it('dépose le dossier de clôture sur l’espace externe quand il est actif', async () => {
    memoryDrive.reset();
    const tenantId = makeTenant({ plan: 'pro' });
    const { token } = makeUser(tenantId, 'admin');
    connectExternalStorage(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'ar7', tenant_id: tenantId, project_code: '26014', name: 'Villa Martin', client: 'M. Martin', status: 'Completed' }]);
    fakeSupabaseAdmin.seed('documents', [{ id: 'ar7-visa', tenant_id: tenantId, project_id: 'ar7', doc_type: 'DOE_VISA', name: 'Visa DOE-2026-001.pdf' }]);

    const res = await request(app).post('/api/projects/ar7/archive').set(authHeader(token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.dossier).toMatchObject({ deposited: true });

    const doc = fakeSupabaseAdmin.getTable('documents').find((d: any) => d.doc_type === 'DOSSIER_CLOTURE');
    expect(doc).toMatchObject({ project_id: 'ar7', category: 'Clôture', storage_backend: 'external', mime_type: 'application/pdf' });
    expect(memoryDrive.livePaths().some(p => p.includes('26014 - Villa Martin/Clôture/Dossier de clôture') && p.endsWith('.pdf'))).toBe(true);
  });

  it('ne dépose rien sans espace externe, mais le dossier reste téléchargeable', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const { token } = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('projects', [{ id: 'ar8', tenant_id: tenantId, project_code: '26015', name: 'Maison Durand', client: 'M. Durand', status: 'Completed' }]);
    fakeSupabaseAdmin.seed('documents', [{ id: 'ar8-visa', tenant_id: tenantId, project_id: 'ar8', doc_type: 'DOE_VISA', name: 'Visa.pdf' }]);

    const before = await request(app).get('/api/projects/ar8/closure-dossier').set(authHeader(token));
    expect(before.status).toBe(409);

    const res = await request(app).post('/api/projects/ar8/archive').set(authHeader(token)).send({});
    expect(res.body.dossier).toEqual({ deposited: false, reason: 'no_external_storage' });
    expect(fakeSupabaseAdmin.getTable('documents').some((d: any) => d.doc_type === 'DOSSIER_CLOTURE' && d.project_id === 'ar8')).toBe(false);

    const pdf = await request(app).get('/api/projects/ar8/closure-dossier').set(authHeader(token)).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('réserve le dossier de clôture aux administrateurs et managers', async () => {
    const tenantId = makeTenant();
    const member = makeUser(tenantId, 'user');
    seedCleanProject(tenantId, 'ar9');
    const res = await request(app).get('/api/projects/ar9/closure-dossier').set(authHeader(member.token));
    expect(res.status).toBe(403);
  });

  it('refuse toute écriture rattachée à une affaire archivée, et laisse lire', async () => {
    const tenantId = makeTenant({ plan: 'pro' });
    const { token } = makeUser(tenantId, 'admin');
    seedCleanProject(tenantId, 'ar10');
    fakeSupabaseAdmin.seed('reserves', [{ id: 'ar10-res', tenant_id: tenantId, project_id: 'ar10', title: 'Joint', status: 'Levée' }]);
    fakeSupabaseAdmin.seed('documents', [{ id: 'ar10-doc', tenant_id: tenantId, project_id: 'ar10', name: 'Plan.pdf', doc_type: 'DOC' }]);
    await request(app).post('/api/projects/ar10/archive').set(authHeader(token)).send({});

    const attendu = (res: request.Response) => {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PROJECT_ARCHIVED');
    };
    attendu(await request(app).put('/api/reserves/ar10-res').set(authHeader(token)).send({ title: 'Autre' }));
    attendu(await request(app).delete('/api/documents/ar10-doc').set(authHeader(token)));
    attendu(await request(app).post('/api/tasks').set(authHeader(token)).send({ title: 'Reprise', project_id: 'ar10' }));
    attendu(await request(app).post('/api/projects/ar10/phase-notes').set(authHeader(token)).send({ phase: 'DET', body: 'Note' }));
    attendu(await request(app).post('/api/documents').set(authHeader(token))
      .field('project_id', 'ar10').field('name', 'Nouveau').attach('file', Buffer.from('%PDF-1.4'), 'nouveau.pdf'));

    // La lecture et la réouverture restent possibles.
    expect((await request(app).get('/api/projects/ar10/phase-notes').set(authHeader(token))).status).toBe(200);
    expect((await request(app).post('/api/projects/ar10/unarchive').set(authHeader(token)).send({ reason: 'Avenant' })).status).toBe(200);
    const apres = await request(app).put('/api/reserves/ar10-res').set(authHeader(token)).send({ title: 'Joint repris', project_id: 'ar10' });
    expect(apres.status).not.toBe(409);
  });

  it('n’archive pas l’affaire d’un autre cabinet', async () => {
    const mine = makeTenant();
    const other = makeTenant();
    const { token } = makeUser(mine, 'admin');
    seedCleanProject(other, 'ar6');

    const res = await request(app).post('/api/projects/ar6/archive').set(authHeader(token)).send({});
    expect(res.status).toBe(404);
  });
});
