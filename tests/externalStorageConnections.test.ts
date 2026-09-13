// Les routes de connexion de l'espace de stockage du cabinet
// (server/routes/externalStorage.ts).
//
// Le fournisseur en mémoire (registerMemoryProvider, appelé par testServer)
// répond à la sonde : aucun serveur WebDAV n'est joignable depuis la suite.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader,
} from './testServer';
import { memoryDrive } from '../server/externalStorage/memoryProvider';
import { invalidateConnectionCache } from '../server/externalStorage/externalConnection';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

beforeEach(() => {
  memoryDrive.reset();
});

// Adresses de documentation (RFC 5737, TEST-NET-3) : le garde SSRF
// court-circuite la résolution DNS sur une IP littérale, donc ces tests ne
// dépendent d'aucun réseau — et ces plages ne figurent pas parmi celles qu'il
// bloque, elles passent donc bien pour publiques, ce qu'on veut vérifier ici.
const NEXTCLOUD = {
  flavor: 'nextcloud',
  baseUrl: 'https://203.0.113.10/remote.php/dav/files/khaldoun/',
  username: 'khaldoun',
  password: 'mot-de-passe-application',
};

describe('POST /api/external-storage/webdav', () => {
  it('branche un espace Nextcloud et le rend visible dans l’état', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');

    const res = await request(app).post('/api/external-storage/webdav')
      .set(authHeader(token)).send({ ...NEXTCLOUD, rootFolderPath: 'ArchiOffice' });
    expect(res.status).toBe(201);
    expect(res.body.connected).toBe(true);
    expect(res.body.provider).toBe('webdav');
    expect(res.body.webdavFlavor).toBe('nextcloud');

    const status = await request(app).get('/api/external-storage/status').set(authHeader(token));
    expect(status.body.connected).toBe(true);
    expect(status.body.rootFolderPath).toBe('ArchiOffice');
  });

  // Même patron que SECRET_COLS dans server/routes/settings.ts : un secret ne
  // ressort jamais, quelle que soit la route.
  it('ne réémet jamais le mot de passe, ni au retour ni dans l’état', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const res = await request(app).post('/api/external-storage/webdav').set(authHeader(token)).send(NEXTCLOUD);
    const status = await request(app).get('/api/external-storage/status').set(authHeader(token));

    expect(JSON.stringify(res.body)).not.toContain(NEXTCLOUD.password);
    expect(JSON.stringify(status.body)).not.toContain(NEXTCLOUD.password);
    expect(status.body.credentialsPresent).toBe(true);
  });

  it('chiffre le mot de passe au repos', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    await request(app).post('/api/external-storage/webdav').set(authHeader(token)).send(NEXTCLOUD);

    const row = fakeSupabaseAdmin.getTable('external_storage_connections').find((c) => c.tenant_id === tenantId);
    expect(row?.password_encrypted).toBeTruthy();
    expect(row?.password_encrypted).not.toBe(NEXTCLOUD.password);
  });

  // L'URL est saisie par le cabinet : elle ne doit jamais pouvoir viser un
  // service interne (server/ssrfGuard.ts).
  it('refuse une URL qui pointe sur le réseau interne', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    for (const baseUrl of ['http://127.0.0.1/dav/', 'http://169.254.169.254/latest/meta-data/']) {
      const res = await request(app).post('/api/external-storage/webdav')
        .set(authHeader(token)).send({ ...NEXTCLOUD, baseUrl });
      expect(res.status).toBe(403);
    }
    expect(fakeSupabaseAdmin.getTable('external_storage_connections').filter((c) => c.tenant_id === tenantId)).toHaveLength(0);
  });

  it('refuse un schéma qui n’est ni http ni https', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const res = await request(app).post('/api/external-storage/webdav')
      .set(authHeader(token)).send({ ...NEXTCLOUD, baseUrl: 'file:///etc/passwd' });
    expect(res.status).toBe(400);
  });

  it('exige un identifiant et un mot de passe', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const res = await request(app).post('/api/external-storage/webdav')
      .set(authHeader(token)).send({ flavor: 'nextcloud', baseUrl: NEXTCLOUD.baseUrl });
    expect(res.status).toBe(400);
  });

  it('refuse un fournisseur inconnu', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const res = await request(app).post('/api/external-storage/webdav')
      .set(authHeader(token)).send({ ...NEXTCLOUD, flavor: 'owncloud' });
    expect(res.status).toBe(400);
  });

  it('est réservé aux administrateurs du cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'pm');
    const res = await request(app).post('/api/external-storage/webdav').set(authHeader(token)).send(NEXTCLOUD);
    expect(res.status).toBe(403);
  });

  it('assainit la racine saisie, qui devient un nom de dossier réel', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const res = await request(app).post('/api/external-storage/webdav')
      .set(authHeader(token)).send({ ...NEXTCLOUD, rootFolderPath: 'Agence / AAZS' });
    expect(res.body.rootFolderPath).toBe('Agence AAZS');
  });

  // Index unique partiel `WHERE is_active = true` : un seul espace actif, mais
  // l'ancien reste en base, sans quoi ses fichiers deviendraient irrésolubles.
  it('désactive l’espace précédent au lieu de le supprimer', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    await request(app).post('/api/external-storage/webdav').set(authHeader(token)).send(NEXTCLOUD);
    await request(app).post('/api/external-storage/webdav').set(authHeader(token))
      .send({ ...NEXTCLOUD, flavor: 'kdrive', baseUrl: 'https://203.0.113.20/123456/' });

    const rows = fakeSupabaseAdmin.getTable('external_storage_connections').filter((c) => c.tenant_id === tenantId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((c) => c.is_active)).toHaveLength(1);
    expect(rows.find((c) => c.is_active)?.webdav_flavor).toBe('kdrive');
  });

  it('ne voit pas l’espace d’un autre cabinet', async () => {
    const tenantA = makeTenant();
    const { token: tokenA } = makeUser(tenantA, 'admin');
    await request(app).post('/api/external-storage/webdav').set(authHeader(tokenA)).send(NEXTCLOUD);

    const tenantB = makeTenant();
    const { token: tokenB } = makeUser(tenantB, 'admin');
    const res = await request(app).get('/api/external-storage/status').set(authHeader(tokenB));
    expect(res.body.connected).toBe(false);
  });
});

