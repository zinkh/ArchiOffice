// Métré proposé par un confrère : une seule proposition remplace la liste de lignes de l'article. Mêmes garde-fous
// que les autres champs : valeur validée, article modifiable, instantané avant écriture, périmée si le métré a changé,
// montants recalculés comme l'éditeur (appliquerMetre). Données synthétiques.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { recomputeLot } from '../src/components/pro/treeOps';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const ligne = (surcharge: Record<string, unknown>) => ({ unite: 'm²', quantite: 0, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', ...surcharge });

function makeDocument(lotA: string) {
  const lot = {
    id: 'lot-a', numero: '01', titre: 'Façades', projectLotId: lotA, sousTotal: 0,
    chapitres: [{
      id: 'chap-a1', numero: '1', titre: 'Enduits', lignes: [
        ligne({ id: 'lig-a1', numero: '1.1', designation: 'Enduit', quantite: 12, prixUnitaire: 100, prixTotal: 1200, quantiteFormule: '=6*2' }),
        ligne({
          id: 'lig-m', numero: '1.2', designation: 'Bardage', quantite: 30, prixUnitaire: 10, prixTotal: 300,
          quantiteDetails: [
            { id: 'q1', libelle: 'Façade Est', expression: '10', quantite: 10 },
            { id: 'q2', niveau: 'R+1', local: 'Chambre 2', batimentId: 'bat-1', note: 'à vérifier', quantite: 20 },
          ],
        }),
        ligne({ id: 'lig-parent', numero: '1.3', designation: 'Parent', children: [ligne({ id: 'lig-enfant', numero: '1.3.1', designation: 'Enfant', quantite: 2, prixUnitaire: 5, prixTotal: 10 })] }),
        ligne({ id: 'lig-bat', numero: '1.4', designation: 'Par bâtiment', quantite: 3, prixUnitaire: 7, prixTotal: 21, quantitesBatiments: { b1: 3 } }),
        ligne({ id: 'lig-pm', numero: '1.5', designation: 'Option', pourMemoire: true }),
      ],
    }],
  };
  return { id: 'doc-m', projectId: 'p', titre: 'DPGF', version: '1', dateCreation: '2026-10-01', statut: 'draft', TVA: 20, totalHT: 0, totalTTC: 0, lots: [recomputeLot(lot as any)] };
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
  const email = `confrere-m-${Date.now()}-${seq}@example.test`;
  const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(adminToken)).send({ email, grants });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = `guest-m-token-${res.body.userId}`;
  fakeSupabaseAdmin.registerUser(token, { id: res.body.userId, email });
  return { token };
}

const propose = (token: string, projectId: string, body: any) =>
  request(app).post(`/api/shared/projects/${projectId}/proposals`).set(authHeader(token)).send(body);
const approve = (token: string, projectId: string, id: string) =>
  request(app).post(`/api/projects/${projectId}/share-proposals/${id}/approve`).set(authHeader(token));
const metre = (lotId: string, targetId: string, lignes: unknown) => ({ lotId, targetType: 'ligne', targetId, field: 'metre', value: JSON.stringify(lignes) });
const storedDoc = (tenantId: string) => JSON.parse(fakeSupabaseAdmin.getTable('dpgfs').find((d: any) => d.tenant_id === tenantId)!.data);
const noeud = (doc: any, id: string) => doc.lots[0].chapitres[0].lignes.flatMap((l: any) => [l, ...(l.children ?? [])]).find((l: any) => l.id === id);

const FACADES = [{ libelle: 'Façade Est', expression: '10' }, { libelle: 'Façade Ouest', expression: '=4*5' }];

async function guestEcrivain() {
  const ctx = setup();
  const guest = await inviteGuest(ctx.admin.token, ctx.projectId, [{ kind: 'cctp', access: 'write' }, { kind: 'dpgf', access: 'write' }]);
  return { ...ctx, guest };
}

