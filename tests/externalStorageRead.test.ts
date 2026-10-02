// La lecture d'un fichier hébergé sur l'espace du cabinet :
// GET /api/storage/signed-url (branche externe) et GET /api/storage/external/:ticket
// — server/routes/storageAccess.ts et server/externalStorage/externalTicket.ts.
//
// Le contrat rendu au client ne change pas (une URL ouvrable pendant une heure),
// mais elle pointe sur notre propre origine et c'est un jeton signé qui
// l'autorise : openSignedUrl() ouvre par window.open() et <SignedImage> pose
// l'URL dans un `src`, deux navigations qui ne peuvent porter aucun JWT.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader, connectExternalStorage,
} from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';
import { signExternalTicket } from '../server/externalStorage/externalTicket';
import { buildExternalRef, parseExternalRef } from '../server/externalStorage/externalRef';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

beforeEach(() => {
  memoryDrive.reset();
  memoryDrive.temporaryLink = null;
});

/** Dépose un document sur l'espace du cabinet et rend sa référence. */
async function uploadExternal(tenantId: string, token: string, projectId: string) {
  fakeSupabaseAdmin.seed('projects', [{ id: projectId, tenant_id: tenantId, project_code: '26014', name: 'Villa Martin' }]);
  const res = await request(app).post('/api/documents').set(authHeader(token))
    .field('project_id', projectId).field('name', 'CCTP').field('category', 'CCTP').field('phase', 'DCE')
    .attach('file', Buffer.from('contenu-du-plan'), 'cctp.pdf');
  const doc = fakeSupabaseAdmin.getTable('documents').find((d) => d.id === res.body.id);
  return doc!.file_url as string;
}

describe('GET /api/storage/signed-url — référence externe', () => {
  it('rend une URL servie par nous, jamais un lien vers le drive', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    const fileUrl = await uploadExternal(tenantId, token, 'r1');

    const res = await request(app).get('/api/storage/signed-url').set(authHeader(token)).query({ url: fileUrl });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/api\/storage\/external\//);
    expect(res.body.expiresIn).toBe(3600);
  });

  // Faute de préfixe `${tenantId}/` dans le chemin, c'est l'appartenance de la
  // CONNEXION au cabinet qui fait frontière d'autorisation.
  it('refuse la référence d’un autre cabinet', async () => {
    const tenantA = makeTenant();
    const { token: tokenA } = makeUser(tenantA);
    connectExternalStorage(tenantA);
    const fileUrl = await uploadExternal(tenantA, tokenA, 'r2');

    const tenantB = makeTenant();
    const { token: tokenB } = makeUser(tenantB);
    const res = await request(app).get('/api/storage/signed-url').set(authHeader(tokenB)).query({ url: fileUrl });
    expect(res.status).toBe(403);
  });

  it('refuse une référence externe malformée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const res = await request(app).get('/api/storage/signed-url').set(authHeader(token))
      .query({ url: 'archioffice+external://google_drive/incomplet' });
    expect(res.status).toBe(400);
  });

  it('résout toujours une référence Supabase historique de la même façon', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('projects', [{ id: 'r3', tenant_id: tenantId }]);
    const uploaded = await request(app).post('/api/documents').set(authHeader(token))
      .field('project_id', 'r3').field('name', 'Ancien').field('category', 'CCTP')
      .attach('file', Buffer.from('%PDF-fake'), 'ancien.pdf');
    const doc = fakeSupabaseAdmin.getTable('documents').find((d) => d.id === uploaded.body.id);

    const res = await request(app).get('/api/storage/signed-url').set(authHeader(token)).query({ url: doc!.file_url });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/object/sign/documents/');
  });
});

