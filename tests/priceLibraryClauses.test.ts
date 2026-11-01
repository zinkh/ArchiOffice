// Dossier « Clauses générales » de la bibliothèque : même table, catégorie réservée.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { CATEGORIE_CLAUSES } from '../src/lib/bibliothequeClauses';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('GET /api/price-library : dossiers', () => {
  it('sépare les ouvrages des clauses, et rend tout sans paramètre', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('articles_type', [
      { id: 'a1', tenant_id: tenantId, designation: 'Mur béton', categorie: null, usage_count: 0 },
      { id: 'a2', tenant_id: tenantId, designation: 'Isolation', categorie: 'isolation', usage_count: 0 },
      { id: 'c1', tenant_id: tenantId, designation: 'Prescriptions générales', categorie: CATEGORIE_CLAUSES, usage_count: 0 },
    ]);

    const ouvrages = await request(app).get('/api/price-library').query({ dossier: 'ouvrages' }).set(authHeader(token));
    expect(ouvrages.status).toBe(200);
    expect(ouvrages.body.map((r: any) => r.id).sort()).toEqual(['a1', 'a2']);

    const clauses = await request(app).get('/api/price-library').query({ dossier: 'clauses' }).set(authHeader(token));
    expect(clauses.body.map((r: any) => r.id)).toEqual(['c1']);

    const tout = await request(app).get('/api/price-library').set(authHeader(token));
    expect(tout.body).toHaveLength(3);
  });

  it('refuse un dossier inconnu', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).get('/api/price-library').query({ dossier: 'autre' }).set(authHeader(token));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/price-library : clauses générales', () => {
  it('crée une clause sans prix, puis refuse un doublon de titre', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const body = { designation: 'Conditions d’exécution', categorie: CATEGORIE_CLAUSES, description: 'Texte de la clause' };

    const created = await request(app).post('/api/price-library').set(authHeader(token)).send(body);
    expect(created.status).toBe(201);
    expect(created.body.categorie).toBe(CATEGORIE_CLAUSES);
    expect(created.body.description).toBe('Texte de la clause');

    const doublon = await request(app).post('/api/price-library').set(authHeader(token))
      .send({ ...body, designation: '  conditions d’EXECUTION ' });
    expect(doublon.status).toBe(409);
    expect(doublon.body.existing_id).toBe(created.body.id);
  });

  it('ne confond pas deux cabinets, ni une clause avec un ouvrage de même nom', async () => {
    const t1 = makeTenant();
    const t2 = makeTenant();
    const u1 = makeUser(t1);
    const u2 = makeUser(t2);
    const titre = 'Réception des travaux';

    expect((await request(app).post('/api/price-library').set(authHeader(u1.token))
      .send({ designation: titre, categorie: CATEGORIE_CLAUSES })).status).toBe(201);
    expect((await request(app).post('/api/price-library').set(authHeader(u2.token))
      .send({ designation: titre, categorie: CATEGORIE_CLAUSES })).status).toBe(201);
    // Un ouvrage du même nom n'est pas une clause : pas de blocage.
    expect((await request(app).post('/api/price-library').set(authHeader(u1.token))
      .send({ designation: titre, unite: 'ens', prix_unitaire: 10 })).status).toBe(201);
  });
});

describe('GET /api/price-library/repartition', () => {
  it('compte les clauses à part du total d’ouvrages', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('articles_type', [
      { id: 'r1', tenant_id: tenantId, designation: 'Mur', categorie: null, origine: 'saisie' },
      { id: 'r2', tenant_id: tenantId, designation: 'Clause', categorie: CATEGORIE_CLAUSES, origine: 'saisie' },
      { id: 'r3', tenant_id: tenantId, designation: 'Clause 2', categorie: CATEGORIE_CLAUSES, origine: 'saisie' },
    ]);
    const res = await request(app).get('/api/price-library/repartition').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.clauses).toBe(2);
  });
});
