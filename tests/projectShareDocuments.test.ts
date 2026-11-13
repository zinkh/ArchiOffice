// CCTP et DPGF partagés avec un confrère : lecture par lot, commentaires, isolation.
// Les routes passent par la vraie application Express contre le faux Supabase en
// mémoire (tests/testServer.ts). Prix et textes sont synthétiques.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { allows, normalizeGrants } from '../server/projectShares/access';
import { guestDocumentView, parseDocument, visibleNodes } from '../server/projectShares/documentView';
import { readCommentBody } from '../server/routes/projectShareDocuments';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const PRICE_A = 123456.78;
const PRICE_B = 987654.32;

/** Un document avec deux lots rattachés, un lot orphelin, des champs internes et des lignes réservées au CCTP. */
function makeDocument(lotA: string, lotB: string) {
  return {
    id: 'doc-1', projectId: 'p', titre: 'DPGF Villa', version: 'V2', dateCreation: '2026-10-01', statut: 'draft',
    totalHT: PRICE_A + PRICE_B, TVA: 20, totalTTC: (PRICE_A + PRICE_B) * 1.2,
    lots: [
      {
        id: 'lot-a', numero: '01', titre: 'Gros œuvre', projectLotId: lotA, marqueur: { statut: 'incomplet', par: 'interne' },
        chapitres: [
          {
            id: 'chap-a1', numero: '01.1', titre: 'Fondations', cctpDescription: 'Béton armé [b]C25/30[/b]',
            lignes: [
              {
                id: 'lig-a1', numero: '01.1.1', designation: 'Semelles filantes', unite: 'm3', quantite: 12, prixUnitaire: 100, prixTotal: PRICE_A,
                type: 'ouvrage', cctpDescription: 'Coulées en pleine fouille', articleTypeId: 'bibliotheque-secrete', genereParIa: 'llm',
                marqueur: { statut: 'en_cours' }, images: [{ id: 'img', fileUrl: 'https://stockage.interne/cle', legende: 'x' }],
                children: [{ id: 'lig-a1b', numero: '01.1.1.1', designation: 'Armatures', unite: 'kg', quantite: 5, prixUnitaire: 2, prixTotal: 10, type: 'ouvrage' }],
              },
              { id: 'lig-a2', numero: '01.1.2', designation: 'Texte seul du CCTP', unite: '', quantite: 0, prixUnitaire: 0, prixTotal: 0, type: 'commentaire', cctpOnly: true, cctpDescription: 'Prescription générale' },
            ],
          },
          { id: 'chap-a2', numero: '01.2', titre: 'Chapitre réservé au CCTP', cctpOnly: true, cctpDescription: 'Texte', lignes: [] },
        ],
      },
      {
        id: 'lot-b', numero: '02', titre: 'Charpente', projectLotId: lotB,
        chapitres: [{ id: 'chap-b1', numero: '02.1', titre: 'Fermes', lignes: [{ id: 'lig-b1', numero: '02.1.1', designation: 'Fermettes', unite: 'u', quantite: 30, prixUnitaire: 500, prixTotal: PRICE_B, type: 'ouvrage' }] }],
      },
      { id: 'lot-c', numero: '03', titre: 'Lot orphelin', chapitres: [{ id: 'chap-c1', numero: '03.1', titre: 'x', lignes: [{ id: 'lig-c1', numero: '1', designation: 'Orphelin', unite: 'u', quantite: 1, prixUnitaire: 777, prixTotal: 777, type: 'ouvrage' }] }] },
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
const newEmail = () => { seq += 1; return `confrere-doc-${Date.now()}-${seq}@example.test`; };

async function inviteGuest(adminToken: string, projectId: string, grants: any[]) {
  const email = newEmail();
  const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(adminToken)).send({ email, grants });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = `guest-doc-token-${res.body.userId}`;
  fakeSupabaseAdmin.registerUser(token, { id: res.body.userId, email });
  return { shareId: res.body.id as string, userId: res.body.userId as string, email, token };
}

const comment = (token: string, projectId: string, body: any) =>
  request(app).post(`/api/shared/projects/${projectId}/comments`).set(authHeader(token)).send(body);

describe('droits par atelier : fonctions pures', () => {
  it('accorde chaque atelier en entier : un lot envoyé par un ancien client est ignoré', () => {
    expect('error' in normalizeGrants([{ kind: 'cctp', access: 'read' }])).toBe(false);
    expect((normalizeGrants([{ kind: 'dpgf', access: 'read', lotId: 'l1' }]) as any).grants).toEqual([{ kind: 'dpgf', access: 'read' }]);
    expect('error' in normalizeGrants([{ kind: 'inconnu', access: 'read' }])).toBe(true);
  });

  it('accorde « commentaire » au CCTP et au DPGF seulement, et « écriture » là où elle est branchée', () => {
    expect('error' in normalizeGrants([{ kind: 'tasks', access: 'comment' }])).toBe(true);
    expect('error' in normalizeGrants([{ kind: 'documents', access: 'comment' }])).toBe(true);
    expect('error' in normalizeGrants([{ kind: 'documents', access: 'write' }])).toBe(true);
    expect('error' in normalizeGrants([{ kind: 'lots', access: 'write' }])).toBe(true);
    expect('error' in normalizeGrants([{ kind: 'act', access: 'write' }])).toBe(true);
    expect('error' in normalizeGrants([{ kind: 'cctp', access: 'write' }])).toBe(false);
    expect('error' in normalizeGrants([{ kind: 'dpgf', access: 'comment' }])).toBe(false);
    expect('error' in normalizeGrants([{ kind: 'act', access: 'read' }])).toBe(false);
  });

  it('un atelier n\'y figure qu\'une fois, le niveau le plus haut l\'emporte', () => {
    const result = normalizeGrants([
      { kind: 'cctp', access: 'read' },
      { kind: 'cctp', access: 'comment' },
      { kind: 'cctp', access: 'read' },
      { kind: 'dpgf', access: 'read' },
    ]) as any;
    expect(result.grants.map((g: any) => `${g.kind}:${g.access}`).sort()).toEqual(['cctp:comment', 'dpgf:read']);
  });

  it('le CCTP et le DPGF sont deux ateliers distincts, et un lot ne change rien au droit', () => {
    const grants = (normalizeGrants([{ kind: 'cctp', access: 'comment' }, { kind: 'tasks', access: 'write' }]) as any).grants;
    expect(allows(grants, 'cctp', 'read')).toBe(true);
    expect(allows(grants, 'cctp', 'comment')).toBe(true);
    expect(allows(grants, 'cctp', 'write')).toBe(false); // commenter ne permet pas de proposer
    expect(allows(grants, 'cctp', 'read', 'n-importe-quel-lot')).toBe(true);
    expect(allows(grants, 'dpgf', 'read')).toBe(false); // le CCTP ne donne pas les prix du DPGF
    expect(allows(grants, 'tasks', 'read')).toBe(true);
    expect(allows([], 'cctp', 'read')).toBe(false);
  });

  it('borne la taille d\'une liste de droits et le commentaire', () => {
    const many = Array.from({ length: 201 }, () => ({ kind: 'cctp', access: 'read' }));
    expect('error' in normalizeGrants(many)).toBe(true);
    expect('error' in readCommentBody('   ')).toBe(true);
    expect('error' in readCommentBody('x'.repeat(2001))).toBe(true);
    expect(readCommentBody('  ok  ')).toEqual({ body: 'ok' });
  });
});

describe('vue filtrée du document : fonctions pures', () => {
  const doc = makeDocument('A', 'B');

  it('CCTP : textes sans aucun prix ni quantité, lots accordés seulement', () => {
    const view = guestDocumentView(doc, 'cctp', new Set(['A']));
    expect(view.lots.map((l: any) => l.id)).toEqual(['lot-a']);
    const raw = JSON.stringify(view);
    for (const forbidden of ['prixUnitaire', 'prixTotal', 'quantite', String(PRICE_A), String(PRICE_B), 'totalHT', 'totalTTC', 'TVA']) {
      expect(raw, forbidden).not.toContain(forbidden);
    }
    expect(raw).toContain('Coulées en pleine fouille');
    expect(raw).toContain('Prescription générale'); // la ligne réservée au CCTP y figure
  });

  it('DPGF : quantités et prix du lot accordé, sans texte du CCTP ni ligne réservée au CCTP', () => {
    const view = guestDocumentView(doc, 'dpgf', new Set(['A']));
    const raw = JSON.stringify(view);
    expect(raw).toContain(String(PRICE_A));
    expect(raw).not.toContain(String(PRICE_B));
    expect(raw).not.toContain('cctpDescription');
    expect(raw).not.toContain('Prescription générale');
    expect(raw).not.toContain('chap-a2'); // chapitre réservé au CCTP
    expect(raw).toContain('Armatures'); // sous-article conservé
  });

  it('ne laisse fuir aucun champ interne, quel que soit le mode', () => {
    for (const mode of ['cctp', 'dpgf'] as const) {
      const raw = JSON.stringify(guestDocumentView(doc, mode, new Set(['A', 'B'])));
      for (const internal of ['marqueur', 'bibliotheque-secrete', 'genereParIa', 'articleTypeId', 'fileUrl', 'stockage.interne', 'images']) {
        expect(raw, `${mode} ${internal}`).not.toContain(internal);
      }
    }
  });

  it('ne montre jamais le lot sans rattachement, ni sans droit', () => {
    expect(guestDocumentView(doc, 'dpgf', new Set(['A', 'B'])).lots.map((l: any) => l.id)).toEqual(['lot-a', 'lot-b']);
    expect(guestDocumentView(doc, 'dpgf', new Set()).lots).toEqual([]);
    expect(JSON.stringify(guestDocumentView(doc, 'dpgf', new Set(['A', 'B'])))).not.toContain('Orphelin');
  });

  it('liste les nœuds visibles par type, sous-articles compris, et lit un document illisible sans planter', () => {
    const view = guestDocumentView(doc, 'cctp', new Set(['A']));
    const nodes = visibleNodes(view.lots[0]);
    expect([...nodes.lot]).toEqual(['lot-a']);
    expect([...nodes.chapitre].sort()).toEqual(['chap-a1', 'chap-a2']);
    expect([...nodes.ligne].sort()).toEqual(['lig-a1', 'lig-a1b', 'lig-a2']);
    expect(parseDocument('pas du json')).toBeNull();
    expect(parseDocument(null)).toBeNull();
    expect(parseDocument('[1,2]')).toBeNull();
    expect(parseDocument(JSON.stringify({ lots: [] }))).toEqual({ lots: [] });
    expect(guestDocumentView({}, 'cctp', new Set(['A'])).lots).toEqual([]);
  });
});

describe('lecture par atelier côté invité', () => {
  it('rend le CCTP de tous les lots, sans prix ni totaux quand le DPGF n\'est pas partagé', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'read' }]);
    const res = await request(app).get(`/api/shared/projects/${projectId}/cctp`).set(authHeader(guest.token));
    expect(res.status).toBe(200);
    expect(res.body.lots.map((l: any) => l.id)).toEqual(['lot-a', 'lot-b']);
    expect(res.body.lots[0].titre).toBe('Gros œuvre');
    const raw = JSON.stringify(res.body);
    for (const secret of [String(PRICE_A), String(PRICE_B), 'totalHT', 'totalTTC']) expect(raw, secret).not.toContain(secret);
  });

  it('la vue CCTP porte les chiffres des lots dès que l\'atelier DPGF est partagé, jamais les totaux du document', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'read' }, { kind: 'dpgf', access: 'read' }]);
    const res = await request(app).get(`/api/shared/projects/${projectId}/cctp`).set(authHeader(guest.token));
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).toContain(String(PRICE_A));
    expect(raw).toContain(String(PRICE_B));
    for (const secret of ['totalHT', 'totalTTC']) expect(raw, secret).not.toContain(secret);
  });

  it('rend le DPGF de tous les lots avec leurs prix, jamais les totaux du document', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'read' }]);
    const res = await request(app).get(`/api/shared/projects/${projectId}/dpgf`).set(authHeader(guest.token));
    expect(res.status).toBe(200);
    expect(res.body.lots.map((l: any) => l.id)).toEqual(['lot-a', 'lot-b']);
    const raw = JSON.stringify(res.body);
    expect(raw).toContain(String(PRICE_A));
    expect(raw).not.toContain('totalHT');
  });

  it('un atelier non accordé reste fermé : le CCTP seul n\'ouvre pas le DPGF', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'read' }]);
    const res = await request(app).get(`/api/shared/projects/${projectId}/dpgf`).set(authHeader(guest.token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SHARE_FORBIDDEN');
  });

  it('refuse le CCTP sans droit, et une affaire non partagée est introuvable', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'tasks', access: 'read' }]);
    expect((await request(app).get(`/api/shared/projects/${projectId}/cctp`).set(authHeader(guest.token))).status).toBe(403);
    expect((await request(app).get(`/api/shared/projects/${projectId}-autre/cctp`).set(authHeader(guest.token))).status).toBe(404);
  });

  it('un atelier retiré se ferme immédiatement', async () => {
    const { admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'read' }, { kind: 'dpgf', access: 'read' }]);
    const put = await request(app).put(`/api/projects/${projectId}/shares/${guest.shareId}`).set(authHeader(admin.token))
      .send({ grants: [{ kind: 'dpgf', access: 'read' }] });
    expect(put.status).toBe(200);
    expect((await request(app).get(`/api/shared/projects/${projectId}/cctp`).set(authHeader(guest.token))).status).toBe(403);
    expect((await request(app).get(`/api/shared/projects/${projectId}/dpgf`).set(authHeader(guest.token))).status).toBe(200);
  });

  it('rend 404 sans document, et le panneau reçoit les lots de l\'affaire pour ses libellés', async () => {
    const { tenantId, admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'read' }, { kind: 'dpgf', access: 'read' }]);
    const docs = fakeSupabaseAdmin.getTable('dpgfs');
    docs.splice(0, docs.length, ...docs.filter((d: any) => d.tenant_id !== tenantId));
    expect((await request(app).get(`/api/shared/projects/${projectId}/cctp`).set(authHeader(guest.token))).status).toBe(404);
    const panel = await request(app).get(`/api/projects/${projectId}/shares`).set(authHeader(admin.token));
    expect(panel.body.lots.map((l: any) => l.id).sort()).toEqual([lotA, `${tenantId}-lotB`].sort());
    expect(panel.body.lotScopedKinds).toBeUndefined();
    expect(panel.body.commentableKinds).toEqual(['cctp', 'dpgf']);
    expect(panel.body.kinds).toContain('act');
  });
});

