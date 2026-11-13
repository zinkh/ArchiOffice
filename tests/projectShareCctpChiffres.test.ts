// Chiffres dans la vue CCTP d'un confrère. Le CCTP et le DPGF sont un seul document et un seul droit par lot :
// sur un lot accordé, la vue CCTP porte la quantité, le prix unitaire, le montant et le métré de chaque article,
// pour qu'il les consulte et les propose depuis le CCTP. Jamais un champ interne, jamais un article réservé au
// CCTP, jamais un autre lot. Prix synthétiques.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { guestDocumentView } from '../server/projectShares/documentView';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const PRIX_TOTAL = 424242.42;

function makeDocument(lotA: string, lotB: string) {
  return {
    id: 'doc-q', projectId: 'p', titre: 'CCTP Villa', version: 'V1', dateCreation: '2026-10-01', statut: 'draft', totalHT: 777777, TVA: 20, totalTTC: 933332,
    lots: [
      {
        id: 'lot-a', numero: '01', titre: 'Gros œuvre', projectLotId: lotA, marqueur: { statut: 'incomplet' },
        chapitres: [{
          id: 'chap-a1', numero: '1', titre: 'Fondations', lignes: [
            {
              id: 'lig-a1', numero: '1.1', designation: 'Semelles', unite: 'm3', quantite: 27.6, prixUnitaire: 100, prixTotal: PRIX_TOTAL, type: 'ouvrage', cctpDescription: 'Béton',
              articleTypeId: 'bibliotheque-secrete', genereParIa: 'llm', marqueur: { statut: 'en_cours' }, quantiteFormule: '=10+20',
              quantiteDetails: [
                { id: 'q1', libelle: 'Façade Est', expression: '10', quantite: 10, note: 'note interne', batimentId: 'DX', phaseId: 'phase-secret' },
                { id: 'q2', libelle: 'Façade Ouest', expression: '=4*5', quantite: 20 },
                { id: 'q3', niveau: 'R+1', local: 'Chambre 2', quantite: -2.4 },
              ],
            },
            { id: 'lig-pm', numero: '1.2', designation: 'Option drainage', unite: 'ml', quantite: 0, prixUnitaire: 0, prixTotal: 0, pourMemoire: true, type: 'ouvrage', cctpDescription: 'Drain' },
            {
              id: 'lig-seul', numero: '1.3', designation: 'Texte seul', unite: '', quantite: 7, prixUnitaire: 31337, prixTotal: 31337, type: 'commentaire', cctpOnly: true, cctpDescription: 'Prescription',
              children: [{ id: 'lig-seul-enfant', numero: '1.3.1', designation: 'Sous-texte', unite: 'u', quantite: 5, prixUnitaire: 27182, prixTotal: 27182, type: 'ouvrage' }],
            },
          ],
        }],
      },
      {
        id: 'lot-b', numero: '02', titre: 'Charpente', projectLotId: lotB,
        chapitres: [{ id: 'chap-b1', numero: '1', titre: 'Fermes', lignes: [{ id: 'lig-b1', numero: '1.1', designation: 'Fermettes', unite: 'u', quantite: 30, prixUnitaire: 500, prixTotal: 15000, type: 'ouvrage', cctpDescription: 'Bois' }] }],
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

const view = (token: string, projectId: string, mode: 'cctp' | 'dpgf') => request(app).get(`/api/shared/projects/${projectId}/${mode}`).set(authHeader(token));
const lignes = (v: any, lotIndex = 0) => v.lots[lotIndex].chapitres[0].lignes as any[];

describe('vue CCTP : chiffres, fonctions pures', () => {
  const doc = makeDocument('A', 'B');

  it('sans lot « chiffres », la vue CCTP n\'en porte aucun (comportement d\'avant)', () => {
    const json = JSON.stringify(guestDocumentView(doc, 'cctp', new Set(['A', 'B'])));
    for (const champ of ['quantite', 'prixUnitaire', 'prixTotal', 'quantiteDetails']) expect(json, champ).not.toContain(champ);
  });

  it('porte quantité, prix, montant et métré sur les lots demandés, avec les seuls champs autorisés', () => {
    const v = guestDocumentView(doc, 'cctp', new Set(['A', 'B']), new Set(['A']));
    const a1 = lignes(v, 0).find(l => l.id === 'lig-a1');
    expect(a1).toMatchObject({ quantite: 27.6, prixUnitaire: 100, prixTotal: PRIX_TOTAL, unite: 'm3' });
    expect(a1.quantiteDetails).toEqual([
      { id: 'q1', libelle: 'Façade Est', expression: '10', quantite: 10, niveau: null, local: null }, // pas de bâtiment : l'article n'est pas réparti par bâtiment
      { id: 'q2', libelle: 'Façade Ouest', expression: '=4*5', quantite: 20, niveau: null, local: null },
      { id: 'q3', libelle: null, expression: null, quantite: -2.4, niveau: 'R+1', local: 'Chambre 2' },
    ]);
    expect(lignes(v, 0).find(l => l.id === 'lig-pm')).toMatchObject({ quantite: 0, pourMemoire: true, prixUnitaire: 0 });
    expect(lignes(v, 1)[0]).not.toHaveProperty('prixUnitaire'); // lot B : non demandé
    expect(lignes(v, 1)[0]).not.toHaveProperty('quantite');
  });

  it('ne laisse fuir aucun champ interne, ni totaux du document', () => {
    const json = JSON.stringify(guestDocumentView(doc, 'cctp', new Set(['A']), new Set(['A'])));
    for (const interne of ['bibliotheque-secrete', 'llm', 'note interne', 'phase-secret', 'marqueur', 'incomplet', '=10+20', 'totalHT', '777777', 'quantiteFormule', 'articleTypeId']) {
      expect(json, interne).not.toContain(interne);
    }
  });

  it('un article réservé au CCTP, et ce qu\'il contient, n\'expose aucun chiffre', () => {
    const v = guestDocumentView(doc, 'cctp', new Set(['A']), new Set(['A']));
    const seul = lignes(v, 0).find(l => l.id === 'lig-seul');
    for (const champ of ['quantite', 'prixUnitaire', 'prixTotal', 'quantiteDetails']) expect(seul, champ).not.toHaveProperty(champ);
    for (const champ of ['quantite', 'prixUnitaire', 'prixTotal']) expect(seul.children[0], champ).not.toHaveProperty(champ);
    expect(JSON.stringify(v)).not.toContain('31337');
    expect(JSON.stringify(v)).not.toContain('27182');
  });

  it('un lot « chiffres » qui n\'est pas dans les lots lus n\'ajoute rien', () => {
    const v = guestDocumentView(doc, 'cctp', new Set(['A']), new Set(['B']));
    expect(v.lots).toHaveLength(1);
    expect(JSON.stringify(v)).not.toContain('prixUnitaire');
  });

  it('la vue DPGF porte aussi le métré, avec les mêmes champs autorisés, et ignore le paramètre', () => {
    const avec = guestDocumentView(doc, 'dpgf', new Set(['A']), new Set(['A']));
    const sans = guestDocumentView(doc, 'dpgf', new Set(['A']));
    expect(avec).toEqual(sans);
    const a1 = lignes(sans, 0).find(l => l.id === 'lig-a1');
    expect(a1.quantiteDetails).toHaveLength(3);
    expect(JSON.stringify(sans)).not.toContain('note interne');
    expect(JSON.stringify(sans)).not.toContain('phase-secret');
  });
});

describe('vue CCTP : chiffres et droit par atelier', () => {
  it('avec les ateliers CCTP et DPGF, la vue CCTP porte les chiffres de tous les lots', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'read' }, { kind: 'dpgf', access: 'read' }]);
    const res = await view(guest.token, projectId, 'cctp');
    expect(res.status).toBe(200);
    expect(res.body.lots).toHaveLength(2);
    expect(lignes(res.body)[0]).toMatchObject({ id: 'lig-a1', quantite: 27.6, prixUnitaire: 100, prixTotal: PRIX_TOTAL });
    expect(JSON.stringify(res.body)).not.toContain('totalHT');
  });

  it('un droit sur le DPGF seul n\'ouvre pas le CCTP : deux ateliers distincts', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'read' }]);
    expect((await view(guest.token, projectId, 'cctp')).status).toBe(403);
    expect((await view(guest.token, projectId, 'dpgf')).status).toBe(200);
  });

  it('sans l\'atelier DPGF, la vue CCTP ne porte aucun chiffre', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'read' }]);
    const res = await view(guest.token, projectId, 'cctp');
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('"prixUnitaire"');
    expect(raw).not.toContain('"prixTotal"');
    expect(raw).not.toContain('Semelles' + 'Prix');
  });
});

