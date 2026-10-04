// Journal de l'opération : server/routes/projectPhaseNotes.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function seedProject(tenantId: string, id: string) {
  fakeSupabaseAdmin.seed('projects', [{ id, tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status: 'Planning' }]);
}

describe('Journal de l’opération', () => {
  it('crée une entrée de dépassement de budget et la relit', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'pn1');

    const created = await request(app).post('/api/projects/pn1/phase-notes').set(authHeader(token)).send({
      phase: 'APD', kind: 'budget', body: 'Reprise en sous-œuvre imprévue', occurred_on: '2026-09-14',
      budget_before: 210000, budget_after: '238 500',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ phase: 'APD', kind: 'budget', budget_before: 210000, budget_after: 238500, occurred_on: '2026-09-14' });
    expect(created.body.author_name).toBeTruthy();

    const list = await request(app).get('/api/projects/pn1/phase-notes').set(authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it('refuse une phase inconnue, un texte vide ou un montant négatif', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'pn2');
    const post = (body: object) => request(app).post('/api/projects/pn2/phase-notes').set(authHeader(token)).send(body);

    expect((await post({ phase: 'XYZ', body: 'texte' })).status).toBe(400);
    expect((await post({ phase: 'APS', body: '   ' })).status).toBe(400);
    expect((await post({ phase: 'APS', kind: 'budget', body: 'x', budget_before: -5 })).status).toBe(400);
  });

  it('ne garde pas de montant sur une note qui n’est pas un dépassement', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'pn3');
    const created = await request(app).post('/api/projects/pn3/phase-notes').set(authHeader(token)).send({
      phase: 'ESQ', kind: 'programme', body: 'Ajout d’un garage', budget_before: 1000, budget_after: 2000,
    });
    expect(created.status).toBe(201);
    expect(created.body.budget_before).toBeNull();
    expect(created.body.budget_after).toBeNull();
  });

  it('modifie puis supprime une entrée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'pn4');
    const created = await request(app).post('/api/projects/pn4/phase-notes').set(authHeader(token))
      .send({ phase: 'DET', kind: 'attention', body: 'Étanchéité à vérifier' });
    const id = created.body.id;

    const updated = await request(app).put(`/api/phase-notes/${id}`).set(authHeader(token)).send({ body: 'Étanchéité vérifiée' });
    expect(updated.status).toBe(200);
    expect(updated.body.body).toBe('Étanchéité vérifiée');

    const removed = await request(app).delete(`/api/phase-notes/${id}`).set(authHeader(token));
    expect(removed.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('project_phase_notes').find(n => n.id === id)).toBeUndefined();
  });

  it('n’écrit pas dans l’affaire d’un autre cabinet', async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant();
    const { token } = makeUser(tenantB);
    seedProject(tenantA, 'pn5');
    const res = await request(app).post('/api/projects/pn5/phase-notes').set(authHeader(token))
      .send({ phase: 'ESQ', body: 'Note' });
    expect(res.status).toBe(404);
  });
});