describe('attribution des droits par atelier côté cabinet', () => {
  it('ne connaît plus les lots : un lot envoyé est ignoré et le droit vaut pour l\'atelier', async () => {
    const { admin, projectId } = setup();
    const invite = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token))
      .send({ email: newEmail(), grants: [{ kind: 'cctp', access: 'read', lotId: 'lot-inconnu' }] });
    expect(invite.status).toBe(201);
    expect(invite.body.grants).toEqual([{ kind: 'cctp', access: 'read' }]);
  });

  it('une ligne de droit qui porte encore un lot n\'ouvre rien (refus par défaut, avant la migration)', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'tasks', access: 'read' }]);
    fakeSupabaseAdmin.seed('project_share_grants', [
      { id: `${tenantId}-ancien`, share_id: guest.shareId, tenant_id: tenantId, resource_kind: 'cctp', access: 'write', project_lot_id: 'lot-a' },
    ]);
    expect((await request(app).get(`/api/shared/projects/${projectId}/cctp`).set(authHeader(guest.token))).status).toBe(403);
  });
});

describe('commentaires côté invité', () => {
  const target = (lotId: string, over: Record<string, any> = {}) => ({
    resourceKind: 'cctp', lotId, targetType: 'ligne', targetId: 'lig-a1', body: 'Prévoir un joint de dilatation.', ...over,
  });

  it('commente une ligne du lot accordé, et la retrouve dans son fil', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    const created = await comment(guest.token, projectId, target(lotA));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ resourceKind: 'cctp', lotId: lotA, targetType: 'ligne', targetId: 'lig-a1', authorKind: 'guest', resolvedAt: null });
    const list = await request(app).get(`/api/shared/projects/${projectId}/comments`).set(authHeader(guest.token));
    expect(list.body.map((c: any) => c.body)).toEqual(['Prévoir un joint de dilatation.']);
  });

  it('commente un lot, un chapitre et un sous-article', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    for (const [targetType, targetId] of [['lot', 'lot-a'], ['chapitre', 'chap-a1'], ['ligne', 'lig-a1b']]) {
      expect((await comment(guest.token, projectId, target(lotA, { targetType, targetId }))).status, `${targetType}`).toBe(201);
    }
  });

  it('lecture seule : commenter est refusé', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'read' }, { kind: 'dpgf', access: 'read' }]);
    const res = await comment(guest.token, projectId, target(lotA));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SHARE_FORBIDDEN');
  });

  it('refuse un atelier non partagé et un type non commentable', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }]);
    // Le CCTP est commentable, le DPGF n'est pas partagé : deux ateliers, deux droits.
    expect((await comment(guest.token, projectId, target(lotA, { resourceKind: 'dpgf' }))).status).toBe(403);
    expect((await comment(guest.token, projectId, target(lotA, { resourceKind: 'tasks' }))).status).toBe(400);
  });

  it('ne commente que ce qu\'il voit : élément d\'un autre lot, inexistant, ou réservé au CCTP dans la vue DPGF', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [
      { kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }, { kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' },
    ]);
    expect((await comment(guest.token, projectId, target(lotA, { targetId: 'lig-b1' }))).status).toBe(404);
    expect((await comment(guest.token, projectId, target(lotA, { targetId: 'inventé' }))).status).toBe(404);
    expect((await comment(guest.token, projectId, target(lotA, { targetType: 'chapitre', targetId: 'lig-a1' }))).status).toBe(404);
    // La ligne réservée au CCTP existe dans la vue CCTP, pas dans la vue DPGF.
    expect((await comment(guest.token, projectId, target(lotA, { targetId: 'lig-a2' }))).status).toBe(201);
    expect((await comment(guest.token, projectId, target(lotA, { resourceKind: 'dpgf', targetId: 'lig-a2' }))).status).toBe(404);
    expect((await comment(guest.token, projectId, target(lotA, { resourceKind: 'dpgf', targetType: 'chapitre', targetId: 'chap-a2' }))).status).toBe(404);
  });

  it('valide le corps et refuse une affaire archivée', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    expect((await comment(guest.token, projectId, target(lotA, { body: '   ' }))).status).toBe(400);
    expect((await comment(guest.token, projectId, target(lotA, { body: 'x'.repeat(2001) }))).status).toBe(400);
    expect((await comment(guest.token, projectId, target(lotA, { targetType: 'étage' }))).status).toBe(400);
    fakeSupabaseAdmin.getTable('projects').find((p: any) => p.id === projectId)!.archived_at = '2026-10-31T00:00:00Z';
    const res = await comment(guest.token, projectId, target(lotA));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
  });

  it('chaque confrère ne lit que ses propres fils', async () => {
    const { admin, projectId, lotA } = setup();
    const first = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    const second = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    await comment(first.token, projectId, target(lotA, { body: 'Fil du premier' }));
    await comment(second.token, projectId, target(lotA, { body: 'Fil du second' }));
    const seen = (await request(app).get(`/api/shared/projects/${projectId}/comments`).set(authHeader(first.token))).body;
    expect(seen.map((c: any) => c.body)).toEqual(['Fil du premier']);
    expect(JSON.stringify(seen)).not.toContain('second');
  });

  it('une réponse reste dans le fil du même partage, sur le même élément', async () => {
    const { admin, projectId, lotA } = setup();
    const first = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    const second = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    const root = (await comment(first.token, projectId, target(lotA))).body;
    expect((await comment(first.token, projectId, target(lotA, { parentId: root.id, body: 'Précision' }))).status).toBe(201);
    expect((await comment(first.token, projectId, target(lotA, { parentId: root.id, targetId: 'lig-a2' }))).status).toBe(404);
    expect((await comment(second.token, projectId, target(lotA, { parentId: root.id }))).status).toBe(404);
  });

  it('un atelier retiré masque aussi ses commentaires', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    await comment(guest.token, projectId, target(lotA));
    expect((await request(app).get(`/api/shared/projects/${projectId}/comments`).set(authHeader(guest.token))).body).toHaveLength(1);
    await request(app).put(`/api/projects/${projectId}/shares/${guest.shareId}`).set(authHeader(admin.token)).send({ grants: [{ kind: 'dpgf', access: 'comment' }] });
    expect((await request(app).get(`/api/shared/projects/${projectId}/comments`).set(authHeader(guest.token))).body).toEqual([]);
  });
});

