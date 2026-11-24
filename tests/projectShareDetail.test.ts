// Partage d'une affaire avec un confrère : le DÉTAIL des ateliers de chantier (issue #688). Présences, suivi par lot
// et pénalités des comptes rendus, photos des rubriques et des réserves, coordonnées des entreprises de l'ACT :
// rien ne sort sans que le cabinet ait coché le détail de l'atelier, et la consultation des coordonnées est tracée.
// Les routes passent par la vraie application Express contre le faux Supabase en mémoire. Données synthétiques.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';
import { allowsDetail, normalizeGrants } from '../server/projectShares/access';
import { guestAttendance, guestLotTracking } from '../server/projectShares/reportDetailView';
import { guestActView } from '../server/projectShares/actView';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });

let seq = 0;
const newEmail = () => { seq += 1; return `confrere-detail-${Date.now()}-${seq}@example.test`; };
const PUBLIC = 'https://fake.supabase.test/storage/v1/object/public';

function setup() {
  const tenantId = makeTenant();
  const admin = makeUser(tenantId, 'admin');
  const projectId = `${tenantId}-p1`;
  const otherProjectId = `${tenantId}-p2`;
  fakeSupabaseAdmin.seed('projects', [
    { id: projectId, tenant_id: tenantId, name: 'Villa Martin', project_code: '26014' },
    { id: otherProjectId, tenant_id: tenantId, name: 'Autre affaire', project_code: '26015' },
  ]);
  fakeSupabaseAdmin.seed('project_lots', [{ id: `${tenantId}-l1`, tenant_id: tenantId, project_id: projectId, lot_number: '01', lot_title: 'Gros œuvre', contact_id: 'fiche-secrete' }]);
  fakeSupabaseAdmin.seed('site_reports', [
    {
      id: `${tenantId}-r1`, tenant_id: tenantId, project_id: projectId, date: '2026-11-13', report_number: 4, statut: 'brouillon', meteo: 'Pluie',
      attendance: [{ name: 'Ana Roy', role: 'Maçon', present: true, contact_id: 'fiche-secrete', diffusion: true }, { name: 'Luc Pic', role: 'Plombier', present: false, excused: true }],
      lot_tracking: [{
        lot_id: `${tenantId}-l1`, status: 'R', effectif: 6, retard_semaine: 2, retard_cumule: 5, batiment_ids: ['b-secret'],
        penalites: [{ id: 'pen1', type: 'retard_execution', jours: 3, montant_jour: 150.5, montant: 1 }],
        intemperies_list: [{ id: 'i1', type: 'pluie', date: '2026-11-12', jours: 1 }],
      }],
    },
    { id: `${tenantId}-r2`, tenant_id: tenantId, project_id: otherProjectId, date: '2026-11-06', report_number: 1, statut: 'brouillon' },
  ]);
  const photoPath = `${tenantId}/notes/n1/p1-photo.jpg`;
  fakeSupabaseAdmin.putObject('meeting-photos', photoPath, 'jpeg');
  fakeSupabaseAdmin.seed('site_report_notes', [
    { id: `${tenantId}-n1`, tenant_id: tenantId, report_id: `${tenantId}-r1`, category: 'Gros œuvre', note_number: 1, status: 'open', text: 'Chaînage', photos: [`${PUBLIC}/meeting-photos/${photoPath}`] },
    { id: `${tenantId}-n2`, tenant_id: tenantId, report_id: `${tenantId}-r2`, category: 'Autre', note_number: 1, status: 'open', text: 'Autre affaire', photos: [`${PUBLIC}/meeting-photos/${photoPath}`] },
  ]);
  const reservePath = `${tenantId}/${tenantId}-a1/ph1-fissure.jpg`;
  fakeSupabaseAdmin.putObject('reserve-photos', reservePath, 'jpeg');
  fakeSupabaseAdmin.putObject('reserve-photos', `${tenantId}/${tenantId}-a1/ph1-thumb.jpg`, 'thumb');
  fakeSupabaseAdmin.seed('reserves', [
    { id: `${tenantId}-a1`, tenant_id: tenantId, project_id: projectId, number: 1, title: 'Fissure', status: 'A faire' },
    { id: `${tenantId}-a2`, tenant_id: tenantId, project_id: otherProjectId, number: 1, title: 'Autre affaire', status: 'A faire' },
  ]);
  fakeSupabaseAdmin.seed('reserve_photos', [
    { id: 'ph1', tenant_id: tenantId, reserve_id: `${tenantId}-a1`, reserve_kind: 'opr', file_url: `${PUBLIC}/reserve-photos/${reservePath}`, thumb_url: `${PUBLIC}/reserve-photos/${tenantId}/${tenantId}-a1/ph1-thumb.jpg`, caption: 'Vue Est' },
    { id: 'ph2', tenant_id: tenantId, reserve_id: `${tenantId}-a2`, reserve_kind: 'opr', file_url: `${PUBLIC}/reserve-photos/${reservePath}`, thumb_url: null, caption: 'Autre affaire' },
  ]);
  fakeSupabaseAdmin.seed('act_data', [{
    id: `${tenantId}-act`, tenant_id: tenantId, project_id: projectId, act_phase: 'ACT', lots: [{ id: 'L1', name: 'Gros œuvre' }],
    consultation: { entreprises: [{ id: 'e1', nom: 'Alpha', contact_id: 'fiche-secrete', email: 'alpha@example.test', emails_supplementaires: 'b@example.test; c@example.test', lots_ids: ['L1'] }] },
  }]);
  return { tenantId, admin, projectId, otherProjectId };
}

