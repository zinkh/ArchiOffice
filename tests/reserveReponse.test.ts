// Suivi des réserves AOR : la réponse (commentaire de suivi) d'une réserve OPR ou GPA.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { normalizeReponse, RESERVE_REPONSE_MAX } from '../server/reservePhotos';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('normalizeReponse', () => {
  it('retire les espaces, efface un texte vide ou non textuel et tronque', () => {
    expect(normalizeReponse('  Peinture à reprendre  ')).toBe('Peinture à reprendre');
    expect(normalizeReponse('   ')).toBeNull();
    expect(normalizeReponse(42)).toBeNull();
    expect(normalizeReponse('x'.repeat(RESERVE_REPONSE_MAX + 10))).toHaveLength(RESERVE_REPONSE_MAX);
  });
});

describe('Réponse de suivi des réserves', () => {
  for (const { apiBase, table } of [
    { apiBase: '/api/reserves', table: 'reserves' },
    { apiBase: '/api/gpa-reserves', table: 'gpa_reserves' },
  ]) {
    it(`${apiBase} : la réponse s'écrit, se lit, et un PUT qui ne la porte pas ne l'efface pas`, async () => {
      const tenantId = makeTenant();
      const { token } = makeUser(tenantId);
      fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenantId }]);

      const created = await request(app).post(apiBase).set(authHeader(token))
        .send({ project_id: 'p1', title: 'Peinture' });
      const id = created.body.id;

      const refused = await request(app).put(`${apiBase}/${id}`).set(authHeader(token))
        .send({ title: 'Peinture', status: 'Levée refusée par le MOE', reponse: '  Teinte non conforme, reprise attendue  ' });
      expect(refused.status).toBe(200);
      expect(refused.body.reponse).toBe('Teinte non conforme, reprise attendue');
      expect(fakeSupabaseAdmin.getTable(table).find(r => r.id === id)?.reponse).toBe('Teinte non conforme, reprise attendue');

      // Un changement de statut depuis un client qui ne connaît pas la réponse la laisse intacte.
      const statusOnly = await request(app).put(`${apiBase}/${id}`).set(authHeader(token))
        .send({ title: 'Peinture', status: 'En cours' });
      expect(statusOnly.status).toBe(200);
      expect(fakeSupabaseAdmin.getTable(table).find(r => r.id === id)?.reponse).toBe('Teinte non conforme, reprise attendue');

      const listed = await request(app).get(apiBase).query({ project_id: 'p1' }).set(authHeader(token));
      expect(listed.body.find((r: any) => r.id === id).reponse).toBe('Teinte non conforme, reprise attendue');

      // Une réponse vide l'efface.
      const cleared = await request(app).put(`${apiBase}/${id}`).set(authHeader(token))
        .send({ title: 'Peinture', status: 'Levée', reponse: '   ' });
      expect(cleared.status).toBe(200);
      expect(fakeSupabaseAdmin.getTable(table).find(r => r.id === id)?.reponse).toBeNull();
    });
  }
});
