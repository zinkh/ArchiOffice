// Atelier DOE (onglet AOR) : routes du cabinet (/api/projects/:id/doe*) et portail
// public par jeton (/api/public/doe/*). Le drive du cabinet est le fournisseur en
// mémoire ; nodemailer est remplacé pour capter les messages.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import JSZip from 'jszip';
import type { Express } from 'express';

const sendMail = vi.fn();
vi.mock('nodemailer', async (importOriginal) => {
  const actual: any = await importOriginal();
  const createTransport = () => ({ sendMail });
  return { ...actual, createTransport, default: { ...actual.default, createTransport } };
});

import {
  getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage,
} from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';
import { executerRelances } from '../server/doe/relances';
import { faussePdf } from './fixtures/zipBuilder';

// Les limiteurs du portail sont réglés pour traverser tout le scénario.
process.env.DEPOT_WRITE_LIMIT = '100000';
process.env.DEPOT_READ_LIMIT = '100000';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => {
  memoryDrive.reset();
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: 'm1' });
});

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${++seq}`;

interface Cabinet {
  tenantId: string; token: string; projectId: string; lotA: string; lotB: string; contactA: string;
}

/** Un cabinet, un drive branché, une opération à deux lots dont l'un a une fiche contact avec adresse. */
function cabinet(options: { smtp?: boolean } = {}): Cabinet {
  const tenantId = makeTenant({ plan: 'pro' });
  const { token } = makeUser(tenantId, 'admin');
  connectExternalStorage(tenantId);
  if (options.smtp !== false) {
    fakeSupabaseAdmin.seed('settings', [{
      tenant_id: tenantId, agency_name: 'AAZS', email: 'contact@aazs.test',
      smtp_host: 'smtp.test', smtp_port: '587', smtp_user: 'u', smtp_pass: 'p',
    }]);
  }
  const projectId = uid('proj');
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, project_code: '26014', name: 'Villa Martin', client: 'Mme Martin', client_email: 'martin@example.test' }]);
  const contactA = uid('contact');
  fakeSupabaseAdmin.seed('contacts', [{ id: contactA, tenant_id: tenantId, name: 'SARL Dupont', email: 'dupont@example.test' }]);
  const lotA = uid('lot'); const lotB = uid('lot');
  fakeSupabaseAdmin.seed('project_lots', [
    { id: lotA, tenant_id: tenantId, project_id: projectId, lot_number: '02', lot_title: 'Charpente', contact_id: contactA, contact_name: 'SARL Dupont' },
    { id: lotB, tenant_id: tenantId, project_id: projectId, lot_number: '03', lot_title: 'Couverture', contact_id: null, contact_name: 'Toitures Durand' },
  ]);
  return { tenantId, token, projectId, lotA, lotB, contactA };
}

const etat = (c: Cabinet) => request(app).get(`/api/projects/${c.projectId}/doe`).set(authHeader(c.token));
const entrepriseDe = (body: any, key: string) => body.entreprises.find((e: any) => e.key === key);

it('affiche le nom de la fiche contact quand le lot n\u2019a pas de nom saisi', async () => {
  const c = cabinet();
  const contactId = uid('contact');
  fakeSupabaseAdmin.seed('contacts', [{ id: contactId, tenant_id: c.tenantId, company_name: 'Couvertures Martin', email: 'cm@example.test' }]);
  fakeSupabaseAdmin.seed('project_lots', [{ id: uid('lot'), tenant_id: c.tenantId, project_id: c.projectId, lot_number: '04', lot_title: 'Zinguerie', contact_id: contactId, contact_name: '' }]);
  const res = await etat(c);
  expect(entrepriseDe(res.body, contactId)).toMatchObject({ nom: 'Couvertures Martin', email: 'cm@example.test' });
});

async function lien(c: Cabinet, key: string, extra: Record<string, any> = {}) {
  const res = await request(app).post(`/api/projects/${c.projectId}/doe/requests`).set(authHeader(c.token))
    .send({ entreprise_key: key, mode: 'lien', ...extra });
  const jeton = res.body.url?.split('/doe/')[1] as string;
  return { res, jeton };
}

const deposer = (jeton: string, nom: string, contenu: Buffer, champs: Record<string, string> = {}) => {
  let r = request(app).post(`/api/public/doe/${jeton}/fichiers`);
  for (const [k, v] of Object.entries(champs)) r = r.field(k, v);
  return r.attach('files', contenu, nom);
};

const documentsDoe = (projectId: string) => fakeSupabaseAdmin.getTable('documents').filter((d: any) => d.project_id === projectId && d.doc_type === 'DOE');

describe('état de l\'opération', () => {
  it('liste les entreprises des lots, à solliciter, avec leur adresse de fiche contact', async () => {
    const c = cabinet();
    const res = await etat(c);
    expect(res.status).toBe(200);
    expect(res.body.disponible).toBe(true);
    expect(res.body.entreprises.map((e: any) => e.nom).sort()).toEqual(['SARL Dupont', 'Toitures Durand']);
    const dupont = entrepriseDe(res.body, c.contactA);
    expect(dupont).toMatchObject({ statut: 'a_solliciter', email: 'dupont@example.test' });
    expect(dupont.lots[0].lot_title).toBe('Charpente');
    expect(res.body.archive_prete).toBe(false);
    expect(res.body.moa.email).toBe('martin@example.test');
  });

  it("refuse l'opération d'un autre cabinet", async () => {
    const c = cabinet(); const autre = cabinet();
    const res = await request(app).get(`/api/projects/${autre.projectId}/doe`).set(authHeader(c.token));
    expect(res.status).toBe(404);
  });

  it('enregistre les réglages avec des bornes', async () => {
    const c = cabinet();
    const res = await request(app).put(`/api/projects/${c.projectId}/doe/settings`).set(authHeader(c.token))
      .send({ deadline_at: '2026-12-01T10:00:00Z', reminder_interval_days: 1, reminder_max: 99, required_pieces: ['notices', 'pirate'] });
    expect(res.status).toBe(200);
    const lu = (await etat(c)).body.reglages;
    expect(lu).toMatchObject({ reminder_interval_days: 2, reminder_max: 10, required_pieces: ['notices'] });
    expect(new Date(lu.deadline_at).toISOString()).toBe('2026-12-01T10:00:00.000Z');
    const faux = await request(app).put(`/api/projects/${c.projectId}/doe/settings`).set(authHeader(c.token)).send({ deadline_at: 'pas une date' });
    expect(faux.status).toBe(400);
  });
});

describe('sollicitation et liens', () => {
  it("envoie la demande par e-mail avec le lien, sans conserver le jeton", async () => {
    const c = cabinet();
    const res = await request(app).post(`/api/projects/${c.projectId}/doe/requests`).set(authHeader(c.token))
      .send({ entreprise_key: c.contactA, mode: 'sollicitation' });
    expect(res.status).toBe(201);
    expect(res.body.envoye).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('dupont@example.test');
    expect(mail.html).toContain(res.body.url);
    const ligne = fakeSupabaseAdmin.getTable('doe_requests').find((r: any) => r.project_id === c.projectId);
    expect(ligne!.sent_at).toBeTruthy();
    expect(JSON.stringify(ligne)).not.toContain(res.body.url.split('/doe/')[1]);
    expect((await etat(c)).body.entreprises.find((e: any) => e.key === c.contactA).statut).toBe('sollicitee');
  });

  it("n'envoie rien et garde l'ancien lien si le message ne part pas", async () => {
    const c = cabinet({ smtp: false });
    const { res: premier, jeton } = await lien(c, c.contactA);
    expect(premier.status).toBe(201);
    const echec = await request(app).post(`/api/projects/${c.projectId}/doe/requests`).set(authHeader(c.token))
      .send({ entreprise_key: c.contactA, mode: 'sollicitation' });
    expect(echec.status).toBe(502);
    const actives = fakeSupabaseAdmin.getTable('doe_requests').filter((r: any) => r.project_id === c.projectId && !r.revoked_at);
    expect(actives).toHaveLength(1);
    // L'ancien lien fonctionne encore.
    expect((await request(app).get(`/api/public/doe/${jeton}`)).status).toBe(200);
  });

  it("refuse une demande sans adresse e-mail", async () => {
    const c = cabinet();
    const res = await request(app).post(`/api/projects/${c.projectId}/doe/requests`).set(authHeader(c.token))
      .send({ entreprise_key: 'Toitures Durand', mode: 'sollicitation' });
    expect(res.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('un nouveau lien révoque le précédent', async () => {
    const c = cabinet();
    const un = await lien(c, c.contactA);
    const deux = await lien(c, c.contactA);
    expect((await request(app).get(`/api/public/doe/${un.jeton}`)).status).toBe(404);
    expect((await request(app).get(`/api/public/doe/${deux.jeton}`)).status).toBe(200);
  });

  it('sollicite en une fois les entreprises à solliciter qui ont une adresse', async () => {
    const c = cabinet();
    const res = await request(app).post(`/api/projects/${c.projectId}/doe/requests/tout-solliciter`).set(authHeader(c.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.envoyees).toEqual(['SARL Dupont']);
    expect(res.body.sans_adresse).toEqual(['Toitures Durand']);
  });
});

describe('portail public', () => {
  it('répond pareil à un jeton mal formé, inconnu ou révoqué', async () => {
    const c = cabinet();
    const { res, jeton } = await lien(c, c.contactA);
    const demandeId = fakeSupabaseAdmin.getTable('doe_requests').find((r: any) => r.project_id === c.projectId)!.id;
    await request(app).delete(`/api/projects/${c.projectId}/doe/requests/${demandeId}`).set(authHeader(c.token));
    const messages = [
      (await request(app).get('/api/public/doe/nimporte')).body.error,
      (await request(app).get(`/api/public/doe/doe_${'a'.repeat(43)}`)).body.error,
      (await request(app).get(`/api/public/doe/${jeton}`)).body.error,
    ];
    expect(res.status).toBe(201);
    expect(new Set(messages).size).toBe(1);
  });

  it("montre à l'entreprise ses lots, les pièces attendues et rien d'autre", async () => {
    const c = cabinet();
    const { jeton } = await lien(c, c.contactA);
    const res = await request(app).get(`/api/public/doe/${jeton}`);
    expect(res.status).toBe(200);
    expect(res.body.entreprise).toBe('SARL Dupont');
    expect(res.body.lots.map((l: any) => l.libelle)).toEqual(['Lot 02 Charpente']);
    expect(res.body.pieces.find((p: any) => p.key === 'notices')).toMatchObject({ requise: true, etat: 'manquante' });
    expect(JSON.stringify(res.body)).not.toContain('Durand');
  });

  it('enregistre un dépôt sur le drive du cabinet, reconnaît la pièce et accuse réception', async () => {
    const c = cabinet();
    const { jeton } = await lien(c, c.contactA);
    const res = await deposer(jeton, 'Notice entretien chaudière.pdf', faussePdf(), { lot_id: c.lotA });
    expect(res.status).toBe(201);
    expect(res.body.depots[0]).toMatchObject({ nom: 'Notice entretien chaudière.pdf', piece: 'notices' });
    expect(res.body.accuse_envoye).toBe(true);
    expect(sendMail.mock.calls[0][0].to).toBe('dupont@example.test');

    const [doc] = documentsDoe(c.projectId);
    expect(doc).toMatchObject({ contact_id: c.contactA, doe_piece: 'notices', doe_source: 'entreprise', validation_status: 'pending', doe_lot_id: c.lotA });
    expect(memoryDrive.livePaths().some(p => p.endsWith('/AOR/DOE/SARL Dupont/Notice entretien chaudière.pdf'))).toBe(true);
    expect((await etat(c)).body.entreprises.find((e: any) => e.key === c.contactA).statut).toBe('partiel');
  });

  it("refuse un exécutable déguisé, un plan DWG et un lot qui n'est pas le sien", async () => {
    const c = cabinet();
    const { jeton } = await lien(c, c.contactA);
    const faux = await deposer(jeton, 'plan.pdf', Buffer.from('MZ\x90\x00 exe'));
    expect(faux.status).toBe(400);
    const dwg = await deposer(jeton, 'plan.dwg', Buffer.from('AC1018'));
    expect(dwg.status).toBe(400);
    const lot = await deposer(jeton, 'ok.pdf', faussePdf(), { lot_id: c.lotB });
    expect(lot.status).toBe(400);
    expect(documentsDoe(c.projectId)).toHaveLength(0);
  });

  it("accepte une photo JPEG et refuse un faux JPEG", async () => {
    const c = cabinet();
    const { jeton } = await lien(c, c.contactA);
    expect((await deposer(jeton, 'ouvrage enterre.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]))).status).toBe(201);
    expect((await deposer(jeton, 'faux.jpg', Buffer.from('pas une image'))).status).toBe(400);
  });

  it("l'entreprise ne retire que ses documents non analysés", async () => {
    const c = cabinet();
    const { jeton } = await lien(c, c.contactA);
    await deposer(jeton, 'Notice.pdf', faussePdf());
    await deposer(jeton, 'Garantie.pdf', faussePdf());
    const [notice, garantie] = documentsDoe(c.projectId);
    await request(app).put(`/api/doe/documents/${garantie.id}`).set(authHeader(c.token)).send({ validation_status: 'approved' });
    expect((await request(app).delete(`/api/public/doe/${jeton}/documents/${garantie.id}`)).status).toBe(409);
    expect((await request(app).delete(`/api/public/doe/${jeton}/documents/${notice.id}`)).status).toBe(200);
    expect(documentsDoe(c.projectId)).toHaveLength(1);
  });
});

describe('analyse et avis', () => {
  it("classe un document non classé quand le nom est clair, signale les anomalies, ne donne jamais d'avis", async () => {
    const c = cabinet();
    const { jeton } = await lien(c, c.contactA);
    await deposer(jeton, 'scan0001.pdf', faussePdf());
    const res = await request(app).post(`/api/projects/${c.projectId}/doe/analyser`).set(authHeader(c.token)).send({ entreprise_key: c.contactA });
    expect(res.status).toBe(200);
    expect(res.body.resultats).toHaveLength(1);
    expect(res.body.resultats[0].anomalies).toContain('piece_non_reconnue');
    expect(documentsDoe(c.projectId)[0].validation_status).toBe('pending');
  });

  it('enregistre le classement, l\'avis et les observations, avec validation des valeurs', async () => {
    const c = cabinet();
    const { jeton } = await lien(c, c.contactA);
    await deposer(jeton, 'doc.pdf', faussePdf());
    const [doc] = documentsDoe(c.projectId);
    const ok = await request(app).put(`/api/doe/documents/${doc.id}`).set(authHeader(c.token))
      .send({ doe_piece: 'pv_essais', validation_status: 'commented', validation_comments: 'Signature manquante' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ doe_piece: 'pv_essais', validation_status: 'commented', validation_comments: 'Signature manquante' });
    expect((await request(app).put(`/api/doe/documents/${doc.id}`).set(authHeader(c.token)).send({ validation_status: 'valide' })).status).toBe(400);
    expect((await request(app).put(`/api/doe/documents/${doc.id}`).set(authHeader(c.token)).send({ doe_piece: 'x' })).status).toBe(400);
    const autre = cabinet();
    expect((await request(app).put(`/api/doe/documents/${doc.id}`).set(authHeader(autre.token)).send({ validation_status: 'approved' })).status).toBe(404);
  });
});

describe('visa et archive', () => {
  /** Une entreprise avec une notice favorable, pour une opération qui n'exige que les notices. */
  async function dossierPret(c: Cabinet) {
    await request(app).put(`/api/projects/${c.projectId}/doe/settings`).set(authHeader(c.token)).send({ required_pieces: ['notices'] });
    const { jeton } = await lien(c, c.contactA);
    await deposer(jeton, 'Notice entretien.pdf', faussePdf());
    const [doc] = documentsDoe(c.projectId);
    return { jeton, doc };
  }
  const viser = (c: Cabinet, avis: string, extra: Record<string, any> = {}) =>
    request(app).post(`/api/projects/${c.projectId}/doe/visas`).set(authHeader(c.token)).send({ entreprise_key: c.contactA, avis, ...extra });

  it("refuse un visa favorable tant qu'une pièce manque ou qu'un document reste à analyser", async () => {
    const c = cabinet();
    await deposer((await lien(c, c.contactA)).jeton, 'Notice entretien.pdf', faussePdf());
    const manque = await viser(c, 'favorable');
    expect(manque.status).toBe(409);
    expect(manque.body.code).toBe('pieces_manquantes');
    await request(app).put(`/api/projects/${c.projectId}/doe/settings`).set(authHeader(c.token)).send({ required_pieces: ['notices'] });
    const aAnalyser = await viser(c, 'favorable');
    expect(aAnalyser.body.code).toBe('documents_a_analyser');
  });

  it('émet un visa numéroté, déposé comme document, et rend le dossier « visé »', async () => {
    const c = cabinet();
    const { doc } = await dossierPret(c);
    await request(app).put(`/api/doe/documents/${doc.id}`).set(authHeader(c.token)).send({ validation_status: 'approved' });
    const res = await viser(c, 'favorable', { observations: 'Dossier complet.' });
    expect(res.status).toBe(201);
    expect(res.body.visa.numero).toBe(`DOE-${new Date().getFullYear()}-001`);
    const docVisa = fakeSupabaseAdmin.getTable('documents').find((d: any) => d.id === res.body.visa.document_id);
    expect(docVisa).toMatchObject({ doc_type: 'DOE_VISA', mime_type: 'application/pdf' });
    expect(memoryDrive.livePaths().some(p => p.includes('/Visas/Visa DOE-') && p.endsWith('.pdf'))).toBe(true);
    // Le visa n'est pas compté comme document de l'entreprise.
    const e = entrepriseDe((await etat(c)).body, c.contactA);
    expect(e.statut).toBe('vise');
    expect(e.documents).toHaveLength(1);
    expect(e.visa.numero).toBe(res.body.visa.numero);
    // Un second visa prend le numéro suivant.
    expect((await viser(c, 'favorable')).body.visa.numero).toMatch(/-002$/);
  });

  it("un visa défavorable est possible, envoyé avec le PDF et un lien pour corriger, et laisse l'entreprise « à corriger »", async () => {
    const c = cabinet();
    await dossierPret(c);
    const res = await viser(c, 'defavorable', { envoyer: true, observations: 'Notice incomplète.' });
    expect(res.status).toBe(201);
    expect(res.body.envoye).toBe(true);
    const mail = sendMail.mock.calls.at(-1)![0];
    expect(mail.attachments[0].filename).toMatch(/^Visa DOE-/);
    expect(mail.html).toContain('/doe/doe_');
    expect(entrepriseDe((await etat(c)).body, c.contactA).statut).toBe('a_corriger');
  });

  it("un document déposé après le visa rouvre l'analyse", async () => {
    const c = cabinet();
    const { jeton, doc } = await dossierPret(c);
    await request(app).put(`/api/doe/documents/${doc.id}`).set(authHeader(c.token)).send({ validation_status: 'approved' });
    await viser(c, 'favorable');
    await new Promise(r => setTimeout(r, 5));
    const nouveau = await lien(c, c.contactA);
    await deposer(nouveau.jeton, 'Notice complement.pdf', faussePdf());
    expect(entrepriseDe((await etat(c)).body, c.contactA).statut).not.toBe('vise');
    expect(jeton).toBeTruthy();
  });

  it("refuse l'archive sans dossier visé, demande confirmation pour un envoi partiel, puis la constitue", async () => {
    const c = cabinet();
    const { doc } = await dossierPret(c);
    const vide = await request(app).post(`/api/projects/${c.projectId}/doe/archive`).set(authHeader(c.token)).send({});
    expect(vide.status).toBe(409);
    expect(vide.body.code).toBe('aucun_dossier_vise');

    await request(app).put(`/api/doe/documents/${doc.id}`).set(authHeader(c.token)).send({ validation_status: 'approved' });
    await viser(c, 'favorable');
    fakeSupabaseAdmin.seed('plans', [{ id: uid('plan'), tenant_id: c.tenantId, project_id: c.projectId, name: 'Plan RDC.pdf', file_url: 'inconnu', category: 'AOR', index: 'B' }]);

    const partiel = await request(app).post(`/api/projects/${c.projectId}/doe/archive`).set(authHeader(c.token)).send({});
    expect(partiel.status).toBe(409);
    expect(partiel.body.code).toBe('dossiers_non_vises');
    expect(partiel.body.entreprises).toEqual(['Toitures Durand']);

    const res = await request(app).post(`/api/projects/${c.projectId}/doe/archive`).set(authHeader(c.token))
      .send({ confirmer_partiel: true, envoyer: true, destinataire: 'martin@example.test' });
    expect(res.status).toBe(201);
    expect(res.body.envoye).toBe(true);
    expect(res.body.ignores).toEqual(['Plan RDC.pdf']);
    expect(res.body.reserves.join(' ')).toContain('Toitures Durand');

    const mail = sendMail.mock.calls.at(-1)![0];
    expect(mail.to).toBe('martin@example.test');
    const zip = await JSZip.loadAsync(mail.attachments[0].content);
    const noms = Object.keys(zip.files);
    expect(noms).toContain('00 - Bordereau de transmission.pdf');
    expect(noms.some(n => n.startsWith("02 - DOE des entreprises/Lot 02 Charpente - SARL Dupont/Notices de fonctionnement et d'entretien/Notice entretien.pdf"))).toBe(true);
    expect(noms.some(n => n.startsWith('03 - Visas/Visa DOE-'))).toBe(true);
    expect(noms.some(n => n.includes('Durand'))).toBe(false);
    expect(fakeSupabaseAdmin.getTable('documents').some((d: any) => d.doc_type === 'DOE_ARCHIVE' && d.project_id === c.projectId)).toBe(true);
    expect((await etat(c)).body.archives).toHaveLength(1);
  });
});

describe('relances automatiques', () => {
  const ilYa = (jours: number) => new Date(Date.now() - jours * 24 * 3600 * 1000).toISOString();

  async function demandeEnvoyee(c: Cabinet, jours: number) {
    const { res } = await lien(c, c.contactA, { email: 'dupont@example.test' });
    expect(res.status).toBe(201);
    const ligne = fakeSupabaseAdmin.getTable('doe_requests').find((r: any) => r.project_id === c.projectId && !r.revoked_at);
    ligne!.sent_at = ilYa(jours);
    return ligne!;
  }

  it("relance après l'intervalle avec un nouveau lien, compte la relance et ne relance pas deux fois de suite", async () => {
    const c = cabinet();
    const avant = await demandeEnvoyee(c, 8);
    const bilan = await executerRelances(fakeSupabaseAdmin);
    expect(bilan.envoyees).toBe(1);
    const mail = sendMail.mock.calls.at(-1)![0];
    expect(mail.subject).toContain('relance');
    expect(mail.to).toBe('dupont@example.test');
    const actives = fakeSupabaseAdmin.getTable('doe_requests').filter((r: any) => r.project_id === c.projectId && !r.revoked_at);
    expect(actives).toHaveLength(1);
    expect(actives[0].id).not.toBe(avant.id);
    expect(actives[0]).toMatchObject({ reminder_count: 1 });
    expect(new Date(actives[0].sent_at).toISOString()).toBe(new Date(avant.sent_at).toISOString());
    sendMail.mockClear();
    expect((await executerRelances(fakeSupabaseAdmin)).envoyees).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("ne relance pas avant l'échéance, ni une demande jamais envoyée, ni quand les relances sont coupées", async () => {
    const c = cabinet();
    await demandeEnvoyee(c, 3);
    expect((await executerRelances(fakeSupabaseAdmin)).envoyees).toBe(0);

    const d = cabinet();
    await lien(d, d.contactA, { email: 'dupont@example.test' }); // sent_at nul : lien copié à la main
    expect((await executerRelances(fakeSupabaseAdmin)).envoyees).toBe(0);

    const e = cabinet();
    await request(app).put(`/api/projects/${e.projectId}/doe/settings`).set(authHeader(e.token)).send({ reminder_enabled: false });
    await demandeEnvoyee(e, 30);
    expect((await executerRelances(fakeSupabaseAdmin)).envoyees).toBe(0);
  });

  it("ne relance pas une entreprise dont le dossier attend le cabinet, et s'arrête au plafond", async () => {
    const c = cabinet();
    await request(app).put(`/api/projects/${c.projectId}/doe/settings`).set(authHeader(c.token)).send({ required_pieces: ['notices'], reminder_max: 1 });
    const ligne = await demandeEnvoyee(c, 8);
    await deposer((await lien(c, c.contactA)).jeton, 'Notice.pdf', faussePdf());
    fakeSupabaseAdmin.getTable('doe_requests').filter((r: any) => r.project_id === c.projectId && !r.revoked_at).forEach((r: any) => { r.sent_at = ilYa(8); });
    // Notice reçue, à analyser : rien à demander à l'entreprise.
    expect((await executerRelances(fakeSupabaseAdmin)).envoyees).toBe(0);
    expect(ligne).toBeTruthy();

    const d = cabinet();
    await request(app).put(`/api/projects/${d.projectId}/doe/settings`).set(authHeader(d.token)).send({ reminder_max: 1 });
    await demandeEnvoyee(d, 8);
    expect((await executerRelances(fakeSupabaseAdmin)).envoyees).toBe(1);
    const active = fakeSupabaseAdmin.getTable('doe_requests').find((r: any) => r.project_id === d.projectId && !r.revoked_at);
    active!.last_reminder_at = ilYa(30);
    expect((await executerRelances(fakeSupabaseAdmin)).envoyees).toBe(0);
  });

  it("garde l'ancien lien et ne compte rien quand le message ne part pas", async () => {
    const c = cabinet();
    const avant = await demandeEnvoyee(c, 8);
    sendMail.mockRejectedValue(new Error('SMTP down'));
    const bilan = await executerRelances(fakeSupabaseAdmin);
    expect(bilan).toMatchObject({ envoyees: 0, echecs: 1 });
    const actives = fakeSupabaseAdmin.getTable('doe_requests').filter((r: any) => r.project_id === c.projectId && !r.revoked_at);
    expect(actives).toHaveLength(1);
    expect(actives[0]).toMatchObject({ id: avant.id, reminder_count: 0 });
  });
});
