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
