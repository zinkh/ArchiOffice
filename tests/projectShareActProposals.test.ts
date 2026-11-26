// Modification de l'atelier ACT par un confrère : PAR PROPOSITION. Un confrère n'écrit jamais dans la
// consultation ; le cabinet approuve, et seule l'approbation écrit (valeur de départ vérifiée, écriture
// conditionnelle). Routes réelles contre le faux Supabase en mémoire (tests/testServer.ts). Données synthétiques.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { applyActField, blockedActEdit, parseActValue, readActField, replaceActNode } from '../server/routes/projectShareActProposals';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

let seq = 0;
const newEmail = () => { seq += 1; return `confrere-act-${Date.now()}-${seq}@example.test`; };

const consultation = () => ({
  entreprises: [
    { id: 'e1', nom: 'Entreprise X', email: 'secret@x.fr', lots_ids: ['l1'], relance_le: '2026-11-20' },
    { id: 'e2', nom: 'Entreprise Y', lots_ids: ['l1'] },
  ],
  offres: [
    { id: 'o1', lot_id: 'l1', entreprise_id: 'e1', montant_base: 12000, note_technique: 7, conforme: true, motif_nc: '' },
    { id: 'o2', lot_id: 'l1', entreprise_id: 'e2', montant_base: 9000, note_technique: 5, conforme: true, mode_saisie: 'postes' },
  ],
  attributions: [{ lot_id: 'l1', entreprise_id: 'e1', montant: 12000 }],
});

function setup() {
  const tenantId = makeTenant();
  const admin = makeUser(tenantId, 'admin');
  const projectId = `${tenantId}-p1`;
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, name: 'Villa Martin', project_code: '26014' }]);
  fakeSupabaseAdmin.seed('act_data', [{
    id: `${tenantId}-act`, tenant_id: tenantId, project_id: projectId, act_phase: 'collecte', updated_at: '2026-11-01T10:00:00.000Z',
    lots: [{ id: 'l1', name: 'Gros œuvre' }], consultation: consultation(),
  }]);
  return { tenantId, admin, projectId };
}

const storedAct = (tenantId: string) => fakeSupabaseAdmin.getTable('act_data').find((r: any) => r.tenant_id === tenantId)!;
const storedOffre = (tenantId: string, id: string) => storedAct(tenantId).consultation.offres.find((o: any) => o.id === id);

async function invite(adminToken: string, projectId: string, grants: any[]) {
  const email = newEmail();
  const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(adminToken)).send({ email, grants });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = `guest-act-token-${res.body.userId}`;
  fakeSupabaseAdmin.registerUser(token, { id: res.body.userId, email });
  return { shareId: res.body.id as string, token, email };
}

const propose = (token: string, projectId: string, body: any) =>
  request(app).post(`/api/shared/projects/${projectId}/act-proposals`).set(authHeader(token)).send(body);
const approve = (token: string, projectId: string, id: string) =>
  request(app).post(`/api/projects/${projectId}/share-act-proposals/${id}/approve`).set(authHeader(token));
const montant = (value: unknown, over: Record<string, unknown> = {}) => ({ targetType: 'offre', targetId: 'o1', field: 'montant_base', value, ...over });

describe('propositions ACT : fonctions pures', () => {
  it('valide et met sous forme canonique chaque champ', () => {
    expect(parseActValue('montant_base', '11500,5')).toEqual({ value: '11500.5' });
    expect('error' in parseActValue('montant_base', '-1')).toBe(true);
    expect('error' in parseActValue('montant_base', 'abc')).toBe(true);
    expect('error' in parseActValue('note_technique', '101')).toBe(true);
    expect(parseActValue('note_technique', '8')).toEqual({ value: '8' });
    expect(parseActValue('conforme', false)).toEqual({ value: 'false' });
    expect('error' in parseActValue('ne_repond_pas', 'peut-être')).toBe(true);
    expect(parseActValue('relance_le', '')).toEqual({ value: '' });
    expect('error' in parseActValue('relance_le', '20/11/2026')).toBe(true);
    expect('error' in parseActValue('motif_nc', 'x'.repeat(501))).toBe(true);
  });

  it('lit la valeur actuelle, applique sur une copie et ne touche pas au reste', () => {
    const c = consultation();
    expect(readActField(c.offres[0], 'montant_base')).toBe('12000');
    expect(readActField(c.offres[0], 'conforme')).toBe('true');
    expect(readActField(c.entreprises[1], 'relance_le')).toBe('');
    const next = applyActField(c.offres[0], 'montant_base', '11500');
    expect(next.montant_base).toBe(11500);
    expect(c.offres[0].montant_base).toBe(12000);
    const replaced = replaceActNode(c, 'offre', 'o1', next);
    expect(replaced.offres[0].montant_base).toBe(11500);
    expect(replaced.offres[1]).toBe(c.offres[1]);
    expect(replaced.attributions).toBe(c.attributions);
    expect(applyActField({ id: 'e', relance_le: '2026-11-20' }, 'relance_le', '')).toEqual({ id: 'e' });
  });

  it('refuse de proposer le montant d\'une offre calculée poste par poste', () => {
    expect(blockedActEdit({ mode_saisie: 'postes' }, 'montant_base')).toContain('poste par poste');
    expect(blockedActEdit({ mode_saisie: 'postes' }, 'conforme')).toBeNull();
    expect(blockedActEdit({ mode_saisie: 'total' }, 'montant_base')).toBeNull();
  });
});

