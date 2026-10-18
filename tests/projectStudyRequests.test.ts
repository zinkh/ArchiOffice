// Historique des demandes de consultation dans la fiche affaire : validation,
// consignation d'un envoi confirmé, idempotence et isolement entre affaires.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { validateStudyRequest } from '../server/routes/projectStudyRequests';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

const demandeValide = {
  kind: 'geotechnique',
  subject: 'Demande de devis, étude de sol : Villa Martin',
  recipients: ['geo@sol.fr'],
  etudes: ['G1'],
  payload: { values: { sondagesNombre: '3' } },
};

describe('validateStudyRequest', () => {
  it('accepte une demande complète', () => {
    expect(validateStudyRequest(demandeValide)).toBeNull();
  });

  it('refuse une nature inconnue, une adresse invalide et une liste d’études vide', () => {
    expect(validateStudyRequest({ ...demandeValide, kind: 'autre' })).toMatch(/Nature/);
    expect(validateStudyRequest({ ...demandeValide, recipients: ['pas-une-adresse'] })).toMatch(/e-mail/);
    expect(validateStudyRequest({ ...demandeValide, etudes: [] })).toMatch(/étude/);
  });

  it('refuse un contenu trop volumineux', () => {
    expect(validateStudyRequest({ ...demandeValide, payload: { texte: 'x'.repeat(25000) } })).toMatch(/volumineux/);
  });
});

describe('Historique des demandes dans la fiche affaire', () => {
  it('consigne un envoi confirmé puis le relit dans l’historique de l’affaire', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-a', tenant_id: tenantId, name: 'Villa Martin' }]);

    const created = await request(app).post('/api/projects/proj-a/study-requests').set(authHeader(token))
      .send({ id: 'req-0001', ...demandeValide });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: 'geotechnique', project_id: 'proj-a', recipients: ['geo@sol.fr'] });

    const listed = await request(app).get('/api/projects/proj-a/study-requests?kind=geotechnique').set(authHeader(token));
    expect(listed.status).toBe(200);
    expect(listed.body.map((r: any) => r.id)).toContain('req-0001');
  });

  it('rejoue sans doublon : un second envoi avec le même identifiant rend l’existant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-b', tenant_id: tenantId, name: 'Villa Martin' }]);

    await request(app).post('/api/projects/proj-b/study-requests').set(authHeader(token)).send({ id: 'req-0002', ...demandeValide });
    const rejouee = await request(app).post('/api/projects/proj-b/study-requests').set(authHeader(token)).send({ id: 'req-0002', ...demandeValide });
    expect(rejouee.status).toBe(200);

    const listed = await request(app).get('/api/projects/proj-b/study-requests').set(authHeader(token));
    expect(listed.body.filter((r: any) => r.id === 'req-0002')).toHaveLength(1);
  });

  it('refuse une affaire qui n’appartient pas au cabinet', async () => {
    const tenantId = makeTenant();
    const autre = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-autre', tenant_id: autre, name: 'Autre cabinet' }]);

    const res = await request(app).post('/api/projects/proj-autre/study-requests').set(authHeader(token)).send(demandeValide);
    expect(res.status).toBe(404);
  });

  it('filtre l’historique par nature : une étude de sol n’apparaît pas au contrôle technique', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'proj-c', tenant_id: tenantId, name: 'Villa Martin' }]);

    await request(app).post('/api/projects/proj-c/study-requests').set(authHeader(token)).send({ id: 'req-0003', ...demandeValide });
    const ct = await request(app).get('/api/projects/proj-c/study-requests?kind=controle_technique').set(authHeader(token));
    expect(ct.body).toEqual([]);
  });
});
