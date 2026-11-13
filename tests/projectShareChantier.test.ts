// Partage d'une affaire avec un confrère : choix dans les contacts du cabinet, et suivi de chantier
// (comptes rendus, réserves AOR, réserves GPA). Les routes passent par la vraie application Express
// contre le faux Supabase en mémoire (tests/testServer.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { normalizeGrants } from '../server/projectShares/access';
import { readNoteFields, readReportFields, readReserveFields } from '../server/routes/projectShareChantier';
import { contactDisplayName, contactEmail } from '../server/routes/projectShares';
import { guestActView } from '../server/projectShares/actView';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

let seq = 0;
const newEmail = () => { seq += 1; return `confrere-chantier-${Date.now()}-${seq}@example.test`; };

function setup() {
  const tenantId = makeTenant();
  const admin = makeUser(tenantId, 'admin');
  const projectId = `${tenantId}-p1`;
  const otherProjectId = `${tenantId}-p2`;
  fakeSupabaseAdmin.seed('projects', [
    { id: projectId, tenant_id: tenantId, name: 'Villa Martin', project_code: '26014' },
    { id: otherProjectId, tenant_id: tenantId, name: 'Autre affaire', project_code: '26015' },
  ]);
  fakeSupabaseAdmin.seed('site_reports', [
    { id: `${tenantId}-r1`, tenant_id: tenantId, project_id: projectId, date: '2026-11-13', report_number: 4, statut: 'brouillon', meteo: 'Pluie', temperature: '8', meetingnotes: 'Notes', nextmeeting: '2026-11-20', lot_tracking: [{ penalite: 100 }], attendance: [{ nom: 'Secret' }] },
    { id: `${tenantId}-r2`, tenant_id: tenantId, project_id: projectId, date: '2026-11-06', report_number: 3, statut: 'diffuse', meteo: 'Soleil' },
    { id: `${tenantId}-r3`, tenant_id: tenantId, project_id: otherProjectId, date: '2026-11-06', report_number: 1, statut: 'brouillon' },
  ]);
  fakeSupabaseAdmin.seed('site_report_notes', [
    { id: `${tenantId}-n1`, tenant_id: tenantId, report_id: `${tenantId}-r1`, category: 'Gros œuvre', note_number: 1, issue_date: '2026-11-13', status: 'open', text: 'Reprendre le chaînage', photos: ['secret/photo.jpg'] },
    { id: `${tenantId}-n2`, tenant_id: tenantId, report_id: `${tenantId}-r2`, category: 'Charpente', note_number: 1, issue_date: '2026-11-06', status: 'open', text: 'Diffusé' },
  ]);
  fakeSupabaseAdmin.seed('reserves', [
    { id: `${tenantId}-a1`, tenant_id: tenantId, project_id: projectId, number: 1, title: 'Fissure cloison', status: 'A faire', x: 12, y: 40, plan_id: 'plan-secret' },
    { id: `${tenantId}-a2`, tenant_id: tenantId, project_id: otherProjectId, number: 1, title: 'Autre affaire', status: 'A faire' },
  ]);
  fakeSupabaseAdmin.seed('gpa_reserves', [
    { id: `${tenantId}-g1`, tenant_id: tenantId, project_id: projectId, number: 1, title: 'Porte qui frotte', status: 'A faire' },
  ]);
  return { tenantId, admin, projectId, otherProjectId };
}

async function invite(adminToken: string, projectId: string, grants: any[], extra: Record<string, unknown> = {}) {
  const email = newEmail();
  const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(adminToken)).send({ email, grants, ...extra });
  expect(res.status).toBe(201);
  const token = `guest-token-${res.body.userId}`;
  fakeSupabaseAdmin.registerUser(token, { id: res.body.userId, email });
  return { shareId: res.body.id as string, token, email };
}

