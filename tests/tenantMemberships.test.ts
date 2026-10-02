// Multi-cabinets : un même architecte exerçant dans deux structures.
//
// Le cœur du sujet n'est pas l'écran de bascule mais ce qu'il déclenche :
// chaque requête doit être servie par le cabinet DÉSIGNÉ (en-tête
// X-Tenant-Id), avec les droits tenus DANS ce cabinet, et jamais par le
// cabinet par défaut du profil. Ces tests verrouillent ce contrat, ainsi que
// le repli des instances qui n'ont pas encore joué
// supabase/migrate_tenant_memberships.sql (un profil sans ligne d'adhésion).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, addMembership, tenantHeader,
} from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Cabinets multiples — liste et bascule', () => {
  it('liste les deux cabinets et désigne celui qui sert la requête', async () => {
    const cabinetA = makeTenant({ name: 'Atelier A' });
    const cabinetB = makeTenant({ name: 'Atelier B' });
    const { userId, token } = makeUser(cabinetA, 'admin');
    addMembership(userId, cabinetB, 'user');

    const parDefaut = await request(app).get('/api/tenants/mine').set(authHeader(token));
    expect(parDefaut.status).toBe(200);
    expect(parDefaut.body.activeTenantId).toBe(cabinetA);
    expect(parDefaut.body.tenants.map((t: any) => t.tenantId).sort()).toEqual([cabinetA, cabinetB].sort());
    expect(parDefaut.body.tenants.find((t: any) => t.tenantId === cabinetA).name).toBe('Atelier A');

    const surB = await request(app).get('/api/tenants/mine')
      .set(authHeader(token)).set(tenantHeader(cabinetB));
    expect(surB.body.activeTenantId).toBe(cabinetB);
    expect(surB.body.tenants.find((t: any) => t.tenantId === cabinetB).isActive).toBe(true);
  });

  it('refuse un cabinet dont on n\'est pas membre, avec un code que le client sait traiter', async () => {
    const cabinet = makeTenant();
    const cabinetTiers = makeTenant();
    const { token } = makeUser(cabinet);

    const res = await request(app).get('/api/projects')
      .set(authHeader(token)).set(tenantHeader(cabinetTiers));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_NOT_MEMBER');
  });

  it('enregistre la bascule comme cabinet par défaut', async () => {
    const cabinetA = makeTenant();
    const cabinetB = makeTenant();
    const { userId, token } = makeUser(cabinetA);
    addMembership(userId, cabinetB);

    const res = await request(app).post('/api/tenants/switch')
      .set(authHeader(token)).send({ tenantId: cabinetB });
    expect(res.status).toBe(200);

    const memberships = fakeSupabaseAdmin.getTable('tenant_memberships').filter(m => m.user_id === userId);
    expect(memberships.find(m => m.tenant_id === cabinetB)?.is_default).toBe(true);
    expect(memberships.find(m => m.tenant_id === cabinetA)?.is_default).toBe(false);
    // `profiles.tenant_id` suit : c'est lui qui décide du cabinet servi quand
    // aucun en-tête n'accompagne la requête (nouveau poste, autre navigateur).
    expect(fakeSupabaseAdmin.getTable('profiles').find(p => p.id === userId)?.tenant_id).toBe(cabinetB);
  });

  it('refuse de basculer sur un cabinet dont on n\'est pas membre', async () => {
    const cabinet = makeTenant();
    const cabinetTiers = makeTenant();
    const { token } = makeUser(cabinet);
    const res = await request(app).post('/api/tenants/switch')
      .set(authHeader(token)).send({ tenantId: cabinetTiers });
    expect(res.status).toBe(403);
  });
});

