// Espace de dépôt des offres : routes du cabinet (/api/projects/:id/depot*) et
// portail public par jeton (/api/public/depot/*). Le drive du cabinet est le
// fournisseur en mémoire ; fakeSupabaseAdmin n'a aucun Supabase Storage réel.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage,
} from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';
import { invalidateConnectionCache } from '../server/externalStorage/externalConnection';
import { hacherJeton } from '../server/consultationDepot/tokens';
import { faussePdf, fausseDocx, fausseOds } from './fixtures/zipBuilder';
import JSZip from 'jszip';
import { lireAccuse, signerAccuse } from '../server/consultationDepot/accuseAdditif';

// Les limiteurs du portail sont réglés pour traverser tout le scénario ; leur
// coupure est vérifiée dans consultationDepotLimiter.test.ts.
process.env.DEPOT_WRITE_LIMIT = '100000';
process.env.DEPOT_READ_LIMIT = '100000';

let app: Express;
beforeAll(async () => { app = await getTestApp(); });
beforeEach(() => { memoryDrive.reset(); });

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${++seq}`;

interface Cabinet {
  tenantId: string; token: string; projectId: string; lotA: string; lotB: string;
}

/** Un cabinet Enterprise, marché privé, drive branché, deux lots. */
function cabinet(options: { plan?: string; public?: boolean; drive?: boolean } = {}): Cabinet {
  const tenantId = makeTenant({ plan: options.plan ?? 'enterprise' });
  const { token } = makeUser(tenantId, 'admin');
  if (options.drive !== false) connectExternalStorage(tenantId);
  const projectId = uid('proj');
  fakeSupabaseAdmin.seed('projects', [{
    id: projectId, tenant_id: tenantId, project_code: '26014', name: 'Villa Martin',
    is_public_client: options.public ?? false,
  }]);
  const lotA = uid('lot'); const lotB = uid('lot');
  fakeSupabaseAdmin.seed('project_lots', [
    { id: lotA, tenant_id: tenantId, project_id: projectId, lot_number: '02', lot_title: 'Charpente' },
    { id: lotB, tenant_id: tenantId, project_id: projectId, lot_number: '03', lot_title: 'Couverture' },
  ]);
  return { tenantId, token, projectId, lotA, lotB };
}

async function inviter(c: Cabinet, extra: Record<string, any> = {}) {
  const res = await request(app).post(`/api/projects/${c.projectId}/depot/invites`).set(authHeader(c.token))
    .send({ entreprise_id: 'e1', entreprise_nom: 'SARL Dupont', email: 'dupont@example.test', lots_ids: [c.lotA], ...extra });
  const jeton = res.body.url?.split('/depot/')[1] as string;
  return { res, jeton };
}

const depotsEn = (projectId: string) => fakeSupabaseAdmin.getTable('consultation_depots').filter(d => d.project_id === projectId);

describe('éligibilité', () => {
  it('refuse un plan autre que Enterprise', async () => {
    const c = cabinet({ plan: 'pro' });
    const { res } = await inviter(c);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('plan_requis');
  });

  it('refuse un marché public', async () => {
    const c = cabinet({ public: true });
    const { res } = await inviter(c);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('marche_public');
  });

  it("exige un espace de stockage externe : aucun repli sur Supabase", async () => {
    const c = cabinet({ drive: false });
    const { res } = await inviter(c);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('stockage_requis');
    const e = await request(app).get(`/api/projects/${c.projectId}/depot/eligibility`).set(authHeader(c.token));
    expect(e.body).toMatchObject({ eligible: false, code: 'stockage_requis' });
  });

  it('exige de renouveler une connexion expirée', async () => {
    const c = cabinet({ drive: false });
    connectExternalStorage(c.tenantId, { status: 'needs_reauth' });
    const { res } = await inviter(c);
    expect(res.body.code).toBe('stockage_a_reconnecter');
  });

  it("annonce l'éligibilité avec le fournisseur", async () => {
    const c = cabinet();
    const e = await request(app).get(`/api/projects/${c.projectId}/depot/eligibility`).set(authHeader(c.token));
    expect(e.body.eligible).toBe(true);
    expect(e.body.stockage.provider).toBe('webdav');
  });
});

describe('invitations', () => {
  it('crée un lien et ne stocke que le haché du jeton', async () => {
    const c = cabinet();
    const { res, jeton } = await inviter(c);
    expect(res.status).toBe(201);
    expect(jeton).toMatch(/^dpt_[A-Za-z0-9_-]{43}$/);
    const ligne = fakeSupabaseAdmin.getTable('consultation_depot_invites').find(i => i.id === res.body.id)!;
    expect(ligne.token_hash).toBe(hacherJeton(jeton));
    expect(JSON.stringify(ligne)).not.toContain(jeton);
    expect(ligne.lots_ids).toEqual([c.lotA]);
  });

  it("ignore les lots étrangers à l'affaire", async () => {
    const c = cabinet();
    const autre = cabinet();
    const { res } = await inviter(c, { lots_ids: [c.lotA, autre.lotA] });
    const ligne = fakeSupabaseAdmin.getTable('consultation_depot_invites').find(i => i.id === res.body.id)!;
    expect(ligne.lots_ids).toEqual([c.lotA]);
  });

  it('refuse un contact d’un autre cabinet', async () => {
    const c = cabinet();
    const autre = makeTenant();
    const contactId = uid('contact');
    fakeSupabaseAdmin.seed('contacts', [{ id: contactId, tenant_id: autre, company_name: 'X' }]);
    const { res } = await inviter(c, { contact_id: contactId });
    expect(res.status).toBe(400);
  });

  it("renvoyer le lien révoque l'ancien", async () => {
    const c = cabinet();
    const premier = await inviter(c);
    const second = await inviter(c);
    const ancien = await request(app).get(`/api/public/depot/${premier.jeton}`);
    const nouveau = await request(app).get(`/api/public/depot/${second.jeton}`);
    expect(ancien.status).toBe(404);
    expect(nouveau.status).toBe(200);
  });

  it('un lien révoqué ne répond plus', async () => {
    const c = cabinet();
    const { res, jeton } = await inviter(c);
    await request(app).delete(`/api/projects/${c.projectId}/depot/invites/${res.body.id}`).set(authHeader(c.token)).expect(200);
    expect((await request(app).get(`/api/public/depot/${jeton}`)).status).toBe(404);
  });

  it("la liste des liens n'expose jamais le haché", async () => {
    const c = cabinet();
    await inviter(c);
    const liste = await request(app).get(`/api/projects/${c.projectId}/depot/invites`).set(authHeader(c.token));
    expect(JSON.stringify(liste.body)).not.toContain('token_hash');
  });
});

describe('portail public : accès', () => {
  it('répond 404 identique pour un jeton mal formé, inconnu ou expiré', async () => {
    const c = cabinet();
    const { res, jeton } = await inviter(c);
    fakeSupabaseAdmin.getTable('consultation_depot_invites').find(i => i.id === res.body.id)!.expires_at = '2020-01-01T00:00:00.000Z';
    const reponses = await Promise.all([
      request(app).get('/api/public/depot/nimporte'),
      request(app).get(`/api/public/depot/dpt_${'a'.repeat(43)}`),
      request(app).get(`/api/public/depot/${jeton}`),
    ]);
    expect(reponses.map(r => r.status)).toEqual([404, 404, 404]);
    expect(new Set(reponses.map(r => r.body.error)).size).toBe(1);
  });

  it("n'exige aucune authentification", async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const r = await request(app).get(`/api/public/depot/${jeton}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ operation: 'Villa Martin', entreprise: 'SARL Dupont' });
    expect(r.body.lots.map((l: any) => l.id)).toEqual([c.lotA]);
    expect(r.body.limites.extensions).toEqual(['pdf', 'docx', 'xlsx', 'ods', 'odt']);
  });

  it('ferme le portail si le cabinet quitte le plan Enterprise, sans en dire la raison', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    fakeSupabaseAdmin.getTable('tenants').find(t => t.id === c.tenantId)!.plan = 'pro';
    const r = await request(app).get(`/api/public/depot/${jeton}`);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('DEPOT_INDISPONIBLE');
    expect(JSON.stringify(r.body)).not.toMatch(/enterprise|stockage|plan/i);
  });

  it('ferme le portail si le drive est déconnecté', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    fakeSupabaseAdmin.getTable('external_storage_connections').find(x => x.tenant_id === c.tenantId)!.is_active = false;
    invalidateConnectionCache(c.tenantId);
    expect((await request(app).get(`/api/public/depot/${jeton}`)).status).toBe(503);
  });
});