async function invite(adminToken: string, projectId: string, grants: any[]) {
  const email = newEmail();
  const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(adminToken)).send({ email, grants });
  expect(res.status).toBe(201);
  const token = `guest-token-${res.body.userId}`;
  fakeSupabaseAdmin.registerUser(token, { id: res.body.userId, email });
  return { shareId: res.body.id as string, token };
}

const get = (token: string, url: string) => request(app).get(url).set(authHeader(token));
const NO_DETAIL = [{ kind: 'reports', access: 'read' }, { kind: 'reserves', access: 'read' }, { kind: 'gpa', access: 'read' }, { kind: 'act', access: 'read' }];
const WITH_DETAIL = NO_DETAIL.map(g => ({ ...g, detail: true }));

describe('droits : le détail se règle atelier par atelier', () => {
  it('accepte le détail sur les ateliers de chantier, combiné à la lecture ou à la modification', () => {
    const parsed = normalizeGrants([{ kind: 'reports', access: 'write', detail: true }, { kind: 'act', access: 'read', detail: true }, { kind: 'gpa', access: 'read' }]);
    expect('grants' in parsed && parsed.grants).toEqual([
      { kind: 'reports', access: 'write', detail: true }, { kind: 'act', access: 'read', detail: true }, { kind: 'gpa', access: 'read' },
    ]);
  });

  it('refuse le détail ailleurs, ou autrement qu\'en booléen, plutôt que de l\'ignorer en silence', () => {
    expect('error' in normalizeGrants([{ kind: 'cctp', access: 'read', detail: true }])).toBe(true);
    expect('error' in normalizeGrants([{ kind: 'lots', access: 'read', detail: true }])).toBe(true);
    expect('error' in normalizeGrants([{ kind: 'reports', access: 'read', detail: 'oui' }])).toBe(true);
    expect('grants' in normalizeGrants([{ kind: 'cctp', access: 'read', detail: false }])).toBe(true);
  });

  it('garde le détail demandé quand un atelier est répété, et le niveau le plus haut', () => {
    const parsed = normalizeGrants([{ kind: 'reports', access: 'read', detail: true }, { kind: 'reports', access: 'write' }]);
    expect('grants' in parsed && parsed.grants).toEqual([{ kind: 'reports', access: 'write', detail: true }]);
  });

  it('allowsDetail exige l\'indicateur : un atelier accordé ne suffit pas', () => {
    expect(allowsDetail([{ kind: 'reports', access: 'write' }], 'reports')).toBe(false);
    expect(allowsDetail([{ kind: 'reports', access: 'read', detail: true }], 'reports')).toBe(true);
    expect(allowsDetail([{ kind: 'cctp', access: 'read', detail: true }], 'cctp')).toBe(false);
  });
});

describe('vues de détail : fonctions pures', () => {
  it('présences : nom, fonction, statut ; jamais la fiche contact ni la diffusion', () => {
    const view = guestAttendance([{ name: ' Ana ', role: 'Maçon', present: true, contact_id: 'x', diffusion: true }, { name: 'Luc', excused: true }, { name: 'Zoé', status: 'R', present: true }]);
    expect(view).toEqual([
      { name: 'Ana', role: 'Maçon', status: 'P', present: true, excused: false },
      { name: 'Luc', role: null, status: 'AE', present: false, excused: true },
      { name: 'Zoé', role: null, status: 'R', present: true, excused: false },
    ]);
    expect(JSON.stringify(view)).not.toContain('contact_id');
  });

  it('suivi par lot : montant des pénalités recalculé, lot nommé, bâtiments absents', () => {
    const labels = new Map([['L1', '01 Gros œuvre']]);
    const [lot] = guestLotTracking([{ lot_id: 'L1', batiment_ids: ['b'], penalites: [{ id: 'p', type: 'retard_execution', jours: 3, montant_jour: 150.5, montant: 1 }, { id: 'q', type: 'autre', jours: 'x' }] }], labels);
    expect(lot.lot_label).toBe('01 Gros œuvre');
    expect(lot.penalites).toEqual([{ id: 'p', type: 'retard_execution', motif: null, jours: 3, montant_jour: 150.5, montant: 451.5 }]); // la ligne invalide est écartée
    expect(JSON.stringify(lot)).not.toContain('batiment');
  });

  it('une colonne illisible ne fait jamais échouer la vue', () => {
    expect(guestAttendance('pas du json')).toEqual([]);
    expect(guestLotTracking(null, new Map())).toEqual([]);
    expect(guestAttendance(JSON.stringify([{ name: 'Ana', present: true }]))).toHaveLength(1);
  });

  it('ACT : l\'adresse ne sort qu\'avec le détail, jamais la fiche contact', () => {
    const row = { consultation: { entreprises: [{ id: 'e1', nom: 'Alpha', contact_id: 'c', email: 'a@x.test', emails_supplementaires: 'b@x.test' }] } };
    expect(guestActView(row, []).entreprises[0]).not.toHaveProperty('email');
    const detailed = guestActView(row, [], { detail: true }).entreprises[0];
    expect(detailed).toMatchObject({ email: 'a@x.test', emails_supplementaires: 'b@x.test' });
    expect(detailed).not.toHaveProperty('contact_id');
  });
});

