// PUT /api/projects/:id et les listes rattachées (lots, cotraitants,
// intervenants, catégories) : voir server/routes/projects.ts, `replaceList`.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function seedProjectWithLot(tenantId: string, projectId: string) {
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status: 'Planning' }]);
  fakeSupabaseAdmin.seed('project_lots', [{
    id: `${projectId}-lot1`, tenant_id: tenantId, project_id: projectId,
    lot_number: '01', lot_title: 'Gros œuvre', contact_id: null, base_amount: 120000,
  }]);
}

describe('Mise à jour d’une affaire et listes rattachées', () => {
  it('une mise à jour sans liste ne touche pas aux lots', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProjectWithLot(tenantId, 'pl1');

    const res = await request(app).put('/api/projects/pl1').set(authHeader(token))
      .send({ name: 'Villa Martin', client: 'M. Martin', programme: 'Extension de 40 m²' });
    expect(res.status).toBe(200);

    const lots = fakeSupabaseAdmin.getTable('project_lots').filter(l => l.project_id === 'pl1');
    expect(lots).toHaveLength(1);
    expect(lots[0].id).toBe('pl1-lot1');
    expect(lots[0].base_amount).toBe(120000);
  });

  it('une liste envoyée garde l’identifiant et les montants des lots existants', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProjectWithLot(tenantId, 'pl2');

    const res = await request(app).put('/api/projects/pl2').set(authHeader(token)).send({
      name: 'Villa Martin', client: 'M. Martin',
      lots_list: [
        { id: 'pl2-lot1', lot_number: '01', lot_title: 'Gros œuvre et maçonnerie' },
        { lot_number: '02', lot_title: 'Charpente' },
      ],
    });
    expect(res.status).toBe(200);

    const lots = fakeSupabaseAdmin.getTable('project_lots').filter(l => l.project_id === 'pl2');
    expect(lots).toHaveLength(2);
    const kept = lots.find(l => l.id === 'pl2-lot1');
    expect(kept?.lot_title).toBe('Gros œuvre et maçonnerie');
    expect(kept?.base_amount).toBe(120000);
    expect(lots.find(l => l.lot_number === '02')?.id).not.toBe('pl2-lot1');
  });

  it('une liste vide envoyée explicitement vide bien les lots', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProjectWithLot(tenantId, 'pl3');

    const res = await request(app).put('/api/projects/pl3').set(authHeader(token))
      .send({ name: 'Villa Martin', client: 'M. Martin', lots_list: [] });
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('project_lots').filter(l => l.project_id === 'pl3')).toHaveLength(0);
  });
});