describe('portail public : dépôt de fichiers', () => {
  it('dépose sur le drive du cabinet, rangé par affaire, lot et entreprise', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const r = await request(app).post(`/api/public/depot/${jeton}/fichiers`)
      .field('lot_id', c.lotA)
      .attach('files', faussePdf(), 'devis.pdf')
      .attach('files', fausseDocx(), 'memoire.docx');
    expect(r.status).toBe(201);
    expect(r.body.depots).toHaveLength(2);
    expect(r.body.hors_delai).toBe(false);

    const chemins = memoryDrive.livePaths();
    expect(chemins).toHaveLength(2);
    expect(chemins[0]).toMatch(/^ArchiOffice\/26014 - Villa Martin\/Consultation\/Lot 02 - Charpente\/SARL Dupont\/\d{4}-\d{2}-\d{2} - devis\.pdf$/);
    expect(chemins[1]).toMatch(/memoire\.docx$/);

    const lignes = depotsEn(c.projectId);
    expect(lignes).toHaveLength(2);
    expect(lignes[0].file_url.startsWith('archioffice+external://')).toBe(true);
    expect(lignes[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(lignes[0]).toMatchObject({ status: 'recu', kind: 'fichier', lot_id: c.lotA, version: 1 });
    // Rien dans Supabase Storage.
    expect(JSON.stringify(lignes)).not.toContain('/object/public/');
  });

  it('numérote les versions successives d’une même remise', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const envoyer = () => request(app).post(`/api/public/depot/${jeton}/fichiers`).field('lot_id', c.lotA).attach('files', faussePdf(), 'devis.pdf');
    await envoyer();
    await envoyer();
    expect(depotsEn(c.projectId).map(d => d.version)).toEqual([1, 2]);
  });

  it('refuse les plans DWG et DXF', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const r = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('lot_id', c.lotA)
      .attach('files', Buffer.from('AC1032'), 'plan.dwg');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/format non accepté/);
    expect(depotsEn(c.projectId)).toHaveLength(0);
    expect(memoryDrive.uploadCalls).toBe(0);
  });

  it('refuse un fichier dont le contenu ne correspond pas à l’extension', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const r = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('lot_id', c.lotA)
      .attach('files', Buffer.from('MZ\0\0\0'), 'devis.pdf');
    expect(r.status).toBe(400);
    expect(memoryDrive.uploadCalls).toBe(0);
  });

  it("un fichier refusé arrête tout le dépôt : rien n'est enregistré à moitié", async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const r = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('lot_id', c.lotA)
      .attach('files', faussePdf(), 'ok.pdf').attach('files', Buffer.from('MZ\0\0'), 'mauvais.pdf');
    expect(r.status).toBe(400);
    expect(depotsEn(c.projectId)).toHaveLength(0);
    expect(memoryDrive.uploadCalls).toBe(0);
  });

  it('refuse un lot qui ne fait pas partie de la consultation de l’entreprise', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const r = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('lot_id', c.lotB).attach('files', faussePdf(), 'a.pdf');
    expect(r.status).toBe(400);
  });

  it('accepte une remise générale, sans lot', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const r = await request(app).post(`/api/public/depot/${jeton}/fichiers`).attach('files', faussePdf(), 'memoire.pdf');
    expect(r.status).toBe(201);
    expect(memoryDrive.livePaths()[0]).toContain('/Consultation/Tous lots/SARL Dupont/');
  });

  it('un bordereau chiffré est un seul tableur (xlsx ou ods) avec un lot', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const sansLot = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('kind', 'bordereau').attach('files', fausseOds(), 'b.ods');
    const mauvais = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('kind', 'bordereau').field('lot_id', c.lotA).attach('files', faussePdf(), 'b.pdf');
    const ok = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('kind', 'bordereau').field('lot_id', c.lotA).attach('files', fausseOds(), 'b.ods');
    expect([sansLot.status, mauvais.status, ok.status]).toEqual([400, 400, 201]);
    expect(depotsEn(c.projectId)[0].kind).toBe('bordereau');
  });

  it("l'acte d'engagement se remet en un seul PDF", async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const mauvais = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('kind', 'acte').attach('files', fausseDocx(), 'ae.docx');
    const ok = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('kind', 'acte').attach('files', faussePdf(), 'ae.pdf');
    expect([mauvais.status, ok.status]).toEqual([400, 201]);
  });

  it('refuse un fichier de plus de 25 Mo', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const gros = Buffer.concat([faussePdf(), Buffer.alloc(26 * 1024 * 1024)]);
    const r = await request(app).post(`/api/public/depot/${jeton}/fichiers`).attach('files', gros, 'gros.pdf');
    expect(r.status).toBe(413);
    expect(depotsEn(c.projectId)).toHaveLength(0);
  });

  it("échoue bruyamment si le drive est injoignable, sans repli sur Supabase", async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    memoryDrive.failNextUploadWith(new Error('drive injoignable'));
    const r = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('lot_id', c.lotA).attach('files', faussePdf(), 'devis.pdf');
    expect(r.status).toBe(502);
    expect(depotsEn(c.projectId)).toHaveLength(0);
    // L'état de la connexion est reporté pour le cabinet.
    expect(fakeSupabaseAdmin.getTable('external_storage_connections').find(x => x.tenant_id === c.tenantId)!.status).toBe('error');
  });

  it('signale « hors délai » un dépôt tardif sans le refuser', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const passe = new Date(Date.now() - 3600_000).toISOString();
    await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(authHeader(c.token)).send({ deadline_at: passe }).expect(200);
    const r = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('lot_id', c.lotA).attach('files', faussePdf(), 'devis.pdf');
    expect(r.status).toBe(201);
    expect(r.body.hors_delai).toBe(true);
    expect(depotsEn(c.projectId)[0].hors_delai).toBe(true);
  });
});

describe('portail public : saisie en ligne', () => {
  it('enregistre une saisie validée', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const r = await request(app).post(`/api/public/depot/${jeton}/saisie`).send({
      lot_id: c.lotA, montant_base: '12 345,50', delai_semaines: 8, observations: 'RAS',
      lignes: [{ kind: 'option', libelle: 'Isolation', montant: 1200 }, { kind: 'variante', libelle: 'Zinc', montant: 900 }],
    });
    expect(r.status).toBe(201);
    const d = depotsEn(c.projectId)[0];
    expect(d.kind).toBe('saisie');
    expect(d.file_url).toBeUndefined();
    expect(d.payload.montant_base).toBe(12345.5);
    expect(d.payload.lignes).toHaveLength(2);
    expect(memoryDrive.uploadCalls).toBe(0);
  });

  it('refuse un montant manquant, négatif ou un lot non invité', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const post = (corps: any) => request(app).post(`/api/public/depot/${jeton}/saisie`).send(corps);
    expect((await post({ lot_id: c.lotA, montant_base: 0 })).status).toBe(400);
    expect((await post({ lot_id: c.lotA, montant_base: -5 })).status).toBe(400);
    expect((await post({ montant_base: 100 })).status).toBe(400);
    expect((await post({ lot_id: c.lotB, montant_base: 100 })).status).toBe(400);
    expect((await post({ lot_id: c.lotA, montant_base: 100, lignes: [{ kind: 'option', libelle: '', montant: 3 }] })).status).toBe(400);
    expect(depotsEn(c.projectId)).toHaveLength(0);
  });
});

