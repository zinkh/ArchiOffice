// Intervenants des entreprises d'un lot (onglet DET > Entreprises) : server/routes/lotIntervenants.ts
// Chaque intervenant est une fiche contact de l'agence, choisie ou créée sur place.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seed(tenantId: string, suffixe: string) {
  fakeSupabaseAdmin.seed('projects', [{ id: `li-p-${suffixe}`, tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status: 'Planning' }]);
  fakeSupabaseAdmin.seed('project_lots', [{ id: `li-lot-${suffixe}`, tenant_id: tenantId, project_id: `li-p-${suffixe}`, lot_number: '04', lot_title: 'Gros oeuvre' }]);
  fakeSupabaseAdmin.seed('contacts', [
    { id: `li-c1-${suffixe}`, tenant_id: tenantId, first_name: 'Paul', last_name: 'Durand', company_name: 'HCT', job_title: 'Conducteur', email: 'paul@hct.test', phone_mobile: '0611111111' },
    { id: `li-c2-${suffixe}`, tenant_id: tenantId, first_name: 'Léa', last_name: 'Roux', company_name: 'HCT', email: 'lea@hct.test' },
  ]);
}
const post = (token: string, lotId: string, body: object) => request(app).post(`/api/lots/${lotId}/intervenants`).set(authHeader(token)).send(body);

describe('intervenants d’un lot : contact existant', () => {
  it('plusieurs contacts pour une même entreprise, chacun avec son rôle, nom et adresse lus sur la fiche', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'a');
    const un = await post(token, 'li-lot-a', { entreprise: 'HCT', contact_id: 'li-c1-a', role: 'Conducteur de travaux' });
    const deux = await post(token, 'li-lot-a', { entreprise: 'HCT', contact_id: 'li-c2-a', role: 'Chef de chantier' });
    expect(un.status).toBe(201);
    expect(deux.status).toBe(201);
    expect(un.body).toMatchObject({ nom: 'Paul Durand', email: 'paul@hct.test', telephone: '0611111111', role: 'Conducteur de travaux', contact_id: 'li-c1-a' });

    const liste = await request(app).get('/api/projects/li-p-a/lot-intervenants').set(authHeader(token));
    expect(liste.status).toBe(200);
    expect(liste.body.map((i: any) => i.nom)).toEqual(['Paul Durand', 'Léa Roux']);
    expect(liste.body[0].contact).toMatchObject({ id: 'li-c1-a', job_title: 'Conducteur' });
  });

  it('relit la fiche à chaque lecture : une adresse corrigée dans les contacts corrige l’intervenant', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'b');
    await post(token, 'li-lot-b', { entreprise: 'HCT', contact_id: 'li-c1-b' });
    const fiche: any = fakeSupabaseAdmin.getTable('contacts').find((c: any) => c.id === 'li-c1-b');
    fiche.email = 'nouveau@hct.test';
    const liste = await request(app).get('/api/projects/li-p-b/lot-intervenants').set(authHeader(token));
    expect(liste.body[0]).toMatchObject({ email: 'nouveau@hct.test' });
  });

  it('refuse une seconde fois la même personne sur le lot', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'c');
    expect((await post(token, 'li-lot-c', { entreprise: 'HCT', contact_id: 'li-c1-c' })).status).toBe(201);
    expect((await post(token, 'li-lot-c', { entreprise: 'HCT', contact_id: 'li-c1-c' })).status).toBe(409);
  });

  it('refuse le contact ou le lot d’un autre cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'd');
    const autre = makeTenant();
    fakeSupabaseAdmin.seed('contacts', [{ id: 'li-c-etranger', tenant_id: autre, first_name: 'X', last_name: 'Y', email: 'x@y.test' }]);
    fakeSupabaseAdmin.seed('project_lots', [{ id: 'li-lot-etranger', tenant_id: autre, project_id: 'li-p-x', lot_number: '01', lot_title: 'VRD' }]);
    expect((await post(token, 'li-lot-d', { entreprise: 'HCT', contact_id: 'li-c-etranger' })).status).toBe(400);
    expect((await post(token, 'li-lot-etranger', { entreprise: 'HCT', contact_id: 'li-c1-d' })).status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('lot_intervenants').filter((i: any) => i.tenant_id === tenantId)).toHaveLength(0);
  });
});

describe('intervenants d’un lot : nouveau contact', () => {
  it('crée la fiche dans les contacts de l’agence, rattachée à la société, et l’ajoute au lot', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'e');
    const res = await post(token, 'li-lot-e', {
      entreprise: 'HCT', role: 'Chef de chantier',
      new_contact: { first_name: 'Marc', last_name: 'Petit', job_title: 'Chef d’équipe', phone_mobile: '0622222222', email: 'marc@hct.test' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nom: 'Marc Petit', role: 'Chef de chantier', email: 'marc@hct.test', entreprise: 'HCT' });
    const fiche = fakeSupabaseAdmin.getTable('contacts').find((c: any) => c.id === res.body.contact_id);
    expect(fiche).toMatchObject({ tenant_id: tenantId, first_name: 'Marc', last_name: 'Petit', company_name: 'HCT', job_title: 'Chef d’équipe', phone_mobile: '0622222222', email: 'marc@hct.test' });
  });

  it('exige un prénom ou un nom, refuse une adresse invalide, et ne crée alors aucune fiche', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'f');
    const avant = fakeSupabaseAdmin.getTable('contacts').length;
    expect((await post(token, 'li-lot-f', { entreprise: 'HCT', new_contact: { first_name: ' ', last_name: '' } })).status).toBe(400);
    expect((await post(token, 'li-lot-f', { entreprise: 'HCT', new_contact: { last_name: 'Petit', email: 'a@b.fr\nBcc: x@y.fr' } })).status).toBe(400);
    expect((await post(token, 'li-lot-f', { new_contact: { last_name: 'Petit' } })).status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('contacts').length).toBe(avant);
  });
});

describe('intervenants d’un lot : rôle et retrait', () => {
  it('modifie le rôle seulement, puis retire l’intervenant sans supprimer sa fiche, ni toucher à un autre cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'g');
    const cree = await post(token, 'li-lot-g', { entreprise: 'HCT', contact_id: 'li-c1-g', role: 'Chef' });
    const maj = await request(app).put(`/api/lot-intervenants/${cree.body.id}`).set(authHeader(token)).send({ role: 'Conducteur de travaux', nom: 'Piraté', email: 'pirate@x.test' });
    expect(maj.status).toBe(200);
    expect(maj.body).toMatchObject({ role: 'Conducteur de travaux', nom: 'Paul Durand', email: 'paul@hct.test' });

    const autre = makeTenant();
    const { token: tokenAutre } = makeUser(autre);
    expect((await request(app).put(`/api/lot-intervenants/${cree.body.id}`).set(authHeader(tokenAutre)).send({ role: 'Piraté' })).status).toBe(404);
    await request(app).delete(`/api/lot-intervenants/${cree.body.id}`).set(authHeader(tokenAutre));
    expect(fakeSupabaseAdmin.getTable('lot_intervenants').some((i: any) => i.id === cree.body.id)).toBe(true);

    expect((await request(app).delete(`/api/lot-intervenants/${cree.body.id}`).set(authHeader(token))).status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('lot_intervenants').some((i: any) => i.id === cree.body.id)).toBe(false);
    expect(fakeSupabaseAdmin.getTable('contacts').some((c: any) => c.id === 'li-c1-g')).toBe(true);
  });
});
