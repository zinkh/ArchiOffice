// Reprise des observations de la DET en réserves de l'AOR (OPR) : l'observation
// reste en place et pointe vers sa réserve ; jamais de doublon, jamais de reprise
// d'une observation déjà réglée, jamais d'accès à un autre cabinet.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { reserveTitleFromObservation, TITLE_MAX_LENGTH } from '../server/observationToReserve';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

function seedProject(tenantId: string, projectId: string) {
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'IUT DE METZ' }]);
  fakeSupabaseAdmin.seed('project_lots', [
    { id: `${projectId}-lot-1`, tenant_id: tenantId, project_id: projectId, lot_number: '01', lot_title: 'GROS-OEUVRE', contact_name: 'Maçonnerie Metz' },
  ]);
}

function seedObservation(tenantId: string, projectId: string, over: Record<string, any>) {
  fakeSupabaseAdmin.seed('observations', [{
    tenant_id: tenantId, project_id: projectId, texte: 'Remonter les cloisons', statut: 'À faire', type: 'reserve',
    urgence: 'normal', photos: [], ...over,
  }]);
}

describe('reserveTitleFromObservation', () => {
  it('prend la première ligne et borne la longueur', () => {
    expect(reserveTitleFromObservation('Poncer le mur\nRepasser une couche')).toBe('Poncer le mur');
    expect(reserveTitleFromObservation('x'.repeat(300))).toHaveLength(TITLE_MAX_LENGTH);
    expect(reserveTitleFromObservation('  ')).toBe('Observation de la DET');
  });
});

describe('POST /api/observations/:id/to-reserve', () => {
  it('crée la réserve avec le lot et l\'entreprise, et garde le lien sur l\'observation', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'p-1');
    seedObservation(tenantId, 'p-1', { id: 'obs-1', number: 3, lot_id: 'p-1-lot-1', due_date: '2026-11-01' });

    const res = await request(app).post('/api/observations/obs-1/to-reserve').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.number).toBe(1);

    const reserve = fakeSupabaseAdmin.getTable('reserves').find(r => r.id === res.body.reserve_id);
    expect(reserve).toMatchObject({ project_id: 'p-1', title: 'Remonter les cloisons', status: 'A faire', due_date: '2026-11-01', number: 1 });
    expect(JSON.parse(reserve!.lots)).toEqual(['GROS-OEUVRE']);
    expect(JSON.parse(reserve!.entreprises)).toEqual(['Maçonnerie Metz']);
    expect(reserve!.description).toContain("observation de la DET n° 3");
    expect(fakeSupabaseAdmin.getTable('observations').find(o => o.id === 'obs-1')?.reserve_id).toBe(res.body.reserve_id);
  });

  it('refuse une seconde reprise et une observation levée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'p-2');
    seedObservation(tenantId, 'p-2', { id: 'obs-a', number: 1 });
    seedObservation(tenantId, 'p-2', { id: 'obs-b', number: 2, statut: 'Levée' });

    expect((await request(app).post('/api/observations/obs-a/to-reserve').set(authHeader(token))).status).toBe(200);
    expect((await request(app).post('/api/observations/obs-a/to-reserve').set(authHeader(token))).status).toBe(409);
    expect((await request(app).post('/api/observations/obs-b/to-reserve').set(authHeader(token))).status).toBe(400);
    expect(fakeSupabaseAdmin.getTable('reserves').filter(r => r.project_id === 'p-2')).toHaveLength(1);
  });

  it('ne touche jamais l\'observation d\'un autre cabinet', async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant();
    const { token } = makeUser(tenantA);
    seedProject(tenantB, 'p-b');
    seedObservation(tenantB, 'p-b', { id: 'obs-b1', number: 1 });

    const res = await request(app).post('/api/observations/obs-b1/to-reserve').set(authHeader(token));
    expect(res.status).toBe(404);
    expect(fakeSupabaseAdmin.getTable('reserves').filter(r => r.project_id === 'p-b')).toHaveLength(0);
  });
});

describe('POST /api/projects/:projectId/observations/to-reserves', () => {
  it('reprend toutes les observations à lever restantes, numérotées à la suite des réserves existantes', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'p-3');
    fakeSupabaseAdmin.seed('reserves', [{ id: 'r-existing', tenant_id: tenantId, project_id: 'p-3', title: 'Existante', number: 4 }]);
    seedObservation(tenantId, 'p-3', { id: 'o1', number: 1, texte: 'Première' });
    seedObservation(tenantId, 'p-3', { id: 'o2', number: 2, texte: 'Deuxième' });
    seedObservation(tenantId, 'p-3', { id: 'o3', number: 3, texte: 'Réglée', statut: 'Levée' });
    seedObservation(tenantId, 'p-3', { id: 'o4', number: 4, texte: 'Simple remarque', type: 'observation' });

    const res = await request(app).post('/api/projects/p-3/observations/to-reserves').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.created.map((c: any) => [c.observation_id, c.number])).toEqual([['o1', 5], ['o2', 6]]);

    // Rejouée : plus rien à reprendre, aucun doublon.
    const again = await request(app).post('/api/projects/p-3/observations/to-reserves').set(authHeader(token));
    expect(again.body.created).toEqual([]);
    expect(fakeSupabaseAdmin.getTable('reserves').filter(r => r.project_id === 'p-3')).toHaveLength(3);
  });

  it('expose le numéro de la réserve dans la liste des observations', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    seedProject(tenantId, 'p-4');
    seedObservation(tenantId, 'p-4', { id: 'o-list', number: 1 });
    await request(app).post('/api/observations/o-list/to-reserve').set(authHeader(token));

    const list = await request(app).get('/api/projects/p-4/observations').set(authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({ id: 'o-list', reserve_number: 1 });
  });
});