describe('portail public : isolation et retrait', () => {
  it('une entreprise ne voit que ses propres dépôts', async () => {
    const c = cabinet();
    const a = await inviter(c, { entreprise_id: 'e1', entreprise_nom: 'Dupont' });
    const b = await inviter(c, { entreprise_id: 'e2', entreprise_nom: 'Martin' });
    await request(app).post(`/api/public/depot/${a.jeton}/fichiers`).field('lot_id', c.lotA).attach('files', faussePdf(), 'dupont.pdf');
    await request(app).post(`/api/public/depot/${b.jeton}/fichiers`).field('lot_id', c.lotA).attach('files', faussePdf(), 'martin.pdf');
    const vueA = await request(app).get(`/api/public/depot/${a.jeton}`);
    expect(vueA.body.depots.map((d: any) => d.nom)).toEqual(['dupont.pdf']);
  });

  it("une entreprise ne peut pas retirer le dépôt d'une autre", async () => {
    const c = cabinet();
    const a = await inviter(c, { entreprise_id: 'e1', entreprise_nom: 'Dupont' });
    const b = await inviter(c, { entreprise_id: 'e2', entreprise_nom: 'Martin' });
    await request(app).post(`/api/public/depot/${a.jeton}/fichiers`).field('lot_id', c.lotA).attach('files', faussePdf(), 'dupont.pdf');
    const id = depotsEn(c.projectId)[0].id;
    expect((await request(app).delete(`/api/public/depot/${b.jeton}/depots/${id}`)).status).toBe(404);
    expect((await request(app).delete(`/api/public/depot/${a.jeton}/depots/${id}`)).status).toBe(200);
    expect(depotsEn(c.projectId)[0].status).toBe('retire');
  });

  it('refuse le retrait après la date limite', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('lot_id', c.lotA).attach('files', faussePdf(), 'a.pdf');
    const id = depotsEn(c.projectId)[0].id;
    await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(authHeader(c.token)).send({ deadline_at: new Date(Date.now() - 1000).toISOString() });
    expect((await request(app).delete(`/api/public/depot/${jeton}/depots/${id}`)).status).toBe(403);
  });
});

