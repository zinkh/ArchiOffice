// Rapports de diagnostic (onglet DIAG) : server/routes/diagReports.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { sanitizeRichHtml } from '../server/richHtml';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const seedProject = (tenantId: string, id: string) =>
  fakeSupabaseAdmin.seed('projects', [{ id, tenant_id: tenantId, name: 'Maison Dupont', status: 'Planning' }]);

describe('Rapports de diagnostic', () => {
  it('crée, enregistre, liste et supprime un rapport', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'diag-1');

    const created = await request(app).post('/api/projects/diag-1/diag-reports').set(authHeader(token)).send({ title: 'Diagnostic structure' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const saved = await request(app).put(`/api/projects/diag-1/diag-reports/${id}`).set(authHeader(token)).send({ content: '<p>Charpente <strong>saine</strong></p>' });
    expect(saved.status).toBe(200);
    expect(saved.body.content).toBe('<p>Charpente <strong>saine</strong></p>');

    const list = await request(app).get('/api/projects/diag-1/diag-reports').set(authHeader(token));
    expect(list.body).toHaveLength(1);

    expect((await request(app).delete(`/api/projects/diag-1/diag-reports/${id}`).set(authHeader(token))).status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('diag_reports').filter((r: any) => r.project_id === 'diag-1')).toHaveLength(0);
  });

  it("nettoie le HTML enregistré (script, attributs d'événement)", async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'diag-2');
    const created = await request(app).post('/api/projects/diag-2/diag-reports').set(authHeader(token)).send({});
    const res = await request(app).put(`/api/projects/diag-2/diag-reports/${created.body.id}`).set(authHeader(token))
      .send({ content: '<p onclick="x()">Ok</p><script>alert(1)</script><img src=x onerror=1>' });
    expect(res.body.content).toBe('<p>Ok</p>');
  });

  it("n'expose pas les rapports d'un autre cabinet", async () => {
    const a = makeTenant(); const b = makeTenant();
    const userA = makeUser(a); const userB = makeUser(b);
    seedProject(a, 'diag-3');
    await request(app).post('/api/projects/diag-3/diag-reports').set(authHeader(userA.token)).send({ title: 'Privé' });
    expect((await request(app).get('/api/projects/diag-3/diag-reports').set(authHeader(userB.token))).status).toBe(404);
  });

  it('refuse une commande IA inconnue ou une réécriture sans texte', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'diag-4');
    const base = '/api/projects/diag-4/diag-reports/ai-write';
    expect((await request(app).post(base).set(authHeader(token)).send({ mode: 'hack' })).status).toBe(400);
    expect((await request(app).post(base).set(authHeader(token)).send({ mode: 'shorten', selection: '  ' })).status).toBe(400);
    expect((await request(app).post(base).set(authHeader(token)).send({ mode: 'write', instruction: '' })).status).toBe(400);
  });
});

describe('sanitizeRichHtml', () => {
  it('garde la mise en forme de l\'éditeur', () => {
    const html = '<h2>T</h2><ul><li><p>a</p></li></ul><blockquote><p>q</p></blockquote>';
    expect(sanitizeRichHtml(html)).toBe(html);
  });
});

describe('Rédaction IA des rapports : plan Enterprise, aperçu pendant l\'essai', () => {
  const aiWrite = (id: string) => `/api/projects/${id}/diag-reports/ai-write`;
  const body = { mode: 'write', instruction: '' }; // refusé en 400 une fois le plan accepté : aucun appel au modèle

  it('refuse un plan inférieur à Enterprise', async () => {
    const tenantId = makeTenant({ plan: 'starter' });
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'diag-5');
    const res = await request(app).post(aiWrite('diag-5')).set(authHeader(token)).send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AI_ENTERPRISE_ONLY');
  });

  it('refuse un essai expiré', async () => {
    const tenantId = makeTenant({ plan: 'trial', trial_ends_at: '2020-01-01T00:00:00Z' });
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'diag-6');
    expect((await request(app).post(aiWrite('diag-6')).set(authHeader(token)).send(body)).status).toBe(403);
  });

  it('laisse passer Enterprise et un essai en cours (aperçu)', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    for (const [plan, extra] of [['enterprise', {}], ['trial', { trial_ends_at: future }]] as const) {
      const tenantId = makeTenant({ plan, ...extra });
      const { token } = makeUser(tenantId);
      const id = `diag-${plan}`;
      seedProject(tenantId, id);
      const res = await request(app).post(aiWrite(id)).set(authHeader(token)).send(body);
      expect(res.status).toBe(400);
    }
  });
});