describe('droits de suivi de chantier : fonctions pures', () => {
  it('accepte l\'écriture sur les comptes rendus et les réserves, pas le commentaire', () => {
    expect('grants' in normalizeGrants([{ kind: 'reports', access: 'write' }, { kind: 'reserves', access: 'read' }, { kind: 'gpa', access: 'write' }])).toBe(true);
    expect('error' in normalizeGrants([{ kind: 'reports', access: 'comment' }])).toBe(true);
    expect('error' in normalizeGrants([{ kind: 'gpa', access: 'comment' }])).toBe(true);
  });

  it('ne retient que les champs autorisés d\'une réserve et valide leurs formats', () => {
    expect(readReserveFields({ status: 'Levée', reponse: ' Fait ', title: 'Autre', lots: 'x', plan_id: 'p', tenant_id: 'autre' }))
      .toEqual({ fields: { status: 'Levée', reponse: 'Fait' } });
    expect('error' in readReserveFields({ status: 'Inventé' })).toBe(true);
    expect('error' in readReserveFields({ due_date: '13/11/2026' })).toBe(true);
    expect(readReserveFields({ due_date: '' })).toEqual({ fields: { due_date: null } });
  });

  it('une rubrique garde son nom, un compte rendu écrit les colonnes en minuscules', () => {
    expect(readNoteFields({ category: 'Renommée', text: 'Ok' }, 'update')).toEqual({ fields: { text: 'Ok' } });
    expect('error' in readNoteFields({ text: 'Sans rubrique' }, 'create')).toBe(true);
    expect(readReportFields({ meetingNotes: 'N', nextMeeting: '2026-12-01', statut: 'diffuse', date: '2000-01-01' }))
      .toEqual({ fields: { meetingnotes: 'N', nextmeeting: '2026-12-01' } });
  });

  it('lit l\'adresse d\'une fiche contact, la professionnelle d\'abord', () => {
    expect(contactEmail({ email: 'B@x.fr', email_work: ' A@X.fr ' })).toBe('a@x.fr');
    expect(contactEmail({ first_name: 'Ana' })).toBe('');
    expect(contactDisplayName({ first_name: 'Ana', last_name: 'Roy', company_name: 'Atelier' })).toBe('Ana Roy');
    expect(contactDisplayName({ company_name: 'Atelier' })).toBe('Atelier');
  });
});

describe('invitation depuis les contacts du cabinet', () => {
  it('invite à partir d\'une fiche, en reprend l\'adresse et la garde sur le partage', async () => {
    const { tenantId, admin, projectId } = setup();
    const email = newEmail();
    const contactId = `${tenantId}-c1`;
    fakeSupabaseAdmin.seed('contacts', [{ id: contactId, tenant_id: tenantId, first_name: 'Ana', last_name: 'Roy', email_work: email.toUpperCase() }]);
    const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token))
      .send({ contact_id: contactId, email: 'ignoree@example.test', grants: [{ kind: 'lots', access: 'read' }] });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(email);
    expect(res.body.contactId).toBe(contactId);
    const list = await request(app).get(`/api/projects/${projectId}/shares`).set(authHeader(admin.token));
    expect(list.body.shares[0].contactId).toBe(contactId);
  });

  it('refuse une fiche sans adresse, ou d\'un autre cabinet', async () => {
    const { tenantId, admin, projectId } = setup();
    const other = makeTenant();
    fakeSupabaseAdmin.seed('contacts', [
      { id: `${tenantId}-sans`, tenant_id: tenantId, first_name: 'Sans', last_name: 'Adresse' },
      { id: `${other}-etranger`, tenant_id: other, first_name: 'Autre', last_name: 'Cabinet', email_work: newEmail() },
    ]);
    const grants = [{ kind: 'lots', access: 'read' }];
    const noMail = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token)).send({ contact_id: `${tenantId}-sans`, grants });
    expect(noMail.status).toBe(400);
    expect(noMail.body.code).toBe('CONTACT_NO_EMAIL');
    const foreign = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token)).send({ contact_id: `${other}-etranger`, grants });
    expect(foreign.status).toBe(400);
  });

  it('la fiche du contact liste les affaires partagées avec lui', async () => {
    const { tenantId, admin, projectId } = setup();
    const contactId = `${tenantId}-c2`;
    fakeSupabaseAdmin.seed('contacts', [{ id: contactId, tenant_id: tenantId, first_name: 'Léa', last_name: 'Cohen', email_work: newEmail() }]);
    await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token)).send({ contact_id: contactId, grants: [{ kind: 'lots', access: 'read' }] }).expect(201);
    const res = await request(app).get(`/api/contacts/${contactId}/projects`).set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: projectId, name: 'Villa Martin', roles: ['Confrère invité'] }]);
  });
});