describe('réglages et pièces publiées', () => {
  it("ne publie que des documents de l'affaire", async () => {
    const c = cabinet();
    const autre = cabinet();
    const bon = uid('doc'); const etranger = uid('doc');
    fakeSupabaseAdmin.seed('documents', [
      { id: bon, tenant_id: c.tenantId, project_id: c.projectId, name: 'RC.pdf', file_url: 'x', size_bytes: 10 },
      { id: etranger, tenant_id: autre.tenantId, project_id: autre.projectId, name: 'Secret.pdf', file_url: 'y' },
    ]);
    const r = await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(authHeader(c.token))
      .send({ published_document_ids: [bon, etranger], instructions: 'Remise avant le 30.' });
    expect(r.body.published_document_ids).toEqual([bon]);
    const { jeton } = await inviter(c);
    const ctx = await request(app).get(`/api/public/depot/${jeton}`);
    expect(ctx.body.pieces).toEqual([{ id: bon, nom: 'RC.pdf', taille: 10 }]);
    expect(ctx.body.instructions).toBe('Remise avant le 30.');
    expect((await request(app).get(`/api/public/depot/${jeton}/pieces/${etranger}`)).status).toBe(404);
  });

  it("n'offre à l'entreprise que les pièces du DCE de ses lots, sans cocher quoi que ce soit", async () => {
    const c = cabinet();
    const conn = fakeSupabaseAdmin.getTable('external_storage_connections').find(x => x.tenant_id === c.tenantId)!;
    const { buildExternalRef } = await import('../server/externalStorage/externalRef');
    const ref = (nom: string) => buildExternalRef({ provider: 'webdav', connectionId: conn.id, externalId: `ArchiOffice/${nom}`, fileName: nom });
    const rc = uid('doc'); const cctpA = uid('doc'); const cctpB = uid('doc'); const sansFichier = uid('doc');
    fakeSupabaseAdmin.seed('documents', [
      { id: rc, tenant_id: c.tenantId, project_id: c.projectId, name: 'RC.pdf', file_url: ref('RC.pdf'), size_bytes: 100 },
      { id: cctpA, tenant_id: c.tenantId, project_id: c.projectId, name: 'CCTP lot 02.pdf', file_url: ref('CCTP02.pdf') },
      { id: cctpB, tenant_id: c.tenantId, project_id: c.projectId, name: 'CCTP lot 03.pdf', file_url: ref('CCTP03.pdf') },
    ]);
    fakeSupabaseAdmin.seed('act_data', [{
      id: uid('act'), tenant_id: c.tenantId, project_id: c.projectId,
      consultation: {
        dce_documents: [
          { id: 'p1', nom: 'Règlement de consultation', type_doc: 'RC', tous_lots: true, lots_ids: [], document_ids: [rc] },
          { id: 'p2', nom: 'CCTP Charpente', type_doc: 'CCTP', tous_lots: false, lots_ids: [c.lotA], document_ids: [cctpA] },
          { id: 'p3', nom: 'CCTP Couverture', type_doc: 'CCTP', tous_lots: false, lots_ids: [c.lotB], document_ids: [cctpB] },
          { id: 'p4', nom: 'Pièce sans fichier', type_doc: 'Autre', tous_lots: true, lots_ids: [], document_ids: [sansFichier] },
        ],
      },
    }]);
    const { jeton } = await inviter(c); // lot A seulement
    const ctx = await request(app).get(`/api/public/depot/${jeton}`);
    expect(ctx.body.pieces).toEqual([]); // rien n'est coché dans les réglages
    expect(ctx.body.dce.map((p: any) => p.nom)).toEqual(['Règlement de consultation', 'CCTP Charpente']);
    expect(ctx.body.dce[0]).toMatchObject({ lots: null, fichiers: [{ id: rc, nom: 'RC.pdf', taille: 100 }] });
    expect(ctx.body.dce[1].lots).toEqual(['Lot 02 Charpente']);
    // Téléchargement : ses pièces oui, celles d'un autre lot non.
    expect((await request(app).get(`/api/public/depot/${jeton}/pieces/${cctpA}`).redirects(0)).status).toBe(302);
    expect((await request(app).get(`/api/public/depot/${jeton}/pieces/${rc}`).redirects(0)).status).toBe(302);
    expect((await request(app).get(`/api/public/depot/${jeton}/pieces/${cctpB}`)).status).toBe(404);
  });

  it("rend les dossiers partagés par lien externe, assainis et limités aux lots de l'entreprise", async () => {
    const c = cabinet();
    fakeSupabaseAdmin.seed('act_data', [{
      id: uid('act'), tenant_id: c.tenantId, project_id: c.projectId,
      consultation: {
        dce_documents: [
          { id: 'l1', nom: 'Plans (kDrive)', type_doc: 'Autre', partage: true, tous_lots: false, lots_ids: [c.lotA], document_ids: [],
            liens_externes: [
              { libelle: 'Plans', url: 'https://exemple.fr/plans' },
              { libelle: 'Piège', url: 'javascript:alert(1)' },
              { libelle: 'Non sécurisé', url: 'http://exemple.fr/x' },
            ] },
          { id: 'l2', nom: 'Autre lot', type_doc: 'Autre', partage: true, tous_lots: false, lots_ids: [c.lotB], document_ids: [],
            liens_externes: [{ libelle: 'Couverture', url: 'https://exemple.fr/couverture' }] },
          { id: 'l3', nom: 'Que des liens refusés', type_doc: 'Autre', partage: true, tous_lots: true, lots_ids: [], document_ids: [],
            liens_externes: [{ libelle: 'Piège', url: 'data:text/html,x' }] },
        ],
      },
    }]);
    const { jeton } = await inviter(c); // lot A seulement
    const ctx = await request(app).get(`/api/public/depot/${jeton}`);
    expect(ctx.body.dce.map((p: any) => p.nom)).toEqual(['Plans (kDrive)']);
    expect(ctx.body.dce[0].liens).toEqual([{ libelle: 'Plans', url: 'https://exemple.fr/plans' }]);
    expect(ctx.body.dce[0].fichiers).toEqual([]);
  });

  it('sert une pièce du DCE hébergée sur le drive par un jeton à courte durée', async () => {
    const c = cabinet();
    const conn = fakeSupabaseAdmin.getTable('external_storage_connections').find(x => x.tenant_id === c.tenantId)!;
    const { buildExternalRef } = await import('../server/externalStorage/externalRef');
    const doc = uid('doc');
    fakeSupabaseAdmin.seed('documents', [{
      id: doc, tenant_id: c.tenantId, project_id: c.projectId, name: 'RC.pdf',
      file_url: buildExternalRef({ provider: 'webdav', connectionId: conn.id, externalId: 'ArchiOffice/RC.pdf', fileName: 'RC.pdf' }),
    }]);
    await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(authHeader(c.token)).send({ published_document_ids: [doc] });
    const { jeton } = await inviter(c);
    const r = await request(app).get(`/api/public/depot/${jeton}/pieces/${doc}`).redirects(0);
    expect(r.status).toBe(302);
    expect(r.headers.location).toMatch(/^\/api\/storage\/external\//);
  });

  it('exige une date limite pour des plis scellés', async () => {
    const c = cabinet();
    const r = await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(authHeader(c.token)).send({ sealed: true });
    expect(r.status).toBe(400);
  });

  it("repousse l'échéance des liens quand la date limite recule", async () => {
    const c = cabinet();
    const { res } = await inviter(c);
    const avant = fakeSupabaseAdmin.getTable('consultation_depot_invites').find(i => i.id === res.body.id)!.expires_at;
    const loin = new Date(Date.now() + 400 * 24 * 3600_000).toISOString();
    await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(authHeader(c.token)).send({ deadline_at: loin });
    const apres = fakeSupabaseAdmin.getTable('consultation_depot_invites').find(i => i.id === res.body.id)!.expires_at;
    expect(new Date(apres).getTime()).toBeGreaterThan(new Date(avant).getTime());
  });
});

describe('plis scellés', () => {
  async function cabinetScelle() {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const futur = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(authHeader(c.token)).send({ deadline_at: futur, sealed: true }).expect(200);
    await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('lot_id', c.lotA).attach('files', faussePdf(), 'secret.pdf').expect(201);
    return { c, jeton, futur, depotId: depotsEn(c.projectId)[0].id };
  }

  it("montre qu'un pli existe sans en révéler le contenu ni le nom", async () => {
    const { c } = await cabinetScelle();
    const liste = await request(app).get(`/api/projects/${c.projectId}/depots`).set(authHeader(c.token));
    expect(liste.body.scelle).toBe(true);
    expect(liste.body.depots).toHaveLength(1);
    const d = liste.body.depots[0];
    expect(d).toMatchObject({ scelle: true, entreprise_nom: 'SARL Dupont', kind: 'fichier' });
    expect(d.file_name).toBeUndefined();
    expect(d.sha256).toBeUndefined();
    expect(d.payload).toBeUndefined();
    expect(JSON.stringify(liste.body)).not.toContain('archioffice+external');
  });

  it('refuse (423) d’ouvrir, d’intégrer ou de rejeter un pli scellé', async () => {
    const { c, depotId } = await cabinetScelle();
    const h = authHeader(c.token);
    expect((await request(app).get(`/api/depots/${depotId}/url`).set(h)).status).toBe(423);
    expect((await request(app).post(`/api/depots/${depotId}/integrer`).set(h)).status).toBe(423);
    expect((await request(app).post(`/api/depots/${depotId}/rejeter`).set(h)).status).toBe(423);
  });

  it('empêche de lever le scellement ou d’avancer la date limite', async () => {
    const { c, futur } = await cabinetScelle();
    const h = authHeader(c.token);
    const lever = await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(h).send({ deadline_at: futur, sealed: false });
    expect(lever.status).toBe(409);
    const avancer = await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(h)
      .send({ deadline_at: new Date(Date.now() + 3600_000).toISOString(), sealed: true });
    expect(avancer.status).toBe(409);
    const repousser = await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(h)
      .send({ deadline_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(), sealed: true });
    expect(repousser.status).toBe(200);
  });

  it('ouvre les plis une fois la date limite passée', async () => {
    const { c, depotId } = await cabinetScelle();
    fakeSupabaseAdmin.getTable('consultation_depot_settings').find(s => s.project_id === c.projectId)!.deadline_at = new Date(Date.now() - 1000).toISOString();
    const liste = await request(app).get(`/api/projects/${c.projectId}/depots`).set(authHeader(c.token));
    expect(liste.body.scelle).toBe(false);
    expect(liste.body.depots[0].file_name).toBe('secret.pdf');
    const url = await request(app).get(`/api/depots/${depotId}/url`).set(authHeader(c.token));
    expect(url.status).toBe(200);
    expect(url.body.url).toMatch(/^\/api\/storage\/external\//);
  });
});

describe('traitement par le cabinet', () => {
  it("marque une remise intégrée ou rejetée, une seule fois", async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    await request(app).post(`/api/public/depot/${jeton}/saisie`).send({ lot_id: c.lotA, montant_base: 1000 });
    const id = depotsEn(c.projectId)[0].id;
    const h = authHeader(c.token);
    expect((await request(app).post(`/api/depots/${id}/integrer`).set(h)).body.status).toBe('integre');
    expect((await request(app).post(`/api/depots/${id}/rejeter`).set(h)).status).toBe(409);
    expect(depotsEn(c.projectId)[0]).toMatchObject({ status: 'integre' });
  });

  it("n'accède pas aux remises d'un autre cabinet", async () => {
    const c = cabinet();
    const autre = cabinet();
    const { jeton } = await inviter(c);
    await request(app).post(`/api/public/depot/${jeton}/saisie`).send({ lot_id: c.lotA, montant_base: 1000 });
    const id = depotsEn(c.projectId)[0].id;
    expect((await request(app).post(`/api/depots/${id}/integrer`).set(authHeader(autre.token))).status).toBe(404);
    const liste = await request(app).get(`/api/projects/${c.projectId}/depots`).set(authHeader(autre.token));
    expect(liste.body.depots).toEqual([]);
  });

  it('refuse le traitement après la perte du plan Enterprise, mais laisse lire les remises reçues', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    await request(app).post(`/api/public/depot/${jeton}/saisie`).send({ lot_id: c.lotA, montant_base: 1000 });
    const id = depotsEn(c.projectId)[0].id;
    fakeSupabaseAdmin.getTable('tenants').find(t => t.id === c.tenantId)!.plan = 'pro';
    expect((await request(app).post(`/api/depots/${id}/integrer`).set(authHeader(c.token))).status).toBe(403);
    const liste = await request(app).get(`/api/projects/${c.projectId}/depots`).set(authHeader(c.token));
    expect(liste.body.depots).toHaveLength(1);
  });
});