describe('sans détail : rien de plus qu\'avant', () => {
  it('ne montre ni présences, ni pénalités, ni photos, ni adresses, et refuse les photos', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, NO_DETAIL);
    const base = `/api/shared/projects/${projectId}`;

    const reports = (await get(guest.token, `${base}/reports`)).body;
    expect(reports[0]).not.toHaveProperty('attendance');
    expect(reports[0]).not.toHaveProperty('lot_tracking');
    const notes = (await get(guest.token, `${base}/reports/${tenantId}-r1/notes`)).body;
    expect(notes[0]).not.toHaveProperty('photoCount');
    expect((await get(guest.token, `${base}/reserves`)).body[0]).not.toHaveProperty('photos');
    expect(JSON.stringify((await get(guest.token, `${base}/act`)).body)).not.toContain('example.test');

    const noteRes = await get(guest.token, `${base}/reports/${tenantId}-r1/notes/${tenantId}-n1/photos/0`);
    expect(noteRes.status).toBe(403);
    expect(noteRes.body.code).toBe('SHARE_DETAIL_FORBIDDEN');
    expect((await get(guest.token, `${base}/reserves/${tenantId}-a1/photos/ph1`)).status).toBe(403);
  });

  it('un droit de modification seul n\'ouvre pas le détail', async () => {
    const { admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reports', access: 'write' }]);
    const reports = (await get(guest.token, `/api/shared/projects/${projectId}/reports`)).body;
    expect(reports[0]).not.toHaveProperty('attendance');
  });
});

describe('avec le détail : comptes rendus', () => {
  it('rend les présences et le suivi par lot, pénalités comprises, sans fiche contact ni bâtiment', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, WITH_DETAIL);
    const [report] = (await get(guest.token, `/api/shared/projects/${projectId}/reports`)).body;
    expect(report.attendance).toEqual([
      { name: 'Ana Roy', role: 'Maçon', status: 'P', present: true, excused: false },
      { name: 'Luc Pic', role: 'Plombier', status: 'AE', present: false, excused: true },
    ]);
    expect(report.lot_tracking[0]).toMatchObject({ lot_id: `${tenantId}-l1`, lot_label: '01 Gros œuvre', retard_cumule: 5 });
    expect(report.lot_tracking[0].penalites[0]).toMatchObject({ jours: 3, montant_jour: 150.5, montant: 451.5 });
    const text = JSON.stringify(report);
    expect(text).not.toContain('fiche-secrete');
    expect(text).not.toContain('b-secret');
  });

  it('le détail du cabinet apparaît dans la liste des partages, avec les ateliers qui le prévoient', async () => {
    const { admin, projectId } = setup();
    await invite(admin.token, projectId, WITH_DETAIL);
    const list = (await get(admin.token, `/api/projects/${projectId}/shares`)).body;
    expect(list.detailKinds).toEqual(['reports', 'reserves', 'gpa', 'act']);
    expect(list.shares[0].grants.every((g: any) => g.detail === true)).toBe(true);
  });

  it('refuse un détail demandé sur un atelier qui n\'en a pas', async () => {
    const { admin, projectId } = setup();
    const res = await request(app).post(`/api/projects/${projectId}/shares`).set(authHeader(admin.token))
      .send({ email: newEmail(), grants: [{ kind: 'cctp', access: 'read', detail: true }] });
    expect(res.status).toBe(400);
  });
});

