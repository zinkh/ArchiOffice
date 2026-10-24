// Durcissement de l'adaptateur WebDAV : garde SSRF (HTTPS, adresses IPv6
// encapsulées), redirections limitées à l'origine, contrôle de taille après dépôt.
//
// `pinnedRequest` est remplacé : aucun serveur WebDAV n'est joignable depuis la
// suite. Ce qui est vérifié ici, c'est ce que l'adaptateur en fait (séquence des
// appels, erreurs typées) et les parties pures du module.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'stream';

vi.mock('../server/externalStorage/pinnedHttp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/externalStorage/pinnedHttp')>();
  return { ...actual, pinnedRequest: vi.fn() };
});

import { resolvePublicUrl } from '../server/ssrfGuard';
import { pinnedRequest, resolveRedirect } from '../server/externalStorage/pinnedHttp';
import { parseContentLength, registerWebdavProvider } from '../server/externalStorage/providers/webdav';
import { createProvider } from '../server/externalStorage/providerFactory';
import { ExternalStorageError } from '../server/externalStorage/provider';

describe('resolvePublicUrl', () => {
  it('refuse http quand HTTPS est exigé, même vers une adresse publique', async () => {
    await expect(resolvePublicUrl('http://203.0.113.10/dav/', { requireHttps: true }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('accepte http quand HTTPS n’est pas exigé (autres intégrations)', async () => {
    const { url } = await resolvePublicUrl('http://203.0.113.10/dav/');
    expect(url.protocol).toBe('http:');
  });

  it('rend les adresses validées, à épingler sur la connexion', async () => {
    const { addresses } = await resolvePublicUrl('https://203.0.113.10/dav/', { requireHttps: true });
    expect(addresses).toEqual(['203.0.113.10']);
  });

  it('bloque les adresses IPv4 encapsulées en IPv6, sous leurs deux écritures', async () => {
    for (const host of [
      '[::ffff:127.0.0.1]',      // le parseur d'URL la normalise en ::ffff:7f00:1
      '[::ffff:7f00:1]',
      '[::ffff:169.254.169.254]', // métadonnées cloud
      '[::ffff:a00:1]',           // 10.0.0.1
    ]) {
      await expect(resolvePublicUrl(`https://${host}/dav/`, { requireHttps: true }))
        .rejects.toMatchObject({ status: 403 });
    }
  });

  it('laisse passer une adresse IPv4 publique encapsulée', async () => {
    const { addresses } = await resolvePublicUrl('https://[::ffff:cb00:710]/dav/', { requireHttps: true });
    expect(addresses).toHaveLength(1);
  });
});

describe('resolveRedirect', () => {
  const current = new URL('https://cloud.aazs.test/remote.php/dav/files/khaldoun/ArchiOffice/');

  it('suit une redirection de même origine, relative ou absolue', () => {
    expect(resolveRedirect(current, '/remote.php/dav/files/khaldoun/Archi/').href)
      .toBe('https://cloud.aazs.test/remote.php/dav/files/khaldoun/Archi/');
    expect(resolveRedirect(current, 'https://cloud.aazs.test/autre/').pathname).toBe('/autre/');
  });

  it('refuse un autre hôte (l’en-tête Authorization n’y suivrait pas)', () => {
    expect(() => resolveRedirect(current, 'https://evil.test/dav/')).toThrow(ExternalStorageError);
  });

  it('refuse un retour en http', () => {
    expect(() => resolveRedirect(current, 'http://cloud.aazs.test/dav/')).toThrow(ExternalStorageError);
  });

  it('refuse un autre port', () => {
    expect(() => resolveRedirect(current, 'https://cloud.aazs.test:8443/dav/')).toThrow(ExternalStorageError);
  });
});

describe('parseContentLength', () => {
  it('lit la taille quel que soit le préfixe d’espace de noms', () => {
    expect(parseContentLength('<d:getcontentlength>1234</d:getcontentlength>')).toBe(1234);
    expect(parseContentLength('<D:getcontentlength>5</D:getcontentlength>')).toBe(5);
    expect(parseContentLength('<getcontentlength xmlns="DAV:"> 77 </getcontentlength>')).toBe(77);
  });

  it('rend null quand le serveur ne renseigne pas la taille', () => {
    expect(parseContentLength('<d:multistatus><d:response/></d:multistatus>')).toBeNull();
    expect(parseContentLength('')).toBeNull();
  });
});

describe('WebdavProvider.uploadFile : contrôle de taille', () => {
  const FILE = 'https://cloud.test/dav/ArchiOffice/affaire/plan.pdf';
  const PAYLOAD = Buffer.from('hello'); // 5 octets

  const multistatus = (size?: number) =>
    '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop>'
    + (size === undefined ? '' : `<d:getcontentlength>${size}</d:getcontentlength>`)
    + '</d:prop></d:propstat></d:response></d:multistatus>';

  const calls: Array<{ method: string; url: string; headers: Record<string, string> }> = [];

  /** Simule le serveur : le fichier n'existe pas avant le PUT, puis annonce `size`. */
  function serverReporting(size: number | undefined) {
    let uploaded = false;
    vi.mocked(pinnedRequest).mockImplementation(async (url, init) => {
      calls.push({ method: init.method, url, headers: init.headers || {} });
      let res: { status: number; body?: string };
      if (init.method === 'PROPFIND' && url === FILE) {
        res = uploaded ? { status: 207, body: multistatus(size) } : { status: 404 };
      } else if (init.method === 'PUT') {
        uploaded = true;
        res = { status: 201 };
      } else if (init.method === 'DELETE') {
        res = { status: 204 };
      } else {
        res = { status: 207, body: multistatus() };
      }
      return {
        status: res.status,
        headers: {},
        stream: Readable.from(res.body ? [Buffer.from(res.body)] : []),
      } as any;
    });
  }

  function provider() {
    registerWebdavProvider();
    return createProvider({
      id: 'conn-1', tenant_id: 't1', provider: 'webdav',
      base_url: 'https://cloud.test/dav/', username: 'khaldoun', password_encrypted: 'mdp-app',
      root_folder_path: 'ArchiOffice', is_active: true, status: 'ok',
    });
  }

  beforeEach(() => {
    calls.length = 0;
    vi.mocked(pinnedRequest).mockReset();
  });
  afterEach(() => {
    delete process.env.WEBDAV_VERIFY_UPLOAD;
  });

  it('dépose le fichier quand la taille annoncée correspond', async () => {
    serverReporting(PAYLOAD.length);
    const res = await provider().uploadFile('ArchiOffice/affaire', 'plan.pdf', PAYLOAD, 'application/pdf');
    expect(res.externalId).toBe('ArchiOffice/affaire/plan.pdf');
    expect(res.sizeBytes).toBe(5);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('supprime le fichier et échoue quand le serveur en annonce un tronqué', async () => {
    serverReporting(2);
    await expect(provider().uploadFile('ArchiOffice/affaire', 'plan.pdf', PAYLOAD, 'application/pdf'))
      .rejects.toThrow(/incomplet/);
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([FILE]);
  });

  it('ne bloque pas le dépôt quand le serveur ne renseigne pas la taille', async () => {
    serverReporting(undefined);
    await expect(provider().uploadFile('ArchiOffice/affaire', 'plan.pdf', PAYLOAD, 'application/pdf'))
      .resolves.toMatchObject({ externalId: 'ArchiOffice/affaire/plan.pdf' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('saute le contrôle avec WEBDAV_VERIFY_UPLOAD=off', async () => {
    process.env.WEBDAV_VERIFY_UPLOAD = 'off';
    serverReporting(2); // tronqué, mais personne ne regarde
    await expect(provider().uploadFile('ArchiOffice/affaire', 'plan.pdf', PAYLOAD, 'application/pdf'))
      .resolves.toBeTruthy();
    const propfindsOnFile = calls.filter((c) => c.method === 'PROPFIND' && c.url === FILE);
    expect(propfindsOnFile).toHaveLength(1); // seulement le test d'existence d'avant dépôt
  });

  it('envoie le mot de passe d’application en Basic Auth sur chaque appel', async () => {
    serverReporting(PAYLOAD.length);
    await provider().uploadFile('ArchiOffice/affaire', 'plan.pdf', PAYLOAD, 'application/pdf');
    const expected = `Basic ${Buffer.from('khaldoun:mdp-app').toString('base64')}`;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.headers.Authorization === expected)).toBe(true);
  });

  it('traduit une erreur réseau en erreur « injoignable », avec la cause', async () => {
    vi.mocked(pinnedRequest).mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    await expect(provider().probe()).rejects.toMatchObject({
      code: 'unreachable',
      message: expect.stringContaining('ECONNRESET'),
    });
  });

  it('laisse passer telle quelle une erreur du garde SSRF (statut déjà typé)', async () => {
    vi.mocked(pinnedRequest).mockRejectedValue(Object.assign(new Error('Cette adresse n’est pas autorisée'), { status: 403 }));
    await expect(provider().probe()).rejects.toMatchObject({ status: 403 });
  });
});
