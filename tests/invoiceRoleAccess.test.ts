// Chef de projet (pm) : voit les factures et les notes d'honoraires de SES
// affaires (celles dont il est membre), prépare des notes d'honoraires, mais ne
// crée, ne modifie ni ne supprime aucune facture. L'administrateur et le
// manager gardent l'accès complet.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function setup() {
  const tenantId = makeTenant();
  const admin = makeUser(tenantId, 'admin');
  const pm = makeUser(tenantId, 'pm');
  fakeSupabaseAdmin.seed('projects', [
    { id: `${tenantId}-mine`, tenant_id: tenantId, name: 'Mon affaire' },
    { id: `${tenantId}-other`, tenant_id: tenantId, name: 'Autre affaire' },
  ]);
  fakeSupabaseAdmin.seed('project_members', [
    { id: `${tenantId}-m1`, tenant_id: tenantId, project_id: `${tenantId}-mine`, user_id: pm.userId },
  ]);
  fakeSupabaseAdmin.seed('invoices', [
    { id: `${tenantId}-i1`, tenant_id: tenantId, project_id: `${tenantId}-mine`, amount: 1000, status: 'Sent', created_at: '2026-10-01T00:00:00Z' },
    { id: `${tenantId}-i2`, tenant_id: tenantId, project_id: `${tenantId}-other`, amount: 2000, status: 'Paid', created_at: '2026-10-02T00:00:00Z' },
    { id: `${tenantId}-i3`, tenant_id: tenantId, project_id: null, amount: 300, status: 'Sent', created_at: '2026-10-03T00:00:00Z' },
  ]);
  return { tenantId, admin, pm };
}

describe('Factures : lecture selon le rôle', () => {
  it('le chef de projet ne voit que les factures de ses affaires, avec leurs montants', async () => {
    const { tenantId, pm } = setup();
    const res = await request(app).get('/api/invoices').set(authHeader(pm.token));
    expect(res.status).toBe(200);
    expect(res.body.map((i: any) => i.id)).toEqual([`${tenantId}-i1`]);
    expect(res.body[0].amount).toBe(1000);
  });

  it('une facture d\'une autre affaire (ou sans affaire) lui est introuvable', async () => {
    const { tenantId, pm } = setup();
    expect((await request(app).get(`/api/invoices/${tenantId}-i2`).set(authHeader(pm.token))).status).toBe(404);
    expect((await request(app).get(`/api/invoices/${tenantId}-i3`).set(authHeader(pm.token))).status).toBe(404);
    expect((await request(app).get(`/api/invoices/${tenantId}-i1`).set(authHeader(pm.token))).status).toBe(200);
  });

  it('un chef de projet sans aucune affaire ne voit aucune facture', async () => {
    const tenantId = makeTenant();
    makeUser(tenantId, 'admin');
    const pm = makeUser(tenantId, 'pm');
    fakeSupabaseAdmin.seed('invoices', [{ id: `${tenantId}-i`, tenant_id: tenantId, project_id: 'x', amount: 1, status: 'Sent', created_at: '2026-10-01T00:00:00Z' }]);
    const res = await request(app).get('/api/invoices').set(authHeader(pm.token));
    expect(res.body).toEqual([]);
  });

  it('l\'administrateur voit toutes les factures', async () => {
    const { admin } = setup();
    const res = await request(app).get('/api/invoices').set(authHeader(admin.token));
    expect(res.body).toHaveLength(3);
  });
});

describe('Factures : le rôle utilisateur par défaut n\'est pas restreint', () => {
  it('un utilisateur simple facture toujours', async () => {
    const tenantId = makeTenant();
    const user = makeUser(tenantId, 'user');
    const res = await request(app).post('/api/invoices').set(authHeader(user.token)).send({ amount: 100 });
    expect(res.status).toBe(201);
  });
});

describe('Factures : écriture réservée', () => {
  it('le chef de projet ne peut ni créer, ni modifier, ni supprimer une facture', async () => {
    const { tenantId, pm } = setup();
    const create = await request(app).post('/api/invoices').set(authHeader(pm.token)).send({ amount: 100, project_id: `${tenantId}-mine` });
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('INVOICE_WRITE_FORBIDDEN');
    expect((await request(app).put(`/api/invoices/${tenantId}-i1`).set(authHeader(pm.token)).send({ amount: 1 })).status).toBe(403);
    expect((await request(app).delete(`/api/invoices/${tenantId}-i1`).set(authHeader(pm.token))).status).toBe(403);
    expect(fakeSupabaseAdmin.getTable('invoices').find((i: any) => i.id === `${tenantId}-i1`)).toBeTruthy();
  });

  it('l\'administrateur crée toujours une facture', async () => {
    const { tenantId, admin } = setup();
    const res = await request(app).post('/api/invoices').set(authHeader(admin.token)).send({ amount: 100, project_id: `${tenantId}-mine` });
    expect(res.status).toBe(201);
  });
});

describe('Notes d\'honoraires : le chef de projet en prépare, sans facturer', () => {
  it('crée une note sur son affaire, pas sur celle d\'un autre', async () => {
    const { tenantId, pm } = setup();
    const mine = await request(app).post('/api/notes_honoraires').set(authHeader(pm.token)).send({ project_id: `${tenantId}-mine`, objet: 'ESQ' });
    expect(mine.status).toBe(201);
    const other = await request(app).post('/api/notes_honoraires').set(authHeader(pm.token)).send({ project_id: `${tenantId}-other`, objet: 'ESQ' });
    expect(other.status).toBe(403);
  });

  it('ne voit que les notes de ses affaires', async () => {
    const { tenantId, pm } = setup();
    fakeSupabaseAdmin.seed('notes_honoraires', [
      { id: `${tenantId}-n1`, tenant_id: tenantId, project_id: `${tenantId}-mine`, numero: 'NH-1', created_at: '2026-10-01T00:00:00Z' },
      { id: `${tenantId}-n2`, tenant_id: tenantId, project_id: `${tenantId}-other`, numero: 'NH-2', created_at: '2026-10-02T00:00:00Z' },
    ]);
    const res = await request(app).get('/api/notes_honoraires').set(authHeader(pm.token));
    expect(res.body.map((n: any) => n.id)).toEqual([`${tenantId}-n1`]);
    expect((await request(app).put(`/api/notes_honoraires/${tenantId}-n2`).set(authHeader(pm.token)).send({ objet: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/notes_honoraires/${tenantId}-n2`).set(authHeader(pm.token))).status).toBe(404);
  });

  it('ne peut pas générer la facture d\'une note', async () => {
    const { tenantId, pm } = setup();
    fakeSupabaseAdmin.seed('notes_honoraires', [{ id: `${tenantId}-n`, tenant_id: tenantId, project_id: `${tenantId}-mine`, numero: 'NH-3' }]);
    const res = await request(app).post(`/api/notes_honoraires/${tenantId}-n/facture`).set(authHeader(pm.token));
    expect(res.status).toBe(403);
  });
});
