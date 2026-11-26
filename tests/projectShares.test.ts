// Partage d'une affaire avec un confrère : invitation, droits, refus par défaut,
// limites de la gratuité, retrait. Les routes passent par la vraie application
// Express contre le faux Supabase en mémoire (tests/testServer.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage } from './testServer';
import { buildExternalRef } from '../server/externalStorage/externalRef';
import { allows, checkShareLimits, normalizeGrants, SHARE_LIMITS } from '../server/projectShares/access';
import { readTaskFields } from '../server/routes/projectShares';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const READ_LOTS_AND_TASKS = [{ kind: 'lots', access: 'read' }, { kind: 'tasks', access: 'read' }];
const WRITE_TASKS = [{ kind: 'tasks', access: 'write' }];

let seq = 0;
function setup() {
  const tenantId = makeTenant();
  const admin = makeUser(tenantId, 'admin');
  const projectId = `${tenantId}-p1`;
  const otherProjectId = `${tenantId}-p2`;
  fakeSupabaseAdmin.seed('projects', [
    { id: projectId, tenant_id: tenantId, name: 'Villa Martin', project_code: '26014', address: '1 rue des Lilas' },
    { id: otherProjectId, tenant_id: tenantId, name: 'Autre affaire', project_code: '26015' },
  ]);
  fakeSupabaseAdmin.seed('project_lots', [
    { id: `${tenantId}-l1`, tenant_id: tenantId, project_id: projectId, lot_number: '01', lot_title: 'Gros œuvre', contact_id: 'secret-contact' },
    { id: `${tenantId}-l2`, tenant_id: tenantId, project_id: otherProjectId, lot_number: '02', lot_title: 'Charpente' },
  ]);
  fakeSupabaseAdmin.seed('tasks', [
    { id: `${tenantId}-t1`, tenant_id: tenantId, project_id: projectId, title: 'Relevé', start_date: '2026-11-01', end_date: '2026-11-05', assignee_id: 'interne-1', created_by: admin.userId },
    { id: `${tenantId}-t2`, tenant_id: tenantId, project_id: otherProjectId, title: 'Tâche privée', start_date: '2026-11-01', end_date: '2026-11-05' },
  ]);
  return { tenantId, admin, projectId, otherProjectId };
}

function newEmail() { seq += 1; return `confrere-${Date.now()}-${seq}@example.test`; }

/** Invite un nouvel e-mail et rend un jeton valable pour le compte créé. */
async function inviteGuest(adminToken: string, projectId: string, grants: any[] = READ_LOTS_AND_TASKS) {
  const email = newEmail();
  const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(adminToken)).send({ email, grants });
  expect(res.status).toBe(201);
  const token = `guest-token-${res.body.userId}`;
  fakeSupabaseAdmin.registerUser(token, { id: res.body.userId, email });
  return { shareId: res.body.id as string, userId: res.body.userId as string, email, token };
}

describe('droits : fonctions pures', () => {
  it('refuse une liste vide, un type inconnu et une écriture non branchée', () => {
    expect('error' in normalizeGrants([])).toBe(true);
    expect('error' in normalizeGrants([{ kind: 'invoices', access: 'read' }])).toBe(true);
    expect('error' in normalizeGrants([{ kind: 'lots', access: 'write' }])).toBe(true);
    expect('error' in normalizeGrants(undefined)).toBe(true);
  });

  it('l\'écriture implique la lecture, jamais l\'inverse, et aucun droit ne vaut refus', () => {
    const grants = (normalizeGrants([...READ_LOTS_AND_TASKS.slice(0, 1), ...WRITE_TASKS]) as any).grants;
    expect(allows(grants, 'tasks', 'write')).toBe(true);
    expect(allows(grants, 'tasks', 'read')).toBe(true);
    expect(allows(grants, 'lots', 'read')).toBe(true);
    expect(allows(grants, 'lots', 'write')).toBe(false);
    expect(allows([], 'tasks', 'read')).toBe(false);
  });

  it('applique les limites par affaire et par cabinet, sans compter deux fois une même personne', () => {
    const row = (project: string, user: string) => ({ id: `${project}-${user}`, tenant_id: 't', project_id: project, user_id: user, email: 'a@b.c', status: 'active' as const, invited_by: null });
    const full = Array.from({ length: SHARE_LIMITS.guestsPerProject }, (_, i) => row('p1', `u${i}`));
    expect(checkShareLimits(full, 'p1', 'nouveau')).toMatchObject({ ok: false, code: 'SHARE_LIMIT_PROJECT' });
    expect(checkShareLimits(full, 'p2', 'u0')).toEqual({ ok: true });
    const many = Array.from({ length: SHARE_LIMITS.guestsPerTenant }, (_, i) => row(`p${i}`, `u${i}`));
    expect(checkShareLimits(many, 'pX', 'nouveau')).toMatchObject({ ok: false, code: 'SHARE_LIMIT_TENANT' });
    expect(checkShareLimits(many, 'pX', 'u3')).toEqual({ ok: true });
  });

  it('ne retient que les champs de tâche autorisés et valide leurs formats', () => {
    const ok = readTaskFields({ title: ' Plans ', start_date: '2026-11-01', end_date: '2026-11-03', tenant_id: 'autre', assignee_id: 'x' }, 'create');
    expect(ok).toEqual({ fields: { title: 'Plans', start_date: '2026-11-01', end_date: '2026-11-03' } });
    expect('error' in readTaskFields({ title: 'x' }, 'create')).toBe(true);
    expect('error' in readTaskFields({ start_date: '01/11/2026' }, 'update')).toBe(true);
    expect('error' in readTaskFields({ progress: 120 }, 'update')).toBe(true);
    expect('error' in readTaskFields({ start_date: '2026-11-05', end_date: '2026-11-01' }, 'update')).toBe(true);
  });
});

