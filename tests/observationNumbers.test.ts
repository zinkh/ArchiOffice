// Deux observations créées en même temps sur une opération ne prennent jamais le même numéro.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

describe('POST /api/projects/:projectId/observations', () => {
  it('attribue des numéros distincts à des créations simultanées', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p-num', tenant_id: tenantId, name: 'Opération' }]);
    const reponses = await Promise.all(
      [1, 2, 3, 4, 5].map(i =>
        request(app).post('/api/projects/p-num/observations').set(authHeader(token)).send({ texte: `Obs ${i}` })),
    );
    expect(reponses.every(r => r.status === 200)).toBe(true);
    const numeros = reponses.map(r => r.body.number).sort((a, b) => a - b);
    expect(numeros).toEqual([1, 2, 3, 4, 5]);
  });
});
