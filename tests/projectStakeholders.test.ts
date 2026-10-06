// PUT /api/projects/:id/stakeholders : voir server/routes/projectStakeholders.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seedProject(tenantId: string, projectId: string) {
  fakeSupabaseAdmin.seed('projects', [{
    id: projectId, tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status: 'Planning',
    is_chantier: true, is_public_client: true,
  }]);
}

describe('Intervenants d’une affaire', () => {
  it('remplace la liste, garde les identifiants connus et complète le nom depuis le contact', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'ps1');
    fakeSupabaseAdmin.seed('contacts', [{ id: 'ps1-k', tenant_id: tenantId, first_name: 'Luc', last_name: 'Bern', company_name: 'BET Bern' }]);
    fakeSupabaseAdmin.seed('project_stakeholders', [
      { id: 'ps1-a', tenant_id: tenantId, project_id: 'ps1', name: 'M. Martin', role: 'MOA', contact_id: null },
      { id: 'ps1-b', tenant_id: tenantId, project_id: 'ps1', name: 'À retirer', role: 'CT', contact_id: null },
    ]);

    const res = await request(app).put('/api/projects/ps1/stakeholders').set(authHeader(token)).send({
      stakeholders: [
        { id: 'ps1-a', name: 'M. Martin', role: 'MOA' },
        { name: '', role: 'BET structure', contact_id: 'ps1-k' },
      ],
    });
    expect(res.status).toBe(200);
    const rows = fakeSupabaseAdmin.getTable('project_stakeholders').filter(r => r.project_id === 'ps1');
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.id === 'ps1-a')).toBeTruthy();
    expect(rows.find(r => r.role === 'BET structure')).toMatchObject({ name: 'BET Bern', contact_id: 'ps1-k' });
    expect(res.body.stakeholders).toHaveLength(2);
  });

  it('ne touche pas au reste de la fiche (booléens compris)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'ps2');
    await request(app).put('/api/projects/ps2/stakeholders').set(authHeader(token))
      .send({ stakeholders: [{ name: 'X', role: 'MOA' }] }).expect(200);
    const project = fakeSupabaseAdmin.getTable('projects').find(p => p.id === 'ps2');
    expect(project).toMatchObject({ is_chantier: true, is_public_client: true, name: 'Villa Martin' });
  });

  it('refuse un identifiant d’un autre projet : il reçoit un nouvel identifiant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'ps3'); seedProject(tenantId, 'ps3b');
    fakeSupabaseAdmin.seed('project_stakeholders', [{ id: 'ps3b-s', tenant_id: tenantId, project_id: 'ps3b', name: 'Autre', role: 'MOA', contact_id: null }]);
    await request(app).put('/api/projects/ps3/stakeholders').set(authHeader(token))
      .send({ stakeholders: [{ id: 'ps3b-s', name: 'Autre', role: 'MOA' }] }).expect(200);
    expect(fakeSupabaseAdmin.getTable('project_stakeholders').find(r => r.id === 'ps3b-s')!.project_id).toBe('ps3b');
    expect(fakeSupabaseAdmin.getTable('project_stakeholders').filter(r => r.project_id === 'ps3')).toHaveLength(1);
  });

  it('valide le corps : rôle, nom ou contact exigés, liste attendue', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'ps4');
    const put = (body: any) => request(app).put('/api/projects/ps4/stakeholders').set(authHeader(token)).send(body);
    expect((await put({})).status).toBe(400);
    expect((await put({ stakeholders: [{ name: 'X', role: '  ' }] })).status).toBe(400);
    expect((await put({ stakeholders: [{ role: 'MOA' }] })).status).toBe(400);
  });

  it('refuse un contact ou un projet d’un autre cabinet', async () => {
    const tenantId = makeTenant();
    const other = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'ps5'); seedProject(other, 'ps5-other');
    fakeSupabaseAdmin.seed('contacts', [{ id: 'ps5-k', tenant_id: other, first_name: 'Z', last_name: 'Z' }]);
    const put = (id: string, body: any) => request(app).put(`/api/projects/${id}/stakeholders`).set(authHeader(token)).send(body);
    expect((await put('ps5', { stakeholders: [{ role: 'MOA', contact_id: 'ps5-k' }] })).status).toBe(400);
    expect((await put('ps5-other', { stakeholders: [{ name: 'X', role: 'MOA' }] })).status).toBe(404);
  });
});