describe('invitation côté cabinet', () => {
  it('invite un nouvel e-mail : compte créé, rôle externe, droits enregistrés', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId);
    const membership = fakeSupabaseAdmin.getTable('tenant_memberships').find((m: any) => m.user_id === guest.userId && m.tenant_id === tenantId);
    expect(membership?.system_role).toBe('guest');
    const list = await request(app).get(`/api/projects/${projectId}/shares`).set(authHeader(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.shares).toHaveLength(1);
    expect(list.body.shares[0].grants).toHaveLength(2);
    expect(list.body.usage).toEqual({ project: 1, tenant: 1 });
  });

  it('le confrère n\'est ni de l\'équipe ni compté dans le quota d\'utilisateurs', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId);
    const team = await request(app).get('/api/team').set(authHeader(admin.token));
    expect(team.status).toBe(200);
    expect(team.body.map((m: any) => m.id)).not.toContain(guest.userId);
  });

  it('réserve l\'invitation aux administrateurs et managers', async () => {
    const { tenantId, projectId } = setup();
    const user = makeUser(tenantId, 'user');
    const manager = makeUser(tenantId, 'manager');
    const body = { email: newEmail(), grants: READ_LOTS_AND_TASKS };
    expect((await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(user.token)).send(body)).status).toBe(403);
    expect((await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(manager.token)).send(body)).status).toBe(201);
  });

  it('refuse des droits vides ou invalides, une adresse invalide, une affaire d\'un autre cabinet', async () => {
    const { admin, projectId } = setup();
    const post = (id: string, body: any) => request(app).post(`/api/projects/${id}/shares`).set(authHeader(admin.token)).send(body);
    expect((await post(projectId, { email: newEmail(), grants: [] })).status).toBe(400);
    expect((await post(projectId, { email: newEmail(), grants: [{ kind: 'lots', access: 'write' }] })).status).toBe(400);
    expect((await post(projectId, { email: 'pas-une-adresse', grants: READ_LOTS_AND_TASKS })).status).toBe(400);
    const foreign = setup();
    expect((await post(foreign.projectId, { email: newEmail(), grants: READ_LOTS_AND_TASKS })).status).toBe(404);
  });

  it('refuse un membre du cabinet et un partage déjà actif', async () => {
    const { tenantId, admin, projectId } = setup();
    const colleague = makeUser(tenantId, 'user');
    const colleagueEmail = fakeSupabaseAdmin.getTable('profiles').find((p: any) => p.id === colleague.userId)!.email;
    const post = (email: string) => request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token)).send({ email, grants: READ_LOTS_AND_TASKS });
    expect((await post(colleagueEmail)).body.code).toBe('ALREADY_MEMBER');
    const guest = await inviteGuest(admin.token, projectId);
    expect((await post(guest.email)).body.code).toBe('ALREADY_SHARED');
  });

  it('applique la limite gratuite par affaire sans créer de compte pour l\'invitation refusée', async () => {
    const { admin, projectId } = setup();
    for (let i = 0; i < SHARE_LIMITS.guestsPerProject; i += 1) await inviteGuest(admin.token, projectId);
    const profilesBefore = fakeSupabaseAdmin.getTable('profiles').length;
    const refused = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token)).send({ email: newEmail(), grants: READ_LOTS_AND_TASKS });
    expect(refused.status).toBe(402);
    expect(refused.body.code).toBe('SHARE_LIMIT_PROJECT');
    expect(fakeSupabaseAdmin.getTable('profiles').length).toBe(profilesBefore);
  });

  it('un autre cabinet ne voit, ne modifie ni ne retire les partages', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId);
    const intruder = setup();
    expect((await request(app).get(`/api/projects/${projectId}/shares`).set(authHeader(intruder.admin.token))).status).toBe(404);
    expect((await request(app).put(`/api/projects/${projectId}/shares/${guest.shareId}`).set(authHeader(intruder.admin.token)).send({ grants: WRITE_TASKS })).status).toBe(404);
    expect((await request(app).delete(`/api/projects/${projectId}/shares/${guest.shareId}`).set(authHeader(intruder.admin.token))).status).toBe(404);
  });
});

