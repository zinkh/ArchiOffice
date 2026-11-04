// Propositions d'un confrère sur les chiffres du DPGF (quantité, prix unitaire, unité) et sur le
// titre d'un lot : validation, refus des cas non modifiables, recalcul des totaux comme l'éditeur,
// écriture conditionnelle, et garantie qu'aucune donnée ne se perd. Prix et titres synthétiques.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import {
  applyFieldToNode, blockedEdit, findRawNode, parseNumberValue, readField, recomputeAfterNumericChange, sameFieldValue,
} from '../server/projectShares/documentView';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

function makeDocument(lotA: string, lotB: string) {
  return {
    id: 'doc-1', projectId: 'p', titre: 'DPGF Villa', version: 'V2', dateCreation: '2026-10-01', statut: 'draft',
    totalHT: 15180, TVA: 20, totalTTC: 18216,
    lots: [
      {
        // Sous-total cohérent avec les lignes : 10 (parent, somme de ses enfants) + 150 + 0 (pour mémoire) + 20.
        id: 'lot-a', numero: '01', titre: 'Gros œuvre (titre du document)', projectLotId: lotA, sousTotal: 180,
        chapitres: [{
          id: 'chap-a1', numero: '1', titre: 'Fondations',
          lignes: [
            {
              id: 'lig-a1', numero: '1.1', designation: 'Semelles filantes', unite: 'm3', quantite: 12, prixUnitaire: 100, prixTotal: 1200, type: 'ouvrage',
              children: [{ id: 'lig-a1b', numero: '1.1.1', designation: 'Armatures', unite: 'kg', quantite: 5, prixUnitaire: 2, prixTotal: 10, type: 'ouvrage' }],
            },
            { id: 'lig-a2', numero: '1.2', designation: 'Béton de propreté', unite: 'm3', quantite: 3, prixUnitaire: 50, prixTotal: 150, type: 'ouvrage' },
            { id: 'lig-a3', numero: '1.3', designation: 'Option drainage', unite: 'ml', quantite: 1, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', pourMemoire: true },
            { id: 'lig-a4', numero: '1.4', designation: 'Fouilles par bâtiment', unite: 'm3', quantite: 2, prixUnitaire: 10, prixTotal: 20, type: 'ouvrage', quantitesBatiments: { b1: 2 } },
            { id: 'lig-a5', numero: '1.5', designation: 'Texte seul', unite: '', quantite: 0, prixUnitaire: 0, prixTotal: 0, type: 'commentaire', cctpOnly: true, cctpDescription: 'Prescription' },
          ],
        }],
      },
      {
        id: 'lot-b', numero: '02', titre: 'Charpente', projectLotId: lotB, sousTotal: 15000,
        chapitres: [{ id: 'chap-b1', numero: '1', titre: 'Fermes', lignes: [{ id: 'lig-b1', numero: '1.1', designation: 'Fermettes', unite: 'u', quantite: 30, prixUnitaire: 500, prixTotal: 15000, type: 'ouvrage' }] }],
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
  const doc = makeDocument(lotA, lotB);
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa Martin', project_code: '26014' }]);
  fakeSupabaseAdmin.seed('project_lots', [
    { id: lotA, tenant_id: tenantId, project_id: projectId, lot_number: '01', lot_title: 'Gros œuvre' },
    { id: lotB, tenant_id: tenantId, project_id: projectId, lot_number: '02', lot_title: 'Charpente' },
  ]);
  const dpgfId = `${tenantId}-doc`;
  fakeSupabaseAdmin.seed('dpgfs', [{ id: dpgfId, tenant_id: tenantId, project_id: projectId, data: JSON.stringify(doc) }]);
  return { tenantId, admin, projectId, lotA, lotB, dpgfId, doc };
}

const storedDoc = (dpgfId: string) => JSON.parse(fakeSupabaseAdmin.getTable('dpgfs').find((d: any) => d.id === dpgfId)!.data);
const lotTitle = (lotId: string) => fakeSupabaseAdmin.getTable('project_lots').find((l: any) => l.id === lotId)!.lot_title;

let seq = 0;
const newEmail = () => { seq += 1; return `confrere-prix-${Date.now()}-${seq}@example.test`; };

async function inviteGuest(adminToken: string, projectId: string, grants: any[]) {
  const email = newEmail();
  const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(adminToken)).send({ email, grants });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = `guest-prix-token-${res.body.userId}`;
  fakeSupabaseAdmin.registerUser(token, { id: res.body.userId, email });
  return { shareId: res.body.id as string, userId: res.body.userId as string, email, token };
}

const propose = (token: string, projectId: string, body: any) =>
  request(app).post(`/api/shared/projects/${projectId}/proposals`).set(authHeader(token)).send(body);
const approve = (token: string, projectId: string, id: string) =>
  request(app).post(`/api/projects/${projectId}/share-proposals/${id}/approve`).set(authHeader(token));
const num = (lotId: string, field: string, value: any, targetId = 'lig-a2') => ({ lotId, targetType: 'ligne', targetId, field, value });

describe('chiffres : fonctions pures', () => {
  it('lit un nombre positif, virgule française admise, 4 décimales au plus, borné', () => {
    expect(parseNumberValue('12,5', 'Quantité')).toEqual({ number: 12.5 });
    expect(parseNumberValue(' 8 ', 'Quantité')).toEqual({ number: 8 });
    expect(parseNumberValue(0, 'Prix')).toEqual({ number: 0 });
    expect(parseNumberValue(0.0001, 'Prix')).toEqual({ number: 0.0001 });
    for (const bad of ['-1', -1, 'abc', '', '1e3', '1.23456', 1.23456, NaN, Infinity, '1,2,3', 1e9 + 1, null, undefined, {}, [3]]) {
      expect('error' in parseNumberValue(bad as any, 'Prix'), String(bad)).toBe(true);
    }
  });

  it('compare un nombre numériquement et un texte tel quel', () => {
    expect(sameFieldValue('quantite', '3', '3.0')).toBe(true);
    expect(sameFieldValue('quantite', '3', '3.5')).toBe(false);
    expect(sameFieldValue('quantite', '', '')).toBe(false); // une valeur absente n'est égale à rien
    expect(sameFieldValue('unite', 'm3', 'm3')).toBe(true);
    expect(sameFieldValue('unite', 'm3', 'M3')).toBe(false);
  });

  it('refuse un article qui n\'est pas une feuille chiffrée modifiable', () => {
    const doc = makeDocument('A', 'B');
    const node = (id: string) => findRawNode(doc, 'A', 'ligne', id)!;
    expect(blockedEdit(node('lig-a2'), 'quantite')).toBeNull();
    expect(blockedEdit(node('lig-a2'), 'prixUnitaire')).toBeNull();
    expect(blockedEdit(node('lig-a2'), 'unite')).toBeNull();
    expect(blockedEdit(node('lig-a1'), 'quantite')).toContain('sous-articles'); // un parent porte la somme de ses enfants
    expect(blockedEdit(node('lig-a1'), 'unite')).toContain('sous-articles');
    // Un article « pour mémoire » peut recevoir une quantité, une unité et un prix.
    expect(blockedEdit(node('lig-a3'), 'prixUnitaire')).toBeNull();
    expect(blockedEdit(node('lig-a3'), 'quantite')).toBeNull();
    expect(blockedEdit(node('lig-a3'), 'unite')).toBeNull();
    expect(blockedEdit(node('lig-a4'), 'quantite')).toContain('bâtiment');
    expect(blockedEdit(node('lig-a5'), 'quantite')).toContain('article chiffré');
    expect(blockedEdit({ type: 'ouvrage', quantiteDetails: [{ id: 'q', quantite: 1 }] }, 'quantite')).toContain('local');
    expect(blockedEdit(node('lig-a5'), 'cctpDescription')).toBeNull(); // les textes n'ont pas ces restrictions
  });

  it('recalcule le montant de l\'article, le sous-total du lot et les totaux comme l\'éditeur', () => {
    const doc = makeDocument('A', 'B');
    const ligne = findRawNode(doc, 'A', 'ligne', 'lig-a2')!;
    applyFieldToNode(ligne, 'prixUnitaire', '60');
    expect(ligne.prixTotal).toBe(180); // 3 x 60
    recomputeAfterNumericChange(doc, 'A');
    expect(doc.lots[0].sousTotal).toBe(210); // 10 (parent : somme des enfants) + 180 + 20
    expect(doc.lots[1].sousTotal).toBe(15000); // l'autre lot n'est pas touché
    expect(doc.totalHT).toBe(15210);
    expect(doc.totalTTC).toBeCloseTo(18252, 6);
    // Pour mémoire : une quantité ou une unité le laissent à zéro et « pour mémoire »...
    const pm = findRawNode(doc, 'A', 'ligne', 'lig-a3')!;
    expect(applyFieldToNode(pm, 'quantite', '9')).toEqual({ leftPourMemoire: false });
    expect(applyFieldToNode(pm, 'unite', 'm')).toEqual({ leftPourMemoire: false });
    expect(pm).toMatchObject({ pourMemoire: true, prixTotal: 0, quantite: 9, unite: 'm' });
    // ... un prix de 0 aussi, mais un prix supérieur à 0 le chiffre : il quitte « pour mémoire ».
    expect(applyFieldToNode(pm, 'prixUnitaire', '0')).toEqual({ leftPourMemoire: false });
    expect(pm.pourMemoire).toBe(true);
    expect(applyFieldToNode(pm, 'prixUnitaire', '45')).toEqual({ leftPourMemoire: true });
    expect(pm.pourMemoire).toBeUndefined();
    expect(pm.prixTotal).toBe(405); // 9 x 45
    expect(readField(pm, 'quantite')).toBe('9');
    expect(readField({}, 'quantite')).toBe('');
  });
});

describe('proposer des chiffres', () => {
  it('droit d\'écriture sur le DPGF : une quantité avec virgule est enregistrée en nombre', async () => {
    const { tenantId, admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    const res = await propose(guest.token, projectId, num(lotA, 'quantite', '8,5'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ field: 'quantite', baseValue: '3', proposedValue: '8.5', status: 'pending' });
    const row = fakeSupabaseAdmin.getTable('project_share_proposals').find((p: any) => p.id === res.body.id)!;
    expect(row.tenant_id).toBe(tenantId);
  });

  it('le droit sur le CCTP ne permet pas de toucher aux chiffres, ni l\'inverse', async () => {
    const { admin, projectId, lotA } = setup();
    const cctpOnly = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    const dpgfOnly = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    for (const field of ['quantite', 'prixUnitaire', 'unite']) {
      const res = await propose(cctpOnly.token, projectId, num(lotA, field, field === 'unite' ? 'ml' : '9'));
      expect(res.status, field).toBe(403);
      expect(res.body.code, field).toBe('SHARE_FORBIDDEN');
    }
    const text = await propose(dpgfOnly.token, projectId, { lotId: lotA, targetType: 'ligne', targetId: 'lig-a2', field: 'designation', value: 'Béton de propreté dosé à 150' });
    expect(text.status).toBe(403);
    const title = await propose(dpgfOnly.token, projectId, { lotId: lotA, targetType: 'lot', targetId: 'lot-a', field: 'titre', value: 'Gros œuvre et VRD' });
    expect(title.status).toBe(403);
  });

  it('refuse les articles non modifiables et ceux que le confrère ne voit pas', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    const parent = await propose(guest.token, projectId, num(lotA, 'prixUnitaire', '10', 'lig-a1'));
    expect(parent.status).toBe(400);
    expect(parent.body.code).toBe('PROPOSAL_NOT_ALLOWED');
    expect((await propose(guest.token, projectId, num(lotA, 'quantite', '10', 'lig-a4'))).body.code).toBe('PROPOSAL_NOT_ALLOWED');
    // Une ligne réservée au CCTP n'existe pas dans la vue DPGF, et un article d'un autre lot non plus.
    expect((await propose(guest.token, projectId, num(lotA, 'quantite', '10', 'lig-a5'))).status).toBe(404);
    expect((await propose(guest.token, projectId, num(lotA, 'quantite', '10', 'lig-b1'))).status).toBe(404);
  });

  it('refuse un nombre invalide, hors limites ou inchangé, sans rien enregistrer', async () => {
    const { tenantId, admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    for (const bad of ['-5', 'abc', '', '1.23456', 1e12, null]) {
      expect((await propose(guest.token, projectId, num(lotA, 'prixUnitaire', bad))).status, String(bad)).toBe(400);
    }
    const same = await propose(guest.token, projectId, num(lotA, 'quantite', '3.0'));
    expect(same.status).toBe(400);
    expect(same.body.error).toContain('Aucun changement');
    expect(fakeSupabaseAdmin.getTable('project_share_proposals').filter((p: any) => p.tenant_id === tenantId)).toHaveLength(0);
  });

  it('propose une unité, et refuse une unité vide ou trop longue', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    expect((await propose(guest.token, projectId, num(lotA, 'unite', 'ml'))).status).toBe(201);
    expect((await propose(guest.token, projectId, num(lotA, 'unite', '   '))).status).toBe(400);
    expect((await propose(guest.token, projectId, num(lotA, 'unite', 'x'.repeat(21)))).status).toBe(400);
    expect((await propose(guest.token, projectId, num(lotA, 'unite', 'm3'))).status).toBe(400); // inchangée
  });
});

describe('appliquer des chiffres', () => {
  it('une quantité met à jour l\'article, le sous-total du lot et les totaux, et rien d\'autre', async () => {
    const { tenantId, admin, projectId, dpgfId, doc, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    const proposal = (await propose(guest.token, projectId, num(lotA, 'quantite', '8,5'))).body;
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const after = storedDoc(dpgfId);
    expect(after.lots[0].chapitres[0].lignes[1]).toMatchObject({ quantite: 8.5, prixUnitaire: 50, prixTotal: 425 });
    expect(after.lots[0].sousTotal).toBe(455); // 10 + 425 + 20
    expect(after.totalHT).toBe(15455);
    expect(after.totalTTC).toBeCloseTo(18546, 6);
    // Tout le reste est identique : on remet les cinq valeurs modifiées, le document redevient l'original.
    const restored = JSON.parse(JSON.stringify(after));
    Object.assign(restored.lots[0].chapitres[0].lignes[1], { quantite: 3, prixTotal: 150 });
    Object.assign(restored.lots[0], { sousTotal: 180 });
    Object.assign(restored, { totalHT: 15180, totalTTC: 18216 });
    expect(restored).toEqual(doc);

    const snapshots = fakeSupabaseAdmin.getTable('dpgf_versions').filter((v: any) => v.tenant_id === tenantId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].document).toEqual(doc); // l'ancien chiffrage reste restaurable
  });

  it('un prix unitaire sur un sous-article remonte jusqu\'au sous-total du lot', async () => {
    const { admin, projectId, dpgfId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    const proposal = (await propose(guest.token, projectId, num(lotA, 'prixUnitaire', '4', 'lig-a1b'))).body;
    expect((await approve(admin.token, projectId, proposal.id)).status).toBe(200);
    const after = storedDoc(dpgfId);
    expect(after.lots[0].chapitres[0].lignes[0].children[0]).toMatchObject({ prixUnitaire: 4, prixTotal: 20 });
    expect(after.lots[0].sousTotal).toBe(190); // 20 (somme des enfants du parent) + 150 + 20
    expect(after.lots[1].sousTotal).toBe(15000);
  });

  it('une unité ne change que l\'unité : aucun total ne bouge', async () => {
    const { admin, projectId, dpgfId, doc, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    const proposal = (await propose(guest.token, projectId, num(lotA, 'unite', 'ml'))).body;
    expect((await approve(admin.token, projectId, proposal.id)).status).toBe(200);
    const after = storedDoc(dpgfId);
    expect(after.lots[0].chapitres[0].lignes[1].unite).toBe('ml');
    after.lots[0].chapitres[0].lignes[1].unite = 'm3';
    expect(after).toEqual(doc);
  });

  it('est refusée, sans rien écrire, si l\'article a changé de nature entre-temps', async () => {
    const { admin, projectId, dpgfId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    const proposal = (await propose(guest.token, projectId, num(lotA, 'quantite', '9'))).body;
    // Le cabinet a, depuis, ajouté des sous-articles à cet article : il n'a plus de quantité propre.
    const row = fakeSupabaseAdmin.getTable('dpgfs').find((d: any) => d.id === dpgfId)!;
    const edited = JSON.parse(row.data);
    edited.lots[0].chapitres[0].lignes[1].children = [{ id: 'nouveau', numero: '1.2.1', designation: 'Sous-article', unite: 'u', quantite: 1, prixUnitaire: 1, prixTotal: 1, type: 'ouvrage' }];
    row.data = JSON.stringify(edited);
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROPOSAL_OUTDATED');
    expect(storedDoc(dpgfId)).toEqual(edited);
  });
});

describe('titre d\'un lot', () => {
  const lotTitleProposal = (lotId: string, value: string) => ({ lotId, targetType: 'lot', targetId: 'lot-a', field: 'titre', value });

  it('part de la liste des lots, s\'applique à la liste des lots et laisse le document intact', async () => {
    const { tenantId, admin, projectId, dpgfId, doc, lotA, lotB } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    const res = await propose(guest.token, projectId, lotTitleProposal(lotA, 'Gros œuvre et VRD'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ targetType: 'lot', baseValue: 'Gros œuvre', proposedValue: 'Gros œuvre et VRD' });

    const approved = await approve(admin.token, projectId, res.body.id);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(lotTitle(lotA)).toBe('Gros œuvre et VRD');
    expect(lotTitle(lotB)).toBe('Charpente');
    expect(storedDoc(dpgfId)).toEqual(doc); // le titre du document est réappliqué depuis la liste à chaque lecture
    expect(fakeSupabaseAdmin.getTable('dpgf_versions').filter((v: any) => v.tenant_id === tenantId)).toHaveLength(0);
    // L'ancien titre n'est pas perdu : la proposition le garde, et le journal le dit.
    expect(fakeSupabaseAdmin.getTable('project_share_proposals').find((p: any) => p.id === res.body.id)!.base_value).toBe('Gros œuvre');
    await new Promise(r => setTimeout(r, 30));
    const logged = fakeSupabaseAdmin.getTable('activities').filter((a: any) => a.tenant_id === tenantId && String(a.action).includes('Gros œuvre » remplacé par « Gros œuvre et VRD'));
    expect(logged.length).toBeGreaterThan(0);
  });

  it('est périmée si le titre a changé depuis : rien n\'est écrit', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    const proposal = (await propose(guest.token, projectId, lotTitleProposal(lotA, 'Gros œuvre et VRD'))).body;
    fakeSupabaseAdmin.getTable('project_lots').find((l: any) => l.id === lotA)!.lot_title = 'Structure';
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROPOSAL_OUTDATED');
    expect(lotTitle(lotA)).toBe('Structure');
  });

  it('n\'écrase pas un titre modifié pendant l\'application : écriture conditionnelle', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    const proposal = (await propose(guest.token, projectId, lotTitleProposal(lotA, 'Gros œuvre et VRD'))).body;
    const original = fakeSupabaseAdmin.from.bind(fakeSupabaseAdmin);
    (fakeSupabaseAdmin as any).from = (table: string) => {
      const query = original(table);
      if (table === 'project_lots') {
        const update = query.update.bind(query);
        query.update = (patch: any) => {
          fakeSupabaseAdmin.getTable('project_lots').find((l: any) => l.id === lotA)!.lot_title = 'Titre saisi à côté';
          return update(patch);
        };
      }
      return query;
    };
    try {
      const res = await approve(admin.token, projectId, proposal.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PROPOSAL_CONFLICT');
    } finally {
      delete (fakeSupabaseAdmin as any).from;
    }
    expect(lotTitle(lotA)).toBe('Titre saisi à côté');
    const list = await request(app).get(`/api/projects/${projectId}/share-proposals`).set(authHeader(admin.token));
    expect(list.body[0].status).toBe('pending'); // rien n'est perdu : on peut réessayer
  });

  it('exige le droit sur CE lot, et refuse un titre vide', async () => {
    const { admin, projectId, lotA, lotB } = setup();
    const other = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotB }]);
    expect((await propose(other.token, projectId, lotTitleProposal(lotA, 'Nouveau titre'))).status).toBe(403);
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    expect((await propose(guest.token, projectId, lotTitleProposal(lotA, '   '))).status).toBe(400);
    expect((await propose(guest.token, projectId, lotTitleProposal(lotA, 'Gros œuvre'))).status).toBe(400); // inchangé
  });
});

describe('aucune perte de donnée', () => {
  it('signale au cabinet une proposition appliquée puis effacée par un onglet périmé', async () => {
    const { admin, projectId, dpgfId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    const proposal = (await propose(guest.token, projectId, num(lotA, 'quantite', '9'))).body;
    expect((await approve(admin.token, projectId, proposal.id)).status).toBe(200);
    const listed = async () => (await request(app).get(`/api/projects/${projectId}/share-proposals`).set(authHeader(admin.token))).body[0];
    expect(await listed()).toMatchObject({ status: 'applied', drifted: false, currentValue: '9' });

    // Un onglet PRO ouvert avant l'approbation réenregistre l'ancien chiffre.
    const row = fakeSupabaseAdmin.getTable('dpgfs').find((d: any) => d.id === dpgfId)!;
    const stale = JSON.parse(row.data);
    stale.lots[0].chapitres[0].lignes[1].quantite = 3;
    row.data = JSON.stringify(stale);
    expect(await listed()).toMatchObject({ status: 'applied', drifted: true, currentValue: '3', proposedValue: '9' });
  });

  it('ne supprime jamais une proposition : remplacée, retirée, refusée ou périmée, elle reste en base', async () => {
    const { tenantId, admin, projectId, dpgfId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    const ofTenant = () => fakeSupabaseAdmin.getTable('project_share_proposals').filter((p: any) => p.tenant_id === tenantId);
    const replaced = (await propose(guest.token, projectId, num(lotA, 'quantite', '4'))).body;
    const second = (await propose(guest.token, projectId, num(lotA, 'quantite', '5'))).body; // remplace la première
    const withdrawn = (await propose(guest.token, projectId, num(lotA, 'unite', 'ml'))).body;
    await request(app).delete(`/api/shared/projects/${projectId}/proposals/${withdrawn.id}`).set(authHeader(guest.token));
    const rejected = (await propose(guest.token, projectId, num(lotA, 'prixUnitaire', '70'))).body;
    await request(app).post(`/api/projects/${projectId}/share-proposals/${rejected.id}/reject`).set(authHeader(admin.token)).send({ note: 'Non.' });
    // Le chiffre change côté cabinet : la proposition en attente devient périmée.
    const row = fakeSupabaseAdmin.getTable('dpgfs').find((d: any) => d.id === dpgfId)!;
    const edited = JSON.parse(row.data);
    edited.lots[0].chapitres[0].lignes[1].quantite = 6;
    row.data = JSON.stringify(edited);
    await approve(admin.token, projectId, second.id);

    const rows = ofTenant();
    expect(rows).toHaveLength(4); // aucune ligne n'a disparu
    const status = (id: string) => rows.find((p: any) => p.id === id)!.status;
    expect([status(replaced.id), status(second.id), status(withdrawn.id), status(rejected.id)]).toEqual(['withdrawn', 'outdated', 'withdrawn', 'rejected']);
    // Chacune garde sa valeur de départ et sa valeur proposée.
    expect(rows.find((p: any) => p.id === replaced.id)).toMatchObject({ base_value: '3', proposed_value: '4' });
    expect(rows.find((p: any) => p.id === rejected.id)).toMatchObject({ base_value: '50', proposed_value: '70' });
  });
});

describe('article « pour mémoire »', () => {
  // lig-a3 : pour mémoire, quantité 1, unité ml, prix 0, montant 0. Lot A : sous-total 180, document 15 180 HT.
  async function pmProposals() {
    const ctx = setup();
    const guest = await inviteGuest(ctx.admin.token, ctx.projectId, [{ kind: 'dpgf', access: 'write', lotId: ctx.lotA }]);
    const make = async (field: string, value: string) => {
      const res = await propose(guest.token, ctx.projectId, num(ctx.lotA, field, value, 'lig-a3'));
      expect(res.status, `${field} ${JSON.stringify(res.body)}`).toBe(201);
      return res.body;
    };
    return { ...ctx, guest, quantite: await make('quantite', '12'), unite: await make('unite', 'm'), prix: await make('prixUnitaire', '45') };
  }
  const pmLine = (dpgfId: string) => storedDoc(dpgfId).lots[0].chapitres[0].lignes[2];

  it('accepte une quantité, une unité et un prix, et prévient le cabinet que le prix chiffrera l\'article', async () => {
    const { admin, projectId, quantite, unite, prix } = await pmProposals();
    const list = (await request(app).get(`/api/projects/${projectId}/share-proposals`).set(authHeader(admin.token))).body;
    const flag = (id: string) => list.find((p: any) => p.id === id).leavesPourMemoire;
    expect(flag(prix.id)).toBe(true); // ce prix fera quitter « pour mémoire »
    expect(flag(quantite.id)).toBe(false);
    expect(flag(unite.id)).toBe(false);
  });

  it('une quantité et une unité laissent l\'article « pour mémoire », montant et totaux inchangés', async () => {
    const { admin, projectId, dpgfId, quantite, unite } = await pmProposals();
    const first = await approve(admin.token, projectId, quantite.id);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.leftPourMemoire).toBe(false);
    expect((await approve(admin.token, projectId, unite.id)).body.leftPourMemoire).toBe(false);
    expect(pmLine(dpgfId)).toMatchObject({ pourMemoire: true, quantite: 12, unite: 'm', prixUnitaire: 0, prixTotal: 0 });
    const after = storedDoc(dpgfId);
    expect(after.lots[0].sousTotal).toBe(180);
    expect(after.totalHT).toBe(15180);
  });

  it('un prix chiffre l\'article : il quitte « pour mémoire » et entre dans le total, instantané à l\'appui', async () => {
    const { tenantId, admin, projectId, dpgfId, doc, quantite, unite, prix } = await pmProposals();
    await approve(admin.token, projectId, quantite.id);
    await approve(admin.token, projectId, unite.id);
    const res = await approve(admin.token, projectId, prix.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'applied', leftPourMemoire: true });

    const line = pmLine(dpgfId);
    expect(line.pourMemoire).toBeUndefined();
    expect(line).toMatchObject({ quantite: 12, unite: 'm', prixUnitaire: 45, prixTotal: 540 });
    const after = storedDoc(dpgfId);
    expect(after.lots[0].sousTotal).toBe(720); // 180 + 540
    expect(after.totalHT).toBe(15720);
    expect(after.totalTTC).toBeCloseTo(18864, 6);

    // Rien n'est perdu : l'instantané d'avant garde l'article « pour mémoire », et le journal le dit.
    const snapshots = fakeSupabaseAdmin.getTable('dpgf_versions').filter((v: any) => v.tenant_id === tenantId);
    const lastSnapshot = snapshots[snapshots.length - 1];
    expect(lastSnapshot.document.lots[0].chapitres[0].lignes[2]).toMatchObject({ pourMemoire: true, prixTotal: 0 });
    expect(doc.lots[0].chapitres[0].lignes[2]).toMatchObject({ pourMemoire: true });
    await new Promise(r => setTimeout(r, 30));
    const logged = fakeSupabaseAdmin.getTable('activities').filter((a: any) => a.tenant_id === tenantId && String(a.action).includes('quitte « pour mémoire »'));
    expect(logged.length).toBeGreaterThan(0);
  });

  it('donne le même résultat quel que soit l\'ordre d\'approbation', async () => {
    const forward = await pmProposals();
    await approve(forward.admin.token, forward.projectId, forward.quantite.id);
    await approve(forward.admin.token, forward.projectId, forward.prix.id);

    const reverse = await pmProposals();
    await approve(reverse.admin.token, reverse.projectId, reverse.prix.id); // prix d'abord, avec la quantité de départ
    expect(storedDoc(reverse.dpgfId).lots[0].sousTotal).toBe(225); // 180 + 1 x 45
    await approve(reverse.admin.token, reverse.projectId, reverse.quantite.id);

    for (const run of [forward, reverse]) {
      expect(pmLine(run.dpgfId)).toMatchObject({ quantite: 12, prixUnitaire: 45, prixTotal: 540 });
      expect(pmLine(run.dpgfId).pourMemoire).toBeUndefined();
      expect(storedDoc(run.dpgfId).lots[0].sousTotal).toBe(720);
      expect(storedDoc(run.dpgfId).totalHT).toBe(15720);
    }
  });

  it('un prix à 0 ne change rien : « pour mémoire » reste, la proposition est refusée comme inchangée', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'write', lotId: lotA }]);
    const res = await propose(guest.token, projectId, num(lotA, 'prixUnitaire', '0', 'lig-a3'));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Aucun changement');
  });
});
