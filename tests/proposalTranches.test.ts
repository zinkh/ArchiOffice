// Tranches fermes et conditionnelles d'une proposition : validation du JSON de
// répartition à l'enregistrement, et reprise dans le contrat MOE à l'acceptation
// (tranche ferme seule ou toutes les tranches).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

const mission = (id: string, amount: number, tranche_id: string) => ({
  id, name: id.toUpperCase(), category: 'Mission base', amount, percentages: { architect: 100 }, tranche_id,
});

const repartition = (extra: Record<string, unknown> = {}) => JSON.stringify({
  tranches: [
    { id: 'tf', label: 'Tranche ferme', type: 'ferme' },
    { id: 'tc', label: 'Tranche conditionnelle 1', type: 'conditionnelle', condition: 'Sous réserve du financement' },
  ],
  missions: [mission('esquisse', 1000, 'tf'), mission('det', 3000, 'tc')],
  ...extra,
});

describe('Proposals : tranches', () => {
  it('refuse une répartition dont une mission vise une tranche inconnue', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const fee = JSON.stringify({
      tranches: [{ id: 'tf', label: 'Ferme', type: 'ferme' }],
      missions: [mission('esquisse', 1000, 'fantome')],
    });
    const res = await request(app).post('/api/proposals').set(authHeader(token)).send({ title: 'Devis', status: 'Draft', fee_distribution: fee });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Tranches invalides/);
  });

  it('refuse une répartition sans aucune tranche ferme', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const fee = JSON.stringify({ tranches: [{ id: 'tc', label: 'Cond', type: 'conditionnelle' }], missions: [] });
    const res = await request(app).post('/api/proposals').set(authHeader(token)).send({ title: 'Devis', status: 'Draft', fee_distribution: fee });
    expect(res.status).toBe(400);
  });

  it('accepte l\'ancien format sans tranches et un format cohérent', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const ancien = JSON.stringify({ missions: [{ id: 'esquisse', name: 'Esquisse', category: 'Mission base', amount: 100, percentages: { architect: 100 } }] });
    const r1 = await request(app).post('/api/proposals').set(authHeader(token)).send({ title: 'Ancien', status: 'Draft', fee_distribution: ancien });
    expect(r1.status).toBe(201);
    const r2 = await request(app).post('/api/proposals').set(authHeader(token)).send({ title: 'Tranches', status: 'Draft', fee_distribution: repartition() });
    expect(r2.status).toBe(201);
  });

  async function accepter(contratTranches?: 'ferme' | 'toutes') {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const fee = repartition(contratTranches ? { contrat_tranches: contratTranches } : {});
    const id = `p-${Math.random().toString(36).slice(2)}`;
    fakeSupabaseAdmin.seed('proposals', [{ id, tenant_id: tenantId, title: 'Devis tranches', status: 'Sent', amount: 4000 }]);
    const res = await request(app).put(`/api/proposals/${id}`).set(authHeader(token)).send({
      title: 'Devis tranches', status: 'Accepted', amount: 4000, fee_distribution: fee,
    });
    expect(res.status).toBe(200);
    return fakeSupabaseAdmin.getTable('contrats_moe').filter(c => c.tenant_id === tenantId);
  }

  it('reprend toutes les tranches dans le contrat par défaut', async () => {
    const contrats = await accepter();
    expect(contrats).toHaveLength(1);
    const noms = (contrats[0].missions_list as any[]).map(m => [m.id, m.tranche]);
    expect(noms).toEqual([['esquisse', 'Tranche ferme'], ['det', 'Tranche conditionnelle 1']]);
    expect(contrats[0].montant_honoraires).toBe(4000);
  });

  it('ne reprend que la tranche ferme quand le choix est « ferme »', async () => {
    const contrats = await accepter('ferme');
    expect(contrats).toHaveLength(1);
    expect((contrats[0].missions_list as any[]).map(m => m.id)).toEqual(['esquisse']);
    expect(contrats[0].montant_honoraires).toBe(1000);
  });
});
