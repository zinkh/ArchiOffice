// L'adaptateur WebDAV — Nextcloud ET kDrive (Infomaniak) dans un seul fichier.
//
// Les deux offres parlent le même protocole ; elles ne diffèrent que par l'URL
// de base que le cabinet saisit, et cette différence est purement une aide à la
// saisie côté Réglages (`webdav_flavor`). Rien ici ne distingue les deux :
//
//   Nextcloud : https://<hôte>/remote.php/dav/files/<utilisateur>/
//   kDrive    : https://connect.drive.infomaniak.com/<identifiant kDrive>/
//
// Aucune dépendance npm ajoutée : `fetch` accepte les verbes PROPFIND et MKCOL,
// ce qui suffit pour les cinq opérations dont l'interface a besoin. Une
// bibliothèque WebDAV apporterait surtout du parsing XML dont on n'a pas
// l'usage — on ne lit jamais qu'un code de statut.
//
// L'authentification se fait par MOT DE PASSE D'APPLICATION, jamais par le mot
// de passe du compte : chez Nextcloud comme chez Infomaniak, il est révocable
// individuellement et ne donne pas accès au reste du compte. Il est chiffré au
// repos par server/secretsCrypto.ts, comme les mots de passe IMAP.
import { Readable } from 'stream';
import { assertPublicHttpUrl } from '../../ssrfGuard';
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

// Un PUT de 50 Mo (le plafond de server/documentUpload.ts) sur une liaison
// ordinaire dépasse largement les 10 s par défaut de fetchWithTimeout, et
// Infomaniak limite le débit de façon agressive.
const UPLOAD_TIMEOUT_MS = 120_000;
const CALL_TIMEOUT_MS = 20_000;

/** Normalise l'URL de base : toujours exactement une barre oblique finale. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '') + '/';
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
    init: RequestInit = {},
    timeoutMs = CALL_TIMEOUT_MS,
  ): Promise<Response> {
    // Le garde SSRF est réappliqué à CHAQUE appel et pas seulement à
    // l'enregistrement : c'est une URL fournie par le cabinet, et rien ne
    // garantit qu'elle n'a pas changé en base entre-temps.
    await assertPublicHttpUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        method,
        headers: { Authorization: authHeader(this.connection), ...(init.headers || {}) },
        signal: controller.signal,
        redirect: 'follow',
      });
    } catch (err: any) {
      if (err?.status) throw err; // erreur du garde SSRF, déjà typée
      throw new ExternalStorageError(
        `Serveur de stockage injoignable : ${err?.message || err}`,
        'unreachable',
        502,
      );
    } finally {
      clearTimeout(timer);
    }
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
    const res = await this.call('PROPFIND', this.url(relativePath, isCollection), {
      headers: { Depth: '0' },
    });
    if (res.status === 207 || res.status === 200) return true;
    if (res.status === 404) return false;
    throw statusError(res.status, 'vérification');
  }

  async resolveRoot(): Promise<string> {
    const root = this.connection.root_folder_path;
    if (!(await this.exists(root, true))) await this.mkcol(root);
    return root;
  }

  private async mkcol(relativePath: string): Promise<void> {
    const res = await this.call('MKCOL', this.url(relativePath, true));
    // 405 = la collection existe déjà. C'est un succès, pas une erreur : on ne
    // crée un dossier que pour être sûr qu'il soit là.
    if (res.status === 201 || res.status === 405) return;
    throw statusError(res.status, 'création de dossier');
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
    const res = await this.call(
      'PUT',
      this.url(target),
      { body: buffer as any, headers: { 'Content-Type': mimeType || 'application/octet-stream' } },
      UPLOAD_TIMEOUT_MS,
    );
    if (res.status !== 201 && res.status !== 204 && res.status !== 200) {
      throw statusError(res.status, 'dépôt du fichier');
    }
    return { externalId: target, sizeBytes: buffer.length, webUrl: null };
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
    const res = await this.call('DELETE', this.url(externalId));
    // 404 : déjà supprimé côté drive. Rien à signaler.
    if (res.status === 204 || res.status === 200 || res.status === 404) return;
    throw statusError(res.status, 'suppression');
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
    if (res.status !== 200 && res.status !== 206) throw statusError(res.status, 'lecture');
    if (!res.body) throw new ExternalStorageError('Réponse vide du serveur de stockage.', 'unknown', 502);

    const length = res.headers.get('content-length');
    return {
      body: Readable.fromWeb(res.body as any),
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      contentLength: length ? Number(length) : null,
      status: res.status === 206 ? 206 : 200,
      contentRange: res.headers.get('content-range'),
    };
  }

  async probe(): Promise<void> {
    const res = await this.call('PROPFIND', normalizeBaseUrl(this.base), { headers: { Depth: '0' } });
    if (res.status !== 207 && res.status !== 200) throw statusError(res.status, 'test de connexion');
  }
}

export function registerWebdavProvider(): void {
  registerProviderFactory('webdav', (connection) => new WebdavProvider(connection));
}