describe('côté confrère', () => {
  it('propose une modification : rien n\'est écrit dans la consultation', async () => {
    const { admin, projectId, tenantId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'act', access: 'write' }]);
    const res = await propose(guest.token, projectId, montant('11500'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ targetType: 'offre', targetId: 'o1', field: 'montant_base', baseValue: '12000', proposedValue: '11500', status: 'pending' });
    expect(storedOffre(tenantId, 'o1').montant_base).toBe(12000);
  });

  it('une seconde proposition sur le même champ remplace la première', async () => {
    const { admin, projectId, tenantId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'act', access: 'write' }]);
    const first = (await propose(guest.token, projectId, montant('11500'))).body;
    await propose(guest.token, projectId, montant('11000'));
    const list = (await request(app).get(`/api/shared/projects/${projectId}/act-proposals`).set(authHeader(guest.token))).body;
    expect(list.find((p: any) => p.id === first.id).status).toBe('withdrawn');
    expect(list.filter((p: any) => p.status === 'pending').map((p: any) => p.proposedValue)).toEqual(['11000']);
    expect(storedOffre(tenantId, 'o1').montant_base).toBe(12000);
  });

  it('refuse un droit insuffisant, un champ hors liste, un élément inconnu ou inchangé', async () => {
    const { admin, projectId } = setup();
    const reader = await invite(admin.token, projectId, [{ kind: 'act', access: 'read' }]);
    expect((await propose(reader.token, projectId, montant('11500'))).status).toBe(403);
    const none = await invite(admin.token, projectId, [{ kind: 'tasks', access: 'read' }]);
    expect((await propose(none.token, projectId, montant('11500'))).status).toBe(403);
    const guest = await invite(admin.token, projectId, [{ kind: 'act', access: 'write' }]);
    expect((await propose(guest.token, projectId, montant('1', { field: 'attributions' }))).status).toBe(400);
    expect((await propose(guest.token, projectId, montant('1', { targetType: 'entreprise' }))).status).toBe(400); // montant_base n'est pas un champ d'entreprise
    expect((await propose(guest.token, projectId, montant('1', { targetId: 'inconnu' }))).status).toBe(404);
    const same = await propose(guest.token, projectId, montant('12000'));
    expect(same.status).toBe(400);
    expect(same.body.error).toContain('Aucun changement');
    expect((await propose(guest.token, projectId, montant('-5'))).status).toBe(400);
  });

  it('refuse le montant d\'une offre saisie poste par poste, mais accepte sa conformité', async () => {
    const { admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'act', access: 'write' }]);
    expect((await propose(guest.token, projectId, montant('8000', { targetId: 'o2' }))).status).toBe(400);
    const conform = await propose(guest.token, projectId, montant(false, { targetId: 'o2', field: 'conforme' }));
    expect(conform.status).toBe(201);
    expect(conform.body.proposedValue).toBe('false');
  });

  it('propose sur une entreprise consultée : date de relance et « ne répond pas »', async () => {
    const { admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'act', access: 'write' }]);
    const relance = await propose(guest.token, projectId, { targetType: 'entreprise', targetId: 'e2', field: 'relance_le', value: '2026-12-01' });
    expect(relance.status).toBe(201);
    expect(relance.body.baseValue).toBe('');
    const silent = await propose(guest.token, projectId, { targetType: 'entreprise', targetId: 'e1', field: 'ne_repond_pas', value: true });
    expect(silent.status).toBe(201);
  });

  it('refuse sur une affaire archivée', async () => {
    const { admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'act', access: 'write' }]);
    Object.assign(fakeSupabaseAdmin.getTable('projects').find((p: any) => p.id === projectId) ?? {}, { archived_at: '2026-11-05T00:00:00Z' });
    const res = await propose(guest.token, projectId, montant('11500'));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
  });

  it('ne lit et ne retire que ses propres propositions', async () => {
    const { admin, projectId } = setup();
    const first = await invite(admin.token, projectId, [{ kind: 'act', access: 'write' }]);
    const second = await invite(admin.token, projectId, [{ kind: 'act', access: 'write' }]);
    const mine = (await propose(first.token, projectId, montant('11500'))).body;
    const seen = (await request(app).get(`/api/shared/projects/${projectId}/act-proposals`).set(authHeader(second.token))).body;
    expect(seen).toEqual([]);
    expect((await request(app).delete(`/api/shared/projects/${projectId}/act-proposals/${mine.id}`).set(authHeader(second.token))).status).toBe(404);
    const withdrawn = await request(app).delete(`/api/shared/projects/${projectId}/act-proposals/${mine.id}`).set(authHeader(first.token));
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe('withdrawn');
    expect((await request(app).delete(`/api/shared/projects/${projectId}/act-proposals/${mine.id}`).set(authHeader(first.token))).status).toBe(409);
  });
});

