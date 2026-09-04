// Couverture bout en bout des routes BPU/DQE et de la bibliothèque de prix,
// sur le modèle de tests/phase7Batch2.test.ts : l'isolation entre cabinets
// passe par tenantScopedFrom, on la vérifie à travers l'application réelle.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

const documentType = (titre = 'BPU') => ({
  id: 'new', projectId: 'p1', titre, version: '1.0',
  dateCreation: '2026-01-01', statut: 'draft',
  marche: { typeMarche: 'bons_de_commande' }, tranches: [], lots: [],
  prixEnLettres: false, totalHT: 0, TVA: 20, totalTTC: 0,
});

describe('BPU — document', () => {
  it('rend null tant que le projet n’a pas de bordereau', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).get('/api/projects/p-vide/bpu').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('crée puis met à jour le document du projet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const create = await request(app).put('/api/projects/p1/bpu')
      .set(authHeader(token)).send({ document: documentType() });
    expect(create.status).toBe(201);
    expect(create.body.tenant_id).toBe(tenantId);
    expect(create.body.document.titre).toBe('BPU');
    // Les offres démarrent à vide, dans leur colonne propre.
    expect(create.body.offres).toEqual([]);

    const update = await request(app).put('/api/projects/p1/bpu')
      .set(authHeader(token)).send({ document: documentType('BPU révisé') });
    expect(update.status).toBe(200);
    expect(update.body.document.titre).toBe('BPU révisé');
    expect(fakeSupabaseAdmin.getTable('bpu_data').filter(r => r.project_id === 'p1')).toHaveLength(1);
  });

  it('refuse un corps de requête sans document', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).put('/api/projects/p1/bpu').set(authHeader(token)).send({ titre: 'oups' });
    expect(res.status).toBe(400);
  });

  it('n’écrase pas les offres en enregistrant le document', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('bpu_data', [{
      id: 'row1', tenant_id: tenantId, project_id: 'p9',
      document: documentType(), offres: [{ id: 'o1', entrepriseNom: 'Untel', prix: { a1: 100 } }],
    }]);

    await request(app).put('/api/projects/p9/bpu')
      .set(authHeader(token)).send({ document: documentType('v2') });

    const row = fakeSupabaseAdmin.getTable('bpu_data').find(r => r.id === 'row1');
    expect(row.document.titre).toBe('v2');
    // C'est la raison d'être des deux colonnes : la sauvegarde du document
    // ne doit pas emporter une offre importée entre-temps.
    expect(row.offres).toHaveLength(1);
    expect(row.offres[0].id).toBe('o1');
  });

  it('ne laisse jamais un cabinet lire ou modifier le bordereau d’un autre', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('bpu_data', [{
      id: 'row-b', tenant_id: tenantB, project_id: 'p-b',
      document: documentType('SECRET-BPU-B'), offres: [],
    }]);

    const { token } = makeUser(makeTenant());

    const lecture = await request(app).get('/api/projects/p-b/bpu').set(authHeader(token));
    expect(lecture.body).toBeNull();

    await request(app).put('/api/projects/p-b/bpu')
      .set(authHeader(token)).send({ document: documentType('Piraté') });

    const rowB = fakeSupabaseAdmin.getTable('bpu_data').find(r => r.id === 'row-b');
    expect(rowB.document.titre).toBe('SECRET-BPU-B');
  });
});

