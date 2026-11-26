// Affaires d'un contact : lot, cotraitant, intervenant et maître d'ouvrage, via la fiche,
// sa société de rattachement ou ses interlocuteurs ; jamais celles d'un autre cabinet.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seed() {
  const tenantId = makeTenant();
  const user = makeUser(tenantId, 'admin');
  const other = makeTenant();
  const soc = `${tenantId}-soc`;
  const jason = `${tenantId}-jason`;
  const alone = `${tenantId}-alone`;
  fakeSupabaseAdmin.seed('contacts', [
    { id: soc, tenant_id: tenantId, first_name: '', last_name: '', company_name: "MENUISERIE DE L'EST" },
    { id: jason, tenant_id: tenantId, first_name: 'Jason', last_name: 'MICHEL', company_name: "MENUISERIE DE L'EST", company_contact_id: soc },
    { id: alone, tenant_id: tenantId, first_name: 'Sans', last_name: 'Affaire' },
    { id: `${other}-x`, tenant_id: other, first_name: '', last_name: '', company_name: 'Autre cabinet' },
  ]);
  fakeSupabaseAdmin.seed('projects', [
    { id: `${tenantId}-iut`, tenant_id: tenantId, name: 'IUT DE METZ' },
    { id: `${tenantId}-ecole`, tenant_id: tenantId, name: 'ECOLE', client_id: soc },
    { id: `${other}-p`, tenant_id: other, name: 'Affaire étrangère' },
  ]);
  fakeSupabaseAdmin.seed('project_lots', [
    { id: `${tenantId}-l1`, tenant_id: tenantId, project_id: `${tenantId}-iut`, lot_number: '07', lot_title: 'Menuiseries intérieures', contact_id: soc },
    { id: `${other}-l`, tenant_id: other, project_id: `${other}-p`, lot_number: '01', lot_title: 'Gros oeuvre', contact_id: soc },
  ]);
  fakeSupabaseAdmin.seed('project_cotraitants', [
    { id: `${tenantId}-c1`, tenant_id: tenantId, project_id: `${tenantId}-iut`, specialty: 'Bois', contact_id: jason },
  ]);
  fakeSupabaseAdmin.seed('project_stakeholders', []);
  return { user, soc, jason, alone, foreign: `${other}-x`, iut: `${tenantId}-iut`, ecole: `${tenantId}-ecole` };
}

const get = (token: string, id: string) => request(app).get(`/api/contacts/${id}/projects`).set(authHeader(token));

describe('GET /api/contacts/:id/projects', () => {
  it("rend l'affaire où la société tient un lot, avec le rôle", async () => {
    const { user, soc, iut, ecole } = seed();
    const res = await get(user.token, soc);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map((p: any) => [p.id, p]));
    expect(byId[iut]).toMatchObject({ name: 'IUT DE METZ' });
    expect(byId[iut].roles).toContain('Lot 07 Menuiseries intérieures');
    expect(byId[ecole].roles).toContain("Maître d'ouvrage");
  });

  it("remonte aussi les affaires de l'interlocuteur et celles de sa société", async () => {
    const { user, jason, iut } = seed();
    const res = await get(user.token, jason);
    expect(res.status).toBe(200);
    const iutRow = res.body.find((p: any) => p.id === iut);
    expect(iutRow.roles).toEqual(expect.arrayContaining(['Lot 07 Menuiseries intérieures', 'Cotraitant, Bois']));
    expect(res.body).toHaveLength(2);
  });

  it("rend une liste vide pour un contact sans affaire", async () => {
    const { user, alone } = seed();
    const res = await get(user.token, alone);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("ne révèle ni les affaires ni l'existence d'un contact d'un autre cabinet", async () => {
    const { user, foreign } = seed();
    expect((await get(user.token, foreign)).status).toBe(404);
  });
});