describe('collaborateur externe : refus par défaut', () => {
  it('ne passe sur aucune route du cabinet (affaires, factures, équipe, IA, contacts)', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [...READ_LOTS_AND_TASKS, ...WRITE_TASKS]);
    for (const path of ['/api/projects', '/api/invoices', '/api/team', '/api/contacts', '/api/tasks', '/api/settings']) {
      const res = await request(app).get(path).set(authHeader(guest.token));
      expect(res.status, path).toBe(403);
      expect(res.body.code, path).toBe('GUEST_FORBIDDEN');
    }
    const ai = await request(app).post('/api/agents/quelconque/chat').set(authHeader(guest.token)).send({ message: 'bonjour' });
    expect(ai.status).toBe(403);
    expect((await request(app).post('/api/projects').set(authHeader(guest.token)).send({ name: 'x' })).status).toBe(403);
  });

  it('garde l\'accès à son profil', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId);
    expect((await request(app).get('/api/me').set(authHeader(guest.token))).status).toBe(200);
  });
});

describe('espace partagé côté invité', () => {
  it('liste les affaires partagées, et elles seules', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId);
    const res = await request(app).get('/api/shared/projects').set(authHeader(guest.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ projectId, projectName: 'Villa Martin', projectCode: '26014' });
  });

  it('ne montre que les lots accordés, sans le contact de l\'entreprise', async () => {
    const { admin, projectId } = setup();
    const withLots = await inviteGuest(admin.token, projectId, READ_LOTS_AND_TASKS);
    const view = await request(app).get(`/api/shared/projects/${projectId}`).set(authHeader(withLots.token));
    expect(view.status).toBe(200);
    expect(view.body.lots).toEqual([expect.objectContaining({ lot_number: '01', lot_title: 'Gros œuvre' })]);
    expect(JSON.stringify(view.body)).not.toContain('secret-contact');

    const tasksOnly = await inviteGuest(admin.token, projectId, [{ kind: 'tasks', access: 'read' }]);
    const noLots = await request(app).get(`/api/shared/projects/${projectId}`).set(authHeader(tasksOnly.token));
    expect(noLots.status).toBe(200);
    expect(noLots.body.lots).toBeUndefined();
  });

  it('une affaire non partagée est introuvable, même dans le même cabinet', async () => {
    const { admin, projectId, otherProjectId } = setup();
    const guest = await inviteGuest(admin.token, projectId);
    expect((await request(app).get(`/api/shared/projects/${otherProjectId}`).set(authHeader(guest.token))).status).toBe(404);
    expect((await request(app).get(`/api/shared/projects/${otherProjectId}/tasks`).set(authHeader(guest.token))).status).toBe(404);
  });

  it('lit les tâches de l\'affaire sans les champs internes', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId);
    const res = await request(app).get(`/api/shared/projects/${projectId}/tasks`).set(authHeader(guest.token));
    expect(res.status).toBe(200);
    expect(res.body.map((t: any) => t.id)).toEqual([`${tenantId}-t1`]);
    expect(res.body[0]).not.toHaveProperty('assignee_id');
    expect(res.body[0]).not.toHaveProperty('created_by');
  });

  it('refuse les tâches si le droit n\'est pas accordé', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'lots', access: 'read' }]);
    const res = await request(app).get(`/api/shared/projects/${projectId}/tasks`).set(authHeader(guest.token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SHARE_FORBIDDEN');
  });
});