describe('comptes rendus de chantier partagés', () => {
  it('lit sans fuite : ni présences, ni suivi des lots, ni photos', async () => {
    const { admin, projectId, tenantId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reports', access: 'read' }]);
    const list = await request(app).get(`/api/shared/projects/${projectId}/reports`).set(authHeader(guest.token));
    expect(list.status).toBe(200);
    expect(list.body.map((r: any) => r.report_number)).toEqual([4, 3]);
    expect(list.body[0]).toMatchObject({ meteo: 'Pluie', meetingNotes: 'Notes', nextMeeting: '2026-11-20' });
    expect(JSON.stringify(list.body)).not.toMatch(/penalite|Secret|tenant_id/);
    const notes = await request(app).get(`/api/shared/projects/${projectId}/reports/${tenantId}-r1/notes`).set(authHeader(guest.token));
    expect(notes.status).toBe(200);
    expect(JSON.stringify(notes.body)).not.toMatch(/photo|tenant_id/);
  });

  it('refuse l\'écriture sans le droit, et la lecture sans aucun droit', async () => {
    const { admin, projectId, tenantId } = setup();
    const reader = await invite(admin.token, projectId, [{ kind: 'reports', access: 'read' }]);
    const put = await request(app).put(`/api/shared/projects/${projectId}/reports/${tenantId}-r1`).set(authHeader(reader.token)).send({ meteo: 'Neige' });
    expect(put.status).toBe(403);
    const tasksOnly = await invite(admin.token, projectId, [{ kind: 'tasks', access: 'read' }]);
    expect((await request(app).get(`/api/shared/projects/${projectId}/reports`).set(authHeader(tasksOnly.token))).status).toBe(403);
  });

  it('modifie l\'en-tête et les rubriques, ajoute une rubrique numérotée', async () => {
    const { admin, projectId, tenantId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reports', access: 'write' }]);
    const head = await request(app).put(`/api/shared/projects/${projectId}/reports/${tenantId}-r1`).set(authHeader(guest.token))
      .send({ meteo: 'Neige', statut: 'diffuse', tenant_id: 'autre' });
    expect(head.status).toBe(200);
    expect(head.body.meteo).toBe('Neige');
    const stored = fakeSupabaseAdmin.getTable('site_reports').find((r: any) => r.id === `${tenantId}-r1`);
    expect(stored?.statut).toBe('brouillon');
    expect(stored?.tenant_id).toBe(tenantId);

    const edit = await request(app).put(`/api/shared/projects/${projectId}/reports/${tenantId}-r1/notes/${tenantId}-n1`).set(authHeader(guest.token))
      .send({ status: 'done', text: 'Chaînage repris', category: 'Renommée' });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ status: 'done', text: 'Chaînage repris', category: 'Gros œuvre' });

    const created = await request(app).post(`/api/shared/projects/${projectId}/reports/${tenantId}-r1/notes`).set(authHeader(guest.token))
      .send({ category: 'Plomberie', text: 'Vérifier les évacuations' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ note_number: 2, category: 'Plomberie', status: 'open', issue_date: '2026-11-13' });
  });

  it('un compte rendu diffusé, ou d\'une autre affaire, ne se modifie pas', async () => {
    const { admin, projectId, tenantId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reports', access: 'write' }]);
    const locked = await request(app).put(`/api/shared/projects/${projectId}/reports/${tenantId}-r2`).set(authHeader(guest.token)).send({ meteo: 'Neige' });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('REPORT_LOCKED');
    const lockedNote = await request(app).put(`/api/shared/projects/${projectId}/reports/${tenantId}-r2/notes/${tenantId}-n2`).set(authHeader(guest.token)).send({ text: 'x' });
    expect(lockedNote.status).toBe(409);
    const foreign = await request(app).put(`/api/shared/projects/${projectId}/reports/${tenantId}-r3`).set(authHeader(guest.token)).send({ meteo: 'Neige' });
    expect(foreign.status).toBe(404);
  });

  it('refuse l\'écriture sur une affaire archivée', async () => {
    const { admin, projectId, tenantId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reports', access: 'write' }]);
    Object.assign(fakeSupabaseAdmin.getTable('projects').find((p: any) => p.id === projectId) ?? {}, { archived_at: '2026-11-01T00:00:00Z' });
    const res = await request(app).put(`/api/shared/projects/${projectId}/reports/${tenantId}-r1`).set(authHeader(guest.token)).send({ meteo: 'Neige' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
  });
});

describe('réserves AOR et GPA partagées', () => {
  it('lit les réserves de l\'affaire sans la position sur le plan', async () => {
    const { admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'read' }, { kind: 'gpa', access: 'read' }]);
    const aor = await request(app).get(`/api/shared/projects/${projectId}/reserves`).set(authHeader(guest.token));
    expect(aor.status).toBe(200);
    expect(aor.body.map((r: any) => r.title)).toEqual(['Fissure cloison']);
    expect(JSON.stringify(aor.body)).not.toMatch(/plan-secret|"x"|tenant_id/);
    const gpa = await request(app).get(`/api/shared/projects/${projectId}/gpa-reserves`).set(authHeader(guest.token));
    expect(gpa.body.map((r: any) => r.title)).toEqual(['Porte qui frotte']);
  });

  it('chaque jeu de réserves a son propre droit', async () => {
    const { admin, projectId, tenantId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }]);
    expect((await request(app).get(`/api/shared/projects/${projectId}/gpa-reserves`).set(authHeader(guest.token))).status).toBe(403);
    const put = await request(app).put(`/api/shared/projects/${projectId}/gpa-reserves/${tenantId}-g1`).set(authHeader(guest.token)).send({ status: 'Levée' });
    expect(put.status).toBe(403);
  });

  it('met à jour le suivi d\'une réserve, jamais son identité', async () => {
    const { admin, projectId, tenantId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }, { kind: 'gpa', access: 'write' }]);
    const aor = await request(app).put(`/api/shared/projects/${projectId}/reserves/${tenantId}-a1`).set(authHeader(guest.token))
      .send({ status: 'Levée', reponse: 'Repris', due_date: '2026-12-01', title: 'Piraté', plan_id: 'x' });
    expect(aor.status).toBe(200);
    expect(aor.body).toMatchObject({ status: 'Levée', reponse: 'Repris', due_date: '2026-12-01', title: 'Fissure cloison' });
    const stored = fakeSupabaseAdmin.getTable('reserves').find((r: any) => r.id === `${tenantId}-a1`);
    expect(stored?.plan_id).toBe('plan-secret');
    const gpa = await request(app).put(`/api/shared/projects/${projectId}/gpa-reserves/${tenantId}-g1`).set(authHeader(guest.token)).send({ status: 'En cours' });
    expect(gpa.status).toBe(200);
    expect(gpa.body.status).toBe('En cours');
  });

  it('une réserve d\'une autre affaire est introuvable, un statut inconnu refusé', async () => {
    const { admin, projectId, tenantId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }]);
    expect((await request(app).put(`/api/shared/projects/${projectId}/reserves/${tenantId}-a2`).set(authHeader(guest.token)).send({ status: 'Levée' })).status).toBe(404);
    expect((await request(app).put(`/api/shared/projects/${projectId}/reserves/${tenantId}-a1`).set(authHeader(guest.token)).send({ status: 'Inventé' })).status).toBe(400);
  });
});

