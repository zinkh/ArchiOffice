// Couverture des routes DPGF ajoutées dans cette PR : les offres reçues, sur
// le modèle de tests/bpuRoutes.test.ts pour le BPU, et la remontée des prix
// vers la bibliothèque d'ouvrages qu'un import d'offre déclenche désormais
// aussi côté DPGF (server/articlePrices.ts, sourceKind: 'dpgf').
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function ligne(table: string, predicate: (r: any) => boolean): any {
  const found = fakeSupabaseAdmin.getTable(table).find(predicate);
  if (!found) throw new Error(`Aucune ligne de ${table} ne correspond`);
  return found;
}

/** Un DPGF avec une ligne rattachée à un article de bibliothèque, pour tester la remontée. */
const documentDpgf = (articleTypeId?: string) => ({
  id: 'new', projectId: 'p1', titre: 'DPGF', version: '1.0',
  dateCreation: '2026-01-01', statut: 'draft', totalHT: 0, TVA: 20, totalTTC: 0,
  lots: [{
    id: 'lot1', numero: '01', titre: 'Gros œuvre', sousTotal: 0,
    chapitres: [{
      id: 'c1', numero: '01.1', titre: 'Fondations',
      lignes: [{
        id: 'a1', numero: '01.1.1', designation: 'Béton de propreté', unite: 'm3',
        quantite: 10, prixUnitaire: 100, prixTotal: 1000, type: 'ouvrage', articleTypeId,
      }],
    }],
  }],
});

const seedDpgf = (tenantId: string, projectId = 'p1', articleTypeId?: string) => {
  fakeSupabaseAdmin.seed('dpgfs', [{
    id: `dpgf-${projectId}`, tenant_id: tenantId, project_id: projectId,
    data: JSON.stringify(documentDpgf(articleTypeId)), offres: [],
  }]);
};

describe('DPGF — document', () => {
  it('crée puis met à jour le document du projet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const create = await request(app).post('/api/projects/p2/dpgf')
      .set(authHeader(token)).send(documentDpgf());
    expect(create.status).toBe(200);
    expect(create.body.titre).toBe('DPGF');

    const update = await request(app).post('/api/projects/p2/dpgf')
      .set(authHeader(token)).send({ ...documentDpgf(), id: create.body.id, titre: 'DPGF révisé' });
    expect(update.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('dpgfs').filter(r => r.project_id === 'p2')).toHaveLength(1);

    const read = await request(app).get('/api/projects/p2/dpgf').set(authHeader(token));
    expect(read.body.titre).toBe('DPGF révisé');
  });
});

describe('DPGF — offres reçues', () => {
  it('ajoute, modifie puis supprime une offre', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedDpgf(tenantId);

    const ajout = await request(app).post('/api/projects/p1/dpgf/offres')
      .set(authHeader(token))
      .send({ offre: { entrepriseNom: 'Bâti Nancy', prix: { a1: 120 }, statut: 'validee', documentVersion: '1.0' } });
    expect(ajout.status).toBe(201);
    expect(ajout.body.id).toBeTruthy();
    expect(ajout.body.importedAt).toBeTruthy();

    const liste = await request(app).get('/api/projects/p1/dpgf/offres').set(authHeader(token));
    expect(liste.body).toHaveLength(1);

    const maj = await request(app).put(`/api/projects/p1/dpgf/offres/${ajout.body.id}`)
      .set(authHeader(token)).send({ statut: 'ecartee', motifEcart: 'Offre incomplète', id: 'tentative-de-deplacement' });
    expect(maj.status).toBe(200);
    expect(maj.body.statut).toBe('ecartee');
    // L'identifiant vient de l'URL : le corps ne peut pas le changer.
    expect(maj.body.id).toBe(ajout.body.id);

    const suppr = await request(app).delete(`/api/projects/p1/dpgf/offres/${ajout.body.id}`).set(authHeader(token));
    expect(suppr.status).toBe(200);
    expect((await request(app).get('/api/projects/p1/dpgf/offres').set(authHeader(token))).body).toHaveLength(0);
  });

  it('refuse d’ajouter une offre à un projet sans DPGF', async () => {
    const { token } = makeUser(makeTenant());
    const res = await request(app).post('/api/projects/p-inexistant/dpgf/offres')
      .set(authHeader(token)).send({ offre: { entrepriseNom: 'X', prix: {} } });
    expect(res.status).toBe(404);
  });

  it('ne laisse pas un cabinet toucher aux offres d’un autre', async () => {
    const tenantB = makeTenant();
    seedDpgf(tenantB, 'p-secret');
    ligne('dpgfs', r => r.project_id === 'p-secret').offres = [
      { id: 'o-secret', entrepriseNom: 'Concurrent', prix: { a1: 999 } },
    ];

    const { token } = makeUser(makeTenant());
    const lecture = await request(app).get('/api/projects/p-secret/dpgf/offres').set(authHeader(token));
    expect(lecture.body).toEqual([]);

    await request(app).delete('/api/projects/p-secret/dpgf/offres/o-secret').set(authHeader(token));
    expect(ligne('dpgfs', r => r.project_id === 'p-secret').offres).toHaveLength(1);
  });
});