describe('écriture des tâches par un confrère', () => {
  const body = { title: 'Relevé complémentaire', start_date: '2026-11-10', end_date: '2026-11-12' };

  it('lecture seule : création et modification refusées', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, READ_LOTS_AND_TASKS);
    expect((await request(app).post(`/api/shared/projects/${projectId}/tasks`).set(authHeader(guest.token)).send(body)).status).toBe(403);
    expect((await request(app).put(`/api/shared/projects/${projectId}/tasks/${tenantId}-t1`).set(authHeader(guest.token)).send({ progress: 50 })).status).toBe(403);
  });

  it('droit d\'écriture : crée dans l\'affaire et au nom du cabinet, ignore tenant_id et project_id du corps', async () => {
    const { tenantId, admin, projectId, otherProjectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, WRITE_TASKS);
    const res = await request(app).post(`/api/shared/projects/${projectId}/tasks`).set(authHeader(guest.token))
      .send({ ...body, tenant_id: 'autre-cabinet', project_id: otherProjectId });
    expect(res.status).toBe(201);
    const row = fakeSupabaseAdmin.getTable('tasks').find((t: any) => t.id === res.body.id)!;
    expect(row.tenant_id).toBe(tenantId);
    expect(row.project_id).toBe(projectId);
    expect(row.created_by).toBe(guest.userId);
  });

  it('modifie une tâche de l\'affaire, jamais celle d\'une autre affaire du cabinet', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, WRITE_TASKS);
    const ok = await request(app).put(`/api/shared/projects/${projectId}/tasks/${tenantId}-t1`).set(authHeader(guest.token)).send({ progress: 40, status: 'in_progress' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ progress: 40, status: 'in_progress' });
    const other = await request(app).put(`/api/shared/projects/${projectId}/tasks/${tenantId}-t2`).set(authHeader(guest.token)).send({ progress: 99 });
    expect(other.status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('tasks').find((t: any) => t.id === `${tenantId}-t2`)!.progress).not.toBe(99);
  });

  it('refuse l\'écriture sur une affaire archivée', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, WRITE_TASKS);
    fakeSupabaseAdmin.getTable('projects').find((p: any) => p.id === projectId)!.archived_at = '2026-10-31T00:00:00Z';
    const res = await request(app).put(`/api/shared/projects/${projectId}/tasks/${tenantId}-t1`).set(authHeader(guest.token)).send({ progress: 10 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
  });

  it('trace l\'écriture dans le journal d\'activité du cabinet', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, WRITE_TASKS);
    await request(app).post(`/api/shared/projects/${projectId}/tasks`).set(authHeader(guest.token)).send(body);
    await new Promise(r => setTimeout(r, 30));
    const logged = fakeSupabaseAdmin.getTable('activities').filter((a: any) => a.tenant_id === tenantId && a.user_id === guest.userId);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged[0].action).toContain('confrère externe');
  });
});

describe('modification des droits et retrait', () => {
  it('modifier les droits agit immédiatement', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, READ_LOTS_AND_TASKS);
    expect((await request(app).get(`/api/shared/projects/${projectId}/tasks`).set(authHeader(guest.token))).status).toBe(200);
    const put = await request(app).put(`/api/projects/${projectId}/shares/${guest.shareId}`).set(authHeader(admin.token)).send({ grants: [{ kind: 'lots', access: 'read' }] });
    expect(put.status).toBe(200);
    expect((await request(app).get(`/api/shared/projects/${projectId}/tasks`).set(authHeader(guest.token))).status).toBe(403);
  });

  it('retirer le partage ferme l\'accès et supprime l\'adhésion externe devenue inutile', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, WRITE_TASKS);
    const del = await request(app).delete(`/api/projects/${projectId}/shares/${guest.shareId}`).set(authHeader(admin.token));
    expect(del.status).toBe(200);
    expect((await request(app).get(`/api/shared/projects/${projectId}`).set(authHeader(guest.token))).status).toBe(404);
    expect((await request(app).get('/api/shared/projects').set(authHeader(guest.token))).body).toEqual([]);
    expect(fakeSupabaseAdmin.getTable('tenant_memberships').some((m: any) => m.user_id === guest.userId && m.tenant_id === tenantId)).toBe(false);
    const after = await request(app).get(`/api/projects/${projectId}/shares`).set(authHeader(admin.token));
    expect(after.body.shares).toHaveLength(0);
  });

  it('réinviter une personne retirée rétablit son accès avec les nouveaux droits', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, WRITE_TASKS);
    await request(app).delete(`/api/projects/${projectId}/shares/${guest.shareId}`).set(authHeader(admin.token));
    const again = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token)).send({ email: guest.email, grants: [{ kind: 'lots', access: 'read' }] });
    expect(again.status).toBe(201);
    const view = await request(app).get(`/api/shared/projects/${projectId}`).set(authHeader(guest.token));
    expect(view.status).toBe(200);
    expect(view.body.grants).toEqual([{ kind: 'lots', access: 'read' }]);
  });
});