describe('proposer des chiffres depuis le CCTP', () => {
  const propose = (token: string, projectId: string, body: any) =>
    request(app).post(`/api/shared/projects/${projectId}/proposals`).set(authHeader(token)).send(body);

  it('le droit d\'écriture sur le lot suffit : quantité et prix, que le droit ait été donné côté CCTP ou DPGF', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write' }, { kind: 'dpgf', access: 'write' }]);
    const prix = await propose(guest.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-pm', field: 'prixUnitaire', value: '52' });
    expect(prix.status, JSON.stringify(prix.body)).toBe(201);
    expect(prix.body).toMatchObject({ field: 'prixUnitaire', baseValue: '0', proposedValue: '52', status: 'pending' });
  });

  it('refusé en lecture ou en commentaire', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    const res = await propose(guest.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-pm', field: 'prixUnitaire', value: '52' });
    expect(res.status).toBe(403);
  });

  it('refusé pour un article réservé au CCTP, même avec le droit d\'écriture', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write' }, { kind: 'dpgf', access: 'write' }]);
    const res = await propose(guest.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-seul', field: 'prixUnitaire', value: '9' });
    expect(res.status).toBe(404);
  });

  it('un prix se propose sur un article qui a un métré ; sa quantité, elle, se modifie par le métré', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write' }, { kind: 'dpgf', access: 'write' }]);
    const prix = await propose(guest.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-a1', field: 'prixUnitaire', value: '110' });
    expect(prix.status, JSON.stringify(prix.body)).toBe(201);
    const quantite = await propose(guest.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-a1', field: 'quantite', value: '30' });
    expect(quantite.status).toBe(400);
    expect(quantite.body.code).toBe('PROPOSAL_NOT_ALLOWED');
  });
});