describe('Cabinets multiples — étanchéité des données', () => {
  it('écrit dans le cabinet désigné, pas dans le cabinet par défaut', async () => {
    const cabinetA = makeTenant();
    const cabinetB = makeTenant();
    const { userId, token } = makeUser(cabinetA, 'admin');
    addMembership(userId, cabinetB, 'admin');

    const res = await request(app).post('/api/projects')
      .set(authHeader(token)).set(tenantHeader(cabinetB))
      .send({ name: 'Villa du second cabinet', client: 'M. Dupont' });
    expect(res.status).toBe(201);
    expect(fakeSupabaseAdmin.getTable('projects').find(p => p.id === res.body.id)?.tenant_id).toBe(cabinetB);
  });

  it('ne montre que les affaires du cabinet désigné', async () => {
    const cabinetA = makeTenant();
    const cabinetB = makeTenant();
    const { userId, token } = makeUser(cabinetA);
    addMembership(userId, cabinetB);
    fakeSupabaseAdmin.seed('projects', [
      { id: 'proj-a', tenant_id: cabinetA, name: 'Affaire A' },
      { id: 'proj-b', tenant_id: cabinetB, name: 'Affaire B' },
    ]);

    const surA = await request(app).get('/api/projects').set(authHeader(token));
    expect(surA.body.map((p: any) => p.id)).toEqual(['proj-a']);

    const surB = await request(app).get('/api/projects')
      .set(authHeader(token)).set(tenantHeader(cabinetB));
    expect(surB.body.map((p: any) => p.id)).toEqual(['proj-b']);
  });
});

describe('Cabinets multiples — rôles tenus par cabinet', () => {
  it('applique le rôle du cabinet désigné : gérant ici, collaborateur là', async () => {
    const monCabinet = makeTenant();
    const cabinetAssocie = makeTenant();
    const { userId, token } = makeUser(monCabinet, 'admin');
    addMembership(userId, cabinetAssocie, 'user');

    // Route réservée aux administrateurs du cabinet.
    const chezMoi = await request(app).get('/api/team/join-requests').set(authHeader(token));
    expect(chezMoi.status).toBe(200);

    const chezLAssocie = await request(app).get('/api/team/join-requests')
      .set(authHeader(token)).set(tenantHeader(cabinetAssocie));
    expect(chezLAssocie.status).toBe(403);
  });

  it('expose le cabinet actif et son rôle dans /api/me', async () => {
    const monCabinet = makeTenant({ name: 'Mon Cabinet' });
    const cabinetAssocie = makeTenant({ name: 'Cabinet Associé' });
    const { userId, token } = makeUser(monCabinet, 'admin');
    addMembership(userId, cabinetAssocie, 'user');

    const res = await request(app).get('/api/me')
      .set(authHeader(token)).set(tenantHeader(cabinetAssocie));
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(cabinetAssocie);
    expect(res.body.defaultTenantId).toBe(monCabinet);
    expect(res.body.system_role).toBe('user');
    expect(res.body.tenants).toHaveLength(2);
    expect(res.body.tenants.find((t: any) => t.tenantId === cabinetAssocie).isActive).toBe(true);
  });

  it('fait figurer dans l\'équipe une personne dont ce cabinet n\'est pas le défaut', async () => {
    const cabinetA = makeTenant();
    const cabinetB = makeTenant();
    const { token: tokenB } = makeUser(cabinetB, 'admin');
    const { userId: associeId } = makeUser(cabinetA, 'admin');
    addMembership(associeId, cabinetB, 'user');

    const res = await request(app).get('/api/team').set(authHeader(tokenB)).set(tenantHeader(cabinetB));
    expect(res.status).toBe(200);
    const associe = res.body.find((m: any) => m.id === associeId);
    expect(associe).toBeTruthy();
    // Le rôle affiché est celui tenu ICI, pas celui de son propre cabinet.
    expect(associe.system_role).toBe('user');
  });
});