describe('lecture des montants probables', () => {
  async function deposer(c: Cabinet, jeton: string, buffer: Buffer, nom: string, kind = 'fichier') {
    const r = await request(app).post(`/api/public/depot/${jeton}/fichiers`).field('lot_id', c.lotA).field('kind', kind).attach('files', buffer, nom);
    expect(r.status).toBe(201);
    return r.body.depots[0].id as string;
  }
  const analyser = (c: Cabinet, id: string) => request(app).post(`/api/depots/${id}/analyser`).set(authHeader(c.token));

  it('lit un devis PDF et propose le total HT en premier', async () => {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF();
    pdf.text('DEVIS 2026-118', 10, 10);
    pdf.text('Charpente bois          24 320,00 EUR', 10, 20);
    pdf.text('Total HT                36 200,00 EUR', 10, 30);
    pdf.text('TVA 20 %                 7 240,00 EUR', 10, 40);
    pdf.text('Total TTC               43 440,00 EUR', 10, 50);
    const c = cabinet();
    const { jeton } = await inviter(c);
    const id = await deposer(c, jeton, Buffer.from(pdf.output('arraybuffer')), 'devis.pdf');
    const r = await analyser(c, id);
    expect(r.status).toBe(200);
    expect(r.body.texte_lu).toBe(true);
    expect(r.body.candidats[0]).toMatchObject({ montant: 36200, nature: 'total_ht' });
    expect(r.body.candidats.find((x: any) => x.montant === 7240)).toBeUndefined();
  });

  it('lit un tableur xlsx ou ods dont les cellules n’ont pas de symbole €', async () => {
    const XLSX = await import('xlsx');
    const feuille = XLSX.utils.aoa_to_sheet([['Désignation', 'Montant'], ['Charpente', 24320], ['Total HT', 36200], ['TVA 20 %', 7240]]);
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, 'Devis');
    const c = cabinet();
    const { jeton } = await inviter(c);
    for (const [type, nom] of [['xlsx', 'devis.xlsx'], ['ods', 'devis.ods']] as const) {
      const buffer = Buffer.from(XLSX.write(classeur, { type: 'buffer', bookType: type }));
      const id = await deposer(c, jeton, buffer, nom, 'bordereau');
      const r = await analyser(c, id);
      expect(r.body.candidats[0]).toMatchObject({ montant: 36200, nature: 'total_ht' });
    }
  });

  it('lit un document Word', async () => {
    const docx = await import('docx');
    const doc = new docx.Document({ sections: [{ children: [
      new docx.Paragraph('Notre offre'),
      new docx.Paragraph('Prix global HT : 18 500,00 €'),
    ] }] });
    const c = cabinet();
    const { jeton } = await inviter(c);
    const id = await deposer(c, jeton, Buffer.from(await docx.Packer.toBuffer(doc)), 'offre.docx');
    const r = await analyser(c, id);
    expect(r.body.candidats[0]).toMatchObject({ montant: 18500, nature: 'total_ht' });
  });

  it('dit honnêtement qu’un PDF sans texte est illisible', async () => {
    const { jsPDF } = await import('jspdf');
    const c = cabinet();
    const { jeton } = await inviter(c);
    const id = await deposer(c, jeton, Buffer.from(new jsPDF().output('arraybuffer')), 'scan.pdf');
    const r = await analyser(c, id);
    expect(r.body).toMatchObject({ texte_lu: false, candidats: [] });
    expect(r.body.note).toMatch(/scanné/);
  });

  it('refuse l’analyse d’un pli scellé, d’une saisie ou hors plan Enterprise', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    const id = await deposer(c, jeton, faussePdf(), 'a.pdf');
    await request(app).post(`/api/public/depot/${jeton}/saisie`).send({ lot_id: c.lotA, montant_base: 5 });
    const saisie = depotsEn(c.projectId).find(d => d.kind === 'saisie')!.id;
    expect((await analyser(c, saisie)).status).toBe(400);

    await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(authHeader(c.token))
      .send({ deadline_at: new Date(Date.now() + 86400_000).toISOString(), sealed: true });
    expect((await analyser(c, id)).status).toBe(423);

    fakeSupabaseAdmin.getTable('tenants').find(t => t.id === c.tenantId)!.plan = 'pro';
    expect((await analyser(c, id)).status).toBe(403);
  });
});