describe('déconnexion et révocation', () => {
  async function connect(token: string) {
    const res = await request(app).post('/api/external-storage/webdav').set(authHeader(token)).send(NEXTCLOUD);
    return res.body.id as string;
  }

  // Les deux gestes sont distincts à dessein : déconnecter arrête les
  // écritures, révoquer coupe aussi la lecture.
  it('déconnecter arrête les nouvelles écritures mais conserve les identifiants', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const id = await connect(token);

    const res = await request(app).post(`/api/external-storage/${id}/disable`).set(authHeader(token));
    expect(res.status).toBe(200);

    const row = fakeSupabaseAdmin.getTable('external_storage_connections').find((c) => c.id === id);
    expect(row?.is_active).toBe(false);
    expect(row?.password_encrypted).toBeTruthy();

    const status = await request(app).get('/api/external-storage/status').set(authHeader(token));
    expect(status.body.connected).toBe(false);
  });

  it('un dépôt repart dans Supabase une fois l’espace déconnecté', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    fakeSupabaseAdmin.seed('projects', [{ id: 'd1', tenant_id: tenantId, project_code: '26014', name: 'Villa Martin' }]);
    const id = await connect(token);
    await request(app).post(`/api/external-storage/${id}/disable`).set(authHeader(token));

    const res = await request(app).post('/api/documents').set(authHeader(token))
      .field('project_id', 'd1').field('name', 'Après').field('category', 'CCTP')
      .attach('file', Buffer.from('%PDF-fake'), 'apres.pdf');
    const doc = fakeSupabaseAdmin.getTable('documents').find((d) => d.id === res.body.id);
    expect(doc?.storage_backend).toBe('supabase');
    expect(memoryDrive.uploadCalls).toBe(0);
  });

  // La ligne survit : c'est elle qui rend encore résoluble une référence
  // archioffice+external:// déjà écrite.
  it('révoquer efface les identifiants mais garde la ligne', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const id = await connect(token);

    const res = await request(app).delete(`/api/external-storage/${id}`).set(authHeader(token));
    expect(res.status).toBe(200);

    const row = fakeSupabaseAdmin.getTable('external_storage_connections').find((c) => c.id === id);
    expect(row).toBeTruthy();
    expect(row?.password_encrypted).toBeNull();
    expect(row?.status).toBe('needs_reauth');
  });

  it('déconnecter et révoquer sont réservés aux administrateurs', async () => {
    const tenantId = makeTenant();
    const { token: adminToken } = makeUser(tenantId, 'admin');
    const { token: userToken } = makeUser(tenantId, 'user');
    const id = await connect(adminToken);

    expect((await request(app).post(`/api/external-storage/${id}/disable`).set(authHeader(userToken))).status).toBe(403);
    expect((await request(app).delete(`/api/external-storage/${id}`).set(authHeader(userToken))).status).toBe(403);
  });
});

