// Métré proposé par un confrère sur un article réparti par bâtiment : chaque ligne porte un bâtiment de l'opération,
// le total de chaque bâtiment reste positif ou nul, et l'approbation met à jour les quantités par bâtiment.
// Données synthétiques.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { recomputeLot } from '../src/components/pro/treeOps';
import { guestDocumentView, metreLines } from '../server/projectShares/documentView';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const ligne = (surcharge: Record<string, unknown>) => ({ unite: 'm²', quantite: 0, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', ...surcharge });
const BATIMENTS = [
  { id: 'b1', code: 'DX', libelle: 'Bâtiment X', ordre: 1 },
  { id: 'b2', code: 'DY', libelle: 'Bâtiment Y', ordre: 2 },
];

function makeDocument(lotA: string) {
  const lot = {
    id: 'lot-a', numero: '01', titre: 'Façades', projectLotId: lotA, sousTotal: 0,
    chapitres: [{
      id: 'chap-a1', numero: '1', titre: 'Enduits', lignes: [
        ligne({ id: 'lig-simple', numero: '1.1', designation: 'Simple', quantite: 12, prixUnitaire: 10, prixTotal: 120 }),
        ligne({ id: 'lig-bat', numero: '1.2', designation: 'Par bâtiment', quantite: 3, prixUnitaire: 10, prixTotal: 30, quantitesBatiments: { b1: 3, b2: 0 } }),
        ligne({
          id: 'lig-batm', numero: '1.3', designation: 'Par bâtiment avec métré', quantite: 30, prixUnitaire: 10, prixTotal: 300, quantitesBatiments: { b1: 10, b2: 20 },
          quantiteDetails: [
            { id: 'q1', libelle: 'Façade Est', expression: '10', quantite: 10, batimentId: 'b1', note: 'à vérifier' },
            { id: 'q2', libelle: 'Façade Ouest', expression: '=4*5', quantite: 20, batimentId: 'b2' },
          ],
        }),
      ],
    }],
  };
  return {
    id: 'doc-mb', projectId: 'p', titre: 'DPGF', version: '1', dateCreation: '2026-10-01', statut: 'draft', TVA: 20, totalHT: 0, totalTTC: 0,
    multiBatiments: true, batiments: BATIMENTS, lots: [recomputeLot(lot as any)],
  };
}

function setup() {
  const tenantId = makeTenant();
  const admin = makeUser(tenantId, 'admin');
  const projectId = `${tenantId}-p1`;
  const lotA = `${tenantId}-lotA`;
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa', project_code: '26014' }]);
  fakeSupabaseAdmin.seed('project_lots', [{ id: lotA, tenant_id: tenantId, project_id: projectId, lot_number: '01', lot_title: 'Façades' }]);
  fakeSupabaseAdmin.seed('dpgfs', [{ id: `${tenantId}-doc`, tenant_id: tenantId, project_id: projectId, data: JSON.stringify(makeDocument(lotA)) }]);
  return { tenantId, admin, projectId, lotA };
}

let seq = 0;
async function inviteGuest(adminToken: string, projectId: string, grants: any[]) {
  seq += 1;
  const email = `confrere-mb-${Date.now()}-${seq}@example.test`;
  const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(adminToken)).send({ email, grants });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = `guest-mb-token-${res.body.userId}`;
  fakeSupabaseAdmin.registerUser(token, { id: res.body.userId, email });
  return { token };
}

async function guestEcrivain() {
  const ctx = setup();
  const guest = await inviteGuest(ctx.admin.token, ctx.projectId, [{ kind: 'cctp', access: 'write', lotId: ctx.lotA }]);
  return { ...ctx, guest };
}

const propose = (token: string, projectId: string, body: any) =>
  request(app).post(`/api/shared/projects/${projectId}/proposals`).set(authHeader(token)).send(body);
const approve = (token: string, projectId: string, id: string) =>
  request(app).post(`/api/projects/${projectId}/share-proposals/${id}/approve`).set(authHeader(token));
const metre = (lotId: string, targetId: string, lignes: unknown) => ({ lotId, targetType: 'ligne', targetId, field: 'metre', value: JSON.stringify(lignes) });
const storedDoc = (tenantId: string) => JSON.parse(fakeSupabaseAdmin.getTable('dpgfs').find((d: any) => d.tenant_id === tenantId)!.data);
const noeud = (doc: any, id: string) => doc.lots[0].chapitres[0].lignes.find((l: any) => l.id === id);

describe('vue du confrère : bâtiments', () => {
  it('porte les bâtiments de l\'opération, les quantités par bâtiment et le bâtiment de chaque ligne du métré', () => {
    const doc = makeDocument('A');
    const v = guestDocumentView(doc, 'dpgf', new Set(['A']));
    expect(v.multiBatiments).toBe(true);
    expect(v.batiments).toEqual(BATIMENTS);
    const l = v.lots[0].chapitres[0].lignes.find((x: any) => x.id === 'lig-batm');
    expect(l.quantitesBatiments).toEqual({ b1: 10, b2: 20 });
    expect(l.quantiteDetails.map((d: any) => d.batimentId)).toEqual(['b1', 'b2']);
    expect(JSON.stringify(v)).not.toContain('à vérifier');
  });

  it('sans découpage par bâtiment, aucun bâtiment n\'est exposé', () => {
    const v = guestDocumentView({ ...makeDocument('A'), multiBatiments: false }, 'dpgf', new Set(['A']));
    expect(v).not.toHaveProperty('batiments');
  });

  it('le métré d\'un article par bâtiment porte le bâtiment, celui d\'un autre article non', () => {
    expect(metreLines(makeDocument('A').lots[0].chapitres[0].lignes[2] as any)).toEqual([
      { libelle: 'Façade Est', expression: '10', batimentId: 'b1' }, { libelle: 'Façade Ouest', expression: '=4*5', batimentId: 'b2' },
    ]);
    expect(metreLines({ quantiteDetails: [{ id: 'x', libelle: 'A', expression: '1', batimentId: 'b1' }] })).toEqual([{ libelle: 'A', expression: '1' }]);
  });
});

describe('proposer un métré par bâtiment', () => {
  it('accepte un métré dont chaque ligne a un bâtiment de l\'opération', async () => {
    const { projectId, lotA, guest } = await guestEcrivain();
    const lignes = [{ libelle: 'Façade Est', expression: '12', batimentId: 'b1' }, { libelle: 'Façade Ouest', expression: '=4*5', batimentId: 'b2' }];
    const res = await propose(guest.token, projectId, metre(lotA, 'lig-bat', lignes));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.baseValue).toBe('[]');
    expect(JSON.parse(res.body.proposedValue)).toEqual(lignes);
  });

  it('la valeur de départ d\'un article qui a un métré porte les bâtiments', async () => {
    const { projectId, lotA, guest } = await guestEcrivain();
    const res = await propose(guest.token, projectId, metre(lotA, 'lig-batm', [{ libelle: 'Façade Est', expression: '11', batimentId: 'b1' }]));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(JSON.parse(res.body.baseValue)).toEqual([
      { libelle: 'Façade Est', expression: '10', batimentId: 'b1' }, { libelle: 'Façade Ouest', expression: '=4*5', batimentId: 'b2' },
    ]);
  });

  it('refuse une ligne sans bâtiment, un bâtiment inconnu et un total de bâtiment négatif', async () => {
    const { projectId, lotA, guest } = await guestEcrivain();
    const mauvais: unknown[] = [
      [{ libelle: 'A', expression: '5' }],
      [{ libelle: 'A', expression: '5', batimentId: 'inconnu' }],
      [{ libelle: 'A', expression: '5', batimentId: 'b1' }, { libelle: 'B', expression: '-8', batimentId: 'b1' }, { libelle: 'C', expression: '30', batimentId: 'b2' }],
    ];
    for (const lignes of mauvais) {
      const res = await propose(guest.token, projectId, metre(lotA, 'lig-bat', lignes));
      expect(res.status, JSON.stringify(lignes)).toBe(400);
      expect(res.body.code).toBe('PROPOSAL_NOT_ALLOWED');
    }
  });

  it('refuse un bâtiment sur une ligne d\'un article qui n\'est pas réparti par bâtiment', async () => {
    const { projectId, lotA, guest } = await guestEcrivain();
    const res = await propose(guest.token, projectId, metre(lotA, 'lig-simple', [{ libelle: 'A', expression: '5', batimentId: 'b1' }]));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROPOSAL_NOT_ALLOWED');
  });

  it('la quantité seule d\'un article par bâtiment reste refusée', async () => {
    const { projectId, lotA, guest } = await guestEcrivain();
    const res = await propose(guest.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-bat', field: 'quantite', value: '9' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROPOSAL_NOT_ALLOWED');
  });
});

