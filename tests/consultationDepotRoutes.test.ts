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
