// POST /api/contacts/merge : rôles, confirmation forte, valeurs recalculées côté serveur,
// protections des contacts personnels. La fonction SQL est remplacée (elle est testée sur
// un vrai Postgres par contactMerge.pg.test.ts) : ici on vérifie ce que la route lui envoie.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
afterEach(() => { vi.restoreAllMocks(); });

function seed() {
  const tenantId = makeTenant();
  const admin = makeUser(tenantId, 'admin');
  fakeSupabaseAdmin.seed('contacts', [
    { id: `${tenantId}-p`, tenant_id: tenantId, first_name: '', last_name: '', company_name: 'Selia Association', email: 'a@selia.fr', tags: 'vip' },
    { id: `${tenantId}-d`, tenant_id: tenantId, first_name: '', last_name: '', company_name: 'SELIA ASSOC.', email: 'b@selia.fr', phone: '0383000001', tags: 'nancy' },
  ]);
  return { tenantId, admin, p: `${tenantId}-p`, d: `${tenantId}-d` };
}

const mockRpc = () => vi.spyOn(fakeSupabaseAdmin, 'rpc').mockResolvedValue({ data: { merged_ids: [], moved: { 'invoices.client_id': 2 } }, error: null } as any);

describe('POST /api/contacts/merge', () => {
  it('refuse un rôle qui n\'est ni administrateur ni manager', async () => {
    const { tenantId, p, d } = seed();
    const pm = makeUser(tenantId, 'pm');
    const rpc = mockRpc();
    const res = await request(app).post('/api/contacts/merge').set(authHeader(pm.token)).send({ primary_id: p, duplicate_ids: [d], confirm: 'FUSIONNER' });
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('exige la confirmation, côté serveur aussi', async () => {
    const { admin, p, d } = seed();
    const rpc = mockRpc();
    for (const confirm of [undefined, '', 'oui', 'fusion']) {
      const res = await request(app).post('/api/contacts/merge').set(authHeader(admin.token)).send({ primary_id: p, duplicate_ids: [d], confirm });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CONFIRMATION_REQUIRED');
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('valide la demande : doublon identique à la fiche conservée, aucune fiche, trop de fiches', async () => {
    const { admin, p } = seed();
    mockRpc();
    const post = (body: object) => request(app).post('/api/contacts/merge').set(authHeader(admin.token)).send({ confirm: 'FUSIONNER', ...body });
    expect((await post({ primary_id: p, duplicate_ids: [p] })).status).toBe(400);
    expect((await post({ primary_id: p, duplicate_ids: [] })).status).toBe(400);
    expect((await post({ primary_id: p })).status).toBe(400);
    expect((await post({ primary_id: p, duplicate_ids: Array.from({ length: 11 }, (_, i) => `x${i}`) })).body.code).toBe('TOO_MANY');
  });

  it('recalcule les valeurs depuis la base : un correctif envoyé par le client est ignoré', async () => {
    const { tenantId, admin, p, d } = seed();
    const rpc = mockRpc();
    const res = await request(app).post('/api/contacts/merge').set(authHeader(admin.token)).send({
      primary_id: p, duplicate_ids: [d], confirm: ' fusionner ',
      picks: { email: d, company_name: 'inconnu', phone: 42 },
      patch: { first_name: 'Pirate' }, p_patch: { siret: '0' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, primary_id: p, moved: { 'invoices.client_id': 2 } });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, params] = rpc.mock.calls[0] as [string, any];
    expect(fn).toBe('merge_contacts');
    expect(params).toMatchObject({ p_tenant: tenantId, p_primary: p, p_dups: [d] });
    expect(params.p_patch).toEqual({ email: 'b@selia.fr', phone: '0383000001', tags: 'vip, nancy' });
    expect(res.body.updated_fields.sort()).toEqual(['email', 'phone', 'tags']);
  });

  it('404 si une fiche est introuvable ou appartient à un autre cabinet', async () => {
    const { admin, p } = seed();
    const other = makeTenant();
    fakeSupabaseAdmin.seed('contacts', [{ id: `${other}-o`, tenant_id: other, first_name: '', last_name: '', company_name: 'Autre cabinet' }]);
    const rpc = mockRpc();
    for (const dup of ['inconnu', `${other}-o`]) {
      const res = await request(app).post('/api/contacts/merge').set(authHeader(admin.token)).send({ primary_id: p, duplicate_ids: [dup], confirm: 'FUSIONNER' });
      expect(res.status).toBe(404);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('protège les contacts personnels', async () => {
    const { tenantId, admin, p, d } = seed();
    const other = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('contacts', [
      { id: `${tenantId}-mine`, tenant_id: tenantId, first_name: 'Moi', last_name: 'Perso', is_personal: true, owner_user_id: admin.userId },
      { id: `${tenantId}-mine2`, tenant_id: tenantId, first_name: 'Moi', last_name: 'Perso', is_personal: true, owner_user_id: admin.userId },
      { id: `${tenantId}-theirs`, tenant_id: tenantId, first_name: 'Eux', last_name: 'Perso', is_personal: true, owner_user_id: other.userId },
    ]);
    const rpc = mockRpc();
    const post = (primary: string, dup: string) => request(app).post('/api/contacts/merge').set(authHeader(admin.token)).send({ primary_id: primary, duplicate_ids: [dup], confirm: 'FUSIONNER' });
    expect((await post(p, `${tenantId}-mine`)).body.code).toBe('MIXED_PERSONAL'); // personnel + partagé
    expect((await post(`${tenantId}-mine`, `${tenantId}-theirs`)).status).toBe(403); // personnel d'un autre
    expect(rpc).not.toHaveBeenCalled();
    expect((await post(`${tenantId}-mine`, `${tenantId}-mine2`)).status).toBe(200); // les siens entre eux
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(d).toBeTruthy();
  });

  it('503 explicite quand la migration n\'est pas jouée', async () => {
    const { admin, p, d } = seed();
    vi.spyOn(fakeSupabaseAdmin, 'rpc').mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } } as any);
    const res = await request(app).post('/api/contacts/merge').set(authHeader(admin.token)).send({ primary_id: p, duplicate_ids: [d], confirm: 'FUSIONNER' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MIGRATION_MISSING');
  });
});

describe('POST /api/contacts/merge-safe', () => {
  function seedSafe() {
    const tenantId = makeTenant();
    const admin = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('contacts', [
      // groupe sûr : même société, valeurs compatibles
      { id: `${tenantId}-a1`, tenant_id: tenantId, company_name: 'SOCOTEC', phone: '0383000001' },
      { id: `${tenantId}-a2`, tenant_id: tenantId, company_name: 'Socotec', email: 'x@socotec.fr' },
      // groupe non sûr : même e-mail, noms différents
      { id: `${tenantId}-b1`, tenant_id: tenantId, first_name: 'Anne', last_name: 'Durand', email: 'shared@x.fr' },
      { id: `${tenantId}-b2`, tenant_id: tenantId, first_name: 'Paul', last_name: 'Martin', email: 'shared@x.fr' },
      // groupe non sûr : même nom mais téléphones en conflit
      { id: `${tenantId}-c1`, tenant_id: tenantId, company_name: 'LCR', phone: '0383111111' },
      { id: `${tenantId}-c2`, tenant_id: tenantId, company_name: 'LCR', phone: '0383222222' },
    ]);
    return { tenantId, admin };
  }

  it('aperçu : ne fusionne rien et ne retient que les groupes sûrs', async () => {
    const { admin } = seedSafe();
    const rpc = mockRpc();
    const res = await request(app).post('/api/contacts/merge-safe').set(authHeader(admin.token)).send({ dry_run: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ groups: 1, duplicates: 1, skipped: 2 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('exige la confirmation et un rôle administrateur ou manager', async () => {
    const { tenantId, admin } = seedSafe();
    const rpc = mockRpc();
    const none = await request(app).post('/api/contacts/merge-safe').set(authHeader(admin.token)).send({});
    expect(none.body.code).toBe('CONFIRMATION_REQUIRED');
    const pm = makeUser(tenantId, 'pm');
    const denied = await request(app).post('/api/contacts/merge-safe').set(authHeader(pm.token)).send({ confirm: 'FUSIONNER' });
    expect(denied.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fusionne uniquement le groupe sûr', async () => {
    const { admin } = seedSafe();
    const rpc = mockRpc();
    const res = await request(app).post('/api/contacts/merge-safe').set(authHeader(admin.token)).send({ confirm: 'FUSIONNER' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ merged: 1, remaining: 0, skipped: 2 });
    expect(rpc).toHaveBeenCalledTimes(1);
    const args = rpc.mock.calls[0][1] as any;
    expect(args.p_dups).toHaveLength(1);
  });
});
