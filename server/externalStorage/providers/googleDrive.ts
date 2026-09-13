// L'adaptateur Google Drive.
//
// Scope `drive.file` et non `drive`, délibérément : `drive` est un *restricted
// scope* chez Google, qui impose une évaluation de sécurité CASA et un audit
// annuel à toute application publiée. `drive.file` n'est pas restreint et donne
// exactement ce dont on a besoin — créer des dossiers et des fichiers, et gérer
// ceux qu'on a créés.
//
// La contrepartie est à connaître : l'application ne VOIT pas les fichiers
// qu'elle n'a pas créés. Le dossier racine est donc créé par ArchiOffice, et son
// identifiant mémorisé sur la connexion ; on ne peut pas pointer un dossier
// existant que le cabinet aurait choisi à la main. C'est précisément ce que le
// cache de dossiers (external_storage_folders) rend exploitable : sans lui, il
// faudrait retrouver la racine à chaque dépôt, ce que ce scope interdit.
import { Readable } from 'stream';
import {
  ExternalFolderMissingError,
  ExternalStorageError,
  type ExternalReadStream,
  type ExternalStorageProvider,
  type ExternalUploadResult,
} from '../provider';
import { registerProviderFactory } from '../providerFactory';
import { getStorageAccessToken } from '../oauthTokens';
import type { ExternalStorageConnection } from '../externalConnection';

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const UPLOAD_TIMEOUT_MS = 120_000;
const CALL_TIMEOUT_MS = 20_000;
// Au-delà, Google recommande l'upload reprenable. Le plafond applicatif étant
// de 50 Mo (server/documentUpload.ts), les deux chemins sont exercés.
const MULTIPART_MAX_BYTES = 5 * 1024 * 1024;

/** Échappe une valeur destinée à une requête `q` de l'API Drive. Sans ça, une
 *  affaire nommée « L'Atelier » casse la requête — et c'est un nom d'agence
 *  parfaitement courant. */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Les paramètres à poser sur CHAQUE appel, sous peine de 404 dès qu'un cabinet
 *  travaille sur un Drive partagé plutôt que sur son Drive personnel. */
export const SHARED_DRIVE_PARAMS = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' };

function statusError(status: number, detail: string, action: string): ExternalStorageError {
  if (status === 401 || status === 403) {
    // 403 recouvre chez Google deux choses très différentes : l'accès refusé et
    // le disque plein. Les confondre enverrait l'architecte se reconnecter pour
    // rien.
    if (/quota/i.test(detail)) {
      return new ExternalStorageError('Votre Google Drive est plein.', 'quota_exceeded', 502);
    }
    return new ExternalStorageError(
      `Accès refusé par Google Drive (${action}). Reconnectez cet espace de stockage.`,
      'needs_reauth',
      502,
    );
  }
  if (status === 404) return new ExternalFolderMissingError();
  if (status === 429 || status >= 500) {
    return new ExternalStorageError('Google Drive est momentanément indisponible.', 'rate_limited', 502);
  }
  return new ExternalStorageError(`Google Drive a répondu ${status} (${action}). ${detail}`.trim(), 'unknown', 502);
}

class GoogleDriveProvider implements ExternalStorageProvider {
  readonly kind = 'google_drive' as const;

  constructor(
    private readonly connection: ExternalStorageConnection,
    private readonly supabaseAdmin: any,
  ) {}

  private token(): Promise<string> {
    return getStorageAccessToken(this.connection, {
      tokenUrl: GOOGLE_TOKEN_URL,
      clientId: process.env.VITE_GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      label: 'Google Drive',
      supabaseAdmin: this.supabaseAdmin,
    });
  }

  private async call(
    url: string,
    init: RequestInit = {},
    timeoutMs = CALL_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${await this.token()}`, ...(init.headers || {}) },
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err instanceof ExternalStorageError) throw err;
      throw new ExternalStorageError(`Google Drive injoignable : ${err?.message || err}`, 'unreachable', 502);
    } finally {
      clearTimeout(timer);
    }
  }

  private async fail(res: Response, action: string): Promise<never> {
    const detail = await res.text().catch(() => '');
    throw statusError(res.status, detail, action);
  }

  async resolveRoot(): Promise<string> {
    if (this.connection.root_folder_external_id) return this.connection.root_folder_external_id;
    // Avec le scope drive.file, une recherche ne voit que ce que l'application a
    // elle-même créé : elle retrouve donc bien une racine posée lors d'une
    // connexion précédente, et rien d'autre.
    const existing = await this.findFolder('root', this.connection.root_folder_path);
    const id = existing ?? (await this.createFolder('root', this.connection.root_folder_path));
    // Mémorisé sur la connexion : c'est ce qui évite de la rechercher à chaque
    // dépôt, et ce qui garde le même dossier d'une session à l'autre.
    this.supabaseAdmin?.from('external_storage_connections')
      .update({ root_folder_external_id: id }).eq('id', this.connection.id)
      .then(() => {}, () => { /* meilleur effort : le cache de dossiers reprend le relais */ });
    this.connection.root_folder_external_id = id;
    return id;
  }

  private async findFolder(parentId: string, name: string): Promise<string | null> {
    const q = [
      `name = '${escapeDriveQueryValue(name)}'`,
      `'${escapeDriveQueryValue(parentId)}' in parents`,
      `mimeType = '${FOLDER_MIME}'`,
      'trashed = false',
    ].join(' and ');
    const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', ...SHARED_DRIVE_PARAMS });
    const res = await this.call(`https://www.googleapis.com/drive/v3/files?${params}`);
    if (!res.ok) await this.fail(res, 'recherche de dossier');
    const data: any = await res.json();
    // Drive autorise les homonymes : on prend le premier et on le mémorise, pour
    // que tous les dépôts suivants aillent au même endroit.
    return data?.files?.[0]?.id ?? null;
  }