describe('POST /api/external-storage/test', () => {
  it('remet la connexion au vert après une sonde réussie', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    await request(app).post('/api/external-storage/webdav').set(authHeader(token)).send(NEXTCLOUD);

    const row = fakeSupabaseAdmin.getTable('external_storage_connections').find((c) => c.tenant_id === tenantId);
    row!.status = 'error';
    row!.last_error = 'panne précédente';
    invalidateConnectionCache(tenantId);

    const res = await request(app).post('/api/external-storage/test').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('external_storage_connections').find((c) => c.id === row!.id)?.status).toBe('ok');
  });

  it('répond 404 quand aucun espace n’est branché', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const res = await request(app).post('/api/external-storage/test').set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('flux OAuth (Google Drive)', () => {
  it('rend l’URL de consentement en JSON, pour que le frontend navigue lui-même', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    process.env.VITE_GOOGLE_CLIENT_ID ||= 'client-de-test.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET ||= 'secret-de-test';

    const res = await request(app).get('/api/external-storage/google_drive/auth')
      .set(authHeader(token)).query({ rootFolderPath: 'Agence AAZS' });
    expect(res.status).toBe(200);

    const url = new URL(res.body.url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    // Sans les deux, Google ne délivre pas de refresh token à une application
    // déjà autorisée, et la connexion mourrait au bout d'une heure.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    // Le scope étroit, pas le scope restreint qui impose un audit annuel.
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/drive.file');
    expect(url.searchParams.get('scope')).not.toContain('auth/drive ');
    // Nonce à usage unique : sans lui, quiconque connaît l'identifiant d'un
    // cabinet pourrait rattacher SON espace à celui d'un autre.
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('est réservé aux administrateurs du cabinet', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'manager');
    const res = await request(app).get('/api/external-storage/google_drive/auth').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('refuse un fournisseur qui n’a pas de flux OAuth', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId, 'admin');
    const res = await request(app).get('/api/external-storage/webdav/auth').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  // Le callback est atteint par une navigation nue, sans JWT : il doit traverser
  // l'authentification globale (AUTH_EXEMPT) et non répondre 401.
  it('le callback n’exige pas de JWT et redirige vers les Réglages', async () => {
    const res = await request(app).get('/api/external-storage/callback').query({ error: 'access_denied' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?external_storage_error=access_denied');
  });

  it('refuse un état inconnu plutôt que de rattacher un espace à l’aveugle', async () => {
    const res = await request(app).get('/api/external-storage/callback')
      .query({ code: 'un-code', state: 'un-nonce-jamais-emis' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('external_storage_error=');
    expect(res.headers.location).not.toContain('connected=1');
  });

  // /callback-url partage le préfixe de /callback : il ne doit PAS hériter de
  // son exemption d'authentification.
  it('l’URL de redirection à recopier reste, elle, authentifiée', async () => {
    const res = await request(app).get('/api/external-storage/callback-url');
    expect(res.status).toBe(401);
  });
});
