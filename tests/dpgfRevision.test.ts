// Révision du document CCTP / DPGF : l'éditeur PRO réécrit tout le document à chaque
// sauvegarde ; la révision (colonne dpgfs.revision, incrémentée par un déclencheur SQL que
// l'émulateur de test reproduit) lui permet de savoir que le document stocké a changé depuis
// qu'il l'a lu (approbation d'une proposition, agent IA, autre onglet) au lieu de l'écraser.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

const doc = (titre = 'DPGF') => ({
  id: 'dpgf-rev', projectId: 'p-rev', titre, version: '1.0', dateCreation: '2026-01-01',
  statut: 'draft', totalHT: 0, TVA: 20, totalTTC: 0, lots: [],
});

function seed(tenantId: string, projectId: string, titre = 'DPGF') {
  fakeSupabaseAdmin.seed('dpgfs', [{
    id: `dpgf-${projectId}`, tenant_id: tenantId, project_id: projectId,
    data: JSON.stringify({ ...doc(titre), projectId }), offres: [],
  }]);
}

const stored = (projectId: string) => fakeSupabaseAdmin.getTable('dpgfs').find(r => r.project_id === projectId)!;

describe('DPGF : révision du document', () => {
  it('la lecture rend la révision courante, hors du document enregistré', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-rev-get');

    const read = await request(app).get('/api/projects/p-rev-get/dpgf').set(authHeader(token));
    expect(read.status).toBe(200);
    expect(read.body._rev).toBe(0);
    expect(read.body.titre).toBe('DPGF');
    expect(JSON.parse(stored('p-rev-get').data)._rev).toBeUndefined();
  });

  it('une sauvegarde faite sur la révision lue réussit et rend la nouvelle révision', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-rev-ok');

    const save = await request(app).post('/api/projects/p-rev-ok/dpgf?baseRev=0')
      .set(authHeader(token)).send({ ...doc('DPGF modifié'), id: 'dpgf-p-rev-ok', projectId: 'p-rev-ok', _rev: 0 });
    expect(save.status).toBe(200);
    expect(save.body._rev).toBe(1);
    expect(JSON.parse(stored('p-rev-ok').data).titre).toBe('DPGF modifié');
    // La révision n'est jamais écrite dans le document lui-même.
    expect(JSON.parse(stored('p-rev-ok').data)._rev).toBeUndefined();
    expect(stored('p-rev-ok').revision).toBe(1);
  });

  it('une sauvegarde sur une révision périmée est refusée et n\'écrase rien', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-rev-stale');
    // Un autre écrivain (approbation, agent, autre onglet) change le document : révision 1.
    const row = stored('p-rev-stale');
    row.data = JSON.stringify({ ...doc('Modifié ailleurs'), projectId: 'p-rev-stale' });
    row.revision = 1;
    const avant = row.data;

    const save = await request(app).post('/api/projects/p-rev-stale/dpgf?baseRev=0')
      .set(authHeader(token)).send({ ...doc('Version périmée'), id: 'dpgf-p-rev-stale', projectId: 'p-rev-stale' });
    expect(save.status).toBe(409);
    expect(save.body.code).toBe('DOC_STALE');
    expect(stored('p-rev-stale').data).toBe(avant);
    expect(stored('p-rev-stale').revision).toBe(1);
  });

  it('deux sauvegardes sur la même révision : la seconde est refusée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-rev-two');

    const first = await request(app).post('/api/projects/p-rev-two/dpgf?baseRev=0')
      .set(authHeader(token)).send({ ...doc('Premier onglet'), id: 'dpgf-p-rev-two', projectId: 'p-rev-two' });
    const second = await request(app).post('/api/projects/p-rev-two/dpgf?baseRev=0')
      .set(authHeader(token)).send({ ...doc('Second onglet'), id: 'dpgf-p-rev-two', projectId: 'p-rev-two' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(JSON.parse(stored('p-rev-two').data).titre).toBe('Premier onglet');
  });

  it('une sauvegarde sans révision garde le comportement d\'avant (autres appelants)', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-rev-legacy');

    const save = await request(app).post('/api/projects/p-rev-legacy/dpgf')
      .set(authHeader(token)).send({ ...doc('Sans révision'), id: 'dpgf-p-rev-legacy', projectId: 'p-rev-legacy' });
    expect(save.status).toBe(200);
    expect(JSON.parse(stored('p-rev-legacy').data).titre).toBe('Sans révision');
  });

  it('une révision illisible est refusée sans rien écrire', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-rev-bad');
    const avant = stored('p-rev-bad').data;

    const save = await request(app).post('/api/projects/p-rev-bad/dpgf?baseRev=abc')
      .set(authHeader(token)).send({ ...doc('X'), id: 'dpgf-p-rev-bad', projectId: 'p-rev-bad' });
    expect(save.status).toBe(400);
    expect(stored('p-rev-bad').data).toBe(avant);
  });

  it('un instantané peut conserver la version locale de l\'éditeur, sans toucher au document stocké', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-rev-snap', 'Version stockée');
    const avant = stored('p-rev-snap').data;

    const local = { ...doc('Mes modifications non enregistrées'), projectId: 'p-rev-snap', lots: [{ id: 'l1', numero: '01', titre: 'Lot', chapitres: [] }], _rev: 0 };
    const snap = await request(app).post('/api/projects/p-rev-snap/dpgf/versions')
      .set(authHeader(token)).send({ label: 'Mes modifications non enregistrées', document: local });
    expect(snap.status).toBe(201);
    expect(snap.body.document.titre).toBe('Mes modifications non enregistrées');
    expect(snap.body.document._rev).toBeUndefined();
    expect(stored('p-rev-snap').data).toBe(avant);
  });

  it('un instantané sans document garde le comportement d\'avant : le document stocké', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-rev-snap2', 'Version stockée');

    const snap = await request(app).post('/api/projects/p-rev-snap2/dpgf/versions')
      .set(authHeader(token)).send({ label: 'Avant remplacement' });
    expect(snap.status).toBe(201);
    expect(snap.body.document.titre).toBe('Version stockée');
  });

  it('un instantané refuse un document qui n\'est pas un DPGF', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-rev-snap3');

    const snap = await request(app).post('/api/projects/p-rev-snap3/dpgf/versions')
      .set(authHeader(token)).send({ label: 'X', document: { titre: 'sans lots' } });
    expect(snap.status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('dpgf_versions').filter(v => v.project_id === 'p-rev-snap3')).toHaveLength(0);
  });

  it('la création d\'un document rend la révision 0', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const create = await request(app).post('/api/projects/p-rev-new/dpgf')
      .set(authHeader(token)).send({ ...doc('Nouveau'), id: 'new', projectId: 'p-rev-new' });
    expect(create.status).toBe(200);
    expect(create.body._rev).toBe(0);
  });
});
