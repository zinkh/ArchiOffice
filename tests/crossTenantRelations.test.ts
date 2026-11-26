// Issue #245 : un identifiant relationnel fourni par le client (project_id,
// client_id, contrat_id, contrat_moe_id...) doit appartenir au cabinet de
// l'appelant. Une clé étrangère simple ne garantit que l'existence de l'id,
// pas son cabinet : sans contrôle serveur, un utilisateur du cabinet A pouvait
// rattacher une ligne à une ressource du cabinet B, dont le nom remontait
// ensuite dans ses listes (jointures faites avec la clé service-role).
//
// Une ressource étrangère et une ressource inexistante reçoivent la MÊME
// réponse : l'erreur ne révèle jamais qu'un id existe chez un autre cabinet.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seed() {
  const tenantId = makeTenant();
  const other = makeTenant();
  const admin = makeUser(tenantId, 'admin');
  const colleague = makeUser(tenantId, 'user');
  const foreignUser = makeUser(other, 'user');
  fakeSupabaseAdmin.seed('projects', [
    { id: `${tenantId}-proj`, tenant_id: tenantId, name: 'Villa Martin' },
    { id: `${other}-proj`, tenant_id: other, name: 'Projet confidentiel autre cabinet' },
  ]);
  fakeSupabaseAdmin.seed('contacts', [
    { id: `${tenantId}-client`, tenant_id: tenantId, first_name: 'Claire', last_name: 'Aubry' },
    { id: `${other}-client`, tenant_id: other, first_name: 'Autre', last_name: 'Cabinet' },
  ]);
  fakeSupabaseAdmin.seed('contrats_moe', [
    { id: `${tenantId}-contrat`, tenant_id: tenantId, project_id: `${tenantId}-proj` },
    { id: `${other}-contrat`, tenant_id: other, project_id: `${other}-proj` },
  ]);
  return {
    tenantId, other, token: admin.token, colleagueId: colleague.userId, foreignUserId: foreignUser.userId,
    proj: `${tenantId}-proj`, foreignProj: `${other}-proj`,
    client: `${tenantId}-client`, foreignClient: `${other}-client`,
    contrat: `${tenantId}-contrat`, foreignContrat: `${other}-contrat`,
  };
}

const rows = (table: string, tenantId: string) => fakeSupabaseAdmin.getTable(table).filter((r: any) => r.tenant_id === tenantId);
const post = (token: string, url: string, body: object) => request(app).post(url).set(authHeader(token)).send(body);
const put = (token: string, url: string, body: object) => request(app).put(url).set(authHeader(token)).send(body);

describe('contrats MOE : relations du même cabinet', () => {
  it('refuse un project_id ou un client_id d\'un autre cabinet, sans rien écrire', async () => {
    const s = seed();
    const before = rows('contrats_moe', s.tenantId).length;
    const withProject = await post(s.token, '/api/contrats_moe', { project_id: s.foreignProj });
    const withClient = await post(s.token, '/api/contrats_moe', { project_id: s.proj, client_id: s.foreignClient });
    expect(withProject.status).toBe(400);
    expect(withClient.status).toBe(400);
    expect(withProject.body.error).toMatch(/introuvable pour ce cabinet/i);
    expect(rows('contrats_moe', s.tenantId)).toHaveLength(before);
  });

  it('répond pareil pour un id étranger et pour un id inexistant', async () => {
    const s = seed();
    const foreign = await post(s.token, '/api/contrats_moe', { project_id: s.foreignProj });
    const missing = await post(s.token, '/api/contrats_moe', { project_id: 'projet-inexistant' });
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toEqual(missing.body);
  });

  it('accepte les relations du cabinet et les écritures sans relation', async () => {
    const s = seed();
    expect((await post(s.token, '/api/contrats_moe', { project_id: s.proj, client_id: s.client })).status).toBe(201);
    expect((await post(s.token, '/api/contrats_moe', {})).status).toBe(201);
  });

  it('refuse de rattacher un contrat existant à une ressource étrangère (PUT)', async () => {
    const s = seed();
    const res = await put(s.token, `/api/contrats_moe/${s.contrat}`, { project_id: s.foreignProj });
    expect(res.status).toBe(400);
    const row = fakeSupabaseAdmin.getTable('contrats_moe').find((r: any) => r.id === s.contrat);
    expect(row?.project_id).toBe(s.proj);
    expect((await put(s.token, `/api/contrats_moe/${s.contrat}`, { client_id: s.client })).status).toBe(200);
  });
});

