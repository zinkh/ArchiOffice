// Écriture d'un confrère sur les textes du CCTP, par proposition validée par le cabinet.
// Les routes passent par la vraie application Express contre le faux Supabase en mémoire
// (tests/testServer.ts). Les textes sont synthétiques.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { PROPOSABLE_FIELDS, findRawNode, textField } from '../server/projectShares/documentView';
import { MAX_PENDING_PER_SHARE, MAX_PROPOSAL_VALUE, readProposalInput } from '../server/routes/projectShareProposals';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

const CHAP_TEXT = 'Béton armé [b]C25/30[/b], coulé en place.';
const LIGNE_TEXT = 'Coulées en pleine fouille.';

function makeDocument(lotA: string, lotB: string) {
  return {
    id: 'doc-1', projectId: 'p', titre: 'DPGF Villa', version: 'V2', dateCreation: '2026-10-01', statut: 'draft',
    totalHT: 15010, TVA: 20, totalTTC: 18012,
    lots: [
      {
        id: 'lot-a', numero: '01', titre: 'Gros œuvre (titre du document)', projectLotId: lotA, sousTotal: 10, marqueur: { statut: 'incomplet' },
        chapitres: [{
          id: 'chap-a1', numero: '1', titre: 'Fondations', cctpDescription: CHAP_TEXT,
          lignes: [{
            id: 'lig-a1', numero: '1.1', designation: 'Semelles filantes', unite: 'm3', quantite: 12, prixUnitaire: 100, prixTotal: 1200,
            type: 'ouvrage', cctpDescription: LIGNE_TEXT, articleTypeId: 'bib-secrete',
            children: [{ id: 'lig-a1b', numero: '1.1.1', designation: 'Armatures', unite: 'kg', quantite: 5, prixUnitaire: 2, prixTotal: 10, type: 'ouvrage' }],
          }, {
            id: 'lig-a2', numero: '1.2', designation: 'Prescription générale', unite: '', quantite: 0, prixUnitaire: 0, prixTotal: 0,
            type: 'commentaire', cctpOnly: true, cctpDescription: 'Texte seul du CCTP',
          }],
        }],
      },
      {
        id: 'lot-b', numero: '02', titre: 'Charpente', projectLotId: lotB, sousTotal: 15000,
        chapitres: [{ id: 'chap-b1', numero: '1', titre: 'Fermes', lignes: [{ id: 'lig-b1', numero: '1.1', designation: 'Fermettes', unite: 'u', quantite: 30, prixUnitaire: 500, prixTotal: 15000, type: 'ouvrage', cctpDescription: 'Texte du lot B' }] }],
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

let seq = 0;
const newEmail = () => { seq += 1; return `confrere-prop-${Date.now()}-${seq}@example.test`; };

async function inviteGuest(adminToken: string, projectId: string, grants: any[]) {
  const email = newEmail();
  const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(adminToken)).send({ email, grants });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = `guest-prop-token-${res.body.userId}`;
  fakeSupabaseAdmin.registerUser(token, { id: res.body.userId, email });
  return { shareId: res.body.id as string, userId: res.body.userId as string, email, token };
}

const propose = (token: string, projectId: string, body: any) =>
  request(app).post(`/api/shared/projects/${projectId}/proposals`).set(authHeader(token)).send(body);

const ligneText = (lotId: string, value: string, over: Record<string, any> = {}) => ({
  lotId, targetType: 'ligne', targetId: 'lig-a1', field: 'cctpDescription', value, ...over,
});

describe('proposition : fonctions pures', () => {
  it('n\'accepte que les champs de la liste fermée, jamais un montant calculé ni un champ interne', () => {
    expect([...PROPOSABLE_FIELDS.lot]).toEqual(['titre']);
    expect([...PROPOSABLE_FIELDS.chapitre]).toEqual(['cctpDescription', 'titre']);
    expect([...PROPOSABLE_FIELDS.ligne]).toEqual(['cctpDescription', 'designation', 'quantite', 'prixUnitaire', 'unite']);
    for (const field of ['prixTotal', 'marqueur', 'children', 'type', 'nature', 'pourMemoire', 'articleTypeId', 'cctpOnly']) {
      expect('error' in readProposalInput({ lotId: 'l', targetType: 'ligne', targetId: 'x', field, value: '1' }), field).toBe(true);
    }
    expect('error' in readProposalInput({ lotId: 'l', targetType: 'lot', targetId: 'x', field: 'cctpDescription', value: 'x' })).toBe(true);
    expect('error' in readProposalInput({ lotId: 'l', targetType: 'chapitre', targetId: 'x', field: 'designation', value: 'x' })).toBe(true);
    expect('error' in readProposalInput({ lotId: 'l', targetType: 'chapitre', targetId: 'x', field: 'prixUnitaire', value: '1' })).toBe(true);
    expect('error' in readProposalInput({ lotId: 'l', targetType: 'ligne', targetId: 'x', field: 'titre', value: 'x' })).toBe(true);
    expect('error' in readProposalInput({ lotId: 'l', targetType: 'lot', targetId: 'x', field: 'titre', value: 'Nouveau' })).toBe(false);
  });

  it('valide, borne et nettoie la valeur', () => {
    const ok = readProposalInput({ lotId: 'l', targetType: 'ligne', targetId: 'x', field: 'designation', value: '  Semelles  ' });
    expect(ok).toEqual({ input: { lotId: 'l', targetType: 'ligne', targetId: 'x', field: 'designation', value: 'Semelles' } });
    expect('error' in readProposalInput({ lotId: 'l', targetType: 'ligne', targetId: 'x', field: 'designation', value: '   ' })).toBe(true);
    expect('error' in readProposalInput({ lotId: 'l', targetType: 'ligne', targetId: 'x', field: 'designation', value: 'x'.repeat(301) })).toBe(true);
    expect('error' in readProposalInput({ lotId: 'l', targetType: 'ligne', targetId: 'x', field: 'cctpDescription', value: 'x'.repeat(MAX_PROPOSAL_VALUE + 1) })).toBe(true);
    expect('error' in readProposalInput({ lotId: 'l', targetType: 'ligne', targetId: 'x', field: 'cctpDescription', value: 42 })).toBe(true);
    expect('error' in readProposalInput(undefined)).toBe(true);
    // Le texte du CCTP garde ses espaces et ses balises : on ne le « nettoie » pas.
    expect(readProposalInput({ lotId: 'l', targetType: 'ligne', targetId: 'x', field: 'cctpDescription', value: ' [b]a[/b] ' }))
      .toEqual({ input: { lotId: 'l', targetType: 'ligne', targetId: 'x', field: 'cctpDescription', value: ' [b]a[/b] ' } });
    // Vider un texte de CCTP est permis (effacer une prescription).
    expect('error' in readProposalInput({ lotId: 'l', targetType: 'ligne', targetId: 'x', field: 'cctpDescription', value: '' })).toBe(false);
  });

  it('retrouve le nœud réel d\'un lot, sous-article compris, et jamais celui d\'un autre lot', () => {
    const doc = makeDocument('A', 'B');
    expect(findRawNode(doc, 'A', 'chapitre', 'chap-a1')?.titre).toBe('Fondations');
    expect(findRawNode(doc, 'A', 'ligne', 'lig-a1')?.designation).toBe('Semelles filantes');
    expect(findRawNode(doc, 'A', 'ligne', 'lig-a1b')?.designation).toBe('Armatures');
    expect(findRawNode(doc, 'A', 'ligne', 'lig-b1')).toBeNull();
    expect(findRawNode(doc, 'B', 'ligne', 'lig-a1')).toBeNull();
    expect(findRawNode(doc, 'A', 'chapitre', 'lig-a1')).toBeNull();
    expect(findRawNode(doc, 'inconnu', 'ligne', 'lig-a1')).toBeNull();
    expect(textField({ x: 1 }, 'cctpDescription')).toBe('');
    expect(textField({ cctpDescription: 'ok' }, 'cctpDescription')).toBe('ok');
  });
});

describe('déposer une proposition', () => {
  it('droit d\'écriture : enregistre la proposition avec le texte que le confrère a vu', async () => {
    const { tenantId, admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    const res = await propose(guest.token, projectId, ligneText(lotA, 'Coulées en pleine fouille, sur béton de propreté.'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending', field: 'cctpDescription', targetType: 'ligne', baseValue: LIGNE_TEXT, proposedValue: 'Coulées en pleine fouille, sur béton de propreté.' });
    const row = fakeSupabaseAdmin.getTable('project_share_proposals').find((p: any) => p.id === res.body.id)!;
    expect(row.tenant_id).toBe(tenantId);
    expect(row.share_id).toBe(guest.shareId);
    expect(row.author_id).toBe(guest.userId);
  });

  it('ne modifie jamais le document', async () => {
    const { admin, projectId, lotA, dpgfId, doc } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    await propose(guest.token, projectId, ligneText(lotA, 'Texte proposé'));
    expect(storedDoc(dpgfId)).toEqual(doc);
  });

  it('proposer exige le droit d\'écriture sur CE lot : lecture, commentaire ou autre lot refusés', async () => {
    const { admin, projectId, lotA, lotB } = setup();
    const reader = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'read', lotId: lotA }]);
    const commenter = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'comment', lotId: lotA }]);
    const otherLot = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotB }]);
    for (const [who, guest] of [['lecture', reader], ['commentaire', commenter], ['autre lot', otherLot]] as const) {
      const res = await propose(guest.token, projectId, ligneText(lotA, 'Texte proposé'));
      expect(res.status, who).toBe(403);
      expect(res.body.code, who).toBe('SHARE_FORBIDDEN');
    }
  });

  it('un droit sur le DPGF ne permet pas de proposer un texte du CCTP', async () => {
    const { admin, projectId, lotA } = setup();
    const dpgfOnly = await inviteGuest(admin.token, projectId, [{ kind: 'dpgf', access: 'comment', lotId: lotA }]);
    const res = await propose(dpgfOnly.token, projectId, ligneText(lotA, 'Texte proposé'));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SHARE_FORBIDDEN');
  });

  it('ne propose de modifier que ce qu\'il voit : élément d\'un autre lot ou inexistant', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    expect((await propose(guest.token, projectId, ligneText(lotA, 'x', { targetId: 'lig-b1' }))).status).toBe(404);
    expect((await propose(guest.token, projectId, ligneText(lotA, 'x', { targetId: 'inventé' }))).status).toBe(404);
    expect((await propose(guest.token, projectId, ligneText(lotA, 'x', { targetType: 'chapitre', targetId: 'lig-a1' }))).status).toBe(404);
  });

  it('refuse un champ hors liste, un intitulé vide, un texte inchangé et une affaire archivée', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    expect((await propose(guest.token, projectId, ligneText(lotA, '9999', { field: 'marqueur' }))).status).toBe(400);
    expect((await propose(guest.token, projectId, ligneText(lotA, '   ', { field: 'designation' }))).status).toBe(400);
    const same = await propose(guest.token, projectId, ligneText(lotA, LIGNE_TEXT));
    expect(same.status).toBe(400);
    expect(same.body.error).toContain('Aucun changement');
    fakeSupabaseAdmin.getTable('projects').find((p: any) => p.id === projectId)!.archived_at = '2026-10-31T00:00:00Z';
    const archived = await propose(guest.token, projectId, ligneText(lotA, 'Texte proposé'));
    expect(archived.status).toBe(409);
    expect(archived.body.code).toBe('PROJECT_ARCHIVED');
  });

  it('une nouvelle proposition sur le même champ remplace la précédente, sans toucher aux autres champs', async () => {
    const { admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    const first = (await propose(guest.token, projectId, ligneText(lotA, 'Première version'))).body;
    const other = (await propose(guest.token, projectId, ligneText(lotA, 'Désignation révisée', { field: 'designation' }))).body;
    const second = (await propose(guest.token, projectId, ligneText(lotA, 'Seconde version'))).body;
    const list = (await request(app).get(`/api/shared/projects/${projectId}/proposals`).set(authHeader(guest.token))).body;
    const status = (id: string) => list.find((p: any) => p.id === id).status;
    expect(status(first.id)).toBe('withdrawn');
    expect(status(second.id)).toBe('pending');
    expect(status(other.id)).toBe('pending');
  });

  it('la limite de propositions en attente refuse la demande et alerte, sans rien perdre', async () => {
    const { tenantId, admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    fakeSupabaseAdmin.seed('project_share_proposals', Array.from({ length: MAX_PENDING_PER_SHARE }, (_, i) => ({
      id: `${tenantId}-bulk-${i}`, tenant_id: tenantId, project_id: projectId, share_id: guest.shareId, author_id: guest.userId,
      project_lot_id: lotA, target_type: 'ligne', target_id: `autre-${i}`, field: 'cctpDescription',
      base_value: '', proposed_value: 'x', status: 'pending', created_at: '2026-11-01T00:00:00Z',
    })));
    const ofTenant = () => fakeSupabaseAdmin.getTable('project_share_proposals').filter((p: any) => p.tenant_id === tenantId);
    const rowsBefore = ofTenant().length;

    const res = await propose(guest.token, projectId, ligneText(lotA, 'Une de trop'));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'PROPOSAL_LIMIT', pending: MAX_PENDING_PER_SHARE, limit: MAX_PENDING_PER_SHARE });
    expect(res.body.error).toContain('Le cabinet en a été informé');
    expect(res.body.error).toContain('Votre texte n\'est pas perdu');

    // Aucune ligne n'a disparu ni changé d'état, et aucune n'a été ajoutée.
    const rows = ofTenant();
    expect(rows).toHaveLength(rowsBefore);
    expect(rows.every((p: any) => p.status === 'pending')).toBe(true);

    // Le cabinet est alerté : notification système aux administrateurs, et trace dans le journal.
    await new Promise(r => setTimeout(r, 30));
    const outbox = fakeSupabaseAdmin.getTable('notification_outbox').filter((n: any) => n.tenant_id === tenantId && n.title === 'Limite de propositions atteinte');
    expect(outbox.map((n: any) => n.user_id)).toEqual([admin.userId]);
    expect(outbox[0].body).toContain(guest.email);
    expect(outbox[0].tag).toBe(`share-limit:${guest.shareId}`);
    const logged = fakeSupabaseAdmin.getTable('activities').filter((a: any) => a.tenant_id === tenantId && String(a.action).includes('Limite de 50'));
    expect(logged).toHaveLength(1);

    // Insister n'inonde pas le cabinet : une seule alerte par heure et par partage.
    await propose(guest.token, projectId, ligneText(lotA, 'Encore une'));
    await new Promise(r => setTimeout(r, 30));
    expect(fakeSupabaseAdmin.getTable('notification_outbox').filter((n: any) => n.tenant_id === tenantId && n.title === 'Limite de propositions atteinte')).toHaveLength(1);

    // Le cabinet voit l'alerte dans sa liste ; l'invité voit son compteur.
    const list = await request(app).get(`/api/projects/${projectId}/share-proposals`).set(authHeader(admin.token));
    expect(list.body.every((p: any) => p.limitReached === true && p.pendingOfShare === MAX_PENDING_PER_SHARE && p.maxPending === MAX_PENDING_PER_SHARE)).toBe(true);
    const mine = await request(app).get(`/api/shared/projects/${projectId}/proposals`).set(authHeader(guest.token));
    expect(mine.body[0]).toMatchObject({ pending: MAX_PENDING_PER_SHARE, limit: MAX_PENDING_PER_SHARE });
  });

  it('remplacer une proposition au niveau de la limite reste possible : elle libère sa propre place', async () => {
    const { tenantId, admin, projectId, lotA } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    const first = (await propose(guest.token, projectId, ligneText(lotA, 'Première version'))).body;
    fakeSupabaseAdmin.seed('project_share_proposals', Array.from({ length: MAX_PENDING_PER_SHARE - 1 }, (_, i) => ({
      id: `${tenantId}-fill-${i}`, tenant_id: tenantId, project_id: projectId, share_id: guest.shareId, author_id: guest.userId,
      project_lot_id: lotA, target_type: 'ligne', target_id: `autre-${i}`, field: 'cctpDescription',
      base_value: '', proposed_value: 'x', status: 'pending', created_at: '2026-11-01T00:00:00Z',
    })));
    const replaced = await propose(guest.token, projectId, ligneText(lotA, 'Seconde version'));
    expect(replaced.status).toBe(201);
    expect(fakeSupabaseAdmin.getTable('project_share_proposals').find((p: any) => p.id === first.id)!.status).toBe('withdrawn');
  });

  it('chaque confrère ne lit que ses propres propositions, et ne retire que les siennes', async () => {
    const { admin, projectId, lotA } = setup();
    const first = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    const second = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }]);
    const mine = (await propose(first.token, projectId, ligneText(lotA, 'Proposition du premier'))).body;
    await propose(second.token, projectId, ligneText(lotA, 'Proposition du second'));
    const seen = (await request(app).get(`/api/shared/projects/${projectId}/proposals`).set(authHeader(first.token))).body;
    expect(seen.map((p: any) => p.proposedValue)).toEqual(['Proposition du premier']);
    expect((await request(app).delete(`/api/shared/projects/${projectId}/proposals/${mine.id}`).set(authHeader(second.token))).status).toBe(404);
    const withdrawn = await request(app).delete(`/api/shared/projects/${projectId}/proposals/${mine.id}`).set(authHeader(first.token));
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe('withdrawn');
    expect((await request(app).delete(`/api/shared/projects/${projectId}/proposals/${mine.id}`).set(authHeader(first.token))).status).toBe(409);
  });

  it('un droit de lecture retiré masque aussi ses propositions', async () => {
    const { admin, projectId, lotA, lotB } = setup();
    const guest = await inviteGuest(admin.token, projectId, [{ kind: 'cctp', access: 'write', lotId: lotA }, { kind: 'cctp', access: 'read', lotId: lotB }]);
    await propose(guest.token, projectId, ligneText(lotA, 'Texte proposé'));
    await request(app).put(`/api/projects/${projectId}/shares/${guest.shareId}`).set(authHeader(admin.token)).send({ grants: [{ kind: 'cctp', access: 'read', lotId: lotB }] });
    expect((await request(app).get(`/api/shared/projects/${projectId}/proposals`).set(authHeader(guest.token))).body).toEqual([]);
  });
});