describe('avec le détail : photos', () => {
  it('compte les photos d\'une rubrique sans jamais en donner l\'adresse, et les lit par un lien qui expire', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, WITH_DETAIL);
    const base = `/api/shared/projects/${projectId}`;
    const notes = (await get(guest.token, `${base}/reports/${tenantId}-r1/notes`)).body;
    expect(notes[0].photoCount).toBe(1);
    expect(JSON.stringify(notes)).not.toContain('meeting-photos');

    const link = await get(guest.token, `${base}/reports/${tenantId}-r1/notes/${tenantId}-n1/photos/0`);
    expect(link.status).toBe(200);
    expect(link.body.url).toContain('/object/sign/meeting-photos/');
    expect(link.body.expiresIn).toBeGreaterThan(0);
    expect((await get(guest.token, `${base}/reports/${tenantId}-r1/notes/${tenantId}-n1/photos/3`)).status).toBe(404);
    expect((await get(guest.token, `${base}/reports/${tenantId}-r1/notes/${tenantId}-n1/photos/abc`)).status).toBe(404);
  });

  it('une rubrique d\'une autre affaire est introuvable, même avec le détail', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, WITH_DETAIL);
    const base = `/api/shared/projects/${projectId}`;
    // Le compte rendu r2 appartient à l'autre affaire du cabinet : ni lui ni ses rubriques ne sont à portée.
    expect((await get(guest.token, `${base}/reports/${tenantId}-r2/notes/${tenantId}-n2/photos/0`)).status).toBe(404);
    // Une rubrique de r2 désignée sous r1 : le rattachement au compte rendu est vérifié.
    expect((await get(guest.token, `${base}/reports/${tenantId}-r1/notes/${tenantId}-n2/photos/0`)).status).toBe(404);
  });

  it('liste les photos d\'une réserve (identifiant, légende) sans adresse, et sert le fichier ou sa miniature', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, WITH_DETAIL);
    const base = `/api/shared/projects/${projectId}`;
    const [reserve] = (await get(guest.token, `${base}/reserves`)).body;
    expect(reserve.photos).toEqual([{ id: 'ph1', caption: 'Vue Est', uploaded_at: null, has_thumb: true }]);
    expect(JSON.stringify(reserve)).not.toContain('reserve-photos');

    const full = await get(guest.token, `${base}/reserves/${tenantId}-a1/photos/ph1`);
    expect(full.status).toBe(200);
    expect(full.body.url).toContain('ph1-fissure.jpg');
    const thumb = await get(guest.token, `${base}/reserves/${tenantId}-a1/photos/ph1?thumb=1`);
    expect(thumb.body.url).toContain('ph1-thumb.jpg');
  });

  it('la photo d\'une réserve d\'une autre affaire, ou mal rattachée, est introuvable', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, WITH_DETAIL);
    const base = `/api/shared/projects/${projectId}`;
    expect((await get(guest.token, `${base}/reserves/${tenantId}-a2/photos/ph2`)).status).toBe(404); // autre affaire
    expect((await get(guest.token, `${base}/reserves/${tenantId}-a1/photos/ph2`)).status).toBe(404); // photo d'une autre réserve
    expect((await get(guest.token, `${base}/reserves/${tenantId}-a1/photos/inconnue`)).status).toBe(404);
  });

  it('une photo n\'est pas lue par un confrère qui n\'a pas l\'atelier, même avec le détail d\'un autre', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reports', access: 'read', detail: true }]);
    const res = await get(guest.token, `/api/shared/projects/${projectId}/reserves/${tenantId}-a1/photos/ph1`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SHARE_FORBIDDEN');
  });
});