describe('BPU — offres reçues', () => {
  const seedBpu = (tenantId: string, projectId = 'po') => {
    fakeSupabaseAdmin.seed('bpu_data', [{
      id: `row-${projectId}`, tenant_id: tenantId, project_id: projectId,
      document: documentType(), offres: [],
    }]);
  };

  it('ajoute, modifie puis supprime une offre', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedBpu(tenantId);

    const ajout = await request(app).post('/api/projects/po/bpu/offres')
      .set(authHeader(token))
      .send({ offre: { entrepriseNom: 'Bâti Nancy', prix: { a1: 120 }, statut: 'validee' } });
    expect(ajout.status).toBe(201);
    expect(ajout.body.id).toBeTruthy();
    expect(ajout.body.importedAt).toBeTruthy();

    const liste = await request(app).get('/api/projects/po/bpu/offres').set(authHeader(token));
    expect(liste.body).toHaveLength(1);

    const maj = await request(app).put(`/api/projects/po/bpu/offres/${ajout.body.id}`)
      .set(authHeader(token)).send({ statut: 'ecartee', motifEcart: 'Offre incomplète', id: 'tentative-de-deplacement' });
    expect(maj.status).toBe(200);
    expect(maj.body.statut).toBe('ecartee');
    // L'identifiant vient de l'URL : le corps ne peut pas le changer.
    expect(maj.body.id).toBe(ajout.body.id);

    const suppr = await request(app).delete(`/api/projects/po/bpu/offres/${ajout.body.id}`).set(authHeader(token));
    expect(suppr.status).toBe(200);
    expect((await request(app).get('/api/projects/po/bpu/offres').set(authHeader(token))).body).toHaveLength(0);
  });

  it('refuse d’ajouter une offre à un projet sans bordereau', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/projects/p-inexistant/bpu/offres')
      .set(authHeader(token)).send({ offre: { entrepriseNom: 'X', prix: {} } });
    expect(res.status).toBe(404);
  });

  it('ne laisse pas un cabinet toucher aux offres d’un autre', async () => {
    const tenantB = makeTenant();
    seedBpu(tenantB, 'p-secret');
    fakeSupabaseAdmin.getTable('bpu_data').find(r => r.project_id === 'p-secret').offres = [
      { id: 'o-secret', entrepriseNom: 'Concurrent', prix: { a1: 999 } },
    ];

    const { token } = makeUser(makeTenant());
    const res = await request(app).get('/api/projects/p-secret/bpu/offres').set(authHeader(token));
    expect(res.body).toEqual([]);

    await request(app).delete('/api/projects/p-secret/bpu/offres/o-secret').set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('bpu_data').find(r => r.project_id === 'p-secret').offres).toHaveLength(1);
  });
});

describe('Bibliothèque de prix', () => {
  it('crée les articles nouveaux et met à jour ceux déjà connus', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const first = await request(app).post('/api/price-library/bulk').set(authHeader(token)).send({
      items: [
        { designation: 'Béton de propreté', unite: 'm3', prix_unitaire: 100 },
        { designation: 'Semelle filante', unite: 'ml', prix_unitaire: 55 },
      ],
    });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ created: 2, updated: 0 });

    // Même désignation et même unité : c'est un prix à réactualiser, pas un
    // second article. Sans ce dédoublonnage la bibliothèque se remplit de
    // quasi-doublons.
    const second = await request(app).post('/api/price-library/bulk').set(authHeader(token)).send({
      items: [
        { designation: 'Béton de propreté', unite: 'm3', prix_unitaire: 118 },
        { designation: 'Coffrage', unite: 'm2', prix_unitaire: 30 },
      ],
    });
    expect(second.body).toEqual({ created: 1, updated: 1 });

    const rows = fakeSupabaseAdmin.getTable('articles_type').filter(r => r.tenant_id === tenantId);
    expect(rows).toHaveLength(3);
    const beton = rows.find(r => r.designation === 'Béton de propreté');
    expect(beton.prix_unitaire).toBe(118);
    expect(beton.usage_count).toBe(2);
  });

  it('ignore les doublons présents dans un même envoi', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/price-library/bulk').set(authHeader(token)).send({
      items: [
        { designation: 'Enduit', unite: 'm2', prix_unitaire: 20 },
        { designation: 'ENDUIT', unite: 'M2', prix_unitaire: 25 },
      ],
    });
    expect(res.body).toEqual({ created: 1, updated: 0 });
  });

  it('écarte les articles sans désignation et refuse les envois démesurés', async () => {
    const { token } = makeUser(makeTenant());

    const vide = await request(app).post('/api/price-library/bulk').set(authHeader(token))
      .send({ items: [{ designation: '   ', unite: 'm2', prix_unitaire: 10 }] });
    expect(vide.body).toEqual({ created: 0, updated: 0 });

    const trop = await request(app).post('/api/price-library/bulk').set(authHeader(token))
      .send({ items: Array.from({ length: 501 }, (_, i) => ({ designation: `A${i}`, unite: 'u', prix_unitaire: 1 })) });
    expect(trop.status).toBe(400);
  });

  it('ne rend que les articles du cabinet appelant', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('articles_type', [
      { id: 'x1', tenant_id: tenantB, designation: 'Article confidentiel', unite: 'u', prix_unitaire: 1 },
    ]);

    const { token } = makeUser(makeTenant());
    const res = await request(app).get('/api/price-library').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);

    await request(app).delete('/api/price-library/x1').set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('articles_type').find(r => r.id === 'x1')).toBeDefined();
  });
});
