// L'adaptateur WebDAV — Nextcloud ET kDrive (Infomaniak) dans un seul fichier.
//
// Les deux offres parlent le même protocole ; elles ne diffèrent que par l'URL
// de base que le cabinet saisit, et cette différence est purement une aide à la
// saisie côté Réglages (`webdav_flavor`). Rien ici ne distingue les deux :
//
//   Nextcloud : https://<hôte>/remote.php/dav/files/<utilisateur>/
//   kDrive    : https://<identifiant kDrive>.connect.kdrive.infomaniak.com/
//
// Aucune dépendance npm ajoutée : `https.request` accepte les verbes PROPFIND et
// MKCOL, ce qui suffit pour les opérations dont l'interface a besoin. Une
// bibliothèque WebDAV apporterait surtout du parsing XML dont on n'a pas
// l'usage — on ne lit jamais qu'un code de statut, et la taille d'un fichier.
//
// Toutes les requêtes passent par `pinnedRequest` (../pinnedHttp.ts) : HTTPS
// obligatoire, connexion épinglée sur l'adresse publique validée par le garde SSRF,
// redirections limitées à la même origine.
//
// L'authentification se fait par MOT DE PASSE D'APPLICATION, jamais par le mot
// de passe du compte : chez Nextcloud comme chez Infomaniak, il est révocable
// individuellement et ne donne pas accès au reste du compte. Il est chiffré au
// repos par server/secretsCrypto.ts, comme les mots de passe IMAP. Il vaut mieux
// le créer pour un compte dédié, limité au dossier racine d'ArchiOffice.
import { decryptSecretMaybe } from '../../secretsCrypto';
import {
  ExternalFolderMissingError,
  ExternalStorageError,
  type ExternalReadStream,
  type ExternalStorageProvider,
  type ExternalUploadResult,
} from '../provider';
import { registerProviderFactory } from '../providerFactory';
import type { ExternalStorageConnection } from '../externalConnection';
import { pinnedRequest, readTextCapped, type PinnedResponse } from '../pinnedHttp';

// Un PUT de 50 Mo (le plafond de server/documentUpload.ts) sur une liaison
// ordinaire dépasse largement les 10 s par défaut, et Infomaniak limite le débit
// de façon agressive.
const UPLOAD_TIMEOUT_MS = 120_000;
const CALL_TIMEOUT_MS = 20_000;
// Une réponse de PROPFIND sur UN fichier tient en quelques centaines d'octets.
const PROPFIND_MAX_BYTES = 64 * 1024;

/** Normalise l'URL de base : toujours exactement une barre oblique finale. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '') + '/';
}

/**
 * Nextcloud : le cabinet colle souvent l'adresse qu'il ouvre dans son navigateur
 * (`https://cloud.exemple.fr/`, `.../index.php/apps/files/`), qui répond 405 à
 * PROPFIND. Le point d'accès WebDAV est `<racine>/remote.php/dav/files/<utilisateur>/` :
 * on le reconstruit quand l'URL saisie n'y mène pas déjà. Une URL qui contient
 * déjà `remote.php/dav` est laissée telle quelle, de même que celle d'un autre fournisseur.
 */
export function completeNextcloudUrl(flavor: string, baseUrl: string, username: string): string {
  const trimmed = String(baseUrl).trim();
  if (flavor !== 'nextcloud' || !username || /\/remote\.php\/(?:web)?dav/i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    // Installation dans un sous-dossier (`/nextcloud/`) : on garde le préfixe, on
    // retire seulement l'interface web (`/index.php/...`, `/apps/...`).
    const root = url.pathname.replace(/\/(?:index\.php|apps)(?:\/.*)?$/i, '').replace(/\/+$/, '');
    return `${url.origin}${root}/remote.php/dav/files/${encodeURIComponent(username.trim())}/`;
  } catch {
    return trimmed;
  }
}

/**
 * Assemble l'URL d'une ressource.
 *
 * L'encodage se fait SEGMENT PAR SEGMENT : encodeURIComponent sur le chemin
 * entier détruirait les barres obliques qui le structurent, et ne pas encoder du
 * tout casserait sur le premier nom d'affaire contenant un espace, une esperluette
 * ou un accent — c'est-à-dire tout de suite.
 */
export function buildWebdavUrl(baseUrl: string, relativePath: string, isCollection = false): string {
  const segments = relativePath.split('/').filter(Boolean).map(encodeURIComponent);
  // Plusieurs implémentations Nextcloud exigent la barre finale sur une
  // collection pour PROPFIND et MKCOL, et la refusent sur un fichier.
  return normalizeBaseUrl(baseUrl) + segments.join('/') + (isCollection && segments.length ? '/' : '');
}

/** `getcontentlength` d'une réponse PROPFIND (le préfixe d'espace de noms varie :
 *  `d:`, `D:`, aucun), ou null si le serveur ne la renseigne pas. */