describe('décision du cabinet', () => {
  async function pending(over: Record<string, unknown> = {}) {
    const ctx = setup();
    const guest = await invite(ctx.admin.token, ctx.projectId, [{ kind: 'act', access: 'write' }]);
    const res = await propose(guest.token, ctx.projectId, montant('11500', over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { ...ctx, guest, proposal: res.body };
  }

  it('liste les propositions avec l\'adresse du confrère, l\'élément visé et la valeur actuelle', async () => {
    const { admin, projectId, guest } = await pending();
    const list = await request(app).get(`/api/projects/${projectId}/share-act-proposals`).set(authHeader(admin.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ guestEmail: guest.email, targetLabel: 'Entreprise X · Gros œuvre', currentValue: '12000', proposedValue: '11500', outdated: false });
  });

  it('approuver écrit la valeur, et seulement elle', async () => {
    const { admin, projectId, tenantId, proposal } = await pending();
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('applied');
    expect(storedOffre(tenantId, 'o1')).toMatchObject({ montant_base: 11500, note_technique: 7, conforme: true });
    expect(storedOffre(tenantId, 'o2').montant_base).toBe(9000);
    expect(storedAct(tenantId).consultation.attributions).toEqual(consultation().attributions);
    expect(storedAct(tenantId).consultation.entreprises[0].email).toBe('secret@x.fr');
    expect((await approve(admin.token, projectId, proposal.id)).status).toBe(409); // déjà traitée
  });

  it('réécrit une consultation enregistrée comme texte JSON dans la même forme', async () => {
    const { admin, projectId, tenantId, proposal } = await pending();
    const row = storedAct(tenantId);
    row.consultation = JSON.stringify(row.consultation);
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status).toBe(200);
    expect(typeof storedAct(tenantId).consultation).toBe('string');
    expect(JSON.parse(storedAct(tenantId).consultation).offres[0].montant_base).toBe(11500);
  });

  it('une proposition périmée n\'écrit rien', async () => {
    const { admin, projectId, tenantId, proposal } = await pending();
    storedOffre(tenantId, 'o1').montant_base = 12500; // le cabinet a saisi autre chose entre-temps
    const list = await request(app).get(`/api/projects/${projectId}/share-act-proposals`).set(authHeader(admin.token));
    expect(list.body[0].outdated).toBe(true);
    const res = await approve(admin.token, projectId, proposal.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROPOSAL_OUTDATED');
    expect(storedOffre(tenantId, 'o1').montant_base).toBe(12500);
    const after = await request(app).get(`/api/projects/${projectId}/share-act-proposals`).set(authHeader(admin.token));
    expect(after.body[0].status).toBe('outdated');
  });

  it('n\'écrase pas une consultation enregistrée pendant l\'application : écriture conditionnelle', async () => {
    const { admin, projectId, tenantId, proposal } = await pending();
    const original = fakeSupabaseAdmin.from.bind(fakeSupabaseAdmin);
    (fakeSupabaseAdmin as any).from = (table: string) => {
      const query = original(table);
      if (table === 'act_data') {
        const update = query.update.bind(query);
        query.update = (patch: any) => {
          storedAct(tenantId).updated_at = '2026-11-02T09:00:00.000Z'; // un autre enregistrement passe juste avant
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
    expect(storedOffre(tenantId, 'o1').montant_base).toBe(12000);
    const list = await request(app).get(`/api/projects/${projectId}/share-act-proposals`).set(authHeader(admin.token));
    expect(list.body[0].status).toBe('pending'); // rien n'est perdu : on peut réessayer
  });

  it('refuser garde la proposition et le motif, sans rien écrire', async () => {
    const { admin, projectId, tenantId, proposal, guest } = await pending();
    const res = await request(app).post(`/api/projects/${projectId}/share-act-proposals/${proposal.id}/reject`).set(authHeader(admin.token)).send({ note: 'Montant non négocié' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'rejected', decisionNote: 'Montant non négocié' });
    expect(storedOffre(tenantId, 'o1').montant_base).toBe(12000);
    const mine = (await request(app).get(`/api/shared/projects/${projectId}/act-proposals`).set(authHeader(guest.token))).body;
    expect(mine[0]).toMatchObject({ status: 'rejected', decisionNote: 'Montant non négocié' });
  });

  it('est réservé aux administrateurs et managers du cabinet, et au cabinet de l\'affaire', async () => {
    const { projectId, proposal } = await pending();
    const otherTenant = makeTenant();
    const stranger = makeUser(otherTenant, 'admin');
    expect((await approve(stranger.token, projectId, proposal.id)).status).toBe(404);
    const member = makeUser(setup().tenantId, 'user');
    expect((await request(app).get(`/api/projects/${projectId}/share-act-proposals`).set(authHeader(member.token))).status).toBe(403);
  });
});