describe('DPGF — remontée des prix vers la bibliothèque', () => {
  it('verse une observation pour la ligne rattachée à un article, et corrige au lieu de doubler sur réimport', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('articles_type', [{
      id: 'art-1', tenant_id: tenantId, designation: 'Béton de propreté', unite: 'm3',
      prix_unitaire: 100, origine: 'saisie',
    }]);
    seedDpgf(tenantId, 'p1', 'art-1');

    const premier = await request(app).post('/api/projects/p1/dpgf/offres').set(authHeader(token)).send({
      offre: { entrepriseNom: 'Bâti Nancy', prix: { a1: 120 }, statut: 'validee', documentVersion: '1.0' },
    });
    expect(premier.body.prixRemontes).toBe(1);

    const obs = fakeSupabaseAdmin.getTable('article_prix_observations').filter(r => r.tenant_id === tenantId);
    expect(obs).toHaveLength(1);
    expect(obs[0].prix_ht).toBe(120);
    expect(obs[0].source_ref).toBe(`dpgf:${premier.body.id}:a1`);

    // Correction du prix sur la même offre : l'upsert doit rectifier
    // l'observation déjà écrite, pas en ajouter une seconde.
    const correction = await request(app).put(`/api/projects/p1/dpgf/offres/${premier.body.id}`)
      .set(authHeader(token)).send({ prix: { a1: 135 } });
    expect(correction.body.prixRemontes).toBe(1);

    const obsApres = fakeSupabaseAdmin.getTable('article_prix_observations').filter(r => r.tenant_id === tenantId);
    expect(obsApres).toHaveLength(1);
    expect(obsApres[0].prix_ht).toBe(135);
  });

  it('n’écrit rien pour une offre écartée ou un prix non chiffré', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('articles_type', [{
      id: 'art-2', tenant_id: tenantId, designation: 'Béton de propreté', unite: 'm3',
      prix_unitaire: 100, origine: 'saisie',
    }]);
    seedDpgf(tenantId, 'p1', 'art-2');

    const ecartee = await request(app).post('/api/projects/p1/dpgf/offres').set(authHeader(token)).send({
      offre: { entrepriseNom: 'Hors-jeu', prix: { a1: 120 }, statut: 'ecartee', documentVersion: '1.0' },
    });
    expect(ecartee.body.prixRemontes).toBe(0);

    const nonChiffre = await request(app).post('/api/projects/p1/dpgf/offres').set(authHeader(token)).send({
      offre: { entrepriseNom: 'Pour mémoire', prix: { a1: null }, statut: 'validee', documentVersion: '1.0' },
    });
    expect(nonChiffre.body.prixRemontes).toBe(0);

    expect(fakeSupabaseAdmin.getTable('article_prix_observations').filter(r => r.tenant_id === tenantId)).toHaveLength(0);
  });
});
