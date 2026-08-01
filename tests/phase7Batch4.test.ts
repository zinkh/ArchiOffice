// Phase 7 batch 4: end-to-end Supertest coverage for the domains extracted
// into server/routes/{documentTemplates,contratsMoe,notesHonoraires,
// profile}.ts — confirms the extraction didn't change behavior and that
// tenantScopedFrom() still enforces tenant isolation through the real app.
//
// CV upload (POST /api/profile/cv) is not exercised here for the same reason
// as the meeting photo upload route in phase7Batch3.test.ts: it needs
// FakeSupabaseAdmin's storage.from()/upload()/getPublicUrl(), which this
// suite doesn't implement. DELETE /api/profile/cv is still covered, since
// with no cv_url set it never touches storage.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Document Templates', () => {
  it('auto-seeds starter templates on first fetch, one default per category', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const listed = await request(app).get('/api/document_templates').set(authHeader(token));
    expect(listed.status).toBe(200);
    expect(listed.body.length).toBeGreaterThan(0);
    expect(listed.body.every((t: any) => t.tenant_id === tenantId)).toBe(true);
    expect(listed.body.every((t: any) => t.editable === false)).toBe(true);

    // Fetching again must not re-seed (count check short-circuits).
    const listedAgain = await request(app).get('/api/document_templates').set(authHeader(token));
    expect(listedAgain.body.length).toBe(listed.body.length);
  });

  it('creates, duplicates, updates, sets default, generates, and deletes a custom template', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/document_templates').set(authHeader(token)).send({ name: 'Lettre type', category: 'Courrier', content: 'Bonjour {{client}},' });
    expect(created.status).toBe(201);
    const templateId = created.body.id;

    const dup = await request(app).post(`/api/document_templates/${templateId}/duplicate`).set(authHeader(token));
    expect(dup.status).toBe(201);
    expect(fakeSupabaseAdmin.getTable('document_templates').find(t => t.id === dup.body.id)?.name).toBe('Lettre type (copie)');

    const updated = await request(app).put(`/api/document_templates/${templateId}`).set(authHeader(token)).send({ name: 'Lettre type révisée', category: 'Courrier', content: 'Bonjour {{client}}, révisé', variables: [] });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('document_templates').find(t => t.id === templateId)?.name).toBe('Lettre type révisée');

    const defaulted = await request(app).post(`/api/document_templates/${templateId}/set-default`).set(authHeader(token));
    expect(defaulted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('document_templates').find(t => t.id === templateId)?.is_default).toBe(true);

    const generated = await request(app).post(`/api/document_templates/${templateId}/generate`).set(authHeader(token)).send({ variable_values: { client: 'M. Dupont' } });
    expect(generated.status).toBe(200);
    expect(generated.body.filled_content).toBe('Bonjour M. Dupont, révisé');

    const deleted = await request(app).delete(`/api/document_templates/${templateId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('document_templates').find(t => t.id === templateId)).toBeUndefined();
  });

  it('refuses to edit or delete a non-editable seeded template', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const seededId = 'tpl-seeded';
    fakeSupabaseAdmin.seed('document_templates', [{ id: seededId, tenant_id: tenantId, name: 'CCTP standard', category: 'CCTP', content: 'x', editable: false, is_seeded: true }]);

    const updated = await request(app).put(`/api/document_templates/${seededId}`).set(authHeader(token)).send({ name: 'Hacked' });
    expect(updated.status).toBe(403);

    const deleted = await request(app).delete(`/api/document_templates/${seededId}`).set(authHeader(token));
    expect(deleted.status).toBe(403);
    expect(fakeSupabaseAdmin.getTable('document_templates').find(t => t.id === seededId)).toBeDefined();
  });

  it('never lets a caller edit another tenant\'s template', async () => {
    const tenantB = makeTenant();
    const templateId = 'tpl-b';
    fakeSupabaseAdmin.seed('document_templates', [{ id: templateId, tenant_id: tenantB, name: 'SECRET-TPL-B', category: 'Autre', content: 'x', editable: true }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).put(`/api/document_templates/${templateId}`).set(authHeader(token)).send({ name: 'Hacked' });
    expect(res.status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('document_templates').find(t => t.id === templateId)?.name).toBe('SECRET-TPL-B');
  });
});

describe('Contrats MOE', () => {
  it('creates, updates, and deletes a contrat MOE within one tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/contrats_moe').set(authHeader(token)).send({ project_id: 'p1', montant_honoraires: 15000 });
    expect(created.status).toBe(201);
    expect(created.body.tenant_id).toBe(tenantId);
    const id = created.body.id;

    const updated = await request(app).put(`/api/contrats_moe/${id}`).set(authHeader(token)).send({ montant_honoraires: 18000 });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('contrats_moe').find(c => c.id === id)?.montant_honoraires).toBe(18000);

    const deleted = await request(app).delete(`/api/contrats_moe/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('contrats_moe').find(c => c.id === id)).toBeUndefined();
  });

  it('never lets a caller update or delete another tenant\'s contrat MOE', async () => {
    const tenantB = makeTenant();
    const id = 'contrat-b';
    fakeSupabaseAdmin.seed('contrats_moe', [{ id, tenant_id: tenantB, montant_honoraires: 'SECRET' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put(`/api/contrats_moe/${id}`).set(authHeader(token)).send({ montant_honoraires: 1 });
    expect(fakeSupabaseAdmin.getTable('contrats_moe').find(c => c.id === id)?.montant_honoraires).toBe('SECRET');

    await request(app).delete(`/api/contrats_moe/${id}`).set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('contrats_moe').find(c => c.id === id)).toBeDefined();
  });
});

