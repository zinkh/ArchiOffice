// Bibliothèque d'ouvrages : une ligne créée dans un document n'y entre d'elle-même que si elle est renseignée.
// Avant, chaque ligne créée (« Nouvel article », copie, génération) y partait à zéro, sans unité : articles vides.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { lignesPourBibliotheque } from '../src/components/pro/treeOps';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const bulk = (token: string, items: unknown[]) => request(app).post('/api/price-library/bulk').set(authHeader(token)).send({ items });

describe('lignesPourBibliotheque (côté écran)', () => {
  it('ne garde que les lignes avec une vraie désignation et un prix ou une unité', () => {
    const lignes = [
      { designation: 'Nouvel article', unite: 'm²', prixUnitaire: 12 },
      { designation: '  nouvel ouvrage ', unite: '', prixUnitaire: 5 },
      { designation: '', unite: 'm²', prixUnitaire: 5 },
      { designation: 'Enduit', unite: '', prixUnitaire: 0 },
      { designation: 'Enduit', unite: 'm²', prixUnitaire: 0 },
      { designation: 'Peinture', unite: '', prixUnitaire: 18 },
    ];
    expect(lignesPourBibliotheque(lignes).map(l => `${l.designation}|${l.unite}|${l.prixUnitaire}`)).toEqual(['Enduit|m²|0', 'Peinture||18']);
  });
});

describe('POST /api/price-library/bulk : brouillons', () => {
  it('écarte une création automatique sans prix, sans unité ni description, ou à la désignation par défaut', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await bulk(token, [
      { designation: 'Enduit vide' },
      { designation: 'Nouvel article', unite: 'm²', prix_unitaire: 10 },
      { designation: 'Enduit', unite: 'm²', prix_unitaire: 20 },
      { designation: 'Texte décrit', description: 'Prescription' },
    ]);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: 2, updated: 0, ecartes: 2 });
    const noms = fakeSupabaseAdmin.getTable('articles_type').filter((r: any) => r.tenant_id === tenantId).map((r: any) => r.designation).sort();
    expect(noms).toEqual(['Enduit', 'Texte décrit']);
  });

  it('un envoi explicite (geste de l\'utilisateur) garde l\'article même sans prix ni unité', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await bulk(token, [{ designation: 'À chiffrer', explicite: true }]);
    expect(res.body).toMatchObject({ created: 1 });
    expect(res.body).not.toHaveProperty('ecartes');
    expect(fakeSupabaseAdmin.getTable('articles_type').filter((r: any) => r.tenant_id === tenantId).map((r: any) => r.designation)).toEqual(['À chiffrer']);
  });
});

describe('PUT /api/price-library/:id : désignation', () => {
  it('refuse d\'effacer la désignation', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('articles_type', [{ id: 'a1', tenant_id: tenantId, designation: 'Mur', unite: 'm²', prix_unitaire: 5, usage_count: 0 }]);
    const res = await request(app).put('/api/price-library/a1').set(authHeader(token)).send({ designation: '   ', unite: 'm²', prix_unitaire: 5 });
    expect(res.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('articles_type').find((r: any) => r.id === 'a1')!.designation).toBe('Mur');
  });
});