  private async createFolder(parentId: string, name: string): Promise<string> {
    const params = new URLSearchParams({ fields: 'id', ...SHARED_DRIVE_PARAMS });
    const res = await this.call(`https://www.googleapis.com/drive/v3/files?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!res.ok) await this.fail(res, 'création de dossier');
    return (await res.json()).id;
  }

  async findChildFolder(parentExternalId: string, name: string): Promise<string | null> {
    return this.findFolder(parentExternalId, name);
  }

  async createChildFolder(parentExternalId: string, name: string): Promise<string> {
    return this.createFolder(parentExternalId, name);
  }

  async uploadFile(
    parentExternalId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<ExternalUploadResult> {
    const metadata = { name: fileName, parents: [parentExternalId] };
    const id = buffer.length <= MULTIPART_MAX_BYTES
      ? await this.uploadMultipart(metadata, buffer, mimeType)
      : await this.uploadResumable(metadata, buffer, mimeType);
    return {
      externalId: id,
      sizeBytes: buffer.length,
      webUrl: `https://drive.google.com/file/d/${id}/view`,
    };
  }

  private async uploadMultipart(metadata: any, buffer: Buffer, mimeType: string): Promise<string> {
    const boundary = `archioffice-${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`, 'utf8'),
      Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`, 'utf8'),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);
    const params = new URLSearchParams({ uploadType: 'multipart', fields: 'id', ...SHARED_DRIVE_PARAMS });
    const res = await this.call(
      `https://www.googleapis.com/upload/drive/v3/files?${params}`,
      { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: body as any },
      UPLOAD_TIMEOUT_MS,
    );
    if (!res.ok) await this.fail(res, 'dépôt du fichier');
    return (await res.json()).id;
  }

  /** Au-delà de quelques Mo, Google veut une session d'upload. Le plafond
   *  applicatif étant de 50 Mo, un seul PUT du tampon entier suffit : pas de
   *  découpage en morceaux à gérer. */
  private async uploadResumable(metadata: any, buffer: Buffer, mimeType: string): Promise<string> {
    const params = new URLSearchParams({ uploadType: 'resumable', fields: 'id', ...SHARED_DRIVE_PARAMS });
    const start = await this.call(
      `https://www.googleapis.com/upload/drive/v3/files?${params}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType || 'application/octet-stream',
          'X-Upload-Content-Length': String(buffer.length),
        },
        body: JSON.stringify(metadata),
      },
    );
    if (!start.ok) await this.fail(start, "ouverture de la session d'envoi");
    const location = start.headers.get('location');
    if (!location) {
      throw new ExternalStorageError("Google Drive n'a pas ouvert de session d'envoi.", 'unknown', 502);
    }
    // Pas de jeton sur cette requête : l'URL de session porte elle-même
    // l'autorisation, et Google rejette un Authorization redondant.
    const put = await fetch(location, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType || 'application/octet-stream' },
      body: buffer as any,
    });
    if (!put.ok) await this.fail(put, 'dépôt du fichier');
    return (await put.json()).id;
  }

  /** Mise à la corbeille, pas destruction : une suppression malheureuse dans
   *  ArchiOffice ne doit pas détruire l'unique exemplaire du cabinet. */
  async deleteFile(externalId: string): Promise<void> {
    const params = new URLSearchParams({ ...SHARED_DRIVE_PARAMS });
    const res = await this.call(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(externalId)}?${params}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) },
    );
    if (res.status === 404) return; // déjà supprimé côté drive
    if (!res.ok) await this.fail(res, 'suppression');
  }

  /** Drive ne sait produire un lien lisible sans authentification qu'au prix
   *  d'une permission « toute personne disposant du lien » posée sur le fichier
   *  — un élargissement du partage dans l'espace du cabinet qu'on se refuse à
   *  faire en son nom. On streame donc. */
  async getTemporaryLink(): Promise<string | null> {
    return null;
  }

  async openReadStream(externalId: string, rangeHeader?: string): Promise<ExternalReadStream> {
    const params = new URLSearchParams({ alt: 'media', ...SHARED_DRIVE_PARAMS });
    const res = await this.call(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(externalId)}?${params}`,
      { headers: rangeHeader ? { Range: rangeHeader } : {} },
    );
    if (res.status !== 200 && res.status !== 206) await this.fail(res, 'lecture');
    if (!res.body) throw new ExternalStorageError('Réponse vide de Google Drive.', 'unknown', 502);

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
    const res = await this.call('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
    if (!res.ok) await this.fail(res, 'test de connexion');
  }
}

export function registerGoogleDriveProvider(supabaseAdmin: any): void {
  registerProviderFactory('google_drive', (connection) => new GoogleDriveProvider(connection, supabaseAdmin));
}