describe('atelier ACT partagé', () => {
  const seedAct = (tenantId: string, projectId: string) => {
    fakeSupabaseAdmin.seed('act_data', [{
      id: `${tenantId}-act`, tenant_id: tenantId, project_id: projectId, act_phase: 'collecte',
      lots: [{ id: 'l1', name: 'Gros œuvre' }],
      consultation: {
        criteres: [{ id: 'c1', nom: 'Prix', poids: 60 }],
        dce_documents: [{ id: 'd1', nom: 'CCTP', type_doc: 'CCTP', tous_lots: true, lots_ids: [], file_url: 'secret/dce.pdf' }],
        entreprises: [{ id: 'e1', contact_id: 'contact-secret', nom: 'Entreprise X', email: 'secret@x.fr', emails_supplementaires: 'autre@x.fr', lots_ids: ['l1'], dce_transmis_le: '2026-11-02', offre_recue_le: '2026-11-09' }],
        offres: [{ id: 'o1', lot_id: 'l1', entreprise_id: 'e1', montant_base: 12000, conforme: true, fichier: 'secret/offre.pdf' }],
        attributions: [{ lot_id: 'l1', entreprise_id: 'e1', montant: 12000 }],
        questions: [
          { id: 'q1', entreprise_id: 'e1', entreprise_nom: 'Entreprise X', question: 'Question publique ?', reponse: 'Oui', publique: true },
          { id: 'q2', entreprise_id: 'e1', entreprise_nom: 'Entreprise X', question: 'Question privée ?', publique: false },
        ],
        negociations: { secret: 'tours de négociation' },
      },
    }]);
    fakeSupabaseAdmin.seed('marches_entreprises', [
      { id: `${tenantId}-m1`, tenant_id: tenantId, project_id: projectId, entreprise_nom: 'Entreprise X', lot_numero: '01', lot_titre: 'Gros œuvre', montant_ht: 12000, statut: 'en_cours', retenue_garantie_pct: 5, avance_pct: 5, notes: 'confidentiel' },
    ]);
  };

  it('construit la vue champ par champ : ni coordonnées, ni fichiers, ni négociation, ni questions privées', () => {
    const view = guestActView({
      act_phase: 'collecte', lots: [{ id: 'l1', name: 'Gros œuvre' }],
      consultation: JSON.stringify({ entreprises: [{ id: 'e1', nom: 'X', email: 'secret@x.fr', contact_id: 'c' }], negociations: { a: 1 } }),
    }, [{ id: 'm', entreprise_nom: 'X', montant_ht: 1, retenue_garantie_pct: 5 }]);
    const raw = JSON.stringify(view);
    for (const secret of ['secret@x.fr', 'contact_id', 'negociations', 'retenue_garantie_pct']) expect(raw, secret).not.toContain(secret);
    expect(view.entreprises).toHaveLength(1);
    expect(guestActView(null, []).entreprises).toEqual([]);
  });

  it('lit la consultation, les offres et les marchés avec le droit de lecture de l\'atelier', async () => {
    const { admin, projectId, tenantId } = setup();
    seedAct(tenantId, projectId);
    const guest = await invite(admin.token, projectId, [{ kind: 'act', access: 'read' }]);
    const res = await request(app).get(`/api/shared/projects/${projectId}/act`).set(authHeader(guest.token));
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('collecte');
    expect(res.body.entreprises[0]).toMatchObject({ nom: 'Entreprise X', offre_recue_le: '2026-11-09' });
    expect(res.body.offres[0]).toMatchObject({ lot_id: 'l1', montant_base: 12000 });
    expect(res.body.attributions[0]).toMatchObject({ montant: 12000 });
    expect(res.body.marches[0]).toMatchObject({ entreprise_nom: 'Entreprise X', montant_ht: 12000 });
    expect(res.body.questions.map((q: any) => q.question)).toEqual(['Question publique ?']);
    const raw = JSON.stringify(res.body);
    for (const secret of ['secret@x.fr', 'autre@x.fr', 'contact-secret', 'secret/', 'confidentiel', 'retenue_garantie_pct', 'tours de négociation', 'Question privée', 'tenant_id']) {
      expect(raw, secret).not.toContain(secret);
    }
  });

  it('refuse sans le droit, et une affaire non partagée est introuvable', async () => {
    const { admin, projectId, tenantId } = setup();
    seedAct(tenantId, projectId);
    const tasksOnly = await invite(admin.token, projectId, [{ kind: 'tasks', access: 'read' }]);
    const res = await request(app).get(`/api/shared/projects/${projectId}/act`).set(authHeader(tasksOnly.token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SHARE_FORBIDDEN');
    const reader = await invite(admin.token, projectId, [{ kind: 'act', access: 'read' }]);
    expect((await request(app).get(`/api/shared/projects/${projectId}-autre/act`).set(authHeader(reader.token))).status).toBe(404);
  });

  it('l\'ACT n\'a pas de modification : accorder l\'écriture est refusé', async () => {
    const { admin, projectId } = setup();
    const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token))
      .send({ email: newEmail(), grants: [{ kind: 'act', access: 'write' }] });
    expect(res.status).toBe(400);
  });
});
