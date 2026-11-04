// Quantités dans la vue CCTP d'un confrère : il voit et propose la quantité d'un article depuis le CCTP
// seulement sur les lots où il a AUSSI le droit DPGF (là où il voit déjà cette quantité). Jamais de prix,
// jamais pour un article réservé au CCTP, jamais sur un lot sans droit DPGF. Prix synthétiques.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { guestDocumentView } from '../server/projectShares/documentView';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const PRIX_SECRET = 424242.42;

function makeDocument(lotA: string, lotB: string) {
  return {
    id: 'doc-q', projectId: 'p', titre: 'CCTP Villa', version: 'V1', dateCreation: '2026-10-01', statut: 'draft', totalHT: 0, TVA: 20, totalTTC: 0,
    lots: [
      {
        id: 'lot-a', numero: '01', titre: 'Gros œuvre', projectLotId: lotA,
        chapitres: [{
          id: 'chap-a1', numero: '1', titre: 'Fondations', lignes: [
            { id: 'lig-a1', numero: '1.1', designation: 'Semelles', unite: 'm3', quantite: 12, prixUnitaire: 100, prixTotal: PRIX_SECRET, type: 'ouvrage', cctpDescription: 'Béton' },
            { id: 'lig-pm', numero: '1.2', designation: 'Option drainage', unite: 'ml', quantite: 0, prixUnitaire: 0, prixTotal: 0, pourMemoire: true, type: 'ouvrage', cctpDescription: 'Drain' },
            { id: 'lig-seul', numero: '1.3', designation: 'Texte seul', unite: '', quantite: 7, prixUnitaire: 0, prixTotal: 0, type: 'commentaire', cctpOnly: true, cctpDescription: 'Prescription' },
          ],
        }],
      },
      {
        id: 'lot-b', numero: '02', titre: 'Charpente', projectLotId: lotB,
        chapitres: [{ id: 'chap-b1', numero: '1', titre: 'Fermes', lignes: [{ id: 'lig-b1', numero: '1.1', designation: 'Fermettes', unite: 'u', quantite: 30, prixUnitaire: 500, prixTotal: PRIX_SECRET, type: 'ouvrage', cctpDescription: 'Bois' }] }],
      },
    ],
  };
}

function setup() {
  const tenantId = makeTenant();
  const admin = makeUser(tenantId, 'admin');
  const projectId = `${tenantId}-p1`;
  const lotA = `${tenantId}-lotA`;
  const lotB = `${tenantId}-lotB`;
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa Martin', project_code: '26014' }]);
  fakeSupabaseAdmin.seed('project_lots', [
    { id: lotA, tenant_id: tenantId, project_id: projectId, lot_number: '01', lot_title: 'Gros œuvre' },
    { id: lotB, tenant_id: tenantId, project_id: projectId, lot_number: '02', lot_title: 'Charpente' },
  ]);
  fakeSupabaseAdmin.seed('dpgfs', [{ id: `${tenantId}-doc`, tenant_id: tenantId, project_id: projectId, data: JSON.stringify(makeDocument(lotA, lotB)) }]);
  return { tenantId, admin, projectId, lotA, lotB };
}

let seq = 0;
async function inviteGuest(adminToken: string, projectId: string, grants: any[]) {
  seq += 1;
  const email = `confrere-q-${Date.now()}-${seq}@example.test`;
  const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(adminToken)).send({ email, grants });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = `guest-q-token-${res.body.userId}`;
  fakeSupabaseAdmin.registerUser(token, { id: res.body.userId, email });
  return { token };
}

const cctpView = (token: string, projectId: string) => request(app).get(`/api/shared/projects/${projectId}/cctp`).set(authHeader(token));
const lignes = (view: any, lotIndex = 0) => view.lots[lotIndex].chapitres[0].lignes as any[];