describe('confrère qui a déjà son propre cabinet', () => {
  it('reste dans son cabinet : aucune adhésion externe, accès à l\'espace partagé avec son propre jeton', async () => {
    const { tenantId, admin, projectId } = setup();
    const ownTenant = makeTenant();
    const architect = makeUser(ownTenant, 'admin');
    const email = fakeSupabaseAdmin.getTable('profiles').find((p: any) => p.id === architect.userId)!.email;
    const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token)).send({ email, grants: WRITE_TASKS });
    expect(res.status).toBe(201);
    expect(fakeSupabaseAdmin.getTable('tenant_memberships').some((m: any) => m.user_id === architect.userId && m.tenant_id === tenantId)).toBe(false);

    const shared = await request(app).get('/api/shared/projects').set(authHeader(architect.token));
    expect(shared.body.map((p: any) => p.projectId)).toEqual([projectId]);
    // Son propre cabinet n'est pas touché : toujours administrateur chez lui.
    expect((await request(app).get('/api/projects').set(authHeader(architect.token))).status).toBe(200);
    // Et ses routes ordinaires ne lui montrent pas l'affaire de l'autre cabinet.
    const own = await request(app).get('/api/projects').set(authHeader(architect.token));
    expect(JSON.stringify(own.body)).not.toContain(projectId);
  });
});