describe('portail public : tout le dossier en une archive et visite de site', () => {
  const lireZip = async (jeton: string) => {
    const res = await request(app).get(`/api/public/depot/${jeton}/dossier.zip`)
      .buffer(true).parse((r, cb) => { const morceaux: Buffer[] = []; r.on('data', (m: Buffer) => morceaux.push(m)); r.on('end', () => cb(null, Buffer.concat(morceaux))); });
    return res;
  };

  async function dossier(c: Cabinet, extra: Record<string, any> = {}) {
    const conn = fakeSupabaseAdmin.getTable('external_storage_connections').find(x => x.tenant_id === c.tenantId)!;
    const { buildExternalRef } = await import('../server/externalStorage/externalRef');
    const ajoute = (cle: string, nom: string, contenu: string) => {
      memoryDrive.files.set(cle, { id: cle, parentId: '', name: nom, buffer: Buffer.from(contenu), mimeType: 'application/pdf', trashed: false });
      return buildExternalRef({ provider: 'webdav', connectionId: conn.id, externalId: cle, fileName: nom });
    };
    const rc = uid('doc'); const cctpA = uid('doc'); const cctpB = uid('doc'); const publie = uid('doc'); const absent = uid('doc');
    fakeSupabaseAdmin.seed('documents', [
      { id: rc, tenant_id: c.tenantId, project_id: c.projectId, name: 'RC.pdf', file_url: ajoute('ArchiOffice/RC.pdf', 'RC.pdf', 'contenu RC') },
      { id: cctpA, tenant_id: c.tenantId, project_id: c.projectId, name: 'CCTP charpente.pdf', file_url: ajoute('ArchiOffice/A.pdf', 'CCTP charpente.pdf', 'contenu A') },
      { id: cctpB, tenant_id: c.tenantId, project_id: c.projectId, name: 'CCTP couverture.pdf', file_url: ajoute('ArchiOffice/B.pdf', 'CCTP couverture.pdf', 'contenu B') },
      { id: publie, tenant_id: c.tenantId, project_id: c.projectId, name: 'Notice sécurité.pdf', file_url: ajoute('ArchiOffice/N.pdf', 'Notice sécurité.pdf', 'contenu N') },
      { id: absent, tenant_id: c.tenantId, project_id: c.projectId, name: 'Disparu.pdf', file_url: buildExternalRef({ provider: 'webdav', connectionId: conn.id, externalId: 'ArchiOffice/disparu.pdf', fileName: 'Disparu.pdf' }) },
    ]);
    fakeSupabaseAdmin.seed('act_data', [{
      id: uid('act'), tenant_id: c.tenantId, project_id: c.projectId,
      consultation: {
        dce_documents: [
          { id: 'p1', nom: 'Règlement de consultation', type_doc: 'RC', tous_lots: true, lots_ids: [], document_ids: [rc, absent] },
          { id: 'p2', nom: 'CCTP Charpente', type_doc: 'CCTP', tous_lots: false, lots_ids: [c.lotA], document_ids: [cctpA] },
          { id: 'p3', nom: 'CCTP Couverture', type_doc: 'CCTP', tous_lots: false, lots_ids: [c.lotB], document_ids: [cctpB] },
          { id: 'p4', nom: 'Plans (kDrive)', type_doc: 'Autre', partage: true, tous_lots: true, lots_ids: [], document_ids: [],
            liens_externes: [{ libelle: 'Plans', url: 'https://exemple.fr/plans' }, { libelle: 'Piège', url: 'javascript:alert(1)' }] },
        ],
        ...extra,
      },
    }]);
    await request(app).put(`/api/projects/${c.projectId}/depot/settings`).set(authHeader(c.token)).send({ published_document_ids: [publie, rc] });
    return { rc, cctpA, cctpB, publie, absent };
  }

  it('rassemble les pièces de ses lots et les documents publiés, rangés par pièce, sans doublon', async () => {
    const c = cabinet();
    await dossier(c);
    const { jeton } = await inviter(c); // lot A seulement
    const res = await lireZip(jeton);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="Villa Martin - Dossier de consultation\.zip"/);
    expect(res.headers['cache-control']).toContain('no-store');
    const zip = await JSZip.loadAsync(res.body as Buffer);
    const noms = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort();
    expect(noms).toEqual([
      'CCTP Charpente/CCTP charpente.pdf',
      'Documents complémentaires/Notice sécurité.pdf',
      'Fichiers non ajoutés.txt',
      'Liens externes.txt',
      'Règlement de consultation/RC.pdf', // le RC publié aussi n'est pas ajouté deux fois
    ].sort());
    expect(await zip.file('Règlement de consultation/RC.pdf')!.async('string')).toBe('contenu RC');
  });

  it('ne contient jamais la pièce d\'un autre lot', async () => {
    const c = cabinet();
    await dossier(c);
    const { jeton } = await inviter(c);
    const zip = await JSZip.loadAsync((await lireZip(jeton)).body as Buffer);
    expect(Object.keys(zip.files).join('\n')).not.toContain('Couverture');
  });

  it('signale un fichier introuvable et ne garde que les liens https', async () => {
    const c = cabinet();
    await dossier(c);
    const { jeton } = await inviter(c);
    const zip = await JSZip.loadAsync((await lireZip(jeton)).body as Buffer);
    expect(await zip.file('Fichiers non ajoutés.txt')!.async('string')).toContain('Disparu.pdf');
    const liens = await zip.file('Liens externes.txt')!.async('string');
    expect(liens).toContain('https://exemple.fr/plans');
    expect(liens).not.toContain('javascript');
  });

  it('annonce le dossier dans le contexte, sans doublon entre DCE et documents publiés', async () => {
    const c = cabinet();
    await dossier(c);
    const { jeton } = await inviter(c);
    const ctx = await request(app).get(`/api/public/depot/${jeton}`);
    expect(ctx.body.dossier_zip.fichiers).toBe(4); // RC, absent, CCTP charpente, notice (RC publié compté une fois)
  });

  it('répond 404 et n\'annonce rien quand il n\'y a aucun fichier', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    expect((await request(app).get(`/api/public/depot/${jeton}`)).body.dossier_zip).toBeNull();
    expect((await request(app).get(`/api/public/depot/${jeton}/dossier.zip`)).status).toBe(404);
  });

  it('exige un lien valide : 404 identique pour un jeton inconnu', async () => {
    expect((await request(app).get(`/api/public/depot/dpt_${'z'.repeat(43)}/dossier.zip`)).status).toBe(404);
  });

  it('se ferme comme le reste du portail quand le cabinet quitte le plan Enterprise', async () => {
    const c = cabinet();
    await dossier(c);
    const { jeton } = await inviter(c);
    fakeSupabaseAdmin.getTable('tenants').find(t => t.id === c.tenantId)!.plan = 'pro';
    expect((await request(app).get(`/api/public/depot/${jeton}/dossier.zip`)).status).toBe(503);
  });

  it('annonce son créneau de visite, le lieu et les consignes', async () => {
    const c = cabinet();
    await dossier(c, {
      creneaux_visite: [{ id: 'c1', date_heure: '2030-06-10T09:30' }, { id: 'c2', date_heure: '2030-06-12T14:00' }],
      entreprises: [{ id: 'e1', nom: 'SARL Dupont', lots_ids: [c.lotA], visite_creneau_id: 'c2' }],
      visite_site: { lieu: ' 12 rue du Chantier ', consignes: 'Casque obligatoire' },
    });
    const { jeton } = await inviter(c);
    const { body } = await request(app).get(`/api/public/depot/${jeton}`);
    expect(body.visite).toEqual({ creneau: '2030-06-12T14:00', propositions: [], lieu: '12 rue du Chantier', consignes: 'Casque obligatoire', confirmee_le: null });
  });

  it('propose les créneaux à venir sans créneau affecté, jamais ceux du passé, et ne montre pas les autres entreprises', async () => {
    const c = cabinet();
    await dossier(c, {
      creneaux_visite: [{ id: 'p', date_heure: '2020-01-01T09:00' }, { id: 'c1', date_heure: '2030-06-10T09:30' }],
      entreprises: [{ id: 'e1', nom: 'SARL Dupont', lots_ids: [c.lotA] }, { id: 'e2', nom: 'Autre SARL', lots_ids: [c.lotB], visite_creneau_id: 'c1' }],
    });
    const { jeton } = await inviter(c);
    const { body } = await request(app).get(`/api/public/depot/${jeton}`);
    expect(body.visite.creneau).toBeNull();
    expect(body.visite.propositions).toEqual(['2030-06-10T09:30']);
    expect(JSON.stringify(body)).not.toContain('Autre SARL');
  });

  it('n\'annonce aucune visite sans créneau citable', async () => {
    const c = cabinet();
    await dossier(c, { visite_site: { lieu: 'Chantier' }, creneaux_visite: [] });
    const { jeton } = await inviter(c);
    expect((await request(app).get(`/api/public/depot/${jeton}`)).body.visite).toBeNull();
  });
});