describe('décision du cabinet', () => {
  async function pendingProposal(over: Record<string, any> = {}) {
    const ctx = setup();
    const guest = await inviteGuest(ctx.admin.token, ctx.projectId, [{ kind: 'cctp', access: 'write', lotId: ctx.lotA }]);
    const res = await propose(guest.token, ctx.projectId, ligneText(ctx.lotA, 'Coulées en pleine fouille, sur béton de propreté.', over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { ...ctx, guest, proposal: res.body };
  }
  const approve = (token: string, projectId: string, id: string) =>
    request(app).post(`/api/projects/${projectId}/share-proposals/${id}/approve`).set(authHeader(token));

  it('liste les propositions avec l\'adresse du confrère, l\'élément visé, l\'état du texte actuel', async () => {
    const { admin, projectId, guest, proposal } = await pendingProposal();
    const list = await request(app).get(`/api/projects/${projectId}/share-proposals`).set(authHeader(admin.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: proposal.id, guestEmail: guest.email, targetLabel: '1.1 Semelles filantes', currentValue: LIGNE_TEXT, outdated: false, status: 'pending',
    });
  });

  it('approuver écrit le champ, et lui seul, après un instantané du document', async () => {
    const { tenantId, admin, projectId, dpgfId, doc, guest, proposal } = await pendingProposal();
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'applied', applied: true });

    const after = storedDoc(dpgfId);
    expect(after.lots[0].chapitres[0].lignes[0].cctpDescription).toBe('Coulées en pleine fouille, sur béton de propreté.');
    // Tout le reste est strictement identique : prix, quantités, marqueurs, titre du document, autre lot.
    after.lots[0].chapitres[0].lignes[0].cctpDescription = LIGNE_TEXT;
    expect(after).toEqual(doc);

    const snapshots = fakeSupabaseAdmin.getTable('dpgf_versions').filter((v: any) => v.tenant_id === tenantId && v.dpgf_id === dpgfId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].label).toContain(guest.email);
    expect(snapshots[0].document).toEqual(doc); // l'état d'AVANT, restaurable
    expect(snapshots[0].created_by).toBeTruthy();

    await new Promise(r => setTimeout(r, 30));
    const logged = fakeSupabaseAdmin.getTable('activities').filter((a: any) => a.tenant_id === tenantId && String(a.action).includes('appliquée'));
    expect(logged.length).toBeGreaterThan(0);
  });

  it('applique aussi une désignation et le texte d\'un chapitre', async () => {
    const ctx = setup();
    const guest = await inviteGuest(ctx.admin.token, ctx.projectId, [{ kind: 'cctp', access: 'write', lotId: ctx.lotA }]);
    const a = (await propose(guest.token, ctx.projectId, ligneText(ctx.lotA, 'Semelles filantes en béton armé', { field: 'designation' }))).body;
    const b = (await propose(guest.token, ctx.projectId, { lotId: ctx.lotA, targetType: 'chapitre', targetId: 'chap-a1', field: 'cctpDescription', value: 'Béton C30/37.' })).body;
    expect((await approve(ctx.admin.token, ctx.projectId, a.id)).status).toBe(200);
    expect((await approve(ctx.admin.token, ctx.projectId, b.id)).status).toBe(200);
    const after = storedDoc(ctx.dpgfId);
    expect(after.lots[0].chapitres[0].lignes[0].designation).toBe('Semelles filantes en béton armé');
    expect(after.lots[0].chapitres[0].cctpDescription).toBe('Béton C30/37.');
    expect(after.lots[0].titre).toBe('Gros œuvre (titre du document)'); // le titre de lot n'est jamais réécrit
  });

  it('une proposition périmée n\'écrit rien : le texte a changé depuis que le confrère l\'a lu', async () => {
    const { tenantId, admin, projectId, dpgfId, proposal } = await pendingProposal();
    const row = fakeSupabaseAdmin.getTable('dpgfs').find((d: any) => d.id === dpgfId)!;
    const edited = JSON.parse(row.data);
    edited.lots[0].chapitres[0].lignes[0].cctpDescription = 'Texte réécrit entre-temps par le cabinet.';
    row.data = JSON.stringify(edited);

    const list = await request(app).get(`/api/projects/${projectId}/share-proposals`).set(authHeader(admin.token));
    expect(list.body[0]).toMatchObject({ outdated: true, currentValue: 'Texte réécrit entre-temps par le cabinet.' });

    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROPOSAL_OUTDATED');
    expect(storedDoc(dpgfId)).toEqual(edited);
    // Périmée avant toute écriture : pas même d'instantané à prendre.
    expect(fakeSupabaseAdmin.getTable('dpgf_versions').filter((v: any) => v.tenant_id === tenantId)).toHaveLength(0);
    const after = await request(app).get(`/api/projects/${projectId}/share-proposals`).set(authHeader(admin.token));
    expect(after.body[0].status).toBe('outdated');
  });

  it('l\'écriture conditionnelle porte sur la révision, jamais sur le document entier (limite d\'URL de PostgREST)', async () => {
    const { admin, projectId, dpgfId, proposal } = await pendingProposal();
    const row = fakeSupabaseAdmin.getTable('dpgfs').find((d: any) => d.id === dpgfId)!;
    const revisionAvant = row.revision;
    const original = fakeSupabaseAdmin.from.bind(fakeSupabaseAdmin);
    const filtres: string[] = [];
    (fakeSupabaseAdmin as any).from = (table: string) => {
      const query = original(table);
      if (table === 'dpgfs') {
        const eq = query.eq.bind(query);
        query.eq = (col: string, value: unknown) => { filtres.push(col); return eq(col, value); };
      }
      return query;
    };
    try {
      const res = await approve(admin.token, projectId, proposal.id);
      expect(res.status).toBe(200);
    } finally {
      delete (fakeSupabaseAdmin as any).from;
    }
    // Un document de plusieurs centaines de Ko ne tient pas dans une URL : seul un petit compteur filtre.
    expect(filtres).not.toContain('data');
    expect(filtres).toContain('revision');
    expect(row.revision).toBe(revisionAvant + 1);
  });

  it('refuse d\'écraser un enregistrement concurrent : écriture conditionnelle, instantané conservé', async () => {
    const { tenantId, admin, projectId, dpgfId, proposal } = await pendingProposal();
    const row = fakeSupabaseAdmin.getTable('dpgfs').find((d: any) => d.id === dpgfId)!;
    const original = fakeSupabaseAdmin.from.bind(fakeSupabaseAdmin);
    let concurrent: any = null;
    (fakeSupabaseAdmin as any).from = (table: string) => {
      const query = original(table);
      if (table === 'dpgfs') {
        const update = query.update.bind(query);
        // Quelqu'un enregistre le document entre la lecture et l'écriture de l'approbation.
        query.update = (patch: any) => {
          concurrent = JSON.parse(row.data);
          concurrent.lots[1].chapitres[0].lignes[0].designation = 'Fermettes (modifiées pendant l\'approbation)';
          row.data = JSON.stringify(concurrent);
          // En base, le déclencheur dpgfs_bump_revision fait avancer la révision à chaque écriture.
          row.revision += 1;
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
    expect(storedDoc(dpgfId)).toEqual(concurrent); // l'enregistrement concurrent est intact
    // Aucune suppression, même ici : l'instantané pris avant la tentative est conservé.
    expect(fakeSupabaseAdmin.getTable('dpgf_versions').filter((v: any) => v.tenant_id === tenantId)).toHaveLength(1);
    const list = await request(app).get(`/api/projects/${projectId}/share-proposals`).set(authHeader(admin.token));
    expect(list.body[0].status).toBe('pending'); // rien n'est perdu : on peut réessayer
  });

  it('une proposition ne s\'approuve qu\'une fois', async () => {
    const { admin, projectId, proposal } = await pendingProposal();
    expect((await approve(admin.token, projectId, proposal.id)).status).toBe(200);
    const again = await approve(admin.token, projectId, proposal.id);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PROPOSAL_NOT_PENDING');
  });

  it('refuser garde le document intact et le motif est lisible par le confrère', async () => {
    const { admin, projectId, dpgfId, doc, guest, proposal } = await pendingProposal();
    const res = await request(app).post(`/api/projects/${projectId}/share-proposals/${proposal.id}/reject`).set(authHeader(admin.token)).send({ note: 'Déjà traité dans le DTU.' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'rejected', decisionNote: 'Déjà traité dans le DTU.' });
    expect(storedDoc(dpgfId)).toEqual(doc);
    const seen = (await request(app).get(`/api/shared/projects/${projectId}/proposals`).set(authHeader(guest.token))).body;
    expect(seen[0]).toMatchObject({ status: 'rejected', decisionNote: 'Déjà traité dans le DTU.' });
    expect((await request(app).delete(`/api/shared/projects/${projectId}/proposals/${proposal.id}`).set(authHeader(guest.token))).status).toBe(409);
    expect((await request(app).post(`/api/projects/${projectId}/share-proposals/${proposal.id}/reject`).set(authHeader(admin.token)).send({})).status).toBe(409);
  });

  it('borne le motif du refus', async () => {
    const { admin, projectId, proposal } = await pendingProposal();
    const res = await request(app).post(`/api/projects/${projectId}/share-proposals/${proposal.id}/reject`).set(authHeader(admin.token)).send({ note: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
  });

  it('une affaire archivée ne reçoit aucune application', async () => {
    const { admin, projectId, dpgfId, doc, proposal } = await pendingProposal();
    fakeSupabaseAdmin.getTable('projects').find((p: any) => p.id === projectId)!.archived_at = '2026-10-31T00:00:00Z';
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
    expect(storedDoc(dpgfId)).toEqual(doc);
  });

  it('réservé aux administrateurs et managers, cloisonné par cabinet, fermé au confrère', async () => {
    const { tenantId, admin, projectId, guest, proposal } = await pendingProposal();
    const user = makeUser(tenantId, 'user');
    const base = `/api/projects/${projectId}/share-proposals`;
    expect((await request(app).get(base).set(authHeader(user.token))).status).toBe(403);
    expect((await approve(user.token, projectId, proposal.id)).status).toBe(403);
    expect((await request(app).post(`${base}/${proposal.id}/reject`).set(authHeader(user.token)).send({})).status).toBe(403);

    const intruder = setup();
    expect((await request(app).get(base).set(authHeader(intruder.admin.token))).status).toBe(404);
    expect((await approve(intruder.admin.token, projectId, proposal.id)).status).toBe(404);
    expect((await request(app).post(`${base}/${proposal.id}/reject`).set(authHeader(intruder.admin.token)).send({})).status).toBe(404);

    // Le confrère ne peut pas approuver sa propre proposition : les routes du cabinet lui sont fermées.
    const own = await approve(guest.token, projectId, proposal.id);
    expect(own.status).toBe(403);
    expect(own.body.code).toBe('GUEST_FORBIDDEN');
    expect((await request(app).get(base).set(authHeader(admin.token))).body[0].status).toBe('pending');
  });
});