describe('commentaires côté cabinet', () => {
  const target = (lotId: string) => ({ resourceKind: 'cctp', lotId, targetType: 'ligne', targetId: 'lig-a1', body: 'Question sur les semelles.' });

  it('liste tous les commentaires avec l\'adresse du confrère, y répond, et le confrère voit la réponse', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    const root = (await comment(guest.token, projectId, target(lotA))).body;

    const list = await request(app).get(`/api/projects/${projectId}/share-comments`).set(authHeader(admin.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: root.id, guestEmail: guest.email, authorKind: 'guest' });

    const reply = await request(app).post(`/api/projects/${projectId}/share-comments/${root.id}/reply`).set(authHeader(admin.token)).send({ body: 'Voir le plan de fondations.' });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ parentId: root.id, authorKind: 'cabinet', targetId: 'lig-a1' });

    const seen = (await request(app).get(`/api/shared/projects/${projectId}/comments`).set(authHeader(guest.token))).body;
    expect(seen.map((c: any) => c.authorKind)).toEqual(['guest', 'cabinet']);
    expect(seen[1].body).toBe('Voir le plan de fondations.');
  });

  it('dit au cabinet sur quoi porte chaque commentaire, sans rien exposer à l\'invité', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    await comment(guest.token, projectId, target(lotA));
    await comment(guest.token, projectId, { ...target(lotA), targetType: 'lot', targetId: 'lot-a' });
    const list = (await request(app).get(`/api/projects/${projectId}/share-comments`).set(authHeader(admin.token))).body;
    expect(list.map((c: any) => c.targetLabel)).toEqual(['01.1.1 Semelles filantes', 'Lot 01 Gros œuvre']);
    const seen = (await request(app).get(`/api/shared/projects/${projectId}/comments`).set(authHeader(guest.token))).body;
    expect(JSON.stringify(seen)).not.toContain('targetLabel');
  });

  it('marque un commentaire comme traité, puis le rouvre', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    const root = (await comment(guest.token, projectId, target(lotA))).body;
    const done = await request(app).put(`/api/projects/${projectId}/share-comments/${root.id}`).set(authHeader(admin.token)).send({ resolved: true });
    expect(done.status).toBe(200);
    expect(done.body.resolvedAt).not.toBeNull();
    const reopened = await request(app).put(`/api/projects/${projectId}/share-comments/${root.id}`).set(authHeader(admin.token)).send({ resolved: false });
    expect(reopened.body.resolvedAt).toBeNull();
    expect((await request(app).put(`/api/projects/${projectId}/share-comments/${root.id}`).set(authHeader(admin.token)).send({ resolved: 'oui' })).status).toBe(400);
  });

  it('réservé aux administrateurs et managers, et cloisonné par cabinet', async () => {
    const { tenantId, admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    const root = (await comment(guest.token, projectId, target(lotA))).body;
    const user = makeUser(tenantId, 'user');
    expect((await request(app).get(`/api/projects/${projectId}/share-comments`).set(authHeader(user.token))).status).toBe(403);
    expect((await request(app).post(`/api/projects/${projectId}/share-comments/${root.id}/reply`).set(authHeader(user.token)).send({ body: 'x' })).status).toBe(403);
    const intruder = setup();
    expect((await request(app).get(`/api/projects/${projectId}/share-comments`).set(authHeader(intruder.admin.token))).status).toBe(404);
    expect((await request(app).post(`/api/projects/${projectId}/share-comments/${root.id}/reply`).set(authHeader(intruder.admin.token)).send({ body: 'x' })).status).toBe(404);
    expect((await request(app).put(`/api/projects/${projectId}/share-comments/${root.id}`).set(authHeader(intruder.admin.token)).send({ resolved: true })).status).toBe(404);
  });

  it('un confrère ne peut pas atteindre les routes du cabinet (garde par défaut)', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment' }, { kind: 'dpgf', access: 'comment' }]);
    const res = await request(app).get(`/api/projects/${projectId}/share-comments`).set(authHeader(guest.token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GUEST_FORBIDDEN');
  });
});