describe('documents partagés', () => {
  const READ_DOCS = [{ kind: 'documents', access: 'read' }];
  const publicUrl = (path: string) => `https://fake.supabase.test/storage/v1/object/public/documents/${path}`;

  function seedDocuments() {
    const base = setup();
    const { tenantId, projectId, otherProjectId } = base;
    const own = `${tenantId}/${projectId}/plan.pdf`;
    const foreign = `${makeTenant()}/volé.pdf`;
    fakeSupabaseAdmin.putObject('documents', own, 'contenu');
    fakeSupabaseAdmin.putObject('documents', foreign, 'autre cabinet');
    fakeSupabaseAdmin.seed('documents', [
      { id: `${tenantId}-d1`, tenant_id: tenantId, project_id: projectId, resource_type: 'projects', name: 'Plan RDC', category: 'Plans', phase: 'APS', version: 2, uploaded_at: '2026-10-20', description: 'Indice B', uploaded_by: 'interne-1', contact_id: 'secret-contact', file_url: publicUrl(own) },
      { id: `${tenantId}-d2`, tenant_id: tenantId, project_id: projectId, resource_type: 'proposals', name: 'Devis client', category: 'Devis', uploaded_at: '2026-10-21', file_url: publicUrl(own) },
      { id: `${tenantId}-d3`, tenant_id: tenantId, project_id: otherProjectId, resource_type: 'projects', name: 'Autre affaire', category: 'Plans', uploaded_at: '2026-10-22', file_url: publicUrl(own) },
      { id: `${tenantId}-d4`, tenant_id: tenantId, project_id: projectId, resource_type: 'projects', name: 'Chemin étranger', category: 'Plans', uploaded_at: '2026-10-23', file_url: publicUrl(foreign) },
    ]);
    return base;
  }

  it('liste les documents de l\'affaire, sans référence de stockage ni donnée interne', async () => {
    const { tenantId, admin, projectId } = seedDocuments();
    const guest = await inviteGuest(admin.token, projectId, READ_DOCS);
    const res = await request(app).get(`/api/shared/projects/${projectId}/documents`).set(authHeader(guest.token));
    expect(res.status).toBe(200);
    // Ni le devis (autre type de rattachement), ni le document d'une autre affaire.
    expect(res.body.map((d: any) => d.id).sort()).toEqual([`${tenantId}-d1`, `${tenantId}-d4`]);
    const doc = res.body.find((d: any) => d.id === `${tenantId}-d1`);
    expect(doc).toMatchObject({ name: 'Plan RDC', category: 'Plans', phase: 'APS', version: 2 });
    const raw = JSON.stringify(res.body);
    for (const secret of ['file_url', 'uploaded_by', 'secret-contact', 'contact_id', '/storage/v1/']) expect(raw).not.toContain(secret);
  });

  it('refuse la liste et le téléchargement sans le droit « documents »', async () => {
    const { tenantId, admin, projectId } = seedDocuments();
    const guest = await inviteGuest(admin.token, projectId, READ_LOTS_AND_TASKS);
    expect((await request(app).get(`/api/shared/projects/${projectId}/documents`).set(authHeader(guest.token))).status).toBe(403);
    expect((await request(app).get(`/api/shared/projects/${projectId}/documents/${tenantId}-d1/download`).set(authHeader(guest.token))).status).toBe(403);
  });

  it('donne un lien signé pour un document de l\'affaire et le trace dans le journal d\'activité', async () => {
    const { tenantId, admin, projectId } = seedDocuments();
    const guest = await inviteGuest(admin.token, projectId, READ_DOCS);
    const res = await request(app).get(`/api/shared/projects/${projectId}/documents/${tenantId}-d1/download`).set(authHeader(guest.token));
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/object/sign/documents/');
    await new Promise(r => setTimeout(r, 30));
    const logged = fakeSupabaseAdmin.getTable('activities').filter((a: any) => a.tenant_id === tenantId && a.user_id === guest.userId);
    expect(logged.some((a: any) => String(a.action).includes('Téléchargement') && String(a.action).includes('confrère externe'))).toBe(true);
  });

  it('un document d\'une autre affaire ou d\'un autre type de rattachement est introuvable', async () => {
    const { tenantId, admin, projectId } = seedDocuments();
    const guest = await inviteGuest(admin.token, projectId, READ_DOCS);
    const get = (docId: string) => request(app).get(`/api/shared/projects/${projectId}/documents/${docId}/download`).set(authHeader(guest.token));
    expect((await get(`${tenantId}-d2`)).status).toBe(404);
    expect((await get(`${tenantId}-d3`)).status).toBe(404);
    expect((await get('inexistant')).status).toBe(404);
  });

  it('refuse un fichier dont le chemin appartient à un autre cabinet', async () => {
    const { tenantId, admin, projectId } = seedDocuments();
    const guest = await inviteGuest(admin.token, projectId, READ_DOCS);
    const res = await request(app).get(`/api/shared/projects/${projectId}/documents/${tenantId}-d4/download`).set(authHeader(guest.token));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('fake-token');
  });

  it('sert un fichier de l\'espace de stockage du cabinet par ticket, et refuse une connexion d\'un autre cabinet', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, READ_DOCS);
    const mine = connectExternalStorage(tenantId);
    const theirs = connectExternalStorage(makeTenant());
    const ref = (connectionId: string) => buildExternalRef({ provider: 'webdav', connectionId, externalId: '/ArchiOffice/plan.pdf', fileName: 'plan.pdf' });
    fakeSupabaseAdmin.seed('documents', [
      { id: `${tenantId}-e1`, tenant_id: tenantId, project_id: projectId, resource_type: 'projects', name: 'Plan externe', category: 'Plans', uploaded_at: '2026-10-24', file_url: ref(mine) },
      { id: `${tenantId}-e2`, tenant_id: tenantId, project_id: projectId, resource_type: 'projects', name: 'Connexion étrangère', category: 'Plans', uploaded_at: '2026-10-25', file_url: ref(theirs) },
    ]);
    const get = (docId: string) => request(app).get(`/api/shared/projects/${projectId}/documents/${docId}/download`).set(authHeader(guest.token));
    const ok = await get(`${tenantId}-e1`);
    expect(ok.status).toBe(200);
    expect(ok.body.url).toContain('/api/storage/external/');
    expect((await get(`${tenantId}-e2`)).status).toBe(403);
  });

  it('un invité sans le droit ne peut pas inscrire « documents » en écriture', async () => {
    const { admin, projectId } = setup();
    const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token))
      .send({ email: newEmail(), grants: [{ kind: 'documents', access: 'write' }] });
    expect(res.status).toBe(400);
  });
});
