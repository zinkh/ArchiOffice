// Entreprise d'un lot, posée sans passer par l'ACT : PUT /api/lots/:id (server/routes/lots.ts)
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function seed(tenantId: string, suffixe: string) {
  fakeSupabaseAdmin.seed('projects', [{ id: `la-p-${suffixe}`, tenant_id: tenantId, name: 'Villa Martin', client: 'M. Martin', status: 'Planning' }]);
  fakeSupabaseAdmin.seed('project_lots', [{ id: `la-lot-${suffixe}`, tenant_id: tenantId, project_id: `la-p-${suffixe}`, lot_number: '02', lot_title: 'Gros oeuvre' }]);
  fakeSupabaseAdmin.seed('contacts', [{ id: `la-c-${suffixe}`, tenant_id: tenantId, first_name: 'Jean', last_name: 'Dupont', company_name: 'Dupont SARL' }]);
}
const lot = (suffixe: string): any => fakeSupabaseAdmin.getTable('project_lots').find((l: any) => l.id === `la-lot-${suffixe}`);

describe('PUT /api/lots/:id : entreprise du lot', () => {
  it('pose la fiche contact et relit le nom sur la fiche, jamais dans la requête', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'a');
    const res = await request(app).put('/api/lots/la-lot-a').set(authHeader(token)).send({ contact_id: 'la-c-a', contact_name: 'Nom inventé' });
    expect(res.status).toBe(200);
    expect(lot('a')).toMatchObject({ contact_id: 'la-c-a', contact_name: 'Dupont SARL' });
  });

  it('retire l’entreprise avec contact_id nul', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'b');
    await request(app).put('/api/lots/la-lot-b').set(authHeader(token)).send({ contact_id: 'la-c-b' });
    const res = await request(app).put('/api/lots/la-lot-b').set(authHeader(token)).send({ contact_id: null });
    expect(res.status).toBe(200);
    expect(lot('b').contact_id).toBeNull();
    expect(lot('b').contact_name).toBeNull();
  });

  it('refuse la fiche d’un autre cabinet et ne modifie rien', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'c');
    const autre = makeTenant();
    fakeSupabaseAdmin.seed('contacts', [{ id: 'la-etranger', tenant_id: autre, first_name: 'X', last_name: 'Y', company_name: 'Concurrent' }]);
    const res = await request(app).put('/api/lots/la-lot-c').set(authHeader(token)).send({ contact_id: 'la-etranger' });
    expect(res.status).toBe(400);
    expect(lot('c').contact_id ?? null).toBeNull();
  });

  it('refuse un identifiant qui n’est pas du texte', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'd');
    const res = await request(app).put('/api/lots/la-lot-d').set(authHeader(token)).send({ contact_id: 42 });
    expect(res.status).toBe(400);
  });

  it('garde le renommage d’un lot inchangé quand aucune entreprise n’est envoyée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'e');
    const res = await request(app).put('/api/lots/la-lot-e').set(authHeader(token)).send({ lot_title: 'Maçonnerie' });
    expect(res.status).toBe(200);
    expect(lot('e')).toMatchObject({ lot_title: 'Maçonnerie' });
    expect(lot('e').contact_id ?? null).toBeNull();
  });
});