describe('approuver un métré par bâtiment', () => {
  it('fixe la quantité de chaque bâtiment et celle de l\'article, garde les bâtiments des lignes', async () => {
    const { tenantId, admin, projectId, lotA, guest } = await guestEcrivain();
    const proposal = (await propose(guest.token, projectId, metre(lotA, 'lig-bat', [
      { libelle: 'Façade Est', expression: '12', batimentId: 'b1' }, { libelle: 'Façade Ouest', expression: '=4*5', batimentId: 'b2' },
      { libelle: 'Déduction baie', expression: '-2,4', batimentId: 'b1' },
    ]))).body;
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const l = noeud(storedDoc(tenantId), 'lig-bat');
    expect(l.quantitesBatiments).toEqual({ b1: 9.6, b2: 20 });
    expect(l.quantite).toBe(29.6);
    expect(l.prixTotal).toBeCloseTo(296, 6);
    expect(l.quantiteDetails.map((d: any) => [d.batimentId, d.expression])).toEqual([['b1', '12'], ['b2', '=4*5'], ['b1', '-2,4']]);
    expect(fakeSupabaseAdmin.getTable('dpgf_versions').filter((v: any) => v.tenant_id === tenantId)).toHaveLength(1);
  });

  it('une ligne reprise garde son identifiant et sa note, une ligne déplacée change de bâtiment', async () => {
    const { tenantId, admin, projectId, lotA, guest } = await guestEcrivain();
    const proposal = (await propose(guest.token, projectId, metre(lotA, 'lig-batm', [
      { libelle: 'Façade Est', expression: '10', batimentId: 'b2' }, { libelle: 'Façade Ouest', expression: '=4*5', batimentId: 'b2' },
    ]))).body;
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const l = noeud(storedDoc(tenantId), 'lig-batm');
    expect(l.quantiteDetails[0]).toMatchObject({ id: 'q1', note: 'à vérifier', batimentId: 'b2' });
    expect(l.quantitesBatiments).toEqual({ b1: 0, b2: 30 });
    expect(l.quantite).toBe(30);
  });

  it('une proposition devient périmée si le bâtiment a disparu de l\'opération entre-temps', async () => {
    const { tenantId, admin, projectId, lotA, guest } = await guestEcrivain();
    const proposal = (await propose(guest.token, projectId, metre(lotA, 'lig-bat', [{ libelle: 'A', expression: '5', batimentId: 'b2' }]))).body;
    const row = fakeSupabaseAdmin.getTable('dpgfs').find((d: any) => d.tenant_id === tenantId)!;
    const doc = JSON.parse(row.data);
    doc.batiments = doc.batiments.filter((b: any) => b.id !== 'b2');
    row.data = JSON.stringify(doc);
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status).toBe(409);
    expect(noeud(storedDoc(tenantId), 'lig-bat').quantite).toBe(3); // rien n'est écrit
  });
});
