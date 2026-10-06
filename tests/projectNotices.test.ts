// Notices d'études et notices réglementaires : server/routes/projectNotices.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function seedProject(tenantId: string, id: string) {
  fakeSupabaseAdmin.seed('projects', [{
    id,
    tenant_id: tenantId,
    name: 'École des Tilleuls',
    client: 'Commune test',
    status: 'Planning',
    type_et_cat: 'ERP type R',
    effectif_public: '120',
  }]);
}

describe('Notices de l’opération', () => {
  it('enregistre séparément les notices architecturales de deux phases', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'notice-1');

    const aps = await request(app)
      .put('/api/projects/notice-1/notices/architectural/APS')
      .set(authHeader(token))
      .send({ content: 'Notice APS', instructions: 'Rester synthétique' });
    expect(aps.status).toBe(200);
    expect(aps.body).toMatchObject({ kind: 'architectural', phase: 'APS', content: 'Notice APS', status: 'redige' });

    const apd = await request(app)
      .put('/api/projects/notice-1/notices/architectural/APD')
      .set(authHeader(token))
      .send({ content: 'Notice APD' });
    expect(apd.status).toBe(200);

    const list = await request(app).get('/api/projects/notice-1/notices').set(authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.map((n: any) => n.phase).sort()).toEqual(['APD', 'APS']);

    const controls = await request(app).get('/api/projects/notice-1/phase-controls?to=APD').set(authHeader(token));
    expect(controls.status).toBe(200);
    const noticeControl = controls.body.controls.find((control: any) => control.rule.id === 'notice');
    expect(noticeControl?.candidates?.some((candidate: any) =>
      String(candidate.id).startsWith('notice:') && /notice sommaire/i.test(candidate.name)
    )).toBe(true);
  });

  it('met à jour une notice existante au lieu de la dupliquer', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'notice-2');

    await request(app).put('/api/projects/notice-2/notices/accessibility/PC')
      .set(authHeader(token)).send({ content: 'Version 1' });
    const updated = await request(app).put('/api/projects/notice-2/notices/accessibility/PC')
      .set(authHeader(token)).send({ content: 'Version 2' });

    expect(updated.status).toBe(200);
    expect(updated.body.content).toBe('Version 2');
    const rows = fakeSupabaseAdmin.getTable('project_notices')
      .filter((n: any) => n.project_id === 'notice-2' && n.kind === 'accessibility');
    expect(rows).toHaveLength(1);
  });

  it('refuse les combinaisons inconnues ou une phase réglementaire autre que PC', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'notice-3');

    expect((await request(app).put('/api/projects/notice-3/notices/other/PC').set(authHeader(token)).send({ content: 'x' })).status).toBe(400);
    expect((await request(app).put('/api/projects/notice-3/notices/security/APD').set(authHeader(token)).send({ content: 'x' })).status).toBe(400);
    expect((await request(app).put('/api/projects/notice-3/notices/architectural/DET').set(authHeader(token)).send({ content: 'x' })).status).toBe(400);
  });

  it('n’accède pas aux notices d’un autre cabinet', async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant();
    const { token: tokenA } = makeUser(tenantA);
    const { token: tokenB } = makeUser(tenantB);
    seedProject(tenantA, 'notice-4');

    await request(app).put('/api/projects/notice-4/notices/security/PC')
      .set(authHeader(tokenA)).send({ content: 'SSI catégorie à confirmer' });

    const foreign = await request(app).get('/api/projects/notice-4/notices').set(authHeader(tokenB));
    expect(foreign.status).toBe(404);
  });
});