describe('proposer un métré', () => {
  it('sur un article sans métré : valeur canonique, valeur de départ vide', async () => {
    const { projectId, lotA, guest } = await guestEcrivain();
    const res = await propose(guest.token, projectId, metre(lotA, 'lig-a1', [...FACADES, { libelle: '', expression: '' }]));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ field: 'metre', baseValue: '[]', status: 'pending' });
    expect(JSON.parse(res.body.proposedValue)).toEqual(FACADES); // la ligne vide est ignorée
  });

  it('la valeur de départ d\'un article qui a déjà un métré est ce métré, tel que le confrère le voit', async () => {
    const { projectId, lotA, guest } = await guestEcrivain();
    const res = await propose(guest.token, projectId, metre(lotA, 'lig-m', [{ libelle: 'Façade Est', expression: '12' }]));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(JSON.parse(res.body.baseValue)).toEqual([
      { libelle: 'Façade Est', expression: '10' },
      { libelle: 'R+1 · Chambre 2', expression: '20' },
    ]);
  });

  it('refuse un calcul invalide, un total négatif, une liste trop longue et une valeur mal formée', async () => {
    const { projectId, lotA, guest } = await guestEcrivain();
    const mauvais: unknown[] = [
      [{ libelle: 'A', expression: '=4*' }],
      [{ libelle: 'A', expression: '5' }, { libelle: 'B', expression: '-8' }],
      Array.from({ length: 201 }, (_, i) => ({ libelle: `L${i}`, expression: '1' })),
      [{ libelle: 'A' }],
      [{ libelle: 'x'.repeat(201), expression: '1' }],
      [{ libelle: 'A', expression: '1'.repeat(201) }],
      'pas une liste',
    ];
    for (const lignes of mauvais) {
      const res = await propose(guest.token, projectId, metre(lotA, 'lig-a1', lignes));
      expect(res.status, JSON.stringify(lignes).slice(0, 60)).toBe(400);
    }
    const illisible = await propose(guest.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-a1', field: 'metre', value: '{pas du json' });
    expect(illisible.status).toBe(400);
    const nombre = await propose(guest.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-a1', field: 'metre', value: 12 });
    expect(nombre.status).toBe(400);
  });

  it('refuse un métré identique à l\'actuel', async () => {
    const { projectId, lotA, guest } = await guestEcrivain();
    const res = await propose(guest.token, projectId, metre(lotA, 'lig-m', [{ libelle: 'Façade Est', expression: '10' }, { libelle: 'R+1 · Chambre 2', expression: '20' }]));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Aucun changement');
  });

  it('refuse un article à sous-articles et un article dont la quantité est répartie par bâtiment', async () => {
    const { projectId, lotA, guest } = await guestEcrivain();
    for (const cible of ['lig-parent', 'lig-bat']) {
      const res = await propose(guest.token, projectId, metre(lotA, cible, FACADES));
      expect(res.status, cible).toBe(400);
      expect(res.body.code, cible).toBe('PROPOSAL_NOT_ALLOWED');
    }
  });

  it('refusé sans le droit d\'écriture', async () => {
    const ctx = setup();
    const guest = await inviteGuest(ctx.admin.token, ctx.projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    const res = await propose(guest.token, ctx.projectId, metre(ctx.lotA, 'lig-a1', FACADES));
    expect(res.status).toBe(403);
  });
});

describe('approuver un métré', () => {
  it('remplace la liste, fixe la quantité, recalcule le montant et le lot, prend un instantané', async () => {
    const { tenantId, admin, projectId, lotA, guest } = await guestEcrivain();
    const avant = storedDoc(tenantId);
    const proposal = (await propose(guest.token, projectId, metre(lotA, 'lig-a1', FACADES))).body;
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const apres = storedDoc(tenantId);
    const a1 = noeud(apres, 'lig-a1');
    expect(a1.quantite).toBe(30);
    expect(a1.prixTotal).toBe(3000);
    expect(a1.quantiteFormule).toBeUndefined();
    expect(a1.quantiteDetails.map((d: any) => [d.libelle, d.expression, d.quantite])).toEqual([['Façade Est', '10', 10], ['Façade Ouest', '=4*5', 20]]);
    expect(a1.quantiteDetails.every((d: any) => typeof d.id === 'string' && d.id)).toBe(true);
    expect(apres.lots[0].sousTotal).toBeCloseTo(avant.lots[0].sousTotal + 1800, 6);
    expect(apres.totalHT).toBeCloseTo(apres.lots[0].sousTotal, 6);
    // Rien d'autre n'a bougé.
    expect(noeud(apres, 'lig-m')).toEqual(noeud(avant, 'lig-m'));
    expect(fakeSupabaseAdmin.getTable('dpgf_versions').filter((v: any) => v.tenant_id === tenantId)).toHaveLength(1);
  });

  it('garde l\'identifiant et les champs d\'une ventilation d\'avant pour la ligne reprise telle quelle', async () => {
    const { tenantId, admin, projectId, lotA, guest } = await guestEcrivain();
    const proposal = (await propose(guest.token, projectId, metre(lotA, 'lig-m', [
      { libelle: 'Façade Est', expression: '=5*3' }, { libelle: 'R+1 · Chambre 2', expression: '20' },
    ]))).body;
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const m = noeud(storedDoc(tenantId), 'lig-m');
    expect(m.quantite).toBe(35);
    expect(m.prixTotal).toBe(350);
    expect(m.quantiteDetails[0]).toMatchObject({ id: 'q1', libelle: 'Façade Est', expression: '=5*3', quantite: 15 });
    expect(m.quantiteDetails[1]).toMatchObject({ id: 'q2', niveau: 'R+1', local: 'Chambre 2', batimentId: 'bat-1', note: 'à vérifier', quantite: 20 });
  });

  it('une liste vide retire le métré et laisse la quantité', async () => {
    const { tenantId, admin, projectId, lotA, guest } = await guestEcrivain();
    const proposal = (await propose(guest.token, projectId, metre(lotA, 'lig-m', []))).body;
    expect(proposal.proposedValue).toBe('[]');
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const m = noeud(storedDoc(tenantId), 'lig-m');
    expect(m.quantiteDetails).toBeUndefined();
    expect(m.quantite).toBe(30);
  });

  it('un article pour mémoire reçoit la quantité mais reste pour mémoire (montant à 0)', async () => {
    const { tenantId, admin, projectId, lotA, guest } = await guestEcrivain();
    const proposal = (await propose(guest.token, projectId, metre(lotA, 'lig-pm', FACADES))).body;
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.leftPourMemoire ?? false).toBe(false);
    const pm = noeud(storedDoc(tenantId), 'lig-pm');
    expect(pm).toMatchObject({ quantite: 30, prixTotal: 0, pourMemoire: true });
  });

  it('périmée si le métré a changé entre-temps : rien n\'est écrit', async () => {
    const { tenantId, admin, projectId, lotA, guest } = await guestEcrivain();
    const proposal = (await propose(guest.token, projectId, metre(lotA, 'lig-m', [{ libelle: 'Façade Est', expression: '12' }]))).body;
    const row = fakeSupabaseAdmin.getTable('dpgfs').find((d: any) => d.tenant_id === tenantId)!;
    const doc = JSON.parse(row.data);
    noeud(doc, 'lig-m').quantiteDetails[0].expression = '11';
    row.data = JSON.stringify(doc);
    row.revision += 1;
    const avant = row.data;

    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROPOSAL_OUTDATED');
    expect(row.data).toBe(avant);
  });

  it('le cabinet voit le métré actuel face au métré proposé', async () => {
    const { admin, projectId, lotA, guest } = await guestEcrivain();
    await propose(guest.token, projectId, metre(lotA, 'lig-m', [{ libelle: 'Façade Est', expression: '12' }]));
    const list = await request(app).get(`/api/projects/${projectId}/share-proposals`).set(authHeader(admin.token));
    expect(list.status).toBe(200);
    const p = list.body.find((x: any) => x.field === 'metre');
    expect(JSON.parse(p.currentValue)).toEqual([{ libelle: 'Façade Est', expression: '10' }, { libelle: 'R+1 · Chambre 2', expression: '20' }]);
    expect(JSON.parse(p.proposedValue)).toEqual([{ libelle: 'Façade Est', expression: '12' }]);
    expect(p.outdated).toBe(false);
  });
});