describe('avec le détail : intitulé et position sur le plan d\'une réserve (issue #687)', () => {
  const WRITE_DETAIL = [{ kind: 'reserves', access: 'write', detail: true }, { kind: 'gpa', access: 'write', detail: true }];

  function withPlans(tenantId: string, projectId: string, otherProjectId: string) {
    const planPath = `${tenantId}/plan-rdc.pdf`;
    fakeSupabaseAdmin.putObject('plans', planPath, 'pdf');
    fakeSupabaseAdmin.seed('plans', [
      { id: `${tenantId}-pl1`, tenant_id: tenantId, project_id: projectId, name: 'Plan RDC', category: 'AOR', file_url: `${PUBLIC}/plans/${planPath}` },
      { id: `${tenantId}-pl2`, tenant_id: tenantId, project_id: projectId, name: 'Plan sans catégorie', file_url: `${PUBLIC}/plans/${planPath}` },
      { id: `${tenantId}-pl3`, tenant_id: tenantId, project_id: projectId, name: 'Plan de structure', category: 'PRO', file_url: `${PUBLIC}/plans/${planPath}` },
      { id: `${tenantId}-pl4`, tenant_id: tenantId, project_id: otherProjectId, name: 'Autre affaire', category: 'AOR', file_url: `${PUBLIC}/plans/${planPath}` },
    ]);
  }
  const put = (token: string, url: string, body: any) => request(app).put(url).set(authHeader(token)).send(body);

  it('lit la position de la réserve avec le détail, jamais sans', async () => {
    const { tenantId, admin, projectId } = setup();
    Object.assign(fakeSupabaseAdmin.getTable('reserves').find(r => r.id === `${tenantId}-a1`)!, { plan_id: 'pl1', x: 12.5, y: 40 });
    const detailed = await invite(admin.token, projectId, WITH_DETAIL);
    const plain = await invite(admin.token, projectId, NO_DETAIL);
    const [withDetail] = (await get(detailed.token, `/api/shared/projects/${projectId}/reserves`)).body;
    expect(withDetail).toMatchObject({ plan_id: 'pl1', x: 12.5, y: 40 });
    const [without] = (await get(plain.token, `/api/shared/projects/${projectId}/reserves`)).body;
    expect(without).not.toHaveProperty('plan_id');
    expect(without).not.toHaveProperty('x');
  });

  it('liste les plans AOR de l\'affaire (nom et nature seulement) et refuse sans le détail', async () => {
    const { tenantId, admin, projectId, otherProjectId } = setup();
    withPlans(tenantId, projectId, otherProjectId);
    const guest = await invite(admin.token, projectId, WITH_DETAIL);
    const plain = await invite(admin.token, projectId, NO_DETAIL);
    const res = await get(guest.token, `/api/shared/projects/${projectId}/reserves/plans`);
    expect(res.status).toBe(200);
    expect(res.body.map((p: any) => p.name).sort()).toEqual(['Plan RDC', 'Plan sans catégorie']);
    expect(res.body[0]).toEqual(expect.objectContaining({ pdf: true }));
    expect(JSON.stringify(res.body)).not.toContain('storage');
    expect((await get(plain.token, `/api/shared/projects/${projectId}/reserves/plans`)).status).toBe(403);
  });

  it('sert le fichier d\'un plan AOR de l\'affaire, jamais celui d\'une autre affaire ni d\'une autre catégorie', async () => {
    const { tenantId, admin, projectId, otherProjectId } = setup();
    withPlans(tenantId, projectId, otherProjectId);
    const guest = await invite(admin.token, projectId, WITH_DETAIL);
    const base = `/api/shared/projects/${projectId}/reserves/plans`;
    const ok = await get(guest.token, `${base}/${tenantId}-pl1/file`);
    expect(ok.status).toBe(200);
    expect(ok.body.url).toContain('plan-rdc.pdf');
    expect((await get(guest.token, `${base}/${tenantId}-pl4/file`)).status).toBe(404); // autre affaire
    expect((await get(guest.token, `${base}/${tenantId}-pl3/file`)).status).toBe(404); // plan hors AOR
  });

  it('renomme la réserve avec le droit d\'écriture et le trace, sans toucher au lot', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }]);
    const res = await put(guest.token, `/api/shared/projects/${projectId}/reserves/${tenantId}-a1`, { title: '  Fissure du refend  ', tenant_id: 'autre' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Fissure du refend');
    const row = fakeSupabaseAdmin.getTable('reserves').find(r => r.id === `${tenantId}-a1`)!;
    expect(row.title).toBe('Fissure du refend');
    expect(row.tenant_id).toBe(tenantId);
    await new Promise(r => setTimeout(r, 10));
    expect(fakeSupabaseAdmin.getTable('activities').some(a => a.tenant_id === tenantId && String(a.action).includes('nouvel intitulé'))).toBe(true);
    expect((await put(guest.token, `/api/shared/projects/${projectId}/reserves/${tenantId}-a1`, { title: '   ' })).status).toBe(400);
  });

  it('déplace le repère avec le détail et l\'écriture, retire le repère, et refuse un plan étranger', async () => {
    const { tenantId, admin, projectId, otherProjectId } = setup();
    withPlans(tenantId, projectId, otherProjectId);
    const guest = await invite(admin.token, projectId, WRITE_DETAIL);
    const url = `/api/shared/projects/${projectId}/reserves/${tenantId}-a1`;
    const moved = await put(guest.token, url, { plan_id: `${tenantId}-pl1`, x: 12.5, y: 40 });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ plan_id: `${tenantId}-pl1`, x: 12.5, y: 40 });
    expect((await put(guest.token, url, { plan_id: `${tenantId}-pl4`, x: 1, y: 1 })).status).toBe(404); // autre affaire
    expect((await put(guest.token, url, { plan_id: `${tenantId}-pl3`, x: 1, y: 1 })).status).toBe(404); // hors AOR
    expect((await put(guest.token, url, { plan_id: `${tenantId}-pl1`, x: 120, y: 1 })).status).toBe(400);
    const removed = await put(guest.token, url, { plan_id: null });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ plan_id: null, x: null, y: null });
  });

  it('sans le détail, la position ne s\'écrit pas même avec le droit d\'écriture', async () => {
    const { tenantId, admin, projectId, otherProjectId } = setup();
    withPlans(tenantId, projectId, otherProjectId);
    const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }]);
    const res = await put(guest.token, `/api/shared/projects/${projectId}/reserves/${tenantId}-a1`, { plan_id: `${tenantId}-pl1`, x: 5, y: 5 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SHARE_DETAIL_FORBIDDEN');
    expect(fakeSupabaseAdmin.getTable('reserves').find(r => r.id === `${tenantId}-a1`)!.plan_id).toBeUndefined();
  });

  it('crée une réserve : numéro suivant de l\'affaire, trace, jamais le lot ni le cabinet choisis par le corps', async () => {
    const { tenantId, admin, projectId, otherProjectId } = setup();
    const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }, { kind: 'gpa', access: 'write' }]);
    const post = (path: string, body: any) => request(app).post(`/api/shared/projects/${projectId}/${path}`).set(authHeader(guest.token)).send(body);
    const res = await post('reserves', { title: '  Joint fissuré  ', batiment: 'A', local: 'Cuisine', due_date: '2026-12-15', description: 'À reprendre',
      tenant_id: 'autre', project_id: otherProjectId, number: 99, status: 'Levée', id: 'choisi' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Joint fissuré', batiment: 'A', local: 'Cuisine', number: 2, status: 'Levée' });
    expect(res.body.id).not.toBe('choisi');
    const row = fakeSupabaseAdmin.getTable('reserves').find(r => r.id === res.body.id)!;
    expect(row).toMatchObject({ tenant_id: tenantId, project_id: projectId, number: 2 });
    // Une réserve GPA suit sa propre série.
    const gpa = await post('gpa-reserves', { title: 'Infiltration' });
    expect(gpa.status).toBe(201);
    expect(gpa.body.number).toBe(1);
    expect(gpa.body.status).toBe('A faire');
    await new Promise(r => setTimeout(r, 10));
    expect(fakeSupabaseAdmin.getTable('activities').some(a => a.tenant_id === tenantId && String(a.action).includes('Création') && String(a.action).includes('confrère externe'))).toBe(true);
  });

  it('refuse la création sans intitulé, en lecture seule, ou avec une position sans le détail', async () => {
    const { tenantId, admin, projectId, otherProjectId } = setup();
    withPlans(tenantId, projectId, otherProjectId);
    const writer = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }]);
    const reader = await invite(admin.token, projectId, WITH_DETAIL);
    const url = `/api/shared/projects/${projectId}/reserves`;
    const before = fakeSupabaseAdmin.getTable('reserves').length;
    expect((await request(app).post(url).set(authHeader(writer.token)).send({ title: '   ' })).status).toBe(400);
    expect((await request(app).post(url).set(authHeader(writer.token)).send({})).status).toBe(400);
    expect((await request(app).post(url).set(authHeader(reader.token)).send({ title: 'Lecteur' })).status).toBe(403);
    const withPos = await request(app).post(url).set(authHeader(writer.token)).send({ title: 'Placée', plan_id: `${tenantId}-pl1`, x: 5, y: 5 });
    expect(withPos.status).toBe(403);
    expect(withPos.body.code).toBe('SHARE_DETAIL_FORBIDDEN');
    expect(fakeSupabaseAdmin.getTable('reserves').length).toBe(before);
  });

  it('crée une réserve déjà placée sur un plan avec le détail, jamais sur le plan d\'une autre affaire', async () => {
    const { tenantId, admin, projectId, otherProjectId } = setup();
    withPlans(tenantId, projectId, otherProjectId);
    const guest = await invite(admin.token, projectId, WRITE_DETAIL);
    const url = `/api/shared/projects/${projectId}/reserves`;
    const ok = await request(app).post(url).set(authHeader(guest.token)).send({ title: 'Placée', plan_id: `${tenantId}-pl1`, x: 30, y: 60 });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ plan_id: `${tenantId}-pl1`, x: 30, y: 60 });
    expect((await request(app).post(url).set(authHeader(guest.token)).send({ title: 'Étrangère', plan_id: `${tenantId}-pl4`, x: 1, y: 1 })).status).toBe(404);
  });

  describe('lot et entreprise en charge', () => {
    function withResponsables(tenantId: string, projectId: string) {
      Object.assign(fakeSupabaseAdmin.getTable('project_lots').find(l => l.id === `${tenantId}-l1`)!, { contact_name: 'Alpha Bâtiment' });
      fakeSupabaseAdmin.seed('marches_entreprises', [
        { id: `${tenantId}-m1`, tenant_id: tenantId, project_id: projectId, entreprise_nom: 'Béta Menuiserie', contact_id: 'fiche-secrete', type_marche: 'base', statut: 'signe' },
        { id: `${tenantId}-m2`, tenant_id: tenantId, project_id: projectId, entreprise_nom: 'Gamma Résiliée', type_marche: 'base', statut: 'resilie' },
        { id: `${tenantId}-m3`, tenant_id: tenantId, project_id: projectId, entreprise_nom: 'Delta Avenant', type_marche: 'subsequent', statut: 'signe' },
        { id: `${tenantId}-m4`, tenant_id: tenantId, project_id: `${projectId}-autre`, entreprise_nom: 'Autre Affaire SA', type_marche: 'base', statut: 'signe' },
      ]);
    }
    const url = (projectId: string, path = 'reserves') => `/api/shared/projects/${projectId}/${path}`;

    it('propose les lots et les entreprises de l\'affaire, en noms seulement, à qui peut écrire', async () => {
      const { tenantId, admin, projectId } = setup();
      withResponsables(tenantId, projectId);
      const writer = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }]);
      const reader = await invite(admin.token, projectId, NO_DETAIL);
      const res = await get(writer.token, url(projectId, 'reserves/options'));
      expect(res.status).toBe(200);
      expect(res.body.lots).toEqual([{ title: 'Gros œuvre', number: '01' }]);
      expect(res.body.entreprises).toEqual(['Alpha Bâtiment', 'Béta Menuiserie']); // ni résiliée, ni avenant, ni autre affaire
      expect(res.body.lotEntreprise).toEqual({ 'Gros œuvre': 'Alpha Bâtiment' });
      expect(JSON.stringify(res.body)).not.toContain('fiche-secrete');
      expect((await get(reader.token, url(projectId, 'reserves/options'))).status).toBe(403);
    });

    describe('fiche réduite des entreprises (identifiants et coordonnées, jamais la fiche complète)', () => {
      function withContacts(tenantId: string, projectId: string) {
        withResponsables(tenantId, projectId);
        Object.assign(fakeSupabaseAdmin.getTable('project_lots').find(l => l.id === `${tenantId}-l1`)!, { contact_id: `${tenantId}-c1` });
        Object.assign(fakeSupabaseAdmin.getTable('marches_entreprises').find(m => m.id === `${tenantId}-m1`)!, { contact_id: `${tenantId}-c2` });
        fakeSupabaseAdmin.seed('contacts', [
          {
            id: `${tenantId}-c1`, tenant_id: tenantId, first_name: 'Ana', last_name: 'Roy', company_name: 'Alpha Bâtiment', job_title: 'Conductrice de travaux',
            email_work: 'ana@alpha.test', email_home: 'ana.perso@example.test', phone_mobile: '06 00 00 00 01', phone_home: '01 99 99 99 99',
            address_work_street: '1 rue du Chantier', address_work_zip: '54000', address_work_city: 'Nancy', address_home_street: '9 rue Privée',
            siret: '123 456 789 00012', vat_number: 'FR00123456789',
            notes: 'Ne jamais appeler le lundi, litige en cours avec l\'agence', tags: 'litige', category: 'Entreprise', birthday: '1980-01-01',
            market_amount_base: 987654, relation_status: 'à surveiller',
          },
          { id: `${tenantId}-c2`, tenant_id: tenantId, first_name: 'Luc', last_name: 'Pic', company_name: 'Béta Menuiserie', email: 'luc@beta.test', is_personal: true },
          { id: `${tenantId}-c3`, tenant_id: 'autre-cabinet', first_name: 'X', last_name: 'Y', company_name: 'Alpha Bâtiment', email_work: 'etranger@example.test' },
        ]);
      }

      it('avec le détail : nom, identifiants, coordonnées de travail ; jamais notes, étiquettes, coordonnées privées ni montants', async () => {
        const { tenantId, admin, projectId } = setup();
        withContacts(tenantId, projectId);
        const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write', detail: true }]);
        const res = await get(guest.token, url(projectId, 'reserves/options'));
        expect(res.status).toBe(200);
        expect(res.body.fiches['Alpha Bâtiment']).toEqual({
          contact_id: `${tenantId}-c1`, nom: 'Alpha Bâtiment', personne: 'Ana Roy', fonction: 'Conductrice de travaux', email: 'ana@alpha.test',
          telephones: ['06 00 00 00 01'], adresse: '1 rue du Chantier, 54000 Nancy', siret: '123 456 789 00012', tva: 'FR00123456789',
        });
        const raw = JSON.stringify(res.body);
        for (const secret of ['litige', 'Ne jamais appeler', 'perso@example', '01 99 99', 'Privée', '1980', '987654', 'surveiller', 'etranger@example']) {
          expect(raw).not.toContain(secret);
        }
        // Un contact personnel d'un collaborateur n'a pas de fiche, l'entreprise reste proposée par son nom.
        expect(res.body.entreprises).toContain('Béta Menuiserie');
        expect(res.body.fiches['Béta Menuiserie']).toBeUndefined();
      });

      it('sans le détail : des noms seulement, aucune fiche', async () => {
        const { tenantId, admin, projectId } = setup();
        withContacts(tenantId, projectId);
        const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }]);
        const res = await get(guest.token, url(projectId, 'reserves/options'));
        expect(res.body.fiches).toEqual({});
        expect(JSON.stringify(res.body)).not.toContain('ana@alpha.test');
        expect(JSON.stringify(res.body)).not.toContain(`${tenantId}-c1`);
      });

      it('trace la consultation des coordonnées au journal du cabinet, une fois par demi-heure', async () => {
        const { tenantId, admin, projectId } = setup();
        withContacts(tenantId, projectId);
        const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write', detail: true }]);
        await get(guest.token, url(projectId, 'reserves/options'));
        await get(guest.token, url(projectId, 'reserves/options'));
        await new Promise(r => setTimeout(r, 10));
        const entries = fakeSupabaseAdmin.getTable('activities').filter(a => a.tenant_id === tenantId && String(a.action).includes('Consultation des coordonnées'));
        expect(entries).toHaveLength(1);
        expect(entries[0].action).toContain('confrère externe');
      });

      it('ACT avec le détail : la fiche réduite du contact rattaché, jamais sa fiche complète', async () => {
        const { tenantId, admin, projectId } = setup();
        withContacts(tenantId, projectId);
        const act = fakeSupabaseAdmin.getTable('act_data').find(a => a.id === `${tenantId}-act`)!;
        act.consultation.entreprises[0].contact_id = `${tenantId}-c1`;
        const guest = await invite(admin.token, projectId, WITH_DETAIL);
        const view = (await get(guest.token, `/api/shared/projects/${projectId}/act`)).body;
        expect(view.entreprises[0].fiche).toMatchObject({ contact_id: `${tenantId}-c1`, nom: 'Alpha Bâtiment', siret: '123 456 789 00012', telephones: ['06 00 00 00 01'] });
        expect(JSON.stringify(view)).not.toContain('Ne jamais appeler');
        const plain = await invite(admin.token, projectId, NO_DETAIL);
        const without = (await get(plain.token, `/api/shared/projects/${projectId}/act`)).body;
        expect(without.entreprises[0]).not.toHaveProperty('fiche');
        expect(JSON.stringify(without)).not.toContain(`${tenantId}-c1`);
      });
    });

    it('crée une réserve avec son lot et son entreprise, rangés comme le cabinet', async () => {
      const { tenantId, admin, projectId } = setup();
      withResponsables(tenantId, projectId);
      const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }]);
      const res = await request(app).post(url(projectId)).set(authHeader(guest.token)).send({ title: 'Enduit', lots: ['gros œuvre'], entreprises: ['Alpha Bâtiment', 'alpha bâtiment', 'Béta Menuiserie'] });
      expect(res.status).toBe(201);
      expect(JSON.parse(res.body.lots)).toEqual(['Gros œuvre']); // casse normalisée sur le nom connu
      expect(JSON.parse(res.body.entreprises)).toEqual(['Alpha Bâtiment', 'Béta Menuiserie']); // sans doublon
    });

    it('refuse un lot ou une entreprise inconnus, ou mal formés, et n\'écrit rien', async () => {
      const { tenantId, admin, projectId } = setup();
      withResponsables(tenantId, projectId);
      const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }]);
      const before = fakeSupabaseAdmin.getTable('reserves').length;
      for (const body of [
        { title: 'x', lots: ['Inventé'] }, { title: 'x', entreprises: ['Autre Affaire SA'] }, { title: 'x', entreprises: ['Gamma Résiliée'] },
        { title: 'x', lots: 'Gros œuvre' }, { title: 'x', lots: [''] }, { title: 'x', lots: [1] }, { title: 'x', entreprises: Array(21).fill('Alpha Bâtiment') },
      ]) {
        expect((await request(app).post(url(projectId)).set(authHeader(guest.token)).send(body)).status).toBe(400);
      }
      expect(fakeSupabaseAdmin.getTable('reserves').length).toBe(before);
      const put = await request(app).put(url(projectId, `reserves/${tenantId}-a1`)).set(authHeader(guest.token)).send({ lots: ['Inventé'] });
      expect(put.status).toBe(400);
      expect(fakeSupabaseAdmin.getTable('reserves').find(r => r.id === `${tenantId}-a1`)!.lots).toBeUndefined();
    });

    it('change le lot et l\'entreprise d\'une réserve, en gardant une valeur ancienne déjà portée', async () => {
      const { tenantId, admin, projectId } = setup();
      withResponsables(tenantId, projectId);
      Object.assign(fakeSupabaseAdmin.getTable('reserves').find(r => r.id === `${tenantId}-a1`)!, { entreprises: JSON.stringify(['Ancienne SARL']) });
      const guest = await invite(admin.token, projectId, [{ kind: 'reserves', access: 'write' }]);
      const target = url(projectId, `reserves/${tenantId}-a1`);
      // « Ancienne SARL » n'est plus dans les listes mais la réserve la porte : elle reste acceptable.
      const keep = await request(app).put(target).set(authHeader(guest.token)).send({ lots: ['Gros œuvre'], entreprises: ['Ancienne SARL', 'Alpha Bâtiment'] });
      expect(keep.status).toBe(200);
      expect(JSON.parse(keep.body.entreprises)).toEqual(['Ancienne SARL', 'Alpha Bâtiment']);
      const clear = await request(app).put(target).set(authHeader(guest.token)).send({ entreprises: [] });
      expect(clear.status).toBe(200);
      expect(JSON.parse(clear.body.entreprises)).toEqual([]);
      // Une autre réserve ne peut pas reprendre une valeur étrangère à l'affaire et à elle-même.
      expect((await request(app).put(target).set(authHeader(guest.token)).send({ entreprises: ['Ancienne SARL', 'Ancienne SARL 2'] })).status).toBe(400);
    });

    it('en lecture seule, ni création ni changement de lot', async () => {
      const { tenantId, admin, projectId } = setup();
      withResponsables(tenantId, projectId);
      const reader = await invite(admin.token, projectId, WITH_DETAIL);
      expect((await request(app).put(url(projectId, `reserves/${tenantId}-a1`)).set(authHeader(reader.token)).send({ lots: ['Gros œuvre'] })).status).toBe(403);
    });
  });

  it('en lecture seule, ni l\'intitulé ni la position ne changent', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, WITH_DETAIL);
    const res = await put(guest.token, `/api/shared/projects/${projectId}/reserves/${tenantId}-a1`, { title: 'Piraté' });
    expect(res.status).toBe(403);
    expect(fakeSupabaseAdmin.getTable('reserves').find(r => r.id === `${tenantId}-a1`)!.title).toBe('Fissure');
  });
});