describe('vue CCTP : quantité, fonctions pures', () => {
  const doc = makeDocument('A', 'B');

  it('sans lot « quantités », la vue CCTP n\'a aucune quantité (comportement d\'avant)', () => {
    const view = guestDocumentView(doc, 'cctp', new Set(['A', 'B']));
    expect(JSON.stringify(view)).not.toContain('quantite');
  });

  it('ajoute la quantité et le repère « pour mémoire » aux seuls lots demandés, jamais un prix', () => {
    const view = guestDocumentView(doc, 'cctp', new Set(['A', 'B']), new Set(['A']));
    const a = lignes(view, 0);
    expect(a.find(l => l.id === 'lig-a1')).toMatchObject({ quantite: 12, unite: 'm3' });
    expect(a.find(l => l.id === 'lig-pm')).toMatchObject({ quantite: 0, pourMemoire: true });
    expect(lignes(view, 1)[0]).not.toHaveProperty('quantite'); // lot B : pas de droit DPGF
    const json = JSON.stringify(view);
    expect(json).not.toContain('prixUnitaire');
    expect(json).not.toContain('prixTotal');
    expect(json).not.toContain(String(PRIX_SECRET));
  });

  it('un article réservé au CCTP n\'expose jamais de quantité (il n\'existe pas dans le DPGF)', () => {
    const view = guestDocumentView(doc, 'cctp', new Set(['A']), new Set(['A']));
    expect(lignes(view, 0).find(l => l.id === 'lig-seul')).not.toHaveProperty('quantite');
  });

  it('un lot « quantités » qui n\'est pas dans les lots lus n\'ajoute rien', () => {
    const view = guestDocumentView(doc, 'cctp', new Set(['A']), new Set(['B']));
    expect(view.lots).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain('quantite');
  });

  it('la vue DPGF n\'est pas touchée par le paramètre', () => {
    const avec = guestDocumentView(doc, 'dpgf', new Set(['A']), new Set(['A']));
    const sans = guestDocumentView(doc, 'dpgf', new Set(['A']));
    expect(avec).toEqual(sans);
  });
});

describe('vue CCTP : quantité, routes', () => {
  it('un confrère avec CCTP et DPGF sur le lot voit les quantités, pas les prix', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [
      { kind: 'cctp', access: 'read', lotId: lotA }, { kind: 'dpgf', access: 'read', lotId: lotA },
    ]);
    const res = await cctpView(guest.token, projectId);
    expect(res.status).toBe(200);
    expect(lignes(res.body)[0]).toMatchObject({ id: 'lig-a1', quantite: 12 });
    expect(JSON.stringify(res.body)).not.toContain(String(PRIX_SECRET));
    expect(JSON.stringify(res.body)).not.toContain('prixUnitaire');
  });

  it('un confrère avec le seul CCTP ne voit aucune quantité', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'read', lotId: lotA }]);
    const res = await cctpView(guest.token, projectId);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('quantite');
  });

  it('le droit DPGF d\'un AUTRE lot ne donne aucune quantité sur le lot du CCTP', async () => {
    const { admin, projectId, lotA, lotB } = setup();
    const guest = await inviteGuest(admin.token, projectId, [
      { kind: 'cctp', access: 'read', lotId: lotA }, { kind: 'dpgf', access: 'read', lotId: lotB },
    ]);
    const res = await cctpView(guest.token, projectId);
    expect(res.status).toBe(200);
    expect(res.body.lots).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain('quantite');
  });
});

describe('proposer une quantité depuis le CCTP', () => {
  const propose = (token: string, projectId: string, body: any) =>
    request(app).post(`/api/shared/projects/${projectId}/proposals`).set(authHeader(token)).send(body);

  it('accepté avec le droit d\'écriture DPGF du lot', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [
      { kind: 'cctp', access: 'read', lotId: lotA }, { kind: 'dpgf', access: 'write', lotId: lotA },
    ]);
    const res = await propose(guest.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-a1', field: 'quantite', value: '15' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ field: 'quantite', baseValue: '12', proposedValue: '15', status: 'pending' });
  });

  it('refusé avec le seul droit d\'écriture CCTP : la quantité relève du DPGF', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    const res = await propose(guest.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-a1', field: 'quantite', value: '15' });
    expect(res.status).toBe(403);
  });

  it('refusé pour un article réservé au CCTP, même avec le droit DPGF', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [
      { kind: 'cctp', access: 'write', lotId: lotA }, { kind: 'dpgf', access: 'write', lotId: lotA },
    ]);
    const res = await propose(guest.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-seul', field: 'quantite', value: '9' });
    expect(res.status).toBe(404);
  });
});
