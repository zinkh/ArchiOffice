// Phase 7 batch 10: end-to-end Supertest coverage for the domains extracted
// into server/routes/{specifications,contacts}.ts — confirms the
// extraction didn't change behavior and that tenantScopedFrom() still
// enforces tenant isolation through the real app.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Specifications (CCTP)', () => {
  it('creates, lists, updates, and deletes a specification', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);

    const created = await request(app).post('/api/specifications').set(authHeader(token)).send({ project_id: 'p1', title: 'CCTP Lot Gros Œuvre', content: '[]' });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(fakeSupabaseAdmin.getTable('specifications').find(s => s.id === id)?.tenant_id).toBe(tenantId);

    const listed = await request(app).get('/api/specifications').set(authHeader(token));
    expect(listed.body.some((s: any) => s.id === id)).toBe(true);

    const updated = await request(app).put(`/api/specifications/${id}`).set(authHeader(token)).send({ title: 'CCTP Lot Gros Œuvre (révisé)', content: '[]', is_template: true });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('specifications').find(s => s.id === id)?.title).toBe('CCTP Lot Gros Œuvre (révisé)');

    const deleted = await request(app).delete(`/api/specifications/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('specifications').find(s => s.id === id)).toBeUndefined();
  });

  it('refuse un CCTP sans projet', async () => {
    // Un CCTP sans project_id n'apparaît nulle part dans l'application (la
    // seule vue qui les affiche filtre par projet) — voir server/routes/specifications.ts.
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).post('/api/specifications').set(authHeader(token)).send({ title: 'CCTP orphelin', content: '[]' });
    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('specifications').some(s => s.title === 'CCTP orphelin')).toBe(false);
  });

  it('never lets a caller update or delete another tenant\'s specification', async () => {
    const tenantB = makeTenant();
    const specId = 'spec-b';
    fakeSupabaseAdmin.seed('specifications', [{ id: specId, tenant_id: tenantB, title: 'SECRET-CCTP-B', content: '[]' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    await request(app).put(`/api/specifications/${specId}`).set(authHeader(token)).send({ title: 'Hacked', content: '[]' });
    expect(fakeSupabaseAdmin.getTable('specifications').find(s => s.id === specId)?.title).toBe('SECRET-CCTP-B');

    await request(app).delete(`/api/specifications/${specId}`).set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('specifications').find(s => s.id === specId)).toBeDefined();
  });
});

describe('Contacts', () => {
  it('creates, lists (with computed name), updates, and deletes a contact', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/contacts').set(authHeader(token)).send({ first_name: 'Jean', last_name: 'Dupont', email: 'jean@example.test' });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === id)?.tenant_id).toBe(tenantId);

    const listed = await request(app).get('/api/contacts').set(authHeader(token));
    const found = listed.body.find((c: any) => c.id === id);
    expect(found.name).toBe('Jean Dupont');

    const updated = await request(app).put(`/api/contacts/${id}`).set(authHeader(token)).send({ first_name: 'Jean', last_name: 'Martin' });
    expect(updated.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === id)?.last_name).toBe('Martin');

    const deleted = await request(app).delete(`/api/contacts/${id}`).set(authHeader(token));
    expect(deleted.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === id)).toBeUndefined();
  });

  it('never lists or updates another tenant\'s contact', async () => {
    const tenantB = makeTenant();
    const contactId = 'contact-b';
    fakeSupabaseAdmin.seed('contacts', [{ id: contactId, tenant_id: tenantB, first_name: 'Secret', last_name: 'B' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const listed = await request(app).get('/api/contacts').set(authHeader(token));
    expect(listed.body.some((c: any) => c.id === contactId)).toBe(false);

    await request(app).put(`/api/contacts/${contactId}`).set(authHeader(token)).send({ first_name: 'Hacked' });
    expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === contactId)?.first_name).toBe('Secret');
  });

  // contacts.is_personal (migrate_contacts_is_personal.sql) + owner_user_id /
  // profiles.show_personal_contacts (migrate_contacts_personal_visibility.sql):
  // a "pro" contact stays shared tenant-wide, a personal one is visible only
  // to its owner — see CLAUDE.md.
  describe('Personal contacts visibility', () => {
    it('a personal contact is owned by its creator and invisible to a colleague in the same tenant', async () => {
      const tenantId = makeTenant();
      const { token: tokenA } = makeUser(tenantId);
      const { token: tokenB } = makeUser(tenantId);

      const created = await request(app).post('/api/contacts').set(authHeader(tokenA)).send({ first_name: 'Tante', last_name: 'Josephine', is_personal: true });
      expect(created.status).toBe(201);
      expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === created.body.id)?.owner_user_id).toBeTruthy();

      const listedByOwner = await request(app).get('/api/contacts').set(authHeader(tokenA));
      expect(listedByOwner.body.some((c: any) => c.id === created.body.id)).toBe(true);

      const listedByColleague = await request(app).get('/api/contacts').set(authHeader(tokenB));
      expect(listedByColleague.body.some((c: any) => c.id === created.body.id)).toBe(false);
    });

    it('a pro contact stays visible to every user in the tenant', async () => {
      const tenantId = makeTenant();
      const { token: tokenA } = makeUser(tenantId);
      const { token: tokenB } = makeUser(tenantId);

      const created = await request(app).post('/api/contacts').set(authHeader(tokenA)).send({ first_name: 'Marché', last_name: 'Public', is_personal: false });
      expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === created.body.id)?.owner_user_id).toBeFalsy();

      const listedByColleague = await request(app).get('/api/contacts').set(authHeader(tokenB));
      expect(listedByColleague.body.some((c: any) => c.id === created.body.id)).toBe(true);
    });

    it('a colleague cannot update or delete another user\'s personal contact even by guessing its id', async () => {
      const tenantId = makeTenant();
      const { userId: ownerId, token: ownerToken } = makeUser(tenantId);
      const { token: colleagueToken } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-personal-1', tenant_id: tenantId, first_name: 'Papy', last_name: 'Michel', is_personal: true, owner_user_id: ownerId }]);

      const updated = await request(app).put('/api/contacts/contact-personal-1').set(authHeader(colleagueToken)).send({ first_name: 'Hacked' });
      expect(updated.status).toBe(403);
      expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'contact-personal-1')?.first_name).toBe('Papy');

      const deleted = await request(app).delete('/api/contacts/contact-personal-1').set(authHeader(colleagueToken));
      expect(deleted.status).toBe(403);
      expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'contact-personal-1')).toBeDefined();

      // The owner can still edit their own.
      const ownerUpdate = await request(app).put('/api/contacts/contact-personal-1').set(authHeader(ownerToken)).send({ first_name: 'Michel' });
      expect(ownerUpdate.status).toBe(200);
    });

    it('a legacy personal contact with no owner_user_id is claimed by whoever edits it first', async () => {
      const tenantId = makeTenant();
      const { userId, token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-legacy', tenant_id: tenantId, first_name: 'Ancien', last_name: 'Contact', is_personal: true, owner_user_id: null }]);

      const updated = await request(app).put('/api/contacts/contact-legacy').set(authHeader(token)).send({ last_name: 'Contact2' });
      expect(updated.status).toBe(200);
      expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'contact-legacy')?.owner_user_id).toBe(userId);
    });

    it('unsets owner_user_id when a contact is switched from personal back to pro', async () => {
      const tenantId = makeTenant();
      const { userId, token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-switch', tenant_id: tenantId, first_name: 'Basculé', last_name: 'Contact', is_personal: true, owner_user_id: userId }]);

      const updated = await request(app).put('/api/contacts/contact-switch').set(authHeader(token)).send({ is_personal: false });
      expect(updated.status).toBe(200);
      expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === 'contact-switch')?.owner_user_id).toBeNull();
    });

    it('never lets a client-supplied owner_user_id override server-side ownership on create', async () => {
      const tenantId = makeTenant();
      const { userId, token } = makeUser(tenantId);
      const otherTenant = makeTenant();
      const { userId: otherUserId } = makeUser(otherTenant);

      const created = await request(app).post('/api/contacts').set(authHeader(token)).send({ first_name: 'X', last_name: 'Y', is_personal: true, owner_user_id: otherUserId });
      expect(fakeSupabaseAdmin.getTable('contacts').find(c => c.id === created.body.id)?.owner_user_id).toBe(userId);
    });

    it('respects profiles.show_personal_contacts: hides the caller\'s own personal contacts when turned off', async () => {
      const tenantId = makeTenant();
      const { userId, token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-own-personal', tenant_id: tenantId, first_name: 'Moi', last_name: 'Perso', is_personal: true, owner_user_id: userId }]);
      fakeSupabaseAdmin.seed('contacts', [{ id: 'contact-pro-visible', tenant_id: tenantId, first_name: 'Toujours', last_name: 'Visible', is_personal: false }]);

      const beforeToggle = await request(app).get('/api/contacts').set(authHeader(token));
      expect(beforeToggle.body.some((c: any) => c.id === 'contact-own-personal')).toBe(true);

      await request(app).put(`/api/team/${userId}`).set(authHeader(token)).send({ showPersonalContacts: false });
      expect(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === userId)?.show_personal_contacts).toBe(false);

      const afterToggle = await request(app).get('/api/contacts').set(authHeader(token));
      expect(afterToggle.body.some((c: any) => c.id === 'contact-own-personal')).toBe(false);
      // Pro contacts are unaffected by the toggle.
      expect(afterToggle.body.some((c: any) => c.id === 'contact-pro-visible')).toBe(true);
    });

    it('GET /api/me reports showPersonalContacts', async () => {
      const tenantId = makeTenant();
      const { userId, token } = makeUser(tenantId);
      await request(app).put(`/api/team/${userId}`).set(authHeader(token)).send({ showPersonalContacts: false });

      const res = await request(app).get('/api/me').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.showPersonalContacts).toBe(false);
    });
  });

  it('lists contact categories scoped to the caller\'s tenant', async () => {
    const tenantA = makeTenant();
    fakeSupabaseAdmin.seed('contact_categories', [{ id: 'cat-a', tenant_id: tenantA, name: 'Fournisseurs' }]);
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('contact_categories', [{ id: 'cat-b', tenant_id: tenantB, name: 'SECRET-CAT-B' }]);
    const { token } = makeUser(tenantA);

    const res = await request(app).get('/api/contact-categories').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.some((c: any) => c.id === 'cat-a')).toBe(true);
    expect(res.body.some((c: any) => c.id === 'cat-b')).toBe(false);
  });
});
