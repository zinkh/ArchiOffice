// Instantanés automatiques du CCTP / DPGF (toutes les 10 minutes depuis l'éditeur) : le serveur pose le
// libellé, limite la fréquence, ignore un document identique au précédent et élague à 48 sans jamais
// toucher aux versions nommées.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { LABEL_INSTANTANE_AUTO, MAX_INSTANTANES_AUTO } from '../src/lib/instantanes';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const MIN = 60 * 1000;

const doc = (titre: string, projectId: string) => ({
  id: `dpgf-${projectId}`, projectId, titre, version: '1.0', dateCreation: '2026-01-01', statut: 'draft', totalHT: 0, TVA: 20, totalTTC: 0, lots: [],
});

function seed(tenantId: string, projectId: string) {
  fakeSupabaseAdmin.seed('dpgfs', [{
    id: `dpgf-${projectId}`, tenant_id: tenantId, project_id: projectId, data: JSON.stringify(doc('Stocké', projectId)), offres: [],
  }]);
}

function seedVersion(tenantId: string, projectId: string, id: string, label: string, ilYaMinutes: number, document: unknown) {
  fakeSupabaseAdmin.seed('dpgf_versions', [{
    id, tenant_id: tenantId, project_id: projectId, dpgf_id: `dpgf-${projectId}`, label, phase: null, version: '1.0',
    document, created_by: null, created_at: new Date(Date.now() - ilYaMinutes * MIN).toISOString(),
  }]);
}

const versions = (projectId: string) => fakeSupabaseAdmin.getTable('dpgf_versions').filter(v => v.project_id === projectId);
const autos = (projectId: string) => versions(projectId).filter(v => v.label === LABEL_INSTANTANE_AUTO);

describe('POST /api/projects/:id/dpgf/versions avec auto', () => {
  it('fige le document affiché sous le libellé réservé', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-auto-1');

    const res = await request(app).post('/api/projects/p-auto-1/dpgf/versions').set(authHeader(token))
      .send({ auto: true, document: doc('Brouillon à l\'écran', 'p-auto-1') });
    expect(res.status).toBe(201);
    expect(autos('p-auto-1')).toHaveLength(1);
    // C'est le document ENVOYÉ (enregistré ou non) qui est figé, pas celui du serveur.
    expect(autos('p-auto-1')[0].document.titre).toBe('Brouillon à l\'écran');
  });

  it('ne lit jamais le libellé dans la requête', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-auto-2');

    const res = await request(app).post('/api/projects/p-auto-2/dpgf/versions').set(authHeader(token))
      .send({ auto: true, label: 'Mon libellé', document: doc('A', 'p-auto-2') });
    expect(res.status).toBe(201);
    expect(versions('p-auto-2').map(v => v.label)).toEqual([LABEL_INSTANTANE_AUTO]);
  });

  it('réserve le libellé aux instantanés automatiques', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-auto-3');

    const res = await request(app).post('/api/projects/p-auto-3/dpgf/versions').set(authHeader(token))
      .send({ label: LABEL_INSTANTANE_AUTO });
    expect(res.status).toBe(400);
    expect(versions('p-auto-3')).toHaveLength(0);
  });

  it('refuse un second instantané moins de 9 minutes après le précédent', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-auto-4');

    await request(app).post('/api/projects/p-auto-4/dpgf/versions').set(authHeader(token)).send({ auto: true, document: doc('v1', 'p-auto-4') });
    const second = await request(app).post('/api/projects/p-auto-4/dpgf/versions').set(authHeader(token)).send({ auto: true, document: doc('v2', 'p-auto-4') });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ skipped: true, reason: 'too_recent' });
    expect(autos('p-auto-4')).toHaveLength(1);
  });

  it('ignore un document identique au dernier instantané', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-auto-5');
    seedVersion(tenantId, 'p-auto-5', 'ancien', LABEL_INSTANTANE_AUTO, 30, doc('Inchangé', 'p-auto-5'));

    const res = await request(app).post('/api/projects/p-auto-5/dpgf/versions').set(authHeader(token))
      .send({ auto: true, document: doc('Inchangé', 'p-auto-5') });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ skipped: true, reason: 'unchanged' });
    expect(autos('p-auto-5')).toHaveLength(1);
  });

  it('accepte un nouvel instantané 30 minutes après, si le document a changé', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-auto-6');
    seedVersion(tenantId, 'p-auto-6', 'ancien', LABEL_INSTANTANE_AUTO, 30, doc('Avant', 'p-auto-6'));

    const res = await request(app).post('/api/projects/p-auto-6/dpgf/versions').set(authHeader(token))
      .send({ auto: true, document: doc('Après', 'p-auto-6') });
    expect(res.status).toBe(201);
    expect(autos('p-auto-6')).toHaveLength(2);
  });

  it('ne garde que les 48 derniers instantanés automatiques et jamais une version nommée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-auto-7');
    for (let i = 0; i < 50; i += 1) seedVersion(tenantId, 'p-auto-7', `auto-${i}`, LABEL_INSTANTANE_AUTO, 15 + i, doc(`v${i}`, 'p-auto-7'));
    seedVersion(tenantId, 'p-auto-7', 'nommee-1', 'Phase APS', 1000, doc('APS', 'p-auto-7'));
    seedVersion(tenantId, 'p-auto-7', 'nommee-2', 'Mes modifications non enregistrées', 2000, doc('Conflit', 'p-auto-7'));

    const res = await request(app).post('/api/projects/p-auto-7/dpgf/versions').set(authHeader(token))
      .send({ auto: true, document: doc('Nouveau', 'p-auto-7') });
    expect(res.status).toBe(201);

    const restants = autos('p-auto-7');
    expect(restants).toHaveLength(MAX_INSTANTANES_AUTO);
    const ids = restants.map(v => v.id);
    expect(ids).toContain('auto-0');
    expect(ids).not.toContain('auto-49');
    expect(versions('p-auto-7').filter(v => v.label !== LABEL_INSTANTANE_AUTO).map(v => v.id).sort()).toEqual(['nommee-1', 'nommee-2']);
  });

  it('une version nommée n\'est pas freinée par la fréquence', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seed(tenantId, 'p-auto-8');

    const un = await request(app).post('/api/projects/p-auto-8/dpgf/versions').set(authHeader(token)).send({ label: 'Phase APS' });
    const deux = await request(app).post('/api/projects/p-auto-8/dpgf/versions').set(authHeader(token)).send({ label: 'Phase APD' });
    expect([un.status, deux.status]).toEqual([201, 201]);
  });
});
