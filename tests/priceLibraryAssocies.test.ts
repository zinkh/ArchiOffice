// Postes associés d'un article de la bibliothèque : écriture nettoyée, PUT partiel sans effet, filtre `ids`.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

describe('postes associés', () => {
  it('POST enregistre des associés nettoyés', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/price-library').set(authHeader(token))
      .send({ designation: 'Fenêtre', unite: 'u', associes: [{ articleId: 'volet' }, { articleId: 'volet' }, { articleId: '' }, { articleId: 'allege', coefficient: 2 }] });
    expect(res.status).toBe(201);
    expect(res.body.associes).toEqual([{ articleId: 'volet' }, { articleId: 'allege', coefficient: 2 }]);
  });

  it('PUT sans `associes` les laisse, avec `associes` les remplace sans l\'article lui-même', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('articles_type', [
      { id: 'f1', tenant_id: tenantId, designation: 'Fenêtre', unite: 'u', usage_count: 0, associes: [{ articleId: 'volet' }] },
    ]);
    const garde = await request(app).put('/api/price-library/f1').set(authHeader(token)).send({ designation: 'Fenêtre PVC', unite: 'u' });
    expect(garde.status).toBe(200);
    expect(garde.body.associes).toEqual([{ articleId: 'volet' }]);

    const remplace = await request(app).put('/api/price-library/f1').set(authHeader(token))
      .send({ designation: 'Fenêtre PVC', unite: 'u', associes: [{ articleId: 'f1' }, { articleId: 'seuil' }] });
    expect(remplace.body.associes).toEqual([{ articleId: 'seuil' }]);
  });

  it('GET ?ids ne rend que les fiches demandées', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('articles_type', ['a', 'b', 'c'].map(id => ({ id, tenant_id: tenantId, designation: id, usage_count: 0 })));
    const res = await request(app).get('/api/price-library').query({ ids: 'a,c' }).set(authHeader(token));
    expect(res.body.map((r: any) => r.id).sort()).toEqual(['a', 'c']);
  });
});