export function parseContentLength(propfindXml: string): number | null {
  const m = propfindXml.match(/<(?:[\w.-]+:)?getcontentlength[^>]*>\s*(\d+)\s*</i);
  return m ? Number(m[1]) : null;
}

function authHeader(connection: ExternalStorageConnection): string {
  const user = connection.username || '';
  const password = decryptSecretMaybe(connection.password_encrypted);
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

/** Traduit un statut HTTP en erreur typée que la couche de politique sait lire. */
function statusError(status: number, action: string): ExternalStorageError {
  if (status === 401 || status === 403) {
    return new ExternalStorageError(
      `Accès refusé par le serveur (${action}). Le mot de passe d'application a peut-être été révoqué.`,
      'needs_reauth',
      502,
    );
  }
  if (status === 404 || status === 409) return new ExternalFolderMissingError();
  if (status === 507) {
    return new ExternalStorageError("L'espace de stockage du cabinet est plein.", 'quota_exceeded', 502);
  }
  if (status === 429 || status === 503) {
    return new ExternalStorageError('Le serveur de stockage est momentanément indisponible.', 'rate_limited', 502);
  }
  return new ExternalStorageError(`Le serveur de stockage a répondu ${status} (${action}).`, 'unknown', 502);
}

class WebdavProvider implements ExternalStorageProvider {
  readonly kind = 'webdav' as const;

  constructor(private readonly connection: ExternalStorageConnection) {}

  private async call(
    method: string,
    url: string,
    init: { headers?: Record<string, string>; body?: Buffer } = {},
    timeoutMs = CALL_TIMEOUT_MS,
  ): Promise<PinnedResponse> {
    try {
      // Le garde SSRF (HTTPS, adresse publique, adresse épinglée) est réappliqué à
      // CHAQUE appel et pas seulement à l'enregistrement : c'est une URL fournie
      // par le cabinet, et rien ne garantit qu'elle n'a pas changé en base ou en
      // DNS entre-temps.
      return await pinnedRequest(url, {
        method,
        headers: { Authorization: authHeader(this.connection), ...(init.headers || {}) },
        body: init.body,
        timeoutMs,
      });
    } catch (err: any) {
      if (err?.status) throw err; // garde SSRF ou redirection refusée, déjà typée
      if (err?.name === 'AbortError') {
        throw new ExternalStorageError('Serveur de stockage injoignable : délai dépassé', 'unreachable', 502);
      }
      // La vraie raison (ENOTFOUND, ECONNREFUSED, certificat...) est dans `code`
      // ou `cause`, le message seul est parfois générique.
      const cause = err?.code || err?.cause?.code || err?.cause?.message;
      throw new ExternalStorageError(
        `Serveur de stockage injoignable : ${err?.message || err}${cause ? ` (${cause})` : ''}`,
        'unreachable',
        502,
      );
    }
  }

  /** Pour les appels dont seul le statut compte : le corps est abandonné pour
   *  rendre la connexion au pool. */
  private async callStatus(
    method: string,
    url: string,
    init: { headers?: Record<string, string>; body?: Buffer } = {},
    timeoutMs = CALL_TIMEOUT_MS,
  ): Promise<number> {
    const res = await this.call(method, url, init, timeoutMs);
    res.stream.resume();
    return res.status;
  }

  private get base(): string {
    if (!this.connection.base_url) {
      throw new ExternalStorageError('URL WebDAV absente sur la connexion.', 'unknown', 500);
    }
    return this.connection.base_url;
  }

  /** Chez un fournisseur adressé par chemin, l'identifiant d'une ressource EST
   *  son chemin relatif à la racine du compte. */
  private url(relativePath: string, isCollection = false): string {
    return buildWebdavUrl(this.base, relativePath, isCollection);
  }

  private async exists(relativePath: string, isCollection: boolean): Promise<boolean> {
    const status = await this.callStatus('PROPFIND', this.url(relativePath, isCollection), {
      headers: { Depth: '0' },
    });
    if (status === 207 || status === 200) return true;
    if (status === 404) return false;
    throw statusError(status, 'vérification');
  }

  async resolveRoot(): Promise<string> {
    const root = this.connection.root_folder_path;
    if (!(await this.exists(root, true))) await this.mkcol(root);
    return root;
  }

  private async mkcol(relativePath: string): Promise<void> {
    const status = await this.callStatus('MKCOL', this.url(relativePath, true));
    // 405 = la collection existe déjà. C'est un succès, pas une erreur : on ne
    // crée un dossier que pour être sûr qu'il soit là.
    if (status === 201 || status === 405) return;
    throw statusError(status, 'création de dossier');
  }

  async findChildFolder(parentExternalId: string, name: string): Promise<string | null> {
    const path = `${parentExternalId}/${name}`;
    return (await this.exists(path, true)) ? path : null;
  }

  async createChildFolder(parentExternalId: string, name: string): Promise<string> {
    const path = `${parentExternalId}/${name}`;
    await this.mkcol(path);
    return path;
  }

  async uploadFile(
    parentExternalId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<ExternalUploadResult> {
    // WebDAV écrase sans prévenir un fichier de même nom. Un architecte qui
    // dépose deux pièces homonymes dans la même phase (deux indices d'un même
    // plan, par exemple) perdrait la première sans le savoir : on suffixe plutôt.
    const target = await this.freeName(parentExternalId, fileName);
    const status = await this.callStatus(
      'PUT',
      this.url(target),
      { body: buffer, headers: { 'Content-Type': mimeType || 'application/octet-stream' } },
      UPLOAD_TIMEOUT_MS,
    );
    if (status !== 201 && status !== 204 && status !== 200) {
      throw statusError(status, 'dépôt du fichier');
    }
    await this.verifyUploadedSize(target, buffer.length);
    return { externalId: target, sizeBytes: buffer.length, webUrl: null };
  }

  /**
   * Un PUT coupé en route peut répondre 201 et laisser un fichier tronqué : on
   * relit la taille déclarée par le serveur. Une divergence supprime le fichier et
   * fait échouer le dépôt (l'appelant n'écrit alors aucune ligne en base).
   *
   * Meilleur effort sur tout le reste : si le serveur ne renseigne pas la taille,
   * ou si la vérification elle-même échoue, le dépôt n'est pas bloqué.
   * `WEBDAV_VERIFY_UPLOAD=off` coupe le contrôle pour un serveur dont la taille
   * annoncée diffère de la taille déposée (chiffrement côté serveur, par exemple).
   */
  private async verifyUploadedSize(path: string, expected: number): Promise<void> {
    if (process.env.WEBDAV_VERIFY_UPLOAD === 'off') return;
    let size: number | null = null;
    try {
      const res = await this.call('PROPFIND', this.url(path), { headers: { Depth: '0' } });
      if (res.status !== 207) {
        res.stream.resume();
        return;
      }
      size = parseContentLength(await readTextCapped(res.stream, PROPFIND_MAX_BYTES));
    } catch {
      return;
    }
    if (size === null || size === expected) return;
    await this.deleteFile(path).catch(() => undefined);
    throw new ExternalStorageError(
      `Le fichier déposé est incomplet (${size} octets reçus sur ${expected}). Réessayez.`,
      'unknown',
      502,
    );
  }

  /** `cctp.pdf`, puis `cctp (2).pdf`, `cctp (3).pdf`… — déterministe, et jamais
   *  d'écrasement silencieux. */
  private async freeName(parentExternalId: string, fileName: string): Promise<string> {
    const dot = fileName.lastIndexOf('.');
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : '';
    for (let i = 1; i <= 50; i += 1) {
      const candidate = i === 1 ? fileName : `${stem} (${i})${ext}`;
      const path = `${parentExternalId}/${candidate}`;
      if (!(await this.exists(path, false))) return path;
    }
    // Au-delà, on cesse de sonder : l'horodatage tranche à coup sûr.
    return `${parentExternalId}/${stem} (${Date.now()})${ext}`;
  }

  async deleteFile(externalId: string): Promise<void> {
    const status = await this.callStatus('DELETE', this.url(externalId));
    // 404 : déjà supprimé côté drive. Rien à signaler.
    if (status === 204 || status === 200 || status === 404) return;
    throw statusError(status, 'suppression');
  }

  /** WebDAV n'a aucune notion de lien temporaire. Les partages publics de
   *  Nextcloud (API OCS) créeraient un partage PERSISTANT dans l'espace du
   *  cabinet, et kDrive n'expose pas la même chose : on streame plutôt. */
  async getTemporaryLink(): Promise<string | null> {
    return null;
  }

  async openReadStream(externalId: string, rangeHeader?: string): Promise<ExternalReadStream> {
    const res = await this.call('GET', this.url(externalId), {
      headers: rangeHeader ? { Range: rangeHeader } : {},
    });
    if (res.status !== 200 && res.status !== 206) {
      res.stream.resume();
      throw statusError(res.status, 'lecture');
    }

    const length = res.headers['content-length'];
    return {
      body: res.stream,
      contentType: res.headers['content-type'] || 'application/octet-stream',
      contentLength: length ? Number(length) : null,
      status: res.status === 206 ? 206 : 200,
      contentRange: res.headers['content-range'] ?? null,
    };
  }

  async probe(): Promise<void> {
    const status = await this.callStatus('PROPFIND', normalizeBaseUrl(this.base), {
      headers: { Depth: '0' },
    });
    if (status === 405) {
      throw new ExternalStorageError(
        "Le serveur de stockage a répondu 405 (test de connexion). L'adresse saisie n'est pas un point d'accès WebDAV. " +
          'Nextcloud : https://<hôte>/remote.php/dav/files/<identifiant>/ ; kDrive : https://<identifiant>.connect.kdrive.infomaniak.com/.',
        'unknown',
        502,
      );
    }
    if (status !== 207 && status !== 200) throw statusError(status, 'test de connexion');
  }
}

export function registerWebdavProvider(): void {
  registerProviderFactory('webdav', (connection) => new WebdavProvider(connection));
}