describe('notes d\'honoraires : relations du même cabinet', () => {
  it('refuse un project_id ou un contrat_id d\'un autre cabinet, sans rien écrire', async () => {
    const s = seed();
    const before = rows('notes_honoraires', s.tenantId).length;
    const withProject = await post(s.token, '/api/notes_honoraires', { project_id: s.foreignProj });
    const withContrat = await post(s.token, '/api/notes_honoraires', { project_id: s.proj, contrat_id: s.foreignContrat });
    expect(withProject.status).toBe(400);
    expect(withContrat.status).toBe(400);
    expect(withProject.body.error).toMatch(/introuvable pour ce cabinet/i);
    expect(rows('notes_honoraires', s.tenantId)).toHaveLength(before);
  });

  it('accepte les relations du cabinet', async () => {
    const s = seed();
    const res = await post(s.token, '/api/notes_honoraires', { project_id: s.proj, contrat_id: s.contrat });
    expect(res.status).toBe(201);
  });

  it('refuse de rattacher une note existante à une ressource étrangère (PUT)', async () => {
    const s = seed();
    const created = await post(s.token, '/api/notes_honoraires', { project_id: s.proj });
    expect(created.status).toBe(201);
    const res = await put(s.token, `/api/notes_honoraires/${created.body.id}`, { project_id: s.foreignProj });
    expect(res.status).toBe(400);
    const row = fakeSupabaseAdmin.getTable('notes_honoraires').find((r: any) => r.id === created.body.id);
    expect(row?.project_id).toBe(s.proj);
    expect((await put(s.token, `/api/notes_honoraires/${created.body.id}`, { contrat_id: s.foreignContrat })).status).toBe(400);
  });
});

describe('avenants MOE : relations du même cabinet', () => {
  it('refuse un contrat_moe_id ou un project_id d\'un autre cabinet, sans rien écrire', async () => {
    const s = seed();
    const before = rows('avenants_moe', s.tenantId).length;
    const withContrat = await post(s.token, '/api/avenants_moe', { contrat_moe_id: s.foreignContrat, project_id: s.proj });
    const withProject = await post(s.token, '/api/avenants_moe', { contrat_moe_id: s.contrat, project_id: s.foreignProj });
    expect(withContrat.status).toBe(400);
    expect(withProject.status).toBe(400);
    expect(withContrat.body.error).toMatch(/introuvable pour ce cabinet/i);
    expect(rows('avenants_moe', s.tenantId)).toHaveLength(before);
  });

  it('accepte les relations du cabinet', async () => {
    const s = seed();
    const res = await post(s.token, '/api/avenants_moe', { contrat_moe_id: s.contrat, project_id: s.proj, title: 'Avenant 1' });
    expect(res.status).toBe(201);
  });
});

describe('membres d\'une affaire : projet du même cabinet', () => {
  it('refuse d\'ajouter un membre sur le projet d\'un autre cabinet', async () => {
    const s = seed();
    const before = rows('project_members', s.tenantId).length;
    const foreign = await post(s.token, `/api/projects/${s.foreignProj}/members`, { user_id: s.colleagueId });
    const missing = await post(s.token, '/api/projects/projet-inexistant/members', { user_id: s.colleagueId });
    expect(foreign.status).toBe(404);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toEqual(missing.body);
    expect(rows('project_members', s.tenantId)).toHaveLength(before);
    expect(fakeSupabaseAdmin.getTable('project_members').filter((r: any) => r.project_id === s.foreignProj)).toHaveLength(0);
  });

  it('accepte un membre du cabinet sur un projet du cabinet', async () => {
    const s = seed();
    const res = await post(s.token, `/api/projects/${s.proj}/members`, { user_id: s.colleagueId });
    expect(res.status).toBe(201);
  });

  it('refuse un utilisateur d\'un autre cabinet (déjà couvert)', async () => {
    const s = seed();
    const res = await post(s.token, `/api/projects/${s.proj}/members`, { user_id: s.foreignUserId });
    expect(res.status).toBe(400);
  });
});