describe('Notes d\'honoraires', () => {
  it('creates a note with an auto-generated numero, lists, updates, and deletes it', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/notes_honoraires').set(authHeader(token)).send({ project_id: 'p1', montant: 5000 });
    expect(created.status).toBe(201);
    expect(created.body.tenant_id).toBe(tenantId);
    expect(created.body.numero).toMatch(/^NH-\d{4}-001$/);
    const id = created.body.id;

    const listed = await request(app).get('/api/notes_honoraires').query({ project_id: 'p1' }).set(authHeader(token));
    expect(listed.body.some((n: any) => n.id === id)).toBe(true);

    const updated = await request(app).put(`/api/notes_honoraires/${id}`).set(authHeader(token)).send({ montant: 6000 });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('notes_honoraires').find(n => n.id === id)?.montant).toBe(6000);

    const deleted = await request(app).delete(`/api/notes_honoraires/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('notes_honoraires').find(n => n.id === id)).toBeUndefined();
  });

  it('never lists or updates another tenant\'s note honoraires', async () => {
    const tenantB = makeTenant();
    const id = 'note-b';
    fakeSupabaseAdmin.seed('notes_honoraires', [{ id, tenant_id: tenantB, project_id: 'project-b', montant: 'SECRET' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const listed = await request(app).get('/api/notes_honoraires').set(authHeader(token));
    expect(listed.body.some((n: any) => n.id === id)).toBe(false);

    await request(app).put(`/api/notes_honoraires/${id}`).set(authHeader(token)).send({ montant: 1 });
    expect(fakeSupabaseAdmin.getTable('notes_honoraires').find(n => n.id === id)?.montant).toBe('SECRET');
  });
});

describe('Profile', () => {
  it('fetches own profile with education, experience, and current projects', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('profile_education', [{ id: 'edu-1', tenant_id: tenantId, user_id: userId, school: 'ENSA', sort_order: 1 }]);
    fakeSupabaseAdmin.seed('profile_experience', [{ id: 'exp-1', tenant_id: tenantId, user_id: userId, title: 'Architecte', sort_order: 1 }]);

    const res = await request(app).get(`/api/profile/${userId}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.is_self).toBe(true);
    expect(res.body.education).toHaveLength(1);
    expect(res.body.experience).toHaveLength(1);
  });

  it('updates own profile bio/job_title/department', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);

    const res = await request(app).put('/api/profile').set(authHeader(token)).send({ bio: 'Architecte DPLG', job_title: 'Associé', department: 'Direction' });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === userId)?.bio).toBe('Architecte DPLG');
  });

  it('adds, updates, and deletes an education entry, scoped to the caller', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/profile/education').set(authHeader(token)).send({ school: 'ENSA Paris', degree: 'DE', field: 'Architecture', start_year: 2010, end_year: 2015 });
    expect(created.status).toBe(201);
    const eduId = created.body.id;

    const updated = await request(app).put(`/api/profile/education/${eduId}`).set(authHeader(token)).send({ school: 'ENSA Paris-Malaquais', degree: 'DE', field: 'Architecture', start_year: 2010, end_year: 2015 });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('profile_education').find(e => e.id === eduId)?.school).toBe('ENSA Paris-Malaquais');

    const deleted = await request(app).delete(`/api/profile/education/${eduId}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('profile_education').find(e => e.id === eduId)).toBeUndefined();
  });

  it('never lets a caller delete another user\'s education entry, even within the same tenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const { userId: victimId } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('profile_education', [{ id: 'edu-victim', tenant_id: tenantId, user_id: victimId, school: 'SECRET' }]);

    await request(app).delete('/api/profile/education/edu-victim').set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('profile_education').find(e => e.id === 'edu-victim')).toBeDefined();
  });

  it('removes a CV reference without a stored file (no storage call needed)', async () => {
    const tenantId = makeTenant();
    const { userId, token } = makeUser(tenantId);

    const res = await request(app).delete('/api/profile/cv').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === userId)?.cv_url).toBeNull();
  });
});