describe('portail public : questions et confirmation de présence', () => {
  const consultation = (c: Cabinet, extra: Record<string, any> = {}) => fakeSupabaseAdmin.seed('act_data', [{
    id: uid('act'), tenant_id: c.tenantId, project_id: c.projectId, consultation: extra,
  }]);
  const poser = (jeton: string, corps: Record<string, any>) => request(app).post(`/api/public/depot/${jeton}/questions`).send(corps);
  const questionsEn = (projectId: string) => fakeSupabaseAdmin.getTable('consultation_depot_questions').filter(q => q.project_id === projectId);

  it('enregistre la question dans la boîte de réception, jamais dans la consultation', async () => {
    const c = cabinet();
    consultation(c, { questions: [] });
    const { jeton } = await inviter(c);
    const r = await poser(jeton, { objet: ' Cotes ', question: 'Quelle est la cote du linteau ?', lot_id: c.lotA });
    expect(r.status).toBe(201);
    const [ligne] = questionsEn(c.projectId);
    expect(ligne).toMatchObject({ entreprise_id: 'e1', entreprise_nom: 'SARL Dupont', lot_id: c.lotA, objet: 'Cotes', question: 'Quelle est la cote du linteau ?' });
    expect(fakeSupabaseAdmin.getTable('act_data').find(a => a.project_id === c.projectId)!.consultation.questions).toEqual([]);
  });

  it('rend la question à l\'entreprise, en attente puis avec la réponse saisie par l\'architecte', async () => {
    const c = cabinet();
    consultation(c, { questions: [] });
    const { jeton } = await inviter(c);
    const { body: { question } } = await poser(jeton, { question: 'Quelle est la cote du linteau ?' });
    let ctx = (await request(app).get(`/api/public/depot/${jeton}`)).body;
    expect(ctx.questions.mes_questions).toMatchObject([{ id: question.id, reponse: null }]);
    // L'architecte répond dans la consultation (où la réponse fait foi).
    fakeSupabaseAdmin.getTable('act_data').find(a => a.project_id === c.projectId)!.consultation.questions = [
      { id: question.id, entreprise_id: 'e1', question: 'x', reponse: '  1,20 m  ', date_reponse: '2026-11-24', publique: false },
    ];
    ctx = (await request(app).get(`/api/public/depot/${jeton}`)).body;
    expect(ctx.questions.mes_questions[0]).toMatchObject({ reponse: '1,20 m', reponse_le: '2026-11-24' });
  });

  it('refuse une question vide, trop longue ou visant un lot qui n\'est pas le sien', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c); // lot A seulement
    expect((await poser(jeton, { question: '   ' })).status).toBe(400);
    expect((await poser(jeton, { question: 'x'.repeat(2001) })).status).toBe(400);
    expect((await poser(jeton, { question: 'Une vraie question', lot_id: c.lotB })).status).toBe(400);
    expect(questionsEn(c.projectId)).toHaveLength(0);
  });

  it('refuse après la date limite des questions, accepte avant', async () => {
    const c = cabinet();
    consultation(c, { date_limite_questions: '2020-01-01T10:00' });
    const { jeton } = await inviter(c);
    const r = await poser(jeton, { question: 'Une question tardive ?' });
    expect(r.status).toBe(403);
    expect(r.body.error).toContain('date limite');
    const ctx = (await request(app).get(`/api/public/depot/${jeton}`)).body;
    expect(ctx.questions).toMatchObject({ ouvertes: false, date_limite: '2020-01-01T10:00' });
    fakeSupabaseAdmin.getTable('act_data').find(a => a.project_id === c.projectId)!.consultation.date_limite_questions = '2099-01-01T10:00';
    expect((await poser(jeton, { question: 'Une question dans les temps ?' })).status).toBe(201);
  });

  it('plafonne le nombre de questions par entreprise', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    for (let i = 0; i < 20; i += 1) expect((await poser(jeton, { question: `Question numéro ${i} ?` })).status).toBe(201);
    expect((await poser(jeton, { question: 'Une de trop ?' })).status).toBe(429);
  });

  it('une entreprise ne voit jamais les questions d\'une autre, mais lit les réponses publiques sans le nom de l\'auteur', async () => {
    const c = cabinet();
    const a = await inviter(c);
    const b = await inviter(c, { entreprise_id: 'e2', entreprise_nom: 'SA Concurrent', email: 'c@example.test', lots_ids: [c.lotA] });
    const q = (await poser(a.jeton, { question: 'Question secrète de Dupont ?' })).body.question;
    consultation(c, { questions: [
      { id: q.id, entreprise_id: 'e1', entreprise_nom: 'SARL Dupont', question: 'Question secrète de Dupont ?', reponse: 'Réponse privée', publique: false },
      { id: 'pub', entreprise_id: 'e1', entreprise_nom: 'SARL Dupont', question: 'Épaisseur du plancher ?', objet: 'Plancher', reponse: 'Vingt centimètres', date_reponse: '2026-11-24', publique: true },
    ] });
    const ctxB = (await request(app).get(`/api/public/depot/${b.jeton}`)).body;
    expect(ctxB.questions.mes_questions).toEqual([]);
    expect(ctxB.questions.reponses_publiques).toEqual([{ id: 'pub', objet: 'Plancher', question: 'Épaisseur du plancher ?', reponse: 'Vingt centimètres', reponse_le: '2026-11-24' }]);
    expect(JSON.stringify(ctxB)).not.toContain('Dupont');
    expect(JSON.stringify(ctxB)).not.toContain('Réponse privée');
  });

  it('une réponse publique d\'un lot n\'est montrée qu\'aux entreprises de ce lot', async () => {
    const c = cabinet();
    consultation(c, { questions: [
      { id: 'lotB', entreprise_id: 'x', question: 'Pente de toiture ?', reponse: 'Trente degrés', publique: true, lot_id: c.lotB },
      { id: 'general', entreprise_id: 'x', question: 'Horaires de chantier ?', reponse: '8h-17h', publique: true },
      { id: 'sansReponse', entreprise_id: 'x', question: 'Sans réponse ?', publique: true },
    ] });
    const { jeton } = await inviter(c); // lot A seulement
    const ctx = (await request(app).get(`/api/public/depot/${jeton}`)).body;
    expect(ctx.questions.reponses_publiques.map((r: any) => r.id)).toEqual(['general']);
  });

  it('ferme les questions comme le reste du portail quand le lien est invalide', async () => {
    expect((await poser(`dpt_${'q'.repeat(43)}`, { question: 'Une question ?' })).status).toBe(404);
  });

  it('n\'a aucun créneau à confirmer sans créneau affecté', async () => {
    const c = cabinet();
    consultation(c, { creneaux_visite: [{ id: 'c1', date_heure: '2030-06-10T09:30' }], entreprises: [{ id: 'e1', lots_ids: [c.lotA] }] });
    const { jeton } = await inviter(c);
    expect((await request(app).post(`/api/public/depot/${jeton}/visite/confirmer`)).status).toBe(409);
  });

  it('confirme la présence sur l\'invitation, une seule fois, sans toucher à la consultation', async () => {
    const c = cabinet();
    consultation(c, {
      creneaux_visite: [{ id: 'c1', date_heure: '2030-06-10T09:30' }],
      entreprises: [{ id: 'e1', lots_ids: [c.lotA], visite_creneau_id: 'c1', visite_presence: 'prevue' }],
    });
    const { jeton } = await inviter(c);
    const premiere = await request(app).post(`/api/public/depot/${jeton}/visite/confirmer`);
    expect(premiere.status).toBe(200);
    const seconde = await request(app).post(`/api/public/depot/${jeton}/visite/confirmer`);
    expect(seconde.body.confirmee_le).toBe(premiere.body.confirmee_le);
    const ctx = (await request(app).get(`/api/public/depot/${jeton}`)).body;
    expect(ctx.visite.confirmee_le).toBe(premiere.body.confirmee_le);
    const act = fakeSupabaseAdmin.getTable('act_data').find(a => a.project_id === c.projectId)!;
    expect(act.consultation.entreprises[0].visite_presence).toBe('prevue');
  });

  it('côté cabinet : liste les questions de l\'affaire, authentification exigée, jamais celles d\'un autre cabinet', async () => {
    const c = cabinet();
    const autre = cabinet();
    const { jeton } = await inviter(c);
    const { jeton: jetonAutre } = await inviter(autre);
    await poser(jeton, { question: 'Question du cabinet A ?' });
    await poser(jetonAutre, { question: 'Question du cabinet B ?' });
    expect((await request(app).get(`/api/projects/${c.projectId}/depot/questions`)).status).toBe(401);
    const liste = await request(app).get(`/api/projects/${c.projectId}/depot/questions`).set(authHeader(c.token));
    expect(liste.status).toBe(200);
    expect(liste.body.map((q: any) => q.question)).toEqual(['Question du cabinet A ?']);
    expect(Object.keys(liste.body[0]).sort()).toEqual(['created_at', 'entreprise_id', 'entreprise_nom', 'id', 'lot_id', 'objet', 'question']);
    const croise = await request(app).get(`/api/projects/${autre.projectId}/depot/questions`).set(authHeader(c.token));
    expect(croise.status).toBe(404);
  });

  it('côté cabinet : supprimer une question la retire de la boîte de réception, pas celle d\'un autre cabinet', async () => {
    const c = cabinet();
    const autre = cabinet();
    const { jeton } = await inviter(c);
    const { jeton: jetonAutre } = await inviter(autre);
    const q = (await poser(jeton, { question: 'À supprimer ?' })).body.question;
    const qAutre = (await poser(jetonAutre, { question: 'À conserver ?' })).body.question;
    await request(app).delete(`/api/projects/${autre.projectId}/depot/questions/${q.id}`).set(authHeader(autre.token)).expect(200);
    expect(questionsEn(c.projectId)).toHaveLength(1); // le DELETE d'un autre cabinet n'a rien supprimé
    await request(app).delete(`/api/projects/${c.projectId}/depot/questions/${q.id}`).set(authHeader(c.token)).expect(200);
    expect(questionsEn(c.projectId)).toHaveLength(0);
    expect(questionsEn(autre.projectId).map(x => x.id)).toEqual([qAutre.id]);
  });

  it('la liste des liens du cabinet expose la confirmation de présence', async () => {
    const c = cabinet();
    consultation(c, { creneaux_visite: [{ id: 'c1', date_heure: '2030-06-10T09:30' }], entreprises: [{ id: 'e1', lots_ids: [c.lotA], visite_creneau_id: 'c1' }] });
    const { jeton } = await inviter(c);
    await request(app).post(`/api/public/depot/${jeton}/visite/confirmer`).expect(200);
    const liens = await request(app).get(`/api/projects/${c.projectId}/depot/invites`).set(authHeader(c.token));
    expect(liens.body[0].visite_confirmee_le).toBeTruthy();
  });
});


