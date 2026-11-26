// Gestion des utilisateurs : révocation d'accès et réinitialisation du mot de passe
// (server/routes/team.ts). Données synthétiques ; l'API d'administration d'Auth est simulée.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, addMembership, authHeader } from './testServer';

let app: Express;
const updateUserById = vi.fn(async (_id: string, _attrs: Record<string, unknown>) => ({ data: {}, error: null }));

beforeAll(async () => {
  app = await getTestApp();
});

beforeEach(() => {
  updateUserById.mockClear();
  (fakeSupabaseAdmin.auth.admin as any).updateUserById = updateUserById;
});

const membershipsOf = (userId: string) => fakeSupabaseAdmin.getTable('tenant_memberships').filter(m => m.user_id === userId);

describe('POST /api/team/:id/revoke', () => {
  it('détache le membre du cabinet et bloque son compte s\'il n\'exerce nulle part ailleurs', async () => {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    const membre = makeUser(tenantId, 'user');

    const res = await request(app).post(`/api/team/${membre.userId}/revoke`).set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, accountBlocked: true });
    expect(membershipsOf(membre.userId)).toHaveLength(0);
    expect(updateUserById).toHaveBeenCalledWith(membre.userId, expect.objectContaining({ ban_duration: expect.any(String) }));
    // Le profil est conservé : l'historique du membre ne disparaît pas.
    expect(fakeSupabaseAdmin.getTable('profiles').some(p => p.id === membre.userId)).toBe(true);
  });

  it('ne bloque pas le compte d\'une personne qui exerce aussi dans un autre cabinet', async () => {
    const tenantId = makeTenant();
    const autre = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    const membre = makeUser(tenantId, 'user');
    addMembership(membre.userId, autre, 'manager');

    const res = await request(app).post(`/api/team/${membre.userId}/revoke`).set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.accountBlocked).toBe(false);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(membershipsOf(membre.userId).map(m => m.tenant_id)).toEqual([autre]);
  });

  it('refuse de révoquer son propre accès', async () => {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    const soi = await request(app).post(`/api/team/${admin.userId}/revoke`).set(authHeader(admin.token));
    expect(soi.status).toBe(400);
    expect(membershipsOf(admin.userId)).toHaveLength(1);
  });

  it('est réservé aux administrateurs et refuse un membre d\'un autre cabinet', async () => {
    const tenantId = makeTenant();
    const ailleurs = makeUser(makeTenant(), 'user');
    const user = makeUser(tenantId, 'user');
    const admin = makeUser(tenantId, 'admin');

    expect((await request(app).post(`/api/team/${ailleurs.userId}/revoke`).set(authHeader(user.token))).status).toBe(403);
    const res = await request(app).post(`/api/team/${ailleurs.userId}/revoke`).set(authHeader(admin.token));
    expect(res.status).toBe(404);
    expect(membershipsOf(ailleurs.userId)).toHaveLength(1);
  });
});

describe('POST /api/team/:id/reset-password', () => {
  it('génère un lien de récupération pour un membre du cabinet, sans jamais le renvoyer', async () => {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    const membre = makeUser(tenantId, 'user');
    const spy = vi.spyOn(fakeSupabaseAdmin.auth.admin, 'generateLink');

    const res = await request(app).post(`/api/team/${membre.userId}/reset-password`).set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('fake.supabase.test');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'recovery' }));
    spy.mockRestore();
  });

  it('refuse un non-administrateur et un membre d\'un autre cabinet', async () => {
    const tenantId = makeTenant();
    const user = makeUser(tenantId, 'user');
    const admin = makeUser(tenantId, 'admin');
    const ailleurs = makeUser(makeTenant(), 'user');

    expect((await request(app).post(`/api/team/${user.userId}/reset-password`).set(authHeader(user.token))).status).toBe(403);
    expect((await request(app).post(`/api/team/${ailleurs.userId}/reset-password`).set(authHeader(admin.token))).status).toBe(404);
  });
});