describe('avec le détail : coordonnées et trace RGPD', () => {
  const traces = (tenantId: string) => fakeSupabaseAdmin.getTable('activities')
    .filter(a => a.tenant_id === tenantId && String(a.action).includes('Consultation des coordonnées'));

  it('rend les adresses des entreprises consultées, jamais la fiche contact', async () => {
    const { admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, WITH_DETAIL);
    const act = (await get(guest.token, `/api/shared/projects/${projectId}/act`)).body;
    expect(act.entreprises[0]).toMatchObject({ nom: 'Alpha', email: 'alpha@example.test', emails_supplementaires: 'b@example.test; c@example.test' });
    expect(JSON.stringify(act)).not.toContain('fiche-secrete');
  });

  it('trace la consultation au journal du cabinet, une fois par demi-heure et par personne', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, WITH_DETAIL);
    await get(guest.token, `/api/shared/projects/${projectId}/act`);
    await get(guest.token, `/api/shared/projects/${projectId}/act`);
    await new Promise(r => setTimeout(r, 10));
    const entries = traces(tenantId);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toContain('confrère externe');
  });

  it('sans détail, aucune adresse et aucune trace', async () => {
    const { tenantId, admin, projectId } = setup();
    const guest = await invite(admin.token, projectId, NO_DETAIL);
    await get(guest.token, `/api/shared/projects/${projectId}/act`);
    await new Promise(r => setTimeout(r, 10));
    expect(traces(tenantId)).toHaveLength(0);
  });
});