describe('additifs au DCE : accusé de réception et page de l\'entreprise', () => {
  const seedConsultation = (c: Cabinet, extra: Record<string, any> = {}) => fakeSupabaseAdmin.seed('act_data', [{
    id: uid('act'), tenant_id: c.tenantId, project_id: c.projectId,
    consultation: {
      entreprises: [{ id: 'e1', nom: 'SARL Dupont', lots_ids: [c.lotA] }],
      dce_documents: [
        { id: 'p1', nom: 'CCTP Charpente', type_doc: 'CCTP', tous_lots: false, lots_ids: [c.lotA], document_ids: [] },
        { id: 'p2', nom: 'CCTP Couverture', type_doc: 'CCTP', tous_lots: false, lots_ids: [c.lotB], document_ids: [] },
      ],
      dce_revisions: [
        { id: 'r1', cree_le: '2026-11-20', motif: 'Cotes modifiées', pieces: [{ id: 'p1', libelle: 'CCTP Charpente', indice: 'C' }] },
        { id: 'r2', cree_le: '2026-11-22', motif: 'Autre lot', pieces: [{ id: 'p2', libelle: 'CCTP Couverture' }] },
      ],
      ...extra,
    },
  }]);
  const accusesEn = (projectId: string) => fakeSupabaseAdmin.getTable('consultation_additif_accuses').filter(a => a.project_id === projectId);
  const chemin = (ticket: string) => `/api/public/additif/accuse/${ticket}`;
  const ticket = (c: Cabinet, e = 'e1', r = 'r1') => signerAccuse({ t: c.tenantId, p: c.projectId, e, r });

  it('crée un lien signé par entreprise, valable pour ce seul additif', async () => {
    const c = cabinet();
    const res = await request(app).post(`/api/projects/${c.projectId}/depot/additifs/r1/liens`).set(authHeader(c.token))
      .send({ entreprises: [{ id: 'e1', nom: 'SARL Dupont' }, { id: 'e2' }] });
    expect(res.status).toBe(200);
    const [t1, t2] = ['e1', 'e2'].map(id => res.body.liens[id].split('/api/public/additif/accuse/')[1]);
    expect(lireAccuse(t1)).toMatchObject({ t: c.tenantId, p: c.projectId, e: 'e1', r: 'r1' });
    expect(lireAccuse(t2)).toMatchObject({ e: 'e2' });
    expect(t1).not.toBe(t2);
  });

  it('refuse sans authentification, pour une affaire d\'un autre cabinet, ou avec des données invalides', async () => {
    const c = cabinet();
    const autre = cabinet();
    const url = (p: string, r = 'r1') => `/api/projects/${p}/depot/additifs/${r}/liens`;
    expect((await request(app).post(url(c.projectId)).send({ entreprises: [{ id: 'e1' }] })).status).toBe(401);
    expect((await request(app).post(url(autre.projectId)).set(authHeader(c.token)).send({ entreprises: [{ id: 'e1' }] })).status).toBe(404);
    expect((await request(app).post(url(c.projectId)).set(authHeader(c.token)).send({ entreprises: [] })).status).toBe(400);
    expect((await request(app).post(url(c.projectId)).set(authHeader(c.token)).send({ entreprises: [{ id: 42 }] })).status).toBe(400);
    expect((await request(app).post(url(c.projectId, 'a b')).set(authHeader(c.token)).send({ entreprises: [{ id: 'e1' }] })).status).toBe(400);
  });

  it('le lien du mail n\'AFFICHE que la page : il ne confirme rien (un anti-virus de messagerie l\'ouvre)', async () => {
    const c = cabinet();
    seedConsultation(c);
    const page = await request(app).get(chemin(ticket(c)));
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.text).toContain('Confirmer la réception');
    expect(page.text).toContain('J\'ai bien reçu');
    expect(page.text).toContain("l'additif n° 1");
    expect(page.text).toContain('Villa Martin');
    expect(accusesEn(c.projectId)).toHaveLength(0);
  });

  it('enregistre l\'accusé au POST, une seule fois, et le montre au cabinet', async () => {
    const c = cabinet();
    seedConsultation(c);
    const t = ticket(c);
    const premier = await request(app).post(chemin(t));
    expect(premier.status).toBe(200);
    expect(premier.text).toContain('Réception confirmée');
    const [accuse] = accusesEn(c.projectId);
    expect(accuse).toMatchObject({ tenant_id: c.tenantId, revision_id: 'r1', entreprise_id: 'e1', entreprise_nom: 'SARL Dupont' });
    await request(app).post(chemin(t)).expect(200); // double clic
    expect(accusesEn(c.projectId)).toHaveLength(1);
    expect(accusesEn(c.projectId)[0].accuse_le).toBe(accuse.accuse_le); // le premier accusé fait foi
    expect((await request(app).get(chemin(t))).text).toContain('Réception déjà confirmée');
    const liste = await request(app).get(`/api/projects/${c.projectId}/depot/additifs/accuses`).set(authHeader(c.token));
    expect(liste.body).toEqual([{ revision_id: 'r1', entreprise_id: 'e1', accuse_le: accuse.accuse_le }]);
  });

  it('refuse un ticket altéré, expiré, mal formé ou visant une affaire qui n\'est pas celle du cabinet signataire', async () => {
    const c = cabinet();
    const autre = cabinet();
    seedConsultation(c);
    const t = ticket(c);
    expect((await request(app).post(chemin(`${t.slice(0, -2)}xx`))).status).toBe(404);
    expect((await request(app).post(chemin('nimporte.quoi'))).status).toBe(404);
    expect((await request(app).post(chemin(signerAccuse({ t: c.tenantId, p: c.projectId, e: 'e1', r: 'r1' }, -10)))).status).toBe(404);
    // Un ticket signé pour le cabinet A mais l'affaire du cabinet B : aucune ligne n'est écrite.
    expect((await request(app).post(chemin(signerAccuse({ t: c.tenantId, p: autre.projectId, e: 'e1', r: 'r1' })))).status).toBe(404);
    expect(accusesEn(c.projectId)).toHaveLength(0);
    expect(accusesEn(autre.projectId)).toHaveLength(0);
  });

  it('échappe le nom de l\'entreprise dans la page (aucune injection de HTML)', async () => {
    const c = cabinet();
    seedConsultation(c, { entreprises: [{ id: 'e1', nom: '<img src=x onerror=alert(1)>', lots_ids: [c.lotA] }] });
    const page = await request(app).get(chemin(ticket(c)));
    expect(page.text).not.toContain('<img src=x');
    expect(page.text).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('page de l\'entreprise : ses additifs seulement, avec la date de son accusé', async () => {
    const c = cabinet();
    seedConsultation(c);
    const { jeton } = await inviter(c); // entreprise e1, lot A
    let ctx = (await request(app).get(`/api/public/depot/${jeton}`)).body;
    expect(ctx.additifs).toHaveLength(1); // r2 vise le lot B : jamais montré
    expect(ctx.additifs[0]).toMatchObject({ id: 'r1', numero: 1, date: '2026-11-20', motif: 'Cotes modifiées', accuse_le: null });
    expect(ctx.additifs[0].pieces).toEqual([{ libelle: 'CCTP Charpente', indice: 'C' }]);
    expect(JSON.stringify(ctx.additifs)).not.toContain('Autre lot');
    await request(app).post(chemin(ticket(c))).expect(200);
    ctx = (await request(app).get(`/api/public/depot/${jeton}`)).body;
    expect(ctx.additifs[0].accuse_le).toBeTruthy();
  });

  it('page de l\'entreprise : aucun additif quand il n\'y en a pas', async () => {
    const c = cabinet();
    const { jeton } = await inviter(c);
    expect((await request(app).get(`/api/public/depot/${jeton}`)).body.additifs).toEqual([]);
  });

  it('côté cabinet : les accusés d\'un autre cabinet ne sont jamais listés', async () => {
    const c = cabinet();
    const autre = cabinet();
    seedConsultation(c);
    seedConsultation(autre);
    await request(app).post(chemin(ticket(autre))).expect(200);
    const liste = await request(app).get(`/api/projects/${c.projectId}/depot/additifs/accuses`).set(authHeader(c.token));
    expect(liste.body).toEqual([]);
    expect((await request(app).get(`/api/projects/${autre.projectId}/depot/additifs/accuses`).set(authHeader(c.token))).status).toBe(404);
  });
});