describe('Cabinets multiples — inviter quelqu\'un qui a déjà un compte', () => {
  it('rattache le compte existant au lieu d\'en créer un second', async () => {
    const sonCabinet = makeTenant({ plan: 'pro' });
    const monCabinet = makeTenant({ plan: 'pro' });
    const { userId: associeId } = makeUser(sonCabinet, 'admin');
    const { token: adminToken } = makeUser(monCabinet, 'admin');
    const associeEmail = fakeSupabaseAdmin.getTable('profiles').find(p => p.id === associeId)!.email;
    const comptesAvant = fakeSupabaseAdmin.getTable('profiles').length;

    const res = await request(app).post('/api/team')
      .set(authHeader(adminToken)).set(tenantHeader(monCabinet))
      .send({ name: 'Architecte associé', email: associeEmail, role: 'Member', system_role: 'user' });
    expect(res.status).toBe(201);
    expect(res.body.existingAccount).toBe(true);
    expect(res.body.id).toBe(associeId);
    expect(fakeSupabaseAdmin.getTable('profiles').length).toBe(comptesAvant);

    const memberships = fakeSupabaseAdmin.getTable('tenant_memberships').filter(m => m.user_id === associeId);
    expect(memberships.map(m => m.tenant_id).sort()).toEqual([monCabinet, sonCabinet].sort());
    // Son cabinet d'ouverture de session ne bouge pas.
    expect(memberships.find(m => m.tenant_id === sonCabinet)?.is_default).toBe(true);
  });

  it('refuse un doublon dans le même cabinet', async () => {
    const cabinet = makeTenant({ plan: 'pro' });
    const { userId } = makeUser(cabinet, 'user');
    const { token: adminToken } = makeUser(cabinet, 'admin');
    const email = fakeSupabaseAdmin.getTable('profiles').find(p => p.id === userId)!.email;

    const res = await request(app).post('/api/team').set(authHeader(adminToken))
      .send({ name: 'Doublon', email, role: 'Member', system_role: 'user' });
    expect(res.status).toBe(400);
  });
});

describe('Cabinets multiples — quitter un cabinet', () => {
  it('détache la personne et ramène la session sur ce qu\'il lui reste', async () => {
    const cabinetA = makeTenant();
    const cabinetB = makeTenant();
    const { userId, token } = makeUser(cabinetA, 'admin');
    addMembership(userId, cabinetB, 'user');

    const res = await request(app).delete(`/api/tenants/${cabinetB}/membership`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.activeTenantId).toBe(cabinetA);
    expect(
      fakeSupabaseAdmin.getTable('tenant_memberships').filter(m => m.user_id === userId).map(m => m.tenant_id),
    ).toEqual([cabinetA]);
  });

  it('refuse de quitter son seul cabinet', async () => {
    const cabinet = makeTenant();
    const { token } = makeUser(cabinet, 'admin');
    const res = await request(app).delete(`/api/tenants/${cabinet}/membership`).set(authHeader(token));
    expect(res.status).toBe(409);
  });

  it('refuse de quitter un cabinet dont on est le seul administrateur', async () => {
    const cabinetA = makeTenant();
    const cabinetB = makeTenant();
    const { userId, token } = makeUser(cabinetA, 'user');
    addMembership(userId, cabinetB, 'admin');
    // Un collaborateur de plus dans B, mais pas d'autre administrateur.
    makeUser(cabinetB, 'user');

    const res = await request(app).delete(`/api/tenants/${cabinetB}/membership`).set(authHeader(token));
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/administrateur/i);
  });
});

describe('Cabinets multiples — instances non migrées', () => {
  // Un profil sans ligne d'adhésion : c'est l'état d'une instance qui n'a pas
  // encore joué la migration. Tout doit continuer de fonctionner à
  // l'identique, sinon la mise à jour du code casserait l'application avant
  // celle de la base.
  it('sert le cabinet du profil quand aucune adhésion n\'existe', async () => {
    const cabinet = makeTenant();
    const token = 'token-legacy-' + Date.now();
    fakeSupabaseAdmin.seed('profiles', [
      { id: 'legacy-user', tenant_id: cabinet, email: 'legacy@example.test', system_role: 'admin' },
    ]);
    fakeSupabaseAdmin.registerUser(token, { id: 'legacy-user', email: 'legacy@example.test' });
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-legacy', tenant_id: cabinet, name: 'Affaire héritée' }]);

    const mine = await request(app).get('/api/tenants/mine').set(authHeader(token));
    expect(mine.body.tenants.map((t: any) => t.tenantId)).toEqual([cabinet]);

    const projets = await request(app).get('/api/projects').set(authHeader(token));
    expect(projets.body.map((p: any) => p.id)).toEqual(['proj-legacy']);

    // Et le rôle du profil vaut toujours, sans quoi l'administrateur d'une
    // instance non migrée perdrait ses droits.
    const admin = await request(app).get('/api/team/join-requests').set(authHeader(token));
    expect(admin.status).toBe(200);
  });
});
