// Diffusion des réserves : inclure ou non les réserves levées (`include_levees`), côté serveur.
// Par défaut elles sont incluses (comportement d'avant) ; refusées, ni le comptage des destinataires ni le
// journal ne les reprennent, et une entreprise qui n'a plus que des réserves levées disparaît de la liste.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { readIncludeLevees } from '../server/reserveDiffusionContext';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${++seq}`;

/** Une opération : Plâtres Martin (une réserve ouverte, une levée) et Peintures Durand (une seule, levée). */
function cabinet() {
  const tenantId = makeTenant({ plan: 'pro' });
  const { token } = makeUser(tenantId, 'admin');
  const projectId = uid('proj');
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, project_code: '26020', name: 'Atelier Test' }]);
  const plat = uid('contact'); const peint = uid('contact');
  fakeSupabaseAdmin.seed('contacts', [
    { id: plat, tenant_id: tenantId, company_name: 'Plâtres Martin', email: `${plat}@exemple.test` },
    { id: peint, tenant_id: tenantId, company_name: 'Peintures Durand', email: `${peint}@exemple.test` },
  ]);
  fakeSupabaseAdmin.seed('project_lots', [
    { id: uid('lot'), tenant_id: tenantId, project_id: projectId, lot_number: '02', lot_title: 'PLATRERIE', contact_id: plat, contact_name: 'Plâtres Martin' },
    { id: uid('lot'), tenant_id: tenantId, project_id: projectId, lot_number: '10', lot_title: 'PEINTURE', contact_id: peint, contact_name: 'Peintures Durand' },
  ]);
  const reserve = (n: number, extra: Record<string, unknown>) => ({
    id: uid('res'), tenant_id: tenantId, project_id: projectId, number: n, title: `Réserve ${n}`, status: 'A faire', due_date: '2030-01-01', ...extra,
  });
  fakeSupabaseAdmin.seed('reserves', [
    reserve(1, { lots: '["PLATRERIE"]', entreprises: '["Plâtres Martin"]' }),
    reserve(2, { lots: '["PLATRERIE"]', entreprises: '["Plâtres Martin"]', status: 'Levée' }),
    reserve(3, { lots: '["PEINTURE"]', entreprises: '["Peintures Durand"]', status: 'Quitus Transmis' }),
  ]);
  return { tenantId, token, projectId };
}

const recipients = (c: ReturnType<typeof cabinet>, query: Record<string, string> = {}) =>
  request(app).get(`/api/projects/${c.projectId}/reserve-exports/recipients`).query({ kind: 'opr', ...query }).set(authHeader(c.token));

describe('readIncludeLevees', () => {
  it('inclut les levées par défaut et seul un refus explicite les écarte', () => {
    expect(readIncludeLevees(undefined)).toBe(true);
    expect(readIncludeLevees(true)).toBe(true);
    expect(readIncludeLevees('1')).toBe(true);
    expect(readIncludeLevees(false)).toBe(false);
    expect(readIncludeLevees('false')).toBe(false);
    expect(readIncludeLevees('0')).toBe(false);
    expect(readIncludeLevees(0)).toBe(false);
  });
});

describe('destinataires avec ou sans les réserves levées', () => {
  it('compte toutes les réserves par défaut', async () => {
    const c = cabinet();
    const res = await recipients(c);
    expect(res.status).toBe(200);
    expect(res.body.reserve_count).toBe(3);
    const noms = Object.fromEntries(res.body.entreprises.map((e: any) => [e.name, e.reserve_count]));
    expect(noms).toEqual({ 'Plâtres Martin': 2, 'Peintures Durand': 1 });
  });

  it('écarte les levées et les entreprises qui n\'ont plus de réserve', async () => {
    const c = cabinet();
    const res = await recipients(c, { include_levees: '0' });
    expect(res.status).toBe(200);
    expect(res.body.reserve_count).toBe(1);
    const noms = Object.fromEntries(res.body.entreprises.map((e: any) => [e.name, e.reserve_count]));
    expect(noms).toEqual({ 'Plâtres Martin': 1 });
  });

  it('consigne le nombre de réserves réellement exportées dans le journal', async () => {
    const c = cabinet();
    const avec = await request(app).post(`/api/projects/${c.projectId}/reserve-exports`).set(authHeader(c.token))
      .send({ kind: 'opr', channel: 'telechargement', lots: null });
    const sans = await request(app).post(`/api/projects/${c.projectId}/reserve-exports`).set(authHeader(c.token))
      .send({ kind: 'opr', channel: 'telechargement', lots: null, include_levees: false });
    expect(avec.status).toBe(201);
    expect(avec.body.reserve_count).toBe(3);
    expect(sans.status).toBe(201);
    expect(sans.body.reserve_count).toBe(1);
  });
});
