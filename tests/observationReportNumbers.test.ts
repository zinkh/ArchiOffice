// Numéro du compte rendu qui a émis (`created_report_number`) et qui a levé
// (`resolved_report_number`) une observation (issue #245).
//
// Ces numéros étaient obtenus par une jointure PostgREST à indice de colonne
// (`site_reports!created_report_id(report_number)`), qui ne fonctionne que pour une clé
// étrangère à UNE colonne : elle aurait échoué (PGRST200) dès que `site_reports` reçoit des clés
// composites (colonne, tenant_id). Ils viennent maintenant d'UNE lecture groupée, comme le numéro
// de la réserve liée : la forme de la réponse ne change pas.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seed() {
  const tenantId = makeTenant();
  const other = makeTenant();
  const { token } = makeUser(tenantId);
  fakeSupabaseAdmin.seed('projects', [{ id: `${tenantId}-p`, tenant_id: tenantId, name: 'Opération' }]);
  fakeSupabaseAdmin.seed('site_reports', [
    { id: `${tenantId}-cr1`, tenant_id: tenantId, project_id: `${tenantId}-p`, report_number: 1 },
    { id: `${tenantId}-cr2`, tenant_id: tenantId, project_id: `${tenantId}-p`, report_number: 2 },
    { id: `${other}-cr9`, tenant_id: other, project_id: `${other}-p`, report_number: 9 },
  ]);
  return { tenantId, other, token, projectId: `${tenantId}-p`, cr1: `${tenantId}-cr1`, cr2: `${tenantId}-cr2`, foreignCr: `${other}-cr9` };
}

const list = (token: string, projectId: string) =>
  request(app).get(`/api/projects/${projectId}/observations`).set(authHeader(token));

describe('GET /api/projects/:projectId/observations : numéros de compte rendu', () => {
  it('rend le numéro du compte rendu qui a émis et de celui qui a levé l\'observation', async () => {
    const s = seed();
    fakeSupabaseAdmin.seed('observations', [
      { id: `${s.tenantId}-o1`, tenant_id: s.tenantId, project_id: s.projectId, number: 1, texte: 'Émise au CR 1, levée au CR 2',
        created_report_id: s.cr1, resolved_report_id: s.cr2 },
    ]);
    const res = await list(s.token, s.projectId);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ created_report_number: 1, resolved_report_number: 2 });
  });

  it('garde la forme d\'avant : created_report et resolved_report portent report_number, ou null sans lien', async () => {
    const s = seed();
    fakeSupabaseAdmin.seed('observations', [
      { id: `${s.tenantId}-o1`, tenant_id: s.tenantId, project_id: s.projectId, number: 1, texte: 'Émise seulement', created_report_id: s.cr1, resolved_report_id: null },
      { id: `${s.tenantId}-o2`, tenant_id: s.tenantId, project_id: s.projectId, number: 2, texte: 'Sans compte rendu' },
    ]);
    const res = await list(s.token, s.projectId);
    const [o1, o2] = res.body;
    expect(o1.created_report).toEqual({ report_number: 1 });
    expect(o1.resolved_report).toBeNull();
    expect(o1.resolved_report_number).toBeUndefined();
    expect(o2.created_report).toBeNull();
    expect(o2.created_report_number).toBeUndefined();
  });

  it('ne rend jamais le numéro d\'un compte rendu d\'un autre cabinet', async () => {
    const s = seed();
    fakeSupabaseAdmin.seed('observations', [
      { id: `${s.tenantId}-o1`, tenant_id: s.tenantId, project_id: s.projectId, number: 1, texte: 'Lien étranger', created_report_id: s.foreignCr },
    ]);
    const res = await list(s.token, s.projectId);
    expect(res.status).toBe(200);
    expect(res.body[0].created_report_number).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('"report_number":9');
  });

  it('rend les bons numéros pour plusieurs observations qui partagent des comptes rendus', async () => {
    const s = seed();
    fakeSupabaseAdmin.seed('observations', [1, 2, 3, 4, 5, 6].map(i => ({
      id: `${s.tenantId}-o${i}`, tenant_id: s.tenantId, project_id: s.projectId, number: i, texte: `Obs ${i}`,
      created_report_id: i % 2 ? s.cr1 : s.cr2, resolved_report_id: s.cr2,
    })));
    const res = await list(s.token, s.projectId);
    expect(res.body.map((o: any) => [o.created_report_number, o.resolved_report_number]))
      .toEqual([[1, 2], [2, 2], [1, 2], [2, 2], [1, 2], [2, 2]]);
  });
});