describe('GET /api/storage/external/:ticket', () => {
  it('sert les octets du fichier', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    const fileUrl = await uploadExternal(tenantId, token, 'r4');
    const { url } = (await request(app).get('/api/storage/signed-url').set(authHeader(token)).query({ url: fileUrl })).body;

    // Pas d'en-tête Authorization ici, délibérément : c'est tout l'intérêt du jeton.
    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('contenu-du-plan');
    expect(res.headers['content-disposition']).toContain('cctp.pdf');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  // pdf.js (PlanAnnotator) découpe les gros plans en requêtes Range : un serveur
  // qui les ignore casse l'affichage sans rien dire.
  it('retransmet la requête Range et rejoue le 206', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId);
    const fileUrl = await uploadExternal(tenantId, token, 'r5');
    const { url } = (await request(app).get('/api/storage/signed-url').set(authHeader(token)).query({ url: fileUrl })).body;

    const res = await request(app).get(url).set('Range', 'bytes=0-6');
    expect(memoryDrive.lastRangeHeader).toBe('bytes=0-6');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-6/15');
    expect(res.body.toString()).toBe('contenu');
  });

  // Un lien temporaire de fournisseur (Dropbox) est propre au porteur et de
  // courte durée : il n'élargit pas le partage du fichier dans l'espace du
  // cabinet, ce qu'on se refuse à faire en son nom.
  it('redirige quand le fournisseur sait produire un lien temporaire', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    connectExternalStorage(tenantId, { provider: 'dropbox' });
    const fileUrl = await uploadExternal(tenantId, token, 'r6');
    const { url } = (await request(app).get('/api/storage/signed-url').set(authHeader(token)).query({ url: fileUrl })).body;

    memoryDrive.temporaryLink = 'https://dl.dropboxusercontent.test/apitl/abc';
    const res = await request(app).get(url);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://dl.dropboxusercontent.test/apitl/abc');
  });

  it('refuse un jeton expiré', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const connectionId = connectExternalStorage(tenantId);
    const fileUrl = await uploadExternal(tenantId, token, 'r7');
    const ref = parseExternalRef(fileUrl)!;

    const expired = signExternalTicket({ t: tenantId, c: connectionId, e: ref.externalId }, -1);
    const res = await request(app).get(`/api/storage/external/${encodeURIComponent(expired)}`);
    expect(res.status).toBe(401);
  });

  it('refuse un jeton dont la signature a été altérée', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const connectionId = connectExternalStorage(tenantId);
    const fileUrl = await uploadExternal(tenantId, token, 'r8');
    const ref = parseExternalRef(fileUrl)!;

    const ticket = signExternalTicket({ t: tenantId, c: connectionId, e: ref.externalId });
    const [body] = ticket.split('.');
    // Une signature de bonne longueur mais fausse : c'est le cas que
    // timingSafeEqual doit trancher, pas le cas trivial d'un jeton tronqué.
    const forged = `${body}.${'A'.repeat(ticket.length - body.length - 1)}`;
    const res = await request(app).get(`/api/storage/external/${encodeURIComponent(forged)}`);
    expect(res.status).toBe(401);
  });

  it('refuse un jeton émis pour un autre cabinet', async () => {
    const tenantA = makeTenant();
    const { token: tokenA } = makeUser(tenantA);
    const connectionA = connectExternalStorage(tenantA);
    const fileUrl = await uploadExternal(tenantA, tokenA, 'r9');
    const ref = parseExternalRef(fileUrl)!;

    // Jeton parfaitement signé, mais qui désigne un cabinet auquel la connexion
    // n'appartient pas : la vérification de propriété doit quand même refuser.
    const tenantB = makeTenant();
    const ticket = signExternalTicket({ t: tenantB, c: connectionA, e: ref.externalId });
    const res = await request(app).get(`/api/storage/external/${encodeURIComponent(ticket)}`);
    expect(res.status).toBe(403);
  });

  it('refuse un jeton qui n’en est pas un', async () => {
    const res = await request(app).get('/api/storage/external/nimportequoi');
    expect(res.status).toBe(401);
  });

  it('refuse une connexion qui n’existe plus', async () => {
    const tenantId = makeTenant();
    makeUser(tenantId);
    const ticket = signExternalTicket({ t: tenantId, c: 'connexion-inexistante', e: 'file-1' });
    const res = await request(app).get(`/api/storage/external/${encodeURIComponent(ticket)}`);
    expect(res.status).toBe(403);
  });
});

describe('référence externe orpheline', () => {
  // Le cabinet a révoqué les accès : la connexion n'est plus lisible. On répond
  // proprement plutôt que de laisser une trace d'exception.
  it('refuse de résoudre une référence dont la connexion a disparu', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const orphan = buildExternalRef({ provider: 'webdav', connectionId: 'partie', externalId: 'file-1' });
    const res = await request(app).get('/api/storage/signed-url').set(authHeader(token)).query({ url: orphan });
    expect(res.status).toBe(403);
  });
});
